// Shopware: Produktbilder - Zuordnung Produkt/Bild, Bildtexte (ALT/TITLE) lesen und schreiben.
// Gelesen und geschrieben wird immer in der Systemsprache; ohne eigene Uebersetzung greifen
// alle anderen Sprachen darauf zurueck.
import type { ShopwareClient } from "../shopware";

// Defaults::LANGUAGE_SYSTEM - in jedem Shopware 6 dieselbe ID. Nicht exportieren: alle Exporte
// dieses Moduls landen als Methoden am ShopwareClient.
const SHOPWARE_SYSTEM_LANGUAGE_ID = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";

const PAGE_SIZE = 500;
const SYNC_CHUNK = 200;

export type ProductImageLink = { productId: string; mediaId: string; position: number };
export type ProductImageProduct = { id: string; productNumber: string; name: string };
export type MediaTexts = {
  id: string;
  fileName: string;
  alt: string | null;
  title: string | null;
  customFields: Record<string, unknown> | null;
};
export type MediaTextsUpdate = {
  id: string;
  alt?: string;
  title?: string;
  customFields: Record<string, unknown>;
};

async function searchAllPages(client: ShopwareClient, entityPath: string, criteria: Record<string, unknown>, headers: Record<string, string> = {}): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const response = await client.makeAuthenticatedRequest(`${client.baseUrl}/api/search/${entityPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ ...criteria, page, limit: PAGE_SIZE }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to search ${entityPath}: ${response.status} - ${errorText.slice(0, 300)}`);
    }
    const data = await response.json();
    const rows: any[] = data.data || [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Alle Zuordnungen Produkt -> Bild (product_media). */
export async function fetchProductImageLinks(this: ShopwareClient): Promise<ProductImageLink[]> {
  const rows = await searchAllPages(this, "product-media", {
    sort: [{ field: "id", order: "ASC" }],
    includes: { product_media: ["id", "productId", "mediaId", "position"] },
  });
  return rows
    .filter((r) => r.productId && r.mediaId)
    .map((r) => ({ productId: String(r.productId), mediaId: String(r.mediaId), position: Number(r.position) || 0 }));
}

/** Produktnummer und wirksamer Name (Varianten erben vom Hauptprodukt) in der Systemsprache. */
export async function fetchProductImageProducts(this: ShopwareClient): Promise<ProductImageProduct[]> {
  const rows = await searchAllPages(
    this,
    "product",
    {
      sort: [{ field: "id", order: "ASC" }],
      includes: { product: ["id", "productNumber", "name", "translated"] },
    },
    { "sw-inheritance": "1", "sw-language-id": SHOPWARE_SYSTEM_LANGUAGE_ID },
  );
  return rows.map((r) => ({
    id: String(r.id),
    productNumber: String(r.productNumber ?? ""),
    name: String(r.translated?.name ?? r.name ?? "").trim(),
  }));
}

/** Bildtexte in der Systemsprache, in Bloecken zu 500 IDs. */
export async function fetchMediaTexts(this: ShopwareClient, ids: string[]): Promise<MediaTexts[]> {
  const out: MediaTexts[] = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const chunk = ids.slice(i, i + PAGE_SIZE);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "sw-language-id": SHOPWARE_SYSTEM_LANGUAGE_ID },
      body: JSON.stringify({
        ids: chunk,
        limit: chunk.length,
        includes: { media: ["id", "fileName", "alt", "title", "customFields"] },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch media texts: ${response.status} - ${errorText.slice(0, 300)}`);
    }
    const data = await response.json();
    for (const r of data.data || []) {
      out.push({
        id: String(r.id),
        fileName: String(r.fileName ?? ""),
        alt: r.alt ?? null,
        title: r.title ?? null,
        customFields: r.customFields && typeof r.customFields === "object" ? r.customFields : null,
      });
    }
  }
  return out;
}

/** Schreibt Bildtexte per Sync-API (Systemsprache), in Bloecken zu 200. */
export async function syncMediaTexts(this: ShopwareClient, updates: MediaTextsUpdate[]): Promise<void> {
  for (let i = 0; i < updates.length; i += SYNC_CHUNK) {
    const chunk = updates.slice(i, i + SYNC_CHUNK);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "sw-language-id": SHOPWARE_SYSTEM_LANGUAGE_ID },
      body: JSON.stringify({ "media-texts": { entity: "media", action: "upsert", payload: chunk } }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to sync media texts: ${response.status} - ${errorText.slice(0, 300)}`);
    }
  }
}
