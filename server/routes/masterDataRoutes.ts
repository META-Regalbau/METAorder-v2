// Stammdaten und Nachschlagen: Verkaufskanaele, Kategorien, globale Suche, B2B-Status/-Entitaeten.
import { requireAuth, requireViewOffers, requireManageOffers, requireManageSettings } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { getSalesChannelFilter, getOrdersWithCache, filterOrdersBySalesChannels, filterTicketsBySalesChannels } from "./routeHelpers";
import { B2BSellersClient, type OfferStatusMapping, getOfferStatusMapping } from "../b2b/b2bSellersClient";
import type { Request, Response, Express } from "express";


/** Kurzer In-Memory-Cache für selten änderende Shopware-Stammdaten (Verkaufskanäle,
 *  Kategorien), die sonst bei jedem Seitenaufruf live von Shopware geholt werden
 *  (~0,7–1s pro Request). Key enthält den Tenant; 10 Min. TTL ist für diese Daten
 *  unkritisch (Anlage neuer Kanäle/Kategorien ist ein seltener Admin-Vorgang). */
const SHOPWARE_MASTERDATA_TTL_MS = 10 * 60 * 1000;

const shopwareMasterdataCache = new Map<string, { expiresAt: number; value: unknown }>();


async function cachedShopwareMasterdata<T>(cacheKey: string, load: () => Promise<T>): Promise<T> {
  const cached = shopwareMasterdataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const value = await load();
  shopwareMasterdataCache.set(cacheKey, { value, expiresAt: Date.now() + SHOPWARE_MASTERDATA_TTL_MS });
  return value;
}

