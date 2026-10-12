/**
 * Zusatzfelder des Shops für Bestellungen (nur lesend): Welche Felder gibt es an Bestellung,
 * Position, Lieferung, Kunde – und wie füllen echte Portal-Bestellungen sie? Grundlage für die
 * konfigurierbare Übergabe von Entwurfsdaten in die Shopware-Bestellung.
 */
import type { ShopwareClient } from "./shopware";

type Searcher = { baseUrl: string; makeAuthenticatedRequest: (url: string, init: RequestInit) => Promise<Response> };

async function search(client: Searcher, entity: string, body: Record<string, unknown>): Promise<any[]> {
  const res = await client.makeAuthenticatedRequest(`${client.baseUrl}/api/search/${entity}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []).map((d: any) => ({ id: d.id, ...(d.attributes ?? d) }));
}

export const ORDER_FIELD_ENTITIES = ["order", "order_line_item", "order_delivery", "customer"] as const;

export type CatalogField = {
  entity: string;
  set: string;
  setLabel: string | null;
  name: string;
  type: string;
  label: string | null;
  helpText: string | null;
  options: string[] | null;
  /** Beispielwerte aus den letzten Portal-Bestellungen (nur Bestellung/Position) */
  samples: unknown[];
  /** In wie vielen der geprüften Bestellungen gefüllt */
  filledIn: number;
};

export async function buildCustomFieldCatalog(shopware: ShopwareClient, opts: { sampleOrders?: number } = {}) {
  const client = shopware as unknown as Searcher;
  const relations = await search(client, "custom-field-set-relation", { limit: 500 });
  const setIdsByEntity = new Map<string, string[]>();
  for (const r of relations) setIdsByEntity.set(r.entityName, [...(setIdsByEntity.get(r.entityName) ?? []), r.customFieldSetId]);

  const fields: CatalogField[] = [];
  for (const entity of ORDER_FIELD_ENTITIES) {
    const ids = setIdsByEntity.get(entity) ?? [];
    if (!ids.length) continue;
    const sets = await search(client, "custom-field-set", { ids, limit: 50 });
    for (const set of sets) {
      const setFields = await search(client, "custom-field", { limit: 200, filter: [{ type: "equals", field: "customFieldSetId", value: set.id }] });
      for (const f of setFields) {
        fields.push({
          entity,
          set: set.name,
          setLabel: set.config?.label?.["de-DE"] ?? set.config?.label?.["en-GB"] ?? null,
          name: f.name,
          type: f.type,
          label: f.config?.label?.["de-DE"] ?? f.config?.label?.["en-GB"] ?? null,
          helpText: f.config?.helpText?.["de-DE"] ?? null,
          options: Array.isArray(f.config?.options) ? f.config.options.map((o: any) => String(o.value)) : null,
          samples: [],
          filledIn: 0,
        });
      }
    }
  }

  // Wie füllen echte Portal-Bestellungen die Felder?
  const orders = await search(client, "order", {
    limit: Math.min(Math.max(opts.sampleOrders ?? 30, 1), 100),
    sort: [{ field: "orderDateTime", order: "DESC" }],
    filter: [{ type: "contains", field: "salesChannel.name", value: "Portal" }],
    associations: { lineItems: {} },
    includes: { order: ["id", "orderNumber", "customFields", "customerComment", "affiliateCode", "campaignCode", "lineItems"], order_line_item: ["customFields", "payload"] },
  });
  const byKey = new Map(fields.map((f) => [`${f.entity}:${f.name}`, f]));
  const unknownOrderKeys = new Map<string, { filledIn: number; samples: unknown[] }>();
  const note = (entity: string, key: string, value: unknown) => {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
    const f = byKey.get(`${entity}:${key}`);
    const target = f ?? (unknownOrderKeys.get(`${entity}:${key}`) ?? (unknownOrderKeys.set(`${entity}:${key}`, { filledIn: 0, samples: [] }).get(`${entity}:${key}`)!));
    target.filledIn += 1;
    if (target.samples.length < 3) target.samples.push(typeof value === "string" ? value.slice(0, 120) : value);
  };
  for (const o of orders) {
    for (const [k, v] of Object.entries(o.customFields ?? {})) note("order", k, v);
    for (const l of o.lineItems ?? []) for (const [k, v] of Object.entries(l.customFields ?? {})) note("order_line_item", k, v);
  }
  const extensions = orders.length
    ? await search(client, "b2bsellers-order-extension", { limit: 100, filter: [{ type: "equalsAny", field: "orderId", value: orders.map((o) => o.id) }] })
    : [];
  const extensionFields = new Map<string, { filledIn: number; samples: unknown[] }>();
  for (const e of extensions) {
    for (const [k, v] of Object.entries(e)) {
      if (/^(id|_uniqueIdentifier|versionId|apiAlias|createdAt|updatedAt|orderId|orderVersionId|translated|extensions)$/.test(k)) continue;
      if (v == null || v === "") continue;
      const t = extensionFields.get(k) ?? { filledIn: 0, samples: [] };
      t.filledIn += 1;
      if (t.samples.length < 3) t.samples.push(typeof v === "string" ? v.slice(0, 120) : v);
      extensionFields.set(k, t);
    }
  }

  return {
    checkedOrders: orders.length,
    fields,
    /** In Bestellungen gefüllt, aber ohne Feld-Definition (z. B. von Plugins geschrieben) */
    undefinedButUsed: [...unknownOrderKeys.entries()].map(([key, v]) => ({ key, ...v })),
    b2bOrderExtension: [...extensionFields.entries()].map(([field, v]) => ({ field, ...v })),
  };
}
