/**
 * Shop-Puls, Nachrichten: Teams-Karten (Direktnachricht über n8n) und Texte für die Glocke. Texte kommen
 * aus dem deutschen Übersetzungskatalog der Oberfläche (shopPulse.codes.*, shopPulse.notify.*), damit Seite
 * und Teams dasselbe sagen. Hat die KI einen geprüften Text geschrieben (shopPulseAi.ts, PR F), steht er
 * an Stelle der Vorlage; die Fakten (seit, zuletzt, Verlust) bleiben aus der Vorlage.
 */
import deLocale from "../../client/src/i18n/locales/de.json";
import { currentAiText, formatShopPulseParams, type ShopPulseLossEstimate, type ShopPulseSignal } from "@shared/shopPulse";
import { adaptiveCardMessage, teamsPlain } from "../lib/teamsOutbox";
import type { ShopPulseNotice } from "./shopPulseSignals";
import type { DailyNumbers } from "./detectors/revenue";
import {
  changePercent,
  SHOP_PULSE_OWNER_NAMES,
  type ShopPulseActionScope,
  type ShopPulseLever,
  type ShopPulseNextStep,
  type ShopPulseOwnerId,
  type ShopPulseWeekFigures,
  type ShopPulseWeeklyNumbers,
  type ShopPulseWeeklyReport,
} from "@shared/shopPulseWeekly";

export const SHOP_PULSE_PAGE_PATH = "/admin/shop-puls";
/** So viele Meldungen stehen höchstens im Tagesbericht */
const MAX_LISTED = 12;

const de = (deLocale as { shopPulse: Record<string, any> }).shopPulse;

function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : ""));
}

const t = (path: string, params?: Record<string, string | number>): string => {
  const value = path.split(".").reduce<any>((o, k) => (o && typeof o === "object" ? o[k] : undefined), de);
  return typeof value === "string" ? interpolate(value, params) : path;
};


const BERLIN_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const BERLIN_DATE = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const INTEGER = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const DECIMAL1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const PERCENT1 = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1 });
const dayDate = (isoDay: string) => BERLIN_DATE.format(new Date(`${isoDay}T12:00:00Z`));

const params = (s: Pick<ShopPulseSignal, "code" | "params">) =>
  formatShopPulseParams(s.code, s.params, { money: (v) => EURO.format(v), date: dayDate, number: (v) => INTEGER.format(v), percent: (v) => PERCENT1.format(v / 100) });

export const signalTitle = (s: Pick<ShopPulseSignal, "code" | "params">) => t(`codes.${s.code}.title`, params(s));
export const signalMessage = (s: Pick<ShopPulseSignal, "code" | "params">) => t(`codes.${s.code}.message`, params(s));

/** Zahlen von gestern (montags vom Wochenende) mit Vergleich, je Zeile ein Text */
export function dailyNumbersLines(n: DailyNumbers): string[] {
  const head =
    n.period === "weekend"
      ? t("notify.numbersWeekend", { from: dayDate(n.days[0]), to: dayDate(n.days[n.days.length - 1]) })
      : t("notify.numbersYesterday", { date: dayDate(n.days[0]) });
  return [
    `${head}: ${t("notify.numbersLine", { orders: INTEGER.format(n.current.orders), revenue: EURO.format(n.current.revenue), aov: EURO.format(n.current.aov) })}`,
    t("notify.numbersPrev", { orders: DECIMAL1.format(n.previous4.orders), revenue: EURO.format(n.previous4.revenue) }),
    n.yearAgo ? t("notify.numbersYear", { orders: INTEGER.format(n.yearAgo.orders), revenue: EURO.format(n.yearAgo.revenue) }) : t("notify.numbersNoYear"),
  ];
}

const ICON = { critical: "🔴", warning: "🟡", resolved: "✅" } as const;

