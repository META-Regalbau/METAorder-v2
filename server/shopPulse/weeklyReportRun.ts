/**
 * Shop-Puls Stufe 2 (S2-1): Wochenbericht bauen und speichern. Der Zeitplan (shopPulseScheduler.ts) ruft ihn
 * montags statt des Tagesberichts auf und schickt ihn danach über Teams und die Glocke; „Jetzt erstellen“ auf
 * der Seite baut ihn ohne zu senden. Datenquellen sind austauschbar (Tests in tests/unit/shopPulseWeekly.test.ts).
 *
 * Nur lesend aus der eigenen Datenbank: Bestell- und Produktspiegel, Herstellpreise, Maßnahmen-Protokoll,
 * B2B-Firmen-Spiegel (B2B-Anteil, S2-2); GA4 nur, wenn eingerichtet (zwei Abfragen nacheinander); Google Ads
 * nur, wenn eingerichtet (eine Abfrage je Konto, S2-4).
 */
import { and, eq, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import { shopwareB2bCompanies, shopwareProducts } from "@shared/schema";
import type { ShopPulseLossEstimate, ShopPulseSignal } from "@shared/shopPulse";
import type { ShopPulseActionEffect, ShopPulseWeeklyEffect } from "@shared/shopPulseEffects";
import type { ShopPulseWeeklyAds, ShopPulseWeeklyGsc, ShopPulseWeeklyCustomerMails } from "@shared/shopPulseWeekly";
import type { ShopPulseAction, ShopPulseB2bShare, ShopPulseWeeklyNumbers, ShopPulseWeeklyReport, ShopPulseWeeklyReportData } from "@shared/shopPulseWeekly";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getHerstellpreisLookupKey } from "../products/productIdentifiers";
import { addDays, loadPulseOrders, type PulseOrder } from "./pulseOrders";
import { ga4Access, Ga4NotConfiguredError } from "./ga4Client";
import { listActions, saveWeeklyReport } from "./actionLogRepository";
import { syncActionLog } from "./actionSync";
import type { ShopPulseAiDeps } from "./shopPulseAi";
import { weeklyEffects } from "./effects";
import { adsAccess, AdsNotConfiguredError, loadAdsWeek } from "./adsClient";
import { gscAccess, GscNotConfiguredError } from "./gscClient";
import { gscDataEnd } from "./detectors/gsc";
import { adsWeekly, gscWeekly, avgDb1PerOrder, b2bShare, berlinMidnight, ga4WeekFrom, reportedWeekStart, weeklyAiText, weeklyNumbers, weeklyReportData } from "./weeklyReport";

const log = logger.child({ component: "shopPulse/weeklyReportRun" });

/** So viele offene Meldungen bekommen eine Schätzung (der Rest steht ohne Betrag in den Listen) */
const ESTIMATE_MAX = 60;

