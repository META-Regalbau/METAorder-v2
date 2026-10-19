/**
 * Shop-Wächter, Meldungen (Schritt 2, Entscheidungen 17.10.2026): nach jedem Lauf entscheiden, ob
 * Teams und die Glocke Bescheid bekommen.
 *
 * - Alarm, wenn ein Prüfpunkt schlimmer wird als zuletzt gemeldet (neu gelb/rot, gelb → rot), nicht
 *   bei jedem Lauf erneut. „Prüfung gescheitert“ (Netz, API) zählt erst beim zweiten Lauf in Folge.
 * - Deploy (Shopware-Version oder Plugins geändert): immer eine Meldung mit dem aktuellen Stand.
 *   Nur das Theme neu erstellt: keine eigene Meldung (siehe classifyDeployChanges).
 * - Entwarnung, wenn nach einer Meldung wieder alles grün ist.
 *
 * Teams läuft über n8n wie die Problem-Tickets des E-Mail-Eingangs: METAorder legt die fertige
 * Adaptive Card in eine Warteschlange (Settings shop_watch_teams_outbox), der n8n-Workflow
 * n8n-workflows/shop-watch-teams.json holt sie ab, postet sie an den Teams-Webhook aus den
 * E-Mail-Eingang-Einstellungen und quittiert. Ohne Webhook nur die Glocke.
 */
import { ackTeamsOutbox, adaptiveCardMessage, enqueueTeamsMessage, getTeamsOutbox, type SettingsRW, type TeamsOutboxItem } from "../lib/teamsOutbox";
import deLocale from "../../client/src/i18n/locales/de.json";
import {
  classifyDeployChanges,
  levelOf,
  STATUS_RANK,
  worstStatus,
  type ShopWatchCheckResult,
  type ShopWatchDeployChange,
  type ShopWatchFinding,
  type ShopWatchNotice,
  type ShopWatchRun,
  type ShopWatchScheduleState,
  type ShopWatchStatus,
} from "@shared/shopWatch";

export const SHOP_WATCH_TEAMS_OUTBOX_KEY = "shop_watch_teams_outbox";
/** So viele Prüfpunkte stehen höchstens in einer Nachricht */
const MAX_LISTED = 12;
export const SHOP_WATCH_PAGE_PATH = "/admin/shop-waechter";

// ---------------------------------------------------------------------------------------------
// Entscheidung

export type ShopWatchNoticeDecision = {
  notice: ShopWatchNotice | null;
  /** Prüfpunkte, die diese Meldung neu oder schlimmer meldet */
  newIds: string[];
  state: Pick<ShopWatchScheduleState, "known" | "notified" | "lastNotice">;
};

const rank = (s: ShopWatchStatus | undefined) => (s ? STATUS_RANK[s] : 0);

export function decideShopWatchNotice(prev: ShopWatchScheduleState, run: Pick<ShopWatchRun, "results" | "deployChanges">, at = new Date()): ShopWatchNoticeDecision {
  const known: Record<string, ShopWatchStatus> = {};
  for (const r of run.results) if (r.status !== "ok") known[r.id] = r.status;

  // Gescheiterte Prüfung erst melden, wenn sie auch im vorigen Lauf scheiterte (kurze Störung des Shops)
  const effective: Record<string, ShopWatchStatus> = {};
  for (const [id, status] of Object.entries(known)) {
    if (status === "error" && prev.known?.[id] !== "error") continue;
    effective[id] = status;
  }

  const notifiedBefore = prev.notified ?? {};
  const newIds = Object.keys(effective).filter((id) => rank(effective[id]) > rank(notifiedBefore[id]));
  const deploy = classifyDeployChanges(run.deployChanges) === "deploy";
  const problems = Object.entries(effective).map(([id, s]) => `${id}:${s}`);
  const level = levelOf(worstStatus(Object.values(effective)));
  const notice = (kind: ShopWatchNotice["kind"]): ShopWatchNotice => ({ kind, level, at: at.toISOString(), problems, teams: false });

  if (deploy || newIds.length) {
    return { notice: notice(deploy ? "deploy" : "alert"), newIds, state: { known, notified: { ...effective } } };
  }
  if (!Object.keys(effective).length && Object.keys(notifiedBefore).length) {
    return { notice: notice("allClear"), newIds: [], state: { known, notified: {} } };
  }
  // Keine Meldung: Behobenes vergessen, Besserungen merken – kommt es zurück, wird wieder gemeldet
  const notified: Record<string, ShopWatchStatus> = {};
  for (const [id, s] of Object.entries(notifiedBefore)) {
    const cur = effective[id];
    if (cur) notified[id] = rank(cur) < rank(s) ? cur : s;
  }
  return { notice: null, newIds: [], state: { known, notified } };
}

