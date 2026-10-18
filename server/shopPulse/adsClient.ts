/**
 * Shop-Puls Stufe 2 (S2-4), Google-Ads-Anbindung, nur lesend: nutzt die Einstellungen unter Einstellungen →
 * Google Ads (google_ads_settings: Kunden-IDs, Developer-Token, OAuth-Client, Refresh-Token, MCC; verschlüsselt,
 * server/analytics/googleKpi.ts). Fehlt etwas, wirft der Zugriff AdsNotConfiguredError; die Ads-Prüfung setzt
 * dann aus (keine Funde, Hinweis auf der Seite), wie bei GA4.
 *
 * Abfragen laufen nacheinander (GAQL über google-ads-api), nie parallel. Tests simulieren den Client
 * (tests/unit/shopPulseAds.test.ts). Gegen ein echtes Ads-Konto ist das nicht getestet: Die Zugänge
 * verwaltet Smarketer.
 */
import { GoogleAdsApi } from "google-ads-api";
import type { AdsSetupProblem } from "@shared/shopPulse";
import type { IStorage } from "../storage";
import { getGoogleAdsSettings } from "../analytics/googleKpi";
import { addDays } from "./pulseOrders";


export class AdsNotConfiguredError extends Error {
  constructor(readonly reason: AdsSetupProblem) {
    super(`Google Ads nicht eingerichtet (${reason})`);
    this.name = "AdsNotConfiguredError";
  }
}

export type AdsSettingsLike = {
  enabled?: boolean;
  customerIds?: string[];
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string;
};

/** Kunden-ID ohne Bindestriche (123-456-7890 → 1234567890) */
const cleanId = (v: string) => v.replace(/[^0-9]/g, "");

export type AdsSetup =
  | { ok: true; customerIds: string[]; loginCustomerId: string | null; credentials: { clientId: string; clientSecret: string; developerToken: string; refreshToken: string } }
  | { ok: false; reason: AdsSetupProblem };

export function checkAdsSetup(s: AdsSettingsLike): AdsSetup {
  if (!s.enabled) return { ok: false, reason: "disabled" };
  const customerIds = (s.customerIds ?? []).map(cleanId).filter((id) => id.length >= 8);
  if (!customerIds.length) return { ok: false, reason: "noCustomer" };
  const credentials = {
    clientId: s.clientId?.trim() ?? "",
    clientSecret: s.clientSecret?.trim() ?? "",
    developerToken: s.developerToken?.trim() ?? "",
    refreshToken: s.refreshToken?.trim() ?? "",
  };
  if (Object.values(credentials).some((v) => !v)) return { ok: false, reason: "noCredentials" };
  const login = cleanId(s.loginCustomerId ?? "");
  return { ok: true, customerIds, loginCustomerId: login || null, credentials };
}

/** GAQL-Abfrage für ein Konto; liefert die Zeilen wie google-ads-api (snake_case) */
export type AdsQuery = (customerId: string, gaql: string) => Promise<Array<Record<string, any>>>;

export type AdsAccount = { customerIds: string[]; query: AdsQuery };

export type AdsAccess = {
  /** Konto mit Client; wirft AdsNotConfiguredError, wenn Ads nicht eingerichtet ist */
  account(): Promise<AdsAccount>;
};

/** Fehler des Clients verständlich machen (keine Zugangsdaten im Text) */
function explain(err: unknown): Error {
  const msg = err instanceof Error ? err.message : typeof err === "object" ? JSON.stringify(err).slice(0, 300) : String(err);
  if (/PERMISSION_DENIED|USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED/i.test(msg)) return new Error("Google Ads: keine Leserechte für dieses Konto");
  if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED/i.test(msg)) return new Error("Google Ads: Developer-Token nicht freigegeben");
  if (/invalid_grant|UNAUTHENTICATED|OAUTH_TOKEN/i.test(msg)) return new Error("Google Ads: Anmeldung gescheitert (Refresh-Token ungültig)");
  return new Error(`Google Ads: ${msg.slice(0, 200)}`);
}

/** Ads des Mandanten; Einstellungen und Client werden je Lauf einmal geladen */
export function adsAccess(
  storage: Pick<IStorage, "getSetting">,
  tenantId: string | null,
  makeQuery: (setup: Extract<AdsSetup, { ok: true }>) => AdsQuery = googleAdsQuery,
): AdsAccess {
  let p: Promise<AdsAccount> | null = null;
  return {
    account: () =>
      (p ??= (async () => {
        const setup = checkAdsSetup(await getGoogleAdsSettings(storage, tenantId));
        if (!setup.ok) throw new AdsNotConfiguredError(setup.reason);
        const query = makeQuery(setup);
        return { customerIds: setup.customerIds, query: (id, gaql) => query(id, gaql).catch((err) => Promise.reject(explain(err))) };
      })()),
  };
}

function googleAdsQuery(setup: Extract<AdsSetup, { ok: true }>): AdsQuery {
  const client = new GoogleAdsApi({ client_id: setup.credentials.clientId, client_secret: setup.credentials.clientSecret, developer_token: setup.credentials.developerToken });
  return async (customerId, gaql) => {
    const customer = client.Customer({ customer_id: customerId, login_customer_id: setup.loginCustomerId ?? undefined, refresh_token: setup.credentials.refreshToken });
    return (await customer.query(gaql)) as Array<Record<string, any>>;
  };
}

// ---------------------------------------------------------------------------------------------
// Daten für die Prüfungen

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const range = (from: string, to: string) => {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) throw new Error("Ungültiger Zeitraum");
  return `segments.date BETWEEN '${from}' AND '${to}'`;
};
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const euros = (micros: unknown) => Math.round((num(micros) / 1_000_000) * 100) / 100;

