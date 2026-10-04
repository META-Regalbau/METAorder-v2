// Mahnwesen und Buchhaltung: Mahnungen (Vorschau/Versand/PDF), Buchhaltungs-Abgleich und Shop-Fakturen-Import.
import { requireAuth, requireViewDocuments, requireManageDocuments, requireViewAccounting, requireCsrf } from "../auth/auth";
import { storage } from "../storage";
import { defaultDunningSettings, getMirrorOrdersLikeLive, getSalesChannelFilter, uploadRateLimiter } from "./routeHelpers";
import { ShopwareClient } from "../shopware/shopware";
import { getDunningCandidates, enrichOrderDueDate, getDunningCandidateForOrder, sendDunningForOrderInternal, sendDunningForOrder, saveDunningPdfToSystem } from "../invoicing/dunningJob";
import { z } from "zod";
import type { Request, Response, Express } from "express";
import path from "path";
import { getUploadsRoot } from "../uploadsRoot";
import fs from "fs/promises";
import fsSync from "fs";
import { generateDunningPdf } from "../invoicing/dunningPdf";
import multer from "multer";
import { restoreTenantContext } from "../lib/tenantContext";
import { parseCsv, parsePdf, enrichEntriesWithAI, matchEntries } from "../invoicing/accounting";
import { getAISettings } from "../ai/aiConfig";
import { getInvoiceAutomationSettings } from "../invoicing/invoiceSending";
import { parseFakturaRowsFromBuffer, runFakturaImport } from "../invoicing/shopFakturenImport";

