/**
 * Shop-Puls Stufe 3 (S3-5), Prüfungen zur Ladezeit (Regeln in ../pageSpeed.ts):
 *
 * - pageWeight: einmal am Tag die Startseite der Storefront laden (unter der Sperre des Shop-Wächters) und die
 *   Bytes in HTML-Kommentaren zählen (Audit-Befund 1,3 MB Template-Kommentare). Braucht keinen Schlüssel.
 * - pageSpeed: einmal am Tag je Seitentyp eine PageSpeed-Insights-Messung (mobil), Verlauf in den Einstellungen;
 *   nach einem Deploy Vorher/Nachher. Ohne API-Schlüssel setzt sie aus (skipped "speed"). Die Messungen ruft
 *   Google ab, nicht METAorder; sie laufen nacheinander und ohne die Shop-Sperre.
 */
import { addToHistory, commentDetections, htmlCommentBytes, PAGE_TYPES, speedDetections, speedSetupProblem, SpeedNotConfiguredError, type PageSpeedSettings, type PageType, type SpeedHistory, type SpeedMeasurement } from "../pageSpeed";
import { berlinTime } from "../pulseOrders";
import { StorefrontSession } from "../storefront";
import { isSellable } from "./buyability";
import { isGa4DailyDue } from "./ga4";
import type { ShopPulseDetector } from "./types";

export type SpeedSources = {
  settings(): Promise<PageSpeedSettings>;
  history(): Promise<SpeedHistory>;
  saveHistory(history: SpeedHistory): Promise<void>;
  /** letzter vom Shop-Wächter erkannter Deploy (Shopware-Version/Plugins) in den letzten 14 Tagen */
  lastDeploy(): Promise<{ at: string; changes: string } | null>;
  measure(apiKey: string, type: PageType, url: string): Promise<SpeedMeasurement>;
};

export const pageWeightDetector: ShopPulseDetector = {
  id: "pageWeight",
  source: "system",
  keyPrefix: "system:html-comments:",
  due: isGa4DailyDue,
  async run(ctx) {
    const page = await ctx.storefront.withShop(async (shop) => {
      const session = new StorefrontSession(shop.storefront, shop.fetchImpl);
      const res = await session.get("/");
      return { status: res.status, html: res.html };
    });
    if (page.status !== 200) throw new Error(`Startseite antwortet mit Status ${page.status}`);
    return commentDetections("/", htmlCommentBytes(page.html));
  },
};

export const pageSpeedDetector: ShopPulseDetector = {
  id: "pageSpeed",
  source: "system",
  keyPrefix: "system:speed:",
  due: isGa4DailyDue,
  async run(ctx) {
    const settings = await ctx.speed.settings();
    const problem = speedSetupProblem(settings);
    if (problem) throw new SpeedNotConfiguredError(problem);
    const base = await ctx.storefront.withShop(async (shop) => shop.storefront.replace(/\/+$/, ""));
    // Produktseite: fester Pfad aus den Einstellungen, sonst der umsatzstärkste kaufbare Artikel
    let productPath = settings.paths.product;
    if (!productPath) {
      const [products, revenue] = await Promise.all([ctx.buyability.products(), ctx.buyability.revenue()]);
      const top = products
        .filter((p) => p.id && !p.isVariant && !p.isTechnical && !(p.childCount ?? 0) && isSellable(p))
        .sort((a, b) => (revenue.get(b.productNumber) ?? 0) - (revenue.get(a.productNumber) ?? 0))[0];
      productPath = top?.id ? `/detail/${top.id}` : "";
    }
    const results: SpeedMeasurement[] = [];
    for (const type of PAGE_TYPES) {
      const path = type === "product" ? productPath : settings.paths[type];
      if (!path) continue;
      results.push(await ctx.speed.measure(settings.apiKey, type, `${base}${path.startsWith("/") ? path : `/${path}`}`));
    }
    if (results.length && results.every((r) => r.error)) throw new Error(`PageSpeed: ${results[0].error}`);
    const history = addToHistory(await ctx.speed.history(), { day: berlinTime(ctx.now).day, at: ctx.now.toISOString(), results });
    await ctx.speed.saveHistory(history);
    return speedDetections(history, await ctx.speed.lastDeploy());
  },
};
