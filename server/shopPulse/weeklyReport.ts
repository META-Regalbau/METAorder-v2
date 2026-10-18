/**
 * Shop-Puls Stufe 2 (S2-1), Wochenbericht: montags ab 8 Uhr (Berlin) statt des Tagesberichts, über dieselbe
 * Teams-Warteschlange und die Glocke wie Stufe 1. Berichtet wird die abgeschlossene Woche (Montag bis
 * Sonntag). Rein, ohne Datenbank; Tests in tests/unit/shopPulseWeekly.test.ts. Den Lauf macht
 * weeklyReportRun.ts.
 *
 * 1. Die Woche in Zahlen: MO-Bestellungen (ohne stornierte), Umsatz brutto, Ø Bestellwert, Deckungsbeitrag
 *    (DB1 netto, summarizeOrderItems wie Bestellliste und CRM) gegen Vorwoche und Vorjahr (gleiche Wochentage
 *    52 Wochen davor; ohne Bestellungen dort „keine Daten“, wie im Tagesbericht). GA4 nur, wenn eingerichtet.
 * 2. Top 5 Hebel nach €: offene, nicht ruhig gestellte Meldungen mit geschätztem Verlust (Prüfung selbst oder
 *    lossEstimate.ts), je Woche = pro Stunde × 84 Geschäftsstunden (12 × 7, dieselbe Grundlage wie die
 *    Topseller-Schätzung). Nicht kaufbare Topseller und Suchbegriffe ohne Treffer sind solche Meldungen.
 *    Ohne Schätzung stehen Meldungen hinten („nicht abschätzbar“).
 * 3. Erledigt letzte Woche: Einträge des Maßnahmen-Protokolls (Wirkung kommt erst mit S2-6).
 * 4. Offen je Zuständigem: alle offenen Meldungen, als Liste zum Weiterleiten.
 * Zuständiger und nächster Schritt kommen fest aus SHOP_PULSE_RESPONSIBILITY.
 */
import { summarizeOrderItems } from "../analytics/orderProfitabilityAnalysis";
import {
  SHOP_PULSE_OWNER_IDS,
  SHOP_PULSE_OWNER_NAMES,
  SHOP_PULSE_RESPONSIBILITY,
  changePercent,
  type ShopPulseAction,
  type ShopPulseLever,
  type ShopPulseOwnerList,
  type ShopPulseWeekFigures,
  type ShopPulseWeekGa4,
  type ShopPulseWeeklyDone,
  type ShopPulseWeeklyNumbers,
  type ShopPulseWeeklyReportData,
} from "@shared/shopPulseWeekly";
import type { ShopPulseLossEstimate, ShopPulseSignal, ShopPulseState } from "@shared/shopPulse";
import { addDays, berlinTime, weekdayOfDay, type PulseOrder } from "./pulseOrders";
import { compareSignals, isMuted } from "./shopPulseSignals";
import { askChecked, ESTIMATE_BASIS, OWNER_HINTS, promptValue, SHOP_PULSE_AI_RULES, SHOP_PULSE_OWNERS, type AiAsk, type AiTextResult, AI_TIMEOUT_MS } from "./shopPulseAi";
import { signalMessage, signalTitle, weeklyNextStepText } from "./shopPulseNotify";

const WEEKLY_FROM_HOUR = 8;
const WEEKLY_TO_HOUR = 12;
/** Geschäftsstunden je Woche: 12 am Tag (7–19 Uhr) × 7 Tage, wie lossPerHourOf (365 × 12 im Jahr) */
export const WEEK_BUSINESS_HOURS = 84;
export const LEVERS_MAX = 5;
export const WEEKLY_AI_MAX_CHARS = 1500;
/** So viele Einträge je Zuständigem stehen in der Liste zum Weiterleiten */
const OWNER_ITEMS_MAX = 15;
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Woche und Zeitplan

/** Montag der zuletzt abgeschlossenen Woche (Berlin) */
export function reportedWeekStart(now: Date): string {
  const today = berlinTime(now).day;
  return addDays(today, -(weekdayOfDay(today) - 1) - 7);
}

