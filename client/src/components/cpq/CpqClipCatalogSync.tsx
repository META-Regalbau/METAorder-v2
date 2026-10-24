/**
 * CPQ-Admin: Mappings des Systems META CLIP (Clinch + S3) aus dem Shop-Katalog abgleichen
 * (POST /api/cpq/admin/clip-catalog-sync, server/cpq/clipCatalogSync.ts). Erst Vorschau, dann übernehmen.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type SyncResult = {
  systemId: string | null;
  applied: boolean;
  plan: { specs: number; byRole: Record<string, number>; skipped: Array<{ productNumber: string; name: string; reason: string }> };
  diff: {
    create: Array<{ productNumber: string; name: string; role: string }>;
    update: Array<{ productNumber: string; name: string; role: string }>;
    deactivate: Array<{ productNumber: string; name: string | null }>;
    unchanged: number;
  };
  missingComponentTypes: string[];
};

export default function CpqClipCatalogSync() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SyncResult | null>(null);

  const run = useMutation({
    mutationFn: async (apply: boolean): Promise<SyncResult> => {
      const res = await apiRequest("POST", "/api/cpq/admin/clip-catalog-sync", { apply });
      return res.json();
    },
    onSuccess: (result) => {
      if (!result.applied) {
        setPreview(result);
        return;
      }
      setOpen(false);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/systems"] });
      toast({
        title: t("cpq.admin.clipSync.doneTitle"),
        description: t("cpq.admin.clipSync.doneDescription", { create: result.diff.create.length, update: result.diff.update.length, deactivate: result.diff.deactivate.length }),
      });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const changes = preview ? preview.diff.create.length + preview.diff.update.length + preview.diff.deactivate.length : 0;
  const list = (title: string, rows: Array<{ name: string | null; productNumber: string }>) =>
    rows.length > 0 && (
      <div>
        <p className="text-sm font-medium mb-1">{title} ({rows.length})</p>
        <ul className="text-xs text-muted-foreground max-h-32 overflow-auto space-y-0.5">
          {rows.map((r) => <li key={r.productNumber}>{r.name ?? r.productNumber}</li>)}
        </ul>
      </div>
    );

  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); setPreview(null); run.mutate(false); }}>
        <RefreshCw className="h-4 w-4 mr-2" />
        {t("cpq.admin.clipSync.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.clipSync.title")}</DialogTitle>
            <DialogDescription>{t("cpq.admin.clipSync.description")}</DialogDescription>
          </DialogHeader>
          {!preview ? (
            <p className="text-sm text-muted-foreground">{t("cpq.admin.clipSync.loading")}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                {t("cpq.admin.clipSync.summary", { specs: preview.plan.specs, unchanged: preview.diff.unchanged })}
              </p>
              {!preview.systemId && <p className="text-sm">{t("cpq.admin.clipSync.createsSystem")}</p>}
              {list(t("cpq.admin.clipSync.create"), preview.diff.create)}
              {list(t("cpq.admin.clipSync.update"), preview.diff.update)}
              {list(t("cpq.admin.clipSync.deactivate"), preview.diff.deactivate)}
              {preview.plan.skipped.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">{t("cpq.admin.clipSync.skipped")} ({preview.plan.skipped.length})</p>
                  <ul className="text-xs text-muted-foreground max-h-32 overflow-auto space-y-0.5">
                    {preview.plan.skipped.map((s) => <li key={s.productNumber}>{s.name} – {s.reason}</li>)}
                  </ul>
                </div>
              )}
              {changes === 0 && <p className="text-sm text-muted-foreground">{t("cpq.admin.clipSync.nothingToDo")}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("cpq.admin.common.cancel")}</Button>
            <Button disabled={!preview || changes === 0 || run.isPending} onClick={() => run.mutate(true)}>
              {t("cpq.admin.clipSync.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
