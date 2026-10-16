/**
 * Artikel der Branchenseiten aus einem Shop lesen (ID, Netto-Preis, Bild, Lieferzeit, URL) – gemeinsam fuer
 * scripts/writeIndustryPages.ts und die Vorschau der Pflegeoberflaeche Shop-Inhalte. Nur lesend.
 */
import type { ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "../shopware/shopware";
import type { IndustryShopProduct } from "../products/industryPageHtml";

export const DE_CHANNEL_NAME = "META Regalbau DE";
export const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";

export type ShopApi = (method: string, path: string, body?: unknown) => Promise<any>;

/** Admin-API eines Shops (Sprache Deutsch); Fehler ab Status 300 mit gekuerzter Antwort */
export function shopApi(settings: ShopwareSettings): { api: ShopApi; base: string; isTest: boolean } {
  const client = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  const api: ShopApi = async (method, path, body) => {
    const r = await client.makeAuthenticatedRequest(`${base}/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json", "sw-language-id": DE_LANG },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${txt.slice(0, 400)}`);
    return txt ? JSON.parse(txt) : null;
  };
  return { api, base, isTest: /\/\/test\./.test(base) };
}

export type DeChannel = { id: string; name: string; navigationCategoryId?: string; homeCmsPageId?: string | null; domain: string };

/** Verkaufskanal META Regalbau DE und seine Storefront-Adresse */
export async function findDeChannel(api: ShopApi, base: string): Promise<DeChannel> {
  const channels = await api("POST", "search/sales-channel", {
    limit: 50,
    associations: { domains: {} },
    includes: { sales_channel: ["id", "name", "domains", "navigationCategoryId", "homeCmsPageId"], sales_channel_domain: ["url"] },
  });
  const de = channels.data.find((c: any) => c.name === DE_CHANNEL_NAME);
  if (!de) throw new Error(`Verkaufskanal ${DE_CHANNEL_NAME} fehlt`);
  const domain = ((de.domains ?? []).map((d: any) => d.url).find((u: string) => /shop\.meta-online\.com|test\./.test(u)) ?? base).replace(/\/$/, "");
  return { id: de.id, name: de.name, navigationCategoryId: de.navigationCategoryId, homeCmsPageId: de.homeCmsPageId, domain };
}

/**
 * Artikel nach Artikelnummer; `problems` nennt fehlende, im DE-Kanal nicht aktive und Artikel ohne Preis
 * (das Schreibskript bricht dann ab, die Vorschau zeigt sie als Fehler).
 */
export async function loadIndustryShopProducts(
  api: ShopApi,
  numbers: string[],
  de: Pick<DeChannel, "id" | "domain">,
): Promise<{ products: Record<string, IndustryShopProduct>; problems: Array<{ number: string; problem: "missing" | "inactive" | "noPrice" }> }> {
  const found = await api("POST", "search/product", {
    limit: numbers.length + 10,
    filter: [{ type: "equalsAny", field: "productNumber", value: numbers }],
    associations: { cover: { associations: { media: {} } }, seoUrls: {}, deliveryTime: {}, visibilities: {} },
    includes: {
      product: ["id", "productNumber", "name", "translated", "price", "cover", "seoUrls", "deliveryTime", "active", "visibilities"],
      product_media: ["media"],
      media: ["url"],
      seo_url: ["seoPathInfo", "isCanonical", "isDeleted", "salesChannelId", "languageId"],
      delivery_time: ["name", "translated"],
      product_visibility: ["salesChannelId"],
    },
  });
  const products: Record<string, IndustryShopProduct> = {};
  const problems: Array<{ number: string; problem: "missing" | "inactive" | "noPrice" }> = [];
  for (const x of found.data ?? []) {
    const seo = (x.seoUrls ?? []).find((u: any) => u.salesChannelId === de.id && u.languageId === DE_LANG && u.isCanonical && !u.isDeleted);
    const net = x.price?.[0]?.net;
    if (!x.active || !(x.visibilities ?? []).some((v: any) => v.salesChannelId === de.id)) problems.push({ number: x.productNumber, problem: "inactive" });
    if (typeof net !== "number") problems.push({ number: x.productNumber, problem: "noPrice" });
    products[x.productNumber] = {
      id: x.id,
      name: x.translated?.name ?? x.name,
      priceNet: net,
      deliveryTime: x.deliveryTime?.translated?.name ?? x.deliveryTime?.name,
      url: seo ? `${de.domain}/${seo.seoPathInfo}` : `${de.domain}/detail/${x.id}`,
      image: x.cover?.media?.url ?? null,
    };
  }
  for (const n of numbers) if (!products[n]) problems.push({ number: n, problem: "missing" });
  return { products, problems };
}

export const productProblemText = (p: { number: string; problem: "missing" | "inactive" | "noPrice" }) =>
  p.problem === "missing" ? `${p.number}: fehlt im Shop` : p.problem === "inactive" ? `${p.number}: nicht aktiv im Kanal ${DE_CHANNEL_NAME}` : `${p.number}: kein Preis`;
