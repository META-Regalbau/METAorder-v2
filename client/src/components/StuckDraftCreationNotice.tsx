import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { useIsAdministrator } from "@/hooks/useMarginVisibility";
import { apiRequest, queryClient } from "@/lib/queryClient";

const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Entwurf steht auf „wird angelegt“ (Absturz oder Fehler nach dem Sperren). Ob der Beleg in
 * Shopware entstanden ist, weiß METAorder nicht sicher — Administratoren prüfen dort und lösen
 * die Sperre: mit Shopware-ID als angelegt verknüpfen oder zurück in die Prüfung.
 */
export function StuckDraftCreationNotice({
  kind,
  draftId,
  updatedAt,
  onReleased,
}: {
  kind: "order" | "offer";
  draftId: string;
  updatedAt: string | Date | null | undefined;
  onReleased?: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const { toast } = useToast();
  const isAdmin = useIsAdministrator();
  const [shopwareId, setShopwareId] = useState("");
  const since = updatedAt ? new Date(updatedAt) : null;
  const stuck = since ? Date.now() - since.getTime() >= STUCK_AFTER_MS : false;

  const mutation = useMutation({
    mutationFn: async (shopwareEntityId: string | null) => {
      const res = await apiRequest(
        "POST",
        `/api/${kind}-drafts/${draftId}/release-creation`,
        shopwareEntityId ? { shopwareEntityId } : {},
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/${kind}-drafts`] });
      toast({ title: t("stuckDraftCreation.released") });
      onReleased?.();
    },
    onError: (error: Error) =>
      toast({ title: t("stuckDraftCreation.releaseError"), description: error.message, variant: "destructive" }),
  });

  return (
    <Alert className="border-amber-500/40 bg-amber-500/5" data-testid="alert-stuck-creation">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">{t("stuckDraftCreation.title")}</AlertTitle>
      <AlertDescription className="text-xs space-y-2">
        <p>{t("stuckDraftCreation.text", { date: since ? fmt.dateTime(since) : "—" })}</p>
        {isAdmin && stuck ? (
          <div className="space-y-2">
            <p>{t("stuckDraftCreation.adminHint")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`stuck-shopware-id-${draftId}`} className="text-xs">
                  {t("stuckDraftCreation.shopwareIdLabel")}
                </Label>
                <Input
                  id={`stuck-shopware-id-${draftId}`}
                  value={shopwareId}
                  onChange={(e) => setShopwareId(e.target.value)}
                  className="h-8 w-80 font-mono text-xs"
                  data-testid="input-stuck-shopware-id"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!shopwareId.trim() || mutation.isPending}
                onClick={() => mutation.mutate(shopwareId.trim())}
                data-testid="button-stuck-link"
              >
                {t("stuckDraftCreation.link")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(null)}
                data-testid="button-stuck-release"
              >
                {t("stuckDraftCreation.release")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("stuckDraftCreation.waitHint")}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
