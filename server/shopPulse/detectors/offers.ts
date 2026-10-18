/**
 * Shop-Puls Stufe 2 (S2-2), Prüfung „Angebotsanfragen-Wache“ (Konzept 18.10.2026, Abschnitt 3): B2B-Angebots-
 * anfragen aus Shop und Portal (B2Bsellers, Status „Angefragt von Kunde“), die nach einem Werktag noch
 * unbeantwortet sind. Rein bis auf den Detektor selbst; Tests in tests/unit/shopPulseOffers.test.ts.
 *
 * - Alter in Werktagen (Berlin, Montag bis Freitag, ohne Feiertage): nur die Zeit an Werktagen zählt. Eine
 *   Anfrage vom Freitag 15 Uhr ist am Montag 15 Uhr einen Werktag alt.
 * - Ab 1 Werktag Warnung (Tagesbericht), kritisch (sofort) ab 3 Werktagen oder ab 2.500 € netto. Die
 *   Wertschwelle ist das 90-%-Quantil der MO-Bestellungen, die 2026 aus Angeboten entstanden sind (Live-Spiegel
 *   18.10.2026: 175 Bestellungen, Median 587 €, 90 % 2.409 €, 95 % 4.423 € netto): die oberen gut 10 %.
 * - Leere Anfragen (0 Positionen) sind ein Datenfehler (so bei LogiServ im Oktober 2026): eigene Meldung,
 *   ab einer Stunde nach Eingang, nie kritisch.
 * - Anfragen älter als 4 Wochen (20 Werktage) stehen fast immer nur noch im Status, beantwortet wurden sie
 *   anderswo (Telefon, E-Mail, SAP). Sie kommen gesammelt in eine Warnung „Status pflegen“, sonst würde der
 *   Altbestand jeden Tagesbericht füllen.
 * - Zuständig: der Außendienst laut Zuordnung (Kundennummer → Außendienst), sonst der Standard-Bearbeiter
 *   aus den Einstellungen des E-Mail-Eingangs.
 * - Beim allerersten Lauf ist alles still (quiet): der Altbestand steht im Tagesbericht, aber nach dem Deploy
 *   kommen nicht Dutzende Nachrichten auf einmal.
 *
 * Nur lesend: eine Suche je 100 Anfragen über die Admin-API, nacheinander, höchstens einmal je Stunde.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import type { ShopPulseAssigneeSource } from "@shared/shopPulseWeekly";
import { addDays, berlinTime, weekdayOfDay } from "../pulseOrders";
import { berlinMidnight } from "../weeklyReport";
import type { ShopPulseDetector } from "./types";

/** Ab so vielen Werktagen ohne Antwort wird gemeldet (Konzept: Vorschlag 1 Werktag) */
export const OFFER_DUE_BUSINESS_DAYS = 1;
/** Ab so vielen Werktagen kritisch */
export const OFFER_CRITICAL_BUSINESS_DAYS = 3;
/** Ab diesem Wert (netto) kritisch, sobald fällig */
export const OFFER_HIGH_VALUE_NET = 2500;
/** Älter: nur noch in der Sammelmeldung */
export const OFFER_BACKLOG_BUSINESS_DAYS = 20;
/** Leere Anfrage erst nach dieser Zeit melden (falls die Positionen noch nachkommen) */
export const OFFER_EMPTY_MIN_MINUTES = 60;
/** Prüfung höchstens so oft */
export const OFFER_CHECK_MINUTES = 60;

export const OFFER_KEY_PREFIX = "b2b:offer";
export const OFFER_BACKLOG_KEY = "b2b:offers:backlog";

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Angebotsanfrage, wie die Prüfung sie braucht (offerRequests.ts liest sie aus B2Bsellers) */
export type OfferRequest = {
  id: string;
  number: string;
  createdAt: string;
  /** Firma, sonst Name bzw. E-Mail des Ansprechpartners */
  customer: string;
  customerNumber: string;
  customerEmail: string;
  salesChannelId: string;
  net: number;
  gross: number;
  positions: number;
};

export type OfferAssignee = { name: string; email: string | null };

export type OfferWatchSources = {
  /** offene Anfragen (Status „Angefragt von Kunde“) der letzten 365 Tage */
  requests(): Promise<OfferRequest[]>;
  /** Außendienst je Kundennummer (nur die gefundenen) */
  salesReps(customerNumbers: string[]): Promise<Map<string, OfferAssignee>>;
  /** Standard-Bearbeiter (E-Mail-Eingang); null = keiner eingestellt */
  defaultAssignee(): Promise<OfferAssignee | null>;
  /** Name je Verkaufskanal */
  channelNames(ids: string[]): Promise<Map<string, string>>;
};

/** Zeit an Werktagen (Berlin, Mo–Fr) zwischen zwei Zeitpunkten, in Tagen (mit Bruchteil) */
export function businessDaysBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;
  let ms = 0;
  let day = berlinTime(start).day;
  const last = berlinTime(end).day;
  for (let guard = 0; day <= last && guard < 800; guard++) {
    if (weekdayOfDay(day) <= 5) {
      const from = Math.max(start.getTime(), berlinMidnight(day).getTime());
      const to = Math.min(end.getTime(), berlinMidnight(addDays(day, 1)).getTime());
      if (to > from) ms += to - from;
    }
    day = addDays(day, 1);
  }
  return ms / DAY_MS;
}