export type ShopPulseWeeklyDeps = {
  /** Shop-Bestellungen mit Positionen und Kunde (Netto-Betrag, Firma, Kundennummer) ab dem Zeitpunkt */
  loadOrders(tenantId: string | null, since: Date): Promise<PulseOrder[]>;
  /** Kundennummern der B2B-Firmen (B2Bsellers, Firmen-Spiegel) */
  b2bCustomerNumbers(tenantId: string | null): Promise<Set<string>>;
  /** Herstellpreis netto je Artikelnummer (nur die gefundenen) */
  herstellpreise(tenantId: string | null, productNumbers: string[]): Promise<Map<string, number>>;
  /** GA4 der Woche und der Vorwoche; null = nicht eingerichtet */
  ga4(tenantId: string | null, weekStart: string): Promise<ShopPulseWeeklyNumbers["ga4"]>;
  syncActions(tenantId: string | null, now: Date): Promise<unknown>;
  listActions(tenantId: string | null, from: Date, to: Date): Promise<ShopPulseAction[]>;
  /** Wirkung der Maßnahmen neu rechnen (S2-6); fehlt sie, steht im Bericht keine gesicherte Wirkung */
  effects?(tenantId: string | null, now: Date): Promise<{ effects: ShopPulseActionEffect[]; actions: ShopPulseAction[] }>;
  /** Google-Ads-Kosten der Woche (S2-4); wirft AdsNotConfiguredError, wenn nicht eingerichtet; fehlt es, kein Ads-Abschnitt */
  adsWeek?(tenantId: string | null, from: string, to: string): Promise<{ cost: number; clicks: number; conversions: number }>;
  /** Google-Klicks (S2-5) von bis und die 7 Tage davor; wirft GscNotConfiguredError, wenn nicht eingerichtet */
  gscWeek?(tenantId: string | null, from: string, to: string): Promise<{ from: string; to: string; clicks: number; impressions: number; previousClicks: number }>;
  /** Kundenmails der Woche (B6); fehlt es oder gibt es keine Aussendung, kein Abschnitt */
  customerMailsWeek?(tenantId: string | null, from: Date, to: Date): Promise<ShopPulseWeeklyCustomerMails | null>;
  saveReport(
    tenantId: string | null,
    report: { weekStart: string; data: ShopPulseWeeklyReportData; ai: ShopPulseWeeklyReport["ai"]; sentAt: Date | null },
  ): Promise<ShopPulseWeeklyReport>;
};

export type WeeklyBuildInput = {
  tenantId: string | null;
  now: Date;
  /** Bestellabgleich hängt: keine Zahlen (wie im Tagesbericht) */
  mirrorStale: boolean;
  openSignals: ShopPulseSignal[];
  estimateFor: (s: ShopPulseSignal) => Promise<ShopPulseLossEstimate | null>;
  /** null = ohne KI (Vorlage) */
  ai: ShopPulseAiDeps | null;
};

/** Zahlen der Woche und B2B-Anteil; fehlende Herstellpreise, B2B-Firmen oder GA4 sind kein Fehler, nur Lücken */
async function numbersFor(deps: ShopPulseWeeklyDeps, tenantId: string | null, weekStart: string): Promise<{ numbers: ShopPulseWeeklyNumbers; b2b: ShopPulseB2bShare | null; avgDb1: number | null }> {
  const orders = await deps.loadOrders(tenantId, berlinMidnight(addDays(weekStart, -364)));
  let flagged = new Set<string>();
  try {
    flagged = await deps.b2bCustomerNumbers(tenantId);
  } catch (err) {
    log.warn({ err, tenantId }, "Wochenbericht: B2B-Firmen nicht gelesen, Geschäftskunden nur über die Firma");
  }
  const numbers = Array.from(new Set(orders.flatMap((o) => (o.items ?? []).map((i) => i.productNumber))));
  let hk: Map<string, number> | null = null;
  try {
    hk = await deps.herstellpreise(tenantId, numbers);
  } catch (err) {
    log.warn({ err, tenantId }, "Wochenbericht: Herstellpreise nicht gelesen");
  }
  let ga4: ShopPulseWeeklyNumbers["ga4"] = null;
  try {
    ga4 = await deps.ga4(tenantId, weekStart);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, "Wochenbericht: GA4 nicht gelesen");
  }
  const hkOf = hk ? (pn: string) => hk!.get(pn) ?? null : null;
  return {
    numbers: weeklyNumbers(orders, weekStart, hkOf, ga4),
    b2b: b2bShare(orders, weekStart, flagged),
    avgDb1: hkOf ? avgDb1PerOrder(orders, weekStart, addDays(weekStart, 6), hkOf) : null,
  };
}

