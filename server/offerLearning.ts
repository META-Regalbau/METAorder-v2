import type { IStorage } from "./storage";
import type { Offer, ShopwareSettings } from "@shared/schema";
import { B2BSellersClient } from "./b2bSellersClient";

type OfferLearningSettings = {
  lookbackDays: number;
  minOfferValue: number;
};

const DEFAULT_SETTINGS: OfferLearningSettings = {
  lookbackDays: 90,
  minOfferValue: 0,
};

export async function getOfferLearningSettings(
  storage: IStorage,
  tenantId?: string | null
): Promise<OfferLearningSettings> {
  const stored = (await storage.getSetting("offer_learning_settings", tenantId)) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  } as OfferLearningSettings;
}

export async function runOfferLearning(
  storage: IStorage,
  shopwareSettings: ShopwareSettings,
  tenantId?: string | null
) {
  const settings = await getOfferLearningSettings(storage, tenantId);
  const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
  const client = new B2BSellersClient(shopwareSettings, { statusMapping });

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - settings.lookbackDays);

  const offers = await fetchAllOffers(client, dateFrom.toISOString());
  const filteredOffers = offers.filter((offer) => (offer.totalPrice || 0) >= settings.minOfferValue);

  const insights = buildOfferInsights(filteredOffers);
  await storage.replaceOfferLearningInsights(insights, tenantId);

  return {
    status: "completed",
    processedOffers: filteredOffers.length,
  };
}

async function fetchAllOffers(client: B2BSellersClient, dateFrom?: string): Promise<Offer[]> {
  const limit = 100;
  let page = 1;
  let allOffers: Offer[] = [];
  let total = 0;

  do {
    const result = await client.fetchOffers({
      dateFrom,
      page,
      limit,
    });
    allOffers = allOffers.concat(result.offers);
    total = result.total || allOffers.length;
    page += 1;
  } while (allOffers.length < total && page < 200);

  return allOffers;
}

function buildOfferInsights(offers: Offer[]) {
  const now = new Date();
  const statusCounts: Record<string, number> = {};
  const totalsByStatus: Record<string, number[]> = {};
  const customerCounts: Record<string, number> = {};

  offers.forEach((offer) => {
    const status = offer.status || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    totalsByStatus[status] = totalsByStatus[status] || [];
    totalsByStatus[status].push(offer.totalPrice || 0);

    const customerKey = offer.customerName || offer.customerEmail || offer.customerId || "Unbekannt";
    customerCounts[customerKey] = (customerCounts[customerKey] || 0) + 1;
  });

  const topCustomers = Object.entries(customerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([customer, count]) => ({ customer, count }));

  const avgByStatus = Object.fromEntries(
    Object.entries(totalsByStatus).map(([status, values]) => {
      const avg = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return [status, avg];
    })
  );

  const approved = statusCounts.approved || 0;
  const rejected = statusCounts.rejected || 0;
  const submitted = statusCounts.submitted || 0;
  const sent = statusCounts.sent || 0;
  const denominator = approved + rejected + submitted + sent;
  const conversionRate = denominator > 0 ? approved / denominator : 0;
  const totalOffers = offers.length;
  const acceptedOfAllRate = totalOffers > 0 ? approved / totalOffers : 0;

  return [
    {
      insightType: "offer_status_distribution",
      title: "Angebotsstatus Verteilung",
      description: "Verteilung der Angebots-Status im Zeitraum",
      data: { statusCounts },
      generatedAt: now,
    },
    {
      insightType: "offer_conversion",
      title: "Angebots-Conversion",
      description: "Anteil freigegebener Angebote",
      data: {
        conversionRate,
        approved,
        rejected,
        submitted,
        sent,
        totalOffers,
        acceptedOfAllRate,
      },
      generatedAt: now,
    },
    {
      insightType: "offer_avg_values",
      title: "Durchschnittlicher Angebotswert",
      description: "Durchschnittswerte nach Status",
      data: { avgByStatus },
      generatedAt: now,
    },
    {
      insightType: "top_customers",
      title: "Top Angebot-Kunden",
      description: "Kunden mit den meisten Angebotsanfragen",
      data: { topCustomers },
      generatedAt: now,
    },
  ];
}
