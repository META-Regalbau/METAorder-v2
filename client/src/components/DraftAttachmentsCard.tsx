/**
 * „Beigefügte Dokumente": Anhänge derselben Mail, die NICHT zum Entwurf extrahiert wurden
 * (Lieferschein des Kunden, Auftragsbestätigung, Rechnung, Sonstiges).
 *
 * Der Bearbeiter sieht damit z. B., dass ein Kundenlieferschein der Sendung beizulegen ist.
 * Die Dateien werden später von Lobster abgeholt und ins d.3 geschrieben (Export-Status).
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paperclip, FileText, ExternalLink, UploadCloud, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, readJsonBody } from "@/lib/queryClient";

export type DraftAttachmentApi = {
  id: string;
  documentKind: "purchase_order" | "delivery_note" | "order_confirmation" | "invoice" | "other" | "unknown";
  documentKindLabel: string;
  fileName: string;
  mimeType: string;
  size: number;
  classification: { confidence: number; signals: string[] };
  references: {
    deliveryNoteNumber?: string | null;
    orderNumber?: string | null;
    invoiceNumber?: string | null;
    commission?: string | null;
    documentDate?: string | null;
  };
  exportStatus: "pending" | "exported" | "skipped";
  exportedAt?: string | null;
  exportReference?: string | null;
  createdAt: string;
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DraftAttachmentsCard({
  draftId,
  draftKind,
}: {
  draftId: string;
  draftKind: "order" | "offer";
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const base = `/api/${draftKind}-drafts/${draftId}/attachments`;
  const { data } = useQuery<{ attachments: DraftAttachmentApi[]; sftpAvailable?: boolean }>({
    queryKey: [base],
    enabled: Boolean(draftId),
  });
  const attachments = data?.attachments ?? [];

  // Manuelle SFTP-Übergabe (Lobster → d.3), z. B. nach fehlgeschlagenem Auto-Upload
  const sftpUpload = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${base}/sftp-upload`, { force: true });
      return readJsonBody<{ uploaded: number; failed: number; skipped: number; results: Array<{ error?: string; serverName: string; status: string }> }>(res);
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: [base] });
      const firstError = r.results.find((x) => x.status === "failed")?.error;
      toast({
        title: t("orderDrafts.review.attachments.sftpTitle", "SFTP-Übergabe"),
        description: t("orderDrafts.review.attachments.sftpResult", {
          uploaded: r.uploaded,
          failed: r.failed,
          defaultValue: "{{uploaded}} hochgeladen, {{failed}} fehlgeschlagen",
        }) + (firstError ? ` — ${firstError}` : ""),
        variant: r.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  if (attachments.length === 0) return null;
  const showSftp = draftKind === "order" && data?.sftpAvailable === true;

  const kindBadgeClass = (kind: DraftAttachmentApi["documentKind"]) => {
    switch (kind) {
      case "delivery_note":
        return "border-blue-500/60 text-blue-800 dark:text-blue-200";
      case "invoice":
        return "border-purple-500/60 text-purple-800 dark:text-purple-200";
      case "order_confirmation":
        return "border-emerald-500/60 text-emerald-800 dark:text-emerald-200";
      default:
        return "";
    }
  };

  return (
    <Card data-testid="card-draft-attachments">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Paperclip className="w-4 h-4" />
          {t("orderDrafts.review.attachments.title", "Beigefügte Dokumente")}
          <Badge variant="secondary" className="ml-1">
            {attachments.length}
          </Badge>
          {showSftp && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={sftpUpload.isPending}
              onClick={() => sftpUpload.mutate()}
              data-testid="button-attachments-sftp-upload"
            >
              {sftpUpload.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="mr-1 h-3.5 w-3.5" />}
              {t("orderDrafts.review.attachments.sftpUpload", "Per SFTP übergeben")}
            </Button>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(
            "orderDrafts.review.attachments.hint",
            "Anhänge derselben Mail, die nicht als Bestellung extrahiert wurden. Ein Kundenlieferschein ist der Sendung beizulegen; die Dateien gehen später ins Dokumentenarchiv."
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {attachments.map((att) => {
          const refs: string[] = [];
          if (att.references.deliveryNoteNumber)
            refs.push(`${t("orderDrafts.review.attachments.deliveryNoteNumber", "LS-Nr.")} ${att.references.deliveryNoteNumber}`);
          if (att.references.orderNumber)
            refs.push(`${t("orderDrafts.review.attachments.orderNumber", "Bestell-Nr.")} ${att.references.orderNumber}`);
          if (att.references.invoiceNumber)
            refs.push(`${t("orderDrafts.review.attachments.invoiceNumber", "Rechnungs-Nr.")} ${att.references.invoiceNumber}`);
          if (att.references.commission)
            refs.push(`${t("orderDrafts.review.attachments.commission", "Kommission")} ${att.references.commission}`);
          if (att.references.documentDate) refs.push(att.references.documentDate);
          return (
            <div
              key={att.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              data-testid={`draft-attachment-${att.id}`}
            >
              <div className="flex min-w-0 items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{att.fileName}</span>
                    <Badge variant="outline" className={`text-[10px] ${kindBadgeClass(att.documentKind)}`}>
                      {att.documentKindLabel}
                    </Badge>
                    {att.classification.confidence > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(att.classification.confidence * 100)} %
                      </span>
                    )}
                    <Badge
                      variant={att.exportStatus === "exported" ? "default" : "secondary"}
                      className="text-[10px]"
                      title={att.exportReference ?? undefined}
                    >
                      {att.exportStatus === "exported"
                        ? t("orderDrafts.review.attachments.exported", "im Archiv")
                        : att.exportStatus === "skipped"
                          ? t("orderDrafts.review.attachments.skipped", "nicht archiviert")
                          : t("orderDrafts.review.attachments.pending", "Archiv ausstehend")}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[formatSize(att.size), ...refs].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" data-testid={`button-open-attachment-${att.id}`}>
                <a href={`${base}/${att.id}/file`} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  {t("orderDrafts.review.attachments.open", "Öffnen")}
                </a>
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