/** Bericht der abgeschlossenen Woche bauen (ohne speichern und senden) */
export async function buildWeeklyReport(deps: ShopPulseWeeklyDeps, input: WeeklyBuildInput): Promise<{ weekStart: string; data: ShopPulseWeeklyReportData; ai: ShopPulseWeeklyReport["ai"] }> {
  const { tenantId, now } = input;
  const weekStart = reportedWeekStart(now);
  try {
    await deps.syncActions(tenantId, now);
  } catch (err) {
    log.warn({ err, tenantId }, "Wochenbericht: Maßnahmen-Protokoll nicht abgeglichen");
  }
  const figures = input.mirrorStale ? null : await numbersFor(deps, tenantId, weekStart);
  const estimates = new Map<string, ShopPulseLossEstimate | null>();
  for (const s of input.openSignals.slice(0, ESTIMATE_MAX)) estimates.set(s.id, await input.estimateFor(s).catch(() => null));
  const actions = await deps.listActions(tenantId, berlinMidnight(weekStart), berlinMidnight(addDays(weekStart, 7)));
  let effects: ShopPulseWeeklyEffect[] | null = null;
  if (deps.effects && !input.mirrorStale) {
    try {
      const r = await deps.effects(tenantId, now);
      effects = weeklyEffects(r.effects, r.actions, weekStart);
    } catch (err) {
      log.warn({ err, tenantId }, "Wochenbericht: Wirkung nicht berechnet");
    }
  }
  let ads: ShopPulseWeeklyAds | undefined;
  if (deps.adsWeek) {
    try {
      ads = adsWeekly(await deps.adsWeek(tenantId, weekStart, addDays(weekStart, 6)), figures?.avgDb1 ?? null, input.openSignals);
    } catch (err) {
      if (err instanceof AdsNotConfiguredError) ads = adsWeekly(null, null, [], err.reason);
      else {
        log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, "Wochenbericht: Google Ads nicht gelesen");
        ads = adsWeekly(null, figures?.avgDb1 ?? null, input.openSignals);
      }
    }
  }
  let gsc: ShopPulseWeeklyGsc | undefined;
  if (deps.gscWeek) {
    const to = gscDataEnd(now);
    const range = { from: addDays(to, -6), to };
    try {
      gsc = gscWeekly(await deps.gscWeek(tenantId, range.from, range.to), range, input.openSignals);
    } catch (err) {
      if (err instanceof GscNotConfiguredError) gsc = gscWeekly(null, range, [], err.reason);
      else {
        log.warn({ err: err instanceof Error ? err.message : String(err), tenantId }, "Wochenbericht: Search Console nicht gelesen");
        gsc = gscWeekly(null, range, input.openSignals);
      }
    }
  }
  let customerMails: ShopPulseWeeklyCustomerMails | undefined;
  if (deps.customerMailsWeek) {
    try {
      customerMails = (await deps.customerMailsWeek(tenantId, berlinMidnight(weekStart), berlinMidnight(addDays(weekStart, 7)))) ?? undefined;
    } catch (err) {
      log.warn({ err, tenantId }, "Wochenbericht: Kundenmails nicht gelesen");
    }
  }
  const data = weeklyReportData({ numbers: figures?.numbers ?? null, signals: input.openSignals, estimates, actions, now, b2b: figures?.b2b ?? null, effects, ads, gsc, customerMails });

  let ai: ShopPulseWeeklyReport["ai"] = null;
  if (input.ai) {
    const r = await weeklyAiText(data, now, (m) => input.ai!.ask(tenantId, m), input.ai.timeoutMs);
    if (r.rejected) log.warn({ tenantId, rejected: r.rejected, badNumbers: r.badNumbers }, "Wochenbericht: KI-Text verworfen, Vorlage");
    ai = { at: now.toISOString(), text: r.text, ...(r.rejected ? { rejected: r.rejected } : {}) };
  }
  return { weekStart, data, ai };
}

// ---------------------------------------------------------------------------------------------
// Echte Datenquellen

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

/**
 * Herstellpreise wie in Bestellliste und CRM: Schlüssel ist die IFS-Nummer des Artikels (Zusatzfeld
 * wdu_ifs_productnumber), sonst die Artikelnummer. Die IFS-Nummer kommt aus dem Produktspiegel statt aus der
 * Admin-API, damit der Wochenbericht den Live-Shop nicht abfragt.
 */