export type OfferWatchInput = {
  now: Date;
  reps: Map<string, OfferAssignee>;
  fallback: OfferAssignee | null;
  channels: Map<string, string>;
  /** erster Lauf der Prüfung: alles still */
  firstRun: boolean;
};

function assigneeOf(r: OfferRequest, input: OfferWatchInput): OfferAssignee & { source: ShopPulseAssigneeSource } {
  const rep = r.customerNumber ? input.reps.get(r.customerNumber) : undefined;
  if (rep) return { ...rep, source: "rep" };
  if (input.fallback) return { ...input.fallback, source: "default" };
  return { name: "–", email: null, source: "none" };
}

/** Funde aus den offenen Anfragen */
export function offerWatchDetections(requests: OfferRequest[], input: OfferWatchInput): ShopPulseDetection[] {
  const out: ShopPulseDetection[] = [];
  const backlog: Array<{ r: OfferRequest; days: number }> = [];
  const quiet = input.firstRun ? { quiet: true } : {};
  for (const r of requests) {
    const created = new Date(r.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const days = businessDaysBetween(created, input.now);
    if (days > OFFER_BACKLOG_BUSINESS_DAYS) {
      backlog.push({ r, days });
      continue;
    }
    const empty = r.positions === 0;
    const minutes = (input.now.getTime() - created.getTime()) / 60000;
    if (empty ? minutes < OFFER_EMPTY_MIN_MINUTES : days < OFFER_DUE_BUSINESS_DAYS) continue;
    const a = assigneeOf(r, input);
    const channel = input.channels.get(r.salesChannelId) ?? "";
    const highValue = r.net >= OFFER_HIGH_VALUE_NET;
    const params = {
      offerNumber: r.number,
      customer: r.customer,
      customerNumber: r.customerNumber || "–",
      since: berlinTime(created).day,
      businessDays: Math.floor(days),
      assignee: a.email && a.name !== a.email ? `${a.name} (${a.email})` : a.name,
      channel: channel || "–",
      positions: r.positions,
      ...(empty ? {} : { net: round2(r.net) }),
    };
    const evidence = {
      offerId: r.id,
      createdAt: created.toISOString(),
      net: round2(r.net),
      gross: round2(r.gross),
      customerEmail: r.customerEmail,
      salesChannelId: r.salesChannelId,
      assigneeSource: a.source,
      assigneeEmail: a.email,
      highValue,
    };
    out.push({
      key: `${OFFER_KEY_PREFIX}:${r.id}`,
      source: "b2b",
      code: empty ? "offerEmpty" : "offerUnanswered",
      severity: !empty && (days >= OFFER_CRITICAL_BUSINESS_DAYS || highValue) ? "critical" : "warning",
      params,
      evidence,
      ...quiet,
    });
  }
  if (backlog.length) {
    backlog.sort((a, b) => b.days - a.days);
    const oldest = backlog[0].r;
    out.push({
      key: OFFER_BACKLOG_KEY,
      source: "b2b",
      code: "offerBacklog",
      severity: "warning",
      params: {
        count: backlog.length,
        net: round2(backlog.reduce((s, x) => s + x.r.net, 0)),
        oldestNumber: oldest.number,
        oldestSince: berlinTime(new Date(oldest.createdAt)).day,
      },
      evidence: {
        offers: backlog.slice(0, 50).map(({ r }) => ({ id: r.id, number: r.number, customer: r.customer, createdAt: r.createdAt, net: round2(r.net), positions: r.positions })),
      },
      ...quiet,
    });
  }
  return out;
}

/** Fällig: noch nie gelaufen oder der letzte Lauf ist mindestens eine Stunde her (5 Minuten Spiel für den Takt) */
export function isOfferWatchDue(prev: { at: string } | undefined, now: Date): boolean {
  return !prev || now.getTime() - Date.parse(prev.at) >= (OFFER_CHECK_MINUTES - 5) * 60 * 1000;
}

export const offerWatchDetector: ShopPulseDetector = {
  id: "offerWatch",
  source: "b2b",
  due: isOfferWatchDue,
  async run({ now, b2b, firstRun }) {
    const requests = await b2b.requests();
    const numbers = Array.from(new Set(requests.map((r) => r.customerNumber).filter(Boolean)));
    const reps = numbers.length ? await b2b.salesReps(numbers) : new Map<string, OfferAssignee>();
    const fallback = await b2b.defaultAssignee();
    const channelIds = Array.from(new Set(requests.map((r) => r.salesChannelId).filter(Boolean)));
    const channels = channelIds.length ? await b2b.channelNames(channelIds) : new Map<string, string>();
    return offerWatchDetections(requests, { now, reps, fallback, channels, firstRun });
  },
};
