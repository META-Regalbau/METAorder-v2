/**
 * Shop-Puls, Storefront wie ein Kunde (PR D): Gast-Sitzung mit Cookies für die Warenkorb-Probe und
 * Auswertung der Shop-Seiten (Produktseite, Suche, Warenkorb, Kasse). Ohne JavaScript, per HTTP, mit dem
 * User-Agent und der Zeitüberschreitung des Shop-Wächters. Tests in tests/unit/shopPulseStorefront.test.ts.
 *
 * Die Sitzung bestellt nie: Bestellung abschicken, Konto anlegen und Anmelden sind gesperrt.
 */
import { FETCH_TIMEOUT_MS, USER_AGENT, type FetchLike } from "../shopContent/shopWatch";
import { normalizeText } from "../shopContent/shopWatchChecks";

export type StorefrontResponse = { status: number; html: string; location: string | null; url: string };

/** Pfade, die die Probe nie aufruft (Bestellung, Konto, Anmeldung, Zahlung) */
const FORBIDDEN_POST = /\/(checkout\/order|account\/register|account\/login|checkout\/configure|payment)/;
const MAX_REDIRECTS = 5;

/**
 * Gast-Sitzung gegen die Storefront: merkt sich die Cookies (u. a. „session-“) über alle Abrufe und folgt
 * Weiterleitungen selbst, damit die Cookies jeder Zwischenantwort erhalten bleiben.
 */
export class StorefrontSession {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly base: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private abs(p: string): string {
    return /^https?:/.test(p) ? p : `${this.base}${p.startsWith("/") ? p : `/${p}`}`;
  }

