/**
 * Shop-Puls, GA4-Abweichungen (Konzept Stufe 1, Abschnitt 2 C und 3; PR E). Quelle „ga4“, Anbindung über
 * die Einstellungen unter Einstellungen → Google Analytics (ga4Client.ts). Tests mit simuliertem Client in
 * tests/unit/shopPulseGa4.test.ts.
 *
 * GA4 sieht wegen des Cookie-Banners nur einen Teil der Besucher. Bewertet werden deshalb nur Verhältnisse
 * (Quoten, Anteile) und Veränderungen gegen dieselben Wochentage, nie absolute Zahlen. Die Schwellen sind
 * bewusst vorsichtig: lieber eine Störung einen Tag später melden als jeden Tag Fehlalarme (der Shop hat
 * nur rund 4–5 MO-Bestellungen pro Werktag). Jede Regel verlangt drei Dinge zugleich: genug Erwartung
 * (sonst ist 0 Zufall), einen deutlichen Einbruch (Anteil) und einen Abstand von mehreren
 * Standardabweichungen (Poisson, √Erwartung).
 *
 * 1. Live-Trichter (alle 30 Minuten, 6–22 Uhr): Echtzeit-Bericht der letzten 30 Minuten. Seitenaufrufe
 *    normal, aber 2 Stunden lang kein add_to_cart bzw. begin_checkout → kritisch.
 * 2. Trichter gestern je Gerät (mobile, desktop): Quoten view_item → add_to_cart → begin_checkout →
 *    purchase gegen die letzten 8 gleichen Wochentage → Warnung.
 * 3. Besucherquellen (sessionDefaultChannelGroup): Sitzungen und Anteil brechen ein → Warnung.
 * 4. Einstiegsseiten: Top 50 mit Einbruch; Seitentitel „Seite nicht gefunden“ häufiger als sonst → Warnung.
 * 5. Suchbegriffe von gestern ohne Treffer im Shop (selbst gesucht, gedrosselt, unter der Sperre des
 *    Shop-Wächters) → Warnung mit Häufigkeit im Tagesbericht.
 * 6. Messung intakt: GA4-Käufe je MO-Bestellung (Spiegel) fallen stark ab → Warnung.
 * 7. Verknüpfung mit der Bestell-Lücke (Umsatz-Puls): Trichter bis zur Kasse normal, aber keine Käufe →
 *    „Zahlung/Abschluss gestört“, kritisch; deutlich weniger Besucher → „Besucherproblem“.
 *
 * Die Tagesprüfungen (2–6) laufen einmal am Tag ab 7 Uhr (Berlin), vor dem Tagesbericht um 8 Uhr. Die
 * Property sollte in der Zeitzone Europe/Berlin stehen (Dimensionen date und hour).
 */
import { createHash } from "crypto";
import type { ShopPulseDetection } from "@shared/shopPulse";
import { addDays, berlinTime, type PulseOrder } from "../pulseOrders";
import type { Ga4Property, Ga4Row } from "../ga4Client";
import { searchHits, StorefrontSession } from "../storefront";
import { shopRevenuePerHour } from "./storefront";
import type { ShopPulseDetector, ShopPulseDetectorContext, ShopPulseDetectorState, StorefrontShop } from "./types";

export const GA4_STATE_KEY = "shop_pulse_ga4_state";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round1 = (x: number) => Math.round(x * 10) / 10;
const pct1 = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** "2026-10-18" → "20261018" (Dimension date) */
export const gaDate = (day: string) => day.replace(/-/g, "");

/** Dieselben Wochentage davor: day − 7, − 14, … */
export const sameWeekdays = (day: string, weeks: number) => Array.from({ length: weeks }, (_, k) => addDays(day, -7 * (k + 1)));

/**
 * Deutlicher Einbruch: genug erwartet (minExpected), beobachtet höchstens maxShare der Erwartung und
 * mindestens z Standardabweichungen (Poisson: √Erwartung) darunter.
 */
export function significantDrop(observed: number, expected: number, o: { minExpected: number; maxShare: number; z: number }): boolean {
  return expected >= o.minExpected && observed <= expected * o.maxShare && expected - observed >= o.z * Math.sqrt(expected);
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 8);

// ---------------------------------------------------------------------------------------------
// Stand (Settings-Key shop_pulse_ga4_state)

export const LIVE_EVENTS = ["page_view", "add_to_cart", "begin_checkout", "purchase"] as const;
type LiveEvent = (typeof LIVE_EVENTS)[number];

/** Ein Echtzeit-Fenster (die 30 Minuten vor at) */
export type LiveWindow = { at: string; pageViews: number; addToCart: number; beginCheckout: number; purchases: number };

/** Erwartung für heute: Seitenaufrufe je Stunde (Schnitt der 8 gleichen Wochentage), Quoten der 28 Tage */
export type LiveBaseline = {
  /** Kalendertag (Berlin), für den die Erwartung gilt */
  day: string;
  /** Anzahl gleicher Wochentage mit Daten */
  days: number;
  pageViewsByHour: number[];
  addToCartPerView: number;
  checkoutPerView: number;
  purchasePerCheckout: number;
};