export async function loadHerstellpreiseForNumbers(storage: Pick<IStorage, "getProductHerstellpreiseByProductNumbers">, tenantId: string | null, productNumbers: string[]): Promise<Map<string, number>> {
  const keyOf = new Map<string, string>(productNumbers.map((pn) => [pn, pn]));
  for (let i = 0; i < productNumbers.length; i += 500) {
    const rows = await db
      .select({ productNumber: shopwareProducts.productNumber, customFields: sql<Record<string, unknown> | null>`${shopwareProducts.payload}->'customFields'` })
      .from(shopwareProducts)
      .where(and(tenantIs(shopwareProducts.tenantId, tenantId), inArray(shopwareProducts.productNumber, productNumbers.slice(i, i + 500))));
    for (const r of rows) keyOf.set(r.productNumber, getHerstellpreisLookupKey(r.customFields ?? undefined, r.productNumber) ?? r.productNumber);
  }
  const byKey = await storage.getProductHerstellpreiseByProductNumbers(Array.from(new Set(keyOf.values())), tenantId);
  const out = new Map<string, number>();
  for (const [pn, key] of Array.from(keyOf.entries())) {
    const hk = byKey.get(key);
    if (hk != null && hk > 0) out.set(pn, hk);
  }
  return out;
}

/** Kundennummern aller B2B-Firmen aus dem Firmen-Spiegel (B2B-Kennzeichen für den B2B-Anteil) */
export async function loadB2bCustomerNumbers(tenantId: string | null): Promise<Set<string>> {
  const rows = await db
    .select({ customerNumber: shopwareB2bCompanies.customerNumber })
    .from(shopwareB2bCompanies)
    .where(tenantIs(shopwareB2bCompanies.tenantId, tenantId));
  return new Set(rows.map((r) => r.customerNumber?.trim() ?? "").filter(Boolean));
}

export function shopPulseWeeklyDeps(storage: IStorage): ShopPulseWeeklyDeps {
  return {
    customerMailsWeek: async (tenantId, from, to) => (await import("../customerMails/weekly")).customerMailsWeek(tenantId, from, to),
    loadOrders: (tenantId, since) => loadPulseOrders(tenantId, since, { items: true, customer: true }),
    b2bCustomerNumbers: (tenantId) => loadB2bCustomerNumbers(tenantId),
    herstellpreise: (tenantId, numbers) => loadHerstellpreiseForNumbers(storage, tenantId, numbers),
    ga4: async (tenantId, weekStart) => {
      let property;
      try {
        property = await ga4Access(storage, tenantId).property();
      } catch (err) {
        if (err instanceof Ga4NotConfiguredError) return null;
        throw err;
      }
      const week = async (from: string) => {
        const rows = await property.report({ dimensions: [], metrics: ["sessions", "totalUsers", "ecommercePurchases"], startDate: from, endDate: addDays(from, 6) });
        const m = rows[0]?.m ?? [0, 0, 0];
        return ga4WeekFrom(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0);
      };
      const current = await week(weekStart);
      const previous = await week(addDays(weekStart, -7));
      return { current, previous };
    },
    syncActions: (tenantId, now) => syncActionLog(storage, tenantId, now),
    listActions: (tenantId, from, to) => listActions(tenantId, { from, to, limit: 500 }),
    adsWeek: async (tenantId, from, to) => loadAdsWeek(await adsAccess(storage, tenantId).account(), from, to),
    gscWeek: async (tenantId, from, to) => {
      const property = await gscAccess(storage, tenantId).property();
      const total = async (a: string, b: string) => {
        const rows = await property.searchAnalytics({ startDate: a, endDate: b, dimensions: [] });
        return { clicks: rows.reduce((s, r) => s + r.clicks, 0), impressions: rows.reduce((s, r) => s + r.impressions, 0) };
      };
      const current = await total(from, to);
      const previous = await total(addDays(from, -7), addDays(from, -1));
      return { from, to, clicks: current.clicks, impressions: current.impressions, previousClicks: previous.clicks };
    },
    saveReport: saveWeeklyReport,
  };
}