  private remember(r: Response): void {
    const h = r.headers as Headers & { getSetCookie?: () => string[] };
    const list = typeof h.getSetCookie === "function" ? h.getSetCookie() : (h.get("set-cookie") ?? "").split(/,(?=\s*[^;,=\s]+=)/);
    for (const c of list) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      // Max-Age=0 bzw. abgelaufen: Cookie löschen
      if (/max-age=0(?:;|$)/i.test(c) || value === "deleted" || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  hasCookie(prefix: string): boolean {
    return Array.from(this.cookies.keys()).some((k) => k.startsWith(prefix));
  }

  private async request(method: "GET" | "POST", url: string, body?: URLSearchParams): Promise<Response> {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "text/html,*/*" };
    if (this.cookies.size) headers.Cookie = this.cookieHeader;
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const r = await this.fetchImpl(url, { method, headers, body: body?.toString(), redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    this.remember(r);
    return r;
  }

  private async read(r: Response, url: string): Promise<StorefrontResponse> {
    const location = r.headers.get("location");
    const redirect = r.status >= 300 && r.status < 400;
    const html = redirect ? "" : await r.text();
    if (redirect) await r.body?.cancel().catch(() => undefined);
    return { status: r.status, html, location, url };
  }

  /** Seite abrufen; follow: Weiterleitungen folgen (höchstens 5), manual: die Weiterleitung selbst liefern */
  async get(path: string, opts: { redirect?: "follow" | "manual" } = {}): Promise<StorefrontResponse> {
    let url = this.abs(path);
    for (let hop = 0; ; hop++) {
      const res = await this.read(await this.request("GET", url), url);
      if (opts.redirect === "manual" || !res.location || res.status < 300 || res.status >= 400 || hop >= MAX_REDIRECTS) return res;
      url = new URL(res.location, url).toString();
    }
  }

  /** Formular abschicken (ohne Weiterleitung zu folgen); Bestellung, Konto und Anmeldung sind gesperrt */
  async post(path: string, form: Record<string, string>): Promise<StorefrontResponse> {
    if (FORBIDDEN_POST.test(path)) throw new Error(`Storefront-Probe: ${path} ist gesperrt`);
    const url = this.abs(path);
    return this.read(await this.request("POST", url, new URLSearchParams(form)), url);
  }
}

// ---------------------------------------------------------------------------------------------
// Auswertung der Seiten

/** „1.234,56 €“ → 1234.56; null ohne Betrag */
export function parseMoney(text: string): number | null {
  const m = normalizeText(text).match(/(-?\d{1,3}(?:\.\d{3})*|-?\d+)(?:,(\d{1,2}))?\s*€/);
  if (!m) return null;
  return Number(`${m[1].replace(/\./g, "")}.${m[2] ?? "0"}`);
}

/** Twig-Kommentare entfernen (Live-Seiten enthalten davon über 1 MB, siehe SEO-Audit 16.10.2026) */
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

export type ProductPageInfo = {
  /** Shopware-ID laut itemprop="productID" */
  productId: string | null;
  /** Artikelnummer laut itemprop="sku" */
  productNumber: string | null;
  /** Kaufformular /checkout/line-item/add mit Kaufknopf */
  buyForm: boolean;
  /** angezeigter Preis (Meta product:price:amount bzw. itemprop="price") */
  price: number | null;
  /** schema.org-Verfügbarkeit, z. B. "InStock" */
  availability: string | null;
  /** „nicht verfügbar“ bzw. ausverkauft angezeigt */
  unavailable: boolean;
};

export function parseProductPage(raw: string): ProductPageInfo {
  const html = stripComments(raw);
  const attr = (re: RegExp) => html.match(re)?.[1]?.trim() ?? null;
  // nur der Preis des Artikels selbst, nicht der Preis einer Kachel im Crossselling-Slider
  const priceText =
    attr(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/) ??
    attr(/product-detail-price-container[\s\S]{0,400}?itemprop="price"[^>]+content="([^"]+)"/);
  const price = priceText !== null && priceText !== "" && !Number.isNaN(Number(priceText)) ? Number(priceText) : null;
  const form = html.match(/<form[^>]+action="[^"]*\/checkout\/line-item\/add"[^>]*>([\s\S]*?)<\/form>/);
  const buyForm = !!form && /btn-buy/.test(form[1]) && !/<button[^>]*btn-buy[^>]*disabled/.test(form[1]);
  const availability = attr(/itemprop="availability"[^>]+href="https?:\/\/schema\.org\/(\w+)"/);
  const deliveryClass = attr(/class="delivery-information ([^"]*)"/) ?? "";
  const unavailable =
    /delivery-(?:not-available|soldout)/.test(deliveryClass) || (availability !== null && /OutOfStock|SoldOut|Discontinued/.test(availability));
  return {
    productId: attr(/itemprop="productID"[^>]+content="([0-9a-f]{32})"/),
    productNumber: attr(/itemprop="sku"[^>]*>\s*([^<]+?)\s*</),
    buyForm,
    price,
    availability,
    unavailable,
  };
}

/** Anzahl der Treffer einer Suchergebnisseite (Produktkacheln) */
export function searchHits(raw: string): number {
  return (stripComments(raw).match(/class="card product-box/g) ?? []).length;
}

export type CartInfo = { hasProduct: boolean; price: number | null; empty: boolean };

/** Warenkorb: Position des Artikels (Löschen-Formular bzw. Link mit seiner ID) und ihr Preis */
export function parseCart(raw: string, productId: string): CartInfo {
  const html = stripComments(raw);
  const ROW = 'class="line-item line-item-product';
  const at = html.indexOf(`/checkout/line-item/delete/${productId}`);
  const empty = !html.includes(ROW);
  if (at < 0) return { hasProduct: false, price: null, empty };
  // Position: der Abschnitt der Zeile um das Löschen-Formular
  const start = html.lastIndexOf(ROW, at);
  const end = html.indexOf(ROW, at);
  const row = html.slice(start >= 0 ? start : Math.max(0, at - 20_000), end >= 0 ? end : at + 20_000);
  const priceHtml = row.match(/line-item-total-price-value[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? row.match(/line-item-price[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  return { hasProduct: true, price: parseMoney(priceHtml.replace(/<[^>]*>/g, " ")), empty };
}

/** Anmelde-/Registrierungsseite der Kasse: Formular für Anmeldung oder Registrierung */
export function isLoginPage(raw: string): boolean {
  const html = stripComments(raw);
  return /action="[^"]*\/account\/login"/.test(html) || /action="[^"]*\/account\/register"/.test(html);
}