export type Ga4State = {
  baseline?: LiveBaseline;
  /** Echtzeit-Fenster der letzten 20 Stunden */
  live?: LiveWindow[];
};

export async function getGa4State(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId">): Promise<Ga4State> {
  const raw = await ctx.storage.getSetting(GA4_STATE_KEY, ctx.tenantId);
  return raw && typeof raw === "object" ? (raw as Ga4State) : {};
}

async function patchGa4State(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId">, patch: Partial<Ga4State>): Promise<void> {
  await ctx.storage.saveSetting(GA4_STATE_KEY, { ...(await getGa4State(ctx)), ...patch }, ctx.tenantId);
}

// ---------------------------------------------------------------------------------------------
// Takt

export const LIVE_FROM_HOUR = 6;
export const LIVE_TO_HOUR = 22;
/** 30-Minuten-Takt mit Spielraum für den 15-Minuten-Takt des Shop-Puls */
const LIVE_INTERVAL_MS = 25 * 60 * 1000;
export const DAILY_FROM_HOUR = 7;
/** Nach einem Fehler (z. B. fehlende Leserechte) frühestens nach 2 Stunden wieder versuchen */
const DAILY_RETRY_MS = 2 * 60 * 60 * 1000;

/** Live fällig: 6–22 Uhr Berlin und 30 Minuten seit dem letzten Lauf (ausgesetzt oder gescheitert: gleich wieder) */
export function isGa4LiveDue(prev: ShopPulseDetectorState | undefined, now: Date): boolean {
  const { hour } = berlinTime(now);
  if (hour < LIVE_FROM_HOUR || hour >= LIVE_TO_HOUR) return false;
  if (!prev || prev.skipped || !prev.ok) return true;
  return now.getTime() - Date.parse(prev.at) >= LIVE_INTERVAL_MS;
}

/** Tagesprüfung fällig: ab 7 Uhr Berlin, heute noch nicht gelaufen; nach einem Fehler erst nach 2 Stunden */
export function isGa4DailyDue(prev: ShopPulseDetectorState | undefined, now: Date): boolean {
  const { day, hour } = berlinTime(now);
  if (hour < DAILY_FROM_HOUR) return false;
  if (!prev || prev.skipped) return true;
  if (!prev.ok) return now.getTime() - Date.parse(prev.at) >= DAILY_RETRY_MS;
  return berlinTime(new Date(prev.at)).day !== day;
}

// ---------------------------------------------------------------------------------------------
// 1. Live-Trichter

/** So lange ohne Ereignis, bis es kritisch wird */
export const LIVE_SPAN_HOURS = 2;
/** Fenster, die zusammen die 2 Stunden abdecken (30 Minuten je Fenster) */
const LIVE_MIN_WINDOWS = 4;
/** Seitenaufrufe „normal“: mindestens die Hälfte der Erwartung derselben Stunden */
export const LIVE_MIN_VIEW_SHARE = 0.5;
/**
 * Erwartete Ereignisse in den 2 Stunden: ab 8 ist 0 Zufall mit 0,03 %; bei 32 Prüfungen am Tag bleibt ein
 * Fehlalarm unter 1 % je Tag. Mit wenig Verkehr meldet die Regel deshalb nichts (gewollt).
 */
export const LIVE_MIN_EXPECTED = 8;
const LIVE_KEEP_MS = 20 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/** Fenster, die die letzten 2 Stunden abdecken (Stempel innerhalb von 1:45 Stunden) */
function recentWindows(windows: LiveWindow[], now: Date): LiveWindow[] {
  const from = now.getTime() - (LIVE_SPAN_HOURS * HOUR_MS - 15 * 60 * 1000);
  return windows.filter((w) => Date.parse(w.at) >= from && Date.parse(w.at) <= now.getTime());
}

/** Erwartete Seitenaufrufe der Fenster (halbe Stunde aus dem Stunden-Schnitt) */
function expectedViews(windows: LiveWindow[], baseline: LiveBaseline): number {
  return sum(windows.map((w) => (baseline.pageViewsByHour[berlinTime(new Date(Date.parse(w.at) - 15 * 60 * 1000)).hour] ?? 0) / 2));
}

/** Erwartung aus dem Bericht date × hour × eventName (56 Tage bis gestern) */
export function liveBaselineFrom(rows: Ga4Row[], today: string): LiveBaseline {
  const compare = new Set(sameWeekdays(today, 8).map(gaDate));
  const from28 = gaDate(addDays(today, -28));
  const byHour = Array.from({ length: 24 }, () => 0);
  const daysWithData = new Set<string>();
  const totals: Record<LiveEvent, number> = { page_view: 0, add_to_cart: 0, begin_checkout: 0, purchase: 0 };
  for (const r of rows) {
    const [date, hourText, event] = r.d;
    const v = r.m[0] ?? 0;
    const hour = Number(hourText);
    if (event === "page_view" && compare.has(date) && hour >= 0 && hour < 24) {
      byHour[hour] += v;
      if (v > 0) daysWithData.add(date);
    }
    if (date >= from28 && event in totals) totals[event as LiveEvent] += v;
  }
  const days = daysWithData.size;
  return {
    day: today,
    days,
    pageViewsByHour: byHour.map((v) => (days ? round1(v / days) : 0)),
    addToCartPerView: totals.page_view ? totals.add_to_cart / totals.page_view : 0,
    checkoutPerView: totals.page_view ? totals.begin_checkout / totals.page_view : 0,
    purchasePerCheckout: totals.begin_checkout ? totals.purchase / totals.begin_checkout : 0,
  };
}

