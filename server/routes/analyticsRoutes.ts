// Auswertungen und Dashboard: Kennzahlen, Trends, Produkt-/Versandauswertungen, NL-Abfragen, GA4/Ads sowie Dashboard-Kacheln.
import { requireAuth, requireViewAnalytics, requireViewNaturalLanguageAnalytics, requireViewTickets, requireViewCrm, requireViewDelayedOrders, requireViewShipping } from "../auth/auth";
import { fetchGa4Kpis, fetchAdsKpis } from "../analytics/googleKpi";
import { storage } from "../storage";
import { getSalesChannelFilter, narrowSalesChannelFilter, filterTicketsBySalesChannels, filterOrdersBySalesChannels, getMirrorOrdersLikeLive } from "./routeHelpers";
import { selectDelayedOrders } from "../shopware/ordersList";
import { ShopwareClient } from "../shopware/shopware";
import { processNaturalLanguageQuery } from "../analytics/naturalLanguageAnalytics";
import { executeAnalyticsQuery } from "../analytics/analyticsQueryExecutor";
import { generateInsights } from "../analytics/automaticInsights";
import { parseAnalyticsLanguage } from "../analytics/nlLanguage";
import type { Request, Response, Express } from "express";
import { type NlQueryErrorCode, type Order } from "@shared/schema";
import { matchesOrderNumberFilter, parseOrderNumberFilter, type OrderNumberFilter } from "@shared/orderNumberFilter";
import { isOrderEligibleForShippingPick } from "@shared/orderShippingEligibility";
import { toImportedInquirySummary } from "../commercial/importedInquirySummary";
import { analyticsFilterFromRequest, loadAnalyticsOrders } from "../analytics/analyticsOrders";
import { consumeNlQuota, getNlUsage, NL_LIMIT_DEFAULTS, resolveNlLimits, type NlLimits } from "../analytics/nlQueryLimit";
import { nlUsageStore } from "../analytics/nlQueryUsageStore";
import { dataQualityCacheKey, fetchAllDataQualityProducts, productDataQualityCache, summarizeDataQuality } from "../analytics/productDataQuality";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/analyticsRoutes" });

/**
 * Dashboard-Kacheln zaehlen nur Shop-Bestellungen (MO...): die durchgeschleusten Bestellungen ohne
 * MO im Haendlerportal (Live 2026 rund 1.600, fast alle "in Bearbeitung") fuellten sonst "offene
 * Bestellungen", Versandbereit und die neuesten Bestellungen. Parameter orderNumberFilter=all
 * schaltet das ab.
 */
function dashboardOrderNumberFilter(req: Request): OrderNumberFilter {
  return req.query.orderNumberFilter === undefined ? "mo" : parseOrderNumberFilter(req.query.orderNumberFilter);
}

function dashboardOrders(orders: Order[], req: Request): Order[] {
  const filter = dashboardOrderNumberFilter(req);
  return orders.filter((order) => matchesOrderNumberFilter(order.orderNumber, filter));
}

