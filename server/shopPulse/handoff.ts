/**
 * Shop-Puls Stufe 3 (S3-1), Weitergabe einer Meldung (rein, ohne Datenbank; Tests in
 * tests/unit/shopPulseHandoff.test.ts):
 *
 * - weiterleitbarer Text für wirduzen bzw. Smarketer mit Belegen (Seite, Zeitpunkt, Deploy laut Shop-Wächter,
 *   Fehlerbild bzw. Kampagnen und Suchbegriffe aus den Belegen der Prüfung). Er geht an Oliver
 *   (Entscheidung 19.10.2026), der ihn weiterleitet. Deutsch, wie die Teams-Nachrichten.
 * - Erinnerung nach 2 Werktagen ohne Erledigung (einmal); erledigt ist eine Weitergabe von Hand oder sobald
 *   die Meldung erledigt ist.
 * - Jana-Liste: neu und erledigt gegenüber der zuletzt gesendeten Liste.
 */
import type { ShopPulseSignal } from "@shared/shopPulse";
import type { ShopPulseDataGap } from "@shared/shopPulse";
import {
  SHOP_PULSE_HANDOFF_RECIPIENT_NAMES,
  SHOP_PULSE_HANDOFF_REMIND_BUSINESS_DAYS,
  type ShopPulseHandoff,
  type ShopPulseHandoffKind,
  type ShopPulseJanaState,
} from "@shared/shopPulseHandoff";
import type { ShopWatchDeployChange } from "@shared/shopWatch";
import { businessDaysBetween } from "./detectors/offers";
import { signalMessage, signalTitle } from "./shopPulseNotify";

const BERLIN_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const at = (iso: string) => `${BERLIN_TIME.format(new Date(iso))} Uhr`;

export type HandoffDeploy = { at: string; changes: ShopWatchDeployChange[] };

/** Deploys so lange vor dem ersten Auftreten zählen als möglicher Auslöser */
export const DEPLOY_WINDOW_MS = 72 * 60 * 60 * 1000;

const DEPLOY_FIELD: Record<string, string> = { shopwareVersion: "Shopware-Version", plugins: "Plugins", themeAsset: "Theme" };

/** Bekannte Beleg-Felder der Prüfungen mit deutscher Bezeichnung; alle übrigen mit ihrem Namen */
const EVIDENCE_LABEL: Record<string, string> = {
  url: "Seite",
  path: "Seite",
  page: "Seite",
  pages: "Seiten",
  status: "HTTP-Status",
  step: "Schritt",
  error: "Fehler",
  terms: "Suchbegriffe",
  products: "Artikel",
  campaigns: "Kampagnen",
  campaign: "Kampagne",
  searchTerms: "Suchbegriffe",
  queries: "Suchanfragen",
  shown: "angezeigt",
  expected: "erwartet",
  checked: "geprüft",
  unchecked: "nicht geprüft",
};
const MAX_LIST = 10;
const MAX_LINE = 300;

function valueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  if (typeof v === "string" || typeof v === "boolean") return v === true ? "ja" : v === false ? "nein" : String(v);
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_LIST).map((x) => (x && typeof x === "object" ? objectText(x as Record<string, unknown>) : valueText(x)));
    return `${items.join("; ")}${v.length > MAX_LIST ? ` … (${v.length} insgesamt)` : ""}`;
  }
  if (typeof v === "object") return objectText(v as Record<string, unknown>);
  return String(v);
}

function objectText(o: Record<string, unknown>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `${EVIDENCE_LABEL[k] ?? k} ${valueText(v)}`)
    .join(", ");
}

/** Belege einer Meldung als Zeilen („Seite: /…“, „Suchbegriffe: …“) */
export function evidenceLines(evidence: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(evidence)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    const text = valueText(v);
    if (!text || text === "–") continue;
    lines.push(`${EVIDENCE_LABEL[k] ?? k}: ${text}`.slice(0, MAX_LINE));
  }
  return lines;
}

/** Deploys laut Shop-Wächter von 72 Stunden vor dem ersten Auftreten bis jetzt */
export function relevantDeploys(deploys: HandoffDeploy[], firstSeenAt: string, now: Date): HandoffDeploy[] {
  const from = Date.parse(firstSeenAt) - DEPLOY_WINDOW_MS;
  return deploys.filter((d) => {
    const t = Date.parse(d.at);
    return t >= from && t <= now.getTime();
  });
}

