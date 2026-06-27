/** Muss zu server/offerConfigPdf.ts applyOfferConfigPdfLayoutFromRequest passen. */
export const CFG_QUERY = {
  montage: "cfgMontage",
  ship: "cfgShip",
  unitPrice: "cfgUnitPrice",
  vatGross: "cfgVatGross",
  img: "cfgImg",
  desc: "cfgDesc",
  bom: "cfgBom",
  acc: "cfgAcc",
} as const;

export type OfferConfigPdfDialogState = {
  showMontageLine: boolean;
  showShippingLine: boolean;
  overviewShowUnitPrices: boolean;
  overviewShowVatAndGross: boolean;
  detailImage: boolean;
  detailDescription: boolean;
  detailBom: boolean;
  detailAccessory: boolean;
};

const LS_KEY = "metaorder-offer-config-pdf-options";

export function defaultOfferConfigPdfDialogState(): OfferConfigPdfDialogState {
  return {
    showMontageLine: true,
    showShippingLine: true,
    overviewShowUnitPrices: true,
    overviewShowVatAndGross: true,
    detailImage: true,
    detailDescription: true,
    detailBom: true,
    detailAccessory: true,
  };
}

export function loadOfferConfigPdfOptionsFromStorage(): OfferConfigPdfDialogState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultOfferConfigPdfDialogState();
    const j = JSON.parse(raw) as Partial<OfferConfigPdfDialogState>;
    return { ...defaultOfferConfigPdfDialogState(), ...j };
  } catch {
    return defaultOfferConfigPdfDialogState();
  }
}

export function saveOfferConfigPdfOptionsToStorage(o: OfferConfigPdfDialogState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

export function buildCfgPdfSearchParams(o: OfferConfigPdfDialogState): string {
  const p = new URLSearchParams();
  const set = (k: string, v: boolean) => p.set(k, v ? "1" : "0");
  set(CFG_QUERY.montage, o.showMontageLine);
  set(CFG_QUERY.ship, o.showShippingLine);
  set(CFG_QUERY.unitPrice, o.overviewShowUnitPrices);
  set(CFG_QUERY.vatGross, o.overviewShowVatAndGross);
  set(CFG_QUERY.img, o.detailImage);
  set(CFG_QUERY.desc, o.detailDescription);
  set(CFG_QUERY.bom, o.detailBom);
  set(CFG_QUERY.acc, o.detailAccessory);
  return p.toString();
}
