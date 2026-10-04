// Betrieb: Versandliste, Versanddienstleister, Prozess-Updates, ERP-Automatisierung und Produkt-Debug.
import { requireAuth, requireViewShipping, requireManageSettings, requireCsrf } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { type Order, insertProcessUpdateSchema, insertShippingCarrierSchema } from "@shared/schema";
import { isOrderEligibleForShippingPick } from "@shared/orderShippingEligibility";
import { enrichOrdersWithStockAvailability } from "../erp/orderStockEnrichment";
import { dedupeOrdersByNumber, getOrdersWithCache } from "./routeHelpers";
import type { Express } from "express";

export function registerOperationsRoutes(app: Express): void {
  // Shipping Dashboard - Get orders ready for shipping with equipment flags
  app.get("/api/shipping", requireAuth, requireViewShipping, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const tenantId = (req as any).tenantId ?? null;
      // Aus dem Bestell-Spiegel statt alle Bestellungen live (Testing ~19 s); eine Bestellung je
      // Bestellnummer wie zuvor bei fetchOrders. refresh=1 stoesst vorher einen Delta-Abgleich an.
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";
      const { orders: mirrorOrders } = await getOrdersWithCache(client, tenantId, { forceRefresh });
      const allOrders = dedupeOrdersByNumber(mirrorOrders);

      // Filter: paid/authorized und noch offen (open oder in_progress).
      // open inkl. — Shopware belässt bezahlte Aufträge oft auf open bis „In Bearbeitung“.
      const shippingOrders = allOrders.filter((order: Order) =>
        isOrderEligibleForShippingPick(order),
      );

      const shippingWithStock = await enrichOrdersWithStockAvailability(
        shippingOrders,
        tenantId,
      );

      // Detect special equipment from order items or customFields
      const ordersWithFlags = shippingWithStock.map((order: Order) => {
        let requiresMitnahmestapler = false;
        let requiresHebebuehne = false;

        // Check items for equipment keywords
        order.items.forEach(item => {
          const itemName = item.name.toLowerCase();
          if (itemName.includes("mitnahmestapler")) {
            requiresMitnahmestapler = true;
          }
          if (itemName.includes("hebebühne") || itemName.includes("hebebuehne")) {
            requiresHebebuehne = true;
          }
        });

        // Check customFields for equipment flags
        if (order.customFields) {
          const customFieldsStr = JSON.stringify(order.customFields).toLowerCase();
          if (customFieldsStr.includes("mitnahmestapler")) {
            requiresMitnahmestapler = true;
          }
          if (customFieldsStr.includes("hebebühne") || customFieldsStr.includes("hebebuehne")) {
            requiresHebebuehne = true;
          }
        }

        return {
          ...order,
          requiresMitnahmestapler,
          requiresHebebuehne,
        };
      });

      res.json(ordersWithFlags);
    } catch (error: any) {
      console.error("Error fetching shipping orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch shipping orders" });
    }
  });

  // Process Updates - Get all updates
  app.get("/api/process-updates", requireAuth, async (req, res) => {
    try {
      const updates = await storage.getProcessUpdates();
      res.json(updates);
    } catch (error: any) {
      console.error("Error fetching process updates:", error);
      res.status(500).json({ error: "Failed to fetch process updates" });
    }
  });

  // Process Updates - Create new update
  app.post("/api/process-updates", requireAuth, requireManageSettings, requireCsrf, async (req, res) => {
    try {
      const validatedData = insertProcessUpdateSchema.parse(req.body);
      const userId = (req.user as any).id;
      const tags = validatedData.tags?.map((tag) => tag.trim()).filter(Boolean);

      const newUpdate = await storage.createProcessUpdate({
        ...validatedData,
        tags: tags && tags.length > 0 ? tags : undefined,
        createdByUserId: userId,
      });

      res.status(201).json(newUpdate);
    } catch (error: any) {
      console.error("Error creating process update:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create process update" });
    }
  });

  // Process Updates - Update existing update
  app.put("/api/process-updates/:id", requireAuth, requireManageSettings, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const updateSchema = insertProcessUpdateSchema.partial();
      const validatedData = updateSchema.parse(req.body);
      const tags = validatedData.tags?.map((tag) => tag.trim()).filter(Boolean);

      const updated = await storage.updateProcessUpdate(id, {
        ...validatedData,
        tags: tags && tags.length > 0 ? tags : validatedData.tags,
      });

      if (!updated) {
        return res.status(404).json({ error: "Process update not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating process update:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update process update" });
    }
  });

  // Process Updates - Delete update
  app.delete("/api/process-updates/:id", requireAuth, requireManageSettings, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteProcessUpdate(id);

      if (!deleted) {
        return res.status(404).json({ error: "Process update not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting process update:", error);
      res.status(500).json({ error: "Failed to delete process update" });
    }
  });

  // DEBUG: Test endpoint to fetch a specific product by product number
  app.get("/api/debug/product/:productNumber", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productNumber } = req.params;
      
      console.log(`[DEBUG] Fetching product with productNumber: ${productNumber}`);
      
      // Search for the specific product - include inactive for debugging
      const result = await client.fetchProducts(10, 1, productNumber, undefined, false, undefined, undefined, undefined, true);
      
      console.log(`[DEBUG] Found ${result.products.length} products, total: ${result.total}`);
      if (result.products.length > 0) {
        console.log(`[DEBUG] Product:`, JSON.stringify(result.products[0], null, 2));
      }
      
      res.json({
        found: result.products.length > 0,
        total: result.total,
        product: result.products[0] || null,
      });
    } catch (error: any) {
      console.error("[DEBUG] Error fetching product:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // ERP Automation Routes
  // ============================================

  // GET /api/erp-automation/history - Get all automation runs (Admin only)
  app.get("/api/erp-automation/history", requireAuth, requireManageSettings, async (req, res) => {
    try {
      // Validate and sanitize query parameters
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 1000)); // Cap at 1000
      const offset = Math.max(0, Number(req.query.offset) || 0);

      if (isNaN(limit) || isNaN(offset)) {
        return res.status(400).json({ error: "Invalid pagination parameters" });
      }

      const runs = await storage.getAllErpAutomationRuns(limit, offset);
      
      res.json(runs);
    } catch (error) {
      console.error("[ERP Automation] Error fetching automation history:", error);
      res.status(500).json({ error: "Failed to fetch automation history" });
    }
  });

  // GET /api/erp-automation/history/:orderId - Get automation runs for specific order
  app.get("/api/erp-automation/history/:orderId", requireAuth, async (req, res) => {
    try {
      const { orderId } = req.params;
      const user = req.user as any;
      
      // Check if user has permission to view orders
      const hasPermission = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin' ||
        user?.roleDetails?.permissions?.viewOrders === true;

      if (!hasPermission) {
        return res.status(403).json({ error: "Insufficient permissions to view order automation history" });
      }
      
      // For non-admin users, enforce sales channel access
      const isAdmin = user?.roleDetails?.name === 'Administrator' || user?.role === 'admin';
      
      if (!isAdmin) {
        const userChannels = user?.salesChannelIds || [];
        
        // Non-admin users MUST have assigned sales channels
        if (userChannels.length === 0) {
          return res.status(403).json({ 
            error: "No sales channels assigned. Contact administrator for access." 
          });
        }

        // Fetch order to verify sales channel ownership
          const settings = await storage.getShopwareSettings();
        if (!settings) {
          return res.status(503).json({ 
            error: "Shopware settings not configured" 
          });
        }

        const shopwareClient = new ShopwareClient(settings);
        
        // Fetch single order by ID (more efficient than fetching all orders)
        const orders = await shopwareClient.fetchOrders();
        const order = orders.find(o => o.id === orderId);
        
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        // Verify user has access to this order's sales channel
        if (!userChannels.includes(order.salesChannelId)) {
          return res.status(403).json({ 
            error: "You don't have access to this order's sales channel" 
          });
        }
      }

      const runs = await storage.getErpAutomationRunsByOrderId(orderId);
      res.json(runs);
            } catch (error) {
      console.error("[ERP Automation] Error fetching order automation history:", error);
      res.status(500).json({ error: "Failed to fetch order automation history" });
    }
  });

  // POST /api/erp-automation/trigger - Bestell-Spiegel sofort synchronisieren (Admin only).
  // Damit greift der Rechnungsnummer-Watcher (server/invoicing/invoiceNumberWatcher.ts) ohne auf
  // den naechsten 3-Minuten-Lauf zu warten.
  app.post("/api/erp-automation/trigger", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(503).json({
          error: "ERP Automation service not available. Please check Shopware settings."
        });
      }

      const { syncShopwareMirrorForTenant } = await import("../shopware/shopwareMirror");
      await syncShopwareMirrorForTenant(storage, new ShopwareClient(settings), tenantId, {
        entities: ["orders"],
        settings,
      });

      res.json({
        message: "ERP automation polling triggered successfully",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("[ERP Automation] Error triggering manual automation:", error);
      res.status(500).json({ error: "Failed to trigger automation" });
    }
  });

  // Shipping Carriers API Routes
  app.get("/api/carriers", requireAuth, async (req, res) => {
    try {
      const carriers = await storage.getAllShippingCarriers();
      res.json(carriers);
    } catch (error) {
      console.error("Error fetching carriers:", error);
      res.status(500).json({ error: "Failed to fetch carriers" });
    }
  });

  app.post("/api/carriers", requireAuth, async (req, res) => {
    try {
      // Validate request body using Zod schema
      const validatedData = insertShippingCarrierSchema.parse(req.body);

      const carrier = await storage.createShippingCarrier(validatedData);
      res.status(201).json(carrier);
    } catch (error: any) {
      console.error("Error creating carrier:", error);
      
      // Handle validation errors
      if (error?.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid carrier data", details: error.errors });
      }
      
      // Handle unique constraint violation
      if (error?.code === '23505' || error?.message?.includes('unique')) {
        return res.status(409).json({ error: "Carrier name already exists" });
      }
      
      res.status(500).json({ error: "Failed to create carrier" });
    }
  });

  app.delete("/api/carriers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid carrier ID" });
      }

      const deleted = await storage.deleteShippingCarrier(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Carrier not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting carrier:", error);
      res.status(500).json({ error: "Failed to delete carrier" });
    }
  });
}