function pageUrl(baseUrl: string | null, query = ""): string | null {
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${SHOP_PULSE_PAGE_PATH}${query}` : null;
}

function noticeHeading(notice: ShopPulseNotice): string {
  const title = signalTitle(notice.signal);
  if (notice.kind === "resolved") return `${ICON.resolved} ${t("notify.resolvedPrefix")}: ${title}`;
  if (notice.kind === "escalated") return `${ICON.critical} ${t("notify.escalatedPrefix")}: ${title}`;
  return `${ICON[notice.signal.severity]} ${title}`;
}

/** Geschätzter Verlust als Text: von der Prüfung wie bisher, sonst mit der Grundlage der Schätzung */
function lossText(s: ShopPulseSignal, estimate: ShopPulseLossEstimate | null): string | null {
  if (s.lossPerHour) return t("notify.lossValue", { amount: EURO.format(s.lossPerHour) });
  if (estimate) return t("notify.lossEstimateValue", { amount: EURO.format(estimate.perHour), basis: t(`lossBasis.${estimate.basis}`) });
  return null;
}

/** KI-Text der Meldung, falls er zur jetzigen Schwere gehört (Entwarnungen immer aus der Vorlage) */
const aiTextOf = (notice: ShopPulseNotice) => (notice.kind === "resolved" ? null : currentAiText(notice.signal));

/** Karte für eine Sofort-Meldung oder Entwarnung; estimate = geschätzter Verlust, wo die Prüfung keinen liefert */
export function buildShopPulseNoticeCard(notice: ShopPulseNotice, baseUrl: string | null, estimate: ShopPulseLossEstimate | null = null): Record<string, unknown> {
  const s = notice.signal;
  const facts = [{ title: t("notify.since"), value: BERLIN_TIME.format(new Date(s.firstSeenAt)) }];
  if (notice.kind === "resolved" && s.resolvedAt) facts.push({ title: t("notify.resolvedAt"), value: BERLIN_TIME.format(new Date(s.resolvedAt)) });
  else facts.push({ title: t("notify.lastSeen"), value: BERLIN_TIME.format(new Date(s.lastSeenAt)) });
  const loss = notice.kind !== "resolved" ? lossText(s, estimate) : null;
  if (loss) facts.push({ title: t("notify.loss"), value: loss });

  const ai = aiTextOf(notice);
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: teamsPlain(noticeHeading(notice), 300), weight: "Bolder", size: "Medium", wrap: true },
    ...(ai
      ? [
          ...ai.split("\n").map((line, i) => ({ type: "TextBlock", text: teamsPlain(line, 500), wrap: true, spacing: i ? "None" : "Default" })),
          { type: "TextBlock", text: t("notify.aiNote"), wrap: true, isSubtle: true, size: "Small", spacing: "Small" },
        ]
      : [{ type: "TextBlock", text: teamsPlain(notice.kind === "resolved" ? t("notify.resolvedText") : signalMessage(s), 1200), wrap: true }]),
    { type: "FactSet", facts },
  ];
  const open = pageUrl(baseUrl, `?signal=${encodeURIComponent(s.id)}`);
  const mute = pageUrl(baseUrl, `?signal=${encodeURIComponent(s.id)}&action=mute`);
  const actions = [
    ...(open ? [{ title: t("notify.open"), url: open }] : []),
    ...(mute && notice.kind !== "resolved" ? [{ title: t("notify.mute"), url: mute }] : []),
  ];
  return adaptiveCardMessage(body, actions);
}

/** Tagesbericht: offene Meldungen, kritisch zuerst (Reihenfolge kommt sortiert an); aiSummary = geprüfter KI-Text */
export function buildShopPulseDailyCard(
  signals: ShopPulseSignal[],
  now: Date,
  baseUrl: string | null,
  numbers: DailyNumbers | null = null,
  aiSummary: string | null = null,
): Record<string, unknown> {
  const critical = signals.filter((s) => s.severity === "critical").length;
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: t("notify.dailyTitle", { date: BERLIN_DATE.format(now) }), weight: "Bolder", size: "Medium", wrap: true },
  ];
  if (numbers) {
    dailyNumbersLines(numbers).forEach((line, i) => body.push({ type: "TextBlock", text: line, wrap: true, spacing: i ? "None" : "Small", ...(i ? { isSubtle: true } : {}) }));
  }
  if (aiSummary) {
    aiSummary.split("\n").forEach((line, i) => body.push({ type: "TextBlock", text: teamsPlain(line, 1200), wrap: true, spacing: i ? "None" : "Medium" }));
    body.push({ type: "TextBlock", text: t("notify.aiNote"), wrap: true, isSubtle: true, size: "Small", spacing: "Small" });
  }
  body.push({
    type: "TextBlock",
    text: signals.length ? t("notify.dailySummary", { count: signals.length, critical }) : t("notify.dailyNone"),
    wrap: true,
    spacing: "Medium",
  });
  for (const s of signals.slice(0, MAX_LISTED)) {
    const loss = s.lossPerHour ? ` (${t("notify.lossValue", { amount: EURO.format(s.lossPerHour) })})` : "";
    body.push({ type: "TextBlock", text: `${ICON[s.severity]} ${teamsPlain(signalTitle(s), 200)}${loss}`, wrap: true, spacing: "Small" });
  }
  if (signals.length > MAX_LISTED) body.push({ type: "TextBlock", text: t("notify.more", { count: signals.length - MAX_LISTED }), wrap: true, spacing: "Small" });
  const open = pageUrl(baseUrl);
  return adaptiveCardMessage(body, open ? [{ title: t("notify.openPage"), url: open }] : []);
}

/** Testnachricht aus den Einstellungen */
export function buildShopPulseTestCard(baseUrl: string | null, now: Date): Record<string, unknown> {
  const open = pageUrl(baseUrl);
  return adaptiveCardMessage(
    [
      { type: "TextBlock", text: t("notify.testTitle"), weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text: t("notify.testText", { at: BERLIN_TIME.format(now) }), wrap: true },
    ],
    open ? [{ title: t("notify.openPage"), url: open }] : [],
  );
}

/** Glocke: Titel und kurze Nachricht */
export function buildShopPulseBellText(notice: ShopPulseNotice): { title: string; message: string } {
  return {
    title: teamsPlain(noticeHeading(notice).replace(/^\S+\s/, `${t("notify.bellPrefix")}: `), 200),
    message: (aiTextOf(notice) ?? (notice.kind === "resolved" ? t("notify.resolvedText") : signalMessage(notice.signal))).slice(0, 1000),
  };
}

export function buildShopPulseDailyBellText(
  signals: ShopPulseSignal[],
  now: Date,
  numbers: DailyNumbers | null = null,
  aiSummary: string | null = null,
): { title: string; message: string } {
  const critical = signals.filter((s) => s.severity === "critical").length;
  return {
    title: t("notify.dailyTitle", { date: BERLIN_DATE.format(now) }),
    message: [
      ...(numbers ? dailyNumbersLines(numbers).slice(0, 1) : []),
      ...(aiSummary ? [aiSummary] : []),
      signals.length ? t("notify.dailySummary", { count: signals.length, critical }) : t("notify.dailyNone"),
      ...signals.slice(0, 3).map((s) => `- ${signalTitle(s)}`),
    ]
      .join("\n")
      .slice(0, 1000),
  };
}

// ---------------------------------------------------------------------------------------------
// Wochenbericht (Stufe 2, S2-1)

const PERCENT_PLAIN = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const signed = (v: number | null) => (v == null ? t("weekly.noChange") : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} %`);
const BERLIN_DAY_MONTH = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });

