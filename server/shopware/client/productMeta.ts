// Shopware: Meta-Title und Meta-Description der Artikel lesen und schreiben (Systemsprache).
// Gelesen wird wirksam (sw-inheritance), damit Varianten die Texte des Hauptprodukts sehen.
import type { ShopwareClient } from "../shopware";

// Defaults::LANGUAGE_SYSTEM. Nicht exportieren: alle Exporte dieses Moduls landen als Methoden
// am ShopwareClient.
const SYSTEM_LANGUAGE_ID = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";
const PAGE_SIZE = 250;
const SYNC_CHUNK = 100;

export type ProductMetaSource = {
  id: string;
  productNumber: string;
  active: boolean;
  /** In mindestens einem Verkaufskanal sichtbar */
  visible: boolean;
  name: string;
  /** Beschreibung als HTML, wie in Shopware gespeichert */
  description: string;
  properties: Array<{ group: string; option: string }>;
  metaTitle: string | null;
  metaDescription: string | null;
  customFields: Record<string, unknown> | null;
};

export type ProductDescriptionUpdate = {
  id: string;
  description: string;
  customFields: Record<string, unknown>;
};

export type ProductMetaUpdate = {
  id: string;
  metaTitle?: string;
  metaDescription?: string;
  customFields: Record<string, unknown>;
};

const languageHeaders = { "sw-language-id": SYSTEM_LANGUAGE_ID, "sw-inheritance": "1" };

/** Alle aktiven Artikel mit Name, Beschreibung, Eigenschaften und Meta-Texten. */
export async function fetchProductMetaSources(this: ShopwareClient): Promise<ProductMetaSource[]> {
  const out: ProductMetaSource[] = [];
  for (let page = 1; ; page++) {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...languageHeaders },
      body: JSON.stringify({
        page,
        limit: PAGE_SIZE,
        sort: [{ field: "id", order: "ASC" }],
        filter: [{ type: "equals", field: "active", value: true }],
        associations: { properties: { associations: { group: {} } }, visibilities: {} },
        includes: {
          product: ["id", "productNumber", "active", "translated", "properties", "visibilities"],
          property_group_option: ["name", "translated", "group"],
          property_group: ["name", "translated"],
          product_visibility: ["salesChannelId"],
        },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch products for meta texts: ${response.status} - ${errorText.slice(0, 300)}`);
    }
    const data = await response.json();
    const rows: any[] = data.data || [];
    for (const r of rows) {
      const tr = r.translated ?? {};
      out.push({
        id: String(r.id),
        productNumber: String(r.productNumber ?? ""),
        active: Boolean(r.active),
        visible: Array.isArray(r.visibilities) && r.visibilities.length > 0,
        name: String(tr.name ?? "").trim(),
        description: String(tr.description ?? ""),
        properties: (r.properties ?? [])
          .map((o: any) => ({
            group: String(o.group?.translated?.name ?? o.group?.name ?? "").trim(),
            option: String(o.translated?.name ?? o.name ?? "").trim(),
          }))
          .filter((p: { group: string; option: string }) => p.group && p.option),
        metaTitle: tr.metaTitle ?? null,
        metaDescription: tr.metaDescription ?? null,
        customFields: tr.customFields && typeof tr.customFields === "object" ? tr.customFields : null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Schreibt Meta-Texte per Sync-API (Systemsprache), in Bloecken zu 100. */
export async function syncProductMetaTexts(this: ShopwareClient, updates: ProductMetaUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += SYNC_CHUNK) {
    const chunk = updates.slice(i, i + SYNC_CHUNK);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "sw-language-id": SYSTEM_LANGUAGE_ID },
      body: JSON.stringify({ "product-meta-texts": { entity: "product", action: "upsert", payload: chunk } }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to sync product meta texts: ${response.status} - ${errorText.slice(0, 300)}`);
    }
  }
}

/** Schreibt Produktbeschreibungen (HTML) per Sync-API in der Systemsprache, in Bloecken zu 50. */
export async function syncProductDescriptions(this: ShopwareClient, updates: ProductDescriptionUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "sw-language-id": SYSTEM_LANGUAGE_ID },
      body: JSON.stringify({ "product-descriptions": { entity: "product", action: "upsert", payload: chunk } }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to sync product descriptions: ${response.status} - ${errorText.slice(0, 300)}`);
    }
  }
}