export function registerInvoicingRoutes(app: Express): void {
  // Dunning preview (no sending)
  app.get("/api/dunning/preview", requireAuth, requireViewDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const dunningSettings = { ...defaultDunningSettings, ...(await storage.getDunningSettings(tenantId)) };
      if (!dunningSettings.enabled) {
        return res.json({ enabled: false, items: [] });
      }

      const allowedChannelIds = await getSalesChannelFilter(req);
      const client = new ShopwareClient(settings);
      const candidates = await getDunningCandidates(storage, client, dunningSettings, allowedChannelIds, tenantId);

      const items = candidates.map((candidate) => ({
        order: candidate.order,
        dueDate: candidate.dueDate.toISOString(),
        daysOverdue: candidate.daysOverdue,
        lastStage: candidate.lastStage,
        nextStage: candidate.nextStage,
      }));

      res.json({ enabled: true, items });
    } catch (error: any) {
      console.error("Error fetching dunning preview:", error);
      res.status(500).json({ error: error.message || "Failed to fetch dunning preview" });
    }
  });

  app.post("/api/dunning/send", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const schema = z.object({
        orderId: z.string().min(1),
      });
      const validated = schema.parse(req.body);

      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const dunningSettings = { ...defaultDunningSettings, ...(await storage.getDunningSettings(tenantId)) };
      if (!dunningSettings.enabled) {
        return res.status(400).json({ error: "Dunning is disabled" });
      }

      const allowedChannelIds = await getSalesChannelFilter(req);
      const client = new ShopwareClient(settings);
      const order = await client.fetchOrderById(validated.orderId, allowedChannelIds);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Enrich due date from order documents when missing (same as dunning preview)
      await enrichOrderDueDate(client, order, dunningSettings.dueDateFieldKey);

      const status = await storage.getOrderDunningStatus(order.id, tenantId);
      const { candidate, ineligibleReason } = getDunningCandidateForOrder(order, dunningSettings, status?.stage ?? 0);
      if (!candidate) {
        return res.status(400).json({
          error: ineligibleReason ?? "Order is not eligible for dunning",
        });
      }

      const generateInApp = dunningSettings.generatePdfInApp !== false;
      if (generateInApp) {
        await sendDunningForOrderInternal(
          storage,
          dunningSettings,
          order,
          candidate.dueDate,
          candidate.nextStage,
          tenantId,
          { client }
        );
      } else {
        await sendDunningForOrder(
          storage,
          client,
          dunningSettings,
          order,
          candidate.dueDate,
          candidate.nextStage,
          settings.shopwareUrl,
          tenantId
        );
      }

      const stage = candidate.nextStage;
      res.json({
        success: true,
        orderId: order.id,
        stage,
        downloadUrl: `/api/dunning/order/${order.id}/pdf?stage=${stage}&orderNumber=${encodeURIComponent(order.orderNumber || "")}`,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error sending dunning:", error);
      res.status(500).json({ error: error.message || "Failed to send dunning" });
    }
  });

  app.get("/api/dunning/order/:orderId/pdf", requireAuth, requireViewDocuments, async (req: Request, res: Response) => {
    try {
      const orderId = req.params.orderId;
      const stage = Math.min(3, Math.max(1, Number(req.query.stage) || 1));
      const orderNumber = typeof req.query.orderNumber === "string" ? req.query.orderNumber : undefined;

      const dir = path.join(getUploadsRoot(), "dunning", orderId);
      let filePath: string | null = null;
      try {
        const files = await fs.readdir(dir);
        const suffix = `Stufe-${stage}-`;
        const match = files.find((f) => f.startsWith("Mahnung-") && f.includes(suffix) && f.endsWith(".pdf"));
        if (match) filePath = path.join(dir, match);
      } catch {
        // Verzeichnis existiert nicht
      }

      if (!filePath || !fsSync.existsSync(filePath)) {
        const settings = await storage.getShopwareSettings((req as any).tenantId ?? null);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        const allowedChannelIds = await getSalesChannelFilter(req);
        const client = new ShopwareClient(settings);
        const order = await client.fetchOrderById(orderId, allowedChannelIds);
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }
        const dunningSettings = { ...defaultDunningSettings, ...(await storage.getDunningSettings((req as any).tenantId ?? null)) };
        await enrichOrderDueDate(client, order, dunningSettings.dueDateFieldKey);
        const dueDateValue = order.invoiceDate || order.orderDate;
        const dueDate = dueDateValue ? new Date(dueDateValue) : new Date();
        const pdfBuffer = await generateDunningPdf(order, stage, dueDate);
        filePath = await saveDunningPdfToSystem(order.id, stage, order.orderNumber || order.id, pdfBuffer);
      }

      const fileName = path.basename(filePath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      const buf = await fs.readFile(filePath);
      res.send(buf);
    } catch (error: any) {
      console.error("Error serving dunning PDF:", error);
      res.status(500).json({ error: error.message || "Failed to get PDF" });
    }
  });

  const accountingUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  app.post("/api/accounting/upload", requireAuth, requireViewAccounting, accountingUpload.single("file"), restoreTenantContext, async (req, res) => {
    try {
      const file = (req as any).file;
      if (!file?.buffer) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const mimeType = file.mimetype || "";
      const buffer = file.buffer as Buffer;
      const isCsv = mimeType.includes("csv") || file.originalname?.toLowerCase().endsWith(".csv");
      const isPdf = mimeType.includes("pdf") || file.originalname?.toLowerCase().endsWith(".pdf");

      if (!isCsv && !isPdf) {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      const entries = isCsv ? parseCsv(buffer) : await parsePdf(buffer);
      const aiSettings = await getAISettings(storage);
      let openaiClient = null;
      if (aiSettings.mode !== "local_only") {
        try {
          const openaiSettings = await storage.getSetting('openai_settings');
          const { getOpenAIClient } = await import('../ai/openaiClient');
          const openaiConfig = getOpenAIClient(openaiSettings?.apiKey);
          openaiClient = openaiConfig.client;
        } catch (error: any) {
          if (aiSettings.mode === "openai_only") {
            return res.status(400).json({
              error: "OpenAI integration not available. Please configure OpenAI API key in settings."
            });
          }
        }
      }

      const aiResult = await enrichEntriesWithAI(entries, {
        mode: aiSettings.mode,
        openaiClient,
        maxInputChars: aiSettings.maxInputChars,
      });
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      // Bestellungen aus dem Bestell-Spiegel statt alle live aus Shopware
      const orders = await getMirrorOrdersLikeLive(client, (req as any).tenantId ?? null);
      const debugEnabled = String((req.query?.debug as string) || req.body?.debug || "").toLowerCase() === "true";
      const results = matchEntries(aiResult.entries, orders, {
        debug: debugEnabled,
        aiHintsById: aiResult.aiHintsById,
      });
      res.json({ results });
    } catch (error: any) {
      console.error("Accounting upload failed:", error);
      res.status(500).json({ error: error.message || "Failed to process accounting file" });
    }
  });

  app.post("/api/accounting/confirm", requireAuth, requireViewAccounting, async (req, res) => {
    const schema = z.object({
      orderId: z.string().min(1),
    });

    try {
      const { orderId } = schema.parse(req.body);
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      await client.markOrderPaid(orderId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Accounting confirm failed:", error);
      res.status(500).json({ error: error.message || "Failed to confirm payment" });
    }
  });

  // ============================================
  // SAP-Rechnungsimport (Shop_Fakturen.xlsx)
  // ============================================
  const shopFakturenUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  // Import von SAP-Rechnungsnummern aus Excel: Rechnungen in Shopware anlegen +
  // Custom Field setzen + Nachlieferungen (0 EUR) als zweite Rechnung.
  // Default ist Dry-Run; nur mit apply=true werden Aenderungen geschrieben.
  app.post(
    "/api/accounting/shop-fakturen/import",
    requireAuth,
    requireCsrf,
    requireManageDocuments,
    uploadRateLimiter,
    shopFakturenUpload.single("file"), restoreTenantContext,
    async (req, res) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file?.buffer) {
          return res.status(400).json({ error: "Keine Excel-Datei hochgeladen" });
        }

        // Tenant explizit aus dem Request lesen: multer (Multipart) bricht die
        // AsyncLocalStorage-Tenant-Weitergabe, daher den ueber requireAuth
        // gesetzten req.tenantId direkt durchreichen.
        const tenantId = (req as any).tenantId as string | null | undefined;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        // Optionen aus dem Multipart-Body (FormData liefert Strings)
        const truthy = (v: unknown) => v === true || v === "true" || v === "1";
        const options = {
          apply: truthy(req.body?.apply),
          fieldOnConflict: truthy(req.body?.fieldOnConflict),
          skipOriginalBackfill: truthy(req.body?.skipOriginalBackfill),
          markUnsent: truthy(req.body?.markUnsent),
          // Vorbereitung Automatisierung: Rechnungen direkt ueber Shopware verschicken.
          sendInvoice: truthy(req.body?.sendInvoice),
          eInvoice: (await getInvoiceAutomationSettings(tenantId)).eInvoice,
        };

        let rows;
        try {
          rows = parseFakturaRowsFromBuffer(file.buffer);
        } catch (parseError: any) {
          return res.status(400).json({ error: parseError?.message || "Excel konnte nicht gelesen werden" });
        }

        const client = new ShopwareClient(settings);
        const result = await runFakturaImport(client, tenantId, rows, options);
        res.json(result);
      } catch (error: any) {
        console.error("Shop-Fakturen-Import failed:", error);
        res.status(500).json({ error: error.message || "Import fehlgeschlagen" });
      }
    },
  );
}
