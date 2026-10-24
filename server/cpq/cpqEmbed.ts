/**
 * Eingebetteter Regalplaner: Die Shop-Seite /regalplaner (scripts/writeRegalplanerPage.ts) zeigt
 * METAorder unter /regalplaner im iframe. Dafür braucht es zweierlei:
 *
 * - Welche Seiten METAorder einbetten dürfen (frame-ancestors): die Shop-Adressen aller Mandanten
 *   (Shopware-Einstellungen) plus CPQ_EMBED_ORIGINS (kommagetrennt, z. B. eine zweite Shop-Domain).
 * - Zu welchem Mandanten ein Gast gehört: über die Adresse des Shops, der einbettet.
 *
 * Die Liste wird 5 Minuten zwischengespeichert; ein neuer Mandant braucht also keinen Neustart.
 */
import { storage } from "../storage";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cpq/cpqEmbed" });
const CACHE_MS = 5 * 60 * 1000;

/** Pfade der App, die eingebettet werden dürfen (nur die Gast-Seite des Regalplaners). */
export const EMBEDDABLE_PATH_RE = /^\/regalplaner\/?$/;

export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

let cache: { at: number; byOrigin: Map<string, string | null> } | null = null;

async function load(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.byOrigin;
  const byOrigin = new Map<string, string | null>();
  try {
    for (const tenant of await storage.getAllTenants()) {
      const settings = await storage.getShopwareSettings(tenant.id).catch(() => undefined);
      const origin = settings?.shopwareUrl ? normalizeOrigin(settings.shopwareUrl) : null;
      if (origin && !byOrigin.has(origin)) byOrigin.set(origin, tenant.id);
    }
  } catch (err) {
    moduleLog.error({ err }, "[CPQ] Shop-Adressen für den Regalplaner nicht lesbar");
  }
  // Zusätzliche Shop-Domains: einbetten ja, Mandant über „origin=tenantId“ (sonst nur einbetten)
  for (const entry of (process.env.CPQ_EMBED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [rawOrigin, tenantId] = entry.split("=");
    const origin = normalizeOrigin(rawOrigin);
    if (origin) byOrigin.set(origin, tenantId?.trim() || byOrigin.get(origin) || null);
  }
  cache = { at: Date.now(), byOrigin };
  return byOrigin;
}

/** Wert für frame-ancestors (ohne 'self'). */
export async function embedFrameAncestors(): Promise<string[]> {
  return [...(await load()).keys()];
}

/** Mandant zur Shop-Adresse, oder null, wenn der Shop keinem Mandanten gehört. */
export async function resolveGuestTenantForShop(shop: string): Promise<string | null> {
  const origin = normalizeOrigin(shop);
  if (!origin) return null;
  return (await load()).get(origin) ?? null;
}

/** Nur für Tests. */
export function resetEmbedCache(): void {
  cache = null;
}
