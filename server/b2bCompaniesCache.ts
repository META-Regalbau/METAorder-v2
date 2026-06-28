import { getHashCached } from "./contentHashCache";
import type { B2BCompanyListItem, B2BSellersAdminClient } from "./b2bSellersAdmin";

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