/** Seitenaufrufe normal, aber 2 Stunden kein add_to_cart bzw. begin_checkout */
export function liveDetections(windows: LiveWindow[], baseline: LiveBaseline | undefined, now: Date, lossPerHour: number | null = null): ShopPulseDetection[] {
  if (!baseline || baseline.days < 4) return [];
  const recent = recentWindows(windows, now);
  if (recent.length < LIVE_MIN_WINDOWS) return [];
  const pageViews = sum(recent.map((w) => w.pageViews));
  const expViews = expectedViews(recent, baseline);
  if (expViews <= 0 || pageViews < expViews * LIVE_MIN_VIEW_SHARE) return [];
  const evidence = { windows: recent, expectedPageViews: Math.round(expViews), baselineDays: baseline.days };
  const out: ShopPulseDetection[] = [];
  const check = (count: number, perView: number, key: string, code: "ga4LiveNoAddToCart" | "ga4LiveNoCheckout") => {
    const expected = pageViews * perView;
    if (count > 0 || expected < LIVE_MIN_EXPECTED) return;
    out.push({
      key,
      source: "ga4",
      code,
      severity: "critical",
      params: { hours: LIVE_SPAN_HOURS, pageViews, expected: Math.round(expected) },
      evidence: { ...evidence, perView: Math.round(perView * 10000) / 10000 },
      lossPerHour,
    });
  };
  check(sum(recent.map((w) => w.addToCart)), baseline.addToCartPerView, "ga4:live:add-to-cart", "ga4LiveNoAddToCart");
  check(sum(recent.map((w) => w.beginCheckout)), baseline.checkoutPerView, "ga4:live:begin-checkout", "ga4LiveNoCheckout");
  return out;
}

export function liveWindowFrom(rows: Ga4Row[], at: Date): LiveWindow {
  const count = (e: LiveEvent) => sum(rows.filter((r) => r.d[0] === e).map((r) => r.m[0] ?? 0));
  return { at: at.toISOString(), pageViews: count("page_view"), addToCart: count("add_to_cart"), beginCheckout: count("begin_checkout"), purchases: count("purchase") };
}

export const ga4LiveDetector: ShopPulseDetector = {
  id: "ga4Live",
  source: "ga4",
  keyPrefix: "ga4:live:",
  due: isGa4LiveDue,
  async run(ctx) {
    const property = await ctx.ga4.property();
    const today = berlinTime(ctx.now).day;
    const state = await getGa4State(ctx);
    let baseline = state.baseline;
    if (baseline?.day !== today) {
      const rows = await property.report({
        dimensions: ["date", "hour", "eventName"],
        metrics: ["eventCount"],
        startDate: addDays(today, -56),
        endDate: addDays(today, -1),
        filter: { field: "eventName", inList: [...LIVE_EVENTS] },
      });
      baseline = liveBaselineFrom(rows, today);
    }
    const realtime = await property.realtime({ dimensions: ["eventName"], metrics: ["eventCount"], filter: { field: "eventName", inList: [...LIVE_EVENTS] } });
    const keepFrom = ctx.now.getTime() - LIVE_KEEP_MS;
    const live = [...(state.live ?? []).filter((w) => Date.parse(w.at) >= keepFrom), liveWindowFrom(realtime, ctx.now)];
    await patchGa4State(ctx, { baseline, live });
    const found = liveDetections(live, baseline, ctx.now);
    if (!found.length) return found;
    const loss = await ctx.orders().then((o) => shopRevenuePerHour(o, ctx.now)).catch(() => null);
    return found.map((d) => ({ ...d, lossPerHour: loss }));
  },
};

// ---------------------------------------------------------------------------------------------
// 7. Verknüpfung mit der Bestell-Lücke

/** So viele Fenster muss es heute geben (3 Stunden), das jüngste höchstens 45 Minuten alt */
const LINK_MIN_WINDOWS = 6;
const LINK_MAX_AGE_MS = 45 * 60 * 1000;
/** Besucherproblem: höchstens die Hälfte der erwarteten Seitenaufrufe, bei mindestens 100 erwarteten */
export const LINK_VISITORS_MAX_SHARE = 0.5;
const LINK_VISITORS_MIN_EXPECTED = 100;
/** Trichter bis zur Kasse normal: Seitenaufrufe ≥ 70 %, begin_checkout mindestens 3 und ≥ 50 % der Erwartung */
export const LINK_NORMAL_VIEW_SHARE = 0.7;
const LINK_MIN_CHECKOUTS = 3;
const LINK_CHECKOUT_SHARE = 0.5;

