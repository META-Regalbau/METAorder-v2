import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ClipboardPaste, Eye, Loader2, Newspaper, RefreshCw, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Role } from "@shared/schema";
import type { PortalNewsPageInfo, PortalNewsPost, PortalNewsPostDetail } from "@shared/portalNews";
import NewsEditDialog from "@/components/portalNews/NewsEditDialog";
import NewsSettingsTab from "@/components/portalNews/NewsSettingsTab";
import { newsStatusVariant } from "@/components/portalNews/status";

/**
 * Portal-Neuigkeiten: Beiträge aus Changelog-Mails (über n8n aus einem Ordner im Postfach) oder von Hand
 * eingefügt. METAorder schreibt die veröffentlichten auf eine Erlebniswelt; die Zuordnung zur Portal-Kategorie
 * macht der Admin selbst im Shop. Server: server/b2b/portalNewsRoutes.ts.
 */

interface PortalNewsPageProps {
  userPermissions?: Role["permissions"];
  userRole?: string;
}

const isNewsQuery = (key: unknown) => String(key).startsWith("/api/b2b/news");

export default function PortalNewsPage({ userPermissions, userRole }: PortalNewsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const search = useSearch();
  const [, navigate] = useLocation();
  const canManage = userRole === "admin" || Boolean(userPermissions?.manageB2B);
  const [tab, setTab] = useState("posts");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState({ subject: "", text: "" });
  const [previewOpen, setPreviewOpen] = useState(false);

  const selectedId = new URLSearchParams(search).get("id");
  const openDetail = (id: string | null) => navigate(id ? `/b2b/news?id=${encodeURIComponent(id)}` : "/b2b/news");

  const listQuery = useQuery<{ posts: PortalNewsPost[] }>({ queryKey: ["/api/b2b/news"], refetchInterval: 60_000 });
  const pageQuery = useQuery<{ page: PortalNewsPageInfo }>({ queryKey: ["/api/b2b/news/page"] });
  const previewQuery = useQuery<{ html: string; postCount: number }>({ queryKey: ["/api/b2b/news/page/preview"], enabled: previewOpen });
  const page = pageQuery.data?.page;

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => isNewsQuery(q.queryKey[0]) });

  const writePage = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/b2b/news/page/write")).json() as Promise<{ action: string; postCount: number }>,
    onSuccess: (data) => {
      toast({ title: t("portalNews.page.written", { count: data.postCount }) });
      void refresh();
    },
    onError: (err: Error) => {
      toast({ title: t("portalNews.page.writeFailed"), description: err.message, variant: "destructive" });
      void refresh();
    },
  });

  const fromText = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/b2b/news/from-text", paste)).json() as Promise<{ post: PortalNewsPostDetail }>,
    onSuccess: (data) => {
      setPasteOpen(false);
      setPaste({ subject: "", text: "" });
      void refresh();
      openDetail(data.post.id);
    },
    onError: (err: Error) => toast({ title: t("portalNews.paste.failed"), description: err.message, variant: "destructive" }),
  });

  const posts = listQuery.data?.posts ?? [];

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            {t("portalNews.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("portalNews.subtitle")}</p>
        </div>
        {tab === "posts" ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => refresh()} data-testid="button-news-refresh">
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              {t("common.refresh")}
            </Button>
            {canManage ? (
              <Button onClick={() => setPasteOpen(true)} data-testid="button-news-paste">
                <ClipboardPaste className="h-4 w-4 mr-2" aria-hidden="true" />
                {t("portalNews.paste.open")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="posts" data-testid="tab-news-posts">{t("portalNews.tabs.posts")}</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-news-settings">{t("portalNews.tabs.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="space-y-3">
          <Card className="p-4 space-y-2" data-testid="news-page-state">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-sm">
                <div className="font-medium">{t("portalNews.page.heading")}</div>
                {pageQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t("common.loading")}
                  </div>
                ) : page ? (
                  <>
                    <div className="text-muted-foreground">
                      {page.exists ? t("portalNews.page.exists") : t("portalNews.page.missing")}
                      {page.writtenAt ? ` · ${t("portalNews.page.writtenAt", { date: fmt.dateTime(page.writtenAt), count: page.postCount })}` : ""}
                    </div>
                    <div className={page.categories.length ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}>
                      {page.categories.length
                        ? t("portalNews.page.assigned", { categories: page.categories.map((c) => c.name).join(", ") })
                        : t("portalNews.page.notAssigned")}
                    </div>
                    {page.lastError ? (
                      <div className="flex items-start gap-1 text-destructive">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                        <span>
                          {page.lastErrorAt ? `${fmt.dateTime(page.lastErrorAt)}: ` : ""}
                          {page.lastError}
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} data-testid="button-news-preview">
                  <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t("common.preview")}
                </Button>
                {canManage ? (
                  <Button variant="outline" size="sm" disabled={writePage.isPending} onClick={() => writePage.mutate()} data-testid="button-news-write-page">
                    {writePage.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4 mr-2" aria-hidden="true" />}
                    {t("portalNews.page.write")}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            {listQuery.isLoading ? (
              <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("common.loading")}
              </div>
            ) : listQuery.error ? (
              <p className="p-6 text-sm text-destructive">{(listQuery.error as Error).message}</p>
            ) : posts.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground" data-testid="news-empty">{t("portalNews.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portalNews.columns.date")}</TableHead>
                    <TableHead>{t("portalNews.columns.title")}</TableHead>
                    <TableHead>{t("portalNews.columns.from")}</TableHead>
                    <TableHead>{t("portalNews.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((post) => (
                    <TableRow key={post.id} className="cursor-pointer" onClick={() => openDetail(post.id)} data-testid={`row-news-${post.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(post.id);
                          }}
                        >
                          {fmt.date(post.postDate)}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{post.title || post.subject || "–"}</div>
                        {post.summary ? <div className="text-xs text-muted-foreground line-clamp-2 max-w-xl">{post.summary}</div> : null}
                        {post.note ? <div className="text-xs text-amber-700 dark:text-amber-400 max-w-xl">{post.note}</div> : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{post.fromName ?? post.fromEmail ?? t(`portalNews.sources.${post.source}`)}</div>
                        <div className="text-xs text-muted-foreground">{fmt.dateTime(post.receivedAt)}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={newsStatusVariant(post.status)}>{t(`portalNews.statuses.${post.status}`)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <NewsSettingsTab canManage={canManage} />
        </TabsContent>
      </Tabs>

      {selectedId ? <NewsEditDialog id={selectedId} canManage={canManage} onClose={() => openDetail(null)} onChanged={refresh} /> : null}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("portalNews.paste.title")}</DialogTitle>
            <DialogDescription>{t("portalNews.paste.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="news-paste-subject">{t("portalNews.paste.subject")}</Label>
              <Input id="news-paste-subject" className="mt-1" value={paste.subject} maxLength={500} onChange={(e) => setPaste({ ...paste, subject: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="news-paste-text">{t("portalNews.paste.text")}</Label>
              <Textarea id="news-paste-text" className="mt-1" rows={12} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPasteOpen(false)}>{t("common.cancel")}</Button>
              <Button disabled={fromText.isPending || paste.text.trim().length < 20} onClick={() => fromText.mutate()} data-testid="button-news-paste-create">
                {fromText.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                {t("portalNews.paste.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("portalNews.page.previewTitle")}</DialogTitle>
            <DialogDescription>{t("portalNews.page.previewDescription")}</DialogDescription>
          </DialogHeader>
          {previewQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("common.loading")}
            </div>
          ) : previewQuery.data?.html ? (
            <div className="border rounded bg-white overflow-hidden">
              <iframe title={t("portalNews.page.previewTitle")} srcDoc={previewQuery.data.html} sandbox="" className="w-full block" style={{ height: 720, border: 0 }} data-testid="news-preview" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
