import type { IStorage } from "./storage";
import { getCommercialAgentSettings } from "./aiConfig";
import { ShopwareClient } from "./shopware";

export type ResolveOfferSalesChannelInput = {
  tenantId?: string | null;
  /** Aus Request-Body (optional) */
  requestedChannelId?: string | null;
  /**
   * null = Admin / uneingeschränkter Zugriff (alle Kanäle erlaubt)
   * [] = Benutzer ohne zugewiesene Kanäle
   */
  allowedChannelIds?: string[] | null;
};

export type ResolveOfferSalesChannelResult =
  | { ok: true; salesChannelId: string; source: string }
  | { ok: false; error: string; statusCode: number };

function normalizeChannelId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

function channelAllowed(id: string, allowedChannelIds: string[] | null | undefined): boolean {
  if (allowedChannelIds === null || allowedChannelIds === undefined) return true;
  if (allowedChannelIds.length === 0) return false;
  const norm = normalizeChannelId(id);
  return allowedChannelIds.some((c) => normalizeChannelId(c) === norm);
}

function pickIfAllowed(
  id: string | undefined | null,
  allowedChannelIds: string[] | null | undefined
): string | null {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return null;
  if (!channelAllowed(trimmed, allowedChannelIds)) return null;
  return trimmed;
}

/**
 * Ermittelt die Sales-Channel-ID für B2B-Angebote.
 * Reihenfolge: Request → Env → Agent-Settings → erster zugewiesener Kanal → erster aktiver Shopware-Kanal.
 */
export async function resolveOfferSalesChannelId(
  storage: IStorage,
  input: ResolveOfferSalesChannelInput
): Promise<ResolveOfferSalesChannelResult> {
  const { tenantId, requestedChannelId, allowedChannelIds } = input;

  if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
    return {
      ok: false,
      statusCode: 403,
      error:
        "Kein Verkaufskanal zugewiesen. Bitte Administrator um Sales-Channel-Freigabe oder B2B_SELLERS_DEFAULT_SALES_CHANNEL setzen.",
    };
  }

  const requestedTrimmed = (requestedChannelId ?? "").trim();
  if (requestedTrimmed && !channelAllowed(requestedTrimmed, allowedChannelIds)) {
    return {
      ok: false,
      statusCode: 403,
      error: "Der gewählte Verkaufskanal ist für Ihren Benutzer nicht freigegeben.",
    };
  }

  const fromRequest = pickIfAllowed(requestedChannelId, allowedChannelIds);
  if (fromRequest) {
    return { ok: true, salesChannelId: fromRequest, source: "request" };
  }

  const fromEnv = pickIfAllowed(
    process.env.B2B_SELLERS_DEFAULT_SALES_CHANNEL || process.env.COMMERCIAL_AGENT_SALES_CHANNEL_ID,
    allowedChannelIds
  );
  if (fromEnv) {
    return { ok: true, salesChannelId: fromEnv, source: "env" };
  }

  try {
    const agentSettings = await getCommercialAgentSettings(storage);
    const fromAgent = pickIfAllowed(agentSettings.autoCreateSalesChannelId, allowedChannelIds);
    if (fromAgent) {
      return { ok: true, salesChannelId: fromAgent, source: "agent_settings" };
    }
  } catch {
    // Agent-Settings optional — weiter mit User/Shopware-Fallback
  }

  if (Array.isArray(allowedChannelIds) && allowedChannelIds.length > 0) {
    return {
      ok: true,
      salesChannelId: allowedChannelIds[0],
      source: "user_assignment",
    };
  }

  const settings = await storage.getShopwareSettings(tenantId ?? null);
  if (!settings) {
    return {
      ok: false,
      statusCode: 400,
      error: "Shopware-Einstellungen nicht konfiguriert — Verkaufskanal kann nicht ermittelt werden.",
    };
  }

  try {
    const client = new ShopwareClient(settings);
    const channels = await client.fetchSalesChannels();
    const first = channels.find((c) => c.active !== false) ?? channels[0];
    if (first?.id) {
      return { ok: true, salesChannelId: first.id, source: "shopware_default" };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      statusCode: 502,
      error: `Verkaufskanäle konnten nicht aus Shopware geladen werden: ${msg}`,
    };
  }

  return {
    ok: false,
    statusCode: 400,
    error:
      "sales_channel_id erforderlich. Bitte Verkaufskanal zuweisen, B2B_SELLERS_DEFAULT_SALES_CHANNEL setzen oder einen aktiven Kanal in Shopware anlegen.",
  };
}