/**
 * Offene Bestell-Lücke (Umsatz-Puls, noch nicht von der Warenkorb-Probe bestätigt) mit dem Live-Trichter
 * von heute (ab 6 Uhr) abgleichen: Trichter bis zur Kasse normal, aber kein Kauf → „Zahlung/Abschluss
 * gestört“ (kritisch); deutlich weniger Seitenaufrufe als an den gleichen Wochentagen → „Besucherproblem“
 * (Warnung). Sonst bleibt die Lücke, wie sie ist.
 */
export function linkOrderGapWithGa4(detections: ShopPulseDetection[], state: Ga4State | null, now: Date): ShopPulseDetection[] {
  const gap = detections.find((d) => d.code === "orderGap");
  const baseline = state?.baseline;
  const today = berlinTime(now).day;
  if (!gap || !baseline || baseline.day !== today || baseline.days < 4) return detections;
  const windows = (state?.live ?? []).filter((w) => berlinTime(new Date(w.at)).day === today && Date.parse(w.at) <= now.getTime());
  const latest = Math.max(0, ...windows.map((w) => Date.parse(w.at)));
  if (windows.length < LINK_MIN_WINDOWS || now.getTime() - latest > LINK_MAX_AGE_MS) return detections;
  const pageViews = sum(windows.map((w) => w.pageViews));
  const expViews = expectedViews(windows, baseline);
  const checkouts = sum(windows.map((w) => w.beginCheckout));
  const purchases = sum(windows.map((w) => w.purchases));
  const expCheckouts = pageViews * baseline.checkoutPerView;
  const ga4 = {
    pageViews,
    expectedPageViews: Math.round(expViews),
    beginCheckout: checkouts,
    expectedBeginCheckout: round1(expCheckouts),
    purchases,
    windows: windows.length,
  };
  let replace: Pick<ShopPulseDetection, "code" | "severity"> | null = null;
  if (expViews >= LINK_VISITORS_MIN_EXPECTED && pageViews <= expViews * LINK_VISITORS_MAX_SHARE) {
    replace = { code: "orderGapVisitors", severity: "warning" };
  } else if (
    expViews > 0 &&
    pageViews >= expViews * LINK_NORMAL_VIEW_SHARE &&
    checkouts >= LINK_MIN_CHECKOUTS &&
    checkouts >= expCheckouts * LINK_CHECKOUT_SHARE &&
    purchases === 0
  ) {
    replace = { code: "orderGapCheckout", severity: "critical" };
  }
  if (!replace) return detections;
  const r = replace;
  return detections.map((d) => (d === gap ? { ...d, ...r, params: { ...(d.params ?? {}), pct: Math.round((pageViews / expViews) * 100) }, evidence: { ...(d.evidence ?? {}), ga4 } } : d));
}

// ---------------------------------------------------------------------------------------------
// Gemeinsames der Tagesprüfungen

const COMPARE_WEEKS = 8;
/** So viele der 8 gleichen Wochentage müssen Daten haben */
const MIN_COMPARE_DAYS = 4;

/** Werte je Tag (Dimension date an Position 0) und Schlüssel (übrige Dimensionen) */
function byDateAndKey(rows: Ga4Row[], metric = 0): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const [date, ...rest] = r.d;
    const key = rest.join("|");
    const m = out.get(date) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + (r.m[metric] ?? 0));
    out.set(date, m);
  }
  return out;
}

/** Gestern (Berlin) und die 8 gleichen Wochentage davor mit Daten */
function compareDays(data: Map<string, Map<string, number>>, yesterday: string): { cur: string; base: string[] } {
  return { cur: gaDate(yesterday), base: sameWeekdays(yesterday, COMPARE_WEEKS).map(gaDate).filter((d) => data.has(d)) };
}

const yesterdayOf = (now: Date) => addDays(berlinTime(now).day, -1);

// ---------------------------------------------------------------------------------------------
// 2. Trichter gestern nach Gerät

export const FUNNEL_EVENTS = ["view_item", "add_to_cart", "begin_checkout", "purchase"] as const;
export const FUNNEL_DEVICES = ["mobile", "desktop"] as const;
const FUNNEL_STEPS = [
  { from: "view_item", to: "add_to_cart", code: "ga4FunnelCart", step: "cart" },
  { from: "add_to_cart", to: "begin_checkout", code: "ga4FunnelCheckout", step: "checkout" },
  { from: "begin_checkout", to: "purchase", code: "ga4FunnelPurchase", step: "purchase" },
] as const;
/**
 * Quote halbiert (≤ 50 % der üblichen) und 3 Standardabweichungen unter der Erwartung, bei mindestens 10
 * erwarteten Nutzern im nächsten Schritt. Den Schritt zum Kauf trifft das bei rund 4–5 Bestellungen am
 * Tag selten; den deckt die Verknüpfung mit der Bestell-Lücke ab.
 */
export const FUNNEL_RULE = { minExpected: 10, maxShare: 0.5, z: 3 };

