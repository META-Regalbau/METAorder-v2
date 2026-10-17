/**
 * Warteschlange für Teams-Nachrichten, die n8n abholt (Shop-Wächter, Shop-Puls). METAorder legt die
 * fertige Adaptive Card unter einem Settings-Key ab, n8n holt sie per Integration-Key ab, postet sie an den
 * Teams-Webhook und quittiert nur Erfolgreiches. Unabgeholtes verfällt nach 48 Stunden (n8n nicht
 * eingerichtet oder Webhook kaputt), höchstens 20 Einträge.
 */
import { randomUUID } from "crypto";

export type TeamsOutboxItem = { id: string; createdAt: string; message: Record<string, unknown> };

export type SettingsRW = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
};

const OUTBOX_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const OUTBOX_MAX_ITEMS = 20;

function freshItems(raw: unknown, now: Date): TeamsOutboxItem[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as any).items) ? ((raw as any).items as TeamsOutboxItem[]) : [];
  return items.filter((i) => i && typeof i.id === "string" && now.getTime() - Date.parse(i.createdAt) < OUTBOX_MAX_AGE_MS);
}

export async function getTeamsOutbox(store: SettingsRW, key: string, tenantId: string | null, now = new Date()): Promise<TeamsOutboxItem[]> {
  return freshItems(await store.getSetting(key, tenantId), now);
}

export async function enqueueTeamsMessage(
  store: SettingsRW,
  key: string,
  tenantId: string | null,
  message: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  const items = await getTeamsOutbox(store, key, tenantId, now);
  items.push({ id: randomUUID(), createdAt: now.toISOString(), message });
  await store.saveSetting(key, { items: items.slice(-OUTBOX_MAX_ITEMS) }, tenantId);
}

/** n8n quittiert gepostete Nachrichten; unbekannte IDs werden ignoriert */
export async function ackTeamsOutbox(store: SettingsRW, key: string, tenantId: string | null, ids: string[], now = new Date()): Promise<number> {
  const items = await getTeamsOutbox(store, key, tenantId, now);
  const rest = items.filter((i) => !ids.includes(i.id));
  await store.saveSetting(key, { items: rest }, tenantId);
  return items.length - rest.length;
}

/** In Teams-Text (Markdown-Untermenge) nichts interpretieren lassen, was aus dem Shop kommt */
export function teamsPlain(text: string, max = 300): string {
  return text.replace(/[<>*_`[\]#]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Adaptive Card im Umschlag, den Teams-Workflow-Webhooks erwarten */
export function adaptiveCardMessage(body: Record<string, unknown>[], actions: Array<{ title: string; url: string }>): Record<string, unknown> {
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
          ...(actions.length ? { actions: actions.map((a) => ({ type: "Action.OpenUrl", title: a.title, url: a.url })) } : {}),
        },
      },
    ],
  };
}