export const weeklyNextStepText = (step: ShopPulseNextStep) => t(`weekly.nextSteps.${step}`);
export const ownerName = (owner: ShopPulseOwnerId) => SHOP_PULSE_OWNER_NAMES[owner];

/** Bereich eines Protokoll-Eintrags kurz („ganzer Shop“, „3 Artikel“, „Seiten: /, /faq“, „Kanal: …“) */
export function actionScopeText(scope: ShopPulseActionScope): string {
  if (scope.type === "shop" || !scope.values.length) return t("weekly.scope.shop");
  if (scope.type === "products") return t("weekly.scope.products", { count: scope.values.length });
  const values = scope.values.slice(0, 4).join(", ") + (scope.values.length > 4 ? " …" : "");
  return t(`weekly.scope.${scope.type}`, { values });
}

const figuresLine = (key: string, f: ShopPulseWeekFigures) =>
  t(key, { orders: INTEGER.format(f.orders), revenue: EURO.format(f.revenue), aov: EURO.format(f.aov) });

/** Die Woche in Zahlen, je Zeile ein Text */
export function weeklyNumbersLines(n: ShopPulseWeeklyNumbers): string[] {
  const c = n.current;
  const lines = [figuresLine("weekly.currentLine", c)];
  lines.push(c.db1 != null ? t("weekly.db", { amount: EURO.format(c.db1), coverage: PERCENT1.format((c.db1CoveragePercent ?? 0) / 100) }) : t("weekly.dbNone"));
  lines.push(`${figuresLine("weekly.prevLine", n.previous)} · ${t("weekly.change", { orders: signed(changePercent(c.orders, n.previous.orders)), revenue: signed(changePercent(c.revenue, n.previous.revenue)) })}`);
  lines.push(
    n.yearAgo
      ? `${figuresLine("weekly.yearLine", n.yearAgo)} · ${t("weekly.change", { orders: signed(changePercent(c.orders, n.yearAgo.orders)), revenue: signed(changePercent(c.revenue, n.yearAgo.revenue)) })}`
      : t("weekly.yearNone"),
  );
  if (n.ga4) {
    const g = n.ga4.current;
    const p = n.ga4.previous;
    const conv = (v: number | null) => (v == null ? t("weekly.noChange") : `${PERCENT_PLAIN.format(v)} %`);
    lines.push(
      t("weekly.ga4Line", {
        sessions: INTEGER.format(g.sessions),
        users: INTEGER.format(g.users),
        purchases: INTEGER.format(g.purchases),
        conversion: conv(g.conversionPercent),
        prevSessions: INTEGER.format(p.sessions),
        prevConversion: conv(p.conversionPercent),
      }),
    );
  } else lines.push(t("weekly.ga4None"));
  return lines;
}

const leverAmountText = (l: ShopPulseLever) =>
  l.perWeek != null && l.basis ? t("weekly.leverAmount", { amount: EURO.format(l.perWeek), basis: t(`lossBasis.${l.basis}`) }) : t("weekly.leverNoAmount");