/** Bericht date × deviceCategory × eventName (Nutzer mit dem Ereignis) */
export function funnelDetections(rows: Ga4Row[], yesterday: string): ShopPulseDetection[] {
  const data = byDateAndKey(rows);
  const { cur, base } = compareDays(data, yesterday);
  if (base.length < MIN_COMPARE_DAYS || !data.has(cur)) return [];
  const val = (date: string, device: string, event: string) => data.get(date)?.get(`${device}|${event}`) ?? 0;
  const out: ShopPulseDetection[] = [];
  for (const device of FUNNEL_DEVICES) {
    for (const s of FUNNEL_STEPS) {
      const baseFrom = sum(base.map((d) => val(d, device, s.from)));
      const baseTo = sum(base.map((d) => val(d, device, s.to)));
      const curFrom = val(cur, device, s.from);
      const curTo = val(cur, device, s.to);
      if (!baseFrom || !curFrom) continue;
      const rate = baseTo / baseFrom;
      const expected = curFrom * rate;
      if (!significantDrop(curTo, expected, FUNNEL_RULE)) continue;
      out.push({
        key: `ga4:funnel:${device}:${s.step}`,
        source: "ga4",
        code: s.code,
        severity: "warning",
        params: { device, date: yesterday, current: pct1(curTo, curFrom), expected: pct1(baseTo, baseFrom), pct: Math.round((1 - curTo / curFrom / rate) * 100) },
        evidence: { from: s.from, to: s.to, current: { [s.from]: curFrom, [s.to]: curTo }, baseline: { [s.from]: baseFrom, [s.to]: baseTo, days: base.length }, expected: round1(expected) },
      });
    }
  }
  return out;
}

export const ga4FunnelDetector: ShopPulseDetector = {
  id: "ga4Funnel",
  source: "ga4",
  keyPrefix: "ga4:funnel:",
  due: isGa4DailyDue,
  async run(ctx) {
    const property = await ctx.ga4.property();
    const yesterday = yesterdayOf(ctx.now);
    const rows = await property.report({
      dimensions: ["date", "deviceCategory", "eventName"],
      metrics: ["totalUsers"],
      startDate: addDays(yesterday, -7 * COMPARE_WEEKS),
      endDate: yesterday,
      filter: { field: "eventName", inList: [...FUNNEL_EVENTS] },
    });
    return funnelDetections(rows, yesterday);
  },
};

// ---------------------------------------------------------------------------------------------
// 3. Besucherquellen

/**
 * Sitzungen der Quelle höchstens halb so viele wie an den gleichen Wochentagen (3 Standardabweichungen,
 * mindestens 20 erwartet) UND ihr Anteil an allen Sitzungen auf höchstens 60 % des üblichen gefallen. Der
 * Anteil sorgt dafür, dass eine geänderte Einwilligungsquote (alle Quellen gleich weniger) nicht meldet.
 */
export const CHANNEL_RULE = { minExpected: 20, maxShare: 0.5, z: 3 };
export const CHANNEL_SHARE_DROP = 0.6;

/** Bericht date × sessionDefaultChannelGroup (Sitzungen) */
export function channelDetections(rows: Ga4Row[], yesterday: string): ShopPulseDetection[] {
  const data = byDateAndKey(rows);
  const { cur, base } = compareDays(data, yesterday);
  if (base.length < MIN_COMPARE_DAYS || !data.has(cur)) return [];
  const total = (date: string) => sum(Array.from(data.get(date)?.values() ?? []));
  const curTotal = total(cur);
  const baseTotal = sum(base.map(total));
  if (!curTotal || !baseTotal) return [];
  const channels = new Set(base.flatMap((d) => Array.from(data.get(d)?.keys() ?? [])));
  const out: ShopPulseDetection[] = [];
  for (const channel of Array.from(channels)) {
    if (!channel || channel === "(other)" || channel === "(not set)") continue;
    const baseSessions = sum(base.map((d) => data.get(d)?.get(channel) ?? 0));
    const expected = baseSessions / base.length;
    const current = data.get(cur)?.get(channel) ?? 0;
    const share = current / curTotal;
    const baseShare = baseSessions / baseTotal;
    if (!significantDrop(current, expected, CHANNEL_RULE) || share > baseShare * CHANNEL_SHARE_DROP) continue;
    out.push({
      key: `ga4:channel:${slug(channel) || shortHash(channel)}`,
      source: "ga4",
      code: "ga4ChannelDrop",
      severity: "warning",
      params: { channel: channel.slice(0, 80), date: yesterday, pct: Math.round((1 - current / expected) * 100), share: round1(share * 100), expectedShare: round1(baseShare * 100) },
      evidence: { current, expected: round1(expected), days: base.length },
    });
  }
  return out;
}

