/**
 * Shop-Puls, KI-Texte (Konzept Stufe 1, Abschnitt 5; PR F): Sofort-Meldungen und Tagesbericht formuliert
 * die KI des Mandanten (chatCompletion, Anbieter aus den KI-Einstellungen). Tests in
 * tests/unit/shopPulseAi.test.ts.
 *
 * Eingabe: der Fund mit params, Belegen, Verlust und Quelle, dazu der Zusammenhang (andere offene
 * Meldungen, vom Shop-Wächter erkannter Deploy, Preisänderungen der betroffenen Artikel). Nur Kennzahlen,
 * keine Kundendaten. Ausgabe deutsch und kurz: Lage, wahrscheinliche Ursache („unklar“ erlaubt),
 * geschätzter Verlust, wer handeln muss, ein nächster Schritt.
 *
 * Prüfregel: Jede Zahl, jedes Datum und jede Uhrzeit im Text muss in den Eingabedaten stehen (deutsche
 * Formate: 1.234,50 €, 12,5 %, 18.10.2026, 14:05; gerundet auf 0–2 Nachkommastellen zählt als dieselbe
 * Zahl). Passt eine nicht, ist die Antwort leer, unbrauchbar oder zu lang, kommt ein Fehler oder dauert es
 * länger als 20 s, geht die feste Vorlage raus (shopPulseNotify.ts). Je Meldung höchstens ein Aufruf je
 * Schwere und Vorfall; auch verworfene Versuche werden gespeichert (ai_note).
 */
import type { IStorage } from "../storage";
import type { ShopWatchDeployChange } from "@shared/shopWatch";
import {
  compareSignals,
  isMuted,
} from "./shopPulseSignals";
import {
  needsAiNote,
  type ShopPulseAiNote,
  type ShopPulseAiRejection,
  type ShopPulseLossEstimate,
  type ShopPulseSignal,
} from "@shared/shopPulse";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse, type ChatMessage } from "../ai/llmChat";
import { logger } from "../lib/logger";
import { getShopWatchState } from "../shopContent/shopWatch";
import { loadPriceChanges, type PriceChange } from "./buyabilityData";
import { estimateLoss, needsOrders, needsProductRevenue, productNumbersOf } from "./lossEstimate";
import type { PulseOrder } from "./pulseOrders";
import type { DailyNumbers } from "./detectors/revenue";
import { saveAiNote } from "./shopPulseRepository";
import { signalMessage, signalTitle } from "./shopPulseNotify";

const log = logger.child({ component: "shopPulse/shopPulseAi" });

export const AI_TIMEOUT_MS = 20_000;
export const NOTICE_MAX_CHARS = 900;
export const DAILY_MAX_CHARS = 1200;
const FIELD_MAX_CHARS = 400;
/** So viele Meldungen ohne Text bekommen je Lauf zusätzlich einen (Warnungen, Lernwoche) */
export const AI_BACKLOG_PER_RUN = 3;
const CONTEXT_SIGNALS = 10;
const DEPLOY_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const PRICE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ARRAY = 15;
const MAX_STRING = 300;

/** Wer handeln muss (Antwort der KI muss einer davon sein) */
export const SHOP_PULSE_OWNERS = ["Agentur wirduzen", "Jana (PIM)", "Vertrieb", "Marketing/Smarketer", "Oliver"] as const;
export const OWNER_HINTS: Record<(typeof SHOP_PULSE_OWNERS)[number], string> = {
  "Agentur wirduzen": "Shopware, Plugins, Theme, Storefront, Warenkorb, Kasse, Zahl- und Versandarten technisch",
  "Jana (PIM)": "Artikeldaten aus Pimcore: Preise, Aktiv-Status, Lieferzeiten, Bilder, Kategorien",
  Vertrieb: "Bestellrückgang oder Umsatzrückgang ohne technischen Befund, Kunden, Konditionen",
  "Marketing/Smarketer": "Besucher, Kanäle, Kampagnen, Landingpages, Suche, GA4-Messung",
  Oliver: "Bestellabgleich/Spiegel in METAorder, Einstellungen, Entscheidungen, wenn niemand sonst passt",
};

// ---------------------------------------------------------------------------------------------
// Zahlen in Texten

