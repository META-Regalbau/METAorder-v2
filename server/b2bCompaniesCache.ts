import { getHashCached } from "./contentHashCache";
import type { B2BCompanyListItem, B2BSellersAdminClient } from "./b2bSellersAdmin";
import { storage } from "./storage";
import { triggerShopwareMirrorSync } from "./shopwareMirror";
import { ShopwareClient } from "./shopware";

const CACHE_KEY_PREFIX = "b2b_companies_snapshot_v1";

function cacheKeyForChannels(salesChannelIds?: string[]): string {
  const channelKey = salesChannelIds?.length ? salesChannelIds.slice().sort().join(",") : "all";
  return `${CACHE_KEY_PREFIX}:${channelKey}`;
}

function filterCompaniesBySearch(companies: B2BCompanyListItem[], search?: string): B2BCompanyListItem[] {
  const query = search?.trim().toLowerCase();
  if (!query) return companies;

  return companies.filter((company) =>
    [company.company, company.email, company.customerNumber]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
}

function filterByChannels(
  companies: B2BCompanyListItem[],
  salesChannelIds?: string[],
): B2BCompanyListItem[] {
  if (!salesChannelIds?.length) return companies;
  const allowed = new Set(salesChannelIds);
  return companies.filter((c) => !c.salesChannelId || allowed.has(c.salesChannelId));
}

export async function getB2BCompaniesCached(
  client: B2BSellersAdminClient,
  options: {
    search?: string;
    page?: number;
    limit?: number;
    salesChannelIds?: string[];
    tenantId?: string | null;
  },
): Promise<{ companies: B2BCompanyListItem[]; total: number; fromCache: boolean }> {
  const { search, page = 1, limit = 50, salesChannelIds, tenantId } = options;

  // Prefer persistent DB mirror
  const mirrorCount = await storage.countShopwareB2bCompanyMirrors(tenantId);
  if (mirrorCount > 0) {
    const mirrorRows = await storage.getShopwareB2bCompanyMirrors(tenantId);
    let companies = mirrorRows.map((row) => {
      const payload = row.payload as B2BCompanyListItem;
      return {
        id: payload?.id || row.companyId,
        customerId: row.customerId,
        company: row.company || payload?.company || "",
        email: row.email || payload?.email || "",
        customerNumber: row.customerNumber ?? payload?.customerNumber ?? null,
        active: row.active ?? payload?.active ?? true,
        createdAt: payload?.createdAt ?? null,
        salesChannelId: row.salesChannelId ?? payload?.salesChannelId ?? null,
        salesChannelName: payload?.salesChannelName ?? null,
      } satisfies B2BCompanyListItem;
    });
    companies = filterByChannels(companies, salesChannelIds);
    const filtered = filterCompaniesBySearch(companies, search);
    const start = (page - 1) * limit;
    return {
      companies: filtered.slice(start, start + limit),
      total: filtered.length,
      fromCache: true,
    };
  }

  // Cold start: fall back to hash-cache snapshot + trigger mirror sync
  try {
    const settings = await storage.getShopwareSettings(tenantId);
    if (settings) {
      triggerShopwareMirrorSync(storage, new ShopwareClient(settings), tenantId ?? null, [
        "b2b_companies",
      ]);
    }
  } catch {
    // ignore
  }

  const cacheKey = cacheKeyForChannels(salesChannelIds);

  const { data: snapshot, fromCache } = await getHashCached<B2BCompanyListItem[]>({
    cacheKey,
    tenantId,
    fetchFingerprint: () => client.fetchCompaniesSnapshotFingerprint(salesChannelIds),
    fetchFull: () => client.loadCompaniesSnapshot(salesChannelIds),
  });

  const filtered = filterCompaniesBySearch(snapshot, search);
  const start = (page - 1) * limit;

  return {
    companies: filtered.slice(start, start + limit),
    total: filtered.length,
    fromCache,
  };
}