export const ga4ChannelsDetector: ShopPulseDetector = {
  id: "ga4Channels",
  source: "ga4",
  keyPrefix: "ga4:channel:",
  due: isGa4DailyDue,
  async run(ctx) {
    const property = await ctx.ga4.property();
    const yesterday = yesterdayOf(ctx.now);
    const rows = await property.report({
      dimensions: ["date", "sessionDefaultChannelGroup"],
      metrics: ["sessions"],
      startDate: addDays(yesterday, -7 * COMPARE_WEEKS),
      endDate: yesterday,
    });
    return channelDetections(rows, yesterday);
  },
};

// ---------------------------------------------------------------------------------------------
// 4. Einstiegsseiten und „Seite nicht gefunden“

export const LANDING_TOP = 50;
/** Einstiegsseite: höchstens 40 % der üblichen Sitzungen (mindestens 15 erwartet), Anteil halbiert */
export const LANDING_RULE = { minExpected: 15, maxShare: 0.4, z: 3 };
const LANDING_SHARE_DROP = 0.5;
/** Höchstens so viele Einstiegsseiten je Tag melden (die mit den meisten verlorenen Sitzungen) */
const LANDING_MAX_FINDINGS = 10;
/** Seitentitel der Fehlerseite im Shop */
export const NOT_FOUND_TITLE = "Seite nicht gefunden";
/** Fehlerseite: mindestens 10 Aufrufe, Anteil an allen Aufrufen mindestens verdoppelt, 3 Standardabweichungen */
const NOT_FOUND_MIN = 10;
const NOT_FOUND_FACTOR = 2;
const NOT_FOUND_Z = 3;

export type LandingData = {
  /** date × landingPage (Sitzungen), nur die Top 50 */
  landing: Ga4Row[];
  /** date (Sitzungen, Seitenaufrufe) */
  totals: Ga4Row[];
  /** date (Aufrufe der Fehlerseite) */
  notFound: Ga4Row[];
  /** pagePath der Fehlerseite gestern (Aufrufe), absteigend */
  notFoundPaths: Ga4Row[];
};

export function landingDetections(data: LandingData, yesterday: string): ShopPulseDetection[] {
  const totals = new Map(data.totals.map((r) => [r.d[0], { sessions: r.m[0] ?? 0, views: r.m[1] ?? 0 }]));
  const cur = gaDate(yesterday);
  const base = sameWeekdays(yesterday, COMPARE_WEEKS).map(gaDate).filter((d) => (totals.get(d)?.sessions ?? 0) > 0);
  const curTotals = totals.get(cur);
  if (base.length < MIN_COMPARE_DAYS || !curTotals?.sessions) return [];
  const baseSessions = sum(base.map((d) => totals.get(d)?.sessions ?? 0));
  const out: ShopPulseDetection[] = [];

  const pages = byDateAndKey(data.landing);
  const drops: Array<ShopPulseDetection & { lost: number }> = [];
  const paths = new Set(base.flatMap((d) => Array.from(pages.get(d)?.keys() ?? [])));
  for (const page of Array.from(paths)) {
    if (!page || page === "(not set)") continue;
    const sessionsBase = sum(base.map((d) => pages.get(d)?.get(page) ?? 0));
    const expected = sessionsBase / base.length;
    const current = pages.get(cur)?.get(page) ?? 0;
    const share = current / curTotals.sessions;
    const baseShare = sessionsBase / baseSessions;
    if (!significantDrop(current, expected, LANDING_RULE) || share > baseShare * LANDING_SHARE_DROP) continue;
    drops.push({
      key: `ga4:landing:${slug(page) || "start"}-${shortHash(page)}`,
      source: "ga4",
      code: "ga4LandingDrop",
      severity: "warning",
      params: { page: page.slice(0, 120), date: yesterday, pct: Math.round((1 - current / expected) * 100), share: round1(share * 100), expectedShare: round1(baseShare * 100) },
      evidence: { page, current, expected: round1(expected), days: base.length },
      lost: expected - current,
    });
  }
  drops.sort((a, b) => b.lost - a.lost);
  out.push(...drops.slice(0, LANDING_MAX_FINDINGS).map(({ lost: _lost, ...d }) => d));

  // Fehlerseite: Anteil an allen Seitenaufrufen gegen die gleichen Wochentage
  const nf = new Map(data.notFound.map((r) => [r.d[0], r.m[0] ?? 0]));
  const baseViews = sum(base.map((d) => totals.get(d)?.views ?? 0));
  const baseNf = sum(base.map((d) => nf.get(d) ?? 0));
  const curNf = nf.get(cur) ?? 0;
  if (curTotals.views > 0 && baseViews > 0) {
    const baseShare = baseNf / baseViews;
    const share = curNf / curTotals.views;
    const expected = curTotals.views * baseShare;
    if (curNf >= NOT_FOUND_MIN && share >= baseShare * NOT_FOUND_FACTOR && curNf - expected >= NOT_FOUND_Z * Math.sqrt(Math.max(expected, 1))) {
      out.push({
        key: "ga4:landing:not-found",
        source: "ga4",
        code: "ga4NotFoundUp",
        severity: "warning",
        params: { date: yesterday, current: curNf, expected: Math.round(expected), share: round1(share * 100), expectedShare: round1(baseShare * 100) },
        evidence: { title: NOT_FOUND_TITLE, paths: data.notFoundPaths.slice(0, 10).map((r) => ({ path: r.d[0], views: r.m[0] ?? 0 })), days: base.length },
      });
    }
  }
  return out;
}