/** Wochenbericht fällig: Montag, 8 bis 12 Uhr Berlin, für die abgeschlossene Woche noch keiner */
export function isWeeklyReportDue(state: ShopPulseState, now: Date): boolean {
  const { hour, weekday } = berlinTime(now);
  if (weekday !== 1 || hour < WEEKLY_FROM_HOUR || hour >= WEEKLY_TO_HOUR) return false;
  return state.lastWeeklyReportWeek !== reportedWeekStart(now);
}

/** Mitternacht eines Kalendertags in Berlin als Zeitpunkt (Sommer- und Winterzeit) */
export function berlinMidnight(day: string): Date {
  for (const offsetHours of [2, 1, 0]) {
    const d = new Date(Date.parse(`${day}T00:00:00Z`) - offsetHours * 60 * 60 * 1000);
    const t = berlinTime(d);
    if (t.day === day && t.hour === 0) return d;
  }
  return new Date(`${day}T00:00:00Z`);
}

// ---------------------------------------------------------------------------------------------
// Zahlen

/** Herstellpreis netto je Einheit einer Artikelnummer; null = keiner */
export type HerstellpreisOf = (productNumber: string) => number | null;

/** Zahlen einer Woche ab Montag from; hkOf = Herstellpreise (fehlt er, kein Deckungsbeitrag) */
export function weekFigures(orders: PulseOrder[], from: string, hkOf: HerstellpreisOf | null): ShopPulseWeekFigures {
  const to = addDays(from, 6);
  const week = orders.filter((o) => o.day >= from && o.day <= to);
  const revenue = week.reduce((s, o) => s + o.total, 0);
  let db1: number | null = null;
  let coveredNet = 0;
  let productNet = 0;
  if (hkOf) {
    for (const o of week) {
      const lines = (o.items ?? []).map((i) => {
        const hk = hkOf(i.productNumber);
        return { productNumber: i.productNumber, quantity: i.quantity, netTotal: i.netTotal, herstellpreisNet: hk, herstellkostenTotal: hk != null ? round2(hk * i.quantity) : null };
      });
      productNet += lines.reduce((s, l) => s + l.netTotal, 0);
      const summary = summarizeOrderItems(lines, 0);
      if (summary.db1Total == null || summary.herstellkostenTotal == null) continue;
      db1 = round2((db1 ?? 0) + summary.db1Total);
      coveredNet += summary.herstellkostenTotal + summary.db1Total;
    }
  }
  return {
    from,
    to,
    orders: week.length,
    revenue: round2(revenue),
    aov: week.length ? round2(revenue / week.length) : 0,
    db1,
    db1CoveragePercent: db1 != null && productNet > 0 ? Math.round((coveredNet / productNet) * 1000) / 10 : null,
  };
}

/** Woche, Vorwoche und Vorjahreswoche (52 Wochen davor; null ohne Bestellungen) */
export function weeklyNumbers(
  orders: PulseOrder[],
  weekStart: string,
  hkOf: HerstellpreisOf | null,
  ga4: ShopPulseWeeklyNumbers["ga4"] = null,
): ShopPulseWeeklyNumbers {
  const yearAgo = weekFigures(orders, addDays(weekStart, -364), hkOf);
  return {
    current: weekFigures(orders, weekStart, hkOf),
    previous: weekFigures(orders, addDays(weekStart, -7), hkOf),
    yearAgo: yearAgo.orders > 0 ? yearAgo : null,
    ga4,
  };
}

/** GA4-Kennzahlen einer Woche aus Sitzungen, Nutzern und Käufen */
export function ga4WeekFrom(sessions: number, users: number, purchases: number): ShopPulseWeekGa4 {
  return { sessions, users, purchases, conversionPercent: sessions > 0 ? Math.round((purchases / sessions) * 10000) / 100 : null };
}

// ---------------------------------------------------------------------------------------------
// Hebel und Zuständige

const estimateOf = (s: ShopPulseSignal, estimates: Map<string, ShopPulseLossEstimate | null>): ShopPulseLossEstimate | null =>
  s.lossPerHour && s.lossPerHour > 0 ? { perHour: Math.round(s.lossPerHour), basis: "detector" } : (estimates.get(s.id) ?? null);

