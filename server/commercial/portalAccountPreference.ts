/**
 * Portal vor Onlineshop (Entscheidung 11.10.2026): Kunden, die im Händlerportal geführt werden,
 * werden auch darüber abgewickelt. Der Verkaufskanal einer Bestellung/eines Angebots folgt dem
 * zugeordneten Shopware-Konto (customer.salesChannelId) – also muss schon die Kundenzuordnung das
 * Portal-Konto wählen:
 *  - Eine E-Mail mit Shop- UND Portal-Konto → das Portal-Konto.
 *  - Gefundenes Konto ist ein Shop-Konto, die Firma hat aber ein Portal-Konto (gleiche Firma oder
 *    gleiche Firmen-Domain) → genau eins: wechseln und vermerken; mehrere: Bearbeiter wählt.
 * Portal = Verkaufskanal mit „Portal“ im Namen („META Händler Portal DE“ … , „META Portal“).
 * Ohne Kanalliste (Shopware nicht erreichbar) zählt die lange Portal-Kundennummer (20000…).
 */
import { isFreemailDomain } from "./freemailDomains";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/portalAccountPreference" });

/** Portal-Kunden haben lange Kundennummern (z. B. 20000016175), Shop-Kunden fünfstellige oder „BC-…“. */
const PORTAL_CUSTOMER_NUMBER_MIN_DIGITS = 8;
const PORTAL_CHANNEL_NAME_RE = /portal/i;

/** Höchstens so sicher nach einem Wechsel vom Shop- aufs Portal-Konto: der Bearbeiter prüft zuerst. */
export const PORTAL_SWITCH_MAX_CONFIDENCE = 90;

export type AccountLike = {
  id: string;
  email?: string;
  customerNumber?: string | null;
  company?: string;
  salesChannelId?: string | null;
  salesChannelName?: string;
  firstName?: string;
  lastName?: string;
  zipCode?: string;
  city?: string;
};

export type PortalChannelIds = Set<string> | null;

const normId = (id: string) => id.replace(/-/g, "").toLowerCase();

/** Portal-Kanäle aus Shopware; null, wenn die Liste nicht geladen werden kann. */
export async function loadPortalChannelIds(client: {
  fetchSalesChannels?: () => Promise<Array<{ id: string; name?: string | null; translated?: { name?: string | null } }>>;
}): Promise<PortalChannelIds> {
  if (typeof client.fetchSalesChannels !== "function") return null;
  try {
    const channels = await client.fetchSalesChannels();
    const ids = channels
      .filter((c) => PORTAL_CHANNEL_NAME_RE.test(c.name ?? c.translated?.name ?? ""))
      .map((c) => normId(c.id));
    return ids.length ? new Set(ids) : null;
  } catch (err) {
    log.warn({ err }, "[PortalAccount] Verkaufskanäle nicht geladen – Portal nur über die Kundennummer erkannt");
    return null;
  }
}

export function isPortalAccount(account: AccountLike, portalChannelIds: PortalChannelIds): boolean {
  if (portalChannelIds && account.salesChannelId) return portalChannelIds.has(normId(account.salesChannelId));
  if (account.salesChannelName) return PORTAL_CHANNEL_NAME_RE.test(account.salesChannelName);
  return (account.customerNumber ?? "").replace(/\D/g, "").length >= PORTAL_CUSTOMER_NUMBER_MIN_DIGITS;
}

/** Mehrere Konten mit derselben E-Mail: das (erste) Portal-Konto, sonst das erste. */
export function pickPreferredAccount<T extends AccountLike>(accounts: T[], portalChannelIds: PortalChannelIds): T | null {
  if (!accounts.length) return null;
  return accounts.find((a) => isPortalAccount(a, portalChannelIds)) ?? accounts[0];
}

function normCompany(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&|\+/g, " und ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PortalAlternative = AccountLike & { reason: "portal_account" };

/**
 * Portal-Konten derselben Firma zu einem Shop-Konto: gleicher Firmenname (normalisiert) oder
 * Login-Adresse mit derselben Firmen-Domain. Freemail- und eigene Domains zählen nicht.
 */
export async function findPortalAlternatives(
  client: { searchCustomers: (term: string, limit: number) => Promise<AccountLike[]> },
  params: { excludeId: string; companies: Array<string | null | undefined>; emails: string[]; isOwnDomain: (domain: string) => boolean },
  portalChannelIds: PortalChannelIds,
): Promise<PortalAlternative[]> {
  const companies = [...new Set(params.companies.map((c) => (c ?? "").trim()).filter((c) => c.length >= 3))];
  const domains = [
    ...new Set(
      params.emails
        .map((e) => e.split("@")[1]?.trim().toLowerCase() ?? "")
        .filter((d) => d.includes(".") && !isFreemailDomain(d) && !params.isOwnDomain(d)),
    ),
  ];
  const byId = new Map<string, PortalAlternative>();
  const consider = (hits: AccountLike[], keep: (h: AccountLike) => boolean) => {
    for (const h of hits) {
      if (!h.id || h.id === params.excludeId || byId.has(h.id)) continue;
      if (!isPortalAccount(h, portalChannelIds) || !keep(h)) continue;
      byId.set(h.id, { ...h, reason: "portal_account" });
    }
  };
  for (const company of companies.slice(0, 2)) {
    const needle = normCompany(company);
    try {
      consider(await client.searchCustomers(company, 25), (h) => Boolean(h.company) && normCompany(h.company!) === needle);
    } catch (err) {
      log.warn({ err }, "[PortalAccount] Firmensuche fehlgeschlagen");
    }
  }
  for (const domain of domains.slice(0, 2)) {
    try {
      consider(await client.searchCustomers(domain, 25), (h) => (h.email ?? "").trim().toLowerCase().endsWith(`@${domain}`));
    } catch (err) {
      log.warn({ err }, "[PortalAccount] Domain-Suche fehlgeschlagen");
    }
  }
  return [...byId.values()].slice(0, 12);
}