// ---------------------------------------------------------------------------------------------
// Texte (deutsch, aus dem Übersetzungskatalog der Oberfläche)

const de = (deLocale as { shopWatch: Record<string, any> }).shopWatch;

function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : ""));
}

export function shopWatchFindingText(f: ShopWatchFinding): string {
  const template = de.findings?.[f.code];
  return typeof template === "string" ? interpolate(template, f.params) : f.code;
}

export function shopWatchDeployChangeText(c: ShopWatchDeployChange): string {
  return interpolate(String(de.deploy?.[c.field] ?? c.field), { before: c.before, after: c.after });
}

const kindLabel = (r: ShopWatchCheckResult) => String(de.kinds?.[r.kind] ?? r.kind);
const triggerLabel = (t: ShopWatchRun["trigger"]) => String(de.trigger?.[t] ?? t);
const STATUS_ICON: Record<ShopWatchStatus, string> = { ok: "✅", warn: "🟡", error: "🟡", fail: "🔴" };

/** In Teams-Text (Markdown-Untermenge) nichts interpretieren lassen, was aus dem Shop kommt */
function plain(text: string, max = 300): string {
  return text.replace(/[<>*_`[\]#]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const BERLIN_TIME = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function shopWatchNoticeTitle(notice: ShopWatchNotice, run: Pick<ShopWatchRun, "results">): string {
  const ids = new Set(notice.problems.map((p) => p.slice(0, p.lastIndexOf(":"))));
  const red = run.results.filter((r) => ids.has(r.id) && r.status === "fail").length;
  const yellow = ids.size - red;
  const counts = [red ? `${red} rot` : "", yellow ? `${yellow} gelb` : ""].filter(Boolean).join(", ");
  if (notice.kind === "allClear") return "Shop-Wächter: wieder alles in Ordnung";
  if (notice.kind === "deploy") return `Shop-Wächter: Deploy im Shop erkannt${counts ? ` – ${counts}` : " – alles in Ordnung"}`;
  return `Shop-Wächter: ${counts} im Shop`;
}

type ProblemLine = { result: ShopWatchCheckResult; isNew: boolean; text: string };

function problemLines(notice: ShopWatchNotice, run: Pick<ShopWatchRun, "results">, newIds: string[]): ProblemLine[] {
  const ids = new Set(notice.problems.map((p) => p.slice(0, p.lastIndexOf(":"))));
  return run.results
    .filter((r) => ids.has(r.id))
    .sort((a, b) => Number(newIds.includes(b.id)) - Number(newIds.includes(a.id)) || STATUS_RANK[b.status] - STATUS_RANK[a.status])
    .map((r) => {
      const findings = r.findings.slice(0, 2).map(shopWatchFindingText);
      const more = r.findings.length > 2 ? ` (+${r.findings.length - 2})` : "";
      return { result: r, isNew: newIds.includes(r.id), text: `${kindLabel(r)} „${r.label}“: ${findings.join(" · ")}${more}` };
    });
}

/** Text für die Glocke (Titel + kurze Nachricht) */
export function buildShopWatchNotification(notice: ShopWatchNotice, run: ShopWatchRun, newIds: string[]): { title: string; message: string } {
  const lines = problemLines(notice, run, newIds);
  const deploy = run.deployChanges.map(shopWatchDeployChangeText);
  const parts =
    notice.kind === "allClear"
      ? [`Alle ${run.results.length} Prüfpunkte sind wieder grün.`]
      : [...deploy, ...lines.slice(0, 3).map((l) => plain(l.text, 200)), ...(lines.length > 3 ? [`… und ${lines.length - 3} weitere`] : [])];
  return { title: shopWatchNoticeTitle(notice, run), message: parts.join("\n").slice(0, 1000) };
}

/** Adaptive Card für Teams (Aufbau wie die Problem-Tickets des E-Mail-Eingangs) */
export function buildShopWatchTeamsMessage(
  notice: ShopWatchNotice,
  run: ShopWatchRun,
  opts: { baseUrl: string | null; newIds: string[] },
): Record<string, unknown> {
  const lines = problemLines(notice, run, opts.newIds);
  const icon = notice.kind === "allClear" ? "✅" : notice.kind === "deploy" ? "🚀" : notice.level === "red" ? "🔴" : "🟡";
  const facts = [
    { title: "Shop", value: plain(run.shopUrl, 120) },
    { title: "Geprüft", value: `${BERLIN_TIME.format(new Date(run.finishedAt))} (${triggerLabel(run.trigger)})` },
    { title: "Ergebnis", value: `${run.results.filter((r) => r.status === "ok").length} von ${run.results.length} Prüfpunkten in Ordnung` },
  ];
  const body: Record<string, unknown>[] = [
    { type: "TextBlock", text: `${icon} ${shopWatchNoticeTitle(notice, run)}`, weight: "Bolder", size: "Medium", wrap: true },
    { type: "FactSet", facts },
  ];
  if (run.deployChanges.length) {
    body.push({ type: "TextBlock", text: "Geändert seit der vorigen Prüfung:", weight: "Bolder", wrap: true, spacing: "Medium" });
    for (const c of run.deployChanges) body.push({ type: "TextBlock", text: `- ${plain(shopWatchDeployChangeText(c), 400)}`, wrap: true, spacing: "None" });
  }
  if (lines.length) {
    body.push({ type: "TextBlock", text: "Prüfpunkte mit Befund:", weight: "Bolder", wrap: true, spacing: "Medium" });
    for (const l of lines.slice(0, MAX_LISTED)) {
      body.push({ type: "TextBlock", text: `${STATUS_ICON[l.result.status]} ${l.isNew ? "NEU: " : ""}${plain(l.text, 400)}`, wrap: true, spacing: "None" });
    }
    if (lines.length > MAX_LISTED) body.push({ type: "TextBlock", text: `… und ${lines.length - MAX_LISTED} weitere`, wrap: true, spacing: "None" });
  }
  if (notice.kind === "allClear") body.push({ type: "TextBlock", text: "Die zuletzt gemeldeten Befunde sind behoben.", wrap: true });
  const url = opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, "")}${SHOP_WATCH_PAGE_PATH}` : null;

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(url ? { actions: [{ type: "Action.OpenUrl", title: "Shop-Wächter öffnen", url }] } : {}),
        },
      },
    ],
  };
}

