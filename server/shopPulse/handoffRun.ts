/**
 * Shop-Puls Stufe 3 (S3-1), Weitergaben mit Datenbank und Versand: Meldung „für Agentur/Smarketer
 * weitergeben“ (Text an Oliver per Teams-Direktnachricht und Glocke), Ticket aus einer Meldung,
 * Erinnerungen nach 2 Werktagen, Jana-Liste einmal je Woche. Alles, was rausgeht, kommt ins
 * Maßnahmen-Protokoll. Die reinen Teile stehen in handoff.ts.
 */
import { and, desc, eq, gte, isNull, or, type AnyColumn } from "drizzle-orm";
import { shopPulseHandoffs, type InsertNotification, type Notification, type ShopPulseHandoffRow } from "@shared/schema";
import { SHOP_PULSE_HANDOFF_KINDS, SHOP_PULSE_HANDOFF_RECIPIENT_NAMES, type ShopPulseHandoff, type ShopPulseHandoffKind, type ShopPulseJanaState, type ShopPulseTicketInput } from "@shared/shopPulseHandoff";
import type { ShopPulseDataGaps, ShopPulseSignal } from "@shared/shopPulse";
import { normalizeActionScope } from "@shared/shopPulseWeekly";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { adaptiveCardMessage, enqueueTeamsMessage, teamsPlain } from "../lib/teamsOutbox";
import { getShopWatchState } from "../shopContent/shopWatch";
import { berlinTime, addDays, weekdayOfDay } from "./pulseOrders";
import { signalScope, type ActionCandidate } from "./actionLog";
import { insertCandidates } from "./actionLogRepository";
import { getSignal, listSignalsForOverview } from "./shopPulseRepository";
import { signalTitle, SHOP_PULSE_PAGE_PATH } from "./shopPulseNotify";
import { buildHandoffText, dueReminders, handoffsDoneBySignal, janaDiff, type HandoffDeploy } from "./handoff";
import { getShopPulseSettings, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "./shopPulseSettings";
import { DATA_GAPS_KEY } from "./detectors/buyability";

const log = logger.child({ component: "shopPulse/handoffRun" });

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const JANA_STATE_KEY = "shop_pulse_jana_state";
/** Erledigte Weitergaben bleiben so lange auf der Seite */
const DONE_VISIBLE_DAYS = 30;

export function rowToHandoff(r: ShopPulseHandoffRow): ShopPulseHandoff {
  return {
    id: r.id,
    signalId: r.signalId,
    signalKey: r.signalKey,
    kind: (SHOP_PULSE_HANDOFF_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ShopPulseHandoffKind) : "agency",
    recipient: r.recipient ?? "",
    text: r.text ?? "",
    ticketId: r.ticketId ?? null,
    ticketNumber: r.ticketNumber ?? null,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy ?? null,
    doneAt: iso(r.doneAt),
    doneBy: r.doneBy ?? null,
    remindedAt: iso(r.remindedAt),
  };
}

/** Offene und in den letzten 30 Tagen erledigte Weitergaben, neueste zuerst */
export async function listHandoffs(tenantId: string | null, now = new Date()): Promise<ShopPulseHandoff[]> {
  const since = new Date(now.getTime() - DONE_VISIBLE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(shopPulseHandoffs)
    .where(and(tenantIs(shopPulseHandoffs.tenantId, tenantId), or(isNull(shopPulseHandoffs.doneAt), gte(shopPulseHandoffs.doneAt, since))))
    .orderBy(desc(shopPulseHandoffs.createdAt))
    .limit(500);
  return rows.map(rowToHandoff);
}

async function insertHandoff(tenantId: string | null, h: Omit<ShopPulseHandoff, "id" | "doneAt" | "doneBy" | "remindedAt">): Promise<ShopPulseHandoff> {
  const [row] = await db
    .insert(shopPulseHandoffs)
    .values({
      tenantId,
      signalId: h.signalId,
      signalKey: h.signalKey,
      kind: h.kind,
      recipient: h.recipient,
      text: h.text,
      ticketId: h.ticketId,
      ticketNumber: h.ticketNumber,
      createdAt: new Date(h.createdAt),
      createdBy: h.createdBy,
    })
    .returning();
  return rowToHandoff(row);
}

export async function markHandoffDone(tenantId: string | null, id: string, by: string, at = new Date()): Promise<ShopPulseHandoff | undefined> {
  const rows = await db
    .update(shopPulseHandoffs)
    .set({ doneAt: at, doneBy: by })
    .where(and(eq(shopPulseHandoffs.id, id), tenantIs(shopPulseHandoffs.tenantId, tenantId), isNull(shopPulseHandoffs.doneAt)))
    .returning();
  return rows[0] ? rowToHandoff(rows[0]) : undefined;
}

async function markReminded(tenantId: string | null, id: string, at: Date): Promise<void> {
  await db
    .update(shopPulseHandoffs)
    .set({ remindedAt: at })
    .where(and(eq(shopPulseHandoffs.id, id), tenantIs(shopPulseHandoffs.tenantId, tenantId)));
}

// ---------------------------------------------------------------------------------------------
// Versand an Oliver (Teams-Direktnachricht des Shop-Puls, Glocke der Administratoren)

export type ShopPulseOutboundDeps = {
  storage: Pick<IStorage, "getSetting" | "saveSetting" | "getUsersWithPermissionInTenant" | "createNotification">;
  onNotificationCreated: (n: Notification) => void;
  baseUrl: string | null;
};

export const pageLink = (baseUrl: string | null, query: string) => (baseUrl ? `${baseUrl.replace(/\/$/, "")}${SHOP_PULSE_PAGE_PATH}${query}` : null);

/** Teams-Karte an die Direktnachricht (falls eingerichtet) und Glocke der Administratoren; liefert, ob Teams dabei war */
export async function sendToOliver(
  deps: ShopPulseOutboundDeps,
  tenantId: string | null,
  msg: { heading: string; paragraphs: string[]; bell: { title: string; message: string }; link: string; actions?: Array<{ title: string; query: string }> },
  now: Date,
): Promise<boolean> {
  const settings = await getShopPulseSettings(deps.storage, tenantId);
  let teams = false;
  if (settings.teamsWebhookUrl) {
    const body: Record<string, unknown>[] = [
      { type: "TextBlock", text: teamsPlain(msg.heading, 200), weight: "Bolder", size: "Medium", wrap: true },
      ...msg.paragraphs.filter((p) => p.trim()).map((p) => ({ type: "TextBlock", text: teamsPlain(p, 600), wrap: true, spacing: "Small" })),
    ];
    const actions = (msg.actions ?? [{ title: "In METAorder öffnen", query: msg.link.replace(SHOP_PULSE_PAGE_PATH, "") }])
      .map((a) => ({ title: a.title, url: pageLink(deps.baseUrl, a.query) }))
      .filter((a): a is { title: string; url: string } => !!a.url);
    await enqueueTeamsMessage(deps.storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, tenantId, adaptiveCardMessage(body, actions), now);
    teams = true;
  }
  const recipients = await deps.storage.getUsersWithPermissionInTenant("viewShopPulse", tenantId, { includeAdministrators: true });
  for (const u of recipients) {
    try {
      const n: InsertNotification = { userId: u.id, type: "shop_pulse", title: msg.bell.title.slice(0, 200), message: msg.bell.message.slice(0, 1000), link: msg.link, ticketId: null, ticketNumber: null, read: 0 };
      deps.onNotificationCreated(await deps.storage.createNotification(n, tenantId));
    } catch (err) {
      log.warn({ err, tenantId, userId: u.id }, "Shop-Puls: Benachrichtigung nicht erstellt");
    }
  }
  return teams;
}

// ---------------------------------------------------------------------------------------------
// Weitergeben (für Agentur/Smarketer)

export type HandoffDeps = ShopPulseOutboundDeps & {
  storage: ShopPulseOutboundDeps["storage"] & Pick<IStorage, "getShopwareSettings">;
  insertActions: (tenantId: string | null, candidates: ActionCandidate[]) => Promise<unknown>;
  /** Storefront-Adresse für den Text (ohne Abfrage des Shops); null = „im Onlineshop“ */
  shopUrl: (tenantId: string | null) => Promise<string | null>;
};

async function deploysOf(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<HandoffDeploy[]> {
  const state = await getShopWatchState(storage as any, tenantId);
  return (state.history ?? []).filter((h) => h.deployChanges?.length).map((h) => ({ at: h.startedAt, changes: h.deployChanges! }));
}

export function handoffDeps(storage: IStorage, onNotificationCreated: (n: Notification) => void, baseUrl: string | null): TicketDeps {
  return {
    storage,
    onNotificationCreated,
    baseUrl,
    insertActions: insertCandidates,
    shopUrl: async (tenantId) => {
      const s = await storage.getShopwareSettings(tenantId);
      if (!s?.shopwareUrl) return null;
      // Live-Shop: Storefront = Admin-Adresse; im Testshop ebenso (test.…)
      return s.shopwareUrl.replace(/\/+$/, "");
    },
  };
}

export class HandoffError extends Error {
  constructor(readonly reason: "notFound") {
    super(reason);
  }
}

/** Text bauen, an Oliver schicken, als Weitergabe speichern und ins Maßnahmen-Protokoll */
export async function forwardSignal(deps: HandoffDeps, tenantId: string | null, signalId: string, kind: "agency" | "marketing", by: string, now = new Date()): Promise<ShopPulseHandoff> {
  const signal = await getSignal(tenantId, signalId);
  if (!signal) throw new HandoffError("notFound");
  const text = buildHandoffText({ signal, kind, deploys: await deploysOf(deps.storage, tenantId), shopUrl: await deps.shopUrl(tenantId).catch(() => null), now });
  const handoff = await insertHandoff(tenantId, {
    signalId: signal.id,
    signalKey: signal.key,
    kind,
    recipient: SHOP_PULSE_HANDOFF_RECIPIENT_NAMES[kind],
    text,
    ticketId: null,
    ticketNumber: null,
    createdAt: now.toISOString(),
    createdBy: by,
  });
  const link = `${SHOP_PULSE_PAGE_PATH}?signal=${encodeURIComponent(signal.id)}`;
  await sendToOliver(
    deps,
    tenantId,
    {
      heading: `📨 Zum Weiterleiten an ${SHOP_PULSE_HANDOFF_RECIPIENT_NAMES[kind]}: ${signalTitle(signal)}`,
      paragraphs: text.split("\n"),
      bell: { title: `Weitergabe an ${SHOP_PULSE_HANDOFF_RECIPIENT_NAMES[kind]}`, message: signalTitle(signal) },
      link,
    },
    now,
  );
  await deps.insertActions(tenantId, [
    {
      occurredAt: now.toISOString(),
      kind: "handoff",
      title: `Weitergegeben an ${SHOP_PULSE_HANDOFF_RECIPIENT_NAMES[kind]}: ${signalTitle(signal)}`.slice(0, 300),
      description: text,
      scope: signalScope(signal),
      source: "shopPulse",
      sourceKey: `handoff:${handoff.id}`,
      actor: by,
    },
  ]);
  log.info({ tenantId, signal: signal.key, kind, by }, "Shop-Puls: Meldung weitergegeben");
  return handoff;
}

// ---------------------------------------------------------------------------------------------
// Ticket aus einer Meldung

export type TicketDeps = HandoffDeps & {
  storage: HandoffDeps["storage"] & Pick<IStorage, "createTicket" | "getUser">;
};

/** Fälligkeit: Kalendertag 17 Uhr Berlin */
export function dueDateOf(day: string): Date {
  const noonUtc = new Date(`${day}T12:00:00Z`);
  const offset = berlinTime(noonUtc).hour - 12; // 1 (Winter) bzw. 2 (Sommer)
  return new Date(`${day}T${String(17 - offset).padStart(2, "0")}:00:00Z`);
}

/** Vorschlag für die Fälligkeit: in 2 Werktagen (Berlin) */
export function defaultDueDay(now: Date, businessDays = 2): string {
  let day = berlinTime(now).day;
  let left = businessDays;
  while (left > 0) {
    day = addDays(day, 1);
    if (weekdayOfDay(day) <= 5) left--;
  }
  return day;
}

export async function createTicketFromSignal(
  deps: TicketDeps,
  tenantId: string | null,
  signalId: string,
  input: ShopPulseTicketInput,
  user: { id: string; username: string },
  now = new Date(),
): Promise<ShopPulseHandoff> {
  const signal = await getSignal(tenantId, signalId);
  if (!signal) throw new HandoffError("notFound");
  const link = pageLink(deps.baseUrl, `?signal=${encodeURIComponent(signal.id)}`) ?? `${SHOP_PULSE_PAGE_PATH}?signal=${encodeURIComponent(signal.id)}`;
  const description = `${input.description}\n\nShop-Puls-Meldung: ${link}`.trim();
  const ticket = await deps.storage.createTicket(
    {
      title: input.title,
      description,
      status: "open",
      priority: input.priority,
      category: "general",
      assignedToUserId: input.assignedToUserId,
      createdByUserId: user.id,
      dueDate: dueDateOf(input.dueDate),
      tags: ["shop-puls"],
    } as any,
    tenantId,
  );
  let assignee = "";
  if (input.assignedToUserId) {
    const u = await deps.storage.getUser(input.assignedToUserId).catch(() => undefined);
    assignee = u?.username ?? "";
    try {
      const n: InsertNotification = {
        userId: input.assignedToUserId,
        type: "ticket_assigned",
        title: `Ticket ${ticket.ticketNumber} zugewiesen`,
        message: ticket.title,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        read: 0,
      };
      deps.onNotificationCreated(await deps.storage.createNotification(n, tenantId));
    } catch (err) {
      log.warn({ err, tenantId, ticket: ticket.ticketNumber }, "Shop-Puls: Ticket-Benachrichtigung nicht erstellt");
    }
  }
  const handoff = await insertHandoff(tenantId, {
    signalId: signal.id,
    signalKey: signal.key,
    kind: "ticket",
    recipient: assignee,
    text: description,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdAt: now.toISOString(),
    createdBy: user.username,
  });
  await deps.insertActions(tenantId, [
    {
      occurredAt: now.toISOString(),
      kind: "ticket",
      title: `Ticket ${ticket.ticketNumber} angelegt: ${input.title}`.slice(0, 300),
      description: `${description}\nFällig: ${input.dueDate.split("-").reverse().join(".")}${assignee ? `, zugewiesen an ${assignee}` : ""}`,
      scope: signalScope(signal),
      source: "shopPulse",
      sourceKey: `ticket:${ticket.id}`,
      actor: user.username,
    },
  ]);
  log.info({ tenantId, signal: signal.key, ticket: ticket.ticketNumber, assigned: !!input.assignedToUserId }, "Shop-Puls: Ticket aus Meldung angelegt");
  return handoff;
}

// ---------------------------------------------------------------------------------------------
// Erinnerungen (jeder Takt)

/**
 * Weitergaben erledigen, deren Meldung erledigt ist, und nach 2 Werktagen ohne Erledigung einmal erinnern.
 * Die Erinnerung geht auch in der Lernwoche raus (die Weitergabe war ein Klick, kein Fund).
 */
export async function runHandoffReminders(deps: ShopPulseOutboundDeps, tenantId: string | null, now: Date): Promise<{ done: number; reminded: number }> {
  const handoffs = (await listHandoffs(tenantId, now)).filter((h) => !h.doneAt);
  if (!handoffs.length) return { done: 0, reminded: 0 };
  const signals = new Map<string, ShopPulseSignal>();
  for (const s of await listSignalsForOverview(tenantId, 60, 1000)) signals.set(s.id, s);
  const doneBySignal = handoffsDoneBySignal(handoffs, signals);
  for (const h of doneBySignal) await markHandoffDone(tenantId, h.id, "Meldung erledigt", now);
  const doneIds = new Set(doneBySignal.map((h) => h.id));
  let reminded = 0;
  for (const h of dueReminders(handoffs.filter((x) => !doneIds.has(x.id)), now)) {
    const s = signals.get(h.signalId);
    const title = s ? signalTitle(s) : h.signalKey;
    await sendToOliver(
      deps,
      tenantId,
      {
        heading: `⏰ Erinnerung: seit 2 Werktagen bei ${h.recipient}`,
        paragraphs: [`${title}`, `Weitergegeben am ${new Date(h.createdAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} von ${h.createdBy ?? "–"}. Noch nicht erledigt.`],
        bell: { title: `Erinnerung: Weitergabe an ${h.recipient}`, message: title },
        link: `${SHOP_PULSE_PAGE_PATH}?signal=${encodeURIComponent(h.signalId)}`,
      },
      now,
    );
    await markReminded(tenantId, h.id, now);
    reminded++;
  }
  return { done: doneBySignal.length, reminded };
}

// ---------------------------------------------------------------------------------------------
// Jana-Liste (einmal je Woche, vorerst an Oliver)

const JANA_FROM_HOUR = 8;
const JANA_TO_HOUR = 12;

export const currentWeekStart = (now: Date) => {
  const today = berlinTime(now).day;
  return addDays(today, -(weekdayOfDay(today) - 1));
};

/** Fällig: Montag 8–12 Uhr Berlin, für diese Woche noch keine */
export function isJanaListDue(prev: ShopPulseJanaState | null, now: Date): boolean {
  const { hour, weekday } = berlinTime(now);
  if (weekday !== 1 || hour < JANA_FROM_HOUR || hour >= JANA_TO_HOUR) return false;
  return prev?.week !== currentWeekStart(now);
}

export async function getJanaState(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopPulseJanaState | null> {
  const raw = await storage.getSetting(JANA_STATE_KEY, tenantId);
  return raw && typeof raw === "object" && Array.isArray((raw as ShopPulseJanaState).keys) ? (raw as ShopPulseJanaState) : null;
}

const GAP_NAMES: Record<string, string> = { noImage: "ohne Titelbild", noCategory: "ohne Kategorie", salesUnit: "Verkaufseinheit", noDeliveryTime: "ohne Lieferzeit" };

/**
 * Jana-Liste senden: Datenlücken des letzten Nachtlaufs (was Pimcore inzwischen korrigiert hat, ist dort schon
 * nicht mehr drin), neu und erledigt gegenüber der Vorwoche. Die CSV lädt man über den Link (angemeldet).
 */
export async function sendJanaList(deps: HandoffDeps, tenantId: string | null, now: Date, opts: { force?: boolean } = {}): Promise<ShopPulseJanaState | null> {
  const prev = await getJanaState(deps.storage, tenantId);
  if (!opts.force && !isJanaListDue(prev, now)) return null;
  const raw = await deps.storage.getSetting(DATA_GAPS_KEY, tenantId);
  const gaps = raw && typeof raw === "object" && Array.isArray((raw as ShopPulseDataGaps).items) ? (raw as ShopPulseDataGaps) : null;
  if (!gaps) return null;
  const diff = janaDiff(gaps.items, prev);
  const week = currentWeekStart(now);
  const counts = new Map<string, number>();
  for (const g of gaps.items) counts.set(g.code, (counts.get(g.code) ?? 0) + 1);
  const countLine = Array.from(counts.entries())
    .map(([code, n]) => `${n} ${GAP_NAMES[code] ?? code}`)
    .join(", ");
  const csvUrl = deps.baseUrl ? `${deps.baseUrl.replace(/\/$/, "")}/api/shop-pulse/data-gaps.csv` : "/api/shop-pulse/data-gaps.csv";
  await sendToOliver(
    deps,
    tenantId,
    {
      heading: `📋 Jana-Liste (Woche ab ${week.split("-").reverse().join(".")}): ${gaps.items.length} Punkte`,
      paragraphs: [
        countLine || "keine Datenlücken",
        `Neu seit der letzten Liste: ${diff.added}, inzwischen erledigt: ${diff.fixed}. Stand des Nachtlaufs: ${new Date(gaps.at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}.`,
        `CSV im Jana-Format (anmelden in METAorder): ${csvUrl}`,
        "Die Liste geht vorerst an dich; ob sie künftig direkt an Jana geht, ist noch offen.",
      ],
      bell: { title: `Jana-Liste: ${gaps.items.length} Punkte`, message: `Neu ${diff.added}, erledigt ${diff.fixed}` },
      link: SHOP_PULSE_PAGE_PATH,
    },
    now,
  );
  const state: ShopPulseJanaState = { week, sentAt: now.toISOString(), keys: diff.keys, total: gaps.items.length, added: diff.added, fixed: diff.fixed };
  await deps.storage.saveSetting(JANA_STATE_KEY, state, tenantId);
  await deps.insertActions(tenantId, [
    {
      occurredAt: now.toISOString(),
      kind: "janaList",
      title: `Jana-Liste an Oliver: ${gaps.items.length} Datenlücken (neu ${diff.added}, erledigt ${diff.fixed})`,
      description: `Datenlücken für die PIM-Sammlung (Jana), Stand ${gaps.at.slice(0, 10)}: ${countLine || "keine"}.`,
      scope: normalizeActionScope({ type: "products", values: gaps.items.map((g) => g.productNumber) }),
      source: "shopPulse",
      sourceKey: `jana:${week}${opts.force ? `:${now.toISOString()}` : ""}`,
      actor: null,
    },
  ]);
  log.info({ tenantId, week, total: gaps.items.length, added: diff.added, fixed: diff.fixed }, "Shop-Puls: Jana-Liste gesendet");
  return state;
}
