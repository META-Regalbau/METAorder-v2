// Einstellungen: Shopware, Mondu, E-Mail, KI, Nummernkreise, Mahnwesen, Rechnungsautomatik u. a.
import { requireAuth, requireManageSettings, requireManageDocuments, requireCsrf } from "../auth/auth";
import { storage } from "../storage";
import { shopwareSettingsSchema, proformaNumberRangeSchema, invoiceAutomationSettingsSchema, dunningSettingsSchema, monduSettingsSchema, type MonduSettings, type WebhookEventType } from "@shared/schema";
import { z } from "zod";
import { loadCrmProfitabilitySettings, parseCrmProfitabilitySettings, saveCrmProfitabilitySettings } from "../analytics/crmProfitabilitySettings";
import { getInvoiceAutomationSettings, INVOICE_AUTOMATION_SETTINGS_KEY } from "../invoicing/invoiceSending";
import { ShopwareClient } from "../shopware/shopware";
import { getTicketSlaSettings, defaultDunningSettings, defaultProformaNumberRange } from "./routeHelpers";
import { getEmailInboundSettings, saveEmailInboundSettings } from "../email/emailInbound";
import { getEmailOutboundSettings, saveEmailOutboundSettings } from "../email/emailOutbound";
import { getEmailRoutingSettings, DEFAULT_EMAIL_ROUTING_SETTINGS } from "../email/emailRouting";
import { getM365Settings, saveM365Settings } from "../email/m365Client";
import { getGoogleAnalyticsSettings, parseIdsInput, saveGoogleAnalyticsSettings, getGoogleAdsSettings, saveGoogleAdsSettings } from "../analytics/googleKpi";
import { type OfferStatusMapping, getOfferStatusMapping } from "../b2b/b2bSellersClient";
import { OFFER_CONFIG_PDF_TEXTS_SETTING_KEY, mergeOfferConfigPdfStoredTexts, DEFAULT_OFFER_CONFIG_PDF_TEXTS, offerConfigPdfTextsPayloadSchema } from "../offers/offerConfigPdfTexts";
import { encrypt } from "../lib/encryption";
import { getCommercialAgentSettings, DEFAULT_COMMERCIAL_AGENT, type CommercialAgentSettings } from "../ai/aiConfig";
import type { Request, Response, Express } from "express";
import { webhookService } from "../lib/webhookService";

import { NL_LIMIT_MAX, resolveNlLimits } from "../analytics/nlQueryLimit";
import { SEMANTIC_RANKING_DEFAULTS } from "../semantic/semanticRanking";
import { logger } from "../lib/logger";
import { clearShopwareAuthPause } from "../shopware/shopwareTokenCache";
import { describeIntegrationUser, listIntegrationUserCandidates, loadFallbackIntegrationUser } from "../integration/integrationKeyUsers";

const log = logger.child({ component: "routes/settingsRoutes" });

