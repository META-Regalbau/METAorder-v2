/**
 * Shop-Puls, Nachrichten: Teams-Karten (Direktnachricht über n8n) und Texte für die Glocke. Texte kommen
 * aus dem deutschen Übersetzungskatalog der Oberfläche (shopPulse.codes.*, shopPulse.notify.*), damit Seite
 * und Teams dasselbe sagen.
 */
import deLocale from "../../client/src/i18n/locales/de.json";
import type { ShopPulseSignal } from "@shared/shopPulse";
import { adaptiveCardMessage, teamsPlain } from "../lib/teamsOutbox";
import type { ShopPulseNotice } from "./shopPulseSignals";

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

export const signalTitle = (s: Pick<ShopPulseSignal, "code" | "params">) => t(`codes.${s.code}.title`, s.params);
export const signalMessage = (s: Pick<ShopPulseSignal, "code" | "params">) => t(`codes.${s.code}.message`, s.params);

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

/** Karte für eine Sofort-Meldung oder Entwarnung */
export function buildShopPulseNoticeCard(notice: ShopPulseNotice, baseUrl: string | null): Record<string, unknown> {
  const s = notice.signal;
  const facts = [{ title: t("notify.since"), value: BERLIN_TIME.format(new Date(s.firstSeenAt)) }];
  if (notice.kind === "resolved" && s.resolvedAt) facts.push({ title: t("notify.resolvedAt"), value: BERLIN_TIME.format(new Date(s.resolvedAt)) });
  else facts.push({ title: t("notify.lastSeen"), value: BERLIN_TIME.format(new Date(s.lastSeenAt)) });
  if (s.lossPerHour && notice.kind !== "resolved") facts.push({ title: t("notify.loss"), value: t("notify.lossValue", { amount: EURO.format(s.lossPerHour) }) });

  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: teamsPlain(noticeHeading(notice), 300), weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: teamsPlain(notice.kind === "resolved" ? t("notify.resolvedText") : signalMessage(s), 1200), wrap: true },
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

/** Tagesbericht: offene Meldungen, kritisch zuerst (Reihenfolge kommt sortiert an) */
export function buildShopPulseDailyCard(signals: ShopPulseSignal[], now: Date, baseUrl: string | null): Record<string, unknown> {
  const critical = signals.filter((s) => s.severity === "critical").length;
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: t("notify.dailyTitle", { date: BERLIN_DATE.format(now) }), weight: "Bolder", size: "Medium", wrap: true },
    { type: "TextBlock", text: t("notify.dailySummary", { count: signals.length, critical }), wrap: true },
  ];
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
    message: (notice.kind === "resolved" ? t("notify.resolvedText") : signalMessage(notice.signal)).slice(0, 1000),
  };
}

export function buildShopPulseDailyBellText(signals: ShopPulseSignal[], now: Date): { title: string; message: string } {
  const critical = signals.filter((s) => s.severity === "critical").length;
  return {
    title: t("notify.dailyTitle", { date: BERLIN_DATE.format(now) }),
    message: [t("notify.dailySummary", { count: signals.length, critical }), ...signals.slice(0, 3).map((s) => `- ${signalTitle(s)}`)].join("\n").slice(0, 1000),
  };
}
