import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest } from "@/lib/queryClient";
import type { PortalNewsContent, PortalNewsPostDetail } from "@shared/portalNews";
import { newsStatusVariant } from "./status";

/** Abschnitt im Formular: Punkte als Text, eine Zeile je Punkt */
type SectionForm = { heading: string; itemsText: string };
type Form = { postDate: string; title: string; summary: string; tagsText: string; sections: SectionForm[] };

function toForm(post: PortalNewsPostDetail): Form {
  return {
    postDate: post.postDate,
    title: post.title,
    summary: post.summary,
    tagsText: post.tags.join(", "),
    sections: post.sections.map((s) => ({ heading: s.heading, itemsText: s.items.join("\n") })),
  };
}

function toContent(form: Form): PortalNewsContent {
  return {
    postDate: form.postDate,
    title: form.title.trim(),
    summary: form.summary.trim(),
    tags: [...new Set(form.tagsText.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 4),
    sections: form.sections
      .map((s) => ({ heading: s.heading.trim(), items: s.itemsText.split("\n").map((i) => i.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean) }))
      .filter((s) => s.items.length > 0),
  };
}

export default function NewsEditDialog({
  id,
  canManage,
  onClose,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const query = useQuery<{ post: PortalNewsPostDetail }>({ queryKey: [`/api/b2b/news/${id}`] });
  const post = query.data?.post;
  const [form, setForm] = useState<Form | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (post) setForm(toForm(post));
  }, [post]);

  const done = (data: { post: PortalNewsPostDetail }, message: string) => {
    setForm(toForm(data.post));
    void query.refetch();
    onChanged();
    toast({ title: message });
  };
  const failed = (err: Error) => toast({ title: t("portalNews.edit.failed"), description: err.message, variant: "destructive" });

  const save = useMutation({
    mutationFn: async (content: PortalNewsContent) => (await apiRequest("PUT", `/api/b2b/news/${id}`, content)).json(),
    onSuccess: (data) => done(data, post?.status === "published" ? t("portalNews.edit.savedPublished") : t("portalNews.edit.saved")),
    onError: failed,
  });
  const setStatus = useMutation({
    mutationFn: async (status: "published" | "hidden") => (await apiRequest("POST", `/api/b2b/news/${id}/status`, { status })).json(),
    onSuccess: (data) => done(data, data.post.status === "published" ? t("portalNews.edit.published") : t("portalNews.edit.hidden")),
    onError: failed,
  });
  const rewrite = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/b2b/news/${id}/rewrite`)).json(),
    onSuccess: (data) => done(data, t("portalNews.edit.rewritten")),
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/b2b/news/${id}`),
    onSuccess: () => {
      onChanged();
      toast({ title: t("portalNews.edit.deleted") });
      onClose();
    },
    onError: failed,
  });

  const busy = save.isPending || setStatus.isPending || rewrite.isPending || remove.isPending;
  const disabled = !canManage || busy;
  const content = form ? toContent(form) : null;
  const dirty = Boolean(post && content && JSON.stringify(content) !== JSON.stringify(toContent(toForm(post))));
  const valid = Boolean(content && content.title && /^\d{4}-\d{2}-\d{2}$/.test(content.postDate));
  const setSection = (i: number, patch: Partial<SectionForm>) =>
    setForm((f) => (f ? { ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : f));

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("portalNews.edit.title")}</DialogTitle>
          <DialogDescription>
            {post ? (
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={newsStatusVariant(post.status)}>{t(`portalNews.statuses.${post.status}`)}</Badge>
                <span>{t(`portalNews.sources.${post.source}`)}</span>
                {post.fromName || post.fromEmail ? <span>· {post.fromName ?? post.fromEmail}</span> : null}
                <span>· {fmt.dateTime(post.receivedAt)}</span>
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading || !form || !post ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("common.loading")}
          </div>
        ) : (
          <div className="space-y-4">
            {post.note ? (
              <Alert>
                <AlertDescription>{post.note}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr]">
              <div>
                <Label htmlFor="news-date">{t("portalNews.edit.postDate")}</Label>
                <Input id="news-date" type="date" className="mt-1" value={form.postDate} disabled={disabled} onChange={(e) => setForm({ ...form, postDate: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="news-title">{t("portalNews.edit.postTitle")}</Label>
                <Input id="news-title" className="mt-1" value={form.title} maxLength={200} disabled={disabled} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="news-summary">{t("portalNews.edit.summary")}</Label>
              <Textarea id="news-summary" className="mt-1" rows={2} maxLength={1000} value={form.summary} disabled={disabled} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="news-tags">{t("portalNews.edit.tags")}</Label>
              <Input id="news-tags" className="mt-1" value={form.tagsText} disabled={disabled} placeholder={t("portalNews.edit.tagsPlaceholder")} onChange={(e) => setForm({ ...form, tagsText: e.target.value })} />
            </div>

            <div className="space-y-3">
              {form.sections.map((s, i) => (
                <div key={i} className="rounded border p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Label htmlFor={`news-section-${i}`}>{t("portalNews.edit.sectionHeading")}</Label>
                      <Input id={`news-section-${i}`} className="mt-1" value={s.heading} maxLength={120} disabled={disabled} onChange={(e) => setSection(i, { heading: e.target.value })} />
                    </div>
                    {canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        aria-label={t("portalNews.edit.removeSection")}
                        onClick={() => setForm({ ...form, sections: form.sections.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  <div>
                    <Label htmlFor={`news-items-${i}`}>{t("portalNews.edit.items")}</Label>
                    <Textarea id={`news-items-${i}`} className="mt-1" rows={Math.min(10, Math.max(3, s.itemsText.split("\n").length))} value={s.itemsText} disabled={disabled} onChange={(e) => setSection(i, { itemsText: e.target.value })} />
                  </div>
                </div>
              ))}
              {canManage ? (
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setForm({ ...form, sections: [...form.sections, { heading: "", itemsText: "" }] })}>
                  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t("portalNews.edit.addSection")}
                </Button>
              ) : null}
            </div>

            {post.bodyText ? (
              <details className="rounded border p-3 text-sm">
                <summary className="cursor-pointer font-medium">{t("portalNews.edit.original", { subject: post.subject || "–" })}</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground max-h-72 overflow-y-auto">{post.bodyText}</pre>
              </details>
            ) : null}

            {canManage ? (
              <div className="flex flex-wrap justify-between gap-2 pt-2">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={disabled} onClick={() => setConfirmDelete(true)} data-testid="button-news-delete">
                    <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                    {t("common.delete")}
                  </Button>
                  {post.bodyText ? (
                    <Button variant="outline" disabled={disabled} onClick={() => rewrite.mutate()} data-testid="button-news-rewrite">
                      {rewrite.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4 mr-2" aria-hidden="true" />}
                      {t("portalNews.edit.rewrite")}
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {post.status === "published" ? (
                    <Button variant="outline" disabled={disabled} onClick={() => setStatus.mutate("hidden")} data-testid="button-news-hide">
                      <EyeOff className="h-4 w-4 mr-2" aria-hidden="true" />
                      {t("portalNews.edit.hide")}
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={disabled || dirty || !post.sections.length} onClick={() => setStatus.mutate("published")} title={dirty ? t("portalNews.edit.saveFirst") : undefined} data-testid="button-news-publish">
                      <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
                      {t("portalNews.edit.publish")}
                    </Button>
                  )}
                  <Button disabled={disabled || !dirty || !valid} onClick={() => content && save.mutate(content)} data-testid="button-news-save">
                    {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("portalNews.edit.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t(post?.status === "published" ? "portalNews.edit.deleteTextPublished" : "portalNews.edit.deleteText")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => remove.mutate()} data-testid="button-news-delete-confirm">
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