export async function loadLandingData(property: Ga4Property, yesterday: string): Promise<LandingData> {
  const startDate = addDays(yesterday, -7 * COMPARE_WEEKS);
  const baseEnd = addDays(yesterday, -1);
  // nacheinander, nie parallel
  const top = await property.report({ dimensions: ["landingPage"], metrics: ["sessions"], startDate, endDate: baseEnd, orderByMetric: true, limit: LANDING_TOP });
  const topPages = top.map((r) => r.d[0]).filter((p) => p && p !== "(not set)");
  const landing = topPages.length
    ? await property.report({ dimensions: ["date", "landingPage"], metrics: ["sessions"], startDate, endDate: yesterday, filter: { field: "landingPage", inList: topPages } })
    : [];
  const totals = await property.report({ dimensions: ["date"], metrics: ["sessions", "screenPageViews"], startDate, endDate: yesterday });
  const notFound = await property.report({ dimensions: ["date"], metrics: ["screenPageViews"], startDate, endDate: yesterday, filter: { field: "pageTitle", contains: NOT_FOUND_TITLE } });
  const notFoundPaths = await property.report({
    dimensions: ["pagePath"],
    metrics: ["screenPageViews"],
    startDate: yesterday,
    endDate: yesterday,
    filter: { field: "pageTitle", contains: NOT_FOUND_TITLE },
    orderByMetric: true,
    limit: 10,
  });
  return { landing, totals, notFound, notFoundPaths };
}

export const ga4LandingPagesDetector: ShopPulseDetector = {
  id: "ga4LandingPages",
  source: "ga4",
  keyPrefix: "ga4:landing:",
  due: isGa4DailyDue,
  async run(ctx) {
    const property = await ctx.ga4.property();
    const yesterday = yesterdayOf(ctx.now);
    return landingDetections(await loadLandingData(property, yesterday), yesterday);
  },
};

// ---------------------------------------------------------------------------------------------
// 5. Suchbegriffe ohne Treffer

/** So viele häufigste Suchbegriffe von gestern werden im Shop nachgesucht */
export const SEARCH_MAX_TERMS = 25;
/** So viele stehen im Titel (Tagesbericht); alle in den Belegen */
const SEARCH_LISTED = 8;
export const SEARCH_NO_HITS_KEY = "ga4:search:no-hits";

export type SearchTerm = { term: string; count: number };
export type SearchCheck = SearchTerm & { hits: number | null };

/** Suchbegriffe säubern: zusammenfassen (Groß-/Kleinschreibung, Leerzeichen), ohne leere, E-Mail-Adressen, überlange */
export function normalizeSearchTerms(rows: Ga4Row[], max = SEARCH_MAX_TERMS): SearchTerm[] {
  const m = new Map<string, SearchTerm>();
  for (const r of rows) {
    const raw = (r.d[0] ?? "").replace(/\s+/g, " ").trim();
    if (!raw || raw === "(not set)" || raw.includes("@") || raw.length > 80) continue;
    const key = raw.toLocaleLowerCase("de-DE");
    const prev = m.get(key);
    if (prev) prev.count += r.m[0] ?? 0;
    else m.set(key, { term: raw, count: r.m[0] ?? 0 });
  }
  return Array.from(m.values())
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, max);
}

/**
 * Begriffe nacheinander in der Storefront suchen (mit Pause). Leitet die Suche auf eine Produktseite weiter
 * (genaue Artikelnummer), zählt das als Treffer. hits null = Seite nicht geladen.
 */
export async function checkSearchTerms(shop: Pick<StorefrontShop, "storefront" | "fetchImpl" | "pauseMs">, terms: SearchTerm[]): Promise<SearchCheck[]> {
  const session = new StorefrontSession(shop.storefront, shop.fetchImpl);
  const out: SearchCheck[] = [];
  for (const [i, t] of terms.entries()) {
    if (i > 0) await sleep(shop.pauseMs);
    const res = await session.get(`/search?search=${encodeURIComponent(t.term)}`).catch(() => null);
    if (!res || res.status !== 200) {
      out.push({ ...t, hits: null });
      continue;
    }
    const onSearch = new URL(res.url).pathname.replace(/\/+$/, "").endsWith("/search");
    out.push({ ...t, hits: onSearch ? searchHits(res.html) : 1 });
  }
  if (out.length >= 3 && out.every((c) => c.hits === null)) throw new Error(`Storefront nicht erreichbar (${out.length} Suchen ohne Antwort)`);
  return out;
}

