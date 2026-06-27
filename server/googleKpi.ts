import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { GoogleAdsApi } from "google-ads-api";
import type { GoogleAdsSettings, GoogleAnalyticsSettings } from "@shared/schema";
import type { IStorage } from "./storage";
import { decrypt, encrypt } from "./encryption";

const DEFAULT_GA_SETTINGS: GoogleAnalyticsSettings = {
  enabled: false,
  propertyIds: [],
  serviceAccountJson: "",
};

const DEFAULT_ADS_SETTINGS: GoogleAdsSettings = {
  enabled: false,
  customerIds: [],
  developerToken: "",
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  loginCustomerId: "",
};

function normalizeIds(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseServiceAccountJson(raw?: string) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getGoogleAnalyticsSettings(storage: IStorage) {
  const stored = await storage.getSetting("ga4_settings");
  return {
    ...DEFAULT_GA_SETTINGS,
    ...stored,
    serviceAccountJson: stored?.serviceAccountJson ? decrypt(stored.serviceAccountJson) : "",
  } as GoogleAnalyticsSettings;
}

export async function saveGoogleAnalyticsSettings(storage: IStorage, settings: GoogleAnalyticsSettings) {
  const payload = {
    ...settings,
    propertyIds: settings.propertyIds || [],
    serviceAccountJson: settings.serviceAccountJson ? encrypt(settings.serviceAccountJson) : settings.serviceAccountJson,
  };
  await storage.saveSetting("ga4_settings", payload);
}

export async function getGoogleAdsSettings(storage: IStorage) {
  const stored = await storage.getSetting("google_ads_settings");
  return {
    ...DEFAULT_ADS_SETTINGS,
    ...stored,
    developerToken: stored?.developerToken ? decrypt(stored.developerToken) : "",
    clientId: stored?.clientId ? decrypt(stored.clientId) : "",
    clientSecret: stored?.clientSecret ? decrypt(stored.clientSecret) : "",
    refreshToken: stored?.refreshToken ? decrypt(stored.refreshToken) : "",
  } as GoogleAdsSettings;
}

export async function saveGoogleAdsSettings(storage: IStorage, settings: GoogleAdsSettings) {
  const payload = {
    ...settings,
    customerIds: settings.customerIds || [],
    developerToken: settings.developerToken ? encrypt(settings.developerToken) : settings.developerToken,
    clientId: settings.clientId ? encrypt(settings.clientId) : settings.clientId,
    clientSecret: settings.clientSecret ? encrypt(settings.clientSecret) : settings.clientSecret,
    refreshToken: settings.refreshToken ? encrypt(settings.refreshToken) : settings.refreshToken,
  };
  await storage.saveSetting("google_ads_settings", payload);
}

function getDateRanges(dateFrom?: string, dateTo?: string) {
  const today = new Date();
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  const to = dateTo || fmt(today);
  const from = dateFrom || fmt(new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000));
  const dayFrom = fmt(new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000));
  const weekFrom = fmt(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
  const monthFrom = fmt(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
  return {
    from,
    to,
    dayFrom,
    weekFrom,
    monthFrom,
  };
}

export async function fetchGa4Kpis(
  storage: IStorage,
  dateFrom?: string,
  dateTo?: string
) {
  const settings = await getGoogleAnalyticsSettings(storage);
  if (!settings.enabled || settings.propertyIds.length === 0) {
    return null;
  }

  const credentials = parseServiceAccountJson(settings.serviceAccountJson);
  if (!credentials) {
    return null;
  }

  const client = new BetaAnalyticsDataClient({ credentials });
  const propertyId = settings.propertyIds[0];
  const dates = getDateRanges(dateFrom, dateTo);

  const runReport = async (from: string, to: string) => {
    const [report] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: from, endDate: to }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
    });
    const row = report.rows?.[0];
    return {
      activeUsers: Number(row?.metricValues?.[0]?.value || 0),
      sessions: Number(row?.metricValues?.[1]?.value || 0),
    };
  };

  const [daily, weekly, monthly, range] = await Promise.all([
    runReport(dates.dayFrom, dates.to),
    runReport(dates.weekFrom, dates.to),
    runReport(dates.monthFrom, dates.to),
    runReport(dates.from, dates.to),
  ]);

  return {
    propertyId,
    dailyUsers: daily.activeUsers,
    weeklyUsers: weekly.activeUsers,
    monthlyUsers: monthly.activeUsers,
    rangeUsers: range.activeUsers,
    rangeSessions: range.sessions,
  };
}

export async function fetchAdsKpis(
  storage: IStorage,
  dateFrom?: string,
  dateTo?: string
) {
  const settings = await getGoogleAdsSettings(storage);
  if (!settings.enabled || settings.customerIds.length === 0) {
    return null;
  }

  if (!settings.developerToken || !settings.clientId || !settings.clientSecret || !settings.refreshToken) {
    return null;
  }

  const dates = getDateRanges(dateFrom, dateTo);
  const client = new GoogleAdsApi({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    developer_token: settings.developerToken,
  });

  const campaigns: Array<{
    customerId: string;
    campaignId: string;
    campaignName: string;
    cost: number;
    conversions: number;
    clicks: number;
    impressions: number;
  }> = [];

  for (const customerId of settings.customerIds) {
    const customer = client.Customer({
      customer_id: customerId,
      login_customer_id: settings.loginCustomerId || undefined,
      refresh_token: settings.refreshToken,
    });

    const rows = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        metrics.cost_micros,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions
      FROM campaign
      WHERE segments.date BETWEEN '${dates.from}' AND '${dates.to}'
    `);

    for (const row of rows) {
      if (!row.campaign || !row.metrics) continue;
      campaigns.push({
        customerId,
        campaignId: String(row.campaign.id),
        campaignName: row.campaign.name ?? "",
        cost: Number(row.metrics.cost_micros || 0) / 1_000_000,
        conversions: Number(row.metrics.conversions || 0),
        clicks: Number(row.metrics.clicks || 0),
        impressions: Number(row.metrics.impressions || 0),
      });
    }
  }

  const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;

  return {
    totalCost,
    totalConversions,
    conversionRate,
    costPerConversion: totalConversions > 0 ? totalCost / totalConversions : 0,
    totalClicks,
    totalImpressions,
    campaigns,
  };
}

export function parseIdsInput(input: string) {
  return normalizeIds(input);
}
