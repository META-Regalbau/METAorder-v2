import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, LayoutTemplate, Loader2, Monitor, RefreshCw, Smartphone, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopContentDetail, ShopContentIssue, ShopContentListEntry, ShopContentPublicationSummary } from "@shared/shopContent";

/**
 * Shop-Inhalte (nur Administratoren): Branchen-Landingpages und Startseiten-Abschnitte mit Version,
 * Stand in Testshop/Live, Pruefergebnis und Vorschau mit dem HTML-Renderer der Shop-Seiten.
 * Schritt A des Konzepts vom 16.10.2026: nur lesend; Bearbeiten und Veroeffentlichen folgen.
 * Server: server/routes/shopContentRoutes.ts.
 */

type ListResponse = { items: ShopContentListEntry[] };
type PreviewResponse = { html: string; issues: ShopContentIssue[]; asOf: string | null; versionNo: number };

const MOBILE_WIDTH = 390;

export default function ShopContentPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(fmt.locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    [fmt.locale],
  );
  const date = (iso: string) => dateFormat.format(new Date(iso));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [notes, setNotes] = useState(true);

  const listQuery = useQuery<ListResponse>({ queryKey: ["/api/shop-content"] });
  const items = listQuery.data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const detailQuery = useQuery<ShopContentDetail>({ queryKey: ["/api/shop-content", selectedId ?? ""], enabled: !!selectedId });
  const previewQuery = useQuery<PreviewResponse>({
    queryKey: ["/api/shop-content", selectedId ?? "", `preview?notes=${notes ? "1" : "0"}`],
    enabled: !!selectedId,
  });

  const importMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-content/import")).json() as Promise<{ created: string[]; skipped: string[] }>,
    onSuccess: (result) => {
      toast({ title: t("shopContent.importDone", { created: result.created.length, skipped: result.skipped.length }) });
      queryClient.invalidateQueries({ queryKey: ["/api/shop-content"] });
    },
    onError: (error: Error) => toast({ title: t("shopContent.importFailed"), description: error.message, variant: "destructive" }),
  });

  const kindLabel = (kind: ShopContentListEntry["kind"]) => t(`shopContent.kinds.${kind}`);
  const ruleText = (issue: ShopContentIssue) => t(`shopContent.rules.${issue.rule}`, { defaultValue: issue.rule, ...(issue.params ?? {}) });

  const publication = (p: ShopContentPublicationSummary | null) =>
    p ? (
      <span className="text-sm">
        {t("shopContent.versionShort", { no: p.versionNo ?? "?" })} · {date(p.publishedAt)}
      </span>
    ) : (
      <span className="text-sm text-muted-foreground">{t("shopContent.notPublished")}</span>
    );

  const checkBadge = (item: ShopContentListEntry) => {
    if (item.errors > 0)
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          {t("shopContent.errors", { count: item.errors })}
        </Badge>
      );
    if (item.warnings > 0)
      return (
        <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          <AlertTriangle className="h-3 w-3" />
          {t("shopContent.warnings", { count: item.warnings })}
        </Badge>
      );
    return (
      <Badge variant="outline" className="gap-1">
        <CheckCircle2 className="h-3 w-3 text-green-600" />
        {t("shopContent.checkOk")}
      </Badge>
    );
  };

  const issueList = (issues: ShopContentIssue[]) => (
    <ul className="space-y-1.5 text-sm" data-testid="shop-content-issues">
      {issues.map((issue, i) => (
        <li key={i} className="flex gap-2">
          {issue.level === "error" ? <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />}
          <span>
            {ruleText(issue)}
            {issue.path ? <code className="ml-2 text-xs text-muted-foreground">{issue.path}</code> : null}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
          <LayoutTemplate className="h-6 w-6 text-muted-foreground" />
          {t("shopContent.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("shopContent.subtitle")}</p>
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("shopContent.loading")}
        </div>
      ) : listQuery.isError ? (
        <Card className="p-4 text-sm text-destructive">{t("shopContent.loadError")}</Card>
      ) : items.length === 0 ? (
        <Card className="p-6 space-y-3" data-testid="shop-content-empty">
          <p className="text-sm">{t("shopContent.empty")}</p>
          <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending} data-testid="button-shop-content-import">
            {importMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {t("shopContent.import")}
          </Button>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table data-testid="shop-content-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopContent.columns.name")}</TableHead>
                <TableHead>{t("shopContent.columns.kind")}</TableHead>
                <TableHead>{t("shopContent.columns.version")}</TableHead>
                <TableHead>{t("shopContent.columns.test")}</TableHead>
                <TableHead>{t("shopContent.columns.live")}</TableHead>
                <TableHead>{t("shopContent.columns.check")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className={`cursor-pointer ${item.id === selectedId ? "bg-muted" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                  data-testid={`row-shop-content-${item.key}`}
                >
                  <TableCell>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setSelectedId(item.id)}>
                      {item.name}
                    </button>
                    {item.url ? <div className="text-xs text-muted-foreground">{item.url}</div> : null}
                  </TableCell>
                  <TableCell className="text-sm">{kindLabel(item.kind)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {t("shopContent.versionShort", { no: item.versionNo })}
                    <div className="text-xs text-muted-foreground">
                      {date(item.versionAt)}
                      {item.versionBy ? ` · ${item.versionBy}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>{publication(item.test)}</TableCell>
                  <TableCell>{publication(item.live)}</TableCell>
                  <TableCell>{checkBadge(item)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {selected ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4 space-y-3">
              <h2 className="font-semibold">{selected.name}</h2>
              <h3 className="text-sm font-medium">{t("shopContent.checks")}</h3>
              {detailQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : detailQuery.data && detailQuery.data.issues.length > 0 ? (
                issueList(detailQuery.data.issues)
              ) : (
                <p className="text-sm text-muted-foreground">{t("shopContent.noIssues")}</p>
              )}
            </Card>
            <Card className="p-4 space-y-2">
              <h3 className="text-sm font-medium">{t("shopContent.versions")}</h3>
              <ul className="space-y-2 text-sm" data-testid="shop-content-versions">
                {(detailQuery.data?.versions ?? []).map((v) => (
                  <li key={v.id}>
                    <span className="font-medium">{t("shopContent.versionShort", { no: v.versionNo })}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {date(v.createdAt)}
                      {v.createdBy ? ` · ${v.createdBy}` : ""}
                    </span>
                    {v.comment ? <div className="text-xs text-muted-foreground">{v.comment}</div> : null}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="p-4 space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium mr-auto">{t("shopContent.preview")}</h3>
              <Button size="sm" variant={mobile ? "outline" : "secondary"} onClick={() => setMobile(false)} aria-pressed={!mobile}>
                <Monitor className="h-4 w-4 mr-1" />
                {t("shopContent.desktop")}
              </Button>
              <Button size="sm" variant={mobile ? "secondary" : "outline"} onClick={() => setMobile(true)} aria-pressed={mobile}>
                <Smartphone className="h-4 w-4 mr-1" />
                {t("shopContent.mobile")}
              </Button>
              <div className="flex items-center gap-2 ml-2">
                <Switch id="shop-content-notes" checked={notes} onCheckedChange={setNotes} />
                <Label htmlFor="shop-content-notes" className="text-sm">
                  {t("shopContent.notes")}
                </Label>
              </div>
              <Button size="sm" variant="outline" onClick={() => previewQuery.refetch()} disabled={previewQuery.isFetching} aria-label={t("shopContent.reload")}>
                <RefreshCw className={`h-4 w-4 ${previewQuery.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
            {previewQuery.data && previewQuery.data.issues.length > 0 ? issueList(previewQuery.data.issues) : null}
            {previewQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("shopContent.previewLoading")}
              </div>
            ) : previewQuery.isError ? (
              <p className="text-sm text-destructive">
                {t("shopContent.previewError")} {(previewQuery.error as Error)?.message}
              </p>
            ) : previewQuery.data?.html ? (
              <div className="border rounded bg-white overflow-hidden mx-auto" style={{ width: mobile ? MOBILE_WIDTH : "100%", maxWidth: "100%" }}>
                <iframe
                  title={t("shopContent.previewTitle", { name: selected.name })}
                  srcDoc={previewQuery.data.html}
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                  className="w-full block"
                  style={{ height: 900, border: 0 }}
                  data-testid="shop-content-preview"
                />
              </div>
            ) : null}
          </Card>
        </div>
      ) : items.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t("shopContent.selectHint")}</p>
      ) : null}
    </div>
  );
}