export function searchNoHitsDetections(checks: SearchCheck[], yesterday: string): ShopPulseDetection[] {
  const none = checks.filter((c) => c.hits === 0);
  if (!none.length) return [];
  return [
    {
      key: SEARCH_NO_HITS_KEY,
      source: "ga4",
      code: "ga4SearchNoHits",
      severity: "warning",
      params: {
        date: yesterday,
        count: none.length,
        searches: sum(none.map((c) => c.count)),
        terms: none
          .slice(0, SEARCH_LISTED)
          .map((c) => `„${c.term.slice(0, 40)}“ (${c.count}×)`)
          .join(", "),
      },
      evidence: { terms: none.map(({ term, count }) => ({ term, count })), checked: checks.length, unchecked: checks.filter((c) => c.hits === null).length },
    },
  ];
}

export const ga4SearchTermsDetector: ShopPulseDetector = {
  id: "ga4SearchTerms",
  source: "ga4",
  keyPrefix: "ga4:search:",
  due: isGa4DailyDue,
  async run(ctx) {
    const property = await ctx.ga4.property();
    const yesterday = yesterdayOf(ctx.now);
    const rows = await property.report({
      dimensions: ["searchTerm"],
      metrics: ["eventCount"],
      startDate: yesterday,
      endDate: yesterday,
      filter: { field: "eventName", equals: "search" },
      orderByMetric: true,
      limit: 200,
    });
    const terms = normalizeSearchTerms(rows);
    if (!terms.length) return [];
    const checks = await ctx.storefront.withShop((shop) => checkSearchTerms(shop, terms));
    return searchNoHitsDetections(checks, yesterday);
  },
};

// ---------------------------------------------------------------------------------------------
// 6. Messung intakt

/**
 * GA4-Käufe je MO-Bestellung der letzten 7 Tage gegen die 28 Tage davor. Gemeldet, wenn GA4 höchstens 40 %
 * der erwarteten Käufe sieht (2,5 Standardabweichungen, mindestens 6 erwartet), bei mindestens 10
 * MO-Bestellungen in den 7 Tagen. Die Einwilligungsquote ändert sich über Wochen kaum; ein solcher
 * Einbruch heißt meist: Kauf-Ereignis kaputt (Theme, GTM, Zahlungs-Rücksprung).
 */
export const MEASUREMENT_RULE = { minExpected: 6, maxShare: 0.4, z: 2.5 };
const MEASUREMENT_MIN_ORDERS = 10;
const MEASUREMENT_BASE_MIN_ORDERS = 20;
const MEASUREMENT_BASE_MIN_PURCHASES = 10;

export function measurementDetections(purchaseRows: Ga4Row[], orders: PulseOrder[], yesterday: string): ShopPulseDetection[] {
  const curFrom = addDays(yesterday, -6);
  const baseFrom = addDays(curFrom, -28);
  const ga4 = new Map(purchaseRows.map((r) => [r.d[0], r.m[0] ?? 0]));
  const ga4In = (from: string, to: string) => sum(Array.from(ga4.entries()).filter(([d]) => d >= gaDate(from) && d <= gaDate(to)).map(([, v]) => v));
  const ordersIn = (from: string, to: string) => orders.filter((o) => o.day >= from && o.day <= to).length;
  const curOrders = ordersIn(curFrom, yesterday);
  const baseOrders = ordersIn(baseFrom, addDays(curFrom, -1));
  const curGa4 = ga4In(curFrom, yesterday);
  const baseGa4 = ga4In(baseFrom, addDays(curFrom, -1));
  if (curOrders < MEASUREMENT_MIN_ORDERS || baseOrders < MEASUREMENT_BASE_MIN_ORDERS || baseGa4 < MEASUREMENT_BASE_MIN_PURCHASES) return [];
  const ratio = baseGa4 / baseOrders;
  const expected = curOrders * ratio;
  if (!significantDrop(curGa4, expected, MEASUREMENT_RULE)) return [];
  return [
    {
      key: "ga4:measurement:purchases",
      source: "ga4",
      code: "ga4MeasurementDrop",
      severity: "warning",
      params: { from: curFrom, to: yesterday, current: pct1(curGa4, curOrders), expected: round1(ratio * 100), orders: curOrders },
      evidence: { current: { ga4Purchases: curGa4, moOrders: curOrders }, baseline: { from: baseFrom, ga4Purchases: baseGa4, moOrders: baseOrders }, expected: round1(expected) },
    },
  ];
}

export const ga4MeasurementDetector: ShopPulseDetector = {
  id: "ga4Measurement",
  source: "ga4",
  keyPrefix: "ga4:measurement:",
  due: isGa4DailyDue,
  needsFreshMirror: true,
  async run(ctx) {
    const property = await ctx.ga4.property();
    const yesterday = yesterdayOf(ctx.now);
    const rows = await property.report({
      dimensions: ["date"],
      metrics: ["eventCount"],
      startDate: addDays(yesterday, -34),
      endDate: yesterday,
      filter: { field: "eventName", equals: "purchase" },
    });
    return measurementDetections(rows, await ctx.orders(), yesterday);
  },
};

export const GA4_DETECTORS: ShopPulseDetector[] = [
  ga4LiveDetector,
  ga4FunnelDetector,
  ga4ChannelsDetector,
  ga4LandingPagesDetector,
  ga4SearchTermsDetector,
  ga4MeasurementDetector,
];
