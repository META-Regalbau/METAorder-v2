import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ShopwareClient } from "./shopware";
import { shopwareSettingsSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Shopware settings routes
  app.get("/api/settings/shopware", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(404).json({ error: "No Shopware settings found" });
      }
      // Don't send the secret back to the frontend
      res.json({
        shopwareUrl: settings.shopwareUrl,
        apiKey: settings.apiKey,
        hasSecret: !!settings.apiSecret,
      });
    } catch (error) {
      console.error("Error fetching Shopware settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings/shopware", async (req, res) => {
    try {
      const validated = shopwareSettingsSchema.parse(req.body);
      const settings = await storage.saveShopwareSettings(validated);
      
      res.json({
        message: "Settings saved successfully",
        shopwareUrl: settings.shopwareUrl,
      });
    } catch (error: any) {
      console.error("Error saving Shopware settings:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid settings data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/settings/shopware/test", async (req, res) => {
    try {
      const validated = shopwareSettingsSchema.parse(req.body);
      const client = new ShopwareClient(validated);
      const isConnected = await client.testConnection();
      
      if (isConnected) {
        res.json({ success: true, message: "Connection successful" });
      } else {
        res.status(400).json({ success: false, error: "Failed to connect to Shopware" });
      }
    } catch (error: any) {
      console.error("Error testing Shopware connection:", error);
      res.status(500).json({ success: false, error: error.message || "Connection test failed" });
    }
  });

  // Sales channels routes
  app.get("/api/sales-channels", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const salesChannels = await client.fetchSalesChannels();
      
      res.json(salesChannels);
    } catch (error: any) {
      console.error("Error fetching sales channels:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales channels" });
    }
  });

  // Orders routes
  app.get("/api/orders", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrders();
      
      // Filter by sales channel if provided in query params
      const salesChannelIds = req.query.salesChannelIds as string | undefined;
      let filteredOrders = orders;
      
      if (salesChannelIds) {
        const channelIdsArray = salesChannelIds.split(',');
        filteredOrders = orders.filter(order => 
          channelIdsArray.includes(order.salesChannelId)
        );
      }
      
      res.json(filteredOrders);
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:orderId/documents", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const documents = await client.fetchOrderDocuments(req.params.orderId);
      
      res.json(documents);
    } catch (error: any) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: error.message || "Failed to fetch documents" });
    }
  });

  app.get("/api/orders/:orderId/document/:documentId/:deepLinkCode", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { documentId, deepLinkCode } = req.params;
      const client = new ShopwareClient(settings);
      
      const pdfBlob = await client.downloadDocumentPdf(documentId, deepLinkCode);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="document-${documentId}.pdf"`);
      res.send(Buffer.from(await pdfBlob.arrayBuffer()));
    } catch (error: any) {
      console.error("Error downloading document:", error);
      res.status(500).json({ error: error.message || "Failed to download document" });
    }
  });

  app.get("/api/orders/:orderId/invoice", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const pdfBlob = await client.downloadInvoicePdf(req.params.orderId);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.orderId}.pdf"`);
      res.send(Buffer.from(await pdfBlob.arrayBuffer()));
    } catch (error: any) {
      console.error("Error downloading invoice:", error);
      res.status(500).json({ error: error.message || "Failed to download invoice" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