export function leverOf(s: ShopPulseSignal, estimate: ShopPulseLossEstimate | null): ShopPulseLever {
  const r = SHOP_PULSE_RESPONSIBILITY[s.code] ?? { owner: "oliver", step: "mirror" };
  return {
    signalId: s.id,
    code: s.code,
    severity: s.severity,
    params: s.params,
    firstSeenAt: s.firstSeenAt,
    perHour: estimate?.perHour ?? null,
    perWeek: estimate ? Math.round(estimate.perHour * WEEK_BUSINESS_HOURS) : null,
    basis: estimate?.basis ?? null,
    owner: r.owner,
    step: r.step,
  };
}

/** Offene, nicht ruhig gestellte Meldungen als Hebel: größter Betrag zuerst, ohne Schätzung danach */
export function rankLevers(signals: ShopPulseSignal[], estimates: Map<string, ShopPulseLossEstimate | null>, now: Date): ShopPulseLever[] {
  return signals
    .filter((s) => s.status === "open" && !isMuted(s, now))
    .map((s) => ({ s, lever: leverOf(s, estimateOf(s, estimates)) }))
    .sort((a, b) => (b.lever.perWeek ?? -1) - (a.lever.perWeek ?? -1) || compareSignals(a.s, b.s))
    .map((x) => x.lever);
}

const BERLIN_SHORT = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** Liste je Zuständigem in fester Reihenfolge, mit deutschem Text zum Weiterleiten */
export function openByOwner(levers: ShopPulseLever[]): ShopPulseOwnerList[] {
  const out: ShopPulseOwnerList[] = [];
  for (const owner of SHOP_PULSE_OWNER_IDS) {
    const mine = levers.filter((l) => l.owner === owner);
    if (!mine.length) continue;
    const listed = mine.slice(0, OWNER_ITEMS_MAX);
    const lines = listed.map((l) => {
      const amount = l.perWeek != null ? ` (geschätzt rund ${EURO.format(l.perWeek)} je Woche)` : "";
      return `- ${signalTitle(l)}${amount}, seit ${BERLIN_SHORT.format(new Date(l.firstSeenAt))}\n  ${signalMessage(l)}\n  Nächster Schritt: ${weeklyNextStepText(l.step)}`;
    });
    if (mine.length > listed.length) lines.push(`- … und ${mine.length - listed.length} weitere (Shop-Puls in METAorder)`);
    out.push({
      owner,
      items: listed.map(({ signalId, code, severity, params, firstSeenAt, perWeek, step }) => ({ signalId, code, severity, params, firstSeenAt, perWeek, step })),
      text: [`Shop-Puls: offen für ${SHOP_PULSE_OWNER_NAMES[owner]} (${mine.length})`, ...lines].join("\n"),
    });
  }
  return out;
}

export const doneOf = (actions: ShopPulseAction[]): ShopPulseWeeklyDone[] =>
  [...actions]
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .map(({ id, occurredAt, kind, title, scope, actor, source }) => ({ id, occurredAt, kind, title, scope: { type: scope.type, values: scope.values.slice(0, 20) }, actor, source }));

export function weeklyReportData(input: {
  numbers: ShopPulseWeeklyNumbers | null;
  signals: ShopPulseSignal[];
  estimates: Map<string, ShopPulseLossEstimate | null>;
  actions: ShopPulseAction[];
  now: Date;
}): ShopPulseWeeklyReportData {
  const all = rankLevers(input.signals, input.estimates, input.now);
  const levers = all.slice(0, LEVERS_MAX);
  return {
    numbers: input.numbers,
    levers,
    leversPerWeek: levers.reduce((s, l) => s + (l.perWeek ?? 0), 0),
    openCount: all.length,
    done: doneOf(input.actions),
    openByOwner: openByOwner(all),
  };
}

// ---------------------------------------------------------------------------------------------
// KI-Text (Zahlenabgleich wie Stufe 1, PR F)

const figuresFacts = (f: ShopPulseWeekFigures | null) =>
  f ? { von: f.from, bis: f.to, bestellungen: f.orders, umsatzBrutto: f.revenue, durchschnittBestellwert: f.aov, deckungsbeitragNetto: f.db1, deckungsbeitragAnteilUmsatzProzent: f.db1CoveragePercent } : null;