/**
 * Testnachricht per Knopf auf /admin/shop-waechter: prüft den Weg Warteschlange → n8n → Teams, ohne dass
 * der Shop einen Befund haben muss. Deutlich als Test gekennzeichnet, damit niemand im Kanal reagiert.
 */
export function buildShopWatchTestTeamsMessage(opts: { baseUrl: string | null; requestedBy: string; now: Date }): Record<string, unknown> {
  const url = opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, "")}${SHOP_WATCH_PAGE_PATH}` : null;
  return adaptiveCardMessage(
    [
      { type: "TextBlock", text: "🧪 TEST – Shop-Wächter: Testnachricht", weight: "Bolder", size: "Medium", wrap: true },
      {
        type: "TextBlock",
        text: "Das ist nur ein Test der Verbindung METAorder → n8n → Teams. Im Shop ist nichts passiert, bitte nichts unternehmen.",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: [
          { title: "Ausgelöst", value: BERLIN_TIME.format(opts.now) },
          { title: "Von", value: plain(opts.requestedBy, 120) || "admin" },
        ],
      },
    ],
    url ? [{ title: "Shop-Wächter öffnen", url }] : [],
  );
}

// ---------------------------------------------------------------------------------------------
// Warteschlange für n8n (gemeinsam mit dem Shop-Puls: server/lib/teamsOutbox.ts)

export type ShopWatchTeamsOutboxItem = TeamsOutboxItem;

export function getShopWatchTeamsOutbox(store: SettingsRW, tenantId: string | null, now = new Date()): Promise<ShopWatchTeamsOutboxItem[]> {
  return getTeamsOutbox(store, SHOP_WATCH_TEAMS_OUTBOX_KEY, tenantId, now);
}

export function enqueueShopWatchTeamsMessage(store: SettingsRW, tenantId: string | null, message: Record<string, unknown>, now = new Date()): Promise<void> {
  return enqueueTeamsMessage(store, SHOP_WATCH_TEAMS_OUTBOX_KEY, tenantId, message, now);
}

/** n8n quittiert gepostete Nachrichten; unbekannte IDs werden ignoriert */
export function ackShopWatchTeamsOutbox(store: SettingsRW, tenantId: string | null, ids: string[], now = new Date()): Promise<number> {
  return ackTeamsOutbox(store, SHOP_WATCH_TEAMS_OUTBOX_KEY, tenantId, ids, now);
}
