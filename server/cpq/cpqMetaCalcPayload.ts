/**
 * Baut Shopware/B2B-kompatible Line-Item-Payloads im MetaCalc-Stil aus CPQ-Stücklisten,
 * damit config-PDF und Angebotsdetail die gleiche Struktur wie MetaCalc-Angebote nutzen.
 */

export type CpqBomItemSnapshot = {
  productId: string;
  productNumber: string;
  name: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
  componentType?: string;
};

export type CpqSourceSnapshot = {
  systemId?: string | null;
  systemName?: string | null;
  config?: Record<string, unknown> | null;
  cpqConfigurationId?: string | null;
  billOfMaterials?: {
    items: CpqBomItemSnapshot[];
    totalPrice?: number;
  };
};

function isAccessoryComponentType(componentType: string | undefined): boolean {
  if (!componentType) return false;
  const t = componentType.toLowerCase();
  return t.includes("accessory") || t.includes("zubehör") || t.includes("zubehoer");
}

/** MetaCalc-kompatible Teil-Stückliste (productId Pflicht für Auflösung im PDF). */
export function buildMetaCalcConfigurationPayloadFromCpqBom(items: CpqBomItemSnapshot[]): {
  metaCalcConfigurationName: string;
  metaCalcConfigurationPayload: {
    metaCalcConfigurationName: string;
    description: string;
    image: string | null;
    installationTime: number;
    installationTimeMinutes: number;
    partsList: Array<{ productId: string; quantity: number; description: string }>;
    accessoryList: Array<{ productId: string; quantity: number; description: string }>;
  };
} {
  const partsList: Array<{ productId: string; quantity: number; description: string }> = [];
  const accessoryList: Array<{ productId: string; quantity: number; description: string }> = [];

  for (const row of items) {
    if (!row.productId) continue;
    const entry = {
      productId: row.productId,
      quantity: Math.max(0, Number(row.quantity) || 0),
      description: row.name || row.productNumber || "",
    };
    if (isAccessoryComponentType(row.componentType)) {
      accessoryList.push(entry);
    } else {
      partsList.push(entry);
    }
  }

  const metaCalcConfigurationName = "CPQ Regalkonfiguration";

  return {
    metaCalcConfigurationName,
    metaCalcConfigurationPayload: {
      metaCalcConfigurationName,
      description:
        "Konfiguration aus dem META Order CPQ-Konfigurator (Stückliste siehe unten).",
      image: null,
      installationTime: 0,
      installationTimeMinutes: 0,
      partsList,
      accessoryList,
    },
  };
}

/**
 * Payload für ein einzelnes Angebot-LineItem (wie bei MetaCalc), inkl. Top-Level-Namen für PDF-Texte.
 */
export function buildShopwareLinePayloadFromCpqSource(cpq: CpqSourceSnapshot): Record<string, unknown> {
  const items = cpq.billOfMaterials?.items ?? [];
  const { metaCalcConfigurationName, metaCalcConfigurationPayload } =
    buildMetaCalcConfigurationPayloadFromCpqBom(items);

  const lines: string[] = [];
  if (cpq.systemName) lines.push(`System: ${cpq.systemName}`);
  if (cpq.systemId) lines.push(`System-ID: ${cpq.systemId}`);
  if (cpq.cpqConfigurationId) lines.push(`Gespeicherte Konfiguration: ${cpq.cpqConfigurationId}`);
  const description =
    lines.length > 0
      ? `${metaCalcConfigurationPayload.description}\n\n${lines.join("\n")}`
      : metaCalcConfigurationPayload.description;

  return {
    metaCalcConfigurationName,
    metaCalcConfigurationPayload: {
      ...metaCalcConfigurationPayload,
      description,
    },
    metaCalcInstallationTime: 0,
  };
}

export function isOfferShippingLineItem(item: { type?: string | null }): boolean {
  const t = String(item?.type || "").toLowerCase();
  return t === "shipping" || t === "delivery" || t === "shipping_charge";
}

/**
 * Erste Produktzeile des gemappten Angebots mit CPQ-MetaCalc-Payload anreichern (Kopie des Mapped-Objekts).
 */
export function enrichMappedOfferItemsWithCpqPayload(
  items: any[] | undefined,
  cpq: CpqSourceSnapshot
): any[] {
  const list = Array.isArray(items) ? [...items] : [];
  const productIndices: number[] = [];
  for (let i = 0; i < list.length; i++) {
    if (!isOfferShippingLineItem(list[i])) productIndices.push(i);
  }
  if (productIndices.length === 0) return list;

  const payload = buildShopwareLinePayloadFromCpqSource(cpq);
  const targetIdx = productIndices[0];
  const row = list[targetIdx];
  list[targetIdx] = {
    ...row,
    payload: {
      ...(row?.payload && typeof row.payload === "object" ? row.payload : {}),
      ...payload,
    },
  };
  return list;
}