export function registerMasterDataRoutes(app: Express): void {
  // Sales channels routes
  app.get("/api/sales-channels", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const salesChannels = await cachedShopwareMasterdata(
        `salesChannels::${(req as any).tenantId ?? "__global__"}`,
        () => client.fetchSalesChannels(),
      );

      res.json(salesChannels);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch sales channels";
      console.error("[api/sales-channels] Error:", msg, error?.stack);
      res.status(500).json({ error: msg });
    }
  });

  // Global search (header)
  app.get("/api/search/global", requireAuth, async (req, res) => {
    try {
      const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 5, 1), 20);
      const user = req.user as any;
      const permissions = user?.roleDetails?.permissions || {};

      if (!rawQuery) {
        return res.json({ query: "", orders: [], tickets: [], offers: [], products: [] });
      }

      const searchLower = rawQuery.toLowerCase();
      const matches = (value?: string | null) =>
        value ? value.toLowerCase().includes(searchLower) : false;

      const allowedChannelIds = await getSalesChannelFilter(req);
      const results: {
        query: string;
        orders: Array<{
          id: string;
          orderNumber: string;
          customerName: string;
          customerEmail: string;
          invoiceNumber?: string | null;
          erpNumber?: string | null;
        }>;
        tickets: Array<{
          id: string;
          ticketNumber: string;
          title: string;
          status: string;
        }>;
        offers: Array<{
          id: string;
          offerNumber: string;
          customerName?: string | null;
          customerEmail?: string | null;
          status?: string | null;
        }>;
        products: Array<{
          id: string;
          name: string;
          productNumber: string;
        }>;
      } = { query: rawQuery, orders: [], tickets: [], offers: [], products: [] };

      if (permissions.viewOrders) {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const { orders } = await getOrdersWithCache(client, (req as any).tenantId ?? null);
          const filtered = filterOrdersBySalesChannels(orders, allowedChannelIds)
            .filter((order) =>
              matches(order.orderNumber) ||
              matches(order.customerName) ||
              matches(order.customerEmail) ||
              matches(order.invoiceNumber) ||
              matches(order.erpNumber)
            )
            .slice(0, limit)
            .map((order) => ({
              id: order.id,
              orderNumber: order.orderNumber,
              customerName: order.customerName,
              customerEmail: order.customerEmail,
              invoiceNumber: order.invoiceNumber || null,
              erpNumber: order.erpNumber || null,
            }));
          results.orders = filtered;
        }
      }

      if (permissions.viewTickets) {
        const tickets = await storage.getAllTickets();
        const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, user?.id);
        results.tickets = filteredTickets
          .filter((ticket) =>
            matches(ticket.ticketNumber) ||
            matches(ticket.title) ||
            matches(ticket.description)
          )
          .slice(0, limit)
          .map((ticket) => ({
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            title: ticket.title,
            status: ticket.status,
          }));
      }

      if (permissions.viewOffers) {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
          const client = new B2BSellersClient(settings, { statusMapping });
          const { offers } = await client.fetchOffers({
            search: rawQuery,
            page: 1,
            limit,
            salesChannelIds: allowedChannelIds === null ? undefined : allowedChannelIds,
          });
          results.offers = offers.map((offer) => ({
            id: offer.id,
            offerNumber: offer.offerNumber,
            customerName: offer.customerName || null,
            customerEmail: offer.customerEmail || null,
            status: offer.status || null,
          }));
        }
      }

      if (allowedChannelIds !== undefined) {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          if (allowedChannelIds === null || allowedChannelIds.length > 0) {
            const client = new ShopwareClient(settings);
            const productsResult = await client.fetchProducts(
              limit,
              1,
              rawQuery,
              undefined,
              false,
              undefined,
              undefined,
              undefined,
              false,
              allowedChannelIds === null ? undefined : allowedChannelIds
            );
            results.products = (productsResult.products || []).map((product) => ({
              id: product.id,
              name: product.name,
              productNumber: product.productNumber,
            }));
          }
        }
      }

      res.json(results);
    } catch (error: any) {
      console.error("Error executing global search:", error);
      res.status(500).json({ error: error.message || "Failed to execute global search" });
    }
  });

  // Categories route
  app.get("/api/categories", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const categories = await cachedShopwareMasterdata(
        `categories::${(req as any).tenantId ?? "__global__"}`,
        () => client.fetchCategories(),
      );
      res.json(categories);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch categories";
      console.error("[api/categories] Error:", msg, error?.stack);
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/b2b/offer-status-mapping - Return status label/id mapping
  app.get("/api/b2b/offer-status-mapping", requireAuth, requireViewOffers, async (_req: Request, res: Response) => {
    try {
      const stored = (await storage.getSetting("b2b.offerStatusMapping")) as OfferStatusMapping | undefined;
      res.json(getOfferStatusMapping(stored));
    } catch (error) {
      console.error("Error fetching B2B offer status mapping:", error);
      res.status(500).json({ error: "Failed to fetch offer status mapping" });
    }
  });

  // GET /api/b2b/entities - List available entities from Shopware schema (debug)
  app.get("/api/b2b/entities", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const prefixQuery = req.query.prefix as string | undefined;
      const entityQuery = req.query.entity as string | undefined;
      const prefix = prefixQuery === "all" ? "" : (prefixQuery || "b2bsellers");
      const client = new ShopwareClient(settings);
      const { source, schema } = await client.fetchEntitySchema();

      const toApiEntityName = (name: string) => name.replace(/_/g, "-");

      let entities: string[] = [];

      if (schema?.entities && typeof schema.entities === "object") {
        entities = Object.keys(schema.entities);
      } else if (schema?.definitions && typeof schema.definitions === "object") {
        entities = Object.keys(schema.definitions);
      } else if (schema?.components?.schemas && typeof schema.components.schemas === "object") {
        entities = Object.keys(schema.components.schemas);
      } else if (schema?.paths && typeof schema.paths === "object") {
        const paths = Object.keys(schema.paths);
        const fromSearchPrefix = paths
          .filter((path: string) => path.startsWith("/api/search/"))
          .map((path: string) => path.replace("/api/search/", "").split("/")[0]);
        const fromSearchSuffix = paths
          .filter((path: string) => path.startsWith("/api/") && path.endsWith("/search"))
          .map((path: string) => path.replace("/api/", "").replace("/search", "").split("/")[0]);
        entities = [...fromSearchPrefix, ...fromSearchSuffix];
      } else if (schema && typeof schema === "object") {
        entities = Object.keys(schema).filter((key) => /^[a-z][a-z0-9_]*$/i.test(key) && key.includes("_"));
      }

      const unique = Array.from(new Set(entities.filter(Boolean).map(toApiEntityName)));
      const normalizedPrefix = prefix.replace(/_/g, "-").toLowerCase();
      const filtered = normalizedPrefix
        ? unique.filter((name) => name.toLowerCase().includes(normalizedPrefix))
        : unique;
      const schemaKeys = schema && typeof schema === "object" ? Object.keys(schema) : [];
      const pathKeys = schema?.paths && typeof schema.paths === "object" ? Object.keys(schema.paths) : [];

      res.json({
        source,
        prefix: prefixQuery === "all" ? null : (prefix || null),
        total: filtered.length,
        entities: filtered,
        schemaKeys,
        pathsCount: pathKeys.length,
        examplePaths: pathKeys.slice(0, 50),
        entitySchema: entityQuery && schema ? (schema as any)[entityQuery] : undefined,
      });
    } catch (error: any) {
      console.error("Error fetching Shopware entity schema:", error);
      res.status(500).json({ error: error.message || "Failed to fetch entity schema" });
    }
  });

  // GET /api/b2b/offer-statuses - List B2B offer status records (debug)
  app.get("/api/b2b/offer-statuses", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const data = await client.searchEntity("b2bsellers-offer-status", {
        limit: 200,
        sort: [{ field: "createdAt", order: "ASC" }],
      });
      const rawStatuses = data?.data || [];
      const statuses = rawStatuses.map((status: any) => ({
        id: status.id,
        label: status?.attributes?.label || status?.label || null,
        draft: status?.attributes?.draft ?? status?.draft ?? null,
        open: status?.attributes?.open ?? status?.open ?? null,
        confirmed: status?.attributes?.confirmed ?? status?.confirmed ?? null,
        declined: status?.attributes?.declined ?? status?.declined ?? null,
      }));

      res.json({ total: data?.total ?? rawStatuses.length, statuses });
    } catch (error: any) {
      console.error("Error fetching offer statuses:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer statuses" });
    }
  });
}