export type AdsGroupRow = { customerId: string; campaignId: string; campaign: string; adGroupId: string; adGroup: string; cost: number; clicks: number; conversions: number };
export type AdsCampaignRow = {
  customerId: string;
  campaignId: string;
  campaign: string;
  channel: string;
  cost: number;
  clicks: number;
  conversions: number;
  /** Anteil der Impressionen, der wegen des Budgets verloren ging (0–1); null = nicht verfügbar */
  budgetLost: number | null;
};
export type AdsDayRow = { day: string; cost: number; conversions: number };
export type AdsProductRow = { itemId: string; cost: number; clicks: number; conversions: number };
export type AdsTermRow = { term: string; campaign: string; cost: number; clicks: number; conversions: number };

export type AdsData = {
  /** Anzeigengruppen, 14 Tage bis gestern */
  groups: AdsGroupRow[];
  /** Kampagnen, 28 Tage bis gestern */
  campaigns: AdsCampaignRow[];
  /** Kosten und Conversions je Tag, 35 Tage bis gestern (alle Konten zusammen) */
  days: AdsDayRow[];
  /** Shopping-Artikel, 7 Tage bis gestern */
  products: AdsProductRow[];
  /** Suchbegriffe, 28 Tage bis gestern, nach Kosten (höchstens 300 je Konto) */
  terms: AdsTermRow[];
};

/** Alle Daten der Ads-Prüfungen, nacheinander je Konto (fünf Abfragen je Konto) */
export async function loadAdsData(account: AdsAccount, yesterday: string): Promise<AdsData> {
  const out: AdsData = { groups: [], campaigns: [], days: [], products: [], terms: [] };
  const byDay = new Map<string, AdsDayRow>();
  for (const id of account.customerIds) {
    const groups = await account.query(
      id,
      `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.cost_micros, metrics.clicks, metrics.conversions FROM ad_group WHERE ${range(addDays(yesterday, -13), yesterday)} AND metrics.cost_micros > 0`,
    );
    for (const r of groups) {
      out.groups.push({
        customerId: id,
        campaignId: String(r.campaign?.id ?? ""),
        campaign: String(r.campaign?.name ?? ""),
        adGroupId: String(r.ad_group?.id ?? ""),
        adGroup: String(r.ad_group?.name ?? ""),
        cost: euros(r.metrics?.cost_micros),
        clicks: num(r.metrics?.clicks),
        conversions: num(r.metrics?.conversions),
      });
    }
    const campaigns = await account.query(
      id,
      `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.search_budget_lost_impression_share FROM campaign WHERE ${range(addDays(yesterday, -27), yesterday)} AND metrics.cost_micros > 0`,
    );
    for (const r of campaigns) {
      const lost = r.metrics?.search_budget_lost_impression_share;
      out.campaigns.push({
        customerId: id,
        campaignId: String(r.campaign?.id ?? ""),
        campaign: String(r.campaign?.name ?? ""),
        channel: String(r.campaign?.advertising_channel_type ?? ""),
        cost: euros(r.metrics?.cost_micros),
        clicks: num(r.metrics?.clicks),
        conversions: num(r.metrics?.conversions),
        budgetLost: lost == null || lost === "" ? null : num(lost),
      });
    }
    const days = await account.query(id, `SELECT segments.date, metrics.cost_micros, metrics.conversions FROM customer WHERE ${range(addDays(yesterday, -34), yesterday)}`);
    for (const r of days) {
      const day = String(r.segments?.date ?? "");
      const row = byDay.get(day) ?? { day, cost: 0, conversions: 0 };
      row.cost = Math.round((row.cost + euros(r.metrics?.cost_micros)) * 100) / 100;
      row.conversions += num(r.metrics?.conversions);
      byDay.set(day, row);
    }
    const products = await account.query(
      id,
      `SELECT segments.product_item_id, metrics.cost_micros, metrics.clicks, metrics.conversions FROM shopping_performance_view WHERE ${range(addDays(yesterday, -6), yesterday)} AND metrics.cost_micros > 0`,
    );
    for (const r of products) {
      out.products.push({ itemId: String(r.segments?.product_item_id ?? ""), cost: euros(r.metrics?.cost_micros), clicks: num(r.metrics?.clicks), conversions: num(r.metrics?.conversions) });
    }
    const terms = await account.query(
      id,
      `SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions FROM search_term_view WHERE ${range(addDays(yesterday, -27), yesterday)} AND metrics.cost_micros > 0 ORDER BY metrics.cost_micros DESC LIMIT 300`,
    );
    for (const r of terms) {
      out.terms.push({ term: String(r.search_term_view?.search_term ?? ""), campaign: String(r.campaign?.name ?? ""), cost: euros(r.metrics?.cost_micros), clicks: num(r.metrics?.clicks), conversions: num(r.metrics?.conversions) });
    }
  }
  out.days = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

/** Kosten, Klicks und Conversions einer Woche (Wochenbericht), alle Konten */
export async function loadAdsWeek(account: AdsAccount, from: string, to: string): Promise<{ cost: number; clicks: number; conversions: number }> {
  let cost = 0;
  let clicks = 0;
  let conversions = 0;
  for (const id of account.customerIds) {
    for (const r of await account.query(id, `SELECT metrics.cost_micros, metrics.clicks, metrics.conversions FROM customer WHERE ${range(from, to)}`)) {
      cost += euros(r.metrics?.cost_micros);
      clicks += num(r.metrics?.clicks);
      conversions += num(r.metrics?.conversions);
    }
  }
  return { cost: Math.round(cost * 100) / 100, clicks, conversions: Math.round(conversions * 10) / 10 };
}
