// Cross-Selling-Paar dauerhaft ablehnen: wird nie wieder vorgeschlagen (Gedaechtnis).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export const REJECT_REASON_CODES = ["incompatible", "other_system", "alternative", "not_relevant", "other"] as const;
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

type Props = {
  pair: { sourceProductNumber: string; targetProductNumber: string; sourceName?: string | null; targetName?: string | null } | null;
  onClose: () => void;
};

export default function RejectCrossSellPairDialog({ pair, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reasonCode, setReasonCode] = useState<RejectReasonCode>("alternative");
  const [note, setNote] = useState("");
  const [bothDirections, setBothDirections] = useState(false);

  const reset = () => {
    setReasonCode("alternative");
    setNote("");
    setBothDirections(false);
  };

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!pair) return null;
      const res = await apiRequest("POST", "/api/cross-selling/pairs/reject", {
        sourceProductNumber: pair.sourceProductNumber,
        targetProductNumber: pair.targetProductNumber,
        reasonCode,
        note: note.trim() || undefined,
        bothDirections,
      });
      return res.json() as Promise<{ stagingDeactivated: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/pairs"] });
      toast({
        title: t("crossSellMemory.rejected"),
        description: t("crossSellMemory.rejectedDescription", { count: result?.stagingDeactivated ?? 0 }),
      });
      reset();
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: t("crossSellMemory.rejectError"), description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog
      open={!!pair}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("crossSellMemory.rejectTitle")}</DialogTitle>
          <DialogDescription>{t("crossSellMemory.rejectDescription")}</DialogDescription>
        </DialogHeader>
        {pair && (
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <div>
                <span className="font-mono text-xs">{pair.sourceProductNumber}</span>
                {pair.sourceName && <span className="text-muted-foreground"> — {pair.sourceName}</span>}
              </div>
              <div className="text-muted-foreground">→</div>
              <div>
                <span className="font-mono text-xs">{pair.targetProductNumber}</span>
                {pair.targetName && <span className="text-muted-foreground"> — {pair.targetName}</span>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reject-reason">{t("crossSellMemory.reason")}</Label>
              <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as RejectReasonCode)}>
                <SelectTrigger id="reject-reason" aria-label={t("crossSellMemory.reason")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REJECT_REASON_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`crossSellMemory.reasons.${code}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reject-note">{t("crossSellMemory.note")}</Label>
              <Textarea id="reject-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="reject-both"
                checked={bothDirections}
                onCheckedChange={(v) => setBothDirections(v === true)}
              />
              <Label htmlFor="reject-both" className="text-sm font-normal">
                {t("crossSellMemory.bothDirections")}
              </Label>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>
            {rejectMutation.isPending ? t("common.loading") : t("crossSellMemory.rejectConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
