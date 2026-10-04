import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import bcrypt from "bcryptjs";
import passport from "passport";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { storage } from "./storage";
import { ShopwareClient } from "./shopware/shopware";
import { isOrderEligibleForShippingPick } from "@shared/orderShippingEligibility";
import { parseFakturaRowsFromBuffer, runFakturaImport } from "./invoicing/shopFakturenImport";
import { enrichOrdersWithStockAvailability } from "./erp/orderStockEnrichment";
import { getInvoiceAutomationSettings } from "./invoicing/invoiceSending";
import { insertUserSchema, insertProcessUpdateSchema, type Order, insertShippingCarrierSchema, type WebhookEventType, type TicketCategory } from "@shared/schema";
import { getAISettings } from "./ai/aiConfig";
import { requireAuth, requireAuthOrIntegrationKey, requireCsrf, requireViewDelayedOrders, requireManageUsers, requireManageRoles, requireManageSettings, requireManageCrossSellingRules, requireViewTickets, requireManageTickets, requireViewShipping, requireViewOffers, requireManageOffers, requireViewNaturalLanguageAnalytics, requireManageDocuments, requireViewDocuments, requireViewAnalytics, requireViewAccounting, requireViewCrm, requireViewCPQ, requireManageCPQ, requireManageCPQDiscountLevels, requireApproveCPQQuotes, requireCpqHandoffToken } from "./auth/auth";
import { generateToken } from "./auth/jwt";
import { notificationEvents } from "./lib/events";
import { processNaturalLanguageQuery } from "./analytics/naturalLanguageAnalytics";
import { executeAnalyticsQuery } from "./analytics/analyticsQueryExecutor";
import { generateInsights } from "./analytics/automaticInsights";
import { runSemanticIndex } from "./semantic/semanticIndexer";
import { generateEmbedding } from "./semantic/semanticEmbeddings";
import { generateFaqAnswer } from "./semantic/semanticFaq";
import { webhookService } from "./lib/webhookService";
import { runCrossSellLearning } from "./cross-selling/crossSellLearning";
import { B2BSellersClient, getOfferStatusMapping, type OfferStatusMapping } from "./b2b/b2bSellersClient";
import { runOfferLearning } from "./offers/offerLearning";
import { enrichOrderDueDate, getDunningCandidateForOrder, getDunningCandidates, saveDunningPdfToSystem, sendDunningForOrder, sendDunningForOrderInternal } from "./invoicing/dunningJob";
import { generateDunningPdf } from "./invoicing/dunningPdf";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { objectStorageService } from "./lib/objectStorage";
import { getUploadsRoot } from "./uploadsRoot";
import { getEmailOutboundSettings } from "./email/emailOutbound";
import { getVapidPublicKey } from "./lib/notifications";
import { parseCsv, parsePdf, matchEntries, enrichEntriesWithAI } from "./invoicing/accounting";
import { buildM365AuthUrl, decodeIdToken, exchangeCodeForToken, exchangeDeviceCodeForToken, getM365Settings, startDeviceCode } from "./email/m365Client";
import { fetchAdsKpis, fetchGa4Kpis } from "./analytics/googleKpi";
import { registerCpqRoutes } from "./cpq/cpqRoutes";
import { registerCpqCoreRoutes } from "./cpq-core/cpqCoreRoutes";
import { registerOpenApi } from "./openapi/registerOpenApi";
import { toImportedInquirySummary } from "./commercial/importedInquirySummary";
import { registerPublicOfferRoutes } from "./offers/publicOfferRoutes";
import { registerCommercialAcknowledgementRoutes } from "./commercial/commercialAcknowledgementRoutes";
import { registerB2BAdminRoutes } from "./b2b/b2bAdminRoutes";
import { registerSftpRoutes } from "./sftp/sftpRoutes";
import { registerErpRoutes } from "./erp/erpRoutes";
import { registerErpProductLabelRoutes } from "./erp/erpProductLabels";
import { restoreTenantContext } from "./lib/tenantContext";
import { registerTicketRoutes } from "./routes/ticketRoutes";
import { assignTicketAutomatically, filterTicketsBySalesChannels, getSalesChannelFilter, uploadRateLimiter, filterOrdersBySalesChannels, getOrdersWithCache, defaultDunningSettings } from "./routes/routeHelpers";
import { registerCrmRoutes } from "./routes/crmRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerOrderRoutes } from "./routes/orderRoutes";
import { generateCrossSellStaging } from "./cross-selling/crossSellService";
import { registerCrossSellingRoutes } from "./routes/crossSellingRoutes";
import { registerProductRoutes } from "./routes/productRoutes";
import { registerDraftRoutes } from "./routes/draftRoutes";
import { registerOfferRoutes } from "./routes/offerRoutes";

// Rate limiter for login endpoint - prevents brute force attacks
const loginRateLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  skip: () => process.env.DISABLE_LOGIN_RATE_LIMIT === "true",
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});

// Rate limiter for the hidden emergency password reset - stricter than login,
// failed attempts count (skipSuccessfulRequests would let an attacker probe the key)
const emergencyResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Zu viele Versuche. Bitte später erneut versuchen." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiters for expensive endpoints
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const semanticRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Sales Channel Filter Helper - ensures users only see data from their assigned sales channels
// SECURITY: This is the ONLY source of truth for sales channel access control
// Returns: string[] for restricted users, null for admins with full access
// Throws: Error if user context is missing (should never happen after requireAuth)

function normalizeStoredSalesChannelIds(ids?: string[] | null): string[] | null {
  if (!ids?.length) return null;
  return ids;
}

/** Neuen User dem Mandanten des Erstellers zuweisen (oder Live / ersten verfügbaren). */
async function assignNewUserToTenant(req: Request, userId: string): Promise<string | null> {
  let tenantId: string | null = (req as any).tenantId ?? null;

  if (!tenantId) {
    const creatorTenants = await storage.getTenantsForUser((req.user as any).id);
    const live = creatorTenants.find((t) => t.name === "Live");
    tenantId = live?.id ?? creatorTenants[0]?.id ?? null;
  }

  if (!tenantId) {
    const allTenants = await storage.getAllTenants();
    const live = allTenants.find((t) => t.name === "Live");
    tenantId = live?.id ?? allTenants[0]?.id ?? null;
  }

  if (!tenantId) return null;

  try {
    await storage.addUserToTenant({ tenantId, userId });
  } catch (error) {
    console.warn(`[assignNewUserToTenant] skipped for user ${userId}:`, error);
  }

  return tenantId;
}

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