/** Teams-Karte des Wochenberichts: Zahlen, KI-Zusammenfassung, Top 5 Hebel, Erledigt, Offen je Zuständigem */
export function buildShopPulseWeeklyCard(report: ShopPulseWeeklyReport, baseUrl: string | null): Record<string, unknown> {
  const d = report.data;
  const text = (s: string, extra: Record<string, unknown> = {}) => ({ type: "TextBlock", text: s, wrap: true, ...extra });
  const heading = (s: string) => text(s, { weight: "Bolder", spacing: "Medium" });
  const body: Record<string, unknown>[] = [
    text(t("weekly.title", { week: report.isoWeek, from: dayDate(report.weekStart), to: dayDate(report.weekEnd) }), { weight: "Bolder", size: "Medium" }),
  ];
  body.push(heading(t("weekly.numbersTitle")));
  if (d.numbers) weeklyNumbersLines(d.numbers).forEach((line, i) => body.push(text(teamsPlain(line, 500), { spacing: i ? "None" : "Small", ...(i ? { isSubtle: true } : {}) })));
  else body.push(text(t("weekly.numbersNone"), { spacing: "Small" }));

  if (report.ai?.text) {
    report.ai.text.split("\n").forEach((line, i) => body.push(text(teamsPlain(line, 1500), { spacing: i ? "None" : "Medium" })));
    body.push(text(t("notify.aiNote"), { isSubtle: true, size: "Small", spacing: "Small" }));
  }

  body.push(heading(t("weekly.leversTitle")));
  if (!d.levers.length) body.push(text(t("weekly.leversNone"), { spacing: "Small" }));
  d.levers.forEach((l, i) => {
    body.push(text(`${i + 1}. ${ICON[l.severity]} ${teamsPlain(signalTitle(l), 200)}: ${leverAmountText(l)}`, { spacing: "Small" }));
    body.push(
      text(
        teamsPlain(
          `${signalMessage(l)} (${t("weekly.leverSince", { date: BERLIN_DATE.format(new Date(l.firstSeenAt)) })}) · ${t("weekly.leverOwner", { owner: ownerName(l.owner) })} · ${t("weekly.leverNext", { step: weeklyNextStepText(l.step) })}`,
          700,
        ),
        { spacing: "None", isSubtle: true },
      ),
    );
  });
  if (d.leversPerWeek > 0) body.push(text(t("weekly.leversSum", { amount: EURO.format(d.leversPerWeek) }), { spacing: "Small" }));

  body.push(heading(t("weekly.doneTitle", { count: d.done.length })));
  if (!d.done.length) body.push(text(t("weekly.doneNone"), { spacing: "Small" }));
  for (const a of d.done.slice(0, MAX_LISTED)) {
    const who = a.actor ? ` · ${a.actor}` : "";
    body.push(text(`- ${BERLIN_DAY_MONTH.format(new Date(a.occurredAt))} ${teamsPlain(a.title, 200)} (${actionScopeText(a.scope)}${who})`, { spacing: "None" }));
  }
  if (d.done.length > MAX_LISTED) body.push(text(t("weekly.more", { count: d.done.length - MAX_LISTED }), { spacing: "None" }));
  body.push(text(t("weekly.doneHint"), { isSubtle: true, size: "Small", spacing: "Small" }));

  if (d.openByOwner.length) {
    body.push(heading(t("weekly.ownersTitle")));
    for (const o of d.openByOwner) {
      body.push(text(t("weekly.ownerHeading", { owner: ownerName(o.owner), count: o.items.length }), { weight: "Bolder", spacing: "Small" }));
      for (const item of o.items.slice(0, 5)) body.push(text(`- ${teamsPlain(signalTitle(item), 200)}`, { spacing: "None" }));
      if (o.items.length > 5) body.push(text(t("weekly.more", { count: o.items.length - 5 }), { spacing: "None" }));
    }
  }
  const open = pageUrl(baseUrl, `?tab=weekly&week=${encodeURIComponent(report.weekStart)}`);
  return adaptiveCardMessage(body, open ? [{ title: t("weekly.openPage"), url: open }] : []);
}

export function buildShopPulseWeeklyBellText(report: ShopPulseWeeklyReport): { title: string; message: string } {
  const d = report.data;
  return {
    title: t("weekly.bellTitle", { week: report.isoWeek }),
    message: [
      ...(d.numbers ? weeklyNumbersLines(d.numbers).slice(0, 1) : [t("weekly.numbersNone")]),
      ...(report.ai?.text ? [report.ai.text] : []),
      ...d.levers.slice(0, 3).map((l) => `- ${signalTitle(l)}: ${leverAmountText(l)}`),
    ]
      .join("\n")
      .slice(0, 1000),
  };
}
