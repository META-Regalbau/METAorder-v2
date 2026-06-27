import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";
import type { OfferConfigPdfDialogState } from "@/lib/offerConfigPdfOptions";
import {
  defaultOfferConfigPdfDialogState,
  loadOfferConfigPdfOptionsFromStorage,
  saveOfferConfigPdfOptionsToStorage,
} from "@/lib/offerConfigPdfOptions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: OfferConfigPdfDialogState) => void;
};

export default function OfferConfigPdfOptionsDialog({ open, onOpenChange, onConfirm }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<OfferConfigPdfDialogState>(defaultOfferConfigPdfDialogState);

  useEffect(() => {
    if (open) {
      setForm(loadOfferConfigPdfOptionsFromStorage());
    }
  }, [open]);

  const toggle = (key: keyof OfferConfigPdfDialogState, checked: boolean) => {
    setForm((prev) => ({ ...prev, [key]: checked }));
  };

  const handleDownload = () => {
    saveOfferConfigPdfOptionsToStorage(form);
    onConfirm(form);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("offerDetail.configPdfOptionsTitle")}</DialogTitle>
          <DialogDescription>{t("offerDetail.configPdfOptionsIntro")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2 text-sm">
          <div className="space-y-3">
            <p className="font-medium text-foreground">{t("offerDetail.configPdfSectionGeneral")}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-montage"
                checked={form.showMontageLine}
                onCheckedChange={(v) => toggle("showMontageLine", v === true)}
              />
              <Label htmlFor="cfg-montage" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfMontage")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-ship"
                checked={form.showShippingLine}
                onCheckedChange={(v) => toggle("showShippingLine", v === true)}
              />
              <Label htmlFor="cfg-ship" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfShipping")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-unit"
                checked={form.overviewShowUnitPrices}
                onCheckedChange={(v) => toggle("overviewShowUnitPrices", v === true)}
              />
              <Label htmlFor="cfg-unit" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfUnitPrices")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-vat-gross"
                checked={form.overviewShowVatAndGross}
                onCheckedChange={(v) => toggle("overviewShowVatAndGross", v === true)}
              />
              <Label htmlFor="cfg-vat-gross" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfVatGross")}
              </Label>
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-medium text-foreground">{t("offerDetail.configPdfSectionPositions")}</p>
            <p className="text-xs text-muted-foreground">{t("offerDetail.configPdfSectionPositionsHint")}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-img"
                checked={form.detailImage}
                onCheckedChange={(v) => toggle("detailImage", v === true)}
              />
              <Label htmlFor="cfg-img" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfDetailImage")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-desc"
                checked={form.detailDescription}
                onCheckedChange={(v) => toggle("detailDescription", v === true)}
              />
              <Label htmlFor="cfg-desc" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfDetailDesc")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-bom"
                checked={form.detailBom}
                onCheckedChange={(v) => toggle("detailBom", v === true)}
              />
              <Label htmlFor="cfg-bom" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfDetailBom")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="cfg-acc"
                checked={form.detailAccessory}
                onCheckedChange={(v) => toggle("detailAccessory", v === true)}
              />
              <Label htmlFor="cfg-acc" className="font-normal cursor-pointer">
                {t("offerDetail.configPdfDetailAccessory")}
              </Label>
            </div>
          </div>

          <p className="text-xs text-muted-foreground border-t pt-3">{t("offerDetail.configPdfRoadmapHint")}</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleDownload}>
            {t("offerDetail.configPdfDownloadWithOptions")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
