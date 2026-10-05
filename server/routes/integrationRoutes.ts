// Integrationen: E-Mail-Status, Microsoft 365 (Verbindungen und OAuth), Webhooks (Logs, Test, eingehende Tickets) und oeffentliche CPQ-Angebotsanfrage.
import { requireAuth, requireViewTickets, requireManageSettings, requireCpqHandoffToken } from "../auth/auth";
import { getEmailOutboundSettings } from "../email/emailOutbound";
import { storage } from "../storage";
import { getM365Settings, buildM365AuthUrl, startDeviceCode, exchangeDeviceCodeForToken, decodeIdToken, exchangeCodeForToken } from "../email/m365Client";
import crypto from "crypto";
import { z } from "zod";
import type { Request, Response, Express } from "express";
import { webhookService } from "../lib/webhookService";
import { type WebhookEventType, type TicketCategory } from "@shared/schema";
import rateLimit from "express-rate-limit";
import { assignTicketAutomatically } from "./routeHelpers";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/integrationRoutes" });

export function registerIntegrationRoutes(app: Express): void {
  // Lightweight status endpoint for UI toggles
  app.get("/api/email/outbound-status", requireAuth, requireViewTickets, async (_req, res) => {
    try {
      const { settings } = await getEmailOutboundSettings(storage);
      res.json({ enabled: settings.enabled });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching outbound status:");
      res.status(500).json({ error: error.message || "Failed to fetch outbound status" });
    }
  });

  app.get("/api/m365/connections", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const connections = await storage.getM365Connections();
      res.json(
        connections.map((connection) => ({
          id: connection.id,
          tenantId: connection.tenantId,
          email: connection.email,
          userId: connection.userId,
          scopes: connection.scopes || [],
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
          lastSyncAt: connection.lastSyncAt,
        }))
      );
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error fetching M365 connections:");
      res.status(500).json({ error: error.message || "Failed to fetch M365 connections" });
    }
  });

  app.delete("/api/m365/connections/:id", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const deleted = await storage.deleteM365Connection(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Connection not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error deleting M365 connection:");
      res.status(500).json({ error: error.message || "Failed to delete M365 connection" });
    }
  });

  app.get("/api/auth/m365/start", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settings = await getM365Settings(storage);
      if (!settings.enabled) {
        return res.status(400).json({ error: "M365 integration is disabled" });
      }
      if ((settings.authFlow || "auth_code") !== "auth_code") {
        return res.status(400).json({ error: "Auth code flow is disabled" });
      }
      const state = crypto.randomUUID();
      await storage.saveSetting(`m365_oauth_state_${state}`, {
        userId: (req.user as any).id,
        createdAt: new Date().toISOString(),
      });
      const url = buildM365AuthUrl(settings, state);
      res.redirect(url);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error starting M365 auth:");
      res.status(500).json({ error: error.message || "Failed to start M365 auth" });
    }
  });

  app.post("/api/auth/m365/device/start", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settings = await getM365Settings(storage);
      if (!settings.enabled) {
        return res.status(400).json({ error: "M365 integration is disabled" });
      }
      if ((settings.authFlow || "auth_code") !== "device_code") {
        return res.status(400).json({ error: "Device code flow is disabled" });
      }
      if (!settings.clientId) {
        return res.status(400).json({ error: "Client ID is required" });
      }

      const deviceResponse = await startDeviceCode(settings);
      const state = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + deviceResponse.expires_in * 1000);
      await storage.saveSetting(`m365_device_state_${state}`, {
        userId: (req.user as any).id,
        deviceCode: deviceResponse.device_code,
        expiresAt: expiresAt.toISOString(),
        interval: deviceResponse.interval || 5,
        createdAt: new Date().toISOString(),
      });

      res.json({
        state,
        userCode: deviceResponse.user_code,
        verificationUri: deviceResponse.verification_uri,
        verificationUriComplete: deviceResponse.verification_uri_complete,
        expiresAt: expiresAt.toISOString(),
        interval: deviceResponse.interval || 5,
        message: deviceResponse.message,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error starting M365 device code flow:");
      res.status(500).json({ error: error.message || "Failed to start device code flow" });
    }
  });

  app.post("/api/auth/m365/device/poll", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({ state: z.string().min(1) });
      const { state } = schema.parse(req.body);
      const stateKey = `m365_device_state_${state}`;
      const stateData = await storage.getSetting(stateKey);
      if (!stateData) {
        return res.status(404).json({ error: "Device state not found" });
      }
      if (stateData.userId !== (req.user as any).id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const expiresAt = stateData.expiresAt ? new Date(stateData.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() < Date.now()) {
        await storage.saveSetting(stateKey, { ...stateData, expired: true });
        return res.status(400).json({ error: "Device code expired", status: "expired" });
      }

      const settings = await getM365Settings(storage);
      const tokenResult = await exchangeDeviceCodeForToken(settings, stateData.deviceCode);
      if (!tokenResult.ok) {
        const errorCode = tokenResult.data?.error;
        if (errorCode === "authorization_pending") {
          return res.json({ status: "pending" });
        }
        if (errorCode === "slow_down") {
          return res.json({ status: "pending", slowDown: true });
        }
        if (errorCode === "expired_token") {
          await storage.saveSetting(stateKey, { ...stateData, expired: true });
          return res.status(400).json({ status: "expired", error: "Device code expired" });
        }
        if (errorCode === "access_denied") {
          await storage.saveSetting(stateKey, { ...stateData, denied: true });
          return res.status(400).json({ status: "denied", error: "Access denied" });
        }
        return res.status(500).json({ error: tokenResult.data?.error_description || "Device code exchange failed" });
      }

      const tokenData = tokenResult.data;
      const decoded = decodeIdToken(tokenData.id_token);
      const tenantId = decoded?.tid || "unknown";
      const email = decoded?.preferred_username || decoded?.email || "unknown";
      const expiresAtToken = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null;

      await storage.createM365Connection({
        tenantId,
        email,
        userId: (req.user as any).id,
        scopes: tokenData.scope ? tokenData.scope.split(" ") : [],
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: expiresAtToken,
        lastSyncAt: null,
      });

      await storage.saveSetting(stateKey, { ...stateData, consumed: true, consumedAt: new Date().toISOString() });

      res.json({ status: "connected", email, tenantId });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      moduleLog.error({ err: error }, "Error polling M365 device code:");
      res.status(500).json({ error: error.message || "Failed to poll device code" });
    }
  });

  app.get("/api/auth/m365/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state || typeof code !== "string" || typeof state !== "string") {
        return res.status(400).json({ error: "Invalid OAuth callback" });
      }
      const stateKey = `m365_oauth_state_${state}`;
      const stateData = await storage.getSetting(stateKey);
      if (!stateData) {
        return res.status(400).json({ error: "OAuth state not found" });
      }

      const settings = await getM365Settings(storage);
      const tokenData = await exchangeCodeForToken(settings, code);
      const decoded = decodeIdToken(tokenData.id_token);
      const tenantId = decoded?.tid || "unknown";
      const email = decoded?.preferred_username || decoded?.email || "unknown";
      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null;

      const existing = await storage.getM365ConnectionByEmail(email);
      if (existing) {
        await storage.updateM365Connection(existing.id, {
          tenantId,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || existing.refreshToken,
          expiresAt: expiresAt || existing.expiresAt,
          scopes: tokenData.scope ? tokenData.scope.split(" ") : existing.scopes,
          userId: stateData.userId || existing.userId,
        });
      } else {
        await storage.createM365Connection({
          tenantId,
          email,
          userId: stateData.userId || null,
          scopes: tokenData.scope ? tokenData.scope.split(" ") : [],
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: expiresAt,
        });
      }

      await storage.saveSetting(stateKey, { consumed: true, consumedAt: new Date().toISOString() });
      res.redirect("/settings?m365=connected");
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error handling M365 callback:");
      res.status(500).json({ error: error.message || "Failed to complete M365 auth" });
    }
  });

  // POST /api/cpq/public/offer-request - wie /api/offer-drafts/from-cpq, aber für den
  // öffentlichen Shop-Konfigurator: nur eingeloggte Kunden (customerId kommt ausschließlich
  // aus dem verifizierten Handoff-Token), landet wie jeder andere CPQ-Entwurf in der
  // "Ausstehende Entwürfe"-Prüfung, bevor ein Sachbearbeiter daraus ein echtes Angebot macht.
  app.post("/api/cpq/public/offer-request", requireCpqHandoffToken, async (req: Request, res: Response) => {
    try {
      const customerId = req.cpqHandoff?.customerId ?? null;
      if (!customerId) {
        return res.status(403).json({ error: "Bitte melden Sie sich im Shop an, um ein Angebot anzufragen." });
      }
      const { systemId, systemName, config, billOfMaterials, cpqConfigurationId, previewImageBase64 } = req.body;

      if (!billOfMaterials || !billOfMaterials.items || billOfMaterials.items.length === 0) {
        return res.status(400).json({ error: "Stückliste ist leer. Bitte zuerst die Konfiguration vervollständigen." });
      }
      const previewImage =
        typeof previewImageBase64 === "string" && /^data:image\/\w+;base64,/.test(previewImageBase64)
          ? previewImageBase64
          : null;

      type BomItemIn = {
        productId: string;
        productNumber: string;
        name: string;
        quantity: number;
        unitPrice: number;
        lineTotal?: number;
        componentType?: string;
        catalogUnitPrice?: number;
        discountPercent?: number;
      };
      const bomItems: BomItemIn[] = billOfMaterials.items;
      const totalCatalogValue: number =
        typeof billOfMaterials.totalCatalogPrice === "number" ? billOfMaterials.totalCatalogPrice : billOfMaterials.totalPrice;
      const totalSuggestedValue: number = billOfMaterials.totalPrice;
      const totalDiscountPercentage =
        totalCatalogValue > 0 ? Math.round((1 - totalSuggestedValue / totalCatalogValue) * 1000) / 10 : 0;

      const matchingResults = {
        items: bomItems.map((item) => ({
          extractedProductName: item.name,
          extractedProductNumber: item.productNumber,
          quantity: item.quantity,
          matchedProduct: {
            id: item.productId,
            productNumber: item.productNumber,
            name: item.name,
            catalogPrice: item.catalogUnitPrice ?? item.unitPrice,
            suggestedPrice: item.unitPrice,
            suggestedDiscount: item.discountPercent ?? 0,
          },
          confidence: 100,
          status: "matched",
          productScreen: { likelihood: "likely_product" as const, reasons: ["CPQ-Stückliste (Shop-Kunde)"] },
        })),
        overallConfidence: 100,
        pricingRecommendations: { totalCatalogValue, totalSuggestedValue, totalDiscountPercentage, reasoning: "CPQ-Konfigurator (Shop-Kunde)" },
      };

      const offerDraft = await storage.createOfferDraft(
        {
          status: "review_required",
          originalFileName: `CPQ-Shop-${systemName ?? systemId ?? "Konfiguration"}-${new Date().toISOString().slice(0, 10)}.json`,
          originalFilePath: null,
          extractedData: {
            offerNotes: `Angebotsanfrage aus dem Shop-Konfigurator: ${systemName ?? systemId ?? "Regalsystem"}`,
            validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            cpqSource: {
              systemId: systemId ?? null,
              systemName: systemName ?? null,
              config: config && typeof config === "object" ? config : null,
              cpqConfigurationId: typeof cpqConfigurationId === "string" ? cpqConfigurationId : null,
              previewImageBase64: previewImage,
              billOfMaterials: {
                items: bomItems.map((item) => ({
                  productId: item.productId,
                  productNumber: item.productNumber,
                  name: item.name,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  lineTotal: item.lineTotal,
                  componentType: item.componentType,
                  catalogPrice: item.catalogUnitPrice,
                  discountPercent: item.discountPercent,
                })),
                totalPrice: billOfMaterials.totalPrice,
                totalCatalogPrice: totalCatalogValue,
              },
            },
          },
          matchingResults,
          shopwareCustomerId: customerId,
          shopwareOfferId: null,
          // Kein interner Mitarbeiter — der Ursprung "Shop-Kunde" steht in offerNotes/matchingResults.
          createdByUserId: null,
        },
        req.tenantId ?? null,
      );

      // Best-effort: eine fehlgeschlagene Bestätigungsmail darf die Anfrage nicht blockieren.
      try {
        const settings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (settings) {
          const { ShopwareClient } = await import("../shopware/shopware");
          const client = new ShopwareClient(settings);
          const billing = await client.fetchCustomerBillingForPdf(customerId);
          if (billing?.email) {
            const { sendEmail } = await import("../email/emailOutbound");
            await sendEmail(storage, {
              to: billing.email,
              subject: "Ihre Angebotsanfrage bei META",
              text:
                "Vielen Dank für Ihre Konfiguration! Wir haben Ihre Anfrage erhalten und melden uns in Kürze mit einem individuellen Angebot.",
            });
          }
        }
      } catch (mailError) {
        moduleLog.warn({ err: mailError }, "[CPQ] Bestätigungsmail für Angebotsanfrage konnte nicht gesendet werden:");
      }

      res.json({ success: true, offerDraftId: offerDraft.id });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating public offer request from CPQ:");
      res.status(500).json({ error: error.message ?? "Angebotsanfrage konnte nicht erstellt werden" });
    }
  });

  // Get webhook logs with filtering
  app.get("/api/webhooks/logs", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const { eventType, status, limit = "100", offset = "0" } = req.query;

      const filters: any = {};
      if (eventType) filters.eventType = eventType as string;
      if (status) filters.status = status as string;

      const { logs, total } = await storage.getWebhookLogs({
        ...filters,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });

      // Transform DB schema to frontend-expected format
      const transformedLogs = logs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        url: log.targetUrl,  // targetUrl → url
        statusCode: log.responseStatus,  // responseStatus → statusCode
        success: log.status === "success",  // status string → success boolean
        error: log.errorMessage,  // errorMessage → error
        retryCount: log.attempt - 1,  // attempt (1-based) → retryCount (0-based)
        createdAt: log.executedAt,  // executedAt → createdAt
      }));

      res.json({
        logs: transformedLogs,
        total,  // Use the real total from storage for pagination
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching webhook logs:");
      res.status(500).json({ error: "Failed to fetch webhook logs" });
    }
  });

  // Test webhook endpoint
  app.post("/api/webhooks/test", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const { eventType, url } = req.body;

      if (!eventType) {
        return res.status(400).json({ error: "Event type is required" });
      }

      const result = await webhookService.test(eventType as WebhookEventType, url);

      res.json(result);
    } catch (error) {
      moduleLog.error({ err: error }, "Error testing webhook:");
      res.status(500).json({ error: "Failed to test webhook" });
    }
  });

  // ========================================
  // INCOMING WEBHOOKS - External Ticket Creation
  // ========================================
  // Schema for external ticket creation via webhook
  const incomingTicketWebhookSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    category: z.string().optional(),
    orderId: z.string().optional(),
    orderNumber: z.string().optional(),
    returnReason: z.string().optional(),
    returnItems: z.array(z.object({
      productId: z.string().optional(),
      productNumber: z.string().optional(),
      productName: z.string(),
      quantity: z.number().int().positive(),
      reason: z.string().optional(),
    })).optional(),
    customerEmail: z.string().email().optional(),
    customerName: z.string().optional(),
    externalReference: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  });

  // HMAC signature verification helper
  function verifyWebhookSignature(rawBody: Buffer | string, signature: string, timestamp: string): boolean {
    const secret = process.env.N8N_SERVICE_PASSWORD;
    if (!secret) {
      moduleLog.error("[Incoming Webhook] N8N_SERVICE_PASSWORD not configured");
      return false;
    }
    
    // Check timestamp to prevent replay attacks (allow 5 minute window)
    const timestampMs = parseInt(timestamp);
    const now = Date.now();
    if (isNaN(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
      moduleLog.warn("[Incoming Webhook] Timestamp outside acceptable window");
      return false;
    }
    
    // Validate signature format (must be valid hex string)
    if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
      moduleLog.warn("[Incoming Webhook] Invalid signature format (expected 64 hex characters)");
      return false;
    }
    
    // Convert rawBody to string if it's a Buffer
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    
    // Compute expected signature using raw body
    const data = `${timestamp}.${payload}`;
    const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest("hex");
    
    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature.toLowerCase(), 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (err) {
      moduleLog.error({ err }, "[Incoming Webhook] Signature comparison error:");
      return false;
    }
  }

  // Rate limiter for incoming webhooks
  const incomingWebhookRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { error: "Too many webhook requests. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Incoming Webhook: Create ticket from external source (n8n, Zapier, etc.)
  // This endpoint does NOT require session authentication - uses HMAC signature instead
  app.post("/api/webhooks/incoming/tickets", incomingWebhookRateLimiter, async (req: Request, res: Response) => {
    try {
      // Get signature headers
      const signature = req.headers['x-metaorder-signature'] as string;
      const timestamp = req.headers['x-metaorder-timestamp'] as string;
      
      if (!signature || !timestamp) {
        moduleLog.warn("[Incoming Webhook] Missing signature or timestamp header");
        return res.status(401).json({ 
          error: "Unauthorized", 
          message: "Missing X-METAorder-Signature or X-METAorder-Timestamp header" 
        });
      }
      
      // Verify HMAC signature using raw body (set by express.json verify option in index.ts)
      const rawBody = (req as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        moduleLog.error("[Incoming Webhook] Raw body not available");
        return res.status(500).json({ 
          error: "Internal error", 
          message: "Unable to process request body" 
        });
      }
      
      if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
        moduleLog.warn("[Incoming Webhook] Invalid signature");
        return res.status(401).json({ 
          error: "Unauthorized", 
          message: "Invalid webhook signature" 
        });
      }
      
      // Validate payload
      const validationResult = incomingTicketWebhookSchema.safeParse(req.body);
      if (!validationResult.success) {
        moduleLog.warn({ errors: validationResult.error.errors }, "[Incoming Webhook] Validation failed:");
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validationResult.error.errors 
        });
      }
      
      const payload = validationResult.data;
      
      // Get or create n8n-service user for ticket creation
      const n8nUser = await storage.getUserByUsername("n8n-service");
      if (!n8nUser) {
        moduleLog.error("[Incoming Webhook] n8n-service user not found");
        return res.status(500).json({ 
          error: "Internal error", 
          message: "Service account not configured" 
        });
      }
      
      // Build ticket description with return/retoure information if present
      let description = payload.description || '';
      
      if (payload.returnReason || payload.returnItems) {
        if (description) description += '\n\n---\n\n';
        description += '**Retoure/Return Request**\n\n';
        
        if (payload.returnReason) {
          description += `**Reason:** ${payload.returnReason}\n\n`;
        }
        
        if (payload.returnItems && payload.returnItems.length > 0) {
          description += '**Items to return:**\n';
          for (const item of payload.returnItems) {
            description += `- ${item.productName} (Qty: ${item.quantity})`;
            if (item.productNumber) description += ` [${item.productNumber}]`;
            if (item.reason) description += ` - Reason: ${item.reason}`;
            description += '\n';
          }
        }
        
        if (payload.customerName || payload.customerEmail) {
          description += '\n**Customer:**\n';
          if (payload.customerName) description += `- Name: ${payload.customerName}\n`;
          if (payload.customerEmail) description += `- Email: ${payload.customerEmail}\n`;
        }
        
        if (payload.externalReference) {
          description += `\n**External Reference:** ${payload.externalReference}\n`;
        }
      }
      
      const allowedCategories: TicketCategory[] = [
        "general",
        "order_issue",
        "product_inquiry",
        "technical_support",
        "complaint",
        "feature_request",
        "other",
      ];
      const normalizedCategory = allowedCategories.includes(payload.category as TicketCategory)
        ? (payload.category as TicketCategory)
        : "general";

      // Create ticket via storage
      const ticketData = {
        title: payload.title,
        description: description || "",
        priority: payload.priority,
        category: normalizedCategory,
        orderId: payload.orderId || null,
        orderNumber: payload.orderNumber || null,
        returnReason: payload.returnReason || null,
        returnItems: payload.returnItems || null,
        createdByUserId: n8nUser.id,
        status: 'open' as const,
      };
      
      let ticket = await storage.createTicket(ticketData);
      
      // Log creation activity
      await storage.createTicketActivityLog({
        ticketId: ticket.id,
        userId: n8nUser.id,
        action: 'created',
        fieldName: null,
        oldValue: null,
        newValue: null,
      });
      
      // Auto-assign if applicable
      if (!ticket.assignedToUserId) {
        const assigneeId = await assignTicketAutomatically(ticket);
        if (assigneeId) {
          const updated = await storage.updateTicket(ticket.id, { assignedToUserId: assigneeId });
          if (updated) {
            ticket = updated;
            
            // Log auto-assignment
            await storage.createTicketActivityLog({
              ticketId: ticket.id,
              userId: n8nUser.id,
              action: 'auto_assigned',
              fieldName: 'assignedToUserId',
              newValue: assigneeId,
            });
            
            // Trigger outgoing webhook for assignment
            webhookService.trigger("ticket.assigned", {
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              previousAssignee: null,
              newAssignee: assigneeId,
              assignedBy: n8nUser.id,
              assignedAt: new Date().toISOString(),
            }, {
              source: "auto_assignment",
              trigger: "incoming_webhook",
              actorId: "system",
            }).catch(err => moduleLog.error({ err }, "Error triggering ticket.assigned webhook:"));
          }
        }
      }
      
      // Trigger outgoing webhook for ticket creation
      webhookService.trigger("ticket.created", {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        priority: ticket.priority,
        status: ticket.status,
        assignedToUserId: ticket.assignedToUserId,
        createdByUserId: ticket.createdByUserId ?? n8nUser.id,
        createdAt: ticket.createdAt?.toISOString() || new Date().toISOString(),
      }, {
        source: "incoming_webhook",
        externalReference: payload.externalReference,
      }).catch(err => moduleLog.error({ err }, "Error triggering ticket.created webhook:"));
      
      moduleLog.info(`[Incoming Webhook] Created ticket ${ticket.ticketNumber} from external source`);
      
      // Return created ticket info
      res.status(201).json({
        success: true,
        ticket: {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          priority: ticket.priority,
          status: ticket.status,
          assignedToUserId: ticket.assignedToUserId,
          createdAt: ticket.createdAt,
        },
      });
      
    } catch (error: any) {
      moduleLog.error({ err: error }, "[Incoming Webhook] Error creating ticket:");
      res.status(500).json({ 
        error: "Internal server error", 
        message: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  });
}