const BERLIN_DATE_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Zeitpunkt deutsch in Berlin („18.10.2026, 14:05“) */
export const berlinDateTime = (d: Date | string) => BERLIN_DATE_TIME.format(typeof d === "string" ? new Date(d) : d);
const germanDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export type TextNumbers = {
  numbers: number[];
  /** Tag.Monat bzw. Tag.Monat.Jahr ("18.10", "18.10.2026") */
  dates: string[];
  /** Stunde:Minute ("14:05" → "14:5") */
  times: string[];
  /** wie im Text geschrieben (für die Meldung im Protokoll) */
  raw: string[];
};

const DATE_RE = /(?<![\p{L}\d.,:])(\d{1,2})\.(\d{1,2})\.(\d{4})?(?![\d])/gu;
const TIME_RE = /(?<![\p{L}\d.,:])(\d{1,2}):(\d{2})(?![\d:])/gu;
// Ziffern direkt an Buchstaben (GA4, B2B, SW10001, MO12345) sind Namen, keine Zahlen
const NUMBER_RE = /(?<![\p{L}\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu;

function parseNumber(s: string): number {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s.replace(",", "."));
}

/** Zahlen, Datumsangaben und Uhrzeiten eines Textes (deutsche Schreibweise, Englisch zur Not) */
export function textNumbers(text: string): TextNumbers {
  const out: TextNumbers = { numbers: [], dates: [], times: [], raw: [] };
  let rest = text.replace(DATE_RE, (m, d: string, mo: string, y: string | undefined) => {
    const day = Number(d);
    const month = Number(mo);
    if (day < 1 || day > 31 || month < 1 || month > 12) return m;
    out.dates.push(y ? `${day}.${month}.${y}` : `${day}.${month}`);
    out.raw.push(m);
    return " ";
  });
  rest = rest.replace(TIME_RE, (m, h: string, mi: string) => {
    if (Number(h) > 23 || Number(mi) > 59) return m;
    out.times.push(`${Number(h)}:${Number(mi)}`);
    out.raw.push(m);
    return " ";
  });
  for (const m of Array.from(rest.matchAll(NUMBER_RE))) {
    const v = parseNumber(m[1]);
    if (!Number.isFinite(v)) continue;
    out.numbers.push(v);
    out.raw.push(m[1]);
  }
  return out;
}

const canonical = (v: number, digits = 2) => String(Number(Math.abs(v).toFixed(digits)));

export type AllowedNumbers = { numbers: Set<string>; dates: Set<string>; times: Set<string> };

/** Alles, was in den Eingabedaten an Zahlen steht (Zahlwerte und Zahlen in Texten) */
export function allowedNumbers(input: unknown): AllowedNumbers {
  const allowed: AllowedNumbers = { numbers: new Set(), dates: new Set(), times: new Set() };
  const addNumber = (v: number) => {
    for (const d of [0, 1, 2]) allowed.numbers.add(canonical(v, d));
    // Anteile (0,04) dürfen als Prozent (4 %) stehen
    if (Math.abs(v) < 1 && v !== 0) for (const d of [0, 1]) allowed.numbers.add(canonical(v * 100, d));
  };
  const addText = (s: string) => {
    const t = textNumbers(s);
    t.numbers.forEach(addNumber);
    for (const d of t.dates) {
      allowed.dates.add(d);
      const [day, month, year] = d.split(".");
      allowed.dates.add(`${day}.${month}`);
      [day, month, year].filter(Boolean).forEach((x) => addNumber(Number(x)));
    }
    for (const time of t.times) {
      allowed.times.add(time);
      time.split(":").forEach((x) => addNumber(Number(x)));
    }
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") addNumber(v);
    else if (typeof v === "string") addText(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return allowed;
}

/** Zahlen im Text, die nicht in den Eingabedaten stehen (leer = Text besteht die Prüfung) */
export function unknownNumbers(text: string, allowed: AllowedNumbers): string[] {
  const t = textNumbers(text);
  const bad: string[] = [];
  for (const n of t.numbers) if (!allowed.numbers.has(canonical(n))) bad.push(String(n));
  for (const d of t.dates) if (!allowed.dates.has(d)) bad.push(d);
  for (const time of t.times) if (!allowed.times.has(time)) bad.push(time);
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Eingabedaten

/** Für den Prompt: Zeitpunkte deutsch in Berlin, Listen und Texte gekürzt */
export function promptValue(v: unknown, depth = 0): unknown {
  if (typeof v === "string") {
    if (ISO_DATE_TIME.test(v) && !Number.isNaN(Date.parse(v))) return berlinDateTime(v);
    if (ISO_DATE.test(v)) return germanDay(v);
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING - 1)}…` : v;
  }
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (v instanceof Date) return berlinDateTime(v);
  if (Array.isArray(v)) {
    const list = v.slice(0, MAX_ARRAY).map((x) => promptValue(x, depth + 1));
    return v.length > MAX_ARRAY ? [...list, `… und ${v.length - MAX_ARRAY} weitere`] : list;
  }
  if (v && typeof v === "object") {
    if (depth > 4) return null;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, promptValue(x, depth + 1)]));
  }
  return v ?? null;
}

export type DeployEvent = { at: string; changes: ShopWatchDeployChange[] };

export type NoticeAiInput = {
  signal: ShopPulseSignal;
  estimate: ShopPulseLossEstimate | null;
  now: Date;
  /** andere offene Meldungen */
  others: ShopPulseSignal[];
  deploys: DeployEvent[];
  priceChanges: PriceChange[];
};

export const ESTIMATE_BASIS: Record<ShopPulseLossEstimate["basis"], string> = {
  detector: "von der Prüfung selbst geschätzt",
  products: "Shop-Umsatz der betroffenen Artikel (365 Tage, je Geschäftsstunde 7–19 Uhr)",
  paymentShare: "Anteil der Zahlart an den Shop-Bestellungen der letzten 8 Wochen × üblicher Umsatz dieser Tageszeit",
  hourOfDay: "üblicher Shop-Umsatz dieser Tageszeit (gleiche Stunde ±1, letzte 8 gleiche Wochentage)",
};

const deployFacts = (deploys: DeployEvent[]) =>
  deploys.map((d) => ({ erkanntAm: d.at, aenderungen: d.changes.map((c) => ({ was: c.field, vorher: c.before, nachher: c.after })) }));

/** Eingabedaten einer Meldung, so wie die KI sie sieht und die Prüfung sie abgleicht */
export function noticePayload(input: NoticeAiInput): Record<string, unknown> {
  const s = input.signal;
  return promptValue({
    jetzt: input.now.toISOString(),
    meldung: {
      titel: signalTitle(s),
      beschreibung: signalMessage(s),
      art: s.code,
      schwere: s.severity === "critical" ? "kritisch" : "Warnung",
      quelle: s.source,
      seit: s.firstSeenAt,
      zuletztGesehen: s.lastSeenAt,
      parameter: s.params,
      belege: s.evidence,
      verlustProStunde: input.estimate ? { euro: input.estimate.perHour, grundlage: ESTIMATE_BASIS[input.estimate.basis] } : null,
    },
    weitereOffeneMeldungen: input.others.slice(0, CONTEXT_SIGNALS).map((o) => ({
      titel: signalTitle(o),
      schwere: o.severity === "critical" ? "kritisch" : "Warnung",
      seit: o.firstSeenAt,
    })),
    deployLautShopWaechter: deployFacts(input.deploys),
    preisaenderungenBetroffenerArtikel: input.priceChanges.map((c) => ({
      artikel: c.productNumber,
      vorherBrutto: c.oldPriceGross,
      nachherBrutto: c.newPriceGross,
      am: c.changedAt,
    })),
  }) as Record<string, unknown>;
}

export const SHOP_PULSE_AI_RULES = [
  "Verwende ausschließlich Zahlen, Datumsangaben und Uhrzeiten, die genau so in den Eingabedaten stehen. Rechne nichts aus, erfinde keine Zahlen. Deutsches Format (1.234 €, 12,5 %, 18.10.2026, 14:05).",
  "Erfinde keine Ursachen. Nenne eine Ursache nur, wenn die Eingabedaten sie nahelegen (z. B. Deploy kurz vor dem Fund, Preisänderung des Artikels, andere offene Meldung). Sonst schreibe „unklar“.",
  "Kein Markdown, keine Aufzählungen, keine Kundendaten, keine Anrede.",
];

const NOTICE_SYSTEM = [
  "Du schreibst kurze Meldungen des Shop-Puls für den Onlineshop von META Regalbau (shop.meta-online.com). Leser ist Oliver, der Shop-Verantwortliche.",
  ...SHOP_PULSE_AI_RULES,
  "verlust: nur verlustProStunde aus den Eingabedaten, als Euro pro Stunde (es ist eine Schätzung). Ist er null, schreibe „nicht abschätzbar“.",
  `zustaendig: genau einer von: ${SHOP_PULSE_OWNERS.map((o) => `„${o}“ (${OWNER_HINTS[o]})`).join("; ")}.`,
  "Jedes Feld ein kurzer Satz, höchstens zwei.",
  'Antworte nur mit JSON: {"lage": "was los ist", "ursache": "wahrscheinliche Ursache oder unklar", "verlust": "…", "zustaendig": "…", "naechsterSchritt": "ein konkreter nächster Schritt"}',
].join("\n");

const DAILY_SYSTEM = [
  "Du schreibst die Zusammenfassung des Shop-Puls-Tagesberichts für den Onlineshop von META Regalbau (shop.meta-online.com). Leser ist Oliver, der Shop-Verantwortliche.",
  ...SHOP_PULSE_AI_RULES,
  "Verluste nur aus verlustProStunde der Meldungen und immer als Schätzung kennzeichnen („geschätzt“).",
  `Wer handeln muss: ${SHOP_PULSE_OWNERS.map((o) => `„${o}“ (${OWNER_HINTS[o]})`).join("; ")}.`,
  "zusammenfassung: zwei bis vier kurze Sätze zu Zahlen von gestern und den wichtigsten offenen Meldungen. naechsterSchritt: der eine wichtigste nächste Schritt mit Zuständigem.",
  'Antworte nur mit JSON: {"zusammenfassung": "…", "naechsterSchritt": "…"}',
].join("\n");

// ---------------------------------------------------------------------------------------------
// Aufruf und Prüfung

export class AiTimeoutError extends Error {
  constructor(ms: number) {
    super(`KI-Antwort nach ${ms} ms abgebrochen`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError(ms)), ms);
    (timer as any)?.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export type AiAsk = (messages: ChatMessage[]) => Promise<string>;

export type AiTextResult = { text: string | null; rejected?: ShopPulseAiRejection; badNumbers?: string[] };

const field = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const OWNER_WORDS: Array<[RegExp, (typeof SHOP_PULSE_OWNERS)[number]]> = [
  [/wirduzen|agentur/i, "Agentur wirduzen"],
  [/jana|pim/i, "Jana (PIM)"],
  [/vertrieb/i, "Vertrieb"],
  [/marketing|smarketer/i, "Marketing/Smarketer"],
  [/oliver/i, "Oliver"],
];
/** Zuständiger aus der Antwort, auf die feste Schreibweise gebracht; genau einer, sonst undefined */
const ownerOf = (v: string) => {
  const hits = OWNER_WORDS.filter(([re]) => re.test(v)).map(([, o]) => o);
  return hits.length === 1 ? hits[0] : undefined;
};

/** KI fragen, JSON-Antwort zusammensetzen und jede Zahl gegen die Eingabedaten prüfen (auch Wochenbericht) */
export async function askChecked(
  ask: AiAsk,
  system: string,
  payload: Record<string, unknown>,
  compose: (json: Record<string, unknown>) => string | null,
  maxChars: number,
  timeoutMs: number,
): Promise<AiTextResult> {
  let raw: string;
  try {
    raw = await withTimeout(ask([{ role: "system", content: system }, { role: "user", content: `Eingabedaten:\n${JSON.stringify(payload, null, 1)}` }]), timeoutMs);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message.slice(0, 300) : String(err) }, "Shop-Puls: KI-Aufruf fehlgeschlagen");
    return { text: null, rejected: err instanceof AiTimeoutError ? "timeout" : "error" };
  }
  const json = parseLlmJsonResponse(raw);
  const text = json && typeof json === "object" && !Array.isArray(json) ? compose(json as Record<string, unknown>) : null;
  if (!text) return { text: null, rejected: "empty" };
  if (text.length > maxChars) return { text: null, rejected: "tooLong" };
  const bad = unknownNumbers(text, allowedNumbers(payload));
  if (bad.length) return { text: null, rejected: "number", badNumbers: bad.slice(0, 10) };
  return { text };
}

/** Text einer Meldung aus der JSON-Antwort; null = Pflichtfeld fehlt, zu lang oder unbekannter Zuständiger */
function composeNotice(json: Record<string, unknown>): string | null {
  const lage = field(json.lage);
  const ursache = field(json.ursache) || "unklar";
  const verlust = field(json.verlust) || "nicht abschätzbar";
  const owner = ownerOf(field(json.zustaendig));
  const next = field(json.naechsterSchritt);
  if (!lage || !next || !owner) return null;
  if ([lage, ursache, verlust, next].some((x) => x.length > FIELD_MAX_CHARS)) return null;
  // „Schätzung“ steht im Etikett, damit der Verlust immer als solche kenntlich ist
  return [lage, `Ursache: ${ursache}`, `Verlust (Schätzung): ${verlust}`, `Zuständig: ${owner}`, `Nächster Schritt: ${next}`].join("\n");
}

function composeDaily(json: Record<string, unknown>): string | null {
  const summary = field(json.zusammenfassung);
  const next = field(json.naechsterSchritt);
  if (!summary) return null;
  if (summary.length > DAILY_MAX_CHARS || next.length > FIELD_MAX_CHARS) return null;
  return next ? `${summary}\nNächster Schritt: ${next}` : summary;
}

/** KI-Text einer Meldung (geprüft); bei jedem Problem text null und der Grund */
export function noticeAiText(input: NoticeAiInput, ask: AiAsk, timeoutMs = AI_TIMEOUT_MS): Promise<AiTextResult> {
  return askChecked(ask, NOTICE_SYSTEM, noticePayload(input), composeNotice, NOTICE_MAX_CHARS, timeoutMs);
}

export type DailyAiInput = {
  now: Date;
  signals: ShopPulseSignal[];
  numbers: DailyNumbers | null;
  estimates: Map<string, ShopPulseLossEstimate | null>;
  deploys: DeployEvent[];
};

export function dailyPayload(input: DailyAiInput): Record<string, unknown> {
  const n = input.numbers;
  return promptValue({
    jetzt: input.now.toISOString(),
    zahlen: n
      ? {
          zeitraum: n.period === "weekend" ? "Wochenende" : "gestern",
          tage: n.days,
          bestellungen: n.current.orders,
          umsatzBrutto: n.current.revenue,
          durchschnittBestellwert: n.current.aov,
          schnitt4WochenBestellungen: n.previous4.orders,
          schnitt4WochenUmsatz: n.previous4.revenue,
          vorjahr: n.yearAgo ? { bestellungen: n.yearAgo.orders, umsatzBrutto: n.yearAgo.revenue } : null,
        }
      : null,
    anzahlOffeneMeldungen: input.signals.length,
    anzahlKritisch: input.signals.filter((s) => s.severity === "critical").length,
    offeneMeldungen: input.signals.slice(0, 12).map((s) => {
      const e = input.estimates.get(s.id) ?? null;
      return {
        titel: signalTitle(s),
        schwere: s.severity === "critical" ? "kritisch" : "Warnung",
        seit: s.firstSeenAt,
        verlustProStunde: e ? { euro: e.perHour, grundlage: ESTIMATE_BASIS[e.basis] } : null,
      };
    }),
    deployLautShopWaechter: deployFacts(input.deploys),
  }) as Record<string, unknown>;
}

/** KI-Zusammenfassung des Tagesberichts (geprüft) */
export function dailyAiText(input: DailyAiInput, ask: AiAsk, timeoutMs = AI_TIMEOUT_MS): Promise<AiTextResult> {
  return askChecked(ask, DAILY_SYSTEM, dailyPayload(input), composeDaily, DAILY_MAX_CHARS, timeoutMs);
}

// ---------------------------------------------------------------------------------------------
// Anbindung an den Lauf

export type ShopPulseAiDeps = {
  /** KI-Anbieter des Mandanten eingerichtet */
  configured(tenantId: string | null): Promise<boolean>;
  ask(tenantId: string | null, messages: ChatMessage[]): Promise<string>;
  saveNote(tenantId: string | null, id: string, note: ShopPulseAiNote): Promise<void>;
  /** vom Shop-Wächter erkannte Deploys seit dem Zeitpunkt */
  deploys(tenantId: string | null, since: Date): Promise<DeployEvent[]>;
  priceChanges(tenantId: string | null, since: Date): Promise<PriceChange[]>;
  timeoutMs?: number;
};

type AiStore = Pick<IStorage, "getSetting" | "saveSetting" | "getShopwareSettings">;

/** Echte Anbindung: KI des Mandanten, Spalte ai_note, Stand des Shop-Wächters, Preis-Historie */
export function shopPulseAiDeps(storage: AiStore): ShopPulseAiDeps {
  const getSetting = (tenantId: string | null) => (key: string) => storage.getSetting(key, tenantId);
  return {
    configured: (tenantId) => isChatLlmConfigured(getSetting(tenantId)),
    ask: (tenantId, messages) =>
      chatCompletion(getSetting(tenantId), { tier: "fast", temperature: 0, response_json: true, max_tokens: 800, messages }),
    saveNote: saveAiNote,
    deploys: async (tenantId, since) => {
      const state = await getShopWatchState(storage, tenantId);
      return (state.history ?? [])
        .filter((h) => h.deployChanges?.length && Date.parse(h.startedAt) >= since.getTime())
        .map((h) => ({ at: h.startedAt, changes: h.deployChanges }));
    },
    priceChanges: loadPriceChanges,
  };
}

export type ShopPulseAiRun = {
  tenantId: string | null;
  now: Date;
  /** null = KI aus (Schalter, kein Anbieter, Shop-Puls aus): nur Schätzung, Vorlage */
  ai: ShopPulseAiDeps | null;
  orders: () => Promise<PulseOrder[]>;
  productRevenue: () => Promise<Map<string, number>>;
  /** offene Meldungen nach dem Abgleich (für den Zusammenhang) */
  openSignals: () => Promise<ShopPulseSignal[]>;
};

/** Geschätzter Verlust einer Meldung; fehlende Daten heißen „keine Schätzung“, nie ein Fehler */
export async function lossEstimateFor(signal: ShopPulseSignal, run: Pick<ShopPulseAiRun, "now" | "orders" | "productRevenue">): Promise<ShopPulseLossEstimate | null> {
  const productRevenue = needsProductRevenue(signal) ? await run.productRevenue().catch(() => null) : null;
  const orders = needsOrders(signal) ? await run.orders().catch(() => null) : null;
  return estimateLoss(signal, { orders, productRevenue, now: run.now });
}

const affectedProducts = (s: ShopPulseSignal) =>
  new Set([...(typeof s.params.number === "string" && s.params.number ? [s.params.number] : []), ...productNumbersOf(s.evidence)]);

/** KI-Text für eine Meldung schreiben und speichern (auch verworfene Versuche); liefert die Notiz */
export async function writeSignalNote(signal: ShopPulseSignal, estimate: ShopPulseLossEstimate | null, run: ShopPulseAiRun & { ai: ShopPulseAiDeps }): Promise<ShopPulseAiNote> {
  const { ai, tenantId, now } = run;
  const since = Math.min(Date.parse(signal.firstSeenAt), now.getTime()) - DEPLOY_LOOKBACK_MS;
  const products = affectedProducts(signal);
  const [others, deploys, priceChanges] = await Promise.all([
    run.openSignals().then((list) => list.filter((o) => o.id !== signal.id).sort(compareSignals)).catch(() => []),
    ai.deploys(tenantId, new Date(since)).catch(() => []),
    products.size ? ai.priceChanges(tenantId, new Date(now.getTime() - PRICE_LOOKBACK_MS)).then((l) => l.filter((c) => products.has(c.productNumber)).slice(0, 10)).catch(() => []) : Promise.resolve([]),
  ]);
  const result = await noticeAiText({ signal, estimate, now, others, deploys, priceChanges }, (m) => ai.ask(tenantId, m), ai.timeoutMs);
  const note: ShopPulseAiNote = {
    severity: signal.severity,
    at: now.toISOString(),
    text: result.text,
    ...(result.rejected ? { rejected: result.rejected } : {}),
    ...(result.badNumbers ? { badNumbers: result.badNumbers } : {}),
    lossEstimate: estimate,
  };
  if (result.rejected) log.warn({ tenantId, key: signal.key, rejected: result.rejected, badNumbers: result.badNumbers }, "Shop-Puls: KI-Text verworfen, Vorlage");
  try {
    await ai.saveNote(tenantId, signal.id, note);
  } catch (err) {
    log.warn({ err, tenantId, key: signal.key }, "Shop-Puls: KI-Text nicht gespeichert");
  }
  return note;
}

/**
 * Offene Meldungen ohne passenden KI-Text (Warnungen, Lernwoche, nach dem Einschalten) nachziehen:
 * höchstens AI_BACKLOG_PER_RUN je Lauf, wichtigste zuerst, nicht ruhig gestellte.
 */
export async function writeBacklogNotes(run: ShopPulseAiRun & { ai: ShopPulseAiDeps }, skipIds: Set<string>): Promise<number> {
  const open = await run.openSignals().catch(() => []);
  const todo = open
    .filter((s) => !skipIds.has(s.id) && needsAiNote(s) && !isMuted(s, run.now))
    .sort(compareSignals)
    .slice(0, AI_BACKLOG_PER_RUN);
  for (const s of todo) s.aiNote = await writeSignalNote(s, await lossEstimateFor(s, run), run);
  return todo.length;
}