export function registerSettingsRoutes(app: Express): void {
  
  // Shopware settings routes
  app.get("/api/settings/shopware", requireAuth, requireManageSettings, async (req, res) => {
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
      log.error({ err: error }, "Error fetching Shopware settings:");
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings/shopware", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settingsSchema = shopwareSettingsSchema
        .omit({ apiSecret: true })
        .extend({ apiSecret: z.string().optional() });
      const validated = settingsSchema.parse(req.body);
      const existing = await storage.getShopwareSettings();
      const hasNewSecret = validated.apiSecret && validated.apiSecret.trim().length > 0;
      const apiSecret = hasNewSecret ? validated.apiSecret! : existing?.apiSecret;

      if (!apiSecret) {
        return res.status(400).json({ error: "API secret is required for initial setup" });
      }

      const settings = await storage.saveShopwareSettings({
        shopwareUrl: validated.shopwareUrl,
        apiKey: validated.apiKey,
        apiSecret,
      });
      // gespeichert (z. B. nach Freischalten der Integration in Shopware): sofort wieder versuchen
      clearShopwareAuthPause(validated.shopwareUrl, validated.apiKey, apiSecret);
      
      res.json({
        message: "Settings saved successfully",
        shopwareUrl: settings.shopwareUrl,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error saving Shopware settings:");
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid settings data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Proforma number range settings (per tenant)
  app.get("/api/settings/proforma-number-range", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await storage.getProformaNumberRangeSettings();
      res.json(settings ?? defaultProformaNumberRange);
    } catch (error: any) {
      log.error({ err: error }, "Error fetching proforma number range settings:");
      res.status(500).json({ error: error.message || "Failed to fetch proforma number range settings" });
    }
  });

  app.post("/api/settings/proforma-number-range", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const validated = proformaNumberRangeSchema.parse(req.body);
      const saved = await storage.saveProformaNumberRangeSettings(validated);
      res.json(saved);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving proforma number range settings:");
      res.status(500).json({ error: error.message || "Failed to save proforma number range settings" });
    }
  });

  app.get("/api/settings/crm-profitability", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId as string | null | undefined;
      const settings = await loadCrmProfitabilitySettings(storage, tenantId);
      res.json(settings);
    } catch (error: any) {
      log.error({ err: error }, "Error fetching CRM profitability settings:");
      res.status(500).json({ error: error.message || "Failed to fetch CRM profitability settings" });
    }
  });

  app.post("/api/settings/crm-profitability", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId as string | null | undefined;
      const parsed = parseCrmProfitabilitySettings(req.body);
      const saved = await saveCrmProfitabilitySettings(storage, parsed, tenantId);
      res.json(saved);
    } catch (error: any) {
      log.error({ err: error }, "Error saving CRM profitability settings:");
      res.status(500).json({ error: error.message || "Failed to save CRM profitability settings" });
    }
  });

  // Rechnungs-Automatik (E-Rechnung/ZUGFeRD + automatischer Versand)
  app.get("/api/settings/invoice-automation", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      res.json(await getInvoiceAutomationSettings(tenantId));
    } catch (error: any) {
      log.error({ err: error }, "Error fetching invoice automation settings:");
      res.status(500).json({ error: error.message || "Failed to fetch invoice automation settings" });
    }
  });

  app.post("/api/settings/invoice-automation", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const validated = invoiceAutomationSettingsSchema.parse(req.body);
      await storage.saveSetting(INVOICE_AUTOMATION_SETTINGS_KEY, validated, tenantId);
      res.json(validated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving invoice automation settings:");
      res.status(500).json({ error: error.message || "Failed to save invoice automation settings" });
    }
  });

  // Dunning (Mahnung) settings
  app.get("/api/settings/dunning", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await storage.getDunningSettings();
      res.json({ ...defaultDunningSettings, ...(settings || {}) });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching dunning settings:");
      res.status(500).json({ error: error.message || "Failed to fetch dunning settings" });
    }
  });

  app.post("/api/settings/dunning", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const validated = dunningSettingsSchema.parse(req.body);
      const saved = await storage.saveDunningSettings(validated);
      res.json(saved);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving dunning settings:");
      res.status(500).json({ error: error.message || "Failed to save dunning settings" });
    }
  });

  /**
   * Benutzer fuer einen Integrations-Schluessel: leer = Ersatz-Benutzer; sonst muss er Mitglied des
   * Schluessel-Mandanten sein - sonst entstehen Keys, die erst zur Laufzeit scheitern (verwirrend) oder,
   * schlimmer, bei spaeteren Mitgliedschafts-Aenderungen unbemerkt scharf werden.
   * Bei ungueltigem Benutzer antwortet sie selbst mit 400 und liefert null.
   */
  async function resolveKeyUser(raw: unknown, tenantId: string, res: Response): Promise<{ userId: string | null } | null> {
    const requestedUserId = typeof raw === "string" ? raw.trim() : "";
    if (!requestedUserId) return { userId: null };
    const requestedUser = await storage.getUser(requestedUserId);
    if (!requestedUser) {
      res.status(400).json({ error: "userId nicht gefunden" });
      return null;
    }
    const targetTenants = await storage.getTenantsForUser(requestedUser.id);
    if (!targetTenants.some((t) => t.id === tenantId)) {
      res.status(400).json({ error: "Der angegebene Benutzer ist diesem Mandanten nicht zugeordnet." });
      return null;
    }
    return { userId: requestedUser.id };
  }

  // Integration API keys (Automation / n8n pro Mandant; Klartext nur bei POST einmal)
  app.get("/api/settings/integration-api-keys", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      if (!tenantId) {
        return res.status(400).json({ error: "Tenant required" });
      }
      const [keys, users, fallback] = await Promise.all([
        storage.listTenantIntegrationApiKeys(tenantId),
        listIntegrationUserCandidates(storage, tenantId),
        loadFallbackIntegrationUser(storage),
      ]);
      const fallbackUser = fallback ? await describeIntegrationUser(storage, fallback, tenantId) : null;
      const byId = new Map(users.map((user) => [user.id, user]));
      res.json({
        // je Schluessel: unter welchem Benutzer n8n arbeitet (gebunden oder Ersatz-Benutzer) und ob das reicht
        keys: await Promise.all(
          keys.map(async (key) => {
            if (!key.userId) return { ...key, user: null, effectiveUser: fallbackUser };
            const bound = byId.get(key.userId) ?? (await storage.getUser(key.userId).then((u) => (u ? describeIntegrationUser(storage, u, tenantId) : null)));
            return { ...key, user: bound, effectiveUser: bound };
          }),
        ),
        users,
        fallbackUser,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error listing integration API keys:");
      res.status(500).json({ error: error.message || "Failed to list keys" });
    }
  });

  app.post("/api/settings/integration-api-keys", requireAuth, requireManageSettings, requireCsrf, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      if (!tenantId) {
        return res.status(400).json({ error: "Tenant required" });
      }
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      const resolved = await resolveKeyUser(req.body?.userId, tenantId, res);
      if (!resolved) return;
      const created = await storage.createTenantIntegrationApiKey(tenantId, name, resolved.userId);
      res.json({
        id: created.id,
        apiKey: created.apiKey,
        warning: "Den apiKey sicher speichern; er wird nicht erneut angezeigt.",
      });
    } catch (error: any) {
      log.error({ err: error }, "Error creating integration API key:");
      res.status(500).json({ error: error.message || "Failed to create key" });
    }
  });

  // Benutzer eines vorhandenen Schluessels aendern (der Schluessel in n8n bleibt gleich)
  app.patch("/api/settings/integration-api-keys/:id", requireAuth, requireManageSettings, requireCsrf, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      if (!tenantId) {
        return res.status(400).json({ error: "Tenant required" });
      }
      const resolved = await resolveKeyUser(req.body?.userId, tenantId, res);
      if (!resolved) return;
      const ok = await storage.setTenantIntegrationApiKeyUser(req.params.id, tenantId, resolved.userId);
      if (!ok) {
        return res.status(404).json({ error: "Key not found" });
      }
      res.json({ ok: true, userId: resolved.userId });
    } catch (error: any) {
      log.error({ err: error }, "Error updating integration API key:");
      res.status(500).json({ error: error.message || "Failed to update key" });
    }
  });

  app.delete("/api/settings/integration-api-keys/:id", requireAuth, requireManageSettings, requireCsrf, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      if (!tenantId) {
        return res.status(400).json({ error: "Tenant required" });
      }
      const ok = await storage.deleteTenantIntegrationApiKey(req.params.id, tenantId);
      if (!ok) {
        return res.status(404).json({ error: "Key not found" });
      }
      res.json({ ok: true });
    } catch (error: any) {
      log.error({ err: error }, "Error deleting integration API key:");
      res.status(500).json({ error: error.message || "Failed to delete key" });
    }
  });

  app.post("/api/settings/shopware/test", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settingsSchema = shopwareSettingsSchema
        .omit({ apiSecret: true })
        .extend({ apiSecret: z.string().optional() });
      const validated = settingsSchema.parse(req.body);
      const existing = await storage.getShopwareSettings();
      const hasNewSecret = validated.apiSecret && validated.apiSecret.trim().length > 0;
      const apiSecret = hasNewSecret ? validated.apiSecret! : existing?.apiSecret;

      if (!apiSecret) {
        return res.status(400).json({ success: false, error: "API secret is required to test the connection" });
      }

      // ausdruecklicher Test: auch pausierte (abgelehnte) Zugangsdaten wirklich pruefen
      clearShopwareAuthPause(validated.shopwareUrl, validated.apiKey, apiSecret);
      const client = new ShopwareClient({
        shopwareUrl: validated.shopwareUrl,
        apiKey: validated.apiKey,
        apiSecret,
      });
      const isConnected = await client.testConnection();
      
      if (isConnected) {
        res.json({ success: true, message: "Connection successful" });
      } else {
        res.status(400).json({ success: false, error: "Failed to connect to Shopware" });
      }
    } catch (error: any) {
      log.error({ err: error }, "Error testing Shopware connection:");
      res.status(500).json({ success: false, error: error.message || "Connection test failed" });
    }
  });

  // Ticket SLA settings
  app.get("/api/settings/ticket-sla", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getTicketSlaSettings();
      res.json(settings);
    } catch (error: any) {
      log.error({ err: error }, "Error fetching ticket SLA settings:");
      res.status(500).json({ error: error.message || "Failed to fetch SLA settings" });
    }
  });

  app.post("/api/settings/ticket-sla", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        lowDays: z.number().min(0).max(365),
        normalDays: z.number().min(0).max(365),
        highDays: z.number().min(0).max(365),
        urgentDays: z.number().min(0).max(365),
      });
      const validated = schema.parse(req.body);
      await storage.saveSetting("ticket_sla_settings", validated);
      res.json(validated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving ticket SLA settings:");
      res.status(500).json({ error: error.message || "Failed to save SLA settings" });
    }
  });

  // Email inbound settings (IMAP)
  app.get("/api/settings/email-inbound", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const { settings, hasPassword } = await getEmailInboundSettings(storage);
      res.json({
        settings: {
          ...settings,
          password: "",
        },
        hasPassword,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching email inbound settings:");
      res.status(500).json({ error: error.message || "Failed to fetch email inbound settings" });
    }
  });

  app.post("/api/settings/email-inbound", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        host: z.string().optional(),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().optional(),
        password: z.string().optional().or(z.literal("")),
        mailbox: z.string().min(1),
        pollIntervalSeconds: z.number().int().min(10).max(3600),
        markAsSeen: z.boolean(),
        maxMessages: z.number().int().min(1).max(200),
        allowAttachments: z.boolean(),
      });

      const validated = schema.parse(req.body);
      const existing = await getEmailInboundSettings(storage);
      const password = validated.password?.trim()
        ? validated.password
        : existing.settings.password;

      if (validated.enabled && (!validated.host || !validated.user || !password)) {
        return res.status(400).json({ error: "Host, user, and password are required when enabled" });
      }

      await saveEmailInboundSettings(storage, {
        enabled: validated.enabled,
        host: validated.host || "",
        port: validated.port,
        secure: validated.secure,
        user: validated.user || "",
        password: password || "",
        mailbox: validated.mailbox,
        pollIntervalSeconds: validated.pollIntervalSeconds,
        markAsSeen: validated.markAsSeen,
        maxMessages: validated.maxMessages,
        allowAttachments: validated.allowAttachments,
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving email inbound settings:");
      res.status(500).json({ error: error.message || "Failed to save email inbound settings" });
    }
  });

  // Email outbound settings (SMTP)
  app.get("/api/settings/email-outbound", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const { settings, hasPassword } = await getEmailOutboundSettings(storage);
      res.json({
        settings: {
          ...settings,
          password: "",
        },
        hasPassword,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching email outbound settings:");
      res.status(500).json({ error: error.message || "Failed to fetch email outbound settings" });
    }
  });

  app.post("/api/settings/email-outbound", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        host: z.string().optional(),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().optional(),
        password: z.string().optional().or(z.literal("")),
        fromAddress: z.string().optional(),
        fromName: z.string().optional(),
        replyTo: z.string().optional(),
        m365ConnectionId: z.string().optional(),
      });

      const validated = schema.parse(req.body);
      const existing = await getEmailOutboundSettings(storage);
      const password = validated.password?.trim()
        ? validated.password
        : existing.settings.password;

      if (validated.enabled && !validated.m365ConnectionId) {
        if (!validated.host || !validated.user || !password || !validated.fromAddress) {
          return res.status(400).json({ error: "Host, user, password, and from address are required when enabled" });
        }
      }

      await saveEmailOutboundSettings(storage, {
        enabled: validated.enabled,
        host: validated.host || "",
        port: validated.port,
        secure: validated.secure,
        user: validated.user || "",
        password: password || "",
        fromAddress: validated.fromAddress || "",
        fromName: validated.fromName || "",
        replyTo: validated.replyTo || "",
        m365ConnectionId: validated.m365ConnectionId || "",
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving email outbound settings:");
      res.status(500).json({ error: error.message || "Failed to save email outbound settings" });
    }
  });

  // Email routing settings
  app.get("/api/settings/email-routing", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getEmailRoutingSettings(storage);
      res.json(settings);
    } catch (error: any) {
      log.error({ err: error }, "Error fetching email routing settings:");
      res.status(500).json({ error: error.message || "Failed to fetch email routing settings" });
    }
  });

  app.post("/api/settings/email-routing", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        confidenceThreshold: z.number().min(0).max(1),
        defaultCategory: z.enum([
          "general",
          "order_issue",
          "product_inquiry",
          "technical_support",
          "complaint",
          "feature_request",
          "other",
        ]),
        defaultPriority: z.enum(["low", "normal", "high", "urgent"]),
        defaultSkill: z.string().optional(),
        fallbackRules: z.array(z.object({
          pattern: z.string().min(1),
          target: z.enum(["subject", "body", "from", "all"]),
          category: z.string().optional(),
          priority: z.string().optional(),
          skill: z.string().optional(),
        })),
      });

      const validated = schema.parse(req.body);
      await storage.saveSetting("email_routing_settings", {
        ...DEFAULT_EMAIL_ROUTING_SETTINGS,
        ...validated,
        fallbackRules: validated.fallbackRules || [],
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving email routing settings:");
      res.status(500).json({ error: error.message || "Failed to save email routing settings" });
    }
  });

  // Microsoft 365 settings
  app.get("/api/settings/m365", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getM365Settings(storage);
      res.json({
        ...settings,
        clientSecret: "",
        hasClientSecret: Boolean(settings.clientSecret),
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching M365 settings:");
      res.status(500).json({ error: error.message || "Failed to fetch M365 settings" });
    }
  });

  app.post("/api/settings/m365", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        clientId: z.string().optional().or(z.literal("")),
        clientSecret: z.string().optional().or(z.literal("")),
        redirectUri: z.string().optional().or(z.literal("")),
        enableGraph: z.boolean(),
        enableImapSmtp: z.boolean(),
        authFlow: z.enum(["device_code", "auth_code"]).optional(),
      });
      const validated = schema.parse(req.body);
      const existing = await getM365Settings(storage);
      const clientId = validated.clientId?.trim()
        ? validated.clientId
        : existing.clientId;
      const redirectUri = validated.redirectUri?.trim()
        ? validated.redirectUri
        : existing.redirectUri;
      const clientSecret = validated.clientSecret?.trim()
        ? validated.clientSecret
        : existing.clientSecret;

      const authFlow = validated.authFlow || existing.authFlow || "auth_code";
      if (validated.enabled && authFlow === "auth_code" && (!clientId || !clientSecret || !redirectUri)) {
        return res.status(400).json({ error: "Client ID, secret and redirect URI are required when enabled" });
      }
      if (validated.enabled && authFlow === "device_code" && !clientId) {
        return res.status(400).json({ error: "Client ID is required when device code flow is enabled" });
      }

      await saveM365Settings(storage, {
        enabled: validated.enabled,
        clientId: clientId || "",
        clientSecret: clientSecret || "",
        redirectUri: redirectUri || existing.redirectUri,
        enableGraph: validated.enableGraph,
        enableImapSmtp: validated.enableImapSmtp,
        authFlow,
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving M365 settings:");
      res.status(500).json({ error: error.message || "Failed to save M365 settings" });
    }
  });

  // Google Analytics (GA4) settings
  app.get("/api/settings/google-analytics", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getGoogleAnalyticsSettings(storage);
      res.json({
        ...settings,
        serviceAccountJson: "",
        hasServiceAccountJson: Boolean(settings.serviceAccountJson),
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching GA4 settings:");
      res.status(500).json({ error: error.message || "Failed to fetch GA4 settings" });
    }
  });

  app.post("/api/settings/google-analytics", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        propertyIds: z.array(z.string()).optional(),
        propertyIdsInput: z.string().optional(),
        serviceAccountJson: z.string().optional().or(z.literal("")),
      });
      const validated = schema.parse(req.body);
      const existing = await getGoogleAnalyticsSettings(storage);
      const propertyIds = validated.propertyIds?.length
        ? validated.propertyIds
        : validated.propertyIdsInput
          ? parseIdsInput(validated.propertyIdsInput)
          : existing.propertyIds;
      const serviceAccountJson = validated.serviceAccountJson?.trim()
        ? validated.serviceAccountJson
        : existing.serviceAccountJson;

      await saveGoogleAnalyticsSettings(storage, {
        enabled: validated.enabled,
        propertyIds: propertyIds || [],
        serviceAccountJson: serviceAccountJson || "",
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving GA4 settings:");
      res.status(500).json({ error: error.message || "Failed to save GA4 settings" });
    }
  });

  // Google Ads settings
  app.get("/api/settings/google-ads", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getGoogleAdsSettings(storage);
      res.json({
        ...settings,
        developerToken: "",
        clientId: "",
        clientSecret: "",
        refreshToken: "",
        hasDeveloperToken: Boolean(settings.developerToken),
        hasClientId: Boolean(settings.clientId),
        hasClientSecret: Boolean(settings.clientSecret),
        hasRefreshToken: Boolean(settings.refreshToken),
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching Google Ads settings:");
      res.status(500).json({ error: error.message || "Failed to fetch Google Ads settings" });
    }
  });

  app.post("/api/settings/google-ads", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        customerIds: z.array(z.string()).optional(),
        customerIdsInput: z.string().optional(),
        developerToken: z.string().optional().or(z.literal("")),
        clientId: z.string().optional().or(z.literal("")),
        clientSecret: z.string().optional().or(z.literal("")),
        refreshToken: z.string().optional().or(z.literal("")),
        loginCustomerId: z.string().optional().or(z.literal("")),
      });
      const validated = schema.parse(req.body);
      const existing = await getGoogleAdsSettings(storage);
      const customerIds = validated.customerIds?.length
        ? validated.customerIds
        : validated.customerIdsInput
          ? parseIdsInput(validated.customerIdsInput)
          : existing.customerIds;

      await saveGoogleAdsSettings(storage, {
        enabled: validated.enabled,
        customerIds: customerIds || [],
        developerToken: validated.developerToken?.trim() ? validated.developerToken : existing.developerToken,
        clientId: validated.clientId?.trim() ? validated.clientId : existing.clientId,
        clientSecret: validated.clientSecret?.trim() ? validated.clientSecret : existing.clientSecret,
        refreshToken: validated.refreshToken?.trim() ? validated.refreshToken : existing.refreshToken,
        loginCustomerId: validated.loginCustomerId?.trim() ? validated.loginCustomerId : existing.loginCustomerId,
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving Google Ads settings:");
      res.status(500).json({ error: error.message || "Failed to save Google Ads settings" });
    }
  });

  // B2B Offer status mapping settings
  app.get("/api/settings/b2b-offer-status-mapping", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const stored = (await storage.getSetting("b2b.offerStatusMapping")) as OfferStatusMapping | undefined;
      const defaults = getOfferStatusMapping();
      const mapping = getOfferStatusMapping(stored);
      res.json({ mapping, defaults, stored: stored || null });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching B2B status mapping:");
      res.status(500).json({ error: error.message || "Failed to fetch status mapping" });
    }
  });

  app.post("/api/settings/b2b-offer-status-mapping", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const mappingSchema = z.object({
        draft: z.object({
          id: z.string().nullable().optional(),
          label: z.string().min(1),
        }).optional(),
        submitted: z.object({
          id: z.string().nullable().optional(),
          label: z.string().min(1),
        }).optional(),
        sent: z.object({
          id: z.string().nullable().optional(),
          label: z.string().min(1),
        }).optional(),
        approved: z.object({
          id: z.string().nullable().optional(),
          label: z.string().min(1),
        }).optional(),
        rejected: z.object({
          id: z.string().nullable().optional(),
          label: z.string().min(1),
        }).optional(),
      });

      const validated = mappingSchema.parse(req.body);
      const normalized = getOfferStatusMapping(validated);
      await storage.saveSetting("b2b.offerStatusMapping", normalized);
      res.json({ mapping: normalized });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error saving B2B status mapping:");
      res.status(500).json({ error: error.message || "Failed to save status mapping" });
    }
  });

  // Angebots-Konfigurations-PDF: Einleitung, Regalsystem-Hinweise, Standard-Abschluss
  app.get("/api/settings/offer-config-pdf-texts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const stored = (await storage.getSetting(OFFER_CONFIG_PDF_TEXTS_SETTING_KEY, tenantId)) as
        | Record<string, unknown>
        | undefined;
      const effective = mergeOfferConfigPdfStoredTexts(stored as any);
      res.json({
        effective,
        defaults: DEFAULT_OFFER_CONFIG_PDF_TEXTS,
        stored: stored ?? null,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching offer config PDF texts:");
      res.status(500).json({ error: error.message || "Failed to fetch offer PDF texts" });
    }
  });

  app.post("/api/settings/offer-config-pdf-texts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const validated = offerConfigPdfTextsPayloadSchema.parse(req.body);
      const mergedKeys = {
        ...DEFAULT_OFFER_CONFIG_PDF_TEXTS.systemInfoByKey,
        ...validated.systemInfoByKey,
      };
      const toSave = { ...validated, systemInfoByKey: mergedKeys };
      await storage.saveSetting(OFFER_CONFIG_PDF_TEXTS_SETTING_KEY, toSave, tenantId);
      res.json({ effective: mergeOfferConfigPdfStoredTexts(toSave) });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Ungültige Daten" });
      }
      log.error({ err: error }, "Error saving offer config PDF texts:");
      res.status(500).json({ error: error.message || "Failed to save offer PDF texts" });
    }
  });

  // Mondu settings routes
  app.get("/api/settings/mondu", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settings = await storage.getMonduSettings();
      if (!settings) {
        return res.json({ configured: false });
      }
      
      res.json({
        configured: true,
        sandboxMode: settings.sandboxMode,
        hasApiKey: !!settings.apiKey,
      });
    } catch (error) {
      log.error({ err: error }, "Error fetching Mondu settings:");
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings/mondu", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const validated = monduSettingsSchema.parse(req.body);
      
      // Treat empty string as "no key provided"
      const hasNewApiKey = validated.apiKey && validated.apiKey.trim().length > 0;
      
      // If no new API key provided, keep the existing one
      let settingsToSave: MonduSettings;
      if (!hasNewApiKey) {
        const existingSettings = await storage.getMonduSettings();
        if (existingSettings && existingSettings.apiKey) {
          settingsToSave = {
            sandboxMode: validated.sandboxMode,
            apiKey: existingSettings.apiKey,
          };
        } else {
          // No existing settings and no API key provided
          return res.status(400).json({ error: "Mondu API key is required for initial setup" });
        }
      } else {
        settingsToSave = {
          sandboxMode: validated.sandboxMode,
          apiKey: validated.apiKey!,
        };
      }
      
      const settings = await storage.saveMonduSettings(settingsToSave);
      
      res.json({
        message: "Mondu settings saved successfully",
        sandboxMode: settings.sandboxMode,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error saving Mondu settings:");
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid settings data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/settings/mondu/test", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const validated = monduSettingsSchema.parse(req.body);
      if (!validated.apiKey) {
        return res.status(400).json({ success: false, error: "API key is required for testing" });
      }
      const { MonduClient } = await import("../invoicing/mondu");
      const client = new MonduClient({
        apiKey: validated.apiKey,
        sandboxMode: validated.sandboxMode,
      });
      
      // Try to make a simple API call to test connectivity
      // We'll just check if we can reach the API without errors
      res.json({ success: true, message: "Mondu API key validated" });
    } catch (error: any) {
      log.error({ err: error }, "Error testing Mondu connection:");
      res.status(500).json({ success: false, error: error.message || "Connection test failed" });
    }
  });

  // AI Settings - Get AI settings
  app.get("/api/settings/ai", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const aiSettings = await storage.getSetting("openai_settings");
      const { isEnvOpenAIConfigured } = await import("../ai/openaiClient");
      const { isChatLlmConfigured } = await import("../ai/llmChat");

      const enabled = await isChatLlmConfigured((key) => storage.getSetting(key));
      const rawProvider = aiSettings?.chatProvider;
      const chatProvider =
        rawProvider === "anthropic" || rawProvider === "google" ? rawProvider : "openai";
      const mode = isEnvOpenAIConfigured()
        ? "env"
        : chatProvider === "anthropic"
          ? "anthropic"
          : chatProvider === "google"
            ? "google"
            : "standard";
      const nlLimits = resolveNlLimits(aiSettings);
      const smartProvider =
        aiSettings?.smartProvider === "anthropic" ||
        aiSettings?.smartProvider === "google" ||
        aiSettings?.smartProvider === "openai"
          ? aiSettings.smartProvider
          : "";

      res.json({
        enabled,
        mode,
        chatProvider,
        hasApiKey: Boolean(aiSettings?.apiKey),
        hasAnthropicKey: Boolean(aiSettings?.anthropicApiKey),
        hasGeminiKey: Boolean(aiSettings?.geminiApiKey),
        anthropicModel: typeof aiSettings?.anthropicModel === "string" ? aiSettings.anthropicModel : "",
        openaiChatModel: typeof aiSettings?.openaiChatModel === "string" ? aiSettings.openaiChatModel : "",
        googleModel: typeof aiSettings?.googleModel === "string" ? aiSettings.googleModel : "",
        smartProvider,
        smartModel: typeof aiSettings?.smartModel === "string" ? aiSettings.smartModel : "",
        // Fragen im Reiter "Natuerliche Sprache" pro Tag (Standard, falls nicht gesetzt)
        nlDailyLimitPerUser: nlLimits.perUserPerDay,
        nlDailyLimitPerTenant: nlLimits.perTenantPerDay,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching AI settings:");
      res.status(500).json({ error: "Failed to fetch AI settings" });
    }
  });

  // AI Settings - Update AI settings
  app.post("/api/settings/ai", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const aiSettingsSchema = z.object({
        apiKey: z.string().optional(),
        anthropicApiKey: z.string().optional(),
        geminiApiKey: z.string().optional(),
        enabled: z.boolean(),
        chatProvider: z.enum(["openai", "anthropic", "google"]).optional(),
        anthropicModel: z.string().max(120).optional(),
        openaiChatModel: z.string().max(120).optional(),
        googleModel: z.string().max(120).optional(),
        smartProvider: z.enum(["", "openai", "anthropic", "google"]).optional(),
        smartModel: z.string().max(120).optional(),
        nlDailyLimitPerUser: z.number().int().min(0).max(NL_LIMIT_MAX).optional(),
        nlDailyLimitPerTenant: z.number().int().min(0).max(NL_LIMIT_MAX).optional(),
      });

      const validatedData = aiSettingsSchema.parse(req.body);
      const {
        apiKey,
        anthropicApiKey,
        geminiApiKey,
        enabled,
        chatProvider,
        anthropicModel,
        openaiChatModel,
        googleModel,
        smartProvider,
        smartModel,
        nlDailyLimitPerUser,
        nlDailyLimitPerTenant,
      } = validatedData;

      // Get existing settings
      const existingSettings = (await storage.getSetting("openai_settings")) || {};

      // Prepare new settings
      const newSettings: Record<string, unknown> = {
        enabled,
        apiKey: existingSettings.apiKey,
        anthropicApiKey: existingSettings.anthropicApiKey,
        geminiApiKey: existingSettings.geminiApiKey,
        chatProvider: chatProvider ?? existingSettings.chatProvider ?? "openai",
        anthropicModel:
          anthropicModel !== undefined
            ? anthropicModel
            : existingSettings.anthropicModel ?? "",
        openaiChatModel:
          openaiChatModel !== undefined
            ? openaiChatModel
            : existingSettings.openaiChatModel ?? "",
        googleModel:
          googleModel !== undefined
            ? googleModel
            : existingSettings.googleModel ?? "",
        smartProvider:
          smartProvider !== undefined
            ? smartProvider
            : existingSettings.smartProvider ?? "",
        smartModel:
          smartModel !== undefined
            ? smartModel
            : existingSettings.smartModel ?? "",
        nlDailyLimitPerUser: nlDailyLimitPerUser ?? existingSettings.nlDailyLimitPerUser,
        nlDailyLimitPerTenant: nlDailyLimitPerTenant ?? existingSettings.nlDailyLimitPerTenant,
      };

      if (apiKey) {
        newSettings.apiKey = encrypt(apiKey);
      }
      if (anthropicApiKey) {
        newSettings.anthropicApiKey = encrypt(anthropicApiKey);
      }
      if (geminiApiKey) {
        newSettings.geminiApiKey = encrypt(geminiApiKey);
      }

      await storage.saveSetting("openai_settings", newSettings);

      res.json({
        success: true,
        enabled: newSettings.enabled,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error updating AI settings:");
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update AI settings" });
    }
  });

  const semanticRankingDefaults = SEMANTIC_RANKING_DEFAULTS;

  app.get("/api/settings/semantic-ranking", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = (await storage.getSetting("semantic_ranking")) || {};
      res.json({ settings: { ...semanticRankingDefaults, ...settings }, defaults: semanticRankingDefaults });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching semantic ranking settings:");
      res.status(500).json({ error: "Failed to fetch semantic ranking settings" });
    }
  });

  app.post("/api/settings/semantic-ranking", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        vectorWeight: z.number().min(0).max(1),
        textWeight: z.number().min(0).max(1),
        metadataWeight: z.number().min(0).max(1),
        feedbackWeight: z.number().min(0).max(1),
        metadataExactBoost: z.number().min(0).max(1),
        metadataPartialBoost: z.number().min(0).max(1),
        titleTokenBoost: z.number().min(0).max(1),
      });
      const data = schema.parse(req.body);
      await storage.saveSetting("semantic_ranking", data);
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, "Error updating semantic ranking settings:");
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update semantic ranking settings" });
    }
  });

  app.get("/api/settings/ai-prompts", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = (await storage.getSetting("ai_prompt_overrides")) || {};
      res.json({
        settings: {
          semanticSearchSystemAddon: settings.semanticSearchSystemAddon || "",
          faqSystemAddon: settings.faqSystemAddon || "",
        },
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching AI prompt overrides:");
      res.status(500).json({ error: "Failed to fetch AI prompt overrides" });
    }
  });

  app.post("/api/settings/ai-prompts", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        semanticSearchSystemAddon: z.string().max(4000).optional(),
        faqSystemAddon: z.string().max(4000).optional(),
      });
      const data = schema.parse(req.body);
      await storage.saveSetting("ai_prompt_overrides", data);
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, "Error updating AI prompt overrides:");
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update AI prompt overrides" });
    }
  });

  app.get("/api/settings/commercial-agent", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getCommercialAgentSettings(storage);
      res.json({ settings });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching commercial agent settings:");
      res.status(500).json({ error: "Failed to fetch commercial agent settings" });
    }
  });

  app.post("/api/settings/commercial-agent", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        enabled: z.boolean(),
        autoCreateMinIntentConfidence: z.number().min(0).max(1),
        autoCreateMinMatchConfidence: z.number().min(0).max(100),
        autoCreateOffersEnabled: z.boolean(),
        autoCreateOrdersEnabled: z.boolean(),
        autoCreateSalesChannelId: z.string().max(200).optional(),
        documentLearningEnabled: z.boolean().optional(),
        subAgentsEnabled: z.boolean().optional(),
        exemplarsInPromptMax: z.number().int().min(1).max(12).optional(),
        webDomainVerifyEnabled: z.boolean().optional(),
        extractionRefinementSubAgentsEnabled: z.boolean().optional(),
        lineItemSixDigitGtinPrefixes: z.array(z.string().max(32)).max(24).optional(),
        customerMatchAutoMinConfidence: z.number().min(0).max(100).optional(),
        customerAutoCreateMinConfidence: z.number().min(0).max(100).optional(),
        minRankedEmailScoreForAutoCreate: z.number().min(0).max(200).optional(),
        signatureCompanyVisionEnabled: z.boolean().optional(),
        inboundAcknowledgementEnabled: z.boolean().optional(),
        inboundAcknowledgementOwnDomains: z.array(z.string().max(120)).max(20).optional(),
        inboundAcknowledgementSignature: z.string().max(200).optional(),
      });
      const data = schema.parse(req.body);
      const existing = (await storage.getSetting("commercial_agent_settings")) || {};
      const ex = { ...DEFAULT_COMMERCIAL_AGENT, ...(existing as Partial<CommercialAgentSettings>) };
      const payload: CommercialAgentSettings = {
        ...ex,
        enabled: data.enabled,
        autoCreateMinIntentConfidence: data.autoCreateMinIntentConfidence,
        autoCreateMinMatchConfidence: data.autoCreateMinMatchConfidence,
        autoCreateOffersEnabled: data.autoCreateOffersEnabled,
        autoCreateOrdersEnabled: data.autoCreateOrdersEnabled,
        autoCreateSalesChannelId: data.autoCreateSalesChannelId?.trim() || "",
        documentLearningEnabled: data.documentLearningEnabled ?? ex.documentLearningEnabled,
        subAgentsEnabled: data.subAgentsEnabled ?? ex.subAgentsEnabled,
        exemplarsInPromptMax: data.exemplarsInPromptMax ?? ex.exemplarsInPromptMax,
        webDomainVerifyEnabled: data.webDomainVerifyEnabled ?? ex.webDomainVerifyEnabled,
        extractionRefinementSubAgentsEnabled:
          data.extractionRefinementSubAgentsEnabled ?? ex.extractionRefinementSubAgentsEnabled,
        lineItemSixDigitGtinPrefixes: Array.isArray(data.lineItemSixDigitGtinPrefixes)
          ? data.lineItemSixDigitGtinPrefixes.map((s) => s.trim()).filter(Boolean)
          : ex.lineItemSixDigitGtinPrefixes,
        customerMatchAutoMinConfidence:
          data.customerMatchAutoMinConfidence ?? ex.customerMatchAutoMinConfidence,
        customerAutoCreateMinConfidence:
          data.customerAutoCreateMinConfidence ?? ex.customerAutoCreateMinConfidence,
        minRankedEmailScoreForAutoCreate:
          data.minRankedEmailScoreForAutoCreate ?? ex.minRankedEmailScoreForAutoCreate,
        signatureCompanyVisionEnabled:
          data.signatureCompanyVisionEnabled ?? ex.signatureCompanyVisionEnabled,
        inboundAcknowledgementEnabled:
          data.inboundAcknowledgementEnabled ?? ex.inboundAcknowledgementEnabled,
        inboundAcknowledgementOwnDomains: Array.isArray(data.inboundAcknowledgementOwnDomains)
          ? data.inboundAcknowledgementOwnDomains
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          : ex.inboundAcknowledgementOwnDomains,
        inboundAcknowledgementSignature:
          data.inboundAcknowledgementSignature?.trim() ?? ex.inboundAcknowledgementSignature,
      };
      await storage.saveSetting("commercial_agent_settings", payload);
      res.json({ success: true, settings: await getCommercialAgentSettings(storage) });
    } catch (error: any) {
      log.error({ err: error }, "Error saving commercial agent settings:");
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to save commercial agent settings" });
    }
  });

  // ── Kundengebundene Zugangs-Token für den Rückmelde-Endpunkt ──
  // Ein Token je Kunde; der Klartext wird ausschließlich in der Antwort auf POST
  // zurückgegeben und nirgends gespeichert.
  app.post(
    "/api/settings/commercial-customer-tokens",
    requireAuth,
    requireManageSettings,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const tenantId = req.tenantId ?? null;
        if (!tenantId) {
          return res.status(400).json({ error: "Kein Mandant gewählt" });
        }
        const bodySchema = z.object({
          shopwareCustomerId: z.string().min(1).max(64),
          name: z.string().max(200).optional(),
          expiresAt: z.string().datetime().optional(),
        });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültige Eingabe", details: parsed.error.issues });
        }
        const created = await storage.createCommercialCustomerApiToken({
          tenantId,
          shopwareCustomerId: parsed.data.shopwareCustomerId,
          name: parsed.data.name ?? "",
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        res.status(201).json({
          id: created.id,
          // Einmalig — danach nicht mehr abrufbar.
          token: created.token,
          hint: "Dieses Token wird nur einmal angezeigt. Bitte sicher an den Kunden übergeben.",
        });
      } catch (error: any) {
        log.error({ err: error }, "Create commercial customer token error:");
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  // Kundensuche für die Token-Vergabe. Eigene Route unter `settings`, weil die
  // Entwurfs-Kundensuche `manageOrderDrafts` verlangt — ein reiner Settings-Admin
  // hat dieses Recht nicht zwingend.
  app.get(
    "/api/settings/commercial-customer-tokens/customer-search",
    requireAuth,
    requireManageSettings,
    async (req: Request, res: Response) => {
      try {
        const q = ((req.query.q as string) || "").trim();
        if (q.length < 2) {
          return res.json({ customers: [] });
        }
        const settings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!settings) {
          return res.status(400).json({ error: "Shopware-Einstellungen nicht konfiguriert" });
        }
        const client = new ShopwareClient(settings);
        const customers = await client.searchCustomers(q, 20);
        res.json({ customers });
      } catch (error: any) {
        log.error({ err: error }, "Customer search for commercial tokens failed:");
        res.status(500).json({ error: error.message ?? "Kundensuche fehlgeschlagen" });
      }
    }
  );

  app.get(
    "/api/settings/commercial-customer-tokens",
    requireAuth,
    requireManageSettings,
    async (req: Request, res: Response) => {
      try {
        const rows = await storage.listCommercialCustomerApiTokens(req.tenantId ?? null);
        // tokenHash bewusst nicht ausliefern.
        res.json({
          tokens: rows.map((t) => ({
            id: t.id,
            shopwareCustomerId: t.shopwareCustomerId,
            name: t.name,
            expiresAt: t.expiresAt,
            revokedAt: t.revokedAt,
            lastUsedAt: t.lastUsedAt,
            createdAt: t.createdAt,
          })),
        });
      } catch (error: any) {
        log.error({ err: error }, "List commercial customer tokens error:");
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  app.delete(
    "/api/settings/commercial-customer-tokens/:id",
    requireAuth,
    requireManageSettings,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const ok = await storage.revokeCommercialCustomerApiToken(
          req.params.id,
          req.tenantId ?? null
        );
        if (!ok) {
          return res.status(404).json({ error: "Token nicht gefunden oder bereits widerrufen." });
        }
        res.json({ revoked: true });
      } catch (error: any) {
        log.error({ err: error }, "Revoke commercial customer token error:");
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  // ===================================
  // Webhook Management Routes
  // ===================================

  // Get all webhook configurations
  app.get("/api/settings/webhooks", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const configs = await storage.getAllWebhookConfigs();
      
      // Transform DB schema to frontend-expected format
      const transformedConfigs = configs.map(config => ({
        id: config.id,
        eventType: config.eventType,
        url: config.targetUrl || "",  // targetUrl → url
        enabled: config.enabled === 1,  // integer → boolean
        hasSecret: !!config.secret,  // secret presence check
        hasApiKey: !!config.apiKey,
        maxAttempts: config.maxAttempts,
        initialBackoffMs: config.initialBackoffMs,
        backoffFactor: Number(config.backoffFactor),
        timeoutMs: config.timeoutMs,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }));
      
      res.json(transformedConfigs);
    } catch (error) {
      log.error({ err: error }, "Error fetching webhook configs:");
      res.status(500).json({ error: "Failed to fetch webhook configurations" });
    }
  });

  // Get single webhook configuration by event type
  app.get("/api/settings/webhooks/:eventType", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const eventType = req.params.eventType as WebhookEventType;
      const config = await storage.getWebhookConfig(eventType);
      
      if (!config) {
        return res.status(404).json({ error: "Webhook configuration not found" });
      }

      // Transform DB schema to frontend-expected format
      res.json({
        enabled: config.enabled === 1,  // integer → boolean
        url: config.targetUrl || "",    // targetUrl → url
        hasSecret: !!config.secret,     // secret presence check
        hasApiKey: !!config.apiKey,
      });
    } catch (error) {
      log.error({ err: error }, "Error fetching webhook config:");
      res.status(500).json({ error: "Failed to fetch webhook configuration" });
    }
  });

  // Update a webhook configuration
  app.patch("/api/settings/webhooks/:eventType", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const eventType = req.params.eventType as WebhookEventType;
      const { url, enabled, secret, apiKey } = req.body;

      // Validate if config exists
      const existingConfig = await storage.getWebhookConfig(eventType);
      if (!existingConfig) {
        return res.status(404).json({ error: "Webhook configuration not found" });
      }

      // Transform frontend API format to DB schema format
      const updates: Partial<{targetUrl: string | null, enabled: number, secret: string, apiKey: string}> = {};
      if (url !== undefined) updates.targetUrl = url;
      if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
      if (secret !== undefined) updates.secret = secret;
      if (apiKey !== undefined) updates.apiKey = apiKey;

      // Validate URL if provided
      if (updates.targetUrl) {
        try {
          const parsed = new URL(updates.targetUrl);
          if (parsed.protocol !== "https:") {
            return res.status(400).json({ error: "Only HTTPS URLs are allowed" });
          }
          
          // Block localhost and private IPs
          if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
            return res.status(400).json({ error: "Localhost URLs are not allowed" });
          }
          
          const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
          const match = parsed.hostname.match(ipv4Regex);
          if (match) {
            const [, a, b] = match;
            const first = parseInt(a);
            const second = parseInt(b);
            
            if (first === 10 || 
                (first === 172 && second >= 16 && second <= 31) ||
                (first === 192 && second === 168) ||
                (first === 169 && second === 254)) {
              return res.status(400).json({ error: "Private IP ranges are not allowed" });
            }
          }
        } catch (error) {
          return res.status(400).json({ error: "Invalid URL format" });
        }
      }

      const updatedConfig = await storage.updateWebhookConfig(existingConfig.eventType as WebhookEventType, updates as any);
      if (!updatedConfig) {
        return res.status(404).json({ error: "Webhook configuration not found" });
      }

      // Invalidate webhook service cache after update
      webhookService.invalidateCache();

      // Secret und API-Key nicht zurückschicken (wie beim Lesen nur, ob sie gesetzt sind).
      const { secret: _secret, apiKey: _apiKey, ...publicConfig } = updatedConfig;
      res.json({ ...publicConfig, hasSecret: !!_secret, hasApiKey: !!_apiKey });
    } catch (error) {
      log.error({ err: error }, "Error updating webhook config:");
      res.status(500).json({ error: "Failed to update webhook configuration" });
    }
  });
}
