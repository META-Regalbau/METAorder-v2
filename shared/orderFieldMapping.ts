/**
 * Übergabe von Entwurfsdaten in die Zusatzfelder der Shopware-Bestellung (Entscheidung 12.10.2026).
 *
 * Das Portal (B2B Sellers) füllt Kommission, Anmerkung, AB-Empfänger, Besteller usw. in eigene
 * Zusatzfelder; Bestellungen aus METAorder hatten all das bisher nur im Kundenkommentar. Je Quelle
 * ist einstellbar, in welche Felder der Wert geht („nicht übergeben“ = keine Ziele). Zeigen mehrere
 * Quellen auf dasselbe Feld, werden die Werte in der Reihenfolge der Quellen mit „ / “ verbunden –
 * so steht die Kundenbestellnummer vorne im Kommissionstext.
 *
 * Felder, die das ERP/SAP schreibt, sind gesperrt (siehe BLOCKED_ORDER_FIELD_RE).
 */

export const ORDER_FIELD_MAPPING_SETTING_KEY = "shopware.orderFieldMapping";

/** Feld der Lieferung (Standard, kein Zusatzfeld): Wunschtermin als Liefer-Zeitraum */
export const DELIVERY_DATE_TARGET = "@shippingDate";

export type OrderFieldScope = "order" | "order_line_item" | "order_delivery";

export const ORDER_FIELD_SOURCES = [
  "customerOrderNumber",
  "commission",
  "customerReference",
  "notes",
  "confirmationEmail",
  "invoiceEmail",
  "offer",
  "orderer",
  "salesRepresentative",
  "deliveryDate",
  "lineCustomerText",
] as const;
export type OrderFieldSource = (typeof ORDER_FIELD_SOURCES)[number];

/** Wohin eine Quelle zeigen darf */
export const ORDER_FIELD_SOURCE_SCOPE: Record<OrderFieldSource, OrderFieldScope> = {
  customerOrderNumber: "order",
  commission: "order",
  customerReference: "order",
  notes: "order",
  confirmationEmail: "order",
  invoiceEmail: "order",
  offer: "order",
  orderer: "order",
  salesRepresentative: "order",
  deliveryDate: "order_delivery",
  lineCustomerText: "order_line_item",
};

export type OrderFieldTarget = {
  field: string;
  /** Shopware-Feldtyp (text, json, int …) – bestimmt die Form des Werts */
  type: string;
};

export type OrderFieldMappingSettings = {
  enabled: boolean;
  targets: Record<OrderFieldSource, OrderFieldTarget[]>;
};

export const DEFAULT_ORDER_FIELD_MAPPING: OrderFieldMappingSettings = {
  enabled: true,
  targets: {
    customerOrderNumber: [
      { field: "custom_buyerreference_invoice", type: "text" },
      { field: "b2b_order_customer_commission", type: "text" },
    ],
    commission: [{ field: "b2b_order_customer_commission", type: "text" }],
    customerReference: [],
    notes: [{ field: "b2b_order_customer_note", type: "text" }],
    confirmationEmail: [{ field: "b2b_order_mail_recipients", type: "json" }],
    invoiceEmail: [{ field: "custom_invoice_email_address", type: "text" }],
    offer: [{ field: "b2bsellers_offer_id", type: "text" }],
    orderer: [{ field: "b2b_order_customer_employee_id", type: "text" }],
    salesRepresentative: [{ field: "b2b_order_sales_representative_id", type: "text" }],
    deliveryDate: [{ field: DELIVERY_DATE_TARGET, type: "datetime" }],
    lineCustomerText: [{ field: "b2b_order_line_item_comment", type: "text" }],
  },
};

/** Vom ERP/SAP bzw. OBX-Import geschrieben – METAorder fasst sie nie an */
export const BLOCKED_ORDER_FIELD_RE = /^(custom_order_numbers_|wdu_sap_|wdu_obx_)/;

const FIELD_NAME_RE = /^[A-Za-z][\w-]{1,80}$/;

function normalizeTargets(raw: unknown, fallback: OrderFieldTarget[]): OrderFieldTarget[] {
  if (!Array.isArray(raw)) return fallback;
  const seen = new Set<string>();
  const out: OrderFieldTarget[] = [];
  for (const t of raw) {
    const field = typeof (t as OrderFieldTarget)?.field === "string" ? (t as OrderFieldTarget).field.trim() : "";
    if (!field || seen.has(field)) continue;
    if (field !== DELIVERY_DATE_TARGET && (!FIELD_NAME_RE.test(field) || BLOCKED_ORDER_FIELD_RE.test(field))) continue;
    const type = typeof (t as OrderFieldTarget)?.type === "string" && (t as OrderFieldTarget).type.trim() ? (t as OrderFieldTarget).type.trim() : "text";
    seen.add(field);
    out.push({ field, type });
  }
  return out.slice(0, 5);
}

export function normalizeOrderFieldMapping(raw: unknown): OrderFieldMappingSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<OrderFieldMappingSettings>;
  const targets = {} as OrderFieldMappingSettings["targets"];
  for (const source of ORDER_FIELD_SOURCES) {
    const list = normalizeTargets(r.targets?.[source], DEFAULT_ORDER_FIELD_MAPPING.targets[source]);
    // Wunschtermin nur ins Standardfeld der Lieferung; die anderen Quellen nie dorthin
    targets[source] =
      source === "deliveryDate"
        ? list.filter((t) => t.field === DELIVERY_DATE_TARGET)
        : list.filter((t) => t.field !== DELIVERY_DATE_TARGET);
  }
  return { enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_ORDER_FIELD_MAPPING.enabled, targets };
}