export function registerAnalyticsRoutes(app: Express): void {
  // Google KPI endpoints
  app.get("/api/analytics/google/ga4", requireAuth, requireViewAnalytics, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await fetchGa4Kpis(
        storage,
        typeof dateFrom === "string" ? dateFrom : undefined,
        typeof dateTo === "string" ? dateTo : undefined
      );
      res.json(data || {});
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching GA4 KPIs:");
      res.status(500).json({ error: error.message || "Failed to fetch GA4 KPIs" });
    }
  });

  app.get("/api/analytics/google/ads", requireAuth, requireViewAnalytics, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      const data = await fetchAdsKpis(
        storage,
        typeof dateFrom === "string" ? dateFrom : undefined,
        typeof dateTo === "string" ? dateTo : undefined
      );
      res.json(data || {});
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching Google Ads KPIs:");
      res.status(500).json({ error: error.message || "Failed to fetch Google Ads KPIs" });
    }
  });

  // Analytics Endpoints
  app.get("/api/analytics/summary", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      // Calculate summary metrics
      const totalOrders = orders.length;
      const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      const totalNetRevenue = orders.reduce((sum, order) => sum + order.netTotalAmount, 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const averageNetOrderValue = totalOrders > 0 ? totalNetRevenue / totalOrders : 0;

      // Count unique customers
      const uniqueCustomers = new Set(orders.map(o => o.customerEmail || o.customerName)).size;

      res.json({
        totalOrders,
        totalRevenue,
        totalNetRevenue,
        averageOrderValue,
        averageNetOrderValue,
        uniqueCustomers,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching analytics summary:");
      res.status(500).json({ error: error.message || "Failed to fetch analytics summary" });
    }
  });

  app.get("/api/analytics/product-data-quality", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const salesChannelIds = narrowSalesChannelFilter(await getSalesChannelFilter(req), req.query.salesChannelIds);
      // Zwischengespeichert je Mandant und Kanalfilter (siehe server/analytics/productDataQuality.ts)
      const summary = await productDataQualityCache.get(
        dataQualityCacheKey((req as any).tenantId, salesChannelIds),
        async () => summarizeDataQuality(await fetchAllDataQualityProducts(client, salesChannelIds)),
      );
      res.json(summary);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product data quality:");
      res.status(500).json({ error: error.message || "Failed to fetch product data quality" });
    }
  });

  app.get("/api/analytics/order-status", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      // Group by order status
      const statusDistribution: Record<string, number> = {};
      orders.forEach(order => {
        statusDistribution[order.status] = (statusDistribution[order.status] || 0) + 1;
      });

      res.json(statusDistribution);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching order status distribution:");
      res.status(500).json({ error: error.message || "Failed to fetch order status distribution" });
    }
  });

  app.get("/api/analytics/payment-status", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      // Group by payment status
      const paymentDistribution: Record<string, number> = {};
      orders.forEach(order => {
        paymentDistribution[order.paymentStatus] = (paymentDistribution[order.paymentStatus] || 0) + 1;
      });

      res.json(paymentDistribution);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching payment status distribution:");
      res.status(500).json({ error: error.message || "Failed to fetch payment status distribution" });
    }
  });

  app.get("/api/analytics/product-overview", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);

      const activeResponse = await client.searchEntity("product", {
        limit: 1,
        page: 1,
        "total-count-mode": 1,
        filter: [
          {
            type: "equals",
            field: "active",
            value: true,
          },
        ],
      });
      const inactiveResponse = await client.searchEntity("product", {
        limit: 1,
        page: 1,
        "total-count-mode": 1,
        filter: [
          {
            type: "equals",
            field: "active",
            value: false,
          },
        ],
      });
      const activeCount = activeResponse?.total || 0;
      const inactiveCount = inactiveResponse?.total || 0;

      res.json({
        total: activeCount + inactiveCount,
        active: activeCount,
        inactive: inactiveCount,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product overview:");
      res.status(500).json({ error: error.message || "Failed to fetch product overview" });
    }
  });

  app.get("/api/analytics/product-activity-trend", requireAuth, async (_req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const limit = 500;
      let page = 1;
      let total = 0;
      const products: Array<{ createdAt?: string; active?: boolean }> = [];

      do {
        const result = await client.fetchProducts(limit, page, undefined, undefined, false, undefined, undefined, undefined, true);
        total = result.total || 0;
        products.push(...result.products.map((p) => ({ createdAt: p.createdAt, active: p.active })));
        page += 1;
      } while (products.length < total);

      const now = new Date();
      const months: Array<{ key: string; label: string }> = [];
      for (let i = 11; i >= 0; i -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        months.push({ key, label: key });
      }

      const createdCounts: Record<string, { active: number; inactive: number }> = {};
      months.forEach((m) => {
        createdCounts[m.key] = { active: 0, inactive: 0 };
      });

      products.forEach((product) => {
        if (!product.createdAt) return;
        const created = new Date(product.createdAt);
        if (Number.isNaN(created.getTime())) return;
        const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
        if (!createdCounts[key]) return;
        const isActive = product.active !== undefined ? product.active : true;
        if (isActive) {
          createdCounts[key].active += 1;
        } else {
          createdCounts[key].inactive += 1;
        }
      });

      let cumulativeActive = 0;
      let cumulativeInactive = 0;
      const trend = months.map((month) => {
        const monthCounts = createdCounts[month.key] || { active: 0, inactive: 0 };
        cumulativeActive += monthCounts.active;
        cumulativeInactive += monthCounts.inactive;
        return {
          month: month.key,
          active: cumulativeActive,
          inactive: cumulativeInactive,
        };
      });

      res.json({ trend });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product activity trend:");
      res.status(500).json({ error: error.message || "Failed to fetch product activity trend" });
    }
  });

  app.get("/api/analytics/category-sales", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      // Calculate sales by category
      const categorySales: Record<string, { revenue: number; netRevenue: number; quantity: number }> = {};
      
      orders.forEach(order => {
        order.items.forEach(item => {
          // Use product name as category if categoryNames not available
          const categories = item.categoryNames || ['Uncategorized'];
          
          categories.forEach(category => {
            if (!categorySales[category]) {
              categorySales[category] = { revenue: 0, netRevenue: 0, quantity: 0 };
            }
            categorySales[category].revenue += item.total;
            categorySales[category].netRevenue += item.netTotal;
            categorySales[category].quantity += item.quantity;
          });
        });
      });

      // Convert to array and sort by revenue
      const sortedCategories = Object.entries(categorySales)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue);

      res.json(sortedCategories);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching category sales:");
      res.status(500).json({ error: error.message || "Failed to fetch category sales" });
    }
  });

  app.get("/api/analytics/product-performance", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);
      
      const minQuantity = parseInt(req.query.minQuantity as string) || 1;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      // Calculate product performance
      const productPerformance: Record<string, {
        name: string;
        totalQuantity: number;
        totalRevenue: number;
        totalNetRevenue: number;
        orderCount: number;
      }> = {};

      orders.forEach(order => {
        order.items.forEach(item => {
          const key = item.name;
          if (!productPerformance[key]) {
            productPerformance[key] = {
              name: item.name,
              totalQuantity: 0,
              totalRevenue: 0,
              totalNetRevenue: 0,
              orderCount: 0,
            };
          }
          productPerformance[key].totalQuantity += item.quantity;
          productPerformance[key].totalRevenue += item.total;
          productPerformance[key].totalNetRevenue += item.netTotal;
          productPerformance[key].orderCount += 1;
        });
      });

      // Filter by minimum quantity and sort by quantity
      const topProducts = Object.values(productPerformance)
        .filter(p => p.totalQuantity >= minQuantity)
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 50); // Top 50 products

      // Get bottom performers (Penner) - products with low sales
      const bottomProducts = Object.values(productPerformance)
        .filter(p => p.totalQuantity >= minQuantity)
        .sort((a, b) => a.totalQuantity - b.totalQuantity)
        .slice(0, 50); // Bottom 50 products

      res.json({
        topProducts,
        bottomProducts,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching product performance:");
      res.status(500).json({ error: error.message || "Failed to fetch product performance" });
    }
  });

  app.get("/api/analytics/sales-trend", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      // Group by date
      const dailySales: Record<string, { date: string; revenue: number; netRevenue: number; orderCount: number }> = {};

      orders.forEach(order => {
        const date = order.orderDate.split('T')[0]; // Get date part only
        if (!dailySales[date]) {
          dailySales[date] = {
            date,
            revenue: 0,
            netRevenue: 0,
            orderCount: 0,
          };
        }
        dailySales[date].revenue += order.totalAmount;
        dailySales[date].netRevenue += order.netTotalAmount;
        dailySales[date].orderCount += 1;
      });

      // Convert to array and sort by date
      const trendData = Object.values(dailySales).sort((a, b) => a.date.localeCompare(b.date));

      res.json(trendData);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching sales trend:");
      res.status(500).json({ error: error.message || "Failed to fetch sales trend" });
    }
  });

  app.get("/api/analytics/shipping-times", requireAuth, async (req, res) => {
    try {
      // Kanaele: Auswahl des Nutzers, serverseitig auf seine Berechtigung beschraenkt
      const filter = await analyticsFilterFromRequest(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await loadAnalyticsOrders(client, (req as any).tenantId, filter);

      const ordersWithShipping = orders.filter(
        (o) => o.shippingInfo?.shippedDate && o.orderDate
      );

      const daysList: number[] = [];
      for (const order of ordersWithShipping) {
        const shipped = new Date(order.shippingInfo!.shippedDate!).getTime();
        const ordered = new Date(order.orderDate).getTime();
        const days = (shipped - ordered) / (24 * 60 * 60 * 1000);
        if (Number.isFinite(days) && days >= 0) {
          daysList.push(days);
        }
      }

      const ordersWithShippingCount = daysList.length;
      const averageDays = ordersWithShippingCount > 0
        ? daysList.reduce((a, b) => a + b, 0) / ordersWithShippingCount
        : 0;
      const sorted = [...daysList].sort((a, b) => a - b);
      const medianDays = ordersWithShippingCount > 0
        ? ordersWithShippingCount % 2 === 0
          ? (sorted[ordersWithShippingCount / 2 - 1] + sorted[ordersWithShippingCount / 2]) / 2
          : sorted[Math.floor(ordersWithShippingCount / 2)]
        : 0;
      const averageHours = averageDays * 24;
      const medianHours = medianDays * 24;

      const distribution = {
        "0-1": 0,
        "1-2": 0,
        "2-3": 0,
        ">3": 0,
      };
      for (const d of daysList) {
        if (d <= 1) distribution["0-1"]++;
        else if (d <= 2) distribution["1-2"]++;
        else if (d <= 3) distribution["2-3"]++;
        else distribution[">3"]++;
      }

      res.json({
        ordersWithShippingCount,
        averageDays: Math.round(averageDays * 100) / 100,
        medianDays: Math.round(medianDays * 100) / 100,
        averageHours: Math.round(averageHours * 100) / 100,
        medianHours: Math.round(medianHours * 100) / 100,
        distribution: [
          { label: "0–1 Tage", count: distribution["0-1"] },
          { label: "1–2 Tage", count: distribution["1-2"] },
          { label: "2–3 Tage", count: distribution["2-3"] },
          { label: ">3 Tage", count: distribution[">3"] },
        ],
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching shipping times:");
      res.status(500).json({ error: error.message || "Failed to fetch shipping times" });
    }
  });

  // ============================================
  // Natural Language Analytics Routes
  // ============================================

  /** Grenzen aus den KI-Einstellungen; nicht lesbar -> Standardwerte (die Grenze gilt trotzdem) */
  const loadNlLimits = async (): Promise<NlLimits> => {
    try {
      return resolveNlLimits(await storage.getSetting("openai_settings"));
    } catch (error) {
      moduleLog.warn({ err: error }, "[NL Analytics API] KI-Einstellungen nicht lesbar, Standard-Limits:");
      return { ...NL_LIMIT_DEFAULTS };
    }
  };

  // GET /api/analytics/nl-query/usage - Fragen heute (Anzeige "x von y Fragen heute")
  app.get("/api/analytics/nl-query/usage", requireAuth, requireViewNaturalLanguageAnalytics, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return res.status(401).json({ error: "User not authenticated" });
      const usage = await getNlUsage(nlUsageStore, {
        tenantId: String((req as any).tenantId ?? ""),
        userId: String(userId),
        limits: await loadNlLimits(),
      });
      res.json(usage);
    } catch (error: any) {
      moduleLog.error({ err: error }, "[NL Analytics API] Usage lookup failed:");
      res.status(500).json({ error: "Failed to load usage" });
    }
  });

  // POST /api/analytics/nl-query - Natural Language Query endpoint
  // Processes natural language questions and returns analytics results with insights
  app.post("/api/analytics/nl-query", requireAuth, requireViewNaturalLanguageAnalytics, async (req, res) => {
    try {
      moduleLog.info("[NL Analytics API] Processing natural language query request");
      
      const user = req.user as any;
      const userId = user?.id;
      
      if (!userId) {
        moduleLog.error("[NL Analytics API] No user ID found in request");
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Validate request body
      const { question } = req.body;
      // Sprache der Oberflaeche fuer KI-Texte und feste Beschriftungen (Standard Deutsch)
      const language = parseAnalyticsLanguage(req.body?.language);
      
      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        moduleLog.error("[NL Analytics API] Invalid or missing question in request body");
        return res.status(400).json({ error: "Invalid question. Please provide a non-empty question string.", code: "invalid_question" satisfies NlQueryErrorCode });
      }

      // Limit vor dem ersten KI-Aufruf: je Minute, je Nutzer/Tag, je Mandant/Tag
      const quota = await consumeNlQuota(nlUsageStore, {
        tenantId: String((req as any).tenantId ?? ""),
        userId: String(userId),
        limits: await loadNlLimits(),
      });
      if (!quota.ok) {
        moduleLog.warn(`[NL Analytics API] Limit erreicht (${quota.reason}) fuer Nutzer ${userId}: ${quota.used}/${quota.limit}`);
        return res.status(429).json({
          error: "Question limit reached",
          code: quota.reason satisfies NlQueryErrorCode,
          used: quota.used,
          limit: quota.limit,
        });
      }

      moduleLog.info(`[NL Analytics API] User ${userId} asked: "${question}"`);

      // Step 1: Process natural language query into structured query
      moduleLog.info("[NL Analytics API] Step 1: Processing natural language query...");
      let queryObj;
      try {
        queryObj = await processNaturalLanguageQuery(question, userId, storage);
        moduleLog.info(`[NL Analytics API] Query processed successfully: ${JSON.stringify(queryObj, null, 2)}`);
      } catch (error: any) {
        moduleLog.error({ err: error }, "[NL Analytics API] Error processing natural language query:");
        if (String(error?.message ?? "").startsWith("LLM integration not available")) {
          return res.status(503).json({
            error: "No AI chat provider is configured for this tenant.",
            code: "llm_unavailable" satisfies NlQueryErrorCode,
          });
        }
        return res.status(400).json({ 
          error: "Failed to understand the question. Please try rephrasing.",
          code: "not_understood" satisfies NlQueryErrorCode,
          details: error.message 
        });
      }

      // Step 2: Initialize ShopwareClient from settings
      moduleLog.info("[NL Analytics API] Step 2: Initializing Shopware client...");
      const settings = await storage.getShopwareSettings();
      
      if (!settings) {
        moduleLog.error("[NL Analytics API] No Shopware settings configured - cannot execute analytics query");
        return res.status(400).json({ 
          error: "Shopware settings not configured. Please configure Shopware API credentials in settings.",
          code: "shopware_missing" satisfies NlQueryErrorCode,
        });
      }
      
      const shopwareClient = new ShopwareClient(settings);
      moduleLog.info("[NL Analytics API] Shopware client initialized successfully");

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      moduleLog.info("[NL Analytics API] Step 2.5: Getting sales channel filter...");
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
        if (allowedChannelIds) {
          moduleLog.info({ allowedChannelIds }, "[NL Analytics API] SECURITY: User restricted to sales channels:");
        } else {
          moduleLog.info("[NL Analytics API] SECURITY: Admin access - no sales channel filtering");
        }
      } catch (error: any) {
        moduleLog.error({ err: error }, "[NL Analytics API] Error getting sales channel filter:");
        return res.status(500).json({ 
          error: "Failed to determine user permissions",
          code: "permissions_failed" satisfies NlQueryErrorCode,
          details: error.message 
        });
      }

      // SECURITY: Remove any user-provided sales channel IDs from AI-extracted parameters
      // Only server-authoritative allowedChannelIds should be used
      if ("salesChannelId" in queryObj.parameters && queryObj.parameters.salesChannelId) {
        moduleLog.info("[NL Analytics API] SECURITY: Stripping user-provided salesChannelId from query parameters");
        delete (queryObj.parameters as Record<string, unknown>).salesChannelId;
      }
      if ("salesChannelIds" in queryObj.parameters) {
        moduleLog.info("[NL Analytics API] SECURITY: Stripping user-provided salesChannelIds from query parameters");
        delete (queryObj.parameters as Record<string, unknown>).salesChannelIds;
      }
      
      // Step 3: Execute the analytics query with sales channel filtering
      moduleLog.info("[NL Analytics API] Step 3: Executing analytics query...");
      let result;
      try {
        result = await executeAnalyticsQuery(
          queryObj, storage, shopwareClient, allowedChannelIds, (req as any).tenantId ?? null, language,
          parseOrderNumberFilter(req.body?.orderNumberFilter),
        );
        moduleLog.info("[NL Analytics API] Query executed successfully");
        moduleLog.info(`[NL Analytics API] Result summary: ${JSON.stringify(result.summary, null, 2)}`);
      } catch (error: any) {
        moduleLog.error({ err: error }, "[NL Analytics API] Error executing analytics query:");
        return res.status(500).json({ 
          error: "Failed to execute analytics query",
          code: "execution_failed" satisfies NlQueryErrorCode,
          details: error.message 
        });
      }

      // Step 4: Generate insights from the results
      moduleLog.info("[NL Analytics API] Step 4: Generating insights...");
      let insights: any[] = [];
      try {
        insights = await generateInsights(result, queryObj.type, storage, language);
        moduleLog.info(`[NL Analytics API] Generated ${insights.length} insights`);
      } catch (error: any) {
        moduleLog.error({ err: error }, "[NL Analytics API] Error generating insights:");
        // Don't fail the request if insights generation fails - return empty insights
        insights = [];
        moduleLog.info("[NL Analytics API] Continuing with empty insights array");
      }

      // Step 5: Generate improvement suggestions for forecast queries
      const isForecastQuery = ['revenue_forecast', 'product_demand_forecast', 'seasonal_analysis', 'trend_forecast'].includes(queryObj.type);
      let improvements: any[] = [];
      
      if (isForecastQuery) {
        moduleLog.info("[NL Analytics API] Step 5: Generating improvement suggestions...");
        try {
          const { generateImprovementSuggestions } = await import('../analytics/improvementSuggestions');
          improvements = await generateImprovementSuggestions(queryObj, result, storage, language);
          moduleLog.info(`[NL Analytics API] Generated ${improvements.length} improvement suggestions`);
        } catch (error: any) {
          moduleLog.error({ err: error }, "[NL Analytics API] Error generating improvement suggestions:");
          // Don't fail the request if suggestions generation fails
          improvements = [];
        }
      }

      // Return complete response
      const response = {
        query: queryObj,
        result: {
          ...result,
          improvements: improvements.length > 0 ? improvements : undefined,
        },
        insights: insights,
        usage: { used: quota.used, limit: quota.limit },
      };

      moduleLog.info("[NL Analytics API] Request completed successfully");
      moduleLog.info(`[NL Analytics API] Response contains ${result.labels.length} data points, ${insights.length} insights, and ${improvements.length} improvement suggestions`);
      
      res.json(response);
    } catch (error: any) {
      moduleLog.error({ err: error }, "[NL Analytics API] Unexpected error:");
      res.status(500).json({ 
        error: "An unexpected error occurred while processing your request",
        code: "unexpected" satisfies NlQueryErrorCode,
        details: error.message 
      });
    }
  });

  // GET /api/analytics/suggested-questions - Pre-defined Example Questions
  // Returns a list of common analytics questions in German for user guidance
  app.get("/api/analytics/suggested-questions", requireAuth, requireViewNaturalLanguageAnalytics, async (req, res) => {
    try {
      moduleLog.info("[NL Analytics API] Fetching suggested questions");
      
      const suggestedQuestions = [
        "Zeig mir die Top 10 Produkte vom letzten Monat",
        "Welche Bestellungen haben Verzögerungen?",
        "Wie ist der Umsatz-Trend der letzten 90 Tage?",
        "Wer sind unsere besten Kunden nach Bestellwert?",
        "Welche Produkte verkaufen sich am schlechtesten?",
        "Zeige mir die Verteilung der Bestellstatus",
        "Wie viele offene Bestellungen haben wir?",
        "Welche Verkaufskanäle sind am profitabelsten?",
        "Prognostiziere den Umsatz für die nächsten 3 Monate",
        "Welche Produkte werden im Dezember 2025 stark nachgefragt sein?",
        "Wie wird sich unser Umsatz in Q1 2026 entwickeln?",
        "Erstelle eine saisonale Analyse für unsere Top-Kategorien",
      ];

      moduleLog.info(`[NL Analytics API] Returning ${suggestedQuestions.length} suggested questions`);
      
      res.json(suggestedQuestions);
    } catch (error: any) {
      moduleLog.error({ err: error }, "[NL Analytics API] Error fetching suggested questions:");
      res.status(500).json({ 
        error: "Failed to fetch suggested questions",
        details: error.message 
      });
    }
  });

  // Dashboard API Routes
  // GET /api/dashboard/my-tickets - Get tickets assigned to current user
  app.get("/api/dashboard/my-tickets", requireAuth, requireViewTickets, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      // Get all tickets and filter by assigned user, exclude closed tickets
      const allTickets = await storage.getAllTickets();
      
      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const filteredByChannel = await filterTicketsBySalesChannels(allTickets, allowedChannelIds, storage, userId);
      
      const myTickets = filteredByChannel
        .filter(ticket => 
          ticket.assignedToUserId === userId && 
          ticket.status !== 'closed' && 
          ticket.status !== 'completed' && 
          ticket.status !== 'cancelled'
        )
        .sort((a, b) => {
          // Sort by: high priority first, then by due date (soonest first), then by created date (newest first)
          if (a.priority === 'high' && b.priority !== 'high') return -1;
          if (a.priority !== 'high' && b.priority === 'high') return 1;
          
          if (a.dueDate && b.dueDate) {
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          }
          if (a.dueDate && !b.dueDate) return -1;
          if (!a.dueDate && b.dueDate) return 1;
          
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        })
        .slice(0, 10); // Limit to 10 most important tickets

      res.json(myTickets);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching my tickets:");
      res.status(500).json({ error: "Failed to fetch assigned tickets" });
    }
  });

  // GET /api/dashboard/my-ticket-comments - Get recent comments from tickets assigned to current user
  app.get("/api/dashboard/my-ticket-comments", requireAuth, requireViewTickets, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      // Get all tickets assigned to user (including closed ones for comment history)
      const allTickets = await storage.getAllTickets();
      
      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const filteredByChannel = await filterTicketsBySalesChannels(allTickets, allowedChannelIds, storage, userId);
      
      const myTickets = filteredByChannel.filter(ticket => ticket.assignedToUserId === userId);

      // Get all comments from these tickets
      const allComments: Array<any> = [];
      const users = await storage.getAllUsers();

      for (const ticket of myTickets) {
        const ticketComments = await storage.getTicketComments(ticket.id);
        
        // Enrich each comment with ticket info and username
        for (const comment of ticketComments) {
          const user = users.find(u => u.id === comment.userId);
          allComments.push({
            ...comment,
            username: user?.username || "Unknown",
            ticketId: ticket.id,
            ticketTitle: ticket.title,
            ticketStatus: ticket.status,
          });
        }
      }

      // Sort by creation date (newest first) and limit to 10
      const recentComments = allComments
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      res.json(recentComments);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching ticket comments:");
      res.status(500).json({ error: "Failed to fetch ticket comments" });
    }
  });

  // GET /api/dashboard/crm-interactions - Get recent CRM interactions
  app.get("/api/dashboard/crm-interactions", requireAuth, requireViewCrm, async (req: Request, res: Response) => {
    try {
      const interactions = await storage.getRecentCustomerInteractions(10);
      const users = await storage.getAllUsers();
      const customers = await storage.getAllCustomers();

      const userById = new Map(users.map((user) => [user.id, user.username]));
      const customerById = new Map(customers.map((customer) => [customer.id, customer]));

      const enriched = interactions.map((interaction) => {
        const customer = interaction.customerId ? customerById.get(interaction.customerId) : undefined;
        return {
          id: interaction.id,
          customerId: interaction.customerId,
          customerName: customer?.name || null,
          customerEmail: customer?.email || null,
          userName: interaction.userId ? userById.get(interaction.userId) || null : null,
          interactionType: interaction.interactionType,
          subject: interaction.subject || "",
          body: interaction.body || "",
          createdAt: interaction.createdAt,
        };
      });

      res.json(enriched);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching CRM interactions:");
      res.status(500).json({ error: "Failed to fetch CRM interactions" });
    }
  });

  // GET /api/dashboard/recent-orders - Get recent orders from Shopware
  app.get("/api/dashboard/recent-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const roleDetails = user?.roleDetails;

      // Check if user has viewOrders permission
      if (!roleDetails?.permissions?.viewOrders) {
        return res.status(403).json({ error: "Forbidden: viewOrders permission required" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      // Die 10 neuesten Bestellungen der eigenen Kanaele aus dem Bestell-Spiegel (frueher live -
      // eine leere Kanalliste filterte dort gar nicht)
      const orders = filterOrdersBySalesChannels(
        dashboardOrders(await getMirrorOrdersLikeLive(client, (req as any).tenantId ?? null), req),
        allowedChannelIds,
      ).slice(0, 10);

      res.json(orders);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching recent orders:");
      res.status(500).json({ error: "Failed to fetch recent orders" });
    }
  });

  // GET /api/dashboard/kpis - Get key performance indicators
  app.get("/api/dashboard/kpis", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const roleDetails = user?.roleDetails;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Fetch tickets and orders based on permissions
      const allTickets = roleDetails?.permissions?.viewTickets 
        ? await storage.getAllTickets() 
        : [];
      
      // alle Bestellungen aus dem Bestell-Spiegel (frueher nur die neuesten 500 live)
      const ordersResponse = roleDetails?.permissions?.viewOrders
        ? { orders: await getMirrorOrdersLikeLive(client, (req as any).tenantId ?? null) }
        : { orders: [] as Order[] };

      // Filter tickets assigned to current user
      const myTickets = (allTickets || []).filter(t => t.assignedToUserId === user.id);
      const openTickets = myTickets.filter(t => t.status === 'open' || t.status === 'in_progress');
      const highPriorityTickets = myTickets.filter(t => t.priority === 'high' && (t.status === 'open' || t.status === 'in_progress'));

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // SECURITY: Filter orders by user's assigned sales channels (server-enforced)
      const orderItems = ordersResponse?.orders || [];
      const accessibleOrders = filterOrdersBySalesChannels(dashboardOrders(orderItems, req), allowedChannelIds);

      // Calculate order statistics
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const ordersToday = accessibleOrders.filter((order: Order) => {
        const orderDate = new Date(order.orderDate);
        orderDate.setHours(0, 0, 0, 0);
        return orderDate.getTime() === today.getTime();
      });

      const openOrders = accessibleOrders.filter((order: Order) => order.status === 'open' || order.status === 'in_progress');

      // Verspaetete Bestellungen nach derselben Regel wie die Seite "Verspaetete Bestellungen"
      const delayedOrders = roleDetails?.permissions?.viewDelayedOrders
        ? selectDelayedOrders(accessibleOrders)
        : [];

      const kpis = {
        tickets: {
          total: myTickets.length,
          open: openTickets.length,
          highPriority: highPriorityTickets.length,
        },
        orders: roleDetails?.permissions?.viewOrders ? {
          today: ordersToday.length,
          open: openOrders.length,
          delayed: delayedOrders.length,
        } : null,
      };

      res.json(kpis);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching KPIs:");
      res.status(500).json({ error: "Failed to fetch KPIs" });
    }
  });

  // GET /api/dashboard/delayed-orders-summary - Get summary of delayed orders
  app.get("/api/dashboard/delayed-orders-summary", requireAuth, requireViewDelayedOrders, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      // Alle Bestellungen der eigenen Kanaele aus dem Bestell-Spiegel (frueher nur die neuesten 500
      // live), verspaetet nach derselben Regel wie die Seite; kritisch = Lieferdatum (sonst
      // Bestelldatum) mehr als 14 Tage vorbei
      const accessibleOrders = filterOrdersBySalesChannels(
        dashboardOrders(await getMirrorOrdersLikeLive(client, (req as any).tenantId ?? null), req),
        allowedChannelIds,
      );
      const delayedOrders = selectDelayedOrders(accessibleOrders);
      const criticallyDelayed = delayedOrders.filter((order) => order.daysSinceOrder >= 14);
      // wie bisher die neuesten fuenf (nach Bestelldatum)
      const newestDelayed = [...delayedOrders].sort((a, b) => (a.orderDate < b.orderDate ? 1 : a.orderDate > b.orderDate ? -1 : 0));

      const summary = {
        total: delayedOrders.length,
        critical: criticallyDelayed.length,
        recentOrders: newestDelayed.slice(0, 5).map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          orderDate: order.orderDate,
          totalAmount: order.totalAmount,
          status: order.status,
          daysDelayed: order.daysSinceOrder,
        })),
      };

      res.json(summary);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching delayed orders summary:");
      res.status(500).json({ error: "Failed to fetch delayed orders summary" });
    }
  });

  // GET /api/dashboard/shipping-ready - Get orders ready for shipping
  app.get("/api/dashboard/shipping-ready", requireAuth, requireViewShipping, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      // Alle Bestellungen der eigenen Kanaele aus dem Bestell-Spiegel (frueher nur die neuesten 500 live)
      const accessibleOrders = filterOrdersBySalesChannels(
        dashboardOrders(await getMirrorOrdersLikeLive(client, (req as any).tenantId ?? null), req),
        allowedChannelIds,
      );

      // Filter orders ready for shipping:
      // - Status open oder in_progress (nicht completed/cancelled)
      // - Payment paid oder authorized
      // - No tracking number yet (not yet shipped)
      const shippingReadyOrders = accessibleOrders.filter((order: Order) => {
        const notShippedYet = !order.shippingInfo?.trackingNumber;
        return isOrderEligibleForShippingPick(order) && notShippedYet;
      });

      // Limit to 10 orders
      const limitedOrders = shippingReadyOrders.slice(0, 10).map((order: Order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        orderDate: order.orderDate,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        shippingMethod: order.shippingMethod,
      }));

      res.json({
        total: shippingReadyOrders.length,
        orders: limitedOrders,
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching shipping ready orders:");
      res.status(500).json({ error: "Failed to fetch shipping ready orders" });
    }
  });

  // GET /api/dashboard/imported-inquiries — Angebots-/Bestellentwürfe aus Commercial-Import
  app.get("/api/dashboard/imported-inquiries", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const permissions = user?.roleDetails?.permissions;
      const canOrders = Boolean(permissions?.manageOrderDrafts);
      const canOffers = Boolean(permissions?.viewOffers || permissions?.manageOffers);

      if (!canOrders && !canOffers) {
        return res.status(403).json({ error: "Forbidden: commercial draft permissions required" });
      }

      const limitRaw = parseInt(String(req.query.limit ?? "8"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, limitRaw)) : 8;
      const tenantId = req.tenantId ?? null;

      const [orders, offers] = await Promise.all([
        canOrders ? storage.getAllOrderDrafts(tenantId) : Promise.resolve([]),
        canOffers ? storage.getAllOfferDrafts(tenantId) : Promise.resolve([]),
      ]);

      const allSummaries = [
        ...orders.map((d) => toImportedInquirySummary(d, "order")),
        ...offers.map((d) => toImportedInquirySummary(d, "offer")),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const stats = {
        total: allSummaries.length,
        reviewRequired: allSummaries.filter((i) => i.status === "review_required").length,
        pending: allSummaries.filter((i) => i.status === "pending").length,
        created: allSummaries.filter((i) => i.status === "created").length,
      };

      res.json({
        items: allSummaries.slice(0, limit),
        stats,
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching imported inquiries:");
      res.status(500).json({ error: "Failed to fetch imported inquiries" });
    }
  });
}