export type HandoffTextInput = {
  signal: ShopPulseSignal;
  kind: Exclude<ShopPulseHandoffKind, "ticket">;
  deploys: HandoffDeploy[];
  /** Storefront-Adresse des Shops (z. B. https://shop.meta-online.com), sonst „Onlineshop“ */
  shopUrl: string | null;
  now: Date;
};

/** Fertiger Text zum Weiterleiten (deutsch); jede Zeile ein Absatz */
export function buildHandoffText(input: HandoffTextInput): string {
  const s = input.signal;
  const lines: string[] = [];
  lines.push(`An: ${SHOP_PULSE_HANDOFF_RECIPIENT_NAMES[input.kind]}`);
  lines.push(`Betreff: Onlineshop – ${signalTitle(s)}`);
  lines.push("");
  lines.push("Hallo,");
  lines.push(`im Onlineshop${input.shopUrl ? ` ${input.shopUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : ""} ist uns Folgendes aufgefallen:`);
  lines.push("");
  lines.push(signalTitle(s));
  lines.push(signalMessage(s));
  lines.push("");
  lines.push("Belege:");
  lines.push(`- zuerst gesehen: ${at(s.firstSeenAt)}, zuletzt: ${at(s.lastSeenAt)}`);
  lines.push(`- Schwere: ${s.severity === "critical" ? "kritisch" : "Warnung"}${s.status === "resolved" ? " (inzwischen erledigt)" : ""}`);
  if (s.lossPerHour) lines.push(`- geschätzter Umsatzverlust: ${EURO.format(s.lossPerHour)} pro Stunde`);
  const deploys = relevantDeploys(input.deploys, s.firstSeenAt, input.now);
  if (deploys.length) {
    for (const d of deploys) {
      const changes = d.changes.map((c) => `${DEPLOY_FIELD[c.field] ?? c.field} ${c.before || "–"} → ${c.after || "–"}`).join("; ");
      lines.push(`- Deploy laut Shop-Wächter am ${at(d.at)}: ${changes}`.slice(0, MAX_LINE));
    }
  } else {
    lines.push("- kein Deploy laut Shop-Wächter in den 72 Stunden davor");
  }
  for (const l of evidenceLines(s.evidence)) lines.push(`- ${l}`);
  lines.push("");
  lines.push("Bitte prüfen und kurz Bescheid geben, wann es behoben ist.");
  lines.push("");
  lines.push("Viele Grüße");
  return lines.join("\n");
}

/** Fällige Erinnerungen: Agentur/Smarketer, offen, noch nicht erinnert, seit 2 Werktagen (Tickets haben ihre Fälligkeit) */
export function dueReminders(handoffs: ShopPulseHandoff[], now: Date): ShopPulseHandoff[] {
  return handoffs.filter(
    (h) => h.kind !== "ticket" && !h.doneAt && !h.remindedAt && businessDaysBetween(new Date(h.createdAt), now) >= SHOP_PULSE_HANDOFF_REMIND_BUSINESS_DAYS,
  );
}

/** Offene Weitergaben, deren Meldung inzwischen erledigt ist (dann erledigt sich die Weitergabe mit) */
export function handoffsDoneBySignal(handoffs: ShopPulseHandoff[], signals: Map<string, Pick<ShopPulseSignal, "status">>): ShopPulseHandoff[] {
  return handoffs.filter((h) => !h.doneAt && signals.get(h.signalId)?.status === "resolved");
}

// ---------------------------------------------------------------------------------------------
// Jana-Liste

export const janaKey = (g: Pick<ShopPulseDataGap, "code" | "productNumber">) => `${g.code}|${g.productNumber}`;

/** Neu und erledigt gegenüber der zuletzt gesendeten Liste (ohne vorige Liste ist alles neu) */
export function janaDiff(items: ShopPulseDataGap[], prev: ShopPulseJanaState | null): { keys: string[]; added: number; fixed: number } {
  const keys = Array.from(new Set(items.map(janaKey))).sort();
  const before = new Set(prev?.keys ?? []);
  const now = new Set(keys);
  return {
    keys,
    added: keys.filter((k) => !before.has(k)).length,
    fixed: prev ? Array.from(before).filter((k) => !now.has(k)).length : 0,
  };
}