/** Eingabedaten der Zusammenfassung, so wie die KI sie sieht und die Prüfung sie abgleicht */
export function weeklyPayload(data: ShopPulseWeeklyReportData, now: Date): Record<string, unknown> {
  const n = data.numbers;
  return promptValue({
    jetzt: now.toISOString(),
    woche: n
      ? {
          ...figuresFacts(n.current),
          vorwoche: figuresFacts(n.previous),
          vorjahr: figuresFacts(n.yearAgo),
          veraenderungProzent: {
            bestellungenZurVorwoche: changePercent(n.current.orders, n.previous.orders),
            umsatzZurVorwoche: changePercent(n.current.revenue, n.previous.revenue),
            bestellungenZumVorjahr: changePercent(n.current.orders, n.yearAgo?.orders),
            umsatzZumVorjahr: changePercent(n.current.revenue, n.yearAgo?.revenue),
          },
          ga4: n.ga4
            ? { sitzungen: n.ga4.current.sessions, nutzer: n.ga4.current.users, kaeufe: n.ga4.current.purchases, conversionProzent: n.ga4.current.conversionPercent, vorwocheSitzungen: n.ga4.previous.sessions, vorwocheConversionProzent: n.ga4.previous.conversionPercent }
            : "nicht eingerichtet",
        }
      : "Zahlen nicht verfügbar (Bestellabgleich hängt)",
    anzahlOffeneMeldungen: data.openCount,
    top5Hebel: data.levers.map((l) => ({
      titel: signalTitle(l),
      schwere: l.severity === "critical" ? "kritisch" : "Warnung",
      seit: l.firstSeenAt,
      geschaetztJeWoche: l.perWeek,
      grundlage: l.basis ? ESTIMATE_BASIS[l.basis] : "nicht abschätzbar",
      zustaendig: SHOP_PULSE_OWNER_NAMES[l.owner],
      naechsterSchritt: weeklyNextStepText(l.step),
    })),
    summeTop5JeWoche: data.leversPerWeek,
    erledigtLetzteWoche: data.done.map((d) => ({ am: d.occurredAt, was: d.title })),
    offenJeZustaendigem: data.openByOwner.map((o) => ({ zustaendig: SHOP_PULSE_OWNER_NAMES[o.owner], anzahl: o.items.length })),
  }) as Record<string, unknown>;
}

const WEEKLY_SYSTEM = [
  "Du schreibst die Zusammenfassung des Shop-Puls-Wochenberichts für den Onlineshop von META Regalbau (shop.meta-online.com). Leser ist Oliver, der Shop-Verantwortliche.",
  ...SHOP_PULSE_AI_RULES,
  "Beträge der Hebel sind Schätzungen: immer als „geschätzt“ kennzeichnen. Veränderungen nur aus veraenderungProzent.",
  "Die Wirkung erledigter Maßnahmen wird noch nicht gemessen: nichts über ihre Wirkung behaupten.",
  `Wer handeln muss: ${SHOP_PULSE_OWNERS.map((o) => `„${o}“ (${OWNER_HINTS[o]})`).join("; ")}.`,
  "zusammenfassung: drei bis fünf kurze Sätze: die Woche in Zahlen gegen Vorwoche und Vorjahr, die größten Hebel, was erledigt wurde. naechsterSchritt: der eine wichtigste nächste Schritt mit Zuständigem.",
  'Antworte nur mit JSON: {"zusammenfassung": "…", "naechsterSchritt": "…"}',
].join("\n");

const field = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

function composeWeekly(json: Record<string, unknown>): string | null {
  const summary = field(json.zusammenfassung);
  const next = field(json.naechsterSchritt);
  if (!summary) return null;
  return next ? `${summary}\nNächster Schritt: ${next}` : summary;
}

/** KI-Zusammenfassung des Wochenberichts (geprüft); text null = Vorlage */
export function weeklyAiText(data: ShopPulseWeeklyReportData, now: Date, ask: AiAsk, timeoutMs = AI_TIMEOUT_MS): Promise<AiTextResult> {
  return askChecked(ask, WEEKLY_SYSTEM, weeklyPayload(data, now), composeWeekly, WEEKLY_AI_MAX_CHARS, timeoutMs);
}