export async function registerRoutes(app: Express): Promise<Server> {
  registerOpenApi(app, requireAuth);

  // Authentication routes
  app.post("/api/auth/login", loginRateLimiter, (req, res, next) => {
    console.log('[LOGIN] Login request received', { username: req.body?.username });
    passport.authenticate("local", (err: any, user: any, info: any) => {
      console.log('[LOGIN] Passport authenticate callback', { err: !!err, user: !!user, info });
      if (err) {
        console.error('[LOGIN] Authentication error:', err);
        return res.status(500).json({ error: "Internal server error" });
      }
      
      if (!user) {
        console.log('[LOGIN] No user found, invalid credentials');
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      
      console.log('[LOGIN] User authenticated successfully, generating tokens');
      // Generate JWT token
      const token = generateToken(user);
      
      // Generate CSRF token for Double-Submit Cookie Pattern
      const csrfToken = crypto.randomBytes(32).toString('hex');
      
      // Set JWT token in httpOnly cookie (XSS-safe)
      // Safari 16.4+ Bug: SameSite=Lax cookies are not sent with fetch requests (WebKit #255524).
      // Workaround: Use SameSite=None with Secure for HTTPS - Safari sends these correctly.
      const isSecureRequest =
        req.secure || req.headers["x-forwarded-proto"] === "https";
      const cookieSameSite = isSecureRequest ? ("none" as const) : ("lax" as const);
      res.cookie('auth_token', token, {
        httpOnly: true,  // Cannot be accessed by JavaScript
        secure: isSecureRequest,
        sameSite: cookieSameSite,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/' // Explicitly set path
      });
      
      // Set CSRF token in non-httpOnly cookie (frontend can read it)
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false, // Frontend must read and send in X-CSRF-Token header
        secure: isSecureRequest,
        sameSite: cookieSameSite,
        maxAge: 24 * 60 * 60 * 1000,
        path: '/' // Explicitly set path
      });
      
      // Don't send password to client
      const { password, ...userWithoutPassword } = user;
      
      return res.json({ 
        user: userWithoutPassword
        // Token is now in cookie, not in response body
      });
    })(req, res, next);
  });
  
  app.post("/api/auth/logout", (req, res) => {
    // Must match cookie options used at login for clearCookie to work
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    const sameSite = isSecure ? ("none" as const) : ("lax" as const);
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: isSecure,
      sameSite,
      path: '/'
    });
    res.clearCookie('csrf_token', {
      httpOnly: false,
      secure: isSecure,
      sameSite,
      path: '/'
    });
    res.json({ message: "Logged out successfully" });
  });

  // Versteckter Notfall-Passwort-Reset (Login-Seite: Ctrl+Shift+Alt+R).
  // Nur aktiv, wenn ADMIN_RESET_KEY in der Umgebung gesetzt ist — ohne Key
  // antwortet der Endpoint identisch zu "falscher Schlüssel", damit seine
  // Existenz von außen nicht erkennbar ist.
  app.post("/api/auth/emergency-reset", emergencyResetRateLimiter, async (req, res) => {
    const denied = () => res.status(403).json({ error: "Reset nicht möglich" });
    try {
      const configuredKey = process.env.ADMIN_RESET_KEY?.trim();
      const { username, resetKey, newPassword } = req.body ?? {};
      if (
        typeof username !== "string" ||
        typeof resetKey !== "string" ||
        typeof newPassword !== "string"
      ) {
        return denied();
      }
      if (!configuredKey) {
        console.warn("[EMERGENCY-RESET] Versuch, aber ADMIN_RESET_KEY ist nicht gesetzt");
        return denied();
      }
      // Timing-sicherer Vergleich über SHA-256 (gleiche Länge unabhängig von der Eingabe)
      const providedHash = crypto.createHash("sha256").update(resetKey, "utf8").digest();
      const configuredHash = crypto.createHash("sha256").update(configuredKey, "utf8").digest();
      if (!crypto.timingSafeEqual(providedHash, configuredHash)) {
        console.warn(`[EMERGENCY-RESET] Ungültiger Reset-Schlüssel (username=${username})`);
        return denied();
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Neues Passwort muss mindestens 8 Zeichen haben" });
      }
      const user = await storage.getUserByUsername(username.trim());
      if (!user) {
        // Schlüssel war korrekt — hier darf die Meldung konkret sein
        return res.status(404).json({ error: "Benutzer nicht gefunden" });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashedPassword });
      console.log(`[EMERGENCY-RESET] Passwort für "${user.username}" wurde zurückgesetzt`);
      return res.json({ message: "Passwort zurückgesetzt" });
    } catch (error) {
      console.error("[EMERGENCY-RESET] Error:", error);
      return res.status(500).json({ error: "Reset fehlgeschlagen" });
    }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    // req.user is set by requireAuth middleware
    const { password, roleDetails, ...userWithoutPassword } = req.user as any;
    res.json({ 
      user: {
        ...userWithoutPassword,
        permissions: roleDetails?.permissions || {}
      }
    });
  });

  app.get("/api/tenants", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const tenants = await storage.getTenantsForUser(user.id);
      res.json({
        tenants,
        activeTenantId: user.activeTenantId ?? null,
      });
    } catch (error: any) {
      console.error("Error fetching tenants:", error);
      res.status(500).json({ error: error.message || "Failed to fetch tenants" });
    }
  });

  app.post("/api/tenants/select", requireAuth, requireCsrf, async (req, res) => {
    try {
      const schema = z.object({
        tenantId: z.string().min(1).nullable(),
      });
      const { tenantId } = schema.parse(req.body);
      const user = req.user as any;

      if (tenantId) {
        const tenants = await storage.getTenantsForUser(user.id);
        const isAssigned = tenants.some((tenant) => tenant.id === tenantId);
        if (!isAssigned) {
          return res.status(403).json({ error: "Tenant not assigned" });
        }
      }

      const updated = await storage.updateUser(user.id, { activeTenantId: tenantId });
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ activeTenantId: updated.activeTenantId ?? null });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error selecting tenant:", error);
      res.status(500).json({ error: error.message || "Failed to select tenant" });
    }
  });

  /** Neuen Mandanten anlegen (manageSettings). Ersteller wird zugewiesen und standardmäßig aktiv gesetzt. */
  app.post("/api/tenants", requireAuth, requireCsrf, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().trim().min(1, "Name required").max(120),
        setActive: z.boolean().optional(),
      });
      const { name, setActive } = schema.parse(req.body);
      const user = req.user as any;

      const existing = await storage.getTenantByName(name);
      if (existing) {
        return res.status(409).json({ error: "Tenant name already exists" });
      }

      const tenant = await storage.createTenant({ name });
      try {
        await storage.addUserToTenant({ tenantId: tenant.id, userId: user.id });
      } catch (assignErr) {
        console.warn(`[POST /api/tenants] assign creator failed:`, assignErr);
      }

      let activeTenantId = user.activeTenantId ?? null;
      if (setActive !== false) {
        const updated = await storage.updateUser(user.id, { activeTenantId: tenant.id });
        activeTenantId = updated?.activeTenantId ?? tenant.id;
        (req.user as any).activeTenantId = activeTenantId;
      }

      res.status(201).json({ tenant, activeTenantId });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error creating tenant:", error);
      res.status(500).json({ error: error.message || "Failed to create tenant" });
    }
  });
  
  // CPQ (Configure, Price, Quote) routes
  // requireAuthOrIntegrationKey statt requireAuth: requireAuthOrIntegrationKey faellt ohne
  // Integration-Key-Header transparent auf requireAuth zurueck (kein Verhaltensunterschied fuer
  // bestehende Session-Aufrufe) und erlaubt zusaetzlich Automatisierungs-Clients (z. B. META
  // Agents metaorder-Connector) den Zugriff — die eigentliche Rechteprüfung (requireViewCPQ/
  // requireManageCPQ) greift unveraendert danach.
  registerCpqRoutes(app, { requireAuth: requireAuthOrIntegrationKey, requireViewCPQ, requireManageCPQ, requireManageCPQDiscountLevels, requireApproveCPQQuotes });
  registerCpqCoreRoutes(app, { requireAuth: requireAuthOrIntegrationKey, requireViewCPQ, requireManageCPQ });

  // ERP-Kernmodule (Warenwirtschaft, Einkauf, Retouren, Fibu, Produktion, Versand)
  registerErpRoutes(app);
  registerErpProductLabelRoutes(app);

  // Get JWT token from cookie (for SSE initialization)
  app.get("/api/auth/token", requireAuth, (req, res) => {
    // Read token from cookie and return it for SSE usage
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.status(401).json({ error: "No token found" });
    }
    res.json({ token });
  });

  // Profile management routes
  app.put("/api/profile", requireAuth, requireCsrf, async (req, res) => {
    try {
      const user = req.user as any;
      const updateSchema = z.object({
        email: z.string().email("Invalid email format").optional(),
        username: z.string().min(3, "Username must be at least 3 characters").optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      
      // Check if username is already taken by another user
      if (validated.username && validated.username !== user.username) {
        const existingUser = await storage.getUserByUsername(validated.username);
        if (existingUser && existingUser.id !== user.id) {
          return res.status(400).json({ error: "Username already taken" });
        }
      }
      
      const updatedUser = await storage.updateUser(user.id, validated);
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { password, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.put("/api/profile/password", requireAuth, requireCsrf, async (req, res) => {
    try {
      const user = req.user as any;
      const passwordSchema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(6, "New password must be at least 6 characters"),
        confirmPassword: z.string().min(1, "Password confirmation is required"),
      }).refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
      
      const validated = passwordSchema.parse(req.body);
      
      // Verify current password
      const currentUser = await storage.getUser(user.id);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const isValidPassword = await bcrypt.compare(validated.currentPassword, currentUser.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(validated.newPassword, 10);
      
      // Update password
      await storage.updateUser(user.id, { password: hashedPassword });
      
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error updating password:", error);
      res.status(500).json({ error: "Failed to update password" });
    }
  });

  // Get assignable users (for ticket assignment - requires manageTickets permission)
  app.get("/api/users/assignable", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      
      // Return only id + username for ticket assignment
      const assignableUsers = users.map(({ id, username }) => ({ id, username }));
      
      res.json(assignableUsers);
    } catch (error) {
      console.error("Error fetching assignable users:", error);
      res.status(500).json({ error: "Failed to fetch assignable users" });
    }
  });

  // User management routes (Requires manageUsers permission)
  app.get("/api/users", requireAuth, requireManageUsers, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const roles = await storage.getAllRoles();
      
      const usersWithRoles = users.map(user => {
        const { password, ...userWithoutPassword } = user;
        const role = roles.find(r => r.id === (user as any).roleId);
        return {
          ...userWithoutPassword,
          roleId: (user as any).roleId || null,
          roleName: role?.name || null,
        };
      });
      
      res.json(usersWithRoles);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAuth, requireManageUsers, async (req, res) => {
    try {
      const validated = insertUserSchema.extend({
        roleId: z.string().min(1, "Role is required"),
        salesChannelIds: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
      }).parse(req.body);
      
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      
      const user = await storage.createUser({
        username: validated.username,
        email: validated.email || null,
        password: hashedPassword,
      });
      
      const role = await storage.getRole(validated.roleId);
      if (!role) {
        await storage.deleteUser(user.id);
        return res.status(400).json({ error: "Invalid role ID" });
      }

      const assignedTenantId = await assignNewUserToTenant(req, user.id);
      const userSalesChannelIds = normalizeStoredSalesChannelIds(validated.salesChannelIds);
      
      await storage.updateUser(user.id, {
        role: role.name.toLowerCase() === "administrator" ? "admin" : "employee",
        roleId: validated.roleId,
        salesChannelIds: userSalesChannelIds,
        skills: validated.skills?.length ? validated.skills : null,
        ...(assignedTenantId ? { activeTenantId: assignedTenantId } : {}),
      });
      
      const updatedUser = await storage.getUser(user.id);
      const { password, ...userWithoutPassword } = updatedUser!;
      
      res.json({
        ...userWithoutPassword,
        roleId: validated.roleId,
        roleName: role.name,
      });
    } catch (error: any) {
      console.error("Error creating user:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid user data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.patch("/api/users/:id", requireAuth, requireManageUsers, async (req, res) => {
    try {
      const updateSchema = z.object({
        username: z.string().min(3).optional(),
        email: z.string().email().optional().or(z.literal("")),
        password: z.string().min(6).optional().or(z.literal("")),
        roleId: z.string().optional(),
        salesChannelIds: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      const updates: any = { ...validated };
      
      // Remove empty strings
      if (validated.email === "") {
        delete updates.email;
      }
      
      if (validated.password && validated.password !== "") {
        updates.password = await bcrypt.hash(validated.password, 10);
      } else {
        delete updates.password;
      }
      
      if (validated.roleId) {
        const role = await storage.getRole(validated.roleId);
        if (!role) {
          return res.status(400).json({ error: "Invalid role ID" });
        }
        updates.role = role.name.toLowerCase() === "administrator" ? "admin" : "employee";
      }

      if (validated.salesChannelIds !== undefined) {
        updates.salesChannelIds = normalizeStoredSalesChannelIds(validated.salesChannelIds);
      }
      
      const user = await storage.updateUser(req.params.id, updates);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { password, ...userWithoutPassword } = user;
      const role = validated.roleId ? await storage.getRole(validated.roleId) : null;
      
      res.json({
        ...userWithoutPassword,
        roleId: validated.roleId || (user as any).roleId,
        roleName: role?.name || null,
      });
    } catch (error: any) {
      console.error("Error updating user:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid user data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAuth, requireManageUsers, async (req, res) => {
    try {
      const deleted = await storage.deleteUser(req.params.id);
      
      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Role management routes (Requires manageRoles permission)
  app.get("/api/roles", requireAuth, requireManageRoles, async (req, res) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  app.post("/api/roles", requireAuth, requireManageRoles, async (req, res) => {
    try {
      const roleSchema = z.object({
        name: z.string().min(2),
        salesChannelIds: z.array(z.string()).optional(),
        permissions: z.object({
          viewOrders: z.boolean(),
          editOrders: z.boolean(),
          exportData: z.boolean(),
          viewAnalytics: z.boolean(),
          viewDelayedOrders: z.boolean(),
          manageUsers: z.boolean(),
          manageRoles: z.boolean(),
          manageSettings: z.boolean(),
          manageCrossSellingGroups: z.boolean(),
          manageCrossSellingRules: z.boolean(),
          viewTickets: z.boolean(),
          manageTickets: z.boolean(),
          viewShipping: z.boolean(),
          manageAutomations: z.boolean(),
          manageOrderDrafts: z.boolean(),
          viewOffers: z.boolean(),
          manageOffers: z.boolean(),
          viewNaturalLanguageAnalytics: z.boolean(),
          viewDocuments: z.boolean(),
          manageDocuments: z.boolean(),
          manageProducts: z.boolean(),
          viewAccounting: z.boolean(),
          viewCrm: z.boolean(),
          manageCrm: z.boolean(),
          approveCrm: z.boolean(),
          viewCPQ: z.boolean(),
          manageCPQ: z.boolean(),
          manageCPQDiscountLevels: z.boolean(),
          approveCPQQuotes: z.boolean(),
          viewB2B: z.boolean(),
          manageB2B: z.boolean(),
          approveB2BBudgets: z.boolean(),
          manageAccounting: z.boolean(),
          viewInventory: z.boolean(),
          manageInventory: z.boolean(),
          viewPurchasing: z.boolean(),
          managePurchasing: z.boolean(),
          viewReturns: z.boolean(),
          manageReturns: z.boolean(),
          viewProduction: z.boolean(),
          manageProduction: z.boolean(),
          manageShippingLabels: z.boolean(),
        }),
      });
      
      const validated = roleSchema.parse(req.body);
      const role = await storage.createRole({
        ...validated,
        salesChannelIds: validated.salesChannelIds || null,
      });
      
      res.json(role);
    } catch (error: any) {
      console.error("Error creating role:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid role data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create role" });
    }
  });

  app.patch("/api/roles/:id", requireAuth, requireManageRoles, async (req, res) => {
    try {
      const roleSchema = z.object({
        name: z.string().min(2).optional(),
        salesChannelIds: z.array(z.string()).optional(),
        permissions: z.object({
          viewOrders: z.boolean(),
          editOrders: z.boolean(),
          exportData: z.boolean(),
          viewAnalytics: z.boolean(),
          viewDelayedOrders: z.boolean(),
          manageUsers: z.boolean(),
          manageRoles: z.boolean(),
          manageSettings: z.boolean(),
          manageCrossSellingGroups: z.boolean(),
          manageCrossSellingRules: z.boolean(),
          viewTickets: z.boolean(),
          manageTickets: z.boolean(),
          viewShipping: z.boolean(),
          manageAutomations: z.boolean(),
          manageOrderDrafts: z.boolean(),
          viewOffers: z.boolean(),
          manageOffers: z.boolean(),
          viewNaturalLanguageAnalytics: z.boolean(),
          viewDocuments: z.boolean(),
          manageDocuments: z.boolean(),
          manageProducts: z.boolean(),
          viewAccounting: z.boolean(),
          viewCrm: z.boolean(),
          manageCrm: z.boolean(),
          approveCrm: z.boolean(),
          viewCPQ: z.boolean(),
          manageCPQ: z.boolean(),
          manageCPQDiscountLevels: z.boolean(),
          approveCPQQuotes: z.boolean(),
          viewB2B: z.boolean(),
          manageB2B: z.boolean(),
          approveB2BBudgets: z.boolean(),
          manageAccounting: z.boolean(),
          viewInventory: z.boolean(),
          manageInventory: z.boolean(),
          viewPurchasing: z.boolean(),
          managePurchasing: z.boolean(),
          viewReturns: z.boolean(),
          manageReturns: z.boolean(),
          viewProduction: z.boolean(),
          manageProduction: z.boolean(),
          manageShippingLabels: z.boolean(),
        }).optional(),
      });
      
      const validated = roleSchema.parse(req.body);
      const role = await storage.updateRole(req.params.id, validated);
      
      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }
      
      res.json(role);
    } catch (error: any) {
      console.error("Error updating role:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid role data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  app.delete("/api/roles/:id", requireAuth, requireManageRoles, async (req, res) => {
    try {
      const deleted = await storage.deleteRole(req.params.id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Role not found" });
      }
      
      res.json({ message: "Role deleted successfully" });
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(500).json({ error: "Failed to delete role" });
    }
  });

  // Einstellungen (Shopware, Mondu, E-Mail, KI, Nummernkreise, Mahnwesen, ...)
  registerSettingsRoutes(app);

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

  // Lightweight status endpoint for UI toggles
  app.get("/api/email/outbound-status", requireAuth, requireViewTickets, async (_req, res) => {
    try {
      const { settings } = await getEmailOutboundSettings(storage);
      res.json({ enabled: settings.enabled });
    } catch (error: any) {
      console.error("Error fetching outbound status:", error);
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
      console.error("Error fetching M365 connections:", error);
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
      console.error("Error deleting M365 connection:", error);
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
      console.error("Error starting M365 auth:", error);
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
      console.error("Error starting M365 device code flow:", error);
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
      console.error("Error polling M365 device code:", error);
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
      console.error("Error handling M365 callback:", error);
      res.status(500).json({ error: error.message || "Failed to complete M365 auth" });
    }
  });

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
      console.error("Error fetching GA4 KPIs:", error);
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
      console.error("Error fetching Google Ads KPIs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch Google Ads KPIs" });
    }
  });

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

  // Bestellungen inkl. Dokumente, Rechnungen, Versand, Mondu und Teilzahlungsplaene
  registerOrderRoutes(app);

  // Shipping Dashboard - Get orders ready for shipping with equipment flags
  app.get("/api/shipping", requireAuth, requireViewShipping, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allOrders = await client.fetchOrders();

      // Filter: paid/authorized und noch offen (open oder in_progress).
      // open inkl. — Shopware belässt bezahlte Aufträge oft auf open bis „In Bearbeitung“.
      const shippingOrders = allOrders.filter((order: Order) =>
        isOrderEligibleForShippingPick(order),
      );

      const tenantId = (req as any).tenantId ?? null;
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

  // AI Text Improvement
  app.post("/api/ai/improve-text", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const textSchema = z.object({
        text: z.string().min(1, "Text is required"),
      });

      const validatedData = textSchema.parse(req.body);
      const { text } = validatedData;

      const { chatCompletion } = await import("./ai/llmChat");
      let improvedText: string;
      try {
        improvedText = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Verbessere diesen Kundenservice-Text. Mache ihn freundlicher und professioneller, aber halte die Kernaussage bei. Antworte nur mit dem verbesserten Text, ohne Erklärungen.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 500,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      res.json({ improvedText: improvedText?.trim() ? improvedText : text });
    } catch (error: any) {
      console.error("Error improving text with AI:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to improve text" });
    }
  });

  // AI Sentiment Analysis
  app.post("/api/ai/analyze-sentiment", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const sentimentSchema = z.object({
        text: z.string().min(1, "Text is required"),
      });

      const validatedData = sentimentSchema.parse(req.body);
      const { text } = validatedData;

      const { chatCompletion } = await import("./ai/llmChat");
      let sentimentRaw: string;
      try {
        sentimentRaw = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Analysiere den Sentiment dieses Kundenservice-Textes. Antworte NUR mit einem einzigen Wort: 'positive', 'negative', oder 'neutral'.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 10,
          temperature: 0.3,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      const sentiment = sentimentRaw?.toLowerCase().trim() || "neutral";
      
      // Validate sentiment response
      const validSentiments = ["positive", "negative", "neutral"];
      const finalSentiment = validSentiments.includes(sentiment) ? sentiment : "neutral";

      res.json({ sentiment: finalSentiment });
    } catch (error: any) {
      console.error("Error analyzing sentiment:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to analyze sentiment" });
    }
  });

  // AI Category and Tag Suggestions
  app.post("/api/ai/suggest-categories", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const categorySchema = z.object({
        title: z.string(),
        description: z.string(),
      });

      const validatedData = categorySchema.parse(req.body);
      const { title, description } = validatedData;

      const { chatCompletion, parseLlmJsonResponse } = await import("./ai/llmChat");
      let categoryJson: string;
      try {
        categoryJson = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Analysiere dieses Kundenservice-Ticket und schlage eine Kategorie und passende Tags vor.

Verfügbare Kategorien:
- general (Allgemeine Anfrage)
- order_issue (Bestellproblem)
- product_inquiry (Produktanfrage)
- technical_support (Technischer Support)
- complaint (Beschwerde)
- feature_request (Feature-Wunsch)
- other (Sonstiges)

Antworte im JSON-Format:
{
  "category": "eine_der_verfügbaren_kategorien",
  "tags": ["tag1", "tag2", "tag3"]
}

Die Tags sollten spezifisch und relevant sein (z.B. "Versand", "Zahlung", "Reklamation", "Dringend").`,
            },
            {
              role: "user",
              content: `Titel: ${title}\n\nBeschreibung: ${description}`,
            },
          ],
          max_tokens: 150,
          temperature: 0.5,
          response_json: true,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      const result = parseLlmJsonResponse(categoryJson) as Record<string, unknown>;
      
      res.json({
        category: result.category || "general",
        tags: result.tags || []
      });
    } catch (error: any) {
      console.error("Error suggesting categories:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to suggest categories" });
    }
  });

  // AI Smart Reply Generator
  app.post("/api/ai/generate-replies", requireAuth, aiRateLimiter, async (req, res) => {
    try {
      const replySchema = z.object({
        title: z.string(),
        description: z.string(),
        category: z.string().optional(),
      });

      const validatedData = replySchema.parse(req.body);
      const { title, description, category } = validatedData;

      const { chatCompletion, parseLlmJsonResponse: parseRepliesJson } = await import("./ai/llmChat");
      let repliesJson: string;
      try {
        repliesJson = await chatCompletion((key) => storage.getSetting(key), {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Du bist ein professioneller Kundenservice-Mitarbeiter. Generiere 3 verschiedene, hilfreiche Antwort-Vorschläge für dieses Ticket.

Die Antworten sollten:
- Freundlich und professionell sein
- Konkret auf das Problem eingehen
- Lösungsansätze anbieten
- In deutscher Sprache verfasst sein

Antworte im JSON-Format:
{
  "replies": [
    "Erste Antwort...",
    "Zweite Antwort...",
    "Dritte Antwort..."
  ]
}`,
            },
            {
              role: "user",
              content: `Kategorie: ${category || "Allgemein"}\nTitel: ${title}\n\nBeschreibung: ${description}`,
            },
          ],
          max_tokens: 800,
          temperature: 0.7,
          response_json: true,
        });
      } catch {
        return res.status(400).json({ error: "AI features are not enabled" });
      }

      const result = parseRepliesJson(repliesJson) as Record<string, unknown>;
      
      res.json({
        replies: result.replies || []
      });
    } catch (error: any) {
      console.error("Error generating replies:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to generate replies" });
    }
  });

  // KI-Entwuerfe: Upload, Bestell-/Angebotsentwuerfe, Commercial Agent
  registerDraftRoutes(app);

  // Produkte inkl. Imports, Shopware-Cross-Selling, Produktcache und Bundles
  registerProductRoutes(app);

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

  app.post("/api/semantic/index", requireAuth, requireManageSettings, semanticRateLimiter, async (req, res) => {
    try {
      const { sources, useOpenAI } = req.body || {};
      const result = await runSemanticIndex(storage, {
        sources: Array.isArray(sources) ? sources : undefined,
        preferOpenAI: Boolean(useOpenAI),
      });
      res.json({ indexed: result });
    } catch (error: any) {
      console.error("[SemanticIndex] Error:", error);
      res.status(500).json({ error: error.message || "Semantic indexing failed" });
    }
  });

  app.post("/api/semantic/search", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const { query, limit = 10, sourceTypes, useOpenAI } = req.body || {};
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }
      const tenantId = (req as any).tenantId ?? null;
      const { embedding } = await generateEmbedding(query, storage, {
        preferOpenAI: Boolean(useOpenAI),
      });
      const results = await storage.searchSemanticDocuments(embedding, {
        limit: Number(limit) || 10,
        sourceTypes: Array.isArray(sourceTypes) ? sourceTypes : undefined,
        query,
      }, tenantId);
      const sanitized = results.map(({ embedding, embeddingProvider, embeddingModel, contentHash, ...rest }) => rest);
      res.json({ results: sanitized });
    } catch (error: any) {
      console.error("[SemanticSearch] Error:", error);
      res.status(500).json({ error: error.message || "Semantic search failed" });
    }
  });

  app.post("/api/semantic/faq", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const { query, limit = 6, sourceTypes, useOpenAI, language } = req.body || {};
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }
      const tenantId = (req as any).tenantId ?? null;
      const { embedding } = await generateEmbedding(query, storage, {
        preferOpenAI: Boolean(useOpenAI),
      });
      const results = await storage.searchSemanticDocuments(embedding, {
        limit: Number(limit) || 6,
        sourceTypes: Array.isArray(sourceTypes) ? sourceTypes : undefined,
        query,
      }, tenantId);
      const normalizedResults = results.map((entry) => ({
        ...entry,
        metadata: entry.metadata ?? undefined,
      }));
      const faqAnswer = await generateFaqAnswer(storage, query, normalizedResults, {
        preferOpenAI: Boolean(useOpenAI),
        language: language === "en" || language === "es" ? language : "de",
      });
      res.json(faqAnswer);
    } catch (error: any) {
      console.error("[SemanticFAQ] Error:", error);
      res.status(500).json({ error: error.message || "Semantic FAQ failed" });
    }
  });

  app.post("/api/semantic/faq/feedback", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const schema = z.object({
        query: z.string().min(1),
        helpful: z.boolean(),
        sourceIds: z.array(z.string()).optional(),
      });
      const data = schema.parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const existing = (await storage.getSetting("semantic_faq_feedback", tenantId)) || [];
      const entry = {
        query: data.query,
        helpful: data.helpful,
        sourceIds: data.sourceIds || [],
        userId: (req.user as any)?.id || null,
        createdAt: new Date().toISOString(),
      };
      const next = Array.isArray(existing) ? [...existing, entry].slice(-500) : [entry];
      await storage.saveSetting("semantic_faq_feedback", next, tenantId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[SemanticFAQ] Feedback error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Semantic FAQ feedback failed" });
    }
  });

  app.post("/api/semantic/search/feedback", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const schema = z.object({
        query: z.string().min(1),
        sourceType: z.string().min(1),
        sourceId: z.string().min(1),
        action: z.enum(["open", "like", "dislike"]).optional(),
      });
      const data = schema.parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const existing = (await storage.getSetting("semantic_search_feedback", tenantId)) || [];
      const entry = {
        query: data.query,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        action: data.action || "open",
        userId: (req.user as any)?.id || null,
        createdAt: new Date().toISOString(),
      };
      const next = Array.isArray(existing) ? [...existing, entry].slice(-1000) : [entry];
      await storage.saveSetting("semantic_search_feedback", next, tenantId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[SemanticSearch] Feedback error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Semantic search feedback failed" });
    }
  });

  app.post("/api/semantic/similar", requireAuth, semanticRateLimiter, async (req, res) => {
    try {
      const { sourceType, sourceId, limit = 10 } = req.body || {};
      if (!sourceType || !sourceId) {
        return res.status(400).json({ error: "sourceType and sourceId are required" });
      }
      const tenantId = (req as any).tenantId ?? null;
      const embedding = await storage.getSemanticDocumentEmbedding(sourceType, sourceId);
      if (!embedding) {
        return res.status(404).json({ error: "Source document not indexed" });
      }
      const results = await storage.searchSemanticDocuments(embedding, {
        limit: Number(limit) || 10,
      }, tenantId);
      const sanitized = results.map(({ embedding, embeddingProvider, embeddingModel, contentHash, ...rest }) => rest);
      res.json({
        results: sanitized.filter((entry) => !(entry.sourceType === sourceType && entry.sourceId === sourceId)),
      });
    } catch (error: any) {
      console.error("[SemanticSimilar] Error:", error);
      res.status(500).json({ error: error.message || "Semantic similar search failed" });
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

  // Cross-Selling: Vorschlaege, Staging, Analytics, Regeln
  registerCrossSellingRoutes(app);

  // AI-generated cross-selling rules
  app.get("/api/ai/cross-selling/rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const rules = await storage.getAiCrossSellRules(req.tenantId ?? null);
      console.log("[CrossSellLearning] GET /rules", {
        tenantId: req.tenantId ?? null,
        rules: rules.length,
      });
      // #endregion
      res.json({ rules });
    } catch (error: any) {
      console.error("Error fetching AI cross-selling rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI rules" });
    }
  });

  app.get("/api/ai/cross-selling/insights", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const insights = await storage.getAiInsights(req.tenantId ?? null);
      res.json({ insights });
    } catch (error: any) {
      console.error("Error fetching cross-selling AI insights:", error);
      res.status(500).json({ error: error.message || "Failed to fetch insights" });
    }
  });

  app.get("/api/ai/cross-selling/recommendations", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const productNumber = (req.query.productNumber as string) || undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const recommendations = await storage.getAiRecommendations(productNumber, limit, req.tenantId ?? null);
      res.json({ recommendations });
    } catch (error: any) {
      console.error("Error fetching AI recommendations:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI recommendations" });
    }
  });

  app.get("/api/ai/insights", requireAuth, requireViewAnalytics, async (req, res) => {
    try {
      const insights = await storage.getAiInsights(req.tenantId ?? null);
      res.json({ insights });
    } catch (error: any) {
      console.error("Error fetching AI insights:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI insights" });
    }
  });

  app.get("/api/ai/cross-selling/status", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const status = await storage.getSetting("cross_sell_learning_status", req.tenantId ?? null);
      res.json(status || { status: "idle" });
    } catch (error: any) {
      console.error("Error fetching learning status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch status" });
    }
  });

  app.post("/api/ai/cross-selling/run", requireAuth, requireManageCrossSellingRules, aiRateLimiter, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      console.log("[CrossSellLearning] POST /run", {
        tenantId: req.tenantId ?? null,
        userId: (req.user as any)?.id ?? null,
      });
      // #endregion
      const status = await runCrossSellLearning(storage, settings, req.tenantId ?? null);
      let staging: {
        batchId: string;
        rulesCount: number;
        suggestionsCount: number;
        productsWithSuggestions: number;
        productsWithoutSuggestions: number;
      } | null = null;
      try {
        staging = await generateCrossSellStaging(req.tenantId ?? null, (req.user as any)?.id ?? null);
      } catch (stagingError: any) {
        console.warn("[CrossSellLearning] Staging generation failed:", stagingError?.message || stagingError);
      }
      // #endregion
      res.json({ ...status, staging });
    } catch (error: any) {
      console.error("Error running cross-selling learning:", error);
      res.status(500).json({ error: error.message || "Failed to run learning job" });
    }
  });

  // Offer Learning Insights
  app.get("/api/ai/offers/insights", requireAuth, requireViewAnalytics, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const insights = await storage.getOfferLearningInsights(tenantId);
      res.json({ insights });
    } catch (error: any) {
      console.error("Error fetching offer insights:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer insights" });
    }
  });

  app.post("/api/ai/offers/run", requireAuth, requireManageOffers, aiRateLimiter, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const result = await runOfferLearning(storage, settings, tenantId);
      res.json(result);
    } catch (error: any) {
      console.error("Error running offer learning:", error);
      res.status(500).json({ error: error.message || "Failed to run offer learning" });
    }
  });

  // Angebote: Details, PDF/Export, Teilen-Link, Versand, Positionen, Raumplan, Freigabe
  registerOfferRoutes(app);

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

  // Analytics Endpoints
  app.get("/api/analytics/summary", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const salesChannelIds = await getSalesChannelFilter(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

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
        dateFrom,
        dateTo,
      });
    } catch (error: any) {
      console.error("Error fetching analytics summary:", error);
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
      const salesChannelIds = await getSalesChannelFilter(req);

      const limit = 200;
      let page = 1;
      let processed = 0;
      let total = 0;
      let totalScore = 0;

      const bucketCounts = {
        "0-20": 0,
        "21-40": 0,
        "41-60": 0,
        "61-80": 0,
        "81-100": 0,
      };

      const criteriaCount = 13;

      while (true) {
        const result = await client.fetchProductsForDataQuality(limit, page, salesChannelIds ?? undefined);
        total = result.total ?? total;
        if (result.products.length === 0) {
          break;
        }

        for (const product of result.products) {
          let points = 0;

          if (product.productNumber) points += 1;
          if (product.manufacturerNumber) points += 1;
          if (product.ean) points += 1;
          if (product.description) points += 1;
          if (product.propertyCount > 2) points += 1;
          if (product.hasDeliveryTime) points += 1;
          if (product.visibilityCount > 0) points += 1;
          if (product.categoryCount > 0) points += 1;
          if (product.imageCount > 0) points += 1;
          if (product.width) points += 1;
          if (product.height) points += 1;
          if (product.length) points += 1;
          if (product.weight) points += 1;

          const score = Math.round((points / criteriaCount) * 100);
          totalScore += score;
          processed += 1;

          if (score <= 20) bucketCounts["0-20"] += 1;
          else if (score <= 40) bucketCounts["21-40"] += 1;
          else if (score <= 60) bucketCounts["41-60"] += 1;
          else if (score <= 80) bucketCounts["61-80"] += 1;
          else bucketCounts["81-100"] += 1;
        }

        if (result.products.length < limit || processed >= total) {
          break;
        }
        page += 1;
      }

      const averageScore = processed > 0 ? Math.round(totalScore / processed) : 0;

      res.json({
        totalProducts: processed,
        averageScore,
        criteriaCount,
        distribution: [
          { label: "0-20", count: bucketCounts["0-20"] },
          { label: "21-40", count: bucketCounts["21-40"] },
          { label: "41-60", count: bucketCounts["41-60"] },
          { label: "61-80", count: bucketCounts["61-80"] },
          { label: "81-100", count: bucketCounts["81-100"] },
        ],
      });
    } catch (error: any) {
      console.error("Error fetching product data quality:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product data quality" });
    }
  });

  app.get("/api/analytics/order-status", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const salesChannelIds = await getSalesChannelFilter(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

      // Group by order status
      const statusDistribution: Record<string, number> = {};
      orders.forEach(order => {
        statusDistribution[order.status] = (statusDistribution[order.status] || 0) + 1;
      });

      res.json(statusDistribution);
    } catch (error: any) {
      console.error("Error fetching order status distribution:", error);
      res.status(500).json({ error: error.message || "Failed to fetch order status distribution" });
    }
  });

  app.get("/api/analytics/payment-status", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const salesChannelIds = await getSalesChannelFilter(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

      // Group by payment status
      const paymentDistribution: Record<string, number> = {};
      orders.forEach(order => {
        paymentDistribution[order.paymentStatus] = (paymentDistribution[order.paymentStatus] || 0) + 1;
      });

      res.json(paymentDistribution);
    } catch (error: any) {
      console.error("Error fetching payment status distribution:", error);
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
      console.error("Error fetching product overview:", error);
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
      console.error("Error fetching product activity trend:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product activity trend" });
    }
  });

  app.get("/api/analytics/category-sales", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const salesChannelIds = await getSalesChannelFilter(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

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
      console.error("Error fetching category sales:", error);
      res.status(500).json({ error: error.message || "Failed to fetch category sales" });
    }
  });

  app.get("/api/analytics/product-performance", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const salesChannelIds = await getSalesChannelFilter(req);
      
      const minQuantity = parseInt(req.query.minQuantity as string) || 1;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

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
      console.error("Error fetching product performance:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product performance" });
    }
  });

  app.get("/api/analytics/sales-trend", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const salesChannelIds = await getSalesChannelFilter(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

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
      console.error("Error fetching sales trend:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales trend" });
    }
  });

  app.get("/api/analytics/shipping-times", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      const salesChannelIds = await getSalesChannelFilter(req);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds ?? undefined);

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
      console.error("Error fetching shipping times:", error);
      res.status(500).json({ error: error.message || "Failed to fetch shipping times" });
    }
  });

  // ============================================
  // Natural Language Analytics Routes
  // ============================================

  // POST /api/analytics/nl-query - Natural Language Query endpoint
  // Processes natural language questions and returns analytics results with insights
  app.post("/api/analytics/nl-query", requireAuth, requireViewNaturalLanguageAnalytics, async (req, res) => {
    try {
      console.log('[NL Analytics API] Processing natural language query request');
      
      const user = req.user as any;
      const userId = user?.id;
      
      if (!userId) {
        console.error('[NL Analytics API] No user ID found in request');
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Validate request body
      const { question } = req.body;
      
      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        console.error('[NL Analytics API] Invalid or missing question in request body');
        return res.status(400).json({ error: "Invalid question. Please provide a non-empty question string." });
      }

      console.log(`[NL Analytics API] User ${userId} asked: "${question}"`);

      // Step 1: Process natural language query into structured query
      console.log('[NL Analytics API] Step 1: Processing natural language query...');
      let queryObj;
      try {
        queryObj = await processNaturalLanguageQuery(question, userId, storage);
        console.log('[NL Analytics API] Query processed successfully:', JSON.stringify(queryObj, null, 2));
      } catch (error: any) {
        console.error('[NL Analytics API] Error processing natural language query:', error);
        return res.status(400).json({ 
          error: "Failed to understand the question. Please try rephrasing.",
          details: error.message 
        });
      }

      // Step 2: Initialize ShopwareClient from settings
      console.log('[NL Analytics API] Step 2: Initializing Shopware client...');
      const settings = await storage.getShopwareSettings();
      
      if (!settings) {
        console.error('[NL Analytics API] No Shopware settings configured - cannot execute analytics query');
        return res.status(400).json({ 
          error: "Shopware settings not configured. Please configure Shopware API credentials in settings." 
        });
      }
      
      const shopwareClient = new ShopwareClient(settings);
      console.log('[NL Analytics API] Shopware client initialized successfully');

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      console.log('[NL Analytics API] Step 2.5: Getting sales channel filter...');
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
        if (allowedChannelIds) {
          console.log(`[NL Analytics API] SECURITY: User restricted to sales channels:`, allowedChannelIds);
        } else {
          console.log(`[NL Analytics API] SECURITY: Admin access - no sales channel filtering`);
        }
      } catch (error: any) {
        console.error('[NL Analytics API] Error getting sales channel filter:', error);
        return res.status(500).json({ 
          error: "Failed to determine user permissions",
          details: error.message 
        });
      }

      // SECURITY: Remove any user-provided sales channel IDs from AI-extracted parameters
      // Only server-authoritative allowedChannelIds should be used
      if ("salesChannelId" in queryObj.parameters && queryObj.parameters.salesChannelId) {
        console.log(`[NL Analytics API] SECURITY: Stripping user-provided salesChannelId from query parameters`);
        delete (queryObj.parameters as Record<string, unknown>).salesChannelId;
      }
      if ("salesChannelIds" in queryObj.parameters) {
        console.log(`[NL Analytics API] SECURITY: Stripping user-provided salesChannelIds from query parameters`);
        delete (queryObj.parameters as Record<string, unknown>).salesChannelIds;
      }
      
      // Step 3: Execute the analytics query with sales channel filtering
      console.log('[NL Analytics API] Step 3: Executing analytics query...');
      let result;
      try {
        result = await executeAnalyticsQuery(queryObj, storage, shopwareClient, allowedChannelIds);
        console.log('[NL Analytics API] Query executed successfully');
        console.log('[NL Analytics API] Result summary:', JSON.stringify(result.summary, null, 2));
      } catch (error: any) {
        console.error('[NL Analytics API] Error executing analytics query:', error);
        return res.status(500).json({ 
          error: "Failed to execute analytics query",
          details: error.message 
        });
      }

      // Step 4: Generate insights from the results
      console.log('[NL Analytics API] Step 4: Generating insights...');
      let insights: any[] = [];
      try {
        insights = await generateInsights(result, queryObj.type, storage);
        console.log(`[NL Analytics API] Generated ${insights.length} insights`);
      } catch (error: any) {
        console.error('[NL Analytics API] Error generating insights:', error);
        // Don't fail the request if insights generation fails - return empty insights
        insights = [];
        console.log('[NL Analytics API] Continuing with empty insights array');
      }

      // Step 5: Generate improvement suggestions for forecast queries
      const isForecastQuery = ['revenue_forecast', 'product_demand_forecast', 'seasonal_analysis', 'trend_forecast'].includes(queryObj.type);
      let improvements: any[] = [];
      
      if (isForecastQuery) {
        console.log('[NL Analytics API] Step 5: Generating improvement suggestions...');
        try {
          const { generateImprovementSuggestions } = await import('./analytics/improvementSuggestions');
          improvements = await generateImprovementSuggestions(queryObj, result, storage);
          console.log(`[NL Analytics API] Generated ${improvements.length} improvement suggestions`);
        } catch (error: any) {
          console.error('[NL Analytics API] Error generating improvement suggestions:', error);
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
      };

      console.log('[NL Analytics API] Request completed successfully');
      console.log(`[NL Analytics API] Response contains ${result.labels.length} data points, ${insights.length} insights, and ${improvements.length} improvement suggestions`);
      
      res.json(response);
    } catch (error: any) {
      console.error('[NL Analytics API] Unexpected error:', error);
      res.status(500).json({ 
        error: "An unexpected error occurred while processing your request",
        details: error.message 
      });
    }
  });

  // GET /api/analytics/suggested-questions - Pre-defined Example Questions
  // Returns a list of common analytics questions in German for user guidance
  app.get("/api/analytics/suggested-questions", requireAuth, requireViewNaturalLanguageAnalytics, async (req, res) => {
    try {
      console.log('[NL Analytics API] Fetching suggested questions');
      
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

      console.log(`[NL Analytics API] Returning ${suggestedQuestions.length} suggested questions`);
      
      res.json(suggestedQuestions);
    } catch (error: any) {
      console.error('[NL Analytics API] Error fetching suggested questions:', error);
      res.status(500).json({ 
        error: "Failed to fetch suggested questions",
        details: error.message 
      });
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

      const { syncShopwareMirrorForTenant } = await import("./shopware/shopwareMirror");
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

  // ============================================
  // Ticket Attachments Routes
  // ============================================

  // Use memory storage for Object Storage uploads (persistent)
  // Falls back to disk storage if Object Storage is not configured
  const useObjectStorage = objectStorageService.isConfigured();

  // Tickets, Kundenportal, Vorlagen, Zuweisungs-/Automatisierungsregeln, Anhaenge
  registerTicketRoutes(app, { useObjectStorage });
  
  console.log(`[Attachments] Storage mode: ${useObjectStorage ? 'Object Storage (persistent)' : 'Local Disk (non-persistent)'}`);

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
          const { getOpenAIClient } = await import('./ai/openaiClient');
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
      const orders = await client.fetchOrders();
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

  // CRM: Kunden, individuelle Preise, Zuweisungen, Rabattanfragen
  registerCrmRoutes(app);

  // ============================================
  // NOTIFICATIONS
  // ============================================

  // Get user's notifications
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      const notifications = await storage.getNotificationsByUserId(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // Push notification settings (per user)
  app.get("/api/notifications/push-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      const publicKey = getVapidPublicKey();
      res.json({
        enabled: Boolean(user?.pushEnabled),
        subscription: user?.pushSubscription || null,
        publicKey,
      });
    } catch (error) {
      console.error("Error fetching push settings:", error);
      res.status(500).json({ error: "Failed to fetch push settings" });
    }
  });

  app.post("/api/notifications/push-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const schema = z.object({
        enabled: z.boolean(),
        subscription: z.any().optional(),
      });
      const { enabled, subscription } = schema.parse(req.body);
      if (enabled && !subscription) {
        return res.status(400).json({ error: "Subscription required when enabling push" });
      }
      const updated = await storage.updateUser(userId, {
        pushEnabled: enabled,
        pushSubscription: enabled ? subscription : null,
      });
      res.json({ enabled: Boolean(updated?.pushEnabled) });
    } catch (error: any) {
      console.error("Error saving push settings:", error);
      res.status(500).json({ error: error.message || "Failed to save push settings" });
    }
  });

  app.delete("/api/notifications/push-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      await storage.updateUser(userId, { pushEnabled: false, pushSubscription: null });
      res.json({ enabled: false });
    } catch (error) {
      console.error("Error disabling push settings:", error);
      res.status(500).json({ error: "Failed to disable push settings" });
    }
  });

  // Server-Sent Events stream for real-time notifications
  app.get("/api/notifications/stream", async (req: Request, res: Response) => {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify JWT token
    let userId: string;
    try {
      const jwt = await import("./auth/jwt");
      const decoded = jwt.verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ error: "Invalid token" });
      }
      userId = decoded.userId;
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    
    // Create notification listener
    const notificationListener = async ({ notification }: { notification: any }) => {
      // Only send notifications for this user
      if (notification.userId === userId) {
        res.write(`event: notification\n`);
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
      }
    };
    
    // Register listener
    notificationEvents.onNotificationCreated(notificationListener);
    
    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      res.write(`:heartbeat\n\n`);
    }, 30000);
    
    // Cleanup on connection close
    req.on("close", () => {
      clearInterval(heartbeatInterval);
      notificationEvents.removeNotificationCreatedListener(notificationListener);
    });
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req.user as any).id;
      
      // Verify notification belongs to user
      const notification = await storage.getNotificationsByUserId(userId);
      const found = notification.find(n => n.id === id);
      
      if (!found) {
        return res.status(404).json({ error: "Notification not found" });
      }
      
      const updated = await storage.markNotificationAsRead(id);
      res.json(updated);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const count = await storage.markAllNotificationsAsRead(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ error: "Failed to mark all notifications as read" });
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
          const { ShopwareClient } = await import("./shopware/shopware");
          const client = new ShopwareClient(settings);
          const billing = await client.fetchCustomerBillingForPdf(customerId);
          if (billing?.email) {
            const { sendEmail } = await import("./email/emailOutbound");
            await sendEmail(storage, {
              to: billing.email,
              subject: "Ihre Angebotsanfrage bei META",
              text:
                "Vielen Dank für Ihre Konfiguration! Wir haben Ihre Anfrage erhalten und melden uns in Kürze mit einem individuellen Angebot.",
            });
          }
        }
      } catch (mailError) {
        console.warn("[CPQ] Bestätigungsmail für Angebotsanfrage konnte nicht gesendet werden:", mailError);
      }

      res.json({ success: true, offerDraftId: offerDraft.id });
    } catch (error: any) {
      console.error("Error creating public offer request from CPQ:", error);
      res.status(500).json({ error: error.message ?? "Angebotsanfrage konnte nicht erstellt werden" });
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
      console.error("Error fetching my tickets:", error);
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
      console.error("Error fetching ticket comments:", error);
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
      console.error("Error fetching CRM interactions:", error);
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

      // Fetch recent orders (last 10) with channel filter
      const { orders } = await client.fetchOrdersPaginated(10, 0, allowedChannelIds ?? undefined);

      res.json(orders);
    } catch (error) {
      console.error("Error fetching recent orders:", error);
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
      
      const ordersResponse = roleDetails?.permissions?.viewOrders
        ? await client.fetchOrdersPaginated(500, 0, undefined)
        : { orders: [], total: 0 };

      // Filter tickets assigned to current user
      const myTickets = (allTickets || []).filter(t => t.assignedToUserId === user.id);
      const openTickets = myTickets.filter(t => t.status === 'open' || t.status === 'in_progress');
      const highPriorityTickets = myTickets.filter(t => t.priority === 'high' && (t.status === 'open' || t.status === 'in_progress'));

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // SECURITY: Filter orders by user's assigned sales channels (server-enforced)
      const orderItems = ordersResponse?.orders || [];
      const accessibleOrders = filterOrdersBySalesChannels(orderItems, allowedChannelIds);

      // Calculate order statistics
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const ordersToday = accessibleOrders.filter((order: Order) => {
        const orderDate = new Date(order.orderDate);
        orderDate.setHours(0, 0, 0, 0);
        return orderDate.getTime() === today.getTime();
      });

      const openOrders = accessibleOrders.filter((order: Order) => order.status === 'open' || order.status === 'in_progress');

      // Calculate delayed orders (orders older than 7 days that are not completed/cancelled)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const delayedOrders = roleDetails?.permissions?.viewDelayedOrders 
        ? accessibleOrders.filter((order: Order) => {
            const orderDate = new Date(order.orderDate);
            return orderDate < sevenDaysAgo && order.status !== 'completed' && order.status !== 'cancelled';
          })
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
      console.error("Error fetching KPIs:", error);
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
      const ordersResponse = await client.fetchOrdersPaginated(500, 0, undefined);

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // SECURITY: Filter by user's assigned sales channels (server-enforced)
      const orderItems = ordersResponse?.orders || [];
      const accessibleOrders = filterOrdersBySalesChannels(orderItems, allowedChannelIds);

      // Calculate delayed orders
      const today = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const delayedOrders = accessibleOrders.filter((order: Order) => {
        const orderDate = new Date(order.orderDate);
        return orderDate < sevenDaysAgo && order.status !== 'completed' && order.status !== 'cancelled';
      });

      const criticallyDelayed = delayedOrders.filter((order: Order) => {
        const orderDate = new Date(order.orderDate);
        return orderDate < fourteenDaysAgo;
      });

      const summary = {
        total: delayedOrders.length,
        critical: criticallyDelayed.length,
        recentOrders: delayedOrders.slice(0, 5).map((order: Order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          orderDate: order.orderDate,
          totalAmount: order.totalAmount,
          status: order.status,
          daysDelayed: Math.floor((today.getTime() - new Date(order.orderDate).getTime()) / (1000 * 60 * 60 * 24)),
        })),
      };

      res.json(summary);
    } catch (error) {
      console.error("Error fetching delayed orders summary:", error);
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
      const ordersResponse = await client.fetchOrdersPaginated(500, 0, undefined);

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // SECURITY: Filter by user's assigned sales channels (server-enforced)
      const orderItems = ordersResponse?.orders || [];
      const accessibleOrders = filterOrdersBySalesChannels(orderItems, allowedChannelIds);

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
      console.error("Error fetching shipping ready orders:", error);
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
      console.error("Error fetching imported inquiries:", error);
      res.status(500).json({ error: "Failed to fetch imported inquiries" });
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
      console.error("Error fetching webhook logs:", error);
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
      console.error("Error testing webhook:", error);
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
      console.error("[Incoming Webhook] N8N_SERVICE_PASSWORD not configured");
      return false;
    }
    
    // Check timestamp to prevent replay attacks (allow 5 minute window)
    const timestampMs = parseInt(timestamp);
    const now = Date.now();
    if (isNaN(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
      console.warn("[Incoming Webhook] Timestamp outside acceptable window");
      return false;
    }
    
    // Validate signature format (must be valid hex string)
    if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
      console.warn("[Incoming Webhook] Invalid signature format (expected 64 hex characters)");
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
      console.error("[Incoming Webhook] Signature comparison error:", err);
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
        console.warn("[Incoming Webhook] Missing signature or timestamp header");
        return res.status(401).json({ 
          error: "Unauthorized", 
          message: "Missing X-METAorder-Signature or X-METAorder-Timestamp header" 
        });
      }
      
      // Verify HMAC signature using raw body (set by express.json verify option in index.ts)
      const rawBody = (req as any).rawBody as Buffer | undefined;
      if (!rawBody) {
        console.error("[Incoming Webhook] Raw body not available");
        return res.status(500).json({ 
          error: "Internal error", 
          message: "Unable to process request body" 
        });
      }
      
      if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
        console.warn("[Incoming Webhook] Invalid signature");
        return res.status(401).json({ 
          error: "Unauthorized", 
          message: "Invalid webhook signature" 
        });
      }
      
      // Validate payload
      const validationResult = incomingTicketWebhookSchema.safeParse(req.body);
      if (!validationResult.success) {
        console.warn("[Incoming Webhook] Validation failed:", validationResult.error.errors);
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validationResult.error.errors 
        });
      }
      
      const payload = validationResult.data;
      
      // Get or create n8n-service user for ticket creation
      const n8nUser = await storage.getUserByUsername("n8n-service");
      if (!n8nUser) {
        console.error("[Incoming Webhook] n8n-service user not found");
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
            }).catch(err => console.error("Error triggering ticket.assigned webhook:", err));
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
      }).catch(err => console.error("Error triggering ticket.created webhook:", err));
      
      console.log(`[Incoming Webhook] Created ticket ${ticket.ticketNumber} from external source`);
      
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
      console.error("[Incoming Webhook] Error creating ticket:", error);
      res.status(500).json({ 
        error: "Internal server error", 
        message: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  });

  registerPublicOfferRoutes(app);
  registerCommercialAcknowledgementRoutes(app, storage);
  registerB2BAdminRoutes(app, { getSalesChannelFilter });
  registerSftpRoutes(app);

  const httpServer = createServer(app);

  return httpServer;
}
