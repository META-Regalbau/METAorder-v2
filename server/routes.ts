import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import bcrypt from "bcryptjs";
import passport from "passport";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { storage } from "./storage";
import type { IStorage } from "./storage";
import { ShopwareClient, getRealInvoiceDocument, type ShopwareProductOverview } from "./shopware";
import { parseFakturaRowsFromBuffer, runFakturaImport } from "./shopFakturenImport";
import { sendOrderInvoice } from "./invoiceSending";
import { RuleEngine, type SuggestCrossSellingOptions } from "./ruleEngine";
import {
  loadCrossSellShelvingPatternConfig,
  findShelvingSupplements,
  mergeStagingCandidatesWithQuotas,
} from "./crossSellShelvingHeuristics";
import { shopwareSettingsSchema, monduSettingsSchema, proformaNumberRangeSchema, dunningSettingsSchema, type MonduSettings, insertCrossSellingRuleSchema, type Product, insertUserSchema, type Role, insertTicketSchema, insertTicketCommentSchema, insertTicketAssignmentRuleSchema, type Ticket, insertNotificationSchema, insertTicketAttachmentSchema, insertTicketTemplateSchema, insertProcessUpdateSchema, type Order, insertOrderDraftSchema, insertOfferDraftSchema, insertAutomationRuleSchema, insertShippingCarrierSchema, type CrossSellingRule, type RuleCondition, type RuleTargetCriteria, type WebhookEventType, type TicketCategory, insertCustomerInteractionSchema, insertOrderAssignmentSchema, insertDiscountRequestSchema, createInstallmentPlanBodySchema, settlementInvoicePdfBodySchema, additionalInvoiceBodySchema, type InstallmentPlan, type InstallmentInvoice, type CrossSellCooccurrence, type CrossSellEventPairStats, SHOPWARE_CROSS_SELLING_STOREFRONT_NAME, CROSS_SELL_CATEGORIES } from "@shared/schema";
import {
  getAISettings,
  getCommercialAgentSettings,
  DEFAULT_COMMERCIAL_AGENT,
  type CommercialAgentSettings,
} from "./aiConfig";
import { requireAuth, requireAuthOrIntegrationKey, requireCsrf, requireViewDelayedOrders, requireManageUsers, requireManageRoles, requireManageSettings, requireManageCrossSellingGroups, requireManageCrossSellingRules, requireViewTickets, requireManageTickets, requireViewShipping, requireEditOrders, requireManageAutomations, requireManageOrderDrafts, requireManageCommercialDraftUpload, requireViewOffers, requireManageOffers, requireViewNaturalLanguageAnalytics, requireManageDocuments, requireViewDocuments, requireViewAnalytics, requireManageProducts, requireViewAccounting, requireViewCrm, requireManageCrm, requireApproveCrm, requireViewCPQ, requireManageCPQ, requireManageCPQDiscountLevels, requireApproveCPQQuotes } from "./auth";
import { requireCustomerAuth, type CustomerRequest } from "./authCustomer";
import { encrypt, decrypt } from "./encryption";
import * as XLSX from 'xlsx';
import { generateToken } from "./jwt";
import { parseEmailFile } from "./emailParser";
import { notificationEvents } from "./events";
import { processNaturalLanguageQuery } from "./naturalLanguageAnalytics";
import { executeAnalyticsQuery } from "./analyticsQueryExecutor";
import { generateInsights } from "./automaticInsights";
import { executeSemanticProductSearch } from "./semanticProductSearch";
import { runSemanticIndex } from "./semanticIndexer";
import { generateEmbedding } from "./semanticEmbeddings";
import { generateFaqAnswer } from "./semanticFaq";
import { webhookService, type DocumentCreatedPayload } from "./webhookService";
import { getCrossSellLearningSettings, runCrossSellLearning, type LearningSettings } from "./crossSellLearning";
import { hybridWeightsFromLearningSettings, buildCrossSellEventStatsMap } from "./crossSellHybridRanker";
import { B2BSellersClient, getOfferStatusMapping, type OfferStatusMapping } from "./b2bSellersClient";
import { getOfferLearningSettings, runOfferLearning } from "./offerLearning";
import { enrichOrderDueDate, getDunningCandidateForOrder, getDunningCandidates, saveDunningPdfToSystem, sendDunningForOrder, sendDunningForOrderInternal } from "./dunningJob";
import { generateDunningPdf } from "./dunningPdf";
import { generateInstallmentAgreementPdf, type InstallmentAgreementLine } from "./installmentAgreementPdf";
import { generateInstallmentInvoicePdf, type InstallmentInvoicePdfInput } from "./installmentInvoicePdf";
import { generateSettlementInvoicePdf, type SettlementInvoicePdfInput } from "./settlementInvoicePdf";
import { generateAdditionalInvoicePdf } from "./additionalInvoicePdf";
import { applyOfferConfigPdfLayoutFromRequest, generateOfferConfigPdf } from "./offerConfigPdf";
import { buildOfferConfigPdfInputWithCpqFallback } from "./offerConfigPdfCpqFallback";
import { buildPlainOfferPdfInput } from "./offerConfigPdfBuilder";
import {
  buildOfferErpExportModel,
  offerErpExportToCsv,
  offerErpExportToXml,
} from "./offerErpExport";
import {
  enrichOfferConfigPdfInputWithTexts,
  mergeOfferConfigPdfStoredTexts,
  DEFAULT_OFFER_CONFIG_PDF_TEXTS,
  OFFER_CONFIG_PDF_TEXTS_SETTING_KEY,
  offerConfigPdfTextsPayloadSchema,
} from "./offerConfigPdfTexts";
import archiver from "archiver";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { objectStorageService, ObjectNotFoundError } from "./objectStorage";
import { getUploadsRoot } from "./uploadsRoot";
import { getEmailInboundSettings, saveEmailInboundSettings } from "./emailInbound";
import { getEmailOutboundSettings, saveEmailOutboundSettings, sendEmail } from "./emailOutbound";
import { getVapidPublicKey, notifyNewTicket } from "./notifications";
import { parseCsv, parsePdf, matchEntries, enrichEntriesWithAI } from "./accounting";
import { getEmailRoutingSettings, DEFAULT_EMAIL_ROUTING_SETTINGS } from "./emailRouting";
import { buildM365AuthUrl, decodeIdToken, exchangeCodeForToken, exchangeDeviceCodeForToken, getM365Settings, saveM365Settings, startDeviceCode } from "./m365Client";
import { fetchAdsKpis, fetchGa4Kpis, getGoogleAdsSettings, getGoogleAnalyticsSettings, parseIdsInput, saveGoogleAdsSettings, saveGoogleAnalyticsSettings } from "./googleKpi";
import { classifyTicketForRules } from "./ticketAi";
import { registerCpqRoutes } from "./cpq/cpqRoutes";
import { parseObxContent, type ObxArticle, type ObxHeader } from "./obxParser";
import { registerCpqCoreRoutes } from "./cpq-core/cpqCoreRoutes";
import { registerOpenApi } from "./openapi/registerOpenApi";
import { runOfferDraftPipeline, runOrderDraftPipeline } from "./commercialDraftPipeline";
import {
  tryCreateShopwareCustomerFromExtractedData,
  mergeDraftExtractedData,
  resolveEmailForShopwareCustomerCreate,
  type DraftBillingAddressInput,
  type DraftExtractedCustomer,
} from "./draftCustomerEmailResolution";
import { executeCreateOfferFromDraft, executeCreateOrderFromDraft } from "./commercialDraftShopware";
import { resolveOfferSalesChannelId } from "./offerSalesChannelResolver";
import { emitCommercialDraftWebhooks } from "./commercialWebhookNotifications";
import { processCommercialPdfFromEmail } from "./commercialAgentOrchestrator";
import { classifyCommercialDocumentIntent } from "./commercialDocumentIntent";
import { runStrictCommercialAutoCreateIfAllowed } from "./commercialStrictAutoCreateRunner";
import { toImportedInquirySummary } from "./importedInquirySummary";
import type { MatchingResult } from "./productMatcher";

function parseUploadIntentHint(raw: unknown): "offer" | "order" | "unclear" | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  if (s === "offer" || s === "quote" || s === "quote_request") return "offer";
  if (s === "order" || s === "purchase_order" || s === "po") return "order";
  if (s === "unclear") return "unclear";
  return undefined;
}
import { extractDocumentTextPreviewForIntent } from "./documentTextExtraction";
import { registerPublicOfferRoutes } from "./publicOfferRoutes";
import { registerB2BAdminRoutes } from "./b2bAdminRoutes";
import { buildOfferDetailJson } from "./offerDetailBuilder";
import { generateOfferPlainToken, hashOfferPublicToken } from "./offerToken";
import { getHashCached, stableFingerprint } from "./contentHashCache";
import { buildCommercialProductFeedbackRowsFromDraftUpdate } from "./commercialProductLearning";
import { buildCommercialClarificationEmail } from "./customerClarificationEmail";

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

const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const defaultProformaNumberRange = {
  prefix: "PF-",
  nextNumber: 1,
  padding: 6,
};

const defaultDunningSettings = {
  enabled: false,
  manualOnly: true,
  dueDateFieldKey: "invoiceDate",
  stageDays: [7, 14, 21] as [number, number, number],
  documentTypeTechnicalName: "dunning",
  emailSubjectTemplate: "Mahnung Stufe {{stage}} zu Bestellung {{orderNumber}}",
  emailBodyTemplate: "Guten Tag {{customerName}},\n\nunsere Rechnung ist seit {{dueDate}} faellig. Dies ist Mahnstufe {{stage}}.\n\nMit freundlichen Gruessen\nIhr Team",
};

// Auto-assignment helper function
async function assignTicketAutomatically(ticket: Ticket): Promise<string | null> {
  try {
    const rules = await storage.getActiveTicketAssignmentRules();
    
    if (rules.length === 0) {
      return null; // No auto-assignment rules
    }

    // OPTIMIZATION: Batch-load all data ONCE before the loop to eliminate N+1 queries
    const [allUsers, allRoles, allTickets] = await Promise.all([
      storage.getAllUsers(),
      storage.getAllRoles(),
      storage.getAllTickets(),
    ]);

    // Sort by priority (highest first)
    const sortedRules = rules.sort((a, b) => b.priority - a.priority);

    let aiResult: Awaited<ReturnType<typeof classifyTicketForRules>> | null = null;
    const ticketText = [ticket.title, ticket.description, ticket.emailSubject, ticket.emailFrom]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const rule of sortedRules) {
      if (rule.assignmentType === 'round_robin') {
        // Round-robin: Find all users with manageTickets permission
        // Use pre-loaded data instead of fetching again
        const eligibleUsers = allUsers.filter(user => {
          if (user.roleId) {
            const userRole = allRoles.find(r => r.id === user.roleId);
            return userRole?.permissions?.manageTickets === true;
          }
          return false;
        });

        if (eligibleUsers.length === 0) continue;

        // Calculate round-robin using pre-loaded tickets
        const assignedCounts = new Map<string, number>();
        
        // Count assignments per user
        eligibleUsers.forEach(user => assignedCounts.set(user.id, 0));
        allTickets.forEach(t => {
          if (t.assignedToUserId && assignedCounts.has(t.assignedToUserId)) {
            assignedCounts.set(t.assignedToUserId, (assignedCounts.get(t.assignedToUserId) || 0) + 1);
          }
        });

        // Find user with least assignments
        let minAssignments = Infinity;
        let selectedUserId: string | null = null;
        
        eligibleUsers.forEach(user => {
          const count = assignedCounts.get(user.id) || 0;
          if (count < minAssignments) {
            minAssignments = count;
            selectedUserId = user.id;
          }
        });

        if (selectedUserId) {
          return selectedUserId;
        }
      } else if (rule.assignmentType === 'rule_based' && rule.conditions) {
        // Rule-based assignment
        try {
          const conditions = JSON.parse(rule.conditions);

          const needsAi =
            conditions.aiCategory ||
            conditions.aiPriority ||
            conditions.aiSentiment ||
            conditions.minConfidence ||
            conditions.keywords;

          if (needsAi && !aiResult) {
            aiResult = await classifyTicketForRules(storage, ticket);
          }
          
          // Check if all conditions match
          let conditionsMatch = true;
          
          if (conditions.priority && conditions.priority !== ticket.priority) {
            conditionsMatch = false;
          }
          if (conditions.category && conditions.category !== ticket.category) {
            conditionsMatch = false;
          }
          if (conditions.status && conditions.status !== ticket.status) {
            conditionsMatch = false;
          }
          
          if (conditionsMatch && aiResult) {
            if (conditions.aiCategory && conditions.aiCategory !== aiResult.category) {
              conditionsMatch = false;
            }
            if (conditions.aiPriority && conditions.aiPriority !== aiResult.priority) {
              conditionsMatch = false;
            }
            if (conditions.aiSentiment && conditions.aiSentiment !== aiResult.sentiment) {
              conditionsMatch = false;
            }
            if (conditions.minConfidence && aiResult.confidence < Number(conditions.minConfidence)) {
              conditionsMatch = false;
            }
            if (conditions.keywords) {
              const keywords = Array.isArray(conditions.keywords)
                ? conditions.keywords
                : String(conditions.keywords)
                    .split(",")
                    .map((value: string) => value.trim())
                    .filter(Boolean);
              if (keywords.length > 0 && !keywords.some((keyword: string) => ticketText.includes(keyword.toLowerCase()))) {
                conditionsMatch = false;
              }
            }
          }

          if (conditionsMatch) {
            // Assign to specified user or role
            if (rule.assignToUserId) {
              return rule.assignToUserId;
            } else if (rule.assignToRoleId) {
              // Use pre-loaded users instead of fetching again
              const userWithRole = allUsers.find(u => u.roleId === rule.assignToRoleId);
              if (userWithRole) {
                return userWithRole.id;
              }
            }
          }
        } catch (error) {
          console.error("Error parsing rule conditions:", error);
          continue;
        }
      }
    }

    return null; // No matching rule
  } catch (error) {
    console.error("Error in auto-assignment:", error);
    return null;
  }
}

// Sales Channel Filter Helper - ensures users only see data from their assigned sales channels
// SECURITY: This is the ONLY source of truth for sales channel access control
// Returns: string[] for restricted users, null for admins with full access
// Throws: Error if user context is missing (should never happen after requireAuth)
async function getSalesChannelFilter(req: Request): Promise<string[] | null> {
  const user = req.user as any;
  
  // SECURITY: User must be authenticated by this point
  if (!user || !user.id) {
    throw new Error("Unauthorized: No authenticated user found");
  }
  
  // SECURITY: Check if user is admin (true admin, not just lacking channel assignments)
  const isAdmin = 
    user?.roleDetails?.name === 'Administrator' || 
    user?.role === 'admin';
  
  // Admin users have full access (no filtering)
  if (isAdmin) {
    return null; // null = see all channels
  }
  
  // SECURITY: For non-admin users, NULL in database was historically treated as unrestricted access
  // However, for stricter security, only explicit admins (checked above) should have unrestricted access
  // Non-admin users with NULL salesChannelIds should be treated as having NO specific channels assigned
  // They will either inherit from role or get empty array (no access)
  
  // NOTE: If both user and role have NULL salesChannelIds, this means the user has not been 
  // properly configured. In this case, deny access (return []) for safety rather than granting full access.
  
  // Collect all sales channel IDs from user and role
  const channelIds = new Set<string>();
  
  // Add user's direct sales channel assignments
  if (Array.isArray(user.salesChannelIds) && user.salesChannelIds.length > 0) {
    user.salesChannelIds.forEach((id: string) => channelIds.add(id));
  }
  
  // Add role-based sales channel assignments (if role exists)
  if (user.roleId) {
    try {
      const role = await storage.getRole(user.roleId);
      if (role && Array.isArray(role.salesChannelIds) && role.salesChannelIds.length > 0) {
        role.salesChannelIds.forEach((id: string) => channelIds.add(id));
      }
    } catch (error) {
      console.error("Error fetching role for sales channel filter:", error);
      // Continue without role-based channels
    }
  }
  
  // SECURITY: If no channels assigned (and not admin or NULL), return empty array
  // Empty array = restricted user with NO channel access
  if (channelIds.size === 0) {
    return []; // Empty array = no channel access
  }
  
  // Return restricted channel list
  return Array.from(channelIds);
}

/** Gleiche Sichtbarkeit wie GET /api/orders/:orderId — Lesezugriff auf Ratenpläne ohne viewDocuments */
async function assertInstallmentOrderAccess(
  req: Request,
  orderId: string,
  tenantId: string | null
): Promise<{ ok: true } | { ok: false; status: number; body: { error: string } }> {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    return { ok: false, status: 400, body: { error: "Shopware settings not configured" } };
  }
  let allowedChannelIds: string[] | null;
  try {
    allowedChannelIds = await getSalesChannelFilter(req);
  } catch (authError) {
    console.error("[assertInstallmentOrderAccess] channel filter:", authError);
    return { ok: false, status: 403, body: { error: "Access denied: authentication error" } };
  }
  if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
    return { ok: false, status: 403, body: { error: "Access denied: no sales channel permissions" } };
  }
  const client = new ShopwareClient(settings);
  const order = await client.fetchOrderById(orderId, allowedChannelIds);
  if (!order) {
    return { ok: false, status: 404, body: { error: "Order not found or access denied" } };
  }
  return { ok: true };
}

function hasPermission(user: any, permission: string): boolean {
  const roleDetails = user?.roleDetails;
  if (!roleDetails) {
    return false;
  }

  const permissions = roleDetails.permissions;
  if (!permissions) {
    return false;
  }

  if (Array.isArray(permissions)) {
    return permissions.includes(permission);
  }

  return Boolean(permissions[permission]);
}

function requireViewDocumentsOrAccounting(req: Request, res: Response, next: () => void) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Please login" });
  }

  const isAdmin =
    user?.roleDetails?.name === "Administrator" ||
    user?.role === "admin";

  if (isAdmin || hasPermission(user, "viewDocuments") || hasPermission(user, "viewAccounting")) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden: viewDocuments or viewAccounting permission required" });
}

const DEFAULT_TICKET_SLA_SETTINGS = {
  lowDays: 7,
  normalDays: 3,
  highDays: 2,
  urgentDays: 1,
};

async function getTicketSlaSettings() {
  const stored = (await storage.getSetting("ticket_sla_settings")) || {};
  return {
    ...DEFAULT_TICKET_SLA_SETTINGS,
    ...stored,
  };
}

function calculateDueDate(priority: string, settings: typeof DEFAULT_TICKET_SLA_SETTINGS) {
  const days =
    priority === "urgent"
      ? settings.urgentDays
      : priority === "high"
        ? settings.highDays
        : priority === "low"
          ? settings.lowDays
          : settings.normalDays;
  const due = new Date();
  due.setDate(due.getDate() + Math.max(days, 0));
  return due;
}

async function applyAutoStatusAfterComment(ticket: any, authorType: "user" | "customer", isInternal: boolean) {
  if (!ticket) return;
  if (ticket.status === "resolved" || ticket.status === "closed") {
    return;
  }
  if (authorType === "customer") {
    await storage.updateTicket(ticket.id, { status: "waiting_for_internal" });
  } else if (!isInternal) {
    await storage.updateTicket(ticket.id, { status: "waiting_for_customer" });
  }
}

function normalizeEmailMessageId(messageId?: string | null) {
  if (!messageId) return "";
  return messageId.replace(/[<>]/g, "").trim();
}

const sanitizeFilename = (value: string) =>
  value
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_");

const resolveAttachmentPath = (filePath: string) => {
  const root = getUploadsRoot();
  const normalized = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  if (!normalized.startsWith(root + path.sep)) {
    throw new Error("Invalid attachment path");
  }
  return normalized;
};

function orderTotalAmountNumber(order: Order): number {
  const t = order.totalAmount as unknown;
  return typeof t === "number" ? t : parseFloat(String(t));
}

function decimalNum(v: string | number): number {
  return typeof v === "number" ? v : parseFloat(String(v));
}

function splitRemainingInstallments(remainingGross: number, n: number): number[] {
  const cents = Math.round(remainingGross * 100);
  if (n <= 0) return [];
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((base + (i === n - 1 ? remainder : 0)) / 100);
  }
  return out;
}

function serializeInstallmentPlan(plan: InstallmentPlan, invoices: InstallmentInvoice[]) {
  return {
    ...plan,
    totalAmount: decimalNum(plan.totalAmount as any),
    depositAmount: decimalNum(plan.depositAmount as any),
    depositPercent: plan.depositPercent ? decimalNum(plan.depositPercent as any) : null,
    remainingAmount: decimalNum(plan.remainingAmount as any),
    installmentAmount: decimalNum(plan.installmentAmount as any),
    invoices: invoices.map((inv) => ({
      ...inv,
      amount: decimalNum(inv.amount as any),
    })),
  };
}

// Helper function: Filter tickets by sales channel (indirect via orderId)
// SECURITY: Tickets are filtered indirectly through their linked order's salesChannelId
// Logic: 
//   - Tickets WITH orderId: Filter by order's salesChannelId
//   - Tickets WITHOUT orderId: Only visible to admin/creator/assignee (NOT universally readable)
//   - Admin (allowedChannelIds = null): Allow all
async function filterTicketsBySalesChannels(
  tickets: any[],
  allowedChannelIds: string[] | null,
  storage: IStorage,
  currentUserId?: string // Optional: Used to check creator/assignee access for standalone tickets
): Promise<any[]> {
  // Admin (null) → return all tickets
  if (allowedChannelIds === null) {
    return tickets;
  }
  
  // SECURITY: Empty array means NO channel access (not admin)
  // Return only standalone tickets that user created/is assigned to
  if (allowedChannelIds.length === 0) {
    return tickets.filter(ticket => {
      if (!ticket.orderId) {
        // Standalone ticket: only visible if user is creator or assignee
        if (!currentUserId) return false;
        return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
      }
      return false; // Order-linked tickets not accessible (no channel access)
    });
  }
  
  // Get unique orderIds from tickets (only those with orderId)
  const uniqueOrderIds = Array.from(new Set(tickets.filter(t => t.orderId).map(t => t.orderId!)));
  
  // If no tickets have orderIds, filter standalone tickets with creator/assignee check
  if (uniqueOrderIds.length === 0) {
    return tickets.filter(ticket => {
      if (!ticket.orderId) {
        // Standalone ticket: only visible if user is creator or assignee
        if (!currentUserId) return false;
        return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
      }
      return false;
    });
  }
  
  // Fetch orders to get their salesChannelIds
  const settings = await storage.getShopwareSettings();
  let ordersBySalesChannel: Map<string, string> = new Map(); // orderId -> salesChannelId
  
  if (settings && uniqueOrderIds.length > 0) {
    try {
      const client = new ShopwareClient(settings);
      const ordersMap = await client.fetchOrdersByIds(uniqueOrderIds);
      
      // Convert to salesChannelId map
      ordersMap.forEach((order, orderId) => {
        ordersBySalesChannel.set(orderId, order.salesChannelId);
      });
    } catch (error) {
      console.error("[Security] Error fetching orders for ticket filtering:", error);
      // SECURITY: If we can't fetch orders, return only standalone tickets with creator/assignee check
      return tickets.filter(ticket => {
        if (!ticket.orderId) {
          // Standalone ticket: only visible if user is creator or assignee
          if (!currentUserId) return false;
          return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
        }
        return false; // Order-linked tickets not accessible (fail-safe)
      });
    }
  }
  
  // Filter tickets:
  // - Tickets WITHOUT orderId: Only visible to admin/creator/assignee (SECURITY FIX)
  // - Tickets WITH orderId: Only if order's salesChannelId matches allowedChannelIds
  return tickets.filter(ticket => {
    // SECURITY: Standalone tickets (no orderId) are NOT universally readable
    // Only visible to: admin (allowedChannelIds=null), creator, or assignee
    if (!ticket.orderId) {
      // If no currentUserId provided, block standalone tickets for safety
      if (!currentUserId) {
        return false;
      }
      // Allow if user is creator or assignee
      return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
    }
    
    // Order-linked tickets: Check if order's sales channel matches user's allowed channels
    const orderSalesChannel = ordersBySalesChannel.get(ticket.orderId);
    return orderSalesChannel && allowedChannelIds.includes(orderSalesChannel);
  });
}

// Filter function for orders based on sales channels
function filterOrdersBySalesChannels(orders: Order[], allowedChannelIds: string[] | null): Order[] {
  if (!allowedChannelIds) {
    return orders; // No filter = all orders (admin)
  }
  
  return orders.filter(order => allowedChannelIds.includes(order.salesChannelId));
}

function getRulePairKey(rule: CrossSellingRule): string | null {
  const sourceCondition = rule.sourceConditions.find(
    (condition) => condition.field === "productNumber" && condition.operator === "equals"
  );
  const targetCriterion = rule.targetCriteria.find(
    (criterion) => criterion.field === "productNumber" && criterion.matchType === "exact"
  );

  const source = typeof sourceCondition?.value === "string" ? sourceCondition.value : null;
  const target = typeof targetCriterion?.value === "string" ? targetCriterion.value : null;

  if (!source || !target) {
    return null;
  }

  return `${source}::${target}`;
}

function dedupeRulesWithPriority(rules: CrossSellingRule[]): CrossSellingRule[] {
  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();
  const result: CrossSellingRule[] = [];

  for (const rule of rules) {
    if (seenIds.has(rule.id)) {
      continue;
    }

    const pairKey = getRulePairKey(rule);
    if (pairKey) {
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
    }

    seenIds.add(rule.id);
    result.push(rule);
  }

  return result;
}

function dedupeAndLimitSuggestions<T extends Product>(suggestions: T[], limit: number = 10): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const suggestion of suggestions) {
    const key = suggestion.productNumber || suggestion.id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

const CROSS_SELL_EVENT_STATS_DAYS = 90;

type CrossSellRankingBundle = {
  learningSettings: LearningSettings;
  cooccurrences: CrossSellCooccurrence[];
  eventStatsMap: Map<string, CrossSellEventPairStats>;
  weights: ReturnType<typeof hybridWeightsFromLearningSettings>;
  topK: number;
  ttlHours: number;
};

async function loadCrossSellRankingBundle(tenantId: string | null): Promise<CrossSellRankingBundle | null> {
  try {
    const learningSettings = await getCrossSellLearningSettings(storage, tenantId);
    const cooccurrences = await storage.getCrossSellCooccurrences(tenantId);
    const since = new Date();
    since.setDate(since.getDate() - CROSS_SELL_EVENT_STATS_DAYS);
    const eventStats = await storage.getCrossSellEventStats(tenantId, since);
    const eventStatsMap = buildCrossSellEventStatsMap(eventStats);
    const weights = hybridWeightsFromLearningSettings(learningSettings);
    const envTopK = Number(process.env.CROSS_SELL_LLM_RERANK_TOPK);
    const topK = Number.isFinite(envTopK) && envTopK > 0 ? Math.floor(envTopK) : 25;
    const envTtl = Number(process.env.CROSS_SELL_LLM_RERANK_TTL_HOURS);
    const ttlHours = Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 24;
    return { learningSettings, cooccurrences, eventStatsMap, weights, topK, ttlHours };
  } catch (e) {
    console.warn("[CrossSell] loadRankingBundle failed:", e);
    return null;
  }
}

function crossSellSuggestOptions(
  tenantId: string | null,
  bundle: CrossSellRankingBundle | null,
  mode: "full" | "hybrid_only",
): SuggestCrossSellingOptions | undefined {
  if (!bundle) return undefined;
  const hybridRank = {
    storage,
    tenantId,
    cooccurrences: bundle.cooccurrences,
    eventStatsMap: bundle.eventStatsMap,
    weights: bundle.weights,
  };
  if (mode === "hybrid_only") {
    return { hybridRank };
  }
  return {
    hybridRank,
    llmRerank: {
      storage,
      topK: bundle.topK,
      topN: 10,
      ttlHours: bundle.ttlHours,
      useLlmFromSettings: bundle.learningSettings.useLlmRerank !== false,
    },
  };
}

type StagingApplyCategoryGroup = {
  category: string | null;
  targets: Array<{ targetProductNumber: string; targetProductId?: string | null }>;
};

/** Wie POST /staging/apply: nur aktive Vorschlaege, gruppiert nach Ausgangsartikel und Kategorie. */
function groupActiveStagingSuggestionsBySourceAndCategory(
  suggestions: Array<{
    active: number;
    sourceProductNumber: string;
    targetProductNumber: string;
    category?: string | null;
    targetProductId?: string | null;
  }>,
): Map<string, Map<string | null, StagingApplyCategoryGroup>> {
  const groupedBySourceAndCategory = new Map<string, Map<string | null, StagingApplyCategoryGroup>>();

  for (const suggestion of suggestions) {
    if (suggestion.active !== 1) continue;
    const sourceKey = suggestion.sourceProductNumber;
    if (!sourceKey) continue;

    if (!groupedBySourceAndCategory.has(sourceKey)) {
      groupedBySourceAndCategory.set(sourceKey, new Map());
    }

    const categoryMap = groupedBySourceAndCategory.get(sourceKey)!;
    const category = suggestion.category || null;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, { category, targets: [] });
    }

    categoryMap.get(category)!.targets.push({
      targetProductNumber: suggestion.targetProductNumber,
      targetProductId: suggestion.targetProductId ?? null,
    });
  }

  return groupedBySourceAndCategory;
}

function getCategoryPosition(category: string | null): number {
  switch (category) {
    case "regale":
      return 1;
    case "boeden":
      return 2;
    case "komponenten":
      return 3;
    case "diagonal":
      return 4;
    case "zubehoer":
      return 5;
    case "kleinteile":
      return 6;
    case "sonstiges":
      return 7;
    default:
      return 8;
  }
}

function mergeStagingTargetsByCategoryOrder(
  categoryMap: Map<string | null, StagingApplyCategoryGroup>,
): Array<{ targetProductNumber: string; targetProductId?: string | null }> {
  const sorted = Array.from(categoryMap.entries()).sort(
    (a, b) => getCategoryPosition(a[0]) - getCategoryPosition(b[0]),
  );
  const seen = new Set<string>();
  const out: Array<{ targetProductNumber: string; targetProductId?: string | null }> = [];
  for (const [, group] of sorted) {
    for (const t of group.targets) {
      const pn = (t.targetProductNumber || "").trim();
      if (!pn || seen.has(pn)) continue;
      seen.add(pn);
      out.push(t);
    }
  }
  return out;
}

/** Artikelnummer fuer Cross-Sell-Analytics: direkt oder per Shopware-Produkt-ID. */
async function resolveCrossSellProductNumberForAnalytics(
  tenantId: string | null,
  explicitNumber: string | undefined,
  productId: string | undefined,
): Promise<string | null> {
  const n = explicitNumber?.trim();
  if (n) return n;
  const id = productId?.trim();
  if (!id) return null;
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) return null;
  const client = new ShopwareClient(settings);
  const { products } = await client.fetchProducts(
    1,
    1,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    true,
    undefined,
    false,
    false,
    id,
  );
  return products[0]?.productNumber?.trim() || null;
}

async function getCombinedCrossSellingRules(tenantId?: string | null): Promise<CrossSellingRule[]> {
  const combined = await getCombinedCrossSellingRulesWithSource(tenantId);
  return combined.map((entry) => entry.rule);
}

async function getCombinedCrossSellingRulesWithSource(tenantId?: string | null): Promise<
  Array<{ rule: CrossSellingRule; sourceType: "ai" | "manual" }>
> {
  const manualRules = (await storage.getAllCrossSellingRules(tenantId)).filter((rule) => rule.active === 1);
  const aiRules = (await storage.getAiCrossSellRules(tenantId)).filter((rule) => rule.active === 1);

  const mappedAiRules = aiRules.map((rule) => ({
    rule: {
      id: rule.id,
      name: `AI: ${rule.sourceProductNumber} -> ${rule.targetProductNumber}`,
      description: rule.reason || "AI-generated rule",
      active: rule.active,
      category: rule.category ?? null,
      sourceConditions: [
        {
          field: "productNumber",
          operator: "equals" as RuleCondition["operator"],
          value: rule.sourceProductNumber,
        },
      ],
      targetCriteria: [
        {
          field: "productNumber",
          matchType: "exact" as RuleTargetCriteria["matchType"],
          value: rule.targetProductNumber,
        },
      ],
      createdAt: rule.generatedAt,
      updatedAt: rule.generatedAt,
    },
    sourceType: "ai" as const,
  }));

  const mappedManualRules = manualRules.map((rule) => ({
    rule,
    sourceType: "manual" as const,
  }));

  // Manual rules first: higher priority in suggestCrossSelling / dedupe-by-pair semantics
  const combined = [...mappedManualRules, ...mappedAiRules];
  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();
  const result: Array<{ rule: CrossSellingRule; sourceType: "ai" | "manual" }> = [];

  for (const entry of combined) {
    const { rule } = entry;
    if (seenIds.has(rule.id)) {
      continue;
    }

    const pairKey = getRulePairKey(rule);
    if (pairKey) {
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
    }

    seenIds.add(rule.id);
    result.push(entry);
  }

  return result;
}

async function fetchAllProductsForStaging(client: ShopwareClient): Promise<Product[]> {
  const limit = 200;
  let page = 1;
  const allProducts: Product[] = [];

  while (true) {
    const result = await client.fetchProducts(limit, page, undefined, undefined, false, undefined, undefined, undefined, true);
    allProducts.push(...result.products);
    const total = result.total ?? allProducts.length;
    if (result.products.length === 0 || allProducts.length >= total) {
      break;
    }
    page += 1;
  }

  return allProducts;
}

function getFallbackSuggestionsByProperties(
  source: Product,
  allProducts: Product[],
  limit: number = 10
): Product[] {
  const sourceCategories = new Set(
    (source.categoryNames || []).map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const sourceProperties = new Set(
    (source.properties || [])
      .map((prop) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
      .filter(Boolean)
  );

  if (sourceCategories.size === 0 && sourceProperties.size === 0) {
    return [];
  }

  const scored: Array<{ product: Product; score: number }> = [];
  for (const candidate of allProducts) {
    if (candidate.id === source.id) {
      continue;
    }
    const candidateCategories = new Set(
      (candidate.categoryNames || []).map((name) => name.trim().toLowerCase()).filter(Boolean)
    );
    const candidateProperties = new Set(
      (candidate.properties || [])
        .map((prop) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
        .filter(Boolean)
    );

    let score = 0;
    sourceCategories.forEach((value) => {
      if (candidateCategories.has(value)) {
        score += 1;
      }
    });
    sourceProperties.forEach((value) => {
      if (candidateProperties.has(value)) {
        score += 1;
      }
    });

    if (score > 0) {
      scored.push({ product: candidate, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.product);
}

async function generateCrossSellStaging(
  tenantId: string | null,
  userId: string | null
): Promise<{
  batchId: string;
  rulesCount: number;
  suggestionsCount: number;
  productsWithSuggestions: number;
  productsWithoutSuggestions: number;
}> {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    throw new Error("Shopware settings not configured");
  }

  const client = new ShopwareClient(settings);
  const ruleEngine = new RuleEngine();

  const combined = await getCombinedCrossSellingRulesWithSource(tenantId);
  const rules = combined.map((entry) => entry.rule);

  const batch = await storage.createCrossSellStagingBatch(
    {
      tenantId,
      createdByUserId: userId,
      status: "draft",
    },
    tenantId
  );

  const stagingRules = combined.map((entry) => {
    const pairKey = getRulePairKey(entry.rule);
    const [sourceProductNumber, targetProductNumber] = pairKey ? pairKey.split("::") : [null, null];
    return {
      batchId: batch.id,
      tenantId,
      ruleType: entry.sourceType,
      name: entry.rule.name,
      description: entry.rule.description ?? null,
      active: entry.rule.active ?? 1,
      category: entry.rule.category ?? null,
      sourceConditions: entry.rule.sourceConditions,
      targetCriteria: entry.rule.targetCriteria,
      sourceProductNumber,
      targetProductNumber,
    };
  });

  await storage.replaceCrossSellStagingRules(batch.id, stagingRules, tenantId);

  const allProducts = await fetchAllProductsForStaging(client);
  const rankingBundle = await loadCrossSellRankingBundle(tenantId);
  const suggestOpts = crossSellSuggestOptions(tenantId, rankingBundle, "hybrid_only");
  const shelfCfg = await loadCrossSellShelvingPatternConfig((k, t) => storage.getSetting(k, t), tenantId);
  const stagingSuggestions: Array<{
    batchId: string;
    tenantId: string | null;
    sourceProductId: string | null;
    sourceProductNumber: string;
    targetProductId: string | null;
    targetProductNumber: string;
    category?: string | null;
    active: number;
  }> = [];
  let productsWithSuggestions = 0;
  let productsWithoutSuggestions = 0;

  for (const product of allProducts) {
    if (!product.productNumber) {
      continue;
    }
    const suggestions = await ruleEngine.suggestCrossSelling(product, rules, client, suggestOpts);
    const rulesLimited = dedupeAndLimitSuggestions(suggestions, 40);

    let fallbackLimited: Product[] = [];
    if (rulesLimited.length === 0) {
      fallbackLimited = dedupeAndLimitSuggestions(
        getFallbackSuggestionsByProperties(product, allProducts, 40),
        40,
      );
    }

    const ruleHits = rulesLimited.map((s) => ({
      product: s,
      category:
        (s as Product & { suggestCategory?: string }).suggestCategory ??
        CROSS_SELL_CATEGORIES.COMPONENTS,
    }));
    const fallbackHits = fallbackLimited.map((s) => ({
      product: s,
      category: CROSS_SELL_CATEGORIES.OTHER,
    }));
    const ruleOrFallback = ruleHits.length > 0 ? ruleHits : fallbackHits;

    const heur = findShelvingSupplements(product, allProducts, shelfCfg);
    const merged = mergeStagingCandidatesWithQuotas(ruleOrFallback, heur, shelfCfg);

    if (merged.length === 0) {
      productsWithoutSuggestions += 1;
      continue;
    }

    productsWithSuggestions += 1;
    for (const row of merged) {
      const suggestion = row.product;
      if (!suggestion.productNumber) {
        continue;
      }
      stagingSuggestions.push({
        batchId: batch.id,
        tenantId,
        sourceProductId: product.id ?? null,
        sourceProductNumber: product.productNumber,
        targetProductId: suggestion.id ?? null,
        targetProductNumber: suggestion.productNumber,
        category: row.category,
        active: 1,
      });
    }
  }

  await storage.replaceCrossSellStagingSuggestions(batch.id, stagingSuggestions, tenantId);

  return {
    batchId: batch.id,
    rulesCount: stagingRules.length,
    suggestionsCount: stagingSuggestions.length,
    productsWithSuggestions,
    productsWithoutSuggestions,
  };
}

// Versionierter Key: bei strukturellen Aenderungen am Order-Objekt (neue Felder
// wie hasInvoiceDocument/invoiceSent) erhoehen, damit alte DB-Caches automatisch
// verworfen werden und ein frischer Fetch mit den neuen Feldern laeuft.
const ORDERS_CACHE_KEY = "orders_cache_v4";
const ORDERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CRM_CUSTOMERS_CACHE_KEY = "crm_customers_cache_v2";
const BESTANDSKUNDEN_GROUP_TERMS = ["Portal", "Händler", "Haendler"];

type OrdersCache = {
  fetchedAt: string;
  fingerprint?: string;
  orders: Order[];
  latestMeta?: {
    id: string;
    orderNumber: string;
    orderDate?: string;
    updatedAt?: string;
  };
};

async function getOrdersWithCache(
  client: ShopwareClient,
  tenantId?: string | null,
): Promise<{ orders: Order[]; fromCache: boolean }> {
  const cached = (await storage.getSetting(ORDERS_CACHE_KEY, tenantId)) as OrdersCache | undefined;
  if (cached?.orders?.length && cached.fetchedAt) {
    try {
      const sourceFingerprint = await client.fetchOrdersFingerprint();
      if (sourceFingerprint && cached.fingerprint === sourceFingerprint) {
        return { orders: cached.orders, fromCache: true };
      }

      const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
      if (ageMs < ORDERS_CACHE_TTL_MS && !cached.fingerprint) {
        // Abwärtskompatibel: alter Cache ohne fingerprint — ein Meta-Check reicht
        const latestMeta = await client.fetchLatestOrderMeta();
        const cachedMeta = cached.latestMeta;
        const matchesLatest =
          latestMeta &&
          cachedMeta &&
          latestMeta.id === cachedMeta.id &&
          (latestMeta.updatedAt || "") === (cachedMeta.updatedAt || "") &&
          (latestMeta.orderNumber || "") === (cachedMeta.orderNumber || "");

        if (matchesLatest || !latestMeta) {
          return { orders: cached.orders, fromCache: true };
        }
      }
    } catch (error) {
      console.warn("[orders-cache] fingerprint check failed, using cached orders:", error);
      return { orders: cached.orders, fromCache: true };
    }
  }

  const orders = await client.fetchOrders(undefined, { includeInvoiceInfo: true });
  const latestOrder = orders[0];
  const fingerprint = (await client.fetchOrdersFingerprint()) ?? undefined;
  const cacheToSave: OrdersCache = {
    fetchedAt: new Date().toISOString(),
    fingerprint,
    orders,
    latestMeta: latestOrder
      ? {
          id: latestOrder.id,
          orderNumber: latestOrder.orderNumber,
          orderDate: latestOrder.orderDate,
          updatedAt: latestOrder.updatedAt,
        }
      : undefined,
  };
  await storage.saveSetting(ORDERS_CACHE_KEY, cacheToSave, tenantId);
  console.log(`[orders-cache] full reload (${orders.length} orders, fp ${fingerprint?.slice(0, 8) ?? "n/a"})`);
  return { orders, fromCache: false };
}

/**
 * Aktualisiert den Rechnungsstatus einer einzelnen Bestellung im Orders-Cache,
 * damit das "verschickt"-Badge nach dem Versand sofort stimmt, ohne dass die
 * gesamte (teure) Bestellliste neu geladen werden muss.
 */
async function markOrderInvoiceSentInCache(orderId: string, tenantId?: string | null): Promise<void> {
  try {
    const cached = (await storage.getSetting(ORDERS_CACHE_KEY, tenantId)) as OrdersCache | undefined;
    if (!cached?.orders?.length) return;
    let changed = false;
    for (const o of cached.orders) {
      if (o.id === orderId) {
        if (!o.hasInvoiceDocument) {
          o.hasInvoiceDocument = true;
          o.invoiceDocumentCount = o.invoiceDocumentCount || 1;
        }
        if (o.invoiceSent !== true) {
          o.invoiceSent = true;
          changed = true;
        }
      }
    }
    if (changed) {
      await storage.saveSetting(ORDERS_CACHE_KEY, cached, tenantId);
    }
  } catch (error) {
    console.warn("[orders-cache] Failed to update invoice-sent flag:", error);
  }
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
  
  // CPQ (Configure, Price, Quote) routes
  registerCpqRoutes(app, { requireAuth, requireViewCPQ, requireManageCPQ, requireManageCPQDiscountLevels, requireApproveCPQQuotes });
  registerCpqCoreRoutes(app, { requireAuth, requireViewCPQ, requireManageCPQ });

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
      
      await storage.updateUser(user.id, {
        role: role.name.toLowerCase() === "administrator" ? "admin" : "employee",
        roleId: validated.roleId,
        salesChannelIds: validated.salesChannelIds || null,
        skills: validated.skills || null,
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
      console.error("Error fetching Shopware settings:", error);
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

  // Proforma number range settings (per tenant)
  app.get("/api/settings/proforma-number-range", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await storage.getProformaNumberRangeSettings();
      res.json(settings ?? defaultProformaNumberRange);
    } catch (error: any) {
      console.error("Error fetching proforma number range settings:", error);
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
      console.error("Error saving proforma number range settings:", error);
      res.status(500).json({ error: error.message || "Failed to save proforma number range settings" });
    }
  });

  // Dunning (Mahnung) settings
  app.get("/api/settings/dunning", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await storage.getDunningSettings();
      res.json({ ...defaultDunningSettings, ...(settings || {}) });
    } catch (error: any) {
      console.error("Error fetching dunning settings:", error);
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
      console.error("Error saving dunning settings:", error);
      res.status(500).json({ error: error.message || "Failed to save dunning settings" });
    }
  });

  // Integration API keys (Automation / n8n pro Mandant; Klartext nur bei POST einmal)
  app.get("/api/settings/integration-api-keys", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      if (!tenantId) {
        return res.status(400).json({ error: "Tenant required" });
      }
      const keys = await storage.listTenantIntegrationApiKeys(tenantId);
      res.json({ keys });
    } catch (error: any) {
      console.error("Error listing integration API keys:", error);
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
      const created = await storage.createTenantIntegrationApiKey(tenantId, name);
      res.json({
        id: created.id,
        apiKey: created.apiKey,
        warning: "Den apiKey sicher speichern; er wird nicht erneut angezeigt.",
      });
    } catch (error: any) {
      console.error("Error creating integration API key:", error);
      res.status(500).json({ error: error.message || "Failed to create key" });
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
      console.error("Error deleting integration API key:", error);
      res.status(500).json({ error: error.message || "Failed to delete key" });
    }
  });

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
      console.error("Error testing Shopware connection:", error);
      res.status(500).json({ success: false, error: error.message || "Connection test failed" });
    }
  });

  // Ticket SLA settings
  app.get("/api/settings/ticket-sla", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getTicketSlaSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching ticket SLA settings:", error);
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
      console.error("Error saving ticket SLA settings:", error);
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
      console.error("Error fetching email inbound settings:", error);
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
      console.error("Error saving email inbound settings:", error);
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
      console.error("Error fetching email outbound settings:", error);
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
      console.error("Error saving email outbound settings:", error);
      res.status(500).json({ error: error.message || "Failed to save email outbound settings" });
    }
  });

  // Email routing settings
  app.get("/api/settings/email-routing", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = await getEmailRoutingSettings(storage);
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching email routing settings:", error);
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
      console.error("Error saving email routing settings:", error);
      res.status(500).json({ error: error.message || "Failed to save email routing settings" });
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
      console.error("Error fetching M365 settings:", error);
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
      console.error("Error saving M365 settings:", error);
      res.status(500).json({ error: error.message || "Failed to save M365 settings" });
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
      console.error("Error fetching GA4 settings:", error);
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
      console.error("Error saving GA4 settings:", error);
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
      console.error("Error fetching Google Ads settings:", error);
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
      console.error("Error saving Google Ads settings:", error);
      res.status(500).json({ error: error.message || "Failed to save Google Ads settings" });
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

  // B2B Offer status mapping settings
  app.get("/api/settings/b2b-offer-status-mapping", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const stored = (await storage.getSetting("b2b.offerStatusMapping")) as OfferStatusMapping | undefined;
      const defaults = getOfferStatusMapping();
      const mapping = getOfferStatusMapping(stored);
      res.json({ mapping, defaults, stored: stored || null });
    } catch (error: any) {
      console.error("Error fetching B2B status mapping:", error);
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
      console.error("Error saving B2B status mapping:", error);
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
      console.error("Error fetching offer config PDF texts:", error);
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
      console.error("Error saving offer config PDF texts:", error);
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
      console.error("Error fetching Mondu settings:", error);
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
      console.error("Error saving Mondu settings:", error);
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
      const { MonduClient } = await import("./mondu");
      const client = new MonduClient({
        apiKey: validated.apiKey,
        sandboxMode: validated.sandboxMode,
      });
      
      // Try to make a simple API call to test connectivity
      // We'll just check if we can reach the API without errors
      res.json({ success: true, message: "Mondu API key validated" });
    } catch (error: any) {
      console.error("Error testing Mondu connection:", error);
      res.status(500).json({ success: false, error: error.message || "Connection test failed" });
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
      const salesChannels = await client.fetchSalesChannels();
      
      res.json(salesChannels);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch sales channels";
      console.error("[api/sales-channels] Error:", msg, error?.stack);
      res.status(500).json({ error: msg });
    }
  });

  // Orders routes
  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Parse pagination parameters
      const limit = parseInt(req.query.limit as string) || 50; // Default: 50 orders per page
      const offset = parseInt(req.query.offset as string) || 0;
      
      // Check if pagination is requested (limit or offset provided)
      const usePagination = req.query.limit !== undefined || req.query.offset !== undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      // IGNORE client-provided salesChannelIds query parameter - it's not trusted
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      if (usePagination) {
        // Use paginated endpoint with sales channel filtering (server-side at Shopware API level)
        const { orders, total } = await client.fetchOrdersPaginated(limit, offset, allowedChannelIds);
        
        // SECURITY: Double-check filtering locally as defense-in-depth (should already be filtered by Shopware)
        const filteredOrders = filterOrdersBySalesChannels(orders, allowedChannelIds);
        
        // Return paginated response with metadata (total is already filtered by Shopware API)
        res.json({
          orders: filteredOrders,
          total, // Shopware API returns filtered total
          limit,
          offset,
        });
      } else {
        // Backward compatibility: fetch all orders if no pagination params with caching
        const { orders } = await getOrdersWithCache(client, (req as any).tenantId ?? null);

        // SECURITY: Apply sales channel filter locally (cache stores all orders)
        const filteredOrders = filterOrdersBySalesChannels(orders, allowedChannelIds);
        
        // Return all orders (backward compatible)
      res.json(filteredOrders);
      }
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch orders" });
    }
  });

  // Advanced query endpoint for n8n automation and filtering
  app.get("/api/orders/query", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Pre-process and normalize query parameters
      // Handle arrays, trim whitespace, provide clear error messages
      const normalizedQuery: any = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (Array.isArray(value)) {
          // Take first value for repeated params, reject array-style params (e.g., param[]=value)
          if (value.length === 0) {
            continue; // Skip empty arrays
          }
          const firstValue = value[0];
          if (typeof firstValue === 'string') {
            normalizedQuery[key] = firstValue.trim();
          } else {
            normalizedQuery[key] = firstValue;
          }
        } else if (typeof value === 'string') {
          normalizedQuery[key] = value.trim(); // Trim whitespace
        } else {
          normalizedQuery[key] = value;
        }
      }

      // Validate query parameters with actionable error messages
      const querySchema = z.object({
        // Date range filters (flexible ISO 8601 format with trimming)
        // Accepts: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SSZ, etc.
        orderDateFrom: z.string({
          invalid_type_error: "orderDateFrom must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        orderDateTo: z.string({
          invalid_type_error: "orderDateTo must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        invoiceDateFrom: z.string({
          invalid_type_error: "invoiceDateFrom must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        invoiceDateTo: z.string({
          invalid_type_error: "invoiceDateTo must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        
        // Status filters with clear error messages
        status: z.enum(['open', 'in_progress', 'completed', 'cancelled'], {
          errorMap: () => ({ message: "status must be one of: open, in_progress, completed, cancelled" }),
        }).optional(),
        paymentStatus: z.enum(['open', 'paid', 'authorized', 'partially_paid', 'refunded', 'cancelled', 'reminded', 'failed'], {
          errorMap: () => ({ message: "paymentStatus must be one of: open, paid, authorized, partially_paid, refunded, cancelled, reminded, failed" }),
        }).optional(),
        
        // Boolean filters with clear error messages
        hasInvoice: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "hasInvoice must be 'true' or 'false' (as string)" }),
        }).optional(),
        hasDeliveryNote: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "hasDeliveryNote must be 'true' or 'false' (as string)" }),
        }).optional(),
        paymentOverdue: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "paymentOverdue must be 'true' or 'false' (as string)" }),
        }).optional(),
        isShipped: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "isShipped must be 'true' or 'false' (as string)" }),
        }).optional(),
        
        // Pagination with strict bounds and clear errors
        limit: z.coerce.number({
          invalid_type_error: "limit must be a number between 1 and 500",
        }).int("limit must be an integer").min(1, "limit must be at least 1").max(500, "limit cannot exceed 500").optional(),
        offset: z.coerce.number({
          invalid_type_error: "offset must be a non-negative number",
        }).int("offset must be an integer").min(0, "offset cannot be negative").optional(),
      });

      const validated = querySchema.parse(normalizedQuery);
      
      // Parse pagination with safe defaults
      const limit = validated.limit ?? 100; // Default: 100, max: 500
      const offset = validated.offset ?? 0;
      
      // Validate dates are actually valid (trimmed whitespace already handled)
      if (validated.orderDateFrom) {
        const date = new Date(validated.orderDateFrom);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid orderDateFrom date value", 
            message: `'${validated.orderDateFrom}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }
      if (validated.orderDateTo) {
        const date = new Date(validated.orderDateTo);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid orderDateTo date value",
            message: `'${validated.orderDateTo}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }
      if (validated.invoiceDateFrom) {
        const date = new Date(validated.invoiceDateFrom);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid invoiceDateFrom date value",
            message: `'${validated.invoiceDateFrom}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }
      if (validated.invoiceDateTo) {
        const date = new Date(validated.invoiceDateTo);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid invoiceDateTo date value",
            message: `'${validated.invoiceDateTo}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }

      const client = new ShopwareClient(settings);
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // Fetch all orders with sales channel filtering
      const allOrders = await client.fetchOrders(allowedChannelIds);
      
      // SECURITY: Double-check filtering locally as defense-in-depth
      let filteredOrders = filterOrdersBySalesChannels(allOrders, allowedChannelIds);
      
      // Apply date filters
      if (validated.orderDateFrom) {
        const fromDate = new Date(validated.orderDateFrom);
        filteredOrders = filteredOrders.filter(order => new Date(order.orderDate) >= fromDate);
      }
      
      if (validated.orderDateTo) {
        const toDate = new Date(validated.orderDateTo);
        filteredOrders = filteredOrders.filter(order => new Date(order.orderDate) <= toDate);
      }
      
      if (validated.invoiceDateFrom) {
        const fromDate = new Date(validated.invoiceDateFrom);
        filteredOrders = filteredOrders.filter(order => 
          order.invoiceDate && new Date(order.invoiceDate) >= fromDate
        );
      }
      
      if (validated.invoiceDateTo) {
        const toDate = new Date(validated.invoiceDateTo);
        filteredOrders = filteredOrders.filter(order => 
          order.invoiceDate && new Date(order.invoiceDate) <= toDate
        );
      }
      
      // Apply status filters
      if (validated.status) {
        filteredOrders = filteredOrders.filter(order => order.status === validated.status);
      }
      
      if (validated.paymentStatus) {
        filteredOrders = filteredOrders.filter(order => order.paymentStatus === validated.paymentStatus);
      }
      
      // Apply boolean filters
      if (validated.hasInvoice === 'true') {
        filteredOrders = filteredOrders.filter(order => !!order.invoiceNumber);
      } else if (validated.hasInvoice === 'false') {
        filteredOrders = filteredOrders.filter(order => !order.invoiceNumber);
      }
      
      if (validated.hasDeliveryNote === 'true') {
        filteredOrders = filteredOrders.filter(order => !!order.deliveryNoteNumber);
      } else if (validated.hasDeliveryNote === 'false') {
        filteredOrders = filteredOrders.filter(order => !order.deliveryNoteNumber);
      }
      
      if (validated.paymentOverdue === 'true') {
        filteredOrders = filteredOrders.filter(order => order.isPaymentOverdue === true);
      } else if (validated.paymentOverdue === 'false') {
        filteredOrders = filteredOrders.filter(order => order.isPaymentOverdue !== true);
      }
      
      if (validated.isShipped === 'true') {
        filteredOrders = filteredOrders.filter(order => 
          order.status === 'completed' || (order.shippingInfo && order.shippingInfo.shippedDate)
        );
      } else if (validated.isShipped === 'false') {
        filteredOrders = filteredOrders.filter(order => 
          order.status !== 'completed' && (!order.shippingInfo || !order.shippingInfo.shippedDate)
        );
      }
      
      // Calculate total before pagination
      const total = filteredOrders.length;
      
      // Apply pagination
      const paginatedOrders = filteredOrders.slice(offset, offset + limit);
      
      res.json({
        orders: paginatedOrders,
        total,
        limit,
        offset,
        filters: {
          orderDateFrom: validated.orderDateFrom,
          orderDateTo: validated.orderDateTo,
          invoiceDateFrom: validated.invoiceDateFrom,
          invoiceDateTo: validated.invoiceDateTo,
          status: validated.status,
          paymentStatus: validated.paymentStatus,
          hasInvoice: validated.hasInvoice,
          hasDeliveryNote: validated.hasDeliveryNote,
          paymentOverdue: validated.paymentOverdue,
          isShipped: validated.isShipped,
        },
      });
    } catch (error: any) {
      console.error("Error querying orders:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid query parameters", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to query orders" });
    }
  });

  // Delayed orders route
  app.get("/api/orders/delayed", requireAuth, requireViewDelayedOrders, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrders();
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // SECURITY: Filter by user's assigned sales channels FIRST
      const accessibleOrders = filterOrdersBySalesChannels(orders, allowedChannelIds);
      
      // Default threshold: 3 days
      const daysThreshold = parseInt(req.query.days as string) || 3;
      const now = new Date();
      const thresholdDate = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000);
      
      // Filter delayed orders: deliveryDateLatest passed or order old, not completed/cancelled, and payment is paid
      const delayedOrders = accessibleOrders
        .filter(order => {
          // Must not be completed or cancelled
          const isNotFinished = order.status !== 'completed' && order.status !== 'cancelled';
          
          // Payment must be paid (not failed, cancelled, or open)
          const hasValidPayment = order.paymentStatus === 'paid';
          
          if (!isNotFinished || !hasValidPayment) {
            return false;
          }
          
          // Check if delivery date is overdue or order is old
          if (order.deliveryDateLatest) {
            const deliveryDate = new Date(order.deliveryDateLatest);
            const isOverdue = deliveryDate < thresholdDate;
            return isOverdue;
          } else {
            // Fallback to order date if no delivery date
            const orderDate = new Date(order.orderDate);
            const isOld = orderDate < thresholdDate;
            return isOld;
          }
        })
        .map(order => {
          // Calculate days since expected delivery (or order date as fallback)
          const referenceDate = order.deliveryDateLatest 
            ? new Date(order.deliveryDateLatest)
            : new Date(order.orderDate);
          const daysSinceOrder = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
          
          return {
            ...order,
            daysSinceOrder,
          };
        })
        .sort((a, b) => {
          // Sort by delivery date (latest delivery date first = most overdue)
          const dateA = a.deliveryDateLatest ? new Date(a.deliveryDateLatest) : new Date(a.orderDate);
          const dateB = b.deliveryDateLatest ? new Date(b.deliveryDateLatest) : new Date(b.orderDate);
          return dateA.getTime() - dateB.getTime(); // Earliest date first (most overdue)
        });
      
      res.json(delayedOrders);
    } catch (error: any) {
      console.error("Error fetching delayed orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch delayed orders" });
    }
  });

  // Export orders endpoint
  app.post("/api/orders/export", requireAuth, async (req, res) => {
    try {
      // Validate request body
      const exportSchema = z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        format: z.enum(['csv', 'xlsx', 'json']),
        columns: z.array(z.string()).min(1, "At least one column must be selected"),
        salesChannelIds: z.array(z.string()).optional(), // Admin can select specific channels
      });

      const validated = exportSchema.parse(req.body);
      const { dateFrom, dateTo, format, columns, salesChannelIds } = validated;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allOrders = await client.fetchOrders();

      // Get user information
      const user = req.user as any;
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';

      // Filter by sales channel based on role
      let filteredOrders = allOrders;
      
      if (!isAdmin) {
        // Non-admin users: filter by their assigned sales channels
        const userChannels = user?.salesChannelIds || [];
        if (userChannels.length > 0) {
          filteredOrders = allOrders.filter(order => 
            userChannels.includes(order.salesChannelId)
          );
        } else {
          // If no channels assigned, return empty result
          filteredOrders = [];
        }
      } else if (salesChannelIds && salesChannelIds.length > 0) {
        // Admin users: optionally filter by selected sales channels
        filteredOrders = allOrders.filter(order => 
          salesChannelIds.includes(order.salesChannelId)
        );
      }

      // Filter by date range
      if (dateFrom || dateTo) {
        filteredOrders = filteredOrders.filter(order => {
          const orderDate = new Date(order.orderDate);
          if (dateFrom && orderDate < new Date(dateFrom)) return false;
          if (dateTo && orderDate > new Date(dateTo)) return false;
          return true;
        });
      }

      // Extract only selected columns
      const exportData = filteredOrders.map(order => {
        const row: any = {};
        columns.forEach((col: string) => {
          switch (col) {
            case 'orderNumber':
              row['Order Number'] = order.orderNumber;
              break;
            case 'customerName':
              row['Customer Name'] = order.customerName;
              break;
            case 'customerEmail':
              row['Customer Email'] = order.customerEmail;
              break;
            case 'orderDate':
              row['Order Date'] = new Date(order.orderDate).toLocaleDateString('de-DE');
              break;
            case 'status':
              row['Status'] = order.status;
              break;
            case 'totalAmount':
              row['Total Amount (Gross)'] = `€${order.totalAmount.toFixed(2)}`;
              break;
            case 'netTotalAmount':
              row['Total Amount (Net)'] = `€${(order.netTotalAmount || 0).toFixed(2)}`;
              break;
            case 'carrier':
              row['Carrier'] = order.shippingInfo?.carrier || '';
              break;
            case 'trackingNumber':
              row['Tracking Number'] = order.shippingInfo?.trackingNumber || '';
              break;
            case 'invoiceNumber':
              row['Invoice Number'] = order.invoiceNumber || '';
              break;
            case 'deliveryNoteNumber':
              row['Delivery Note Number'] = order.deliveryNoteNumber || '';
              break;
            case 'erpNumber':
              row['ERP Number'] = order.erpNumber || '';
              break;
          }
        });
        return row;
      });

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.json"`);
        res.send(JSON.stringify(exportData, null, 2));
      } else if (format === 'csv') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.csv"`);
        res.send('\uFEFF' + csv); // BOM for proper UTF-8 encoding in Excel
      } else if (format === 'xlsx') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
        
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.xlsx"`);
        res.send(buffer);
      } else {
        res.status(400).json({ error: 'Invalid format' });
      }
    } catch (error: any) {
      console.error("Error exporting orders:", error);
      
      // Handle Zod validation errors
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }
      
      res.status(500).json({ error: error.message || "Failed to export orders" });
    }
  });

  app.get("/api/orders/:orderId/documents", requireAuth, async (req, res) => {
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

  app.get("/api/orders/:orderId/document/:documentId/:deepLinkCode", requireAuth, async (req, res) => {
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

  app.post("/api/orders/invoices/by-order-numbers", requireAuth, requireViewDocumentsOrAccounting, async (req, res) => {
    try {
      const schema = z.object({
        orderNumbers: z.array(z.string()).min(1, "At least one order number is required"),
      });

      const validated = schema.parse(req.body);
      const normalizedOrderNumbers = Array.from(
        new Set(validated.orderNumbers.map((orderNumber) => orderNumber.trim()).filter(Boolean))
      );

      if (normalizedOrderNumbers.length === 0) {
        return res.status(400).json({ error: "No valid order numbers provided" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
      } catch (authError) {
        console.error(`[/api/orders/invoices/by-order-numbers] SECURITY: Auth error during channel filter:`, authError);
        return res.status(403).json({ error: "Unauthorized: No authenticated user found" });
      }

      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return res.json({
          results: normalizedOrderNumbers.map((orderNumber) => ({
            orderNumber,
            status: "forbidden",
            message: "No sales channel access",
          })),
        });
      }

      const client = new ShopwareClient(settings);
      const results = await Promise.all(
        normalizedOrderNumbers.map(async (orderNumber) => {
          try {
            const order = await client.fetchOrderByNumber(orderNumber, allowedChannelIds);
            if (!order?.id) {
              return {
                orderNumber,
                status: "not_found",
                message: "Order not found or access denied",
              };
            }

            const documents = await client.fetchOrderDocuments(order.id);
            const invoiceDocument = getRealInvoiceDocument(documents);
            if (!invoiceDocument) {
              return {
                orderNumber,
                orderId: order.id,
                status: "no_invoice",
                message: "No invoice document found",
              };
            }

            if (!invoiceDocument.deepLinkCode) {
              return {
                orderNumber,
                orderId: order.id,
                status: "error",
                message: "Invoice document is missing deep link code",
              };
            }

            return {
              orderNumber,
              orderId: order.id,
              status: "ok",
              downloadUrl: `/api/orders/${order.id}/document/${invoiceDocument.id}/${invoiceDocument.deepLinkCode}`,
              filename: `invoice-${orderNumber}.pdf`,
            };
          } catch (error: any) {
            return {
              orderNumber,
              status: "error",
              message: error?.message || "Failed to resolve invoice",
            };
          }
        })
      );

      res.json({ results });
    } catch (error: any) {
      console.error("Error resolving invoices by order numbers:", error);

      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }

      res.status(500).json({ error: error.message || "Failed to resolve invoices" });
    }
  });

  // Get customer order history by email (lightweight for display in order detail)
  app.get("/api/orders/:orderId/customer-history", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const { email, limit } = req.query;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: "Customer email is required" });
      }

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
      } catch (authError) {
        console.error(`[/api/orders/:orderId/customer-history] SECURITY: Auth error during channel filter:`, authError);
        return res.json([]);
      }

      // SECURITY: If user has empty array (explicitly no access to any channel), return empty results
      // null = full access (admin), [] = no access, [...ids] = specific channel access
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        console.log(`[/api/orders/:orderId/customer-history] SECURITY: User has no channel access, returning empty results`);
        return res.json([]);
      }

      const client = new ShopwareClient(settings);
      const customerOrders = await client.fetchCustomerOrderHistory(
        email,
        orderId,
        limit ? parseInt(limit as string, 10) : 10,
        allowedChannelIds
      );

      res.json(customerOrders);
    } catch (error: any) {
      console.error("Error fetching customer order history:", error);
      res.status(500).json({ error: error.message || "Failed to fetch customer order history" });
    }
  });

  // Get ticket counts for all orders (must come before /api/orders/:orderId)
  app.get("/api/orders/ticket-counts", requireAuth, async (req, res) => {
    try {
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      const tickets = await storage.getAllTickets();

      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const user = req.user as any;
      let filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, user?.id);

      // Filter out standalone tickets (no orderId) for counts
      filteredTickets = filteredTickets.filter(ticket => ticket.orderId);

      const ticketCounts: Record<string, number> = {};
      filteredTickets.forEach(ticket => {
        if (ticket.orderId) {
          ticketCounts[ticket.orderId] = (ticketCounts[ticket.orderId] || 0) + 1;
        }
      });

      res.json(ticketCounts);
    } catch (error: any) {
      console.error("Error fetching ticket counts:", error);
      res.status(500).json({ error: "Failed to fetch ticket counts" });
    }
  });

  // Get single order by ID (with sales channel access enforcement)
  app.get("/api/orders/:orderId", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
      } catch (authError) {
        console.error(`[/api/orders/:orderId] SECURITY: Auth error during channel filter:`, authError);
        return res.status(403).json({ error: "Access denied: authentication error" });
      }

      // SECURITY: If user has empty array (explicitly no access to any channel), deny access
      // null = full access (admin), [] = no access, [...ids] = specific channel access
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        console.log(`[/api/orders/:orderId] SECURITY: User has no channel access, denying request`);
        return res.status(403).json({ error: "Access denied: no sales channel permissions" });
      }

      const client = new ShopwareClient(settings);
      const order = await client.fetchOrderById(orderId, allowedChannelIds);

      if (!order) {
        return res.status(404).json({ error: "Order not found or access denied" });
      }

      res.json(order);
    } catch (error: any) {
      console.error("Error fetching order:", error);
      res.status(500).json({ error: error.message || "Failed to fetch order" });
    }
  });

  // Update order shipping information and set status to shipped
  app.patch("/api/orders/:orderId/shipping", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const shippingInfo = req.body;

      // Validate shipping info
      if (!shippingInfo.carrier && !shippingInfo.trackingNumber && !shippingInfo.shippedDate) {
        return res.status(400).json({ error: "At least one shipping field is required" });
      }

      const client = new ShopwareClient(settings);
      
      // Update shipping info and set status to shipped in Shopware
      await client.updateOrderShipping(orderId, shippingInfo);
      
      res.json({ 
        success: true,
        message: "Shipping information updated and order marked as shipped",
        orderId,
        shippingInfo
      });
    } catch (error: any) {
      console.error("Error updating order shipping:", error);
      res.status(500).json({ error: error.message || "Failed to update shipping information" });
    }
  });

  // Create documents in Shopware and update custom fields
  app.patch("/api/orders/:orderId/documents", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      let { invoiceNumber, vorkasseInvoiceNumber, deliveryNoteNumber, erpNumber } = req.body;

      // Convert empty strings to undefined (Shopware rejects empty strings)
      invoiceNumber = invoiceNumber?.trim() || undefined;
      vorkasseInvoiceNumber = vorkasseInvoiceNumber?.trim() || undefined;
      deliveryNoteNumber = deliveryNoteNumber?.trim() || undefined;
      erpNumber = erpNumber?.trim() || undefined;

      // Validate that at least one document field is provided
      if (!invoiceNumber && !vorkasseInvoiceNumber && !deliveryNoteNumber && !erpNumber) {
        return res.status(400).json({ error: "At least one document number is required" });
      }

      const client = new ShopwareClient(settings);
      
      // Track outcomes for response
      const results = {
        invoiceCreated: false,
        invoiceSkipped: false,
        vorkasseInvoiceCreated: false,
        vorkasseInvoiceSkipped: false,
        deliveryNoteCreated: false,
        deliveryNoteSkipped: false,
        customFieldsUpdated: false,
      };

      // PREFLIGHT: Check ALL documents for conflicts BEFORE creating anything
      let invoiceCheck: { exists: boolean; documentNumber?: string; documentId?: string; conflict: boolean } | null = null;
      let deliveryCheck: { exists: boolean; documentNumber?: string; documentId?: string; conflict: boolean } | null = null;

      if (invoiceNumber) {
        invoiceCheck = await client.checkExistingDocument(orderId, 'invoice', invoiceNumber);
        if (invoiceCheck.conflict) {
          return res.status(409).json({ 
            error: "Invoice number conflict",
            message: `Order already has invoice ${invoiceCheck.documentNumber}, cannot create invoice ${invoiceNumber}`,
            existingNumber: invoiceCheck.documentNumber,
            requestedNumber: invoiceNumber,
            documentType: 'invoice',
          });
        }
      }

      if (deliveryNoteNumber) {
        deliveryCheck = await client.checkExistingDocument(orderId, 'delivery_note', deliveryNoteNumber);
        if (deliveryCheck.conflict) {
          return res.status(409).json({ 
            error: "Delivery note number conflict",
            message: `Order already has delivery note ${deliveryCheck.documentNumber}, cannot create delivery note ${deliveryNoteNumber}`,
            existingNumber: deliveryCheck.documentNumber,
            requestedNumber: deliveryNoteNumber,
            documentType: 'delivery_note',
          });
        }
      }

      // CREATE: All preflight checks passed, now create documents
      const errors: string[] = [];
      
      // ===== DEBUG LOGGING: REQUEST RECEIVED =====
      console.log(`[DEBUG] Document creation request for order ${orderId}:`, {
        invoiceNumber,
        deliveryNoteNumber,
        erpNumber,
        invoiceCheck: invoiceCheck ? { exists: invoiceCheck.exists, documentNumber: invoiceCheck.documentNumber } : null,
        deliveryCheck: deliveryCheck ? { exists: deliveryCheck.exists, documentNumber: deliveryCheck.documentNumber } : null,
      });
      // ==========================================
      
      // Create invoice if needed (independent operation)
      if (invoiceNumber && invoiceCheck && !invoiceCheck.exists) {
        try {
          console.log(`[Orders] Creating invoice ${invoiceNumber} for order ${orderId}`);
          console.log(`[DEBUG] Calling client.createInvoice with:`, { orderId, invoiceNumber, erpNumber });
          await client.createInvoice(orderId, invoiceNumber, erpNumber);
          console.log(`[DEBUG] ✓ client.createInvoice succeeded`);
          results.invoiceCreated = true;

          // Poll for document generation (Shopware uses async message queue)
          let pdfUrl: string | undefined = undefined;
          let invoiceId: string | undefined = undefined;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000)); // First check after 0.5s
            try {
              const docs = await client.fetchOrderDocuments(orderId);
              console.log(`[DEBUG] Poll attempt ${attempt + 1}: Found ${docs.length} documents for order ${orderId}`);
              
              // Find invoice by number, or fallback to newest invoice
              let invoice = docs.find(d => d.type === 'invoice' && d.number === invoiceNumber);
              if (!invoice) {
                // Fallback: find any invoice with matching number prefix
                invoice = docs.find(d => d.type === 'invoice' && d.number.includes(invoiceNumber));
              }
              if (!invoice) {
                // Fallback: get newest invoice (documents are usually returned newest first)
                invoice = docs.find(d => d.type === 'invoice');
              }
              
              if (invoice && invoice.deepLinkCode) {
                invoiceId = invoice.id; // Capture Shopware document UUID
                pdfUrl = `${settings.shopwareUrl}/api/_action/document/${invoice.id}/${invoice.deepLinkCode}?download=1`;
                console.log(`[DEBUG] Invoice PDF URL found: ${pdfUrl} (doc ${invoice.number}, id ${invoiceId})`);
                break;
              } else if (invoice) {
                console.log(`[DEBUG] Invoice found but missing deepLinkCode:`, invoice);
              }
            } catch (err) {
              console.error(`[DEBUG] Attempt ${attempt + 1} to fetch invoice document failed:`, err);
            }
          }

          // Trigger webhook for document.created (invoice)
          webhookService.trigger("document.created", {
            documentType: "invoice",
            orderId: orderId,
            orderNumber: invoiceNumber,
            documentNumber: invoiceNumber,
            pdfUrl: pdfUrl, // Will be undefined if document not yet generated
            createdAt: new Date().toISOString(),
          }, {
            source: "document_creation",
            actorType: "system",
            actorId: "system",
            erpNumber: erpNumber || null,
            orderId: orderId,
            documentType: "invoice",
            invoiceNumber: invoiceNumber,
            invoiceId: invoiceId, // Shopware document UUID for correlation
          }).catch(err => {
            console.error("Error triggering document.created webhook for invoice:", err);
          });
        } catch (invoiceError: any) {
          console.error(`[Orders] Failed to create invoice for order ${orderId}:`, invoiceError);
          console.error(`[DEBUG] Invoice error details:`, {
            message: invoiceError.message,
            stack: invoiceError.stack,
            response: invoiceError.response?.data || invoiceError.response,
          });
          errors.push(`Invoice creation failed: ${invoiceError.message}`);
        }
      } else if (invoiceNumber && invoiceCheck && invoiceCheck.exists) {
        console.log(`[Orders] Invoice ${invoiceNumber} already exists for order ${orderId}, skipping creation`);
        results.invoiceSkipped = true;
      }

      // Create Vorkasse invoice document if needed (same as invoice, number e.g. VKRE-…)
      if (vorkasseInvoiceNumber) {
        const docs = await client.fetchOrderDocuments(orderId);
        const existingVorkasse = docs.find((d: { number: string }) => d.number === vorkasseInvoiceNumber);
        if (!existingVorkasse) {
          try {
            console.log(`[Orders] Creating Vorkasse invoice ${vorkasseInvoiceNumber} for order ${orderId}`);
            await client.createInvoice(orderId, vorkasseInvoiceNumber, erpNumber);
            results.vorkasseInvoiceCreated = true;
          } catch (vorkasseError: any) {
            console.error(`[Orders] Failed to create Vorkasse invoice for order ${orderId}:`, vorkasseError);
            errors.push(`Vorkasse-Rechnung: ${vorkasseError.message}`);
          }
        } else {
          console.log(`[Orders] Vorkasse invoice ${vorkasseInvoiceNumber} already exists for order ${orderId}, skipping creation`);
          results.vorkasseInvoiceSkipped = true;
        }
      }

      // Create delivery note if needed (independent operation)
      if (deliveryNoteNumber && deliveryCheck && !deliveryCheck.exists) {
        try {
          console.log(`[Orders] Creating delivery note ${deliveryNoteNumber} for order ${orderId}`);
          console.log(`[DEBUG] Calling client.createDeliveryNote with:`, { orderId, deliveryNoteNumber, erpNumber });
          await client.createDeliveryNote(orderId, deliveryNoteNumber, erpNumber);
          console.log(`[DEBUG] ✓ client.createDeliveryNote succeeded`);
          results.deliveryNoteCreated = true;

          // Poll for document generation (Shopware uses async message queue)
          let pdfUrl: string | undefined = undefined;
          let deliveryNoteId: string | undefined = undefined;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000)); // First check after 0.5s
            try {
              const docs = await client.fetchOrderDocuments(orderId);
              console.log(`[DEBUG] Poll attempt ${attempt + 1}: Found ${docs.length} documents for order ${orderId}`);
              
              // Find delivery note by number, or fallback to newest delivery note
              let deliveryNote = docs.find(d => d.type === 'delivery_note' && d.number === deliveryNoteNumber);
              if (!deliveryNote) {
                // Fallback: find any delivery note with matching number prefix
                deliveryNote = docs.find(d => d.type === 'delivery_note' && d.number.includes(deliveryNoteNumber));
              }
              if (!deliveryNote) {
                // Fallback: get newest delivery note
                deliveryNote = docs.find(d => d.type === 'delivery_note');
              }
              
              if (deliveryNote && deliveryNote.deepLinkCode) {
                deliveryNoteId = deliveryNote.id; // Capture Shopware document UUID
                pdfUrl = `${settings.shopwareUrl}/api/_action/document/${deliveryNote.id}/${deliveryNote.deepLinkCode}?download=1`;
                console.log(`[DEBUG] Delivery note PDF URL found: ${pdfUrl} (doc ${deliveryNote.number}, id ${deliveryNoteId})`);
                break;
              } else if (deliveryNote) {
                console.log(`[DEBUG] Delivery note found but missing deepLinkCode:`, deliveryNote);
              }
            } catch (err) {
              console.error(`[DEBUG] Attempt ${attempt + 1} to fetch delivery note document failed:`, err);
            }
          }

          // Trigger webhook for document.created (delivery note)
          webhookService.trigger("document.created", {
            documentType: "delivery_note",
            orderId: orderId,
            orderNumber: deliveryNoteNumber,
            documentNumber: deliveryNoteNumber,
            pdfUrl: pdfUrl, // Will be undefined if document not yet generated
            createdAt: new Date().toISOString(),
          }, {
            source: "document_creation",
            actorType: "system",
            actorId: "system",
            erpNumber: erpNumber || null,
            orderId: orderId,
            documentType: "delivery_note",
            deliveryNoteNumber: deliveryNoteNumber,
            deliveryNoteId: deliveryNoteId, // Shopware document UUID for correlation
          }).catch(err => {
            console.error("Error triggering document.created webhook for delivery note:", err);
          });
        } catch (deliveryError: any) {
          console.error(`[Orders] Failed to create delivery note for order ${orderId}:`, deliveryError);
          console.error(`[DEBUG] Delivery note error details:`, {
            message: deliveryError.message,
            stack: deliveryError.stack,
            response: deliveryError.response?.data || deliveryError.response,
          });
          errors.push(`Delivery note creation failed: ${deliveryError.message}`);
        }
      } else if (deliveryNoteNumber && deliveryCheck && deliveryCheck.exists) {
        console.log(`[Orders] Delivery note ${deliveryNoteNumber} already exists for order ${orderId}, skipping creation`);
        results.deliveryNoteSkipped = true;
      }

      // UPDATE: Always update custom fields (even if document creation partially failed)
      try {
        await client.updateOrderDocumentNumbers(orderId, {
          invoiceNumber,
          vorkasseInvoiceNumber,
          deliveryNoteNumber,
          erpNumber
        });
        results.customFieldsUpdated = true;
        console.log(`[Orders] Custom fields updated for order ${orderId}`);
      } catch (customFieldError: any) {
        console.error(`[Orders] Failed to update custom fields for order ${orderId}:`, customFieldError);
        errors.push(`Custom field update failed: ${customFieldError.message}`);
      }

      // Determine response based on results
      const hasErrors = errors.length > 0;
      const hasSuccess = results.invoiceCreated || results.invoiceSkipped ||
                         results.vorkasseInvoiceCreated || results.vorkasseInvoiceSkipped ||
                         results.deliveryNoteCreated || results.deliveryNoteSkipped ||
                         results.customFieldsUpdated;
      const partialSuccess = hasSuccess && hasErrors;
      
      console.log(`[Orders] Document operation completed for order ${orderId}:`, {
        results,
        errors: errors.length > 0 ? errors : undefined
      });

      // Return appropriate response
      if (!hasErrors) {
        // Complete success
        return res.json({ 
          success: true,
          message: "Document operation completed successfully",
          orderId,
          documents: {
            invoiceNumber,
            vorkasseInvoiceNumber,
            deliveryNoteNumber,
            erpNumber
          },
          results,
        });
      } else if (partialSuccess) {
        // Partial success - some operations succeeded, some failed
        return res.status(207).json({ 
          success: false,
          partial: true,
          message: "Document operation partially completed",
          orderId,
          documents: {
            invoiceNumber,
            vorkasseInvoiceNumber,
            deliveryNoteNumber,
            erpNumber
          },
          results,
          errors,
        });
      } else {
        // Complete failure - nothing succeeded
        return res.status(502).json({ 
          success: false,
          message: "Document operation failed",
          orderId,
          results,
          errors,
        });
      }
    } catch (error: any) {
      console.error("Error in document operation:", error);
      
      // Handle Shopware API errors
      if (error.message?.includes('Failed to create invoice') || 
          error.message?.includes('Failed to create delivery note')) {
        return res.status(502).json({ 
          error: "Shopware API error",
          message: error.message || "Failed to create document in Shopware" 
        });
      }
      
      res.status(500).json({ error: error.message || "Failed to process document operation" });
    }
  });

  // Create proforma invoice for an order
  app.post("/api/orders/:orderId/proforma", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const client = new ShopwareClient(settings);

      console.log(`[Proforma] Creating proforma invoice for order ${orderId}`);

      // Fetch order data to get additional fields
      const order = await client.fetchOrderById(orderId, null); // null = admin access
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const buyerReference = order.customFields?.custom_buyerreference_invoice;
      const customerComment = order.customerComment;

      console.log(`[Proforma] Order data: buyerReference=${buyerReference}, customerComment=${customerComment}`);

      // Check if proforma invoice already exists
      const documents = await client.fetchOrderDocuments(orderId);
      const existingProforma = documents.find((doc: any) => 
        doc.type === 'proforma_invoice' || 
        (doc.type === 'invoice' && order.proformaNumber && doc.number === order.proformaNumber)
      );

      if (existingProforma) {
        return res.status(409).json({
          error: "Proforma invoice already exists",
          message: `Order already has proforma invoice ${existingProforma.number}`,
          proformaNumber: existingProforma.number,
        });
      }

      const numberRangeSettings = await storage.getProformaNumberRangeSettings();
      const resolvedRange = numberRangeSettings ?? defaultProformaNumberRange;
      const nextNumber = resolvedRange.nextNumber ?? defaultProformaNumberRange.nextNumber;
      const padding = resolvedRange.padding ?? defaultProformaNumberRange.padding;
      const prefix = resolvedRange.prefix ?? defaultProformaNumberRange.prefix;
      const numberPart = padding > 0
        ? String(nextNumber).padStart(padding, "0")
        : String(nextNumber);
      const proformaNumberCandidate = `${prefix}${numberPart}`;

      // Create proforma invoice
      const { documentId, invoiceNumber } = await client.createProformaInvoice(
        orderId,
        buyerReference,
        customerComment,
        proformaNumberCandidate
      );
      const finalProformaNumber = invoiceNumber || proformaNumberCandidate;

      console.log(`[Proforma] Proforma invoice created: ${finalProformaNumber} (Document ID: ${documentId})`);

      // Update order custom field with proforma number
      await client.updateOrderDocumentNumbers(orderId, {
        proformaNumber: finalProformaNumber,
      });

      console.log(`[Proforma] Updated order custom field: custom_order_proforma_number = ${finalProformaNumber}`);

      await storage.saveProformaNumberRangeSettings({
        prefix,
        padding,
        nextNumber: nextNumber + 1,
      });

      // Poll for PDF URL
      let pdfUrl: string | undefined = undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000));
        try {
          const docs = await client.fetchOrderDocuments(orderId);
          const proforma = docs.find((d: any) => d.number === finalProformaNumber);
          
          if (proforma && proforma.deepLinkCode) {
            pdfUrl = `${settings.shopwareUrl}/api/_action/document/${proforma.id}/${proforma.deepLinkCode}?download=1`;
            console.log(`[Proforma] PDF URL found: ${pdfUrl}`);
            break;
          }
        } catch (err) {
          console.error(`[Proforma] Attempt ${attempt + 1} to fetch PDF failed:`, err);
        }
      }

      // Trigger webhook (optional)
      const documentType: DocumentCreatedPayload["documentType"] = "proforma_invoice";
      webhookService.trigger("document.created", {
        documentType,
        orderId: orderId,
        orderNumber: order.orderNumber,
        documentNumber: finalProformaNumber,
        pdfUrl: pdfUrl,
        createdAt: new Date().toISOString(),
      }, {
        source: "proforma_creation",
        actorType: "user",
        actorId: (req.user as any)?.id || "system",
        orderId: orderId,
        documentType,
        proformaNumber: finalProformaNumber,
        documentId: documentId,
      }).catch(err => {
        console.error("Error triggering document.created webhook for proforma:", err);
      });

      res.json({
        success: true,
        message: "Proforma invoice created successfully",
        orderId,
        proformaNumber: finalProformaNumber,
        documentId,
        pdfUrl,
      });
    } catch (error: any) {
      console.error("Error creating proforma invoice:", error);
      
      if (error.message?.includes('Failed to create proforma invoice')) {
        return res.status(502).json({
          error: "Shopware API error",
          message: error.message || "Failed to create proforma invoice in Shopware"
        });
      }
      
      res.status(500).json({ 
        error: error.message || "Failed to create proforma invoice" 
      });
    }
  });

  // Abschlussrechnung (PDF in METAorder, nicht Shopware-Dokument)
  app.post(
    "/api/orders/:orderId/settlement-invoice/pdf",
    requireAuth,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const access = await assertInstallmentOrderAccess(req, req.params.orderId, tenantId);
        if (!access.ok) {
          return res.status(access.status).json(access.body);
        }

        const parsed = settlementInvoicePdfBodySchema.safeParse(req.body);
        if (!parsed.success) {
          const msg = parsed.error.issues[0]?.message || "Ungültige Eingabe";
          return res.status(400).json({ error: msg });
        }
        const body = parsed.data;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const client = new ShopwareClient(settings);
        const order = await client.fetchOrderById(req.params.orderId, null);
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        let invoiceDate = new Date();
        if (body.invoiceDate?.trim()) {
          const d = new Date(body.invoiceDate.trim());
          if (!Number.isNaN(d.getTime())) {
            invoiceDate = d;
          }
        }

        const balanceGross =
          Math.round((body.originalAmountGross - body.stornoAmountGross) * 100) / 100;

        let billingAddress: SettlementInvoicePdfInput["billingAddress"] = null;
        if (order.billingAddress) {
          billingAddress = order.billingAddress;
        }

        const pdfInput: SettlementInvoicePdfInput = {
          settlementInvoiceNumber: body.settlementInvoiceNumber.trim(),
          originalInvoiceNumber: body.originalInvoiceNumber.trim(),
          originalAmountGross: body.originalAmountGross,
          stornoInvoiceNumber: body.stornoInvoiceNumber.trim(),
          stornoAmountGross: body.stornoAmountGross,
          balanceGross,
          invoiceDate,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          billingAddress,
        };

        const pdfBuffer = await generateSettlementInvoicePdf(pdfInput);
        const safeName = body.settlementInvoiceNumber.trim().replace(/[^\w.-]+/g, "_");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="abschlussrechnung-${safeName}.pdf"`,
        );
        res.send(pdfBuffer);
      } catch (error: any) {
        console.error("settlement-invoice pdf:", error);
        res.status(500).json({ error: error.message || "Failed to generate settlement invoice PDF" });
      }
    },
  );

  // Nachberechnung (PDF + Upload als Shopware-Rechnungsdokument)
  app.post(
    "/api/orders/:orderId/additional-invoice",
    requireAuth,
    requireCsrf,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const access = await assertInstallmentOrderAccess(req, req.params.orderId, tenantId);
        if (!access.ok) {
          return res.status(access.status).json(access.body);
        }

        const parsed = additionalInvoiceBodySchema.safeParse(req.body);
        if (!parsed.success) {
          const msg = parsed.error.issues[0]?.message || "Ungültige Eingabe";
          return res.status(400).json({ error: msg });
        }
        const body = parsed.data;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const client = new ShopwareClient(settings);
        const order = await client.fetchOrderById(req.params.orderId, null);
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        let invoiceDate = new Date();
        if (body.invoiceDate?.trim()) {
          const d = new Date(body.invoiceDate.trim());
          if (!Number.isNaN(d.getTime())) {
            invoiceDate = d;
          }
        }

        const pdfBuffer = await generateAdditionalInvoicePdf({
          invoiceNumber: body.invoiceNumber.trim(),
          invoiceDate,
          referenceInvoiceNumber: body.referenceInvoiceNumber?.trim() || null,
          note: body.note?.trim() || null,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          billingAddress: order.billingAddress ?? null,
          items: body.items.map((item) => ({
            description: item.description.trim(),
            quantity: item.quantity,
            unitNetPrice: item.unitNetPrice,
            vatRate: item.vatRate,
          })),
        });

        const safeName = body.invoiceNumber.trim().replace(/[^\w.-]+/g, "_");
        const uploadResult = await client.uploadOrderDocumentPdf(
          req.params.orderId,
          pdfBuffer,
          `nachberechnung-${safeName}.pdf`,
          {
            preferredTechnicalName: "invoice",
            documentNumber: body.invoiceNumber.trim(),
          },
        );

        if (!uploadResult.documentId) {
          return res.status(502).json({
            error: "Shopware upload failed",
            message: "PDF wurde erzeugt, konnte aber nicht als Bestelldokument hinterlegt werden",
          });
        }

        res.json({
          ok: true,
          documentId: uploadResult.documentId,
          documentNumber: uploadResult.documentNumber,
        });
      } catch (error: any) {
        console.error("additional-invoice:", error);
        res.status(500).json({ error: error.message || "Failed to create additional invoice" });
      }
    },
  );

  // --- Teilzahlungspläne / Ratenzahlung ---
  app.get("/api/orders/:orderId/installment-plans", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const access = await assertInstallmentOrderAccess(req, req.params.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const plans = await storage.getInstallmentPlansByOrder(req.params.orderId, tenantId);
      const withInv = await Promise.all(
        plans.map(async (p) => {
          const inv = await storage.getInstallmentInvoices(p.id, tenantId);
          return serializeInstallmentPlan(p, inv);
        })
      );
      res.json(withInv);
    } catch (error: any) {
      console.error("installment-plans list:", error);
      res.status(500).json({ error: error.message || "Failed to load installment plans" });
    }
  });

  app.post("/api/orders/:orderId/installment-plans", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const userId = (req.user as any)?.id as string | undefined;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const body = createInstallmentPlanBodySchema.parse(req.body);
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      const order = await client.fetchOrderById(req.params.orderId, null);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      const total = orderTotalAmountNumber(order);

      let depositAmount: number;
      let depositPercent: number | null = null;
      if (body.depositPercent) {
        depositPercent = body.depositPercent;
        depositAmount = Math.round(total * depositPercent) / 100;
      } else if (body.depositAmount) {
        depositAmount = body.depositAmount;
      } else {
        return res.status(400).json({ error: "depositAmount oder depositPercent erforderlich" });
      }

      if (depositAmount >= total || depositAmount <= 0) {
        return res.status(400).json({ error: "Anzahlung muss größer als 0 und kleiner als der Gesamtbetrag sein" });
      }
      const remaining = Math.round((total - depositAmount) * 100) / 100;
      const n = body.numberOfInstallments;
      const installmentAmounts = splitRemainingInstallments(remaining, n);
      const avgInstallment = installmentAmounts[0] ?? remaining / n;
      const dueDates = body.dueDates;

      const invoiceRows: Array<{
        type: string;
        sequenceNumber: number;
        invoiceNumber: string;
        amount: string;
        dueDate: Date | null;
        status: string;
      }> = [
        {
          type: "deposit",
          sequenceNumber: 0,
          invoiceNumber: body.depositInvoiceNumber.trim(),
          amount: depositAmount.toFixed(2),
          dueDate: dueDates?.[0] ? new Date(dueDates[0]) : null,
          status: "pending",
        },
      ];
      for (let i = 0; i < n; i++) {
        invoiceRows.push({
          type: "installment",
          sequenceNumber: i + 1,
          invoiceNumber: body.installmentInvoiceNumbers[i]!.trim(),
          amount: installmentAmounts[i]!.toFixed(2),
          dueDate: dueDates?.[i + 1] ? new Date(dueDates[i + 1]!) : null,
          status: "pending",
        });
      }

      const { plan, invoices } = await storage.createInstallmentPlanWithInvoices(
        {
          orderId: req.params.orderId,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail ?? null,
          totalAmount: total.toFixed(2),
          depositAmount: depositAmount.toFixed(2),
          depositPercent: depositPercent?.toFixed(2) ?? null,
          depositInvoiceNumber: body.depositInvoiceNumber.trim(),
          remainingAmount: remaining.toFixed(2),
          numberOfInstallments: n,
          installmentAmount: avgInstallment.toFixed(2),
          status: "draft",
          agreementPdfPath: null,
          agreementConfirmedAt: null,
          agreementConfirmedBy: null,
          createdBy: userId,
        },
        invoiceRows,
        tenantId
      );

      res.status(201).json(serializeInstallmentPlan(plan, invoices));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      console.error("installment-plans create:", error);
      res.status(500).json({ error: error.message || "Failed to create installment plan" });
    }
  });

  app.get("/api/installment-plans/:planId", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      res.json(serializeInstallmentPlan(plan, invoices));
    } catch (error: any) {
      console.error("installment-plans get:", error);
      res.status(500).json({ error: error.message || "Failed to load plan" });
    }
  });

  app.patch("/api/installment-plans/:planId", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "draft") {
        return res.status(400).json({ error: "Plan kann nur im Entwurfsstatus bearbeitet werden" });
      }
      const schema = z.object({
        customerName: z.string().min(1).optional(),
        customerEmail: z.string().optional().nullable(),
      });
      const updates = schema.parse(req.body);
      const updated = await storage.updateInstallmentPlan(req.params.planId, updates, tenantId);
      if (!updated) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const invoices = await storage.getInstallmentInvoices(updated.id, tenantId);
      res.json(serializeInstallmentPlan(updated, invoices));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      console.error("installment-plans patch:", error);
      res.status(500).json({ error: error.message || "Failed to update plan" });
    }
  });

  app.delete("/api/installment-plans/:planId", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "draft") {
        return res.status(400).json({ error: "Nur Entwürfe können gelöscht werden" });
      }
      const ok = await storage.deleteInstallmentPlan(req.params.planId, tenantId);
      res.json({ success: ok });
    } catch (error: any) {
      console.error("installment-plans delete:", error);
      res.status(500).json({ error: error.message || "Failed to delete plan" });
    }
  });

  app.post("/api/installment-plans/:planId/send-agreement", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "draft") {
        return res.status(400).json({ error: "Vereinbarung nur aus Entwurf sendbar" });
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      const lines: InstallmentAgreementLine[] = invoices.map((inv) => ({
        kind: inv.type === "deposit" ? "deposit" : "installment",
        sequenceNumber: inv.sequenceNumber,
        invoiceNumber: inv.invoiceNumber || "—",
        amount: decimalNum(inv.amount as any),
        dueDate: inv.dueDate,
      }));
      const pdfInput = {
        orderNumber: plan.orderNumber,
        customerName: plan.customerName,
        customerEmail: plan.customerEmail,
        totalAmount: decimalNum(plan.totalAmount as any),
        depositAmount: decimalNum(plan.depositAmount as any),
        remainingAmount: decimalNum(plan.remainingAmount as any),
        numberOfInstallments: plan.numberOfInstallments,
        lines,
      };
      const pdfBuffer = await generateInstallmentAgreementPdf(pdfInput);
      const dir = path.join(getUploadsRoot(), "installment-agreements");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${plan.id}.pdf`);
      await fs.writeFile(filePath, pdfBuffer);
      const updated = await storage.updateInstallmentPlan(
        req.params.planId,
        { agreementPdfPath: filePath, status: "pending_confirmation" },
        tenantId
      );
      if (!updated) {
        return res.status(500).json({ error: "Failed to update plan" });
      }
      res.json({
        success: true,
        plan: serializeInstallmentPlan(updated, invoices),
        pdfPath: filePath,
      });
    } catch (error: any) {
      console.error("installment send-agreement:", error);
      res.status(500).json({ error: error.message || "Failed to generate agreement" });
    }
  });

  const confirmInstallmentSchema = z.object({
    confirmedBy: z.string().min(1, "Name oder Kennung des Bestätigenden erforderlich"),
  });

  app.post("/api/installment-plans/:planId/confirm", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const { confirmedBy } = confirmInstallmentSchema.parse(req.body);
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "pending_confirmation") {
        return res.status(400).json({ error: "Bestätigung nur im Status „Vereinbarung ausstehend“ möglich" });
      }
      const now = new Date();
      const updated = await storage.updateInstallmentPlan(
        req.params.planId,
        {
          status: "active",
          agreementConfirmedAt: now,
          agreementConfirmedBy: confirmedBy.trim(),
        },
        tenantId
      );
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      res.json(serializeInstallmentPlan(updated!, invoices));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      console.error("installment confirm:", error);
      res.status(500).json({ error: error.message || "Failed to confirm" });
    }
  });

  app.post(
    "/api/installment-plans/:planId/invoices/:invoiceId/mark-paid",
    requireAuth,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
        if (!plan) {
          return res.status(404).json({ error: "Plan not found" });
        }
        if (plan.status !== "active") {
          return res.status(400).json({ error: "Zahlungen nur bei aktivem Plan markierbar" });
        }
        const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
        const inv = invoices.find((i) => i.id === req.params.invoiceId);
        if (!inv) {
          return res.status(404).json({ error: "Invoice not found" });
        }
        if (inv.status === "cancelled") {
          return res.status(400).json({ error: "Stornierte Position" });
        }
        const paidAt = new Date();
        await storage.updateInstallmentInvoice(
          req.params.invoiceId,
          { status: "paid", paidAt },
          tenantId
        );
        const fresh = await storage.getInstallmentInvoices(plan.id, tenantId);
        const nonCancelled = fresh.filter((i) => i.status !== "cancelled");
        const allPaid =
          nonCancelled.length > 0 && nonCancelled.every((i) => i.status === "paid");
        let planRow = plan;
        if (allPaid) {
          const u = await storage.updateInstallmentPlan(req.params.planId, { status: "completed" }, tenantId);
          if (u) planRow = u;
        }
        const finalInv = await storage.getInstallmentInvoices(plan.id, tenantId);
        res.json(serializeInstallmentPlan(planRow, finalInv));
      } catch (error: any) {
        console.error("installment mark-paid:", error);
        res.status(500).json({ error: error.message || "Failed to mark paid" });
      }
    }
  );

  app.get("/api/installment-plans/:planId/agreement-pdf", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      if (!plan.agreementPdfPath) {
        return res.status(404).json({ error: "No agreement PDF yet" });
      }
      const abs = resolveAttachmentPath(plan.agreementPdfPath);
      if (!abs.includes(`${path.sep}installment-agreements${path.sep}`)) {
        return res.status(400).json({ error: "Invalid agreement path" });
      }
      const buf = await fs.readFile(abs);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="teilzahlungsvereinbarung-${plan.orderNumber}.pdf"`
      );
      res.send(buf);
    } catch (error: any) {
      console.error("installment agreement-pdf:", error);
      res.status(500).json({ error: error.message || "Failed to read PDF" });
    }
  });

  // --- Einzelne Teilrechnung / Anzahlungsrechnung als PDF ---
  app.get("/api/installment-plans/:planId/invoices/:invoiceId/pdf", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      const inv = invoices.find((i) => i.id === req.params.invoiceId);
      if (!inv) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      let billingAddress: InstallmentInvoicePdfInput["billingAddress"] = null;
      try {
        const settings = await storage.getShopwareSettings(tenantId);
        if (settings) {
          const client = new ShopwareClient(settings);
          const order = await client.fetchOrderById(plan.orderId, null);
          if (order?.billingAddress) {
            billingAddress = order.billingAddress;
          }
        }
      } catch {
        // billing address is optional
      }

      const pdfInput: InstallmentInvoicePdfInput = {
        type: inv.type === "deposit" ? "deposit" : "installment",
        sequenceNumber: inv.sequenceNumber,
        invoiceNumber: inv.invoiceNumber || `${plan.orderNumber}-${inv.sequenceNumber}`,
        amount: decimalNum(inv.amount as any),
        dueDate: inv.dueDate,
        orderNumber: plan.orderNumber,
        customerName: plan.customerName,
        customerEmail: plan.customerEmail,
        billingAddress,
        totalAmount: decimalNum(plan.totalAmount as any),
        depositAmount: decimalNum(plan.depositAmount as any),
        depositPercent: plan.depositPercent ? decimalNum(plan.depositPercent as any) : null,
        remainingAmount: decimalNum(plan.remainingAmount as any),
        numberOfInstallments: plan.numberOfInstallments,
        planId: plan.id,
      };
      const pdfBuffer = await generateInstallmentInvoicePdf(pdfInput);
      const filename = inv.type === "deposit"
        ? `anzahlungsrechnung-${inv.invoiceNumber || plan.orderNumber}.pdf`
        : `teilrechnung-${inv.sequenceNumber}-${inv.invoiceNumber || plan.orderNumber}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("installment invoice pdf:", error);
      res.status(500).json({ error: error.message || "Failed to generate invoice PDF" });
    }
  });

  // --- Alle Rechnungen eines Plans als ZIP ---
  app.get("/api/installment-plans/:planId/invoices-zip", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      if (invoices.length === 0) {
        return res.status(404).json({ error: "No invoices found" });
      }

      let billingAddress: InstallmentInvoicePdfInput["billingAddress"] = null;
      try {
        const settings = await storage.getShopwareSettings(tenantId);
        if (settings) {
          const client = new ShopwareClient(settings);
          const order = await client.fetchOrderById(plan.orderId, null);
          if (order?.billingAddress) {
            billingAddress = order.billingAddress;
          }
        }
      } catch {
        // billing address is optional
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rechnungen-${plan.orderNumber}.zip"`
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => res.status(500).json({ error: err.message }));
      archive.pipe(res);

      for (const inv of invoices.sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
        const pdfInput: InstallmentInvoicePdfInput = {
          type: inv.type === "deposit" ? "deposit" : "installment",
          sequenceNumber: inv.sequenceNumber,
          invoiceNumber: inv.invoiceNumber || `${plan.orderNumber}-${inv.sequenceNumber}`,
          amount: decimalNum(inv.amount as any),
          dueDate: inv.dueDate,
          orderNumber: plan.orderNumber,
          customerName: plan.customerName,
          customerEmail: plan.customerEmail,
          billingAddress,
          totalAmount: decimalNum(plan.totalAmount as any),
          depositAmount: decimalNum(plan.depositAmount as any),
          depositPercent: plan.depositPercent ? decimalNum(plan.depositPercent as any) : null,
          remainingAmount: decimalNum(plan.remainingAmount as any),
          numberOfInstallments: plan.numberOfInstallments,
          planId: plan.id,
        };
        const pdfBuffer = await generateInstallmentInvoicePdf(pdfInput);
        const filename = inv.type === "deposit"
          ? `anzahlungsrechnung-${inv.invoiceNumber || plan.orderNumber}.pdf`
          : `teilrechnung-${inv.sequenceNumber}-${inv.invoiceNumber || plan.orderNumber}.pdf`;
        archive.append(pdfBuffer, { name: filename });
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("installment invoices zip:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to generate invoice ZIP" });
      }
    }
  });

  // Mark order as shipped - requires invoice to exist, transitions state and sends invoice email
  app.post("/api/orders/:orderId/mark-shipped", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const client = new ShopwareClient(settings);

      // Step 1: Check if invoice exists for this order (prefer real invoice over VKRE/PF)
      const documents = await client.fetchOrderDocuments(orderId);
      const invoice = getRealInvoiceDocument(documents);

      if (!invoice || !invoice.id) {
        return res.status(400).json({ 
          error: "No invoice found",
          message: "Order must have an invoice before it can be marked as shipped"
        });
      }

      console.log(`[Mark Shipped] Order ${orderId} has invoice ${invoice.id}, proceeding with shipping workflow`);

      // Step 2: Set order delivery to "shipped" status in Shopware
      await client.setOrderShipped(orderId);
      console.log(`[Mark Shipped] Order ${orderId} delivery status set to shipped`);

      // Step 3: Send invoice email to customer (Mondu requirement)
      await client.sendInvoiceEmail(orderId, invoice.id);
      console.log(`[Mark Shipped] Invoice email sent for order ${orderId}`);

      // Trigger webhook for order.ready_to_ship (using minimal data from context)
      webhookService.trigger("order.ready_to_ship", {
        orderId: orderId,
        orderNumber: "N/A", // Order number not available in this context
        customerName: "N/A", // Customer details not available
        customerEmail: "",
        totalAmount: 0, // Amount not available
        items: [], // Line items not available
        readyAt: new Date().toISOString(),
      }, {
        source: "mark_shipped",
        actorType: "user",
        actorId: (req.user as any)?.id || "system",
        invoiceId: invoice.id,
      }).catch(err => {
        console.error("Error triggering order.ready_to_ship webhook:", err);
      });

      res.json({ 
        success: true,
        message: "Order marked as shipped and invoice email sent",
        orderId,
        invoiceId: invoice.id,
      });
    } catch (error: any) {
      console.error("Error marking order as shipped:", error);
      
      // Handle Mondu plugin errors specifically
      if (error.message?.includes('MONDU__ERROR') || error.message?.includes('Corrupt order')) {
        return res.status(502).json({ 
          error: "Mondu plugin error",
          message: "The Mondu payment plugin in Shopware is preventing the order status change. This is a known Shopware-side issue that cannot be fixed in METAorder. Please contact Shopware support or manually update the order status in Shopware.",
          details: error.message,
        });
      }
      
      res.status(500).json({ 
        error: error.message || "Failed to mark order as shipped" 
      });
    }
  });

  // Rechnung ueber die Shopware-Funktion verschicken (Dokument per Mail an den
  // Kunden + document.sent = true). Manueller Klick aus der Bestelluebersicht.
  app.post(
    "/api/orders/:orderId/send-invoice",
    requireAuth,
    requireCsrf,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const { orderId } = req.params;
        const orderNumber =
          typeof req.body?.orderNumber === "string" ? req.body.orderNumber : undefined;
        const force = req.body?.force === true;

        const client = new ShopwareClient(settings);
        const result = await sendOrderInvoice(
          client,
          { id: orderId, orderNumber },
          { trigger: "manual", force, tenantId },
        );

        if (result.status === "no_invoice") {
          return res.status(400).json({
            error: "No invoice found",
            message: "Diese Bestellung hat keine Rechnung, die verschickt werden kann.",
            ...result,
          });
        }

        if (result.status === "failed") {
          return res.status(502).json({
            error: "Failed to send invoice",
            message: result.message || "Rechnung konnte nicht verschickt werden.",
            ...result,
          });
        }

        // Cache aktualisieren, damit das Badge sofort "verschickt" zeigt.
        if (result.status === "sent") {
          await markOrderInvoiceSentInCache(orderId, (req as any).tenantId ?? null);
        }

        res.json(result);
      } catch (error: any) {
        console.error("Error sending invoice:", error);
        res.status(500).json({ error: error.message || "Failed to send invoice" });
      }
    },
  );

  // Submit invoice to Mondu - downloads PDF from Shopware and uploads to Mondu
  app.post("/api/orders/:orderId/submit-to-mondu", requireAuth, async (req, res) => {
    try {
      const shopwareSettings = await storage.getShopwareSettings();
      if (!shopwareSettings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const monduSettings = await storage.getMonduSettings();
      if (!monduSettings) {
        return res.status(400).json({ error: "Mondu settings not configured" });
      }

      const { orderId } = req.params;
      const { monduOrderUuid, invoiceNumber, grossAmountCents } = req.body;

      // Validate required fields
      if (!monduOrderUuid) {
        return res.status(400).json({ error: "Mondu order UUID is required" });
      }
      if (!invoiceNumber) {
        return res.status(400).json({ error: "Invoice number is required" });
      }
      if (!grossAmountCents || grossAmountCents <= 0) {
        return res.status(400).json({ error: "Valid gross amount in cents is required" });
      }

      const shopwareClient = new ShopwareClient(shopwareSettings);

      // Step 1: Fetch the invoice document from Shopware (prefer real invoice over VKRE/PF)
      console.log(`[Mondu Submit] Fetching invoice document for order ${orderId}`);
      const documents = await shopwareClient.fetchOrderDocuments(orderId);
      const invoice = getRealInvoiceDocument(documents);

      if (!invoice || !invoice.id || !invoice.deepLinkCode) {
        return res.status(400).json({ 
          error: "No invoice found",
          message: "Order must have an invoice before it can be submitted to Mondu"
        });
      }

      // Step 2: Download the PDF as binary data
      console.log(`[Mondu Submit] Downloading invoice PDF ${invoice.id}`);
      const pdfBlob = await shopwareClient.downloadDocumentPdf(invoice.id, invoice.deepLinkCode);
      const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

      // Step 3: Submit to Mondu
      console.log(`[Mondu Submit] Submitting invoice to Mondu order ${monduOrderUuid}`);
      const { MonduClient } = await import("./mondu");
      const monduClient = new MonduClient(monduSettings);

      const result = await monduClient.submitInvoice({
        orderUuid: monduOrderUuid,
        externalReferenceId: invoiceNumber,
        grossAmountCents: grossAmountCents,
        invoicePdf: pdfBuffer,
        invoiceFileName: `invoice-${invoiceNumber}.pdf`,
      });

      console.log(`[Mondu Submit] Successfully submitted invoice to Mondu:`, result);

      res.json({ 
        success: true,
        message: "Invoice successfully submitted to Mondu",
        monduInvoiceUuid: result.invoice?.uuid,
        monduInvoiceState: result.invoice?.state,
      });
    } catch (error: any) {
      console.error("Error submitting invoice to Mondu:", error);
      res.status(500).json({ 
        error: error.message || "Failed to submit invoice to Mondu" 
      });
    }
  });

  // Shipping Dashboard - Get orders ready for shipping with equipment flags
  app.get("/api/shipping", requireAuth, requireViewShipping, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allOrders = await client.fetchOrders();

      // Filter orders: (paymentStatus == "paid" OR "authorized") AND status == "in_progress"
      const shippingOrders = allOrders.filter((order: Order) => {
        const validPayment = order.paymentStatus === "paid" || order.paymentStatus === "authorized";
        const validStatus = order.status === "in_progress";
        return validPayment && validStatus;
      });

      // Detect special equipment from order items or customFields
      const ordersWithFlags = shippingOrders.map((order: Order) => {
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

  // Bulk Tracking Number Update
  app.post("/api/orders/bulk-tracking", requireAuth, requireEditOrders, async (req, res) => {
    try {
      const bulkTrackingSchema = z.object({
        orderIds: z.array(z.string()).min(1, "At least one order ID is required"),
        trackingNumbers: z.array(z.string()).min(1, "At least one tracking number is required"),
      });

      const validatedData = bulkTrackingSchema.parse(req.body);
      const { orderIds, trackingNumbers } = validatedData;

      // Validate arrays have same length
      if (orderIds.length !== trackingNumbers.length) {
        return res.status(400).json({ 
          error: "orderIds and trackingNumbers arrays must have the same length" 
        });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      let updated = 0;

      // Process each order
      for (let i = 0; i < orderIds.length; i++) {
        const orderId = orderIds[i];
        const trackingNumber = trackingNumbers[i];

        try {
          // Update tracking number and mark as completed in Shopware
          await client.updateOrderShipping(orderId, {
            trackingNumber,
          });
          updated++;
        } catch (error: any) {
          console.error(`Error updating order ${orderId}:`, error);
          // Continue with next order even if one fails
        }
      }

      res.json({ 
        success: true, 
        updated 
      });
    } catch (error: any) {
      console.error("Error in bulk tracking update:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update tracking numbers" });
    }
  });

  // Ticket Templates - Get all templates
  app.get("/api/templates", requireAuth, async (req, res) => {
    try {
      const templates = await storage.getAllTicketTemplates();
      res.json(templates);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  // Ticket Templates - Get favorites for current user
  app.get("/api/templates/favorites", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const favorites = (await storage.getSetting(`ticketTemplates.favorites.${userId}`)) || [];
      res.json({ favorites });
    } catch (error: any) {
      console.error("Error fetching template favorites:", error);
      res.status(500).json({ error: "Failed to fetch template favorites" });
    }
  });

  // Ticket Templates - Update favorites for current user
  app.post("/api/templates/favorites", requireAuth, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const schema = z.object({
        favorites: z.array(z.string()).max(200),
      });
      const validated = schema.parse(req.body);
      await storage.saveSetting(`ticketTemplates.favorites.${userId}`, validated.favorites);
      res.json({ favorites: validated.favorites });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error updating template favorites:", error);
      res.status(500).json({ error: "Failed to update template favorites" });
    }
  });

  // Ticket Templates - Get single template
  app.get("/api/templates/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const template = await storage.getTicketTemplate(id);
      
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      
      res.json(template);
    } catch (error: any) {
      console.error("Error fetching template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // Ticket Templates - Create new template
  app.post("/api/templates", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const validatedData = insertTicketTemplateSchema.parse(req.body);
      const userId = (req.user as any).id;

      const newTemplate = await storage.createTicketTemplate({
        ...validatedData,
        createdByUserId: userId,
      });

      res.status(201).json(newTemplate);
    } catch (error: any) {
      console.error("Error creating template:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  // Ticket Templates - Update template
  app.patch("/api/templates/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req.user as any).id;

      // Partial validation for update
      const updateData = {
        ...req.body,
        createdByUserId: userId,
      };

      const updatedTemplate = await storage.updateTicketTemplate(id, updateData);
      
      if (!updatedTemplate) {
        return res.status(404).json({ error: "Template not found" });
      }

      res.json(updatedTemplate);
    } catch (error: any) {
      console.error("Error updating template:", error);
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  // Ticket Templates - Delete template
  app.delete("/api/templates/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteTicketTemplate(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Template not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting template:", error);
      res.status(500).json({ error: "Failed to delete template" });
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

      const { chatCompletion } = await import("./llmChat");
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

      const { chatCompletion } = await import("./llmChat");
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

      const { chatCompletion, parseLlmJsonResponse } = await import("./llmChat");
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

      const { chatCompletion, parseLlmJsonResponse: parseRepliesJson } = await import("./llmChat");
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

  // AI Settings - Get AI settings
  app.get("/api/settings/ai", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const aiSettings = await storage.getSetting("openai_settings");
      const { isReplitOpenAIAvailable } = await import("./openaiClient");
      const { isChatLlmConfigured } = await import("./llmChat");

      const enabled = await isChatLlmConfigured((key) => storage.getSetting(key));
      const chatProvider = aiSettings?.chatProvider === "anthropic" ? "anthropic" : "openai";
      const mode = isReplitOpenAIAvailable()
        ? "replit"
        : chatProvider === "anthropic"
          ? "anthropic"
          : "standard";

      res.json({
        enabled,
        mode,
        chatProvider,
        hasApiKey: Boolean(aiSettings?.apiKey),
        hasAnthropicKey: Boolean(aiSettings?.anthropicApiKey),
        anthropicModel: typeof aiSettings?.anthropicModel === "string" ? aiSettings.anthropicModel : "",
        openaiChatModel: typeof aiSettings?.openaiChatModel === "string" ? aiSettings.openaiChatModel : "",
      });
    } catch (error: any) {
      console.error("Error fetching AI settings:", error);
      res.status(500).json({ error: "Failed to fetch AI settings" });
    }
  });

  // AI Settings - Update AI settings
  app.post("/api/settings/ai", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const aiSettingsSchema = z.object({
        apiKey: z.string().optional(),
        anthropicApiKey: z.string().optional(),
        enabled: z.boolean(),
        chatProvider: z.enum(["openai", "anthropic"]).optional(),
        anthropicModel: z.string().max(120).optional(),
        openaiChatModel: z.string().max(120).optional(),
      });

      const validatedData = aiSettingsSchema.parse(req.body);
      const { apiKey, anthropicApiKey, enabled, chatProvider, anthropicModel, openaiChatModel } =
        validatedData;

      // Get existing settings
      const existingSettings = (await storage.getSetting("openai_settings")) || {};

      // Prepare new settings
      const newSettings: Record<string, unknown> = {
        enabled,
        apiKey: existingSettings.apiKey,
        anthropicApiKey: existingSettings.anthropicApiKey,
        chatProvider: chatProvider ?? existingSettings.chatProvider ?? "openai",
        anthropicModel:
          anthropicModel !== undefined
            ? anthropicModel
            : existingSettings.anthropicModel ?? "",
        openaiChatModel:
          openaiChatModel !== undefined
            ? openaiChatModel
            : existingSettings.openaiChatModel ?? "",
      };

      if (apiKey) {
        newSettings.apiKey = encrypt(apiKey);
      }
      if (anthropicApiKey) {
        newSettings.anthropicApiKey = encrypt(anthropicApiKey);
      }

      await storage.saveSetting("openai_settings", newSettings);

      res.json({
        success: true,
        enabled: newSettings.enabled,
      });
    } catch (error: any) {
      console.error("Error updating AI settings:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update AI settings" });
    }
  });

  const semanticRankingDefaults = {
    vectorWeight: 0.65,
    textWeight: 0.25,
    metadataWeight: 0.1,
    feedbackWeight: 0.12,
    metadataExactBoost: 0.15,
    metadataPartialBoost: 0.08,
    titleTokenBoost: 0.06,
  };

  app.get("/api/settings/semantic-ranking", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const settings = (await storage.getSetting("semantic_ranking")) || {};
      res.json({ settings: { ...semanticRankingDefaults, ...settings }, defaults: semanticRankingDefaults });
    } catch (error: any) {
      console.error("Error fetching semantic ranking settings:", error);
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
      console.error("Error updating semantic ranking settings:", error);
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
      console.error("Error fetching AI prompt overrides:", error);
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
      console.error("Error updating AI prompt overrides:", error);
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
      console.error("Error fetching commercial agent settings:", error);
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
      };
      await storage.saveSetting("commercial_agent_settings", payload);
      res.json({ success: true, settings: await getCommercialAgentSettings(storage) });
    } catch (error: any) {
      console.error("Error saving commercial agent settings:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to save commercial agent settings" });
    }
  });

  const commercialAgentMemUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf")) {
        cb(null, true);
      } else {
        cb(new Error("Nur PDF-Dateien sind erlaubt."));
      }
    },
  });

  app.post(
    "/api/commercial-agent/process",
    requireAuth,
    requireManageSettings,
    uploadRateLimiter,
    commercialAgentMemUpload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file?.buffer) {
          return res.status(400).json({ error: "PDF-Datei (field: file) erforderlich" });
        }
        const agent = await getCommercialAgentSettings(storage);
        if (!agent.enabled) {
          return res.status(400).json({ error: "Commercial Agent ist deaktiviert. Bitte unter Einstellungen aktivieren." });
        }
        const userId = (req.user as any).id;
        const subject = typeof req.body?.subject === "string" ? req.body.subject : "(manueller Upload)";
        const emailBody = typeof req.body?.body === "string" ? req.body.body : "";
        const result = await processCommercialPdfFromEmail({
          storage,
          tenantId: req.tenantId ?? null,
          messageId: `manual-${userId}-${Date.now()}`,
          filename: file.originalname || "upload.pdf",
          buffer: file.buffer,
          mimeType: file.mimetype || "application/pdf",
          subject,
          emailBody,
          ticketId: null,
          systemUserId: userId,
        });
        res.json({ success: true, result });
      } catch (error: any) {
        console.error("Commercial agent process error:", error);
        res.status(500).json({ error: error.message || "Commercial Agent Verarbeitung fehlgeschlagen" });
      }
    }
  );

  app.get(
    "/api/commercial-agent/learning-stats",
    requireAuth,
    requireManageSettings,
    async (req: Request, res: Response) => {
      try {
        const tenantId = req.tenantId ?? null;
        if (!tenantId) {
          return res.status(400).json({ error: "Kein Mandant gewählt" });
        }
        const total = await storage.countCommercialAgentExemplars(tenantId);
        res.json({ total });
      } catch (error: any) {
        console.error("Commercial agent learning stats error:", error);
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  app.post(
    "/api/commercial-agent/learning-feedback",
    requireAuth,
    requireManageSettings,
    async (req: Request, res: Response) => {
      try {
        const tenantId = req.tenantId ?? null;
        if (!tenantId) {
          return res.status(400).json({ error: "Kein Mandant gewählt" });
        }
        const bodySchema = z.object({
          draftKind: z.enum(["offer", "order"]),
          draftId: z.string().min(1),
          feedback: z.enum(["confirm", "correct"]),
          correctedIntent: z.enum(["quote_request", "purchase_order", "unclear"]).optional(),
        });
        const data = bodySchema.parse(req.body);
        const agent = await getCommercialAgentSettings(storage);
        if (agent.documentLearningEnabled === false) {
          return res.status(400).json({ error: "Dokumenten-Lernen ist deaktiviert" });
        }

        const draft =
          data.draftKind === "offer"
            ? await storage.getOfferDraft(data.draftId, tenantId)
            : await storage.getOrderDraft(data.draftId, tenantId);
        if (!draft) {
          return res.status(404).json({ error: "Entwurf nicht gefunden" });
        }

        const heuristicIntent =
          data.draftKind === "order" ? "purchase_order" : "quote_request";
        const intentLabel =
          data.feedback === "correct" && data.correctedIntent
            ? data.correctedIntent
            : heuristicIntent;
        const qualityScore = data.feedback === "confirm" ? 18 : 14;
        const extracted = draft.extractedData;
        const lines = extracted?.lineItems?.length
          ? `${extracted.lineItems.length} Positionen`
          : "ohne Positionen";
        const pdfExcerpt = `${draft.originalFileName}: ${lines}. ${JSON.stringify(extracted?.customer ?? {}).slice(0, 600)}`;

        await storage.createCommercialAgentExemplar(
          {
            tenantId,
            sourceKind: data.feedback === "confirm" ? "user_confirmed" : "user_corrected",
            intentLabel,
            subjectExcerpt: draft.originalFileName?.slice(0, 400) || null,
            emailExcerpt: null,
            pdfExcerpt: pdfExcerpt.slice(0, 2200),
            signalsJson: { feedback: data.feedback, draftKind: data.draftKind },
            qualityScore,
            draftKind: data.draftKind,
            referenceDraftId: data.draftId,
          },
          tenantId
        );

        res.json({ success: true });
      } catch (error: any) {
        console.error("Commercial agent learning feedback error:", error);
        if (error.name === "ZodError") {
          return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  // Automation Rules - Get all automation rules
  app.get("/api/automation-rules", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const rules = await storage.getAllAutomationRules();
      res.json(rules);
    } catch (error: any) {
      console.error("Error fetching automation rules:", error);
      res.status(500).json({ error: "Failed to fetch automation rules" });
    }
  });

  // Automation Rules - Get single automation rule
  app.get("/api/automation-rules/:id", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const { id } = req.params;
      const rule = await storage.getAutomationRule(id);
      
      if (!rule) {
        return res.status(404).json({ error: "Automation rule not found" });
      }

      res.json(rule);
    } catch (error: any) {
      console.error("Error fetching automation rule:", error);
      res.status(500).json({ error: "Failed to fetch automation rule" });
    }
  });

  // Automation Rules - Create automation rule
  app.post("/api/automation-rules", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const validatedData = insertAutomationRuleSchema.parse(req.body);
      
      const rule = await storage.createAutomationRule({
        name: validatedData.name,
        description: validatedData.description || null,
        triggerType: validatedData.triggerType,
        conditions: validatedData.conditions ? JSON.stringify(validatedData.conditions) : null,
        actions: JSON.stringify(validatedData.actions),
        enabled: validatedData.enabled ? 1 : 0,
        priority: validatedData.priority,
        schedule: validatedData.schedule || null,
        createdByUserId: (req.user as any)?.id || null,
      });

      res.json(rule);
    } catch (error: any) {
      console.error("Error creating automation rule:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid rule data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create automation rule" });
    }
  });

  // Automation Rules - Update automation rule
  app.patch("/api/automation-rules/:id", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const { id } = req.params;
      
      const updateSchema = insertAutomationRuleSchema.partial();
      const validatedData = updateSchema.parse(req.body);
      
      const updates: any = {};
      if (validatedData.name) updates.name = validatedData.name;
      if (validatedData.description !== undefined) updates.description = validatedData.description;
      if (validatedData.triggerType) updates.triggerType = validatedData.triggerType;
      if (validatedData.conditions !== undefined) {
        updates.conditions = validatedData.conditions ? JSON.stringify(validatedData.conditions) : null;
      }
      if (validatedData.actions !== undefined) {
        updates.actions = JSON.stringify(validatedData.actions);
      }
      if (validatedData.enabled !== undefined) {
        updates.enabled = validatedData.enabled ? 1 : 0;
      }
      if (validatedData.priority !== undefined) updates.priority = validatedData.priority;
      if (validatedData.schedule !== undefined) updates.schedule = validatedData.schedule;
      
      const rule = await storage.updateAutomationRule(id, updates);
      
      if (!rule) {
        return res.status(404).json({ error: "Automation rule not found" });
      }

      res.json(rule);
    } catch (error: any) {
      console.error("Error updating automation rule:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid rule data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update automation rule" });
    }
  });

  // Automation Rules - Delete automation rule
  app.delete("/api/automation-rules/:id", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteAutomationRule(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Automation rule not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting automation rule:", error);
      res.status(500).json({ error: "Failed to delete automation rule" });
    }
  });

  // Automation Rules - Toggle automation rule enabled/disabled
  app.post("/api/automation-rules/:id/toggle", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }

      const rule = await storage.updateAutomationRule(id, { enabled: enabled ? 1 : 0 });
      
      if (!rule) {
        return res.status(404).json({ error: "Automation rule not found" });
      }

      res.json(rule);
    } catch (error: any) {
      console.error("Error toggling automation rule:", error);
      res.status(500).json({ error: "Failed to toggle automation rule" });
    }
  });

  // Automation Rules - Get execution history
  app.get("/api/automation-rules/:id/executions", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const executions = await storage.getAutomationExecutions(id, limit);
      res.json(executions);
    } catch (error: any) {
      console.error("Error fetching automation executions:", error);
      res.status(500).json({ error: "Failed to fetch automation executions" });
    }
  });

  // Products routes
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Get pagination and search parameters
      const limit = parseInt(req.query.limit as string) || 100;
      const page = parseInt(req.query.page as string) || 1;
      const search = req.query.search as string | undefined;
      const categoryId = req.query.categoryId as string | undefined;
      
      // Get dimensions filter parameters
      const width = req.query.width ? parseFloat(req.query.width as string) : undefined;
      const height = req.query.height ? parseFloat(req.query.height as string) : undefined;
      const depth = req.query.depth ? parseFloat(req.query.depth as string) : undefined;
      
      // Determine if user is admin
      const user = req.user as any;
      
      // Check both roleDetails.name (new system) and user.role (legacy fallback)
      const isAdmin =
        user?.roleDetails?.name === 'Administrator' ||
        user?.role === 'admin';
      const canManageProducts =
        isAdmin || user?.roleDetails?.permissions?.manageProducts === true;
      
      // Admin/permission-only: Check if user wants to see only inactive products
      const showInactive = canManageProducts && req.query.showInactive === 'true';
      const withGlb = req.query.withGlb === 'true';
      const withVariantsOnly = req.query.withVariantsOnly === "true";
      const includeVariants = req.query.includeVariants === "true";

      const allowedChannelIds = await getSalesChannelFilter(req);
      const requestedChannelIds = typeof req.query.salesChannelIds === "string" && req.query.salesChannelIds.length > 0
        ? req.query.salesChannelIds.split(",")
        : [];
      let salesChannelIds: string[] | undefined = undefined;
      if (allowedChannelIds === null) {
        salesChannelIds = requestedChannelIds.length > 0 ? requestedChannelIds : undefined;
      } else if (allowedChannelIds.length > 0) {
        salesChannelIds = requestedChannelIds.length > 0
          ? requestedChannelIds.filter((id) => allowedChannelIds.includes(id))
          : allowedChannelIds;
      } else {
        return res.json({ products: [], total: 0 });
      }
      
      console.log(
        `[/api/products] User: ${user?.username}, Role: ${user?.roleDetails?.name || user?.role}, isAdmin: ${isAdmin}, showInactive: ${showInactive}, withGlb: ${withGlb}, withVariantsOnly: ${withVariantsOnly}, includeVariants: ${includeVariants}, categoryId: ${categoryId || "all"}, width: ${width || "any"}, height: ${height || "any"}, depth: ${depth || "any"}`
      );

      let result: { products: Product[]; total: number };
      if (withGlb) {
        result = await client.fetchProducts(
          500,
          1,
          search,
          categoryId,
          showInactive,
          width,
          height,
          depth,
          false,
          salesChannelIds,
          withVariantsOnly,
          includeVariants
        );
      } else {
        result = await client.fetchProducts(
          limit,
          page,
          search,
          categoryId,
          showInactive,
          width,
          height,
          depth,
          false,
          salesChannelIds,
          withVariantsOnly,
          includeVariants
        );
      }

      if (withGlb && result.products.length > 0) {
        const cpqGlbPath = process.env.CPQ_GLB_PATH || path.resolve(process.cwd(), "client", "public", "cpq-models");
        let glbFiles: string[] = [];
        if (fsSync.existsSync(cpqGlbPath)) {
          glbFiles = fsSync.readdirSync(cpqGlbPath).filter((f) => f.endsWith(".glb"));
        }
        const tryMatch = (pn: string) => pn && glbFiles.some((f) => f.startsWith(pn) || f.startsWith(String(pn).replace(/^0+/, "")));
        const matchesGlb = (p: { productNumber?: string; manufacturerNumber?: string }) =>
          tryMatch(p.manufacturerNumber ?? "") || tryMatch(p.productNumber ?? "");

        let filtered = result.products.filter(matchesGlb);
        let fetched = result.products.length;
        let shopwarePage = 2;
        const maxPages = 50;
        while (fetched < result.total && filtered.length < result.total && shopwarePage <= maxPages) {
          const next = await client.fetchProducts(
            500,
            shopwarePage,
            search,
            categoryId,
            showInactive,
            width,
            height,
            depth,
            false,
            salesChannelIds,
            withVariantsOnly,
            includeVariants
          );
          if (next.products.length === 0) break;
          filtered = filtered.concat(next.products.filter(matchesGlb));
          fetched += next.products.length;
          shopwarePage++;
          if (next.products.length < 500) break;
        }

        const total = filtered.length;
        const start = (page - 1) * limit;
        const products = filtered.slice(start, start + limit);
        result = { products, total };
      } else if (withGlb) {
        result = { products: [], total: 0 };
      }

      res.json(result);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch products";
      console.error("[/api/products] Error:", msg, error?.stack);
      res.status(500).json({ error: msg });
    }
  });

  // Produkt-Übersicht: Alle Produkte inkl. Verkaufskanal-Zuordnung, erweiterten Preisen,
  // Kategorien und Customfields. Lädt den kompletten (gefilterten) Katalog frisch aus
  // Shopware; Filterung/Sortierung/Pagination passiert clientseitig.
  app.get("/api/products/overview", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId as string | null | undefined;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const includeInactive = req.query.includeInactive !== "false"; // Standard: auch inaktive zeigen

      // Verkaufskanal-Berechtigung des Nutzers (null = alle Kanäle)
      const allowedChannelIds = await getSalesChannelFilter(req);
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return res.json({ products: [], salesChannels: [], total: 0 });
      }

      // Kanal-Namen auflösen und ggf. auf erlaubte Kanäle einschränken
      const allChannels = await client.fetchSalesChannels();
      const channelNameById = new Map(allChannels.map((c) => [c.id, c.name]));
      const visibleChannels = allowedChannelIds
        ? allChannels.filter((c) => allowedChannelIds.includes(c.id))
        : allChannels;

      // Gesamten (gefilterten) Katalog frisch aus Shopware laden
      const overview: ShopwareProductOverview[] = [];
      const BATCH_SIZE = 500;
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const { products } = await client.fetchProductsOverviewPage(BATCH_SIZE, page, {
          includeInactive,
          salesChannelIds: allowedChannelIds ?? undefined,
        });
        overview.push(...products);
        hasMore = products.length === BATCH_SIZE;
        page++;
      }

      const rows = overview.map((p) => ({
        ...p,
        salesChannels: p.salesChannelIds.map((id) => ({
          id,
          name: channelNameById.get(id) || id,
        })),
        hasAdvancedPrices: p.advancedPrices.length > 0,
        advancedPriceCount: p.advancedPrices.length,
        customFieldKeys: p.customFields ? Object.keys(p.customFields) : [],
      }));

      res.json({
        products: rows,
        salesChannels: visibleChannels.map((c) => ({ id: c.id, name: c.name })),
        total: rows.length,
      });
    } catch (error: any) {
      const msg = error?.message || "Produkt-Übersicht fehlgeschlagen";
      console.error("[/api/products/overview] Error:", msg, error?.stack);
      res.status(500).json({ error: msg });
    }
  });

  // OBX-Suche: Artikel aus hochgeladenen OBX-Dateien gegen den Katalog abgleichen
  // und die NICHT gefundenen Artikel als kommagetrennte Liste zurückgeben.
  const obxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 500 },
  });

  app.post(
    "/api/products/obx-search",
    requireAuth,
    requireCsrf,
    obxUpload.array("files", 500),
    async (req, res) => {
      try {
        const files = ((req as any).files as Express.Multer.File[] | undefined) || [];
        if (files.length === 0) {
          return res.status(400).json({ error: "Keine OBX-Dateien hochgeladen" });
        }

        // Tenant explizit aus dem Request lesen: multer (Multipart) bricht die
        // AsyncLocalStorage-Tenant-Weitergabe, daher den über requireAuth gesetzten
        // req.tenantId direkt an storage durchreichen.
        const tenantId = (req as any).tenantId as string | null | undefined;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        // Bewusst KEIN gemeinsamer In-Memory-Cache: Für den Abgleich wird immer der
        // aktuelle Stand des jeweiligen Mandanten frisch aus Shopware geladen.
        const client = new ShopwareClient(settings);
        const products: Product[] = [];
        const PRODUCT_BATCH_SIZE = 500; // Shopware-Maximum pro Request
        let productPage = 1;
        let hasMoreProducts = true;
        while (hasMoreProducts) {
          const { products: batch } = await client.fetchProducts(
            PRODUCT_BATCH_SIZE,
            productPage,
            undefined, // keine Suche
            undefined, // keine Kategorie
            false, // nur aktive Produkte
          );
          products.push(...batch);
          hasMoreProducts = batch.length === PRODUCT_BATCH_SIZE;
          productPage++;
        }

        // Identifier-Normalisierung: trimmen, Trennzeichen entfernen, lowercase.
        // Bewusst KEINE führenden Nullen entfernen, um Verwechslungen zu vermeiden.
        const IDENTIFIER_SEPARATORS_RE = /[\s\u00A0\-–._/]/g;
        const normalizeIdentifier = (value: unknown): string | undefined => {
          if (typeof value !== "string") {
            if (typeof value === "number" && Number.isFinite(value)) value = String(value);
            else return undefined;
          }
          const compact = (value as string).trim().replace(IDENTIFIER_SEPARATORS_RE, "");
          return compact ? compact.toLowerCase() : undefined;
        };

        // Liest das Customfield wdu_ifs_productnumber (case-insensitiver Key-Fallback)
        const getIfsProductNumber = (customFields: Record<string, any> | undefined): string | undefined => {
          if (!customFields || typeof customFields !== "object") return undefined;
          const direct = customFields["wdu_ifs_productnumber"];
          if (typeof direct === "string" && direct.trim()) return direct.trim();
          for (const [key, value] of Object.entries(customFields)) {
            if (key.toLowerCase() === "wdu_ifs_productnumber" && typeof value === "string" && value.trim()) {
              return value.trim();
            }
          }
          return undefined;
        };

        // Lookup-Map aufbauen: normalisierter Identifier -> { product, matchedBy }
        // Abgleich über Artikelnummer (productNumber + manufacturerNumber) und wdu_ifs_productnumber.
        type CatalogHit = {
          productNumber: string;
          name: string;
          matchedBy: "productNumber" | "manufacturerNumber" | "wdu_ifs_productnumber";
        };
        const lookup = new Map<string, CatalogHit>();
        const addToLookup = (
          value: unknown,
          product: { productNumber: string; name: string },
          matchedBy: CatalogHit["matchedBy"],
        ) => {
          const norm = normalizeIdentifier(value);
          if (!norm) return;
          // Bestehenden Eintrag nicht mit schwächerer Quelle überschreiben
          if (!lookup.has(norm)) {
            lookup.set(norm, { productNumber: product.productNumber, name: product.name, matchedBy });
          }
        };

        for (const product of products) {
          const base = { productNumber: product.productNumber, name: product.name };
          // Höchste Priorität: explizite Artikelnummer-Felder
          addToLookup(product.productNumber, base, "productNumber");
          addToLookup(product.manufacturerNumber, base, "manufacturerNumber");
          addToLookup(getIfsProductNumber(product.customFields), base, "wdu_ifs_productnumber");
        }

        // OBX-Dateien parsen und eindeutige Artikel sammeln (Original-Schreibweise behalten)
        type AggregatedArticle = ObxArticle & { occurrences: number };
        const uniqueByNorm = new Map<string, AggregatedArticle>();
        const fileSummaries: Array<{ fileName: string; articleCount: number; header?: ObxHeader }> = [];

        for (const file of files) {
          const content = file.buffer.toString("utf-8");
          const parsed = parseObxContent(content, file.originalname);
          fileSummaries.push({
            fileName: parsed.fileName,
            articleCount: parsed.articles.length,
            header: parsed.header,
          });
          for (const article of parsed.articles) {
            const norm = normalizeIdentifier(article.artNr);
            if (!norm) continue;
            const existing = uniqueByNorm.get(norm);
            if (existing) {
              existing.occurrences += 1;
              if (!existing.description && article.description) existing.description = article.description;
            } else {
              uniqueByNorm.set(norm, { ...article, occurrences: 1 });
            }
          }
        }

        // Abgleich
        const missing: Array<{ artNr: string; description?: string; occurrences: number }> = [];
        const found: Array<{
          artNr: string;
          description?: string;
          occurrences: number;
          productNumber: string;
          name: string;
          matchedBy: CatalogHit["matchedBy"];
        }> = [];

        for (const [norm, article] of uniqueByNorm) {
          const hit = lookup.get(norm);
          if (hit) {
            found.push({
              artNr: article.artNr,
              description: article.description,
              occurrences: article.occurrences,
              productNumber: hit.productNumber,
              name: hit.name,
              matchedBy: hit.matchedBy,
            });
          } else {
            missing.push({
              artNr: article.artNr,
              description: article.description,
              occurrences: article.occurrences,
            });
          }
        }

        const missingCsv = missing.map((m) => m.artNr).join(",");

        res.json({
          files: fileSummaries,
          totalUniqueArticles: uniqueByNorm.size,
          foundCount: found.length,
          missingCount: missing.length,
          missing,
          found,
          missingCsv,
        });
      } catch (error: any) {
        const msg = error?.message || "OBX-Suche fehlgeschlagen";
        console.error("[/api/products/obx-search] Error:", msg, error?.stack);
        res.status(500).json({ error: msg });
      }
    },
  );

  // Bundles routes
  app.get("/api/bundles", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const canManageBundles =
        user?.roleDetails?.permissions?.manageProducts === true ||
        user?.role === "admin";
      const includeInactive = canManageBundles && req.query.includeInactive === "true";
      
      const bundles = await storage.getAllBundles();
      const filtered = includeInactive ? bundles : bundles.filter((bundle) => bundle.active === 1);
      
      const { productCache } = await import("./productCache");
      const bundlesWithDetails = filtered.map((bundle) => ({
        ...bundle,
        items: bundle.items.map((item) => {
          const product = productCache.getProductByNumber(item.productNumber);
          return {
            ...item,
            productName: product?.name,
            productId: item.productId || product?.id,
          };
        }),
      }));
      
      res.json({ bundles: bundlesWithDetails });
    } catch (error: any) {
      console.error("Error fetching bundles:", error);
      res.status(500).json({ error: error.message || "Failed to fetch bundles" });
    }
  });

  app.post("/api/bundles", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const bundleItemSchema = z.object({
        productNumber: z.string().min(1),
        quantity: z.number().int().min(1),
      });
      const bundleSchema = z.object({
        name: z.string().min(1),
        mockProductNumber: z.string().min(1),
        description: z.string().optional(),
        active: z.boolean().optional(),
        items: z.array(bundleItemSchema).min(1),
      });
      
      const data = bundleSchema.parse(req.body);
      
      const existing = await storage.getBundleByMockNumber(data.mockProductNumber);
      if (existing) {
        return res.status(400).json({ error: "Mock product number already exists" });
      }
      
      const { productCache } = await import("./productCache");
      const invalidProducts: string[] = [];
      const itemMap = new Map<string, number>();
      data.items.forEach((item) => {
        const productNumber = item.productNumber.trim();
        const quantity = item.quantity;
        const nextQty = (itemMap.get(productNumber) ?? 0) + quantity;
        itemMap.set(productNumber, nextQty);
      });
      
      const normalizedItems = Array.from(itemMap.entries()).map(([productNumber, quantity], index) => {
        const product = productCache.getProductByNumber(productNumber);
        if (!product) {
          invalidProducts.push(productNumber);
        }
        return {
          productNumber,
          productId: product?.id,
          quantity,
          sortOrder: index,
        };
      });
      
      if (invalidProducts.length > 0) {
        const shopwareSettings = await storage.getShopwareSettings();
        if (shopwareSettings) {
          const shopwareClient = new ShopwareClient(shopwareSettings);
          const fallbackMap = await shopwareClient.fetchProductsByNumbers(invalidProducts);
          invalidProducts.length = 0;
          normalizedItems.forEach((item) => {
            if (!item.productId) {
              const fallback = fallbackMap.get(item.productNumber);
              if (fallback?.id) {
                item.productId = fallback.id;
              } else {
                invalidProducts.push(item.productNumber);
              }
            }
          });
        }
      }
      
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Some product numbers could not be resolved",
          invalidProducts,
        });
      }
      
      const user = req.user as any;
      const created = await storage.createBundle(
        {
          name: data.name,
          mockProductNumber: data.mockProductNumber,
          description: data.description,
          active: data.active === false ? 0 : 1,
          createdByUserId: user?.id ?? null,
        },
        normalizedItems
      );
      
      res.json(created);
    } catch (error: any) {
      console.error("Error creating bundle:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid bundle data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to create bundle" });
    }
  });

  app.patch("/api/bundles/:id", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const { id } = req.params;
      const bundleItemSchema = z.object({
        productNumber: z.string().min(1),
        quantity: z.number().int().min(1),
      });
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        mockProductNumber: z.string().min(1).optional(),
        description: z.string().optional(),
        active: z.boolean().optional(),
        items: z.array(bundleItemSchema).min(1).optional(),
      });
      const data = updateSchema.parse(req.body);
      
      if (data.mockProductNumber) {
        const existing = await storage.getBundleByMockNumber(data.mockProductNumber);
        if (existing && existing.id !== id) {
          return res.status(400).json({ error: "Mock product number already exists" });
        }
      }
      
      let normalizedItems;
      if (data.items) {
        const { productCache } = await import("./productCache");
        const invalidProducts: string[] = [];
        const itemMap = new Map<string, number>();
        data.items.forEach((item) => {
          const productNumber = item.productNumber.trim();
          const quantity = item.quantity;
          const nextQty = (itemMap.get(productNumber) ?? 0) + quantity;
          itemMap.set(productNumber, nextQty);
        });
        
        normalizedItems = Array.from(itemMap.entries()).map(([productNumber, quantity], index) => {
          const product = productCache.getProductByNumber(productNumber);
          if (!product) {
            invalidProducts.push(productNumber);
          }
          return {
            productNumber,
            productId: product?.id,
            quantity,
            sortOrder: index,
          };
        });
        
        if (invalidProducts.length > 0) {
          const shopwareSettings = await storage.getShopwareSettings();
          if (shopwareSettings) {
            const shopwareClient = new ShopwareClient(shopwareSettings);
            const fallbackMap = await shopwareClient.fetchProductsByNumbers(invalidProducts);
            invalidProducts.length = 0;
            normalizedItems.forEach((item) => {
              if (!item.productId) {
                const fallback = fallbackMap.get(item.productNumber);
                if (fallback?.id) {
                  item.productId = fallback.id;
                } else {
                  invalidProducts.push(item.productNumber);
                }
              }
            });
          }
        }
        
        if (invalidProducts.length > 0) {
          return res.status(400).json({
            error: "Some product numbers could not be resolved",
            invalidProducts,
          });
        }
      }
      
      const updated = await storage.updateBundle(
        id,
        {
          name: data.name,
          mockProductNumber: data.mockProductNumber,
          description: data.description,
          active: data.active === undefined ? undefined : data.active ? 1 : 0,
        },
        normalizedItems
      );
      
      if (!updated) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating bundle:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid bundle data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update bundle" });
    }
  });

  app.delete("/api/bundles/:id", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteBundle(id);
      if (!deleted) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting bundle:", error);
      res.status(500).json({ error: error.message || "Failed to delete bundle" });
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

  app.patch("/api/products/:productId/active", requireAuth, requireManageProducts, async (req, res) => {
    let desiredActive: boolean | undefined;
    try {
      const schema = z.object({ active: z.boolean() });
      const { active } = schema.parse(req.body);
      desiredActive = active;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      await client.setProductActive(req.params.productId, active);
      res.json({ success: true, active });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      const errorMessage = typeof error?.message === "string" ? error.message : String(error);
      console.error("Error updating product active status:", error);
      try {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const currentActive = await client.fetchProductActiveStatus(req.params.productId);
          if (currentActive === desiredActive) {
            return res.json({
              success: true,
              active: currentActive,
              warning: "Shopware plugin returned 500 after write.",
            });
          }
        }
      } catch (verifyError) {
        console.error("Error verifying product status after failure:", verifyError);
      }
      if (typeof desiredActive === "boolean") {
        return res.json({
          success: true,
          active: desiredActive,
          warning: "Shopware update returned an error after write.",
          details: errorMessage,
        });
      }
      res.status(500).json({ error: errorMessage || "Failed to update product" });
    }
  });

  app.get("/api/products/:productId/categories", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const result = await client.fetchProductCategoryIds(req.params.productId);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching product categories:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product categories" });
    }
  });

  app.patch("/api/products/:productId/glb", requireAuth, requireManageProducts, async (req, res) => {
    try {
      const { productId } = req.params;
      const schema = z.object({ glbUrl: z.string() });
      const { glbUrl } = schema.parse(req.body);

      const cpqGlbPath = process.env.CPQ_GLB_PATH || path.resolve(process.cwd(), "client", "public", "cpq-models");
      const glbUrlWithoutQuery = glbUrl.split("?")[0].split("#")[0];
      const match = glbUrlWithoutQuery.match(/\/([^/]+\.glb)$/i);
      const filename = match ? match[1] : glbUrlWithoutQuery.split("/").pop() || "model.glb";
      const localPath = path.join(cpqGlbPath, filename);

      if (!fsSync.existsSync(localPath)) {
        return res.status(404).json({ error: `GLB-Datei nicht gefunden: ${filename}` });
      }

      const buffer = await fs.readFile(localPath);

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { mediaId } = await client.uploadProductGlbMedia(productId, buffer, filename);
      res.json({ success: true, mediaId });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "glbUrl required" });
      }
      const msg = typeof error?.message === "string" ? error.message : "Failed to save GLB";
      console.error("Error saving product GLB:", error);
      res.status(500).json({ error: msg });
    }
  });

  app.patch("/api/products/:productId/categories", requireAuth, requireManageProducts, async (req, res) => {
    let desiredCategoryIds: string[] = [];
    try {
      const schema = z.object({ categoryIds: z.array(z.string()) });
      const { categoryIds } = schema.parse(req.body);
      desiredCategoryIds = categoryIds;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      await client.setProductCategories(req.params.productId, categoryIds);
      res.json({ success: true, categoryIds });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      const errorMessage = typeof error?.message === "string" ? error.message : String(error);
      console.error("Error updating product categories:", error);
      try {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const verified = await client.fetchProductCategoryIds(req.params.productId);
          if (verified.categoryIds.sort().join(",") === desiredCategoryIds.sort().join(",")) {
            return res.json({
              success: true,
              categoryIds: verified.categoryIds,
              warning: "Shopware plugin returned 500 after write.",
            });
          }
        }
      } catch (verifyError) {
        console.error("Error verifying product categories after failure:", verifyError);
      }
      if (Array.isArray(desiredCategoryIds)) {
        return res.json({
          success: true,
          categoryIds: desiredCategoryIds,
          warning: "Shopware update returned an error after write.",
          details: errorMessage,
        });
      }
      res.status(500).json({ error: errorMessage || "Failed to update product categories" });
    }
  });

  app.get("/api/products/:productId/sales-channels", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const result = await client.fetchProductSalesChannelIds(req.params.productId);
      const allowedChannelIds = await getSalesChannelFilter(req);
      if (allowedChannelIds !== null) {
        const filteredIds = result.salesChannelIds.filter((id) => allowedChannelIds.includes(id));
        return res.json({ salesChannelIds: filteredIds });
      }
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching product sales channels:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product sales channels" });
    }
  });

  app.patch("/api/products/:productId/sales-channels", requireAuth, requireManageProducts, async (req, res) => {
    let desiredSalesChannelIds: string[] = [];
    try {
      const schema = z.object({ salesChannelIds: z.array(z.string()) });
      const { salesChannelIds } = schema.parse(req.body);
      desiredSalesChannelIds = salesChannelIds;

      const allowedChannelIds = await getSalesChannelFilter(req);
      if (allowedChannelIds !== null) {
        if (allowedChannelIds.length === 0) {
          return res.status(403).json({ error: "No sales channel permissions" });
        }
        desiredSalesChannelIds = desiredSalesChannelIds.filter((id) => allowedChannelIds.includes(id));
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      await client.setProductSalesChannels(req.params.productId, desiredSalesChannelIds);
      res.json({ success: true, salesChannelIds: desiredSalesChannelIds });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      const errorMessage = typeof error?.message === "string" ? error.message : String(error);
      console.error("Error updating product sales channels:", error);
      try {
        const settings = await storage.getShopwareSettings();
        if (settings) {
          const client = new ShopwareClient(settings);
          const verified = await client.fetchProductSalesChannelIds(req.params.productId);
          if (verified.salesChannelIds.sort().join(",") === desiredSalesChannelIds.sort().join(",")) {
            return res.json({
              success: true,
              salesChannelIds: verified.salesChannelIds,
              warning: "Shopware plugin returned 500 after write.",
            });
          }
        }
      } catch (verifyError) {
        console.error("Error verifying product sales channels after failure:", verifyError);
      }
      if (Array.isArray(desiredSalesChannelIds)) {
        return res.json({
          success: true,
          salesChannelIds: desiredSalesChannelIds,
          warning: "Shopware update returned an error after write.",
          details: errorMessage,
        });
      }
      res.status(500).json({ error: errorMessage || "Failed to update product sales channels" });
    }
  });

  app.get("/api/products/:productId/data-quality", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allowedChannelIds = await getSalesChannelFilter(req);
      const salesChannelResult = await client.fetchProductSalesChannelIds(req.params.productId);

      if (allowedChannelIds !== null) {
        const hasAccess = salesChannelResult.salesChannelIds.some((id) => allowedChannelIds.includes(id));
        if (!hasAccess) {
          return res.status(403).json({ error: "Access denied: no sales channel permissions" });
        }
      }

      const product = await client.fetchProductDataQuality(req.params.productId);
      const visibilityCount = salesChannelResult.salesChannelIds.length;

      const criteria = [
        { key: "productNumber", ok: Boolean(product.productNumber) },
        { key: "manufacturerNumber", ok: Boolean(product.manufacturerNumber) },
        { key: "ean", ok: Boolean(product.ean) },
        { key: "description", ok: Boolean(product.description) },
        { key: "properties", ok: product.propertyCount >= 2 },
        { key: "deliveryTime", ok: Boolean(product.hasDeliveryTime) },
        { key: "salesChannels", ok: visibilityCount > 0 },
        { key: "categories", ok: product.categoryCount > 0 },
        { key: "images", ok: product.imageCount > 0 },
        { key: "width", ok: Boolean(product.width) },
        { key: "height", ok: Boolean(product.height) },
        { key: "length", ok: Boolean(product.length) },
        { key: "weight", ok: Boolean(product.weight) },
      ];

      const missingFields = criteria.filter((item) => !item.ok).map((item) => item.key);
      const criteriaCount = criteria.length;
      const score = Math.round(((criteriaCount - missingFields.length) / criteriaCount) * 100);

      res.json({
        score,
        criteriaCount,
        missingFields,
        criteria: criteria.map((item) => ({
          key: item.key,
          value: item.ok ? 100 : 0,
        })),
      });
    } catch (error: any) {
      console.error("Error fetching product data quality:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product data quality" });
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

  // Semantic Product Search route - GPT-4o powered natural language search using cached products
  app.post("/api/products/semantic-search", requireAuth, async (req, res) => {
    try {
      const { query, language } = req.body;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: "Query is required" });
      }

      const promptOverrides = (await storage.getSetting("ai_prompt_overrides")) || {};
      const promptAddon = promptOverrides.semanticSearchSystemAddon || "";

      console.log(`[Semantic Search] Query: "${query}", Language: ${language || 'de'}`);

      // Use cached products (all products loaded at startup)
      const { productCache } = await import("./productCache");
      const cacheStatus = productCache.getStatus();
      
      if (!cacheStatus.isPopulated) {
        console.warn("[Semantic Search] Cache not populated, falling back to live API (batch loading all products)");
        
        // Fallback: Fetch ALL products from Shopware API in batches
        const settings = await storage.getShopwareSettings();
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        
        const client = new ShopwareClient(settings);
        const allProducts: Product[] = [];
        const BATCH_SIZE = 500;
        let page = 1;
        let hasMore = true;
        
        // Batch-load all products (same logic as cache)
        while (hasMore) {
          const { products } = await client.fetchProducts(BATCH_SIZE, page, undefined, undefined, false);
          allProducts.push(...products);
          console.log(`[Semantic Search Fallback] Loaded batch ${page}: ${products.length} products (total: ${allProducts.length})`);
          
          // Continue until we get less than BATCH_SIZE products
          hasMore = products.length === BATCH_SIZE;
          page++;
        }
        
        console.log(`[Semantic Search Fallback] Fetched ${allProducts.length} products from live API (${page - 1} batches)`);
        
        const searchResult = await executeSemanticProductSearch(
          { query, language: language || 'de' },
          allProducts,
          { promptAddon }
        );
        
        return res.json(searchResult);
      }
      
      // Use cached products for semantic search
      const cachedProducts = productCache.getProducts();
      console.log(`[Semantic Search] Using ${cachedProducts.length} cached products`);
      
      // Execute semantic search with GPT-4o
      const searchResult = await executeSemanticProductSearch(
        { query, language: language || 'de' },
        cachedProducts,
        { promptAddon }
      );

      res.json(searchResult);
    } catch (error: any) {
      console.error("[Semantic Search] Error:", error);
      res.status(500).json({ error: error.message || "Semantic search failed" });
    }
  });

  // Product Cache Status endpoint - Admin only
  app.get("/api/products/cache-status", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const { productCache } = await import("./productCache");
      const status = productCache.getStatus();
      
      res.json({
        isPopulated: status.isPopulated,
        productCount: status.productCount,
        lastUpdate: status.lastUpdate,
        isLoading: status.isLoading,
        error: status.error
      });
    } catch (error: any) {
      console.error("[Product Cache] Error fetching cache status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch cache status" });
    }
  });

  // Product Cache Refresh endpoint - Admin only manual refresh
  app.post("/api/products/refresh-cache", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const { productCache } = await import("./productCache");
      const cacheStatus = productCache.getStatus();
      
      if (cacheStatus.isLoading) {
        return res.status(409).json({ error: "Cache refresh already in progress" });
      }
      
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      
      console.log("[Product Cache] Manual refresh requested");
      const client = new ShopwareClient(settings);
      await productCache.refresh(client);
      
      const updatedStatus = productCache.getStatus();
      res.json({
        success: true,
        message: "Product cache refreshed successfully",
        status: {
          productCount: updatedStatus.productCount,
          lastUpdate: updatedStatus.lastUpdate
        }
      });
    } catch (error: any) {
      console.error("[Product Cache] Error refreshing cache:", error);
      res.status(500).json({ error: error.message || "Failed to refresh cache" });
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
      const categories = await client.fetchCategories();
      res.json(categories);
    } catch (error: any) {
      const msg = error?.message || "Failed to fetch categories";
      console.error("[api/categories] Error:", msg, error?.stack);
      res.status(500).json({ error: msg });
    }
  });

  // Cross-Selling routes
  app.get("/api/products/:productId/cross-selling", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;
      
      console.log(`Fetching cross-selling for product ${productId}...`);
      const crossSellings = await client.fetchProductCrossSelling(productId);
      
      // Fetch products for each cross-selling group
      console.log(`Fetching products for ${crossSellings.length} cross-selling groups...`);
      const crossSellingsWithProducts = await Promise.all(
        crossSellings.map(async (cs) => {
          const products = await client.fetchCrossSellingProducts(productId, cs.id);
          return { ...cs, products };
        })
      );
      
      // Set cache headers to prevent 304 responses during debugging
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json({ crossSellings: crossSellingsWithProducts });
    } catch (error: any) {
      console.error("Error fetching cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to fetch cross-selling" });
    }
  });

  app.post("/api/products/:productId/cross-selling", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Validate request body
      const createSchema = z.object({
        name: z.string().min(1, "Name is required"),
        productIds: z.array(z.string()).default([]),
      });

      const validation = createSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;
      const { productIds } = validation.data;

      const crossSellingId = await client.createProductCrossSelling(
        productId,
        SHOPWARE_CROSS_SELLING_STOREFRONT_NAME,
      );
      
      // Assign products to the group
      if (productIds.length > 0) {
        await client.assignProductsToCrossSelling(crossSellingId, productIds);
      }
      
      res.json({ id: crossSellingId, message: "Cross-selling created successfully" });
    } catch (error: any) {
      console.error("Error creating cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to create cross-selling" });
    }
  });

  app.put("/api/products/:productId/cross-selling/:crossSellingId", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Validate request body
      const updateSchema = z.object({
        productIds: z.array(z.string()),
      });

      const validation = updateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const client = new ShopwareClient(settings);
      const { productId, crossSellingId } = req.params;
      const { productIds } = validation.data;
      
      console.log(`Updating cross-selling ${crossSellingId} for product ${productId}`);
      console.log(`New product IDs: ${JSON.stringify(productIds)}`);
      
      // Get current products to determine what to add/remove
      const currentProducts = await client.fetchCrossSellingProducts(productId, crossSellingId);
      const currentProductIds = currentProducts.map(p => p.id);
      
      console.log(`Current product IDs: ${JSON.stringify(currentProductIds)}`);
      
      // Determine which products to add and remove
      const toAdd = productIds.filter(id => !currentProductIds.includes(id));
      const toRemove = currentProductIds.filter(id => !productIds.includes(id));
      
      console.log(`Products to add: ${JSON.stringify(toAdd)}`);
      console.log(`Products to remove: ${JSON.stringify(toRemove)}`);
      
      // Update assignments
      if (toRemove.length > 0) {
        await client.removeProductsFromCrossSelling(crossSellingId, toRemove);
      }
      if (toAdd.length > 0) {
        console.log(`Calling assignProductsToCrossSelling with crossSellingId=${crossSellingId}, productIds=${JSON.stringify(toAdd)}`);
        await client.assignProductsToCrossSelling(crossSellingId, toAdd);
      }
      
      res.json({ message: "Cross-selling updated successfully" });
    } catch (error: any) {
      console.error("Error updating cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to update cross-selling" });
    }
  });

  app.delete("/api/products/:productId/cross-selling/:crossSellingId", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { crossSellingId } = req.params;
      
      await client.deleteProductCrossSelling(crossSellingId);
      
      res.json({ message: "Cross-selling deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to delete cross-selling" });
    }
  });

  // Cross-Selling Rules routes
  app.get("/api/cross-selling-rules/available-fields", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        // Return default fields if Shopware not configured
        return res.json({
          standardFields: [
            { field: 'name', label: 'Product Name', description: 'The product name' },
            { field: 'productNumber', label: 'Product Number', description: 'The unique product number/SKU' },
            { field: 'manufacturerNumber', label: 'Manufacturer Number', description: 'Manufacturer\'s product number' },
            { field: 'ean', label: 'EAN', description: 'European Article Number / Barcode' },
            { field: 'stock', label: 'Stock', description: 'Current stock level' },
            { field: 'available', label: 'Available', description: 'Product availability status' },
            { field: 'price', label: 'Price', description: 'Product price' },
            { field: 'weight', label: 'Weight', description: 'Product weight' },
            { field: 'dimensions.width', label: 'Width', description: 'Product width dimension' },
            { field: 'dimensions.height', label: 'Height', description: 'Product height dimension' },
            { field: 'dimensions.length', label: 'Length', description: 'Product length/depth dimension' },
            { field: 'categoryNames', label: 'Categories', description: 'Product categories (array)' },
            { field: 'manufacturer.name', label: 'Manufacturer Name', description: 'Name of the manufacturer' },
          ],
          customFields: []
        });
      }

      const shopware = new ShopwareClient(settings);
      const fields = await shopware.fetchAvailableFields();
      res.json(fields);
    } catch (error: any) {
      console.error("Error fetching available fields:", error);
      res.status(500).json({ error: error.message || "Failed to fetch available fields" });
    }
  });

  app.get("/api/cross-selling-rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const rules = await storage.getAllCrossSellingRules(tenantId);
      res.json({ rules });
    } catch (error: any) {
      console.error("Error fetching cross-selling rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rules" });
    }
  });

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

  app.get("/api/cross-selling/learning-settings", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const settings = await getCrossSellLearningSettings(storage, req.tenantId ?? null);
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching learning settings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch settings" });
    }
  });

  app.put("/api/cross-selling/learning-settings", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const schema = z.object({
        minSupport: z.number().min(0).max(1),
        minConfidence: z.number().min(0).max(1),
        minLift: z.number().min(0),
        minPairCount: z.number().min(1),
        maxRulesPerProduct: z.number().min(1),
        maxRecommendationsPerProduct: z.number().min(1),
        wCoOcc: z.number().min(0).max(1).optional(),
        wEmbed: z.number().min(0).max(1).optional(),
        wSignal: z.number().min(0).max(1).optional(),
        wRule: z.number().min(0).max(1).optional(),
        signalAlpha: z.number().min(0.01).max(50).optional(),
        signalBeta: z.number().min(0.01).max(200).optional(),
        useLlmRerank: z.boolean().optional(),
      });
      const validated = schema.parse(req.body);
      const merged = { ...(await getCrossSellLearningSettings(storage, req.tenantId ?? null)), ...validated };
      await storage.saveSetting("cross_sell_learning_settings", merged, req.tenantId ?? null);
      res.json(merged);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error saving learning settings:", error);
      res.status(500).json({ error: error.message || "Failed to save settings" });
    }
  });

  app.get("/api/cross-selling/staging", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batch = await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);
      if (!batch) {
        return res.json({ batch: null, rules: [], suggestions: [] });
      }
      const [rules, suggestions] = await Promise.all([
        storage.getCrossSellStagingRules(batch.id, req.tenantId ?? null),
        storage.getCrossSellStagingSuggestions(batch.id, req.tenantId ?? null),
      ]);
      res.json({ batch, rules, suggestions });
    } catch (error: any) {
      console.error("Error fetching cross-sell staging:", error);
      res.status(500).json({ error: error.message || "Failed to fetch staging data" });
    }
  });

  app.put("/api/cross-selling/staging/rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const validation = insertCrossSellingRuleSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const updates: any = { ...validation.data };
      const updated = await storage.updateCrossSellStagingRule(req.params.id, updates, req.tenantId ?? null);
      if (!updated) {
        return res.status(404).json({ error: "Staging rule not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating staging rule:", error);
      res.status(500).json({ error: error.message || "Failed to update staging rule" });
    }
  });

  app.put("/api/cross-selling/staging/suggestions/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const schema = z.object({
        targetProductNumber: z.string().min(1).optional(),
        active: z.union([z.number().min(0).max(1), z.boolean()]).optional(),
      });
      const validation = schema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const updates: any = { ...validation.data };
      if (typeof updates.active === "boolean") {
        updates.active = updates.active ? 1 : 0;
      }
      if (updates.targetProductNumber) {
        updates.targetProductId = null;
      }

      const updated = await storage.updateCrossSellStagingSuggestion(req.params.id, updates, req.tenantId ?? null);
      if (!updated) {
        return res.status(404).json({ error: "Staging suggestion not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating staging suggestion:", error);
      res.status(500).json({ error: error.message || "Failed to update staging suggestion" });
    }
  });

  app.post("/api/cross-selling/staging/regenerate", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batchId = req.body?.batchId as string | undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, req.tenantId ?? null)
        : await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();
      const stagingRules = await storage.getCrossSellStagingRules(batch.id, req.tenantId ?? null);
      const activeRules = stagingRules.filter((rule) => rule.active === 1);

      const rulesForEngine: CrossSellingRule[] = activeRules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description ?? undefined,
        active: rule.active,
        category: rule.category ?? undefined,
        sourceConditions: rule.sourceConditions as RuleCondition[],
        targetCriteria: rule.targetCriteria as RuleTargetCriteria[],
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      }));

      const allProducts = await fetchAllProductsForStaging(client);
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "hybrid_only");
      const shelfCfg = await loadCrossSellShelvingPatternConfig((k, t) => storage.getSetting(k, t), req.tenantId ?? null);
      const stagingSuggestions: Array<{
        batchId: string;
        tenantId: string | null;
        sourceProductId: string | null;
        sourceProductNumber: string;
        targetProductId: string | null;
        targetProductNumber: string;
        category?: string | null;
        active: number;
      }> = [];
      let productsWithSuggestions = 0;
      let productsWithoutSuggestions = 0;

      for (const product of allProducts) {
        if (!product.productNumber) {
          continue;
        }
        const suggestions = await ruleEngine.suggestCrossSelling(product, rulesForEngine, client, suggestOpts);
        const rulesLimited = dedupeAndLimitSuggestions(suggestions, 40);

        let fallbackLimited: Product[] = [];
        if (rulesLimited.length === 0) {
          fallbackLimited = dedupeAndLimitSuggestions(
            getFallbackSuggestionsByProperties(product, allProducts, 40),
            40,
          );
        }

        const ruleHits = rulesLimited.map((s) => ({
          product: s,
          category:
            (s as Product & { suggestCategory?: string }).suggestCategory ??
            CROSS_SELL_CATEGORIES.COMPONENTS,
        }));
        const fallbackHits = fallbackLimited.map((s) => ({
          product: s,
          category: CROSS_SELL_CATEGORIES.OTHER,
        }));
        const ruleOrFallback = ruleHits.length > 0 ? ruleHits : fallbackHits;

        const heur = findShelvingSupplements(product, allProducts, shelfCfg);
        const merged = mergeStagingCandidatesWithQuotas(ruleOrFallback, heur, shelfCfg);

        if (merged.length === 0) {
          productsWithoutSuggestions += 1;
          continue;
        }

        productsWithSuggestions += 1;
        for (const row of merged) {
          const suggestion = row.product;
          if (!suggestion.productNumber) {
            continue;
          }
          stagingSuggestions.push({
            batchId: batch.id,
            tenantId: batch.tenantId ?? null,
            sourceProductId: product.id ?? null,
            sourceProductNumber: product.productNumber,
            targetProductId: suggestion.id ?? null,
            targetProductNumber: suggestion.productNumber,
            category: row.category,
            active: 1,
          });
        }
      }

      await storage.replaceCrossSellStagingSuggestions(batch.id, stagingSuggestions, batch.tenantId ?? null);
      res.json({
        batchId: batch.id,
        suggestionsCount: stagingSuggestions.length,
        productsWithSuggestions,
        productsWithoutSuggestions,
      });
    } catch (error: any) {
      console.error("Error regenerating staging suggestions:", error);
      res.status(500).json({ error: error.message || "Failed to regenerate staging suggestions" });
    }
  });

  app.post("/api/cross-selling/staging/execute-rule", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const ruleId = typeof req.body?.ruleId === "string" ? req.body.ruleId.trim() : "";
      if (!ruleId) {
        return res.status(400).json({ error: "ruleId is required" });
      }

      const manualRule = await storage.getCrossSellingRule(ruleId, req.tenantId ?? null);
      if (!manualRule) {
        return res.status(404).json({ error: "Rule not found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();

      // Get or create staging batch
      let batch = await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);
      if (!batch) {
        batch = await storage.createCrossSellStagingBatch(
          {
            tenantId: req.tenantId ?? null,
            createdByUserId: (req.user as any)?.id ?? null,
            status: "draft",
          },
          req.tenantId ?? null
        );
      }

      // Load all products
      const allProducts = await fetchAllProductsForStaging(client);
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "hybrid_only");

      // Execute rule on all products
      const suggestionsBySource = new Map<string, Product[]>();
      
      for (const product of allProducts) {
        if (!product.productNumber) {
          continue;
        }
        const suggestions = await ruleEngine.suggestCrossSelling(product, [manualRule], client, suggestOpts);
        const limited = dedupeAndLimitSuggestions(suggestions, 10);
        
        if (limited.length > 0) {
          suggestionsBySource.set(product.productNumber, limited);
        }
      }

      // Save suggestions to staging for each source product
      for (const [sourceProductNumber, suggestions] of Array.from(suggestionsBySource.entries())) {
        const sourceProduct = allProducts.find(p => p.productNumber === sourceProductNumber);
        if (!sourceProduct) continue;

        const stagingSuggestions = suggestions.map((suggestion: Product) => ({
          batchId: batch.id,
          tenantId: req.tenantId ?? null,
          sourceProductId: sourceProduct.id ?? null,
          sourceProductNumber: sourceProduct.productNumber!,
          targetProductId: suggestion.id ?? null,
          targetProductNumber: suggestion.productNumber!,
          active: 1,
        }));

        await storage.replaceCrossSellStagingSuggestionsForSource(
          batch.id,
          sourceProductNumber,
          stagingSuggestions,
          req.tenantId ?? null
        );
      }

      // Build preview data
      const preview = Array.from(suggestionsBySource.entries()).map(([sourceProductNumber, targets]) => {
        const sourceProduct = allProducts.find(p => p.productNumber === sourceProductNumber);
        return {
          sourceProductNumber,
          sourceProductName: sourceProduct?.name || sourceProductNumber,
          targetProducts: targets.map(t => ({
            productNumber: t.productNumber || "",
            productName: t.name || t.productNumber || "",
          })),
          count: targets.length,
        };
      });

      const totalSuggestions = Array.from(suggestionsBySource.values()).reduce(
        (sum, targets) => sum + targets.length,
        0
      );

      res.json({
        suggestionsCount: totalSuggestions,
        preview,
        batchId: batch.id,
      });
    } catch (error: any) {
      console.error("Error executing rule:", error);
      res.status(500).json({ error: error.message || "Failed to execute rule" });
    }
  });

  app.post("/api/cross-selling/staging/targeted", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const productNumber = typeof req.body?.productNumber === "string" ? req.body.productNumber.trim() : "";
      if (!productNumber) {
        return res.status(400).json({ error: "productNumber is required" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();
      const rules = await getCombinedCrossSellingRules(req.tenantId ?? null);

      const byNumber = await client.fetchProductsByNumbers([productNumber]);
      const resolvedByNumber = byNumber.get(productNumber) || null;
      const productResult = await client.fetchProducts(
        5,
        1,
        productNumber,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true
      );
      const sourceProduct =
        resolvedByNumber ||
        productResult.products.find((p) => p.productNumber === productNumber) ||
        productResult.products[0];

      if (!sourceProduct) {
        return res.status(404).json({ error: "Source product not found" });
      }

      const batch =
        (await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null)) ||
        (await storage.createCrossSellStagingBatch(
          {
            tenantId: req.tenantId ?? null,
            createdByUserId: (req.user as any)?.id ?? null,
            status: "draft",
          },
          req.tenantId ?? null
        ));

      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
      const suggestions = await ruleEngine.suggestCrossSelling(sourceProduct, rules, client, suggestOpts);
      let limited = dedupeAndLimitSuggestions(suggestions, 10);

      if (limited.length === 0) {
        const recommendations = await storage.getAiRecommendations(
          sourceProduct.productNumber as string,
          10,
          req.tenantId ?? null
        );
        const recommendedNumbers = Array.from(
          new Set(recommendations.map((rec) => rec.recommendedProductNumber).filter(Boolean))
        );
        if (recommendedNumbers.length > 0) {
          const productsByNumber = await client.fetchProductsByNumbers(recommendedNumbers);
          limited = recommendedNumbers
            .map((number) => productsByNumber.get(number))
            .filter(Boolean);
        }
      }

      const sourceCategories = (sourceProduct.categoryNames || [])
        .map((name: string) => name.trim().toLowerCase())
        .filter(Boolean);
      const sourceProperties = (sourceProduct.properties || [])
        .map((prop: { groupName: string; optionName: string }) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
        .filter(Boolean);

      const filtered = limited.filter((target) => {
        if (sourceCategories.length > 0) {
          const targetCategories = new Set(
            (target.categoryNames || []).map((name: string) => name.trim().toLowerCase()).filter(Boolean)
          );
          if (!sourceCategories.every((name: string) => targetCategories.has(name))) {
            return false;
          }
        }

        if (sourceProperties.length > 0) {
          const targetProperties = new Set(
            (target.properties || [])
              .map((prop) => `${prop.groupName}::${prop.optionName}`.toLowerCase())
              .filter(Boolean)
          );
          if (!sourceProperties.every((value: string) => targetProperties.has(value))) {
            return false;
          }
        }

        return true;
      });

      const stagingSuggestions = filtered
        .filter((suggestion) => !!suggestion.productNumber)
        .map((suggestion) => ({
          batchId: batch.id,
          tenantId: req.tenantId ?? null,
          sourceProductId: sourceProduct.id ?? null,
          sourceProductNumber: sourceProduct.productNumber as string,
          targetProductId: suggestion.id ?? null,
          targetProductNumber: suggestion.productNumber as string,
          active: 1,
        }));

      await storage.replaceCrossSellStagingSuggestionsForSource(
        batch.id,
        sourceProduct.productNumber as string,
        stagingSuggestions,
        req.tenantId ?? null
      );

      res.json({ batchId: batch.id, sourceProductNumber: sourceProduct.productNumber, suggestionsCount: stagingSuggestions.length });
    } catch (error: any) {
      console.error("Error generating targeted staging suggestions:", error);
      res.status(500).json({ error: error.message || "Failed to generate targeted suggestions" });
    }
  });

  /** Shopware-Artikelbezeichnungen zu Nummern (max. 400) fuer UI-Tabellen und Insights. */
  app.post("/api/cross-selling/product-labels", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const schema = z.object({
        productNumbers: z.array(z.string()).max(400),
      });
      const { productNumbers } = schema.parse(req.body);
      const unique = Array.from(new Set(productNumbers.map((n) => n.trim()).filter(Boolean))).slice(0, 400);
      if (unique.length === 0) {
        return res.json({ labels: {} as Record<string, { name: string | null; id: string | null }> });
      }
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      const map = await client.fetchProductsByNumbers(unique);
      const labels: Record<string, { name: string | null; id: string | null }> = {};
      for (const pn of unique) {
        const p = map.get(pn);
        labels[pn] = {
          name: (p?.name as string | undefined) ?? null,
          id: (p?.id as string | undefined) ?? null,
        };
      }
      res.json({ labels });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid body" });
      }
      console.error("Error resolving cross-selling product labels:", error);
      res.status(500).json({ error: error.message || "Failed to resolve labels" });
    }
  });

  /**
   * Vorschau der geplanten Shopware-Uebertragung (gleiche Gruppierung wie POST /staging/apply, ohne Schreibzugriff).
   */
  app.get("/api/cross-selling/staging/apply-preview", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batchId = typeof req.query.batchId === "string" ? req.query.batchId.trim() : undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, req.tenantId ?? null)
        : await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const suggestions = await storage.getCrossSellStagingSuggestions(batch.id, req.tenantId ?? null);
      const activeSuggestions = suggestions.filter((s) => s.active === 1);
      const grouped = groupActiveStagingSuggestionsBySourceAndCategory(suggestions);

      const allNumbers = new Set<string>();
      for (const [src, catMap] of grouped) {
        allNumbers.add(src);
        const merged = mergeStagingTargetsByCategoryOrder(catMap);
        for (const t of merged) {
          allNumbers.add(t.targetProductNumber);
        }
      }

      const productMap = await client.fetchProductsByNumbers(Array.from(allNumbers));
      const nameFor = (pn: string) => {
        const p = productMap.get(pn);
        return (p?.name as string | undefined) ?? null;
      };

      const operations: Array<{
        sourceProductNumber: string;
        sourceProductName: string | null;
        category: string | null;
        shopwareGroupName: string;
        targets: Array<{ productNumber: string; name: string | null }>;
        targetsTotalBeforeCap: number;
        targetsApplied: number;
      }> = [];

      for (const [sourceProductNumber, categoryMap] of grouped) {
        const merged = mergeStagingTargetsByCategoryOrder(categoryMap);
        const slice = merged.slice(0, 10);
        if (slice.length === 0) continue;
        operations.push({
          sourceProductNumber,
          sourceProductName: nameFor(sourceProductNumber),
          category: null,
          shopwareGroupName: SHOPWARE_CROSS_SELLING_STOREFRONT_NAME,
          targets: slice.map((t) => ({
            productNumber: t.targetProductNumber,
            name: nameFor(t.targetProductNumber),
          })),
          targetsTotalBeforeCap: merged.length,
          targetsApplied: slice.length,
        });
      }

      res.json({
        batchId: batch.id,
        summary: {
          activeSuggestions: activeSuggestions.length,
          operations: operations.length,
        },
        operations,
      });
    } catch (error: any) {
      console.error("Error building staging apply preview:", error);
      res.status(500).json({ error: error.message || "Failed to build preview" });
    }
  });

  app.post("/api/cross-selling/staging/apply", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const batchId = req.body?.batchId as string | undefined;
      const batch = batchId
        ? await storage.getCrossSellStagingBatch(batchId, req.tenantId ?? null)
        : await storage.getLatestCrossSellStagingBatch(req.tenantId ?? null);

      if (!batch) {
        return res.status(404).json({ error: "No staging batch found" });
      }

      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const suggestions = await storage.getCrossSellStagingSuggestions(batch.id, req.tenantId ?? null);
      const groupedBySourceAndCategory = groupActiveStagingSuggestionsBySourceAndCategory(suggestions);

      const productIdCache = new Map<string, string | null>();
      const resolveProductId = async (productNumber: string): Promise<string | null> => {
        if (productIdCache.has(productNumber)) {
          return productIdCache.get(productNumber) ?? null;
        }
        const result = await client.fetchProducts(5, 1, productNumber, undefined, false, undefined, undefined, undefined, true);
        const match = result.products.find((p) => p.productNumber === productNumber) || result.products[0];
        const id = match?.id ?? null;
        productIdCache.set(productNumber, id);
        return id;
      };

      const results = {
        sourcesProcessed: 0,
        crossSellingsCreated: 0,
        crossSellingsUpdated: 0,
        sourcesSkipped: 0,
        errors: [] as Array<{ sourceProductNumber: string; error: string }>,
      };

      // Process each source product
      for (const [sourceProductNumber, categoryMap] of Array.from(groupedBySourceAndCategory.entries())) {
        const sourceProductId = await resolveProductId(sourceProductNumber);
        if (!sourceProductId) {
          results.sourcesSkipped++;
          results.errors.push({ sourceProductNumber, error: "Source product not found" });
          continue;
        }

        const existingGroups = await client.fetchProductCrossSelling(sourceProductId);

        const mergedTargets = mergeStagingTargetsByCategoryOrder(categoryMap);
        const targetIds: string[] = [];
        for (const target of mergedTargets.slice(0, 10)) {
          const targetId = target.targetProductId ?? (await resolveProductId(target.targetProductNumber));
          if (targetId) {
            targetIds.push(targetId);
          }
        }

        if (targetIds.length === 0) {
          results.sourcesProcessed++;
          continue;
        }

        try {
          const shopwareGroupName = SHOPWARE_CROSS_SELLING_STOREFRONT_NAME;
          const existingGroup = existingGroups.find(
            (g) => g.name === shopwareGroupName && g.type === "productList",
          );

          let crossSellingId = existingGroup?.id;
          let createdNew = false;

          if (!crossSellingId) {
            crossSellingId = await client.createProductCrossSelling(sourceProductId, shopwareGroupName, "productList");
            createdNew = true;
          } else {
            const existingProducts = await client.fetchCrossSellingProducts(sourceProductId, crossSellingId);
            const existingIds = existingProducts.map((product) => product.id).filter(Boolean);
            if (existingIds.length > 0) {
              await client.removeProductsFromCrossSelling(crossSellingId, existingIds);
            }
          }

          await client.assignProductsToCrossSelling(crossSellingId, targetIds);

          if (createdNew) {
            results.crossSellingsCreated++;
          } else {
            results.crossSellingsUpdated++;
          }
        } catch (error: any) {
          results.errors.push({
            sourceProductNumber,
            error: `${SHOPWARE_CROSS_SELLING_STOREFRONT_NAME}: ${error.message || "Failed"}`,
          });
        }

        results.sourcesProcessed++;
      }

      res.json(results);
    } catch (error: any) {
      console.error("Error applying staging cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to apply staging" });
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

  app.get("/api/offers/learning-settings", requireAuth, requireManageOffers, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await getOfferLearningSettings(storage, tenantId);
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching offer learning settings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer learning settings" });
    }
  });

  app.put("/api/offers/learning-settings", requireAuth, requireManageOffers, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const schema = z.object({
        lookbackDays: z.number().min(1).max(3650),
        minOfferValue: z.number().min(0),
      });
      const validated = schema.parse(req.body);
      await storage.saveSetting("offer_learning_settings", validated, tenantId);
      res.json(validated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error saving offer learning settings:", error);
      res.status(500).json({ error: error.message || "Failed to save offer learning settings" });
    }
  });

  app.get("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const rule = await storage.getCrossSellingRule(req.params.id, tenantId);
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      console.error("Error fetching cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rule" });
    }
  });

  app.post("/api/cross-selling-rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      // Validate request body
      const validation = insertCrossSellingRuleSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      // Convert arrays to JSON strings for storage
      const ruleData = {
        ...validation.data,
        sourceConditions: JSON.stringify(validation.data.sourceConditions),
        targetCriteria: JSON.stringify(validation.data.targetCriteria),
      } as any;

      const rule = await storage.createCrossSellingRule(ruleData, tenantId);
      res.json(rule);
    } catch (error: any) {
      console.error("Error creating cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to create rule" });
    }
  });

  app.put("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      // Validate request body (partial updates allowed)
      const validation = insertCrossSellingRuleSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      // Convert arrays to JSON strings for storage
      const updates: any = { ...validation.data };
      if (updates.sourceConditions) {
        updates.sourceConditions = JSON.stringify(updates.sourceConditions);
      }
      if (updates.targetCriteria) {
        updates.targetCriteria = JSON.stringify(updates.targetCriteria);
      }

      const rule = await storage.updateCrossSellingRule(req.params.id, updates, tenantId);

      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      console.error("Error updating cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to update rule" });
    }
  });

  app.delete("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const deleted = await storage.deleteCrossSellingRule(req.params.id, req.tenantId ?? null);
      if (!deleted) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json({ message: "Rule deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to delete rule" });
    }
  });

  // Bulk execution of cross-selling rules
  app.post("/api/cross-selling-rules/execute-bulk", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      if (process.env.CROSS_SELL_BULK_ENABLED === "false") {
        return res.status(403).json({
          error: "Bulk cross-selling execution is disabled (CROSS_SELL_BULK_ENABLED=false).",
        });
      }

      const { ruleId } = req.body; // Optional: if provided, only execute this rule
      
      console.log(`[Bulk Execution] Starting bulk execution${ruleId ? ` for rule ${ruleId}` : ' for all rules'}...`);
      
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();

      // Fetch rules to execute
      const rules = ruleId
        ? await storage.getCrossSellingRule(ruleId, req.tenantId ?? null).then((r) => (r ? [r] : []))
        : await getCombinedCrossSellingRules(req.tenantId ?? null);
      
      if (rules.length === 0) {
        return res.status(404).json({ error: "No rules found" });
      }

      console.log(`[Bulk Execution] Executing ${rules.length} rule(s)...`);

      const allProducts = await fetchAllProductsForStaging(client);
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "hybrid_only");
      
      console.log(`[Bulk Execution] Processing ${allProducts.length} products (paginated catalog)...`);

      // Track results
      const results = {
        totalProducts: allProducts.length,
        productsProcessed: 0,
        crossSellingsCreated: 0,
        productsSkipped: 0,
        errors: [] as Array<{ productId: string; productName: string; error: string }>,
      };

      // Process each product
      for (const product of allProducts) {
        try {
          console.log(`[Bulk Execution] Processing product: ${product.name} (${product.productNumber})`);
          
          // Get cross-selling suggestions for this product using rule engine
          const suggestions = await ruleEngine.suggestCrossSelling(product, rules, client, suggestOpts);
          const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
          
          if (limitedSuggestions.length === 0) {
            console.log(`[Bulk Execution] No suggestions for product ${product.name}`);
            results.productsSkipped++;
            results.productsProcessed++;
            continue;
          }

          console.log(`[Bulk Execution] Found ${limitedSuggestions.length} suggestions for product ${product.name}`);

          try {
            const existingGroups = await client.fetchProductCrossSelling(product.id);
            const existingGroup = existingGroups.find(
              (g) => g.name === SHOPWARE_CROSS_SELLING_STOREFRONT_NAME && g.type === "productList",
            );
            let crossSellingId = existingGroup?.id;

            if (!crossSellingId) {
              crossSellingId = await client.createProductCrossSelling(
                product.id,
                SHOPWARE_CROSS_SELLING_STOREFRONT_NAME,
              );
              console.log(`[Bulk Execution] Created cross-selling group ${crossSellingId} for product ${product.name}`);
            } else {
              const existingProducts = await client.fetchCrossSellingProducts(product.id, crossSellingId);
              const existingIds = existingProducts.map((p) => p.id).filter(Boolean) as string[];
              if (existingIds.length > 0) {
                await client.removeProductsFromCrossSelling(crossSellingId, existingIds);
              }
              console.log(`[Bulk Execution] Updated cross-selling group ${crossSellingId} for product ${product.name}`);
            }

            const suggestionIds = limitedSuggestions.map((s) => s.id).filter(Boolean) as string[];
            await client.assignProductsToCrossSelling(crossSellingId, suggestionIds);
            console.log(`[Bulk Execution] Assigned ${suggestionIds.length} products to cross-selling group`);

            results.crossSellingsCreated++;
          } catch (error: any) {
            console.error(`[Bulk Execution] Error creating cross-selling for product ${product.name}:`, error);
            results.errors.push({
              productId: product.id,
              productName: product.name,
              error: error.message || 'Unknown error',
            });
          }
          
          results.productsProcessed++;
        } catch (error: any) {
          console.error(`[Bulk Execution] Error processing product ${product.name}:`, error);
          results.errors.push({
            productId: product.id,
            productName: product.name,
            error: error.message || 'Unknown error',
          });
          results.productsProcessed++;
        }
      }

      console.log(`[Bulk Execution] Complete. Processed: ${results.productsProcessed}, Created: ${results.crossSellingsCreated}, Skipped: ${results.productsSkipped}, Errors: ${results.errors.length}`);
      
      res.json(results);
    } catch (error: any) {
      console.error("Error executing bulk cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to execute bulk cross-selling" });
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

  // Cross-Selling Suggestions endpoint (rule-based)
  app.get("/api/products/:productId/cross-selling-suggestions", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const { productId } = req.params;
      console.log(`[Suggestions] Generating cross-selling suggestions for product ${productId}...`);
      
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        console.log("[Suggestions] Shopware settings not configured");
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);

      const byId = await client.fetchProducts(1, 1, undefined, undefined, false, undefined, undefined, undefined, true, undefined, false, false, productId);
      const sourceProduct = byId.products[0];

      if (!sourceProduct) {
        console.log(`[Suggestions] Source product ${productId} not found`);
        return res.status(404).json({ error: "Product not found" });
      }
      
      console.log(`[Suggestions] Source product found: ${sourceProduct.name} (${sourceProduct.productNumber})`);

      // Get all active rules
      const rules = await getCombinedCrossSellingRules(req.tenantId ?? null);
      const activeRules = rules.filter(r => r.active === 1);

      if (activeRules.length === 0) {
        console.log("[Suggestions] No active rules found, returning empty suggestions");
        return res.json({ suggestions: [] });
      }

      // Apply rules to find suggestions using Shopware search
      const ruleEngine = new RuleEngine();
      const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
      const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
      const suggestions = await ruleEngine.suggestCrossSelling(
        sourceProduct,
        activeRules,
        client,
        suggestOpts,
      );
      
      const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
      console.log(`[Suggestions] Generated ${limitedSuggestions.length} suggestion(s) for ${sourceProduct.productNumber}`);

      res.json({
        suggestions: limitedSuggestions.map((s) => ({
          ...s,
          crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
          hybridScore: (s as { hybridScore?: number }).hybridScore,
        })),
      });
    } catch (error: any) {
      console.error("[Suggestions] Error generating cross-selling suggestions:", error);
      console.error("[Suggestions] Error stack:", error.stack);
      res.status(500).json({ error: error.message || "Failed to generate suggestions" });
    }
  });

  /** Cross-selling funnel events: Server-Log + Persistenz in cross_sell_events (Quality-Ranker). */
  app.post("/api/cross-selling/analytics-events", requireAuth, requireCsrf, async (req, res) => {
    try {
      const bodySchema = z.object({
        event: z.enum([
          "product_suggestions_impression",
          "product_suggestion_impression",
          "product_suggestion_click",
          "product_suggestion_add_to_group",
          "product_suggestion_remove",
          "product_suggestion_return",
          "draft_suggestions_impression",
          "draft_suggestion_add",
          "staging_apply",
          "bulk_execute",
          "learning_run",
        ]),
        context: z.string().max(200).optional(),
        draftId: z.string().optional(),
        sourceProductId: z.string().optional(),
        targetProductId: z.string().optional(),
        sourceProductNumber: z.string().optional(),
        targetProductNumber: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      });
      const body = bodySchema.parse(req.body);
      const payload = {
        type: "cross_sell_analytics",
        at: new Date().toISOString(),
        tenantId: req.tenantId ?? null,
        userId: (req.user as { id?: string })?.id ?? null,
        ...body,
      };
      console.info("[cross_sell_analytics]", JSON.stringify(payload));

      const tid = req.tenantId ?? null;
      const userId = (req.user as { id?: string })?.id ?? null;

      const persistPair = async (
        dbEventType: string,
        sourceNum: string,
        targetNum: string,
        meta?: Record<string, unknown> | null,
      ) => {
        await storage.recordCrossSellEvent(
          {
            eventType: dbEventType,
            sourceProductNumber: sourceNum,
            targetProductNumber: targetNum,
            context: body.context ?? null,
            draftId: body.draftId ?? null,
            userId: userId ?? null,
            metadata: meta ?? null,
          },
          tid,
        );
      };

      const sourceNum = await resolveCrossSellProductNumberForAnalytics(
        tid,
        body.sourceProductNumber,
        body.sourceProductId,
      );
      const targetNum = await resolveCrossSellProductNumberForAnalytics(
        tid,
        body.targetProductNumber,
        body.targetProductId,
      );

      const pairDbTypes = new Set([
        "product_suggestion_click",
        "product_suggestion_add_to_group",
        "product_suggestion_remove",
        "product_suggestion_return",
        "draft_suggestion_add",
      ]);

      if (pairDbTypes.has(body.event) && sourceNum && targetNum) {
        await persistPair(body.event, sourceNum, targetNum, body.metadata as Record<string, unknown> | null);
      }

      if (body.event === "product_suggestion_impression" && sourceNum && targetNum) {
        await persistPair("product_suggestion_impression", sourceNum, targetNum, body.metadata as Record<string, unknown> | null);
      }

      if (body.event === "product_suggestions_impression") {
        const src =
          sourceNum ||
          (await resolveCrossSellProductNumberForAnalytics(tid, undefined, body.sourceProductId));
        const meta = (body.metadata || {}) as Record<string, unknown>;
        const targets = meta.suggestionProductNumbers;
        if (src && Array.isArray(targets)) {
          for (const t of targets) {
            if (typeof t === "string" && t.trim()) {
              await persistPair("product_suggestion_impression", src, t.trim(), { ...meta, batch: true });
            }
          }
        }
      }

      res.json({ ok: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid payload" });
      }
      console.error("[cross_sell_analytics] Error:", error);
      res.status(500).json({ error: error.message || "Failed to record event" });
    }
  });

  app.get("/api/orders/:orderId/invoice", requireAuth, requireViewDocumentsOrAccounting, async (req, res) => {
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
          const { generateImprovementSuggestions } = await import('./improvementSuggestions');
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

  // POST /api/erp-automation/trigger - Manually trigger automation polling (Admin only)
  app.post("/api/erp-automation/trigger", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const erpAutomationService = (global as any).erpAutomationService;
      
      if (!erpAutomationService) {
        return res.status(503).json({ 
          error: "ERP Automation service not available. Please check Shopware settings." 
        });
      }

      // Trigger manual polling
      await erpAutomationService.triggerManual();
      
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
  // Ticket Management Routes
  // ============================================

  // Get assignable users for tickets (requires manageTickets permission)
  app.get("/api/tickets/assignees", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      console.error("Error fetching ticket assignees:", error);
      res.status(500).json({ error: "Failed to fetch assignees" });
    }
  });

  // Get all tickets (requires viewTickets permission)
  app.get("/api/tickets", requireAuth, requireViewTickets, async (req, res) => {
    try {
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      // Parse pagination parameters
      const limit = parseInt(req.query.limit as string) || 50; // Default: 50 tickets per page
      const offset = parseInt(req.query.offset as string) || 0;
      
      // Check if pagination is requested
      const usePagination = req.query.limit !== undefined || req.query.offset !== undefined;
      
      let tickets: any[];
      let total: number | undefined;
      
      if (usePagination) {
        // Use paginated query
        const result = await storage.getTicketsPaginated(limit, offset);
        tickets = result.tickets;
        total = result.total;
        } else {
        // Backward compatibility: fetch all tickets
        tickets = await storage.getAllTickets();
      }
      
      const users = await storage.getAllUsers();
      
      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const user = req.user as any;
      const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, user?.id);
      
      const ticketsWithDetails = filteredTickets.map(ticket => {
        const assignedUser = ticket.assignedToUserId 
          ? users.find(u => u.id === ticket.assignedToUserId)
          : null;
        const createdByUser = ticket.createdByUserId 
          ? users.find(u => u.id === ticket.createdByUserId)
          : null;
        
        return {
          ...ticket,
          assignedToUsername: assignedUser?.username || null,
          createdByUsername: createdByUser?.username || null,
        };
      });
      
      if (usePagination) {
        // Return paginated response with metadata
        res.json({
          tickets: ticketsWithDetails,
          total,
          limit,
          offset,
        });
      } else {
        // Backward compatibility: return array
      res.json(ticketsWithDetails);
      }
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  // Get single ticket by ID
  app.get("/api/tickets/:id", requireAuth, requireViewTickets, async (req, res) => {
    try {
      // SECURITY: Get user context and sales channel filter (server-side, authoritative)
      const currentUserId = (req.user as any)?.id;
      if (!currentUserId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      
      const allowedChannelIds = await getSalesChannelFilter(req);

      const ticket = await storage.getTicket(req.params.id);
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      
      // SECURITY: Check sales channel access (indirect via orderId)
      if (ticket.orderId && allowedChannelIds !== null) {
          // Fetch the specific order to get salesChannelId
          const settings = await storage.getShopwareSettings();
          let hasAccess = false;
          
        if (settings) {
            try {
              const client = new ShopwareClient(settings);
              const ordersMap = await client.fetchOrdersByIds([ticket.orderId]);
              const order = ordersMap.get(ticket.orderId);
              
            if (order && allowedChannelIds.includes(order.salesChannelId)) {
                hasAccess = true;
              }
            } catch (error) {
            console.error("[Security] Error checking ticket access:", error);
            }
          }
          
          if (!hasAccess) {
            return res.status(403).json({ error: "You don't have access to this ticket" });
          }
      }
      
      // SECURITY: Standalone tickets (no orderId) require creator/assignee check for non-admins
      if (!ticket.orderId && allowedChannelIds !== null) {
        // Only visible if user is creator or assignee
        if (ticket.createdByUserId !== currentUserId && ticket.assignedToUserId !== currentUserId) {
          return res.status(403).json({ error: "You don't have access to this ticket" });
        }
      }
      // Admin (allowedChannelIds = null) has full access to all tickets
      
      const users = await storage.getAllUsers();
      const assignedUser = ticket.assignedToUserId 
        ? users.find(u => u.id === ticket.assignedToUserId)
        : null;
      const createdByUser = ticket.createdByUserId 
        ? users.find(u => u.id === ticket.createdByUserId)
        : null;
      
      res.json({
        ...ticket,
        assignedToUsername: assignedUser?.username || null,
        createdByUsername: createdByUser?.username || null,
      });
    } catch (error) {
      console.error("Error fetching ticket:", error);
      res.status(500).json({ error: "Failed to fetch ticket" });
    }
  });

  // ============================================
  // Portal Ticket Routes (Customer)
  // ============================================

  const matchesCustomer = (ticket: any, customer: any) => {
    if (!customer) return false;
    if (customer.customerId && ticket.customerId === customer.customerId) {
      return true;
    }
    if (customer.email && ticket.customerEmail?.toLowerCase() === customer.email.toLowerCase()) {
      return true;
    }
    return false;
  };

  app.get("/api/portal/tickets", requireCustomerAuth, async (req: Request & CustomerRequest, res: Response) => {
    try {
      const customer = req.customer;
      if (!customer) {
        return res.status(401).json({ error: "Customer not authenticated" });
      }

      const tickets = await storage.getAllTickets();
      const filtered = tickets
        .filter((ticket) => matchesCustomer(ticket, customer))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching portal tickets:", error);
      res.status(500).json({ error: error.message || "Failed to fetch tickets" });
    }
  });

  app.get("/api/portal/tickets/:id", requireCustomerAuth, async (req: Request & CustomerRequest, res: Response) => {
    try {
      const customer = req.customer;
      if (!customer) {
        return res.status(401).json({ error: "Customer not authenticated" });
      }

      const ticket = await storage.getTicket(req.params.id);
      if (!ticket || !matchesCustomer(ticket, customer)) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      res.json(ticket);
    } catch (error: any) {
      console.error("Error fetching portal ticket:", error);
      res.status(500).json({ error: error.message || "Failed to fetch ticket" });
    }
  });

  app.get("/api/portal/tickets/:id/comments", requireCustomerAuth, async (req: Request & CustomerRequest, res: Response) => {
    try {
      const customer = req.customer;
      if (!customer) {
        return res.status(401).json({ error: "Customer not authenticated" });
      }

      const ticket = await storage.getTicket(req.params.id);
      if (!ticket || !matchesCustomer(ticket, customer)) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const comments = await storage.getTicketComments(req.params.id);
      const visible = comments
        .filter((comment) => comment.isInternal === 0)
        .map((comment) => ({
          ...comment,
          username:
            (comment as any).customerName ||
            (comment as any).customerEmail ||
            "Customer",
        }))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      res.json(visible);
    } catch (error: any) {
      console.error("Error fetching portal comments:", error);
      res.status(500).json({ error: error.message || "Failed to fetch comments" });
    }
  });

  app.post("/api/portal/tickets/:id/comments", requireCustomerAuth, async (req: Request & CustomerRequest, res: Response) => {
    try {
      const customer = req.customer;
      if (!customer) {
        return res.status(401).json({ error: "Customer not authenticated" });
      }

      const ticket = await storage.getTicket(req.params.id);
      if (!ticket || !matchesCustomer(ticket, customer)) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const commentText = String(req.body.comment || "").trim();
      if (!commentText) {
        return res.status(400).json({ error: "Comment is required" });
      }

      const validated = insertTicketCommentSchema.parse({
        ticketId: req.params.id,
        userId: null,
        comment: commentText,
        isInternal: 0,
        authorType: "customer",
        customerId: customer.customerId || null,
        customerEmail: customer.email || null,
        customerName: customer.name || null,
      });

      const comment = await storage.createTicketComment(validated);

      await applyAutoStatusAfterComment(ticket, "customer", false);

      // Trigger webhook for ticket.commented (customer)
      webhookService.trigger("ticket.commented", {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        commentId: comment.id,
        comment: comment.comment,
        isInternal: false,
        userId: null,
        username: customer.name || customer.email || "Customer",
        authorType: "customer",
        createdAt: comment.createdAt.toISOString(),
      }, {
        source: "portal",
        actorId: customer.customerId || customer.email || "customer",
      }).catch(err => {
        console.error("Error triggering ticket.commented webhook:", err);
      });

      webhookService.trigger("ticket.customer_replied", {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        commentId: comment.id,
        comment: comment.comment,
        isInternal: false,
        userId: null,
        username: customer.name || customer.email || "Customer",
        authorType: "customer",
        createdAt: comment.createdAt.toISOString(),
      }, {
        source: "portal",
        actorId: customer.customerId || customer.email || "customer",
      }).catch(err => {
        console.error("Error triggering ticket.customer_replied webhook:", err);
      });

      res.status(201).json(comment);
    } catch (error: any) {
      console.error("Error creating portal comment:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid comment data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to create comment" });
    }
  });

  app.post("/api/portal/tickets", requireCustomerAuth, async (req: Request & CustomerRequest, res: Response) => {
    try {
      const customer = req.customer;
      if (!customer) {
        return res.status(401).json({ error: "Customer not authenticated" });
      }

      const schema = z.object({
        title: z.string().min(3),
        description: z.string().min(1),
        category: z.enum([
          "general",
          "order_issue",
          "product_inquiry",
          "technical_support",
          "complaint",
          "feature_request",
          "other",
        ]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        orderId: z.string().optional(),
        orderNumber: z.string().optional(),
      });

      const validated = schema.parse(req.body);
      const slaSettings = await getTicketSlaSettings();
      const priority = validated.priority || "normal";
      const ticket = await storage.createTicket({
        title: validated.title,
        description: validated.description,
        status: "open",
        priority,
        category: validated.category || "general",
        orderId: validated.orderId,
        orderNumber: validated.orderNumber,
        createdByUserId: null,
        customerId: customer.customerId || null,
        customerEmail: customer.email || null,
        customerName: customer.name || null,
        dueDate: calculateDueDate(priority, slaSettings),
      });

      try {
        await notifyNewTicket(storage, {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          assignedToUserId: ticket.assignedToUserId || null,
        });
      } catch (error) {
        console.error("Error sending push notification for portal ticket:", error);
      }

      res.status(201).json(ticket);
    } catch (error: any) {
      console.error("Error creating portal ticket:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to create ticket" });
    }
  });

  // Get tickets by order ID
  app.get("/api/orders/:orderId/tickets", requireAuth, async (req, res) => {
    try {
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      const tickets = await storage.getTicketsByOrderId(req.params.orderId);
      
      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const user = req.user as any;
      const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, user?.id);
      
      res.json(filteredTickets);
    } catch (error) {
      console.error("Error fetching tickets for order:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  // Get comment counts for all orders
  app.get("/api/orders/comment-counts", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const userId = user.id;

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      const tickets = await storage.getAllTickets();
      
      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      let filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, userId);
      
      // Filter out standalone tickets (no orderId) for comment counts
      filteredTickets = filteredTickets.filter(ticket => ticket.orderId);
      
      // Count comments per order - parallelize lookups for performance
      const commentCounts: Record<string, { total: number; unread: number }> = {};
      
      await Promise.all(
        filteredTickets.map(async (ticket) => {
          if (!ticket.orderId) return;
          
          // Get all comments for this ticket
          const comments = await storage.getTicketComments(ticket.id);
          
          // Get unread counts for this ticket
          const { unreadComments } = await storage.getUnreadCounts(ticket.id, userId);
          
          // Initialize order entry if it doesn't exist
          if (!commentCounts[ticket.orderId]) {
            commentCounts[ticket.orderId] = { total: 0, unread: 0 };
          }
          
          // Add counts
          commentCounts[ticket.orderId].total += comments.length;
          commentCounts[ticket.orderId].unread += unreadComments;
        })
      );
      
      res.json(commentCounts);
    } catch (error) {
      console.error("Error fetching comment counts:", error);
      res.status(500).json({ error: "Failed to fetch comment counts" });
    }
  });

  // Create new ticket (requires manageTickets permission)
  app.post("/api/tickets", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const validated = insertTicketSchema.parse({
        ...req.body,
        createdByUserId: userId,
      });
      const slaSettings = await getTicketSlaSettings();
      const dueDate = validated.dueDate || calculateDueDate(validated.priority, slaSettings);
      
      let ticket = await storage.createTicket({
        ...validated,
        dueDate,
      });
      
      // Auto-assign if no assignee specified
      if (!ticket.assignedToUserId) {
        const assigneeId = await assignTicketAutomatically(ticket);
        if (assigneeId) {
          const updated = await storage.updateTicket(ticket.id, { assignedToUserId: assigneeId });
          if (updated) {
            ticket = updated;
            // Log auto-assignment
            await storage.createTicketActivityLog({
              ticketId: ticket.id,
              userId,
              action: 'auto_assigned',
              fieldName: 'assignedToUserId',
              newValue: assigneeId,
            });

            // Trigger webhook for ticket.assigned (auto-assignment)
            webhookService.trigger("ticket.assigned", {
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              previousAssignee: null,
              newAssignee: assigneeId,
              assignedBy: userId,
              assignedAt: new Date().toISOString(),
            }, {
              source: "auto_assignment",
              trigger: "ticket_creation",
              actorId: "system", // Automated assignment triggered by system
            }).catch(err => {
              console.error("Error triggering ticket.assigned webhook (auto-assign):", err);
            });
          }
        }
      }

      try {
        await notifyNewTicket(storage, {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          assignedToUserId: ticket.assignedToUserId || null,
        });
      } catch (error) {
        console.error("Error sending push notification for email file ticket:", error);
      }

      try {
        await notifyNewTicket(storage, {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          assignedToUserId: ticket.assignedToUserId || null,
        });
      } catch (error) {
        console.error("Error sending push notification for ticket:", error);
      }

      // Trigger webhook for ticket.created
      webhookService.trigger("ticket.created", {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        title: ticket.title,
        priority: ticket.priority,
        status: ticket.status,
        assignedToUserId: ticket.assignedToUserId || null,
        createdByUserId: ticket.createdByUserId ?? userId,
        createdAt: ticket.createdAt.toISOString(),
      }, {
        source: "api",
        actorId: userId,
      }).catch(err => {
        console.error("Error triggering ticket.created webhook:", err);
      });
      
      res.status(201).json(ticket);
    } catch (error: any) {
      console.error("Error creating ticket:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid ticket data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create ticket" });
    }
  });

  // Update ticket (requires manageTickets permission)
  app.patch("/api/tickets/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const validated = insertTicketSchema.partial().parse(req.body);
      const userId = (req.user as any).id;
      
      // Get the old ticket to track changes
      const oldTicket = await storage.getTicket(req.params.id);
      if (!oldTicket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      let updateData = { ...validated };
      if (validated.priority !== undefined && validated.dueDate === undefined && !oldTicket.dueDate) {
        const slaSettings = await getTicketSlaSettings();
        updateData = {
          ...updateData,
          dueDate: calculateDueDate(validated.priority, slaSettings),
        };
      }

      // Update the ticket
      const updated = await storage.updateTicket(req.params.id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      // Track changes in activity log
      const trackChange = async (field: string, action: string, oldValue: any, newValue: any) => {
        if (oldValue !== newValue) {
          await storage.createTicketActivityLog({
            ticketId: req.params.id,
            userId,
            action,
            fieldName: field,
            oldValue: oldValue != null ? String(oldValue) : null,
            newValue: newValue != null ? String(newValue) : null,
          });
        }
      };

      // Track each field change
      if (validated.status !== undefined) {
        await trackChange('status', 'status_changed', oldTicket.status, validated.status);
      }
      if (validated.priority !== undefined) {
        await trackChange('priority', 'priority_changed', oldTicket.priority, validated.priority);
      }
      if (validated.category !== undefined) {
        await trackChange('category', 'category_changed', oldTicket.category, validated.category);
      }
      if (validated.assignedToUserId !== undefined) {
        await trackChange('assignedToUserId', 'assigned', oldTicket.assignedToUserId, validated.assignedToUserId);
        
        // Create notification if ticket is being assigned to someone
        if (validated.assignedToUserId && validated.assignedToUserId !== oldTicket.assignedToUserId) {
          const notification = await storage.createNotification({
            userId: validated.assignedToUserId,
            type: "ticket_assigned",
            title: "New Ticket Assigned",
            message: `Ticket ${updated.ticketNumber} "${updated.title}" has been assigned to you`,
            ticketId: updated.id,
            ticketNumber: updated.ticketNumber,
            read: 0,
          });
          
          // Emit event for SSE
          notificationEvents.emitNotificationCreated(notification);

          // Trigger webhook for ticket.assigned
          webhookService.trigger("ticket.assigned", {
            ticketId: updated.id,
            ticketNumber: updated.ticketNumber,
            previousAssignee: oldTicket.assignedToUserId,
            newAssignee: validated.assignedToUserId,
            assignedBy: userId,
            assignedAt: new Date().toISOString(),
          }, {
            source: "manual_assignment",
            actorId: userId,
          }).catch(err => {
            console.error("Error triggering ticket.assigned webhook:", err);
          });
        }
      }
      if (validated.title !== undefined) {
        await trackChange('title', 'title_changed', oldTicket.title, validated.title);
      }
      if (validated.description !== undefined) {
        await trackChange('description', 'description_changed', oldTicket.description, validated.description);
      }
      if (validated.tags !== undefined) {
        const oldTags = oldTicket.tags ? JSON.stringify(oldTicket.tags.sort()) : '[]';
        const newTags = validated.tags ? JSON.stringify(validated.tags.sort()) : '[]';
        if (oldTags !== newTags) {
          await storage.createTicketActivityLog({
            ticketId: req.params.id,
            userId,
            action: 'tags_changed',
            fieldName: 'tags',
            oldValue: oldTags,
            newValue: newTags,
          });
        }
      }
      if (validated.dueDate !== undefined) {
        const oldDate = oldTicket.dueDate ? oldTicket.dueDate.toISOString() : null;
        const newDate = validated.dueDate ? new Date(validated.dueDate).toISOString() : null;
        await trackChange('dueDate', 'due_date_changed', oldDate, newDate);
      }

      // Trigger webhook for ticket.updated (collect all changes)
      const changes: any[] = [];
      if (validated.status !== undefined && oldTicket.status !== validated.status) {
        changes.push({ field: 'status', oldValue: oldTicket.status, newValue: validated.status });
      }
      if (validated.priority !== undefined && oldTicket.priority !== validated.priority) {
        changes.push({ field: 'priority', oldValue: oldTicket.priority, newValue: validated.priority });
      }
      if (validated.category !== undefined && oldTicket.category !== validated.category) {
        changes.push({ field: 'category', oldValue: oldTicket.category, newValue: validated.category });
      }
      if (validated.title !== undefined && oldTicket.title !== validated.title) {
        changes.push({ field: 'title', oldValue: oldTicket.title, newValue: validated.title });
      }
      
      if (changes.length > 0) {
        webhookService.trigger("ticket.updated", {
          id: updated.id,
          ticketNumber: updated.ticketNumber,
          changes,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        }, {
          source: "api",
          actorId: userId,
          fieldsChanged: changes.map(c => c.field),
        }).catch(err => {
          console.error("Error triggering ticket.updated webhook:", err);
        });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating ticket:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid ticket data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update ticket" });
    }
  });

  // Delete ticket (requires manageTickets permission)
  app.delete("/api/tickets/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const success = await storage.deleteTicket(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      res.json({ message: "Ticket deleted successfully" });
    } catch (error) {
      console.error("Error deleting ticket:", error);
      res.status(500).json({ error: "Failed to delete ticket" });
    }
  });

  // ============================================
  // Ticket Comments Routes
  // ============================================

  // Get comments for a ticket
  app.get("/api/tickets/:ticketId/comments", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const comments = await storage.getTicketComments(req.params.ticketId);
      const users = await storage.getAllUsers();
      
      const commentsWithUsernames = comments
        .map(comment => {
        const user = comment.userId ? users.find(u => u.id === comment.userId) : null;
        const customerName =
          (comment as any).customerName ||
          (comment as any).customerEmail ||
          "Customer";
        return {
          ...comment,
          username: user?.username || customerName || "Unknown",
        };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      res.json(commentsWithUsernames);
    } catch (error) {
      console.error("Error fetching ticket comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  // Create comment on a ticket
  app.post("/api/tickets/:ticketId/comments", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const validated = insertTicketCommentSchema.parse({
        ticketId: req.params.ticketId,
        userId,
        comment: req.body.comment,
        isInternal: req.body.isInternal || 0,
        authorType: "user",
      });
      
      const comment = await storage.createTicketComment(validated);

      // Get ticket and user info for webhook
      const ticket = await storage.getTicket(req.params.ticketId);
      const user = await storage.getUser(userId);
      
      if (ticket && user) {
        await applyAutoStatusAfterComment(ticket, "user", Boolean(comment.isInternal));

        // Trigger webhook for ticket.commented
        webhookService.trigger("ticket.commented", {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          commentId: comment.id,
          comment: comment.comment,
          isInternal: Boolean(comment.isInternal),
          userId: user.id,
          username: user.username,
          authorType: "user",
          createdAt: comment.createdAt.toISOString(),
        }, {
          source: "api",
          actorId: userId,
        }).catch(err => {
          console.error("Error triggering ticket.commented webhook:", err);
        });

        if (!comment.isInternal) {
          webhookService.trigger("ticket.agent_replied", {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            commentId: comment.id,
            comment: comment.comment,
            isInternal: false,
            userId: user.id,
            username: user.username,
            authorType: "user",
            createdAt: comment.createdAt.toISOString(),
          }, {
            source: "api",
            actorId: userId,
          }).catch(err => {
            console.error("Error triggering ticket.agent_replied webhook:", err);
          });
        }

        const shouldSendEmail = req.body.sendEmail !== false;
        const recipient = ticket.customerEmail || ticket.emailFrom || null;
        if (!comment.isInternal && shouldSendEmail && recipient) {
          try {
            const { settings } = await getEmailOutboundSettings(storage);
            if (settings.enabled) {
              const latestMessage = await storage.getLatestTicketEmailMessage(ticket.id);
              const subjectBase = ticket.emailSubject || ticket.title || "Ticket";
              const subject = subjectBase.toLowerCase().startsWith("re:")
                ? subjectBase
                : `Re: ${subjectBase}`;

              const messageId = await sendEmail(storage, {
                to: recipient,
                subject,
                text: comment.comment,
                html: `<p>${comment.comment.replace(/\n/g, "<br/>")}</p>`,
                inReplyTo: latestMessage?.messageId || undefined,
                references: latestMessage?.references || (latestMessage?.messageId ? [latestMessage.messageId] : undefined),
              });

              await storage.createTicketEmailMessage({
                ticketId: ticket.id,
                commentId: comment.id,
                messageId: normalizeEmailMessageId(messageId),
                inReplyTo: latestMessage?.messageId || null,
                references: latestMessage?.references || (latestMessage?.messageId ? [latestMessage.messageId] : null),
                direction: "outbound",
                source: "smtp",
                subject,
                from: settings.fromAddress,
                to: recipient,
              });

              console.log(`[EmailOutbound] Sent reply for ticket ${ticket.ticketNumber}`);
            }
          } catch (error) {
            console.error("Error sending ticket reply email:", error);
          }
        }
      }

      res.status(201).json(comment);
    } catch (error: any) {
      console.error("Error creating comment:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid comment data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create comment" });
    }
  });

  // Delete comment (requires manageTickets permission)
  app.delete("/api/tickets/:ticketId/comments/:commentId", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const success = await storage.deleteTicketComment(req.params.commentId);
      if (!success) {
        return res.status(404).json({ error: "Comment not found" });
      }
      res.json({ message: "Comment deleted successfully" });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  // ============================================
  // Ticket Activity Log Routes
  // ============================================

  // Get activity log for a ticket
  app.get("/api/tickets/:ticketId/activity", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const activityLogs = await storage.getTicketActivityLog(req.params.ticketId);
      const users = await storage.getAllUsers();
      
      const logsWithUsernames = activityLogs.map(log => {
        const user = users.find(u => u.id === log.userId);
        return {
          ...log,
          username: user?.username || "Unknown",
        };
      });
      
      res.json(logsWithUsernames);
    } catch (error) {
      console.error("Error fetching ticket activity log:", error);
      res.status(500).json({ error: "Failed to fetch activity log" });
    }
  });

  // ============================================
  // Ticket Attachments Routes
  // ============================================

  // Use memory storage for Object Storage uploads (persistent)
  // Falls back to disk storage if Object Storage is not configured
  const useObjectStorage = objectStorageService.isConfigured();
  
  const attachmentStorage = useObjectStorage 
    ? multer.memoryStorage()
    : multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), 'ticket-attachments');
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, uploadPath);
      }
    },
    filename: (req, file, cb) => {
      const sanitizedName = sanitizeFilename(file.originalname);
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      cb(null, `${uniqueSuffix}-${sanitizedName}`);
    }
  });

  const attachmentUpload = multer({
    storage: attachmentStorage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
      files: 10, // Max 10 files per upload
    },
    fileFilter: (req, file, cb) => {
      // Only allow PNG, JPG, JPEG, PDF
      const allowedMimeTypes = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'application/pdf'
      ];
      
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type. Only PNG, JPG, JPEG, and PDF files are allowed. Received: ${file.mimetype}`));
      }
    }
  });
  
  console.log(`[Attachments] Storage mode: ${useObjectStorage ? 'Object Storage (persistent)' : 'Local Disk (non-persistent)'}`);

  const accountingUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // Helper: Check if filePath is an Object Storage key (prefix: "obj:")
  const isObjectStorageKey = (filePath: string): boolean => filePath.startsWith('obj:');
  const getObjectKey = (filePath: string): string => filePath.substring(4); // Remove "obj:" prefix

  // Get attachments for a ticket
  app.get("/api/tickets/:ticketId/attachments", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const attachments = await storage.getTicketAttachments(req.params.ticketId);
      res.json(attachments);
    } catch (error) {
      console.error("Error fetching ticket attachments:", error);
      res.status(500).json({ error: "Failed to fetch attachments" });
    }
  });

  // Upload attachment(s) to a ticket
  app.post("/api/tickets/:ticketId/attachments", 
    requireAuth, 
    requireViewTickets,
    uploadRateLimiter,
    attachmentUpload.array('files', 10),
    async (req, res) => {
      try {
        const userId = (req.user as any).id;
        const ticketId = req.params.ticketId;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
          return res.status(400).json({ error: "No files uploaded" });
        }

        // Verify ticket exists
        const ticket = await storage.getTicket(ticketId);
        if (!ticket) {
          // Clean up uploaded files (only for disk storage)
          if (!useObjectStorage) {
          for (const file of files) {
              if (file.path) await fs.unlink(file.path).catch(() => {});
            }
          }
          return res.status(404).json({ error: "Ticket not found" });
        }

        // Create attachment records for all uploaded files
        const attachments = await Promise.all(
          files.map(async (file) => {
            let filePath: string;
            let fileName: string;
            
            if (useObjectStorage && file.buffer) {
              // Upload to Object Storage (persistent)
              const result = await objectStorageService.uploadFromBuffer(
                file.buffer,
                file.originalname,
                file.mimetype
              );
              filePath = `obj:${result.objectKey}`; // Prefix with "obj:" to indicate Object Storage
              fileName = file.originalname;
              console.log(`[Attachments] Uploaded to Object Storage: ${result.objectKey}`);
            } else {
              // Local disk storage (non-persistent, fallback)
              filePath = file.path;
              fileName = file.filename;
              console.log(`[Attachments] Saved to disk: ${file.path}`);
            }
            
            const attachmentData = {
              ticketId,
              fileName,
              fileSize: file.size,
              mimeType: file.mimetype,
              filePath,
              uploadedByUserId: userId,
            };
            
            return storage.createTicketAttachment(attachmentData);
          })
        );

        res.status(201).json(attachments);
      } catch (error: any) {
        console.error("Error uploading attachments:", error);
        
        // Clean up any uploaded files in case of error (only for disk storage)
        if (!useObjectStorage && req.files) {
          const files = req.files as Express.Multer.File[];
          for (const file of files) {
            if (file.path) await fs.unlink(file.path).catch(() => {});
          }
        }

        if (error.message?.includes('Invalid file type')) {
          return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: "Failed to upload attachments" });
      }
    }
  );

  // Preview an attachment (inline display)
  app.get("/api/attachments/:attachmentId/preview", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const attachment = await storage.getTicketAttachment(req.params.attachmentId);
      
      if (!attachment) {
        console.error(`[Preview] Attachment not found: ${req.params.attachmentId}`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Verify user has access to the ticket
      const ticket = await storage.getTicket(attachment.ticketId);
      if (!ticket) {
        console.error(`[Preview] Ticket not found for attachment: ${req.params.attachmentId}`);
        return res.status(404).json({ error: "Associated ticket not found" });
      }

      // Check if this is an Object Storage file (prefix: "obj:")
      if (isObjectStorageKey(attachment.filePath)) {
        const objectKey = getObjectKey(attachment.filePath);
        console.log(`[Preview] Serving from Object Storage: ${objectKey}`);
        
        // Verify Object Storage is configured
        if (!objectStorageService.isConfigured()) {
          console.error(`[Preview] Object Storage not configured but file references it: ${objectKey}`);
          return res.status(404).json({ error: "File not available" });
        }
        
        try {
          // Set headers for inline preview
          res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
          await objectStorageService.downloadToResponse(objectKey, res);
          console.log(`[Preview] Successfully served from Object Storage: ${attachment.fileName}`);
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            console.error(`[Preview] Object not found in storage: ${objectKey}`);
            return res.status(404).json({ error: "File not found" });
          }
          console.error(`[Preview] Object Storage error:`, error);
          return res.status(500).json({ error: "Failed to retrieve file" });
        }
        return;
      }

      // Fallback: Local disk storage
      let absolutePath: string;
      try {
        absolutePath = resolveAttachmentPath(attachment.filePath);
      } catch (pathError) {
        console.error(`[Preview] Invalid attachment path: ${attachment.filePath}`);
        return res.status(400).json({ error: "Invalid attachment path" });
      }

      console.log(`[Preview] Serving from disk: ${absolutePath}`);

      // Check if file exists
      try {
        await fs.access(absolutePath);
      } catch (accessError) {
        console.error(`[Preview] File not found on disk: ${absolutePath}`);
        return res.status(404).json({ 
          error: "File not found on disk",
          details: "The file may have been deleted during a server restart. Please ask the sender to re-upload."
        });
      }

      // Set appropriate headers for inline preview
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
      res.setHeader('Content-Length', attachment.fileSize);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      // Stream the file
      res.sendFile(absolutePath, (err) => {
        if (err) {
          console.error(`[Preview] Error sending file:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to send file" });
          }
        } else {
          console.log(`[Preview] Successfully served from disk: ${attachment.fileName}`);
        }
      });
    } catch (error) {
      console.error("[Preview] Error previewing attachment:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to preview attachment" });
      }
    }
  });

  // Download an attachment
  app.get("/api/attachments/:attachmentId/download", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const attachment = await storage.getTicketAttachment(req.params.attachmentId);
      
      if (!attachment) {
        console.error(`[Download] Attachment not found: ${req.params.attachmentId}`);
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Verify user has access to the ticket
      const ticket = await storage.getTicket(attachment.ticketId);
      if (!ticket) {
        console.error(`[Download] Ticket not found for attachment: ${req.params.attachmentId}`);
        return res.status(404).json({ error: "Associated ticket not found" });
      }

      // Check if this is an Object Storage file (prefix: "obj:")
      if (isObjectStorageKey(attachment.filePath)) {
        const objectKey = getObjectKey(attachment.filePath);
        console.log(`[Download] Serving from Object Storage: ${objectKey}`);
        
        // Verify Object Storage is configured
        if (!objectStorageService.isConfigured()) {
          console.error(`[Download] Object Storage not configured but file references it: ${objectKey}`);
          return res.status(404).json({ error: "File not available" });
        }
        
        try {
          // Set headers for download
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.fileName)}"`);
          await objectStorageService.downloadToResponse(objectKey, res);
          console.log(`[Download] Successfully served from Object Storage: ${attachment.fileName}`);
        } catch (error) {
          if (error instanceof ObjectNotFoundError) {
            console.error(`[Download] Object not found in storage: ${objectKey}`);
            return res.status(404).json({ error: "File not found" });
          }
          console.error(`[Download] Object Storage error:`, error);
          return res.status(500).json({ error: "Failed to retrieve file" });
        }
        return;
      }

      // Fallback: Local disk storage
      let absolutePath: string;
      try {
        absolutePath = resolveAttachmentPath(attachment.filePath);
      } catch (pathError) {
        console.error(`[Download] Invalid attachment path: ${attachment.filePath}`);
        return res.status(400).json({ error: "Invalid attachment path" });
      }

      console.log(`[Download] Serving from disk: ${absolutePath}`);

      // Check if file exists
      try {
        await fs.access(absolutePath);
      } catch {
        console.error(`[Download] File not found on disk: ${absolutePath}`);
        return res.status(404).json({ 
          error: "File not found on disk",
          details: "The file may have been deleted during a server restart. Please ask the sender to re-upload."
        });
      }

      // Set appropriate headers for download
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.fileName)}"`);
      res.setHeader('Content-Length', attachment.fileSize);

      // Stream the file
      res.sendFile(absolutePath, (err) => {
        if (err) {
          console.error(`[Download] Error sending file:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to send file" });
          }
        }
      });
    } catch (error) {
      console.error("[Download] Error downloading attachment:", error);
      if (!res.headersSent) {
      res.status(500).json({ error: "Failed to download attachment" });
      }
    }
  });

  // Delete an attachment
  app.delete("/api/attachments/:attachmentId", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const attachment = await storage.getTicketAttachment(req.params.attachmentId);
      
      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Delete file from storage
      try {
        if (isObjectStorageKey(attachment.filePath)) {
          // Delete from Object Storage
          const objectKey = getObjectKey(attachment.filePath);
          if (objectStorageService.isConfigured()) {
            await objectStorageService.deleteObject(objectKey);
            console.log(`[Delete] Deleted from Object Storage: ${objectKey}`);
          } else {
            console.warn(`[Delete] Object Storage not configured, skipping file deletion: ${objectKey}`);
          }
        } else {
          // Delete from disk - handle both absolute and relative paths
          let absolutePath: string;
          try {
            absolutePath = resolveAttachmentPath(attachment.filePath);
          } catch (pathError) {
            console.error(`[Delete] Invalid attachment path: ${attachment.filePath}`);
            return res.status(400).json({ error: "Invalid attachment path" });
          }
          
          // Only attempt deletion if file exists
          try {
            await fs.access(absolutePath);
            await fs.unlink(absolutePath);
            console.log(`[Delete] Deleted from disk: ${absolutePath}`);
          } catch (accessError: any) {
            if (accessError.code === 'ENOENT') {
              console.warn(`[Delete] File already deleted or missing: ${absolutePath}`);
            } else {
              throw accessError;
            }
          }
        }
      } catch (error) {
        console.error("[Delete] Error deleting file from storage:", error);
        // Continue with database deletion even if file delete fails
      }

      // Delete from database
      const success = await storage.deleteTicketAttachment(req.params.attachmentId);
      
      if (!success) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      res.json({ message: "Attachment deleted successfully" });
    } catch (error) {
      console.error("Error deleting attachment:", error);
      res.status(500).json({ error: "Failed to delete attachment" });
    }
  });

  // Get unread counts for a ticket (comments and attachments)
  app.get("/api/tickets/:ticketId/unread-counts", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ticketId = req.params.ticketId;

      const counts = await storage.getUnreadCounts(ticketId, userId);
      res.json(counts);
    } catch (error) {
      console.error("Error fetching unread counts:", error);
      res.status(500).json({ error: "Failed to fetch unread counts" });
    }
  });

  // Mark all comments in a ticket as read
  app.post("/api/tickets/:ticketId/comments/mark-read", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ticketId = req.params.ticketId;

      await storage.markTicketCommentsAsRead(ticketId, userId);
      res.json({ message: "Comments marked as read" });
    } catch (error) {
      console.error("Error marking comments as read:", error);
      res.status(500).json({ error: "Failed to mark comments as read" });
    }
  });

  // Mark all attachments in a ticket as read
  app.post("/api/tickets/:ticketId/attachments/mark-read", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const ticketId = req.params.ticketId;

      await storage.markTicketAttachmentsAsRead(ticketId, userId);
      res.json({ message: "Attachments marked as read" });
    } catch (error) {
      console.error("Error marking attachments as read:", error);
      res.status(500).json({ error: "Failed to mark attachments as read" });
    }
  });

  // ============================================
  // Email Parser Routes
  // ============================================

  // Parse email file (.eml or .msg) and extract ticket data
  app.post("/api/parse-email", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { filename, fileData } = req.body;

      if (!filename || !fileData) {
        return res.status(400).json({ error: "Filename and fileData are required" });
      }

      // Decode base64 file data
      const buffer = Buffer.from(fileData, 'base64');

      // Parse email
      const parsedEmail = await parseEmailFile(buffer, filename);

      res.json({
        subject: parsedEmail.subject,
        from: parsedEmail.from,
        body: parsedEmail.body,
        attachmentCount: parsedEmail.attachments.length,
        orderNumber: parsedEmail.orderNumber,
        attachments: parsedEmail.attachments.map(att => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          // Don't send full content, just metadata
        })),
      });
    } catch (error: any) {
      console.error("Error parsing email:", error);
      res.status(500).json({ error: error.message || "Failed to parse email" });
    }
  });

  // Create ticket from email (.eml or .msg file)
  app.post("/api/tickets/from-email", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { filename, fileData, category, priority, assignedToUserId } = req.body;

      if (!filename || !fileData) {
        return res.status(400).json({ error: "Filename and fileData are required" });
      }

      // Decode base64 file data
      const buffer = Buffer.from(fileData, 'base64');

      // Parse email
      const parsedEmail = await parseEmailFile(buffer, filename);

      // Find order by order number (if extracted)
      let orderId: string | undefined;
      if (parsedEmail.orderNumber) {
        try {
          const settings = await storage.getShopwareSettings();
          if (settings) {
            const shopware = new ShopwareClient(settings);
            const allOrders = await shopware.fetchOrders();
            
            // Find order by order number
            const matchingOrder = allOrders.find(
              order => order.orderNumber === parsedEmail.orderNumber
            );

            if (matchingOrder) {
              orderId = matchingOrder.id;
            }
          }
        } catch (error) {
          console.warn("Could not find order:", parsedEmail.orderNumber, error);
        }
      }

      // Create ticket
      const ticketData = insertTicketSchema.parse({
        title: parsedEmail.subject,
        description: parsedEmail.body,
        category: category || 'general',
        priority: priority || 'normal',
        status: 'open',
        orderId,
        orderNumber: parsedEmail.orderNumber, // Preserve order number even if order not found
        emailSubject: parsedEmail.subject,
        emailFrom: parsedEmail.from,
        assignedToUserId: assignedToUserId || undefined,
        createdByUserId: (req.user as any).id,
      });

      let ticket = await storage.createTicket(ticketData);

      // Auto-assign if no assignee specified
      if (!ticket.assignedToUserId) {
        const assigneeId = await assignTicketAutomatically(ticket);
        if (assigneeId) {
          const updated = await storage.updateTicket(ticket.id, { assignedToUserId: assigneeId });
          if (updated) {
            ticket = updated;
            // Log auto-assignment
            await storage.createTicketActivityLog({
              ticketId: ticket.id,
              userId: (req.user as any).id,
              action: 'auto_assigned',
              fieldName: 'assignedToUserId',
              newValue: assigneeId,
            });
          }
        }
      }

      // Save attachments (PDFs and photos)
      for (const attachment of parsedEmail.attachments) {
        try {
          // Store attachment as base64 in database
          const base64Content = attachment.content.toString('base64');
          
          await storage.createTicketAttachment({
            ticketId: ticket.id,
            fileName: attachment.filename,
            fileSize: attachment.size,
            mimeType: attachment.contentType,
            filePath: base64Content, // Store base64 content in filePath
            uploadedByUserId: (req.user as any).id,
          });
        } catch (error) {
          console.error("Error saving attachment:", error);
        }
      }

      // Log activity
      await storage.createTicketActivityLog({
        ticketId: ticket.id,
        userId: (req.user as any).id,
        action: 'created',
        fieldName: 'email_source',
        newValue: parsedEmail.from,
      });

      res.json({
        ticket,
        attachmentsSaved: parsedEmail.attachments.length,
        orderFound: !!orderId,
        orderNumber: parsedEmail.orderNumber,
      });
    } catch (error: any) {
      console.error("Error creating ticket from email:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid ticket data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to create ticket from email" });
    }
  });

  app.post("/api/accounting/upload", requireAuth, requireViewAccounting, accountingUpload.single("file"), async (req, res) => {
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
          const { getOpenAIClient } = await import('./openaiClient');
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
    shopFakturenUpload.single("file"),
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

  // ============================================
  // Ticket Assignment Rules Routes
  // ============================================

  // Get all assignment rules
  app.get("/api/ticket-assignment-rules", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const rules = await storage.getAllTicketAssignmentRules();
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch assignment rules" });
    }
  });

  // Get single assignment rule
  app.get("/api/ticket-assignment-rules/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { id } = req.params;
      const rule = await storage.getTicketAssignmentRule(id);
      
      if (!rule) {
        return res.status(404).json({ error: "Assignment rule not found" });
      }
      
      res.json(rule);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch assignment rule" });
    }
  });

  // Create assignment rule
  app.post("/api/ticket-assignment-rules", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const ruleData = insertTicketAssignmentRuleSchema.parse(req.body);
      const rule = await storage.createTicketAssignmentRule(ruleData);
      res.status(201).json(rule);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid rule data", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to create assignment rule" });
    }
  });

  // Update assignment rule
  app.patch("/api/ticket-assignment-rules/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updated = await storage.updateTicketAssignmentRule(id, updates);
      
      if (!updated) {
        return res.status(404).json({ error: "Assignment rule not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update assignment rule" });
    }
  });

  // Delete assignment rule
  app.delete("/api/ticket-assignment-rules/:id", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteTicketAssignmentRule(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Assignment rule not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete assignment rule" });
    }
  });

  // ============================================
  // Ticket Export Routes
  // ============================================

  // Export tickets to CSV or Excel
  app.post("/api/tickets/export", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const { format, filters } = req.body; // format: 'csv' | 'excel', filters: optional
      const user = req.user as any;
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';

      // Get all tickets
      let tickets = await storage.getAllTickets();

      // Filter by sales channel based on role
      if (!isAdmin) {
        const userChannels = user?.salesChannelIds || [];
        
        if (userChannels.length > 0) {
          // Get unique orderIds from all tickets
          const uniqueOrderIds = Array.from(new Set(tickets.filter(t => t.orderId).map(t => t.orderId!)));
          
          // Fetch only the orders that are referenced by tickets
          const settings = await storage.getShopwareSettings();
          let ordersBySalesChannel: Map<string, string> = new Map();
          
          if (settings && uniqueOrderIds.length > 0) {
            try {
              const client = new ShopwareClient(settings);
              const allOrders = await client.fetchOrders(); // Get all orders
              
              // Build map only for orders that are referenced in tickets
              uniqueOrderIds.forEach(orderId => {
                const order = allOrders.find(o => o.id === orderId);
                if (order) {
                  ordersBySalesChannel.set(order.id, order.salesChannelId);
                }
              });
            } catch (error) {
              console.error("Error fetching orders for ticket export filtering:", error);
            }
          }
          
          // Filter tickets by sales channel (standalone tickets are included)
          tickets = tickets.filter(ticket => {
            if (!ticket.orderId) return true; // Include standalone tickets
            const orderSalesChannel = ordersBySalesChannel.get(ticket.orderId);
            return orderSalesChannel && userChannels.includes(orderSalesChannel);
          });
        } else {
          // If no channels assigned, only standalone tickets
          tickets = tickets.filter(ticket => !ticket.orderId);
        }
      }

      // Apply filters if provided
      if (filters) {
        if (filters.status && filters.status !== 'all') {
          tickets = tickets.filter(t => t.status === filters.status);
        }
        if (filters.priority && filters.priority !== 'all') {
          tickets = tickets.filter(t => t.priority === filters.priority);
        }
        if (filters.category && filters.category !== 'all') {
          tickets = tickets.filter(t => t.category === filters.category);
        }
        if (filters.assigneeId && filters.assigneeId !== 'all') {
          tickets = tickets.filter(t => t.assignedToUserId === filters.assigneeId);
        }
        if (filters.tag && filters.tag !== 'all') {
          tickets = tickets.filter(t => 
            t.tags && t.tags.includes(filters.tag)
          );
        }
        // Search filter
        if (filters.search && filters.search.trim()) {
          const searchLower = filters.search.toLowerCase();
          tickets = tickets.filter(t =>
            t.title.toLowerCase().includes(searchLower) ||
            t.description.toLowerCase().includes(searchLower) ||
            t.ticketNumber.toLowerCase().includes(searchLower)
          );
        }
        // My Tickets filter
        if (filters.showMyTicketsOnly && (req.user as any)?.id) {
          const userId = (req.user as any).id;
          tickets = tickets.filter(t => t.assignedToUserId === userId);
        }
      }

      // Get all users for username lookup
      const users = await storage.getAllUsers();

      // Transform tickets to export format
      const exportData = tickets.map(ticket => {
        const assignedUser = users.find(u => u.id === ticket.assignedToUserId);
        const createdByUser = users.find(u => u.id === ticket.createdByUserId);

        return {
          'Ticket Number': ticket.ticketNumber,
          'Title': ticket.title,
          'Status': ticket.status,
          'Priority': ticket.priority,
          'Category': ticket.category,
          'Assigned To': assignedUser?.username || 'Unassigned',
          'Created By': createdByUser?.username || 'Unknown',
          'Order Number': (ticket as any).orderNumber || '',
          'Tags': ticket.tags ? ticket.tags.join(', ') : '',
          'Due Date': ticket.dueDate ? new Date(ticket.dueDate).toLocaleDateString() : '',
          'Created At': new Date(ticket.createdAt).toLocaleString(),
          'Updated At': ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : '',
        };
      });

      if (format === 'csv') {
        // Generate CSV
        const headers = Object.keys(exportData[0] || {});
        const csvRows = [
          headers.join(','),
          ...exportData.map(row =>
            headers.map(header => {
              const value = row[header as keyof typeof row] || '';
              // Escape commas and quotes
              return `"${String(value).replace(/"/g, '""')}"`;
            }).join(',')
          ),
        ];
        const csv = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=tickets-${Date.now()}.csv`);
        res.send(csv);
      } else if (format === 'excel') {
        // Generate Excel using xlsx
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Tickets');

        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=tickets-${Date.now()}.xlsx`);
        res.send(excelBuffer);
      } else {
        res.status(400).json({ error: 'Invalid format. Use "csv" or "excel".' });
      }
    } catch (error) {
      console.error("Error exporting tickets:", error);
      res.status(500).json({ error: "Failed to export tickets" });
    }
  });

  // ============================================
  // CRM Routes
  // ============================================
  app.get("/api/crm/customers", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const allowedChannelIds = await getSalesChannelFilter(req);
      const tenantId = (req as any).tenantId ?? null;

      const customerRows = await storage.getAllCustomers();
      const customerByEmail = new Map(customerRows.map((row) => [row.email.toLowerCase(), row]));

      type CrmListItem = {
        id: string | null;
        email: string;
        name: string;
        phone: string | null;
        company: string | null;
        status: string;
        tags: string[];
        totalOrders: number;
        totalRevenue: number;
        lastOrderNumber: string | null;
        lastOrderDate: string | null;
        salesChannelIds: string[];
      };

      const { data: list } = await getHashCached<CrmListItem[]>({
        cacheKey: CRM_CUSTOMERS_CACHE_KEY,
        tenantId,
        fetchFingerprint: async () => {
          const settings = await storage.getShopwareSettings();
          if (!settings) return null;
          const client = new ShopwareClient(settings);
          const ordersFp = await client.fetchOrdersFingerprint();
          const tickets = await storage.getAllTickets();
          return stableFingerprint({
            orders: ordersFp ?? "none",
            crmRows: customerRows.length,
            tickets: tickets.length,
          });
        },
        fetchFull: async () => {
          const aggregation = new Map<string, {
            email: string;
            name?: string;
            phone?: string | null;
            company?: string | null;
            totalOrders: number;
            totalRevenue: number;
            lastOrderNumber?: string | null;
            lastOrderDate?: string | null;
            salesChannelIds: Set<string>;
          }>();

          const settings = await storage.getShopwareSettings();
          if (settings) {
            const client = new ShopwareClient(settings);
            const { orders } = await getOrdersWithCache(client, tenantId);
            const filteredOrders = filterOrdersBySalesChannels(orders, allowedChannelIds);

            filteredOrders.forEach((order) => {
              const emailKey = order.customerEmail?.toLowerCase();
              if (!emailKey) return;
              const existing = aggregation.get(emailKey) || {
                email: order.customerEmail,
                name: order.customerName,
                phone: order.customerPhone ?? null,
                company: order.billingAddress?.company ?? null,
                totalOrders: 0,
                totalRevenue: 0,
                lastOrderNumber: null,
                lastOrderDate: null,
                salesChannelIds: new Set<string>(),
              };
              existing.totalOrders += 1;
              existing.totalRevenue += Number(order.totalAmount || 0);
              if (order.salesChannelId) {
                existing.salesChannelIds.add(order.salesChannelId);
              }
              const orderDate = order.orderDate;
              if (!existing.lastOrderDate || new Date(orderDate) > new Date(existing.lastOrderDate)) {
                existing.lastOrderDate = orderDate;
                existing.lastOrderNumber = order.orderNumber;
              }
              aggregation.set(emailKey, existing);
            });
          }

          const tickets = await storage.getAllTickets();
          const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, (req.user as any)?.id);
          filteredTickets.forEach((ticket) => {
            if (!ticket.customerEmail) return;
            const emailKey = ticket.customerEmail.toLowerCase();
            if (!aggregation.has(emailKey)) {
              aggregation.set(emailKey, {
                email: ticket.customerEmail,
                name: ticket.customerName || ticket.customerEmail,
                phone: null,
                company: null,
                totalOrders: 0,
                totalRevenue: 0,
                lastOrderNumber: ticket.orderNumber || null,
                lastOrderDate: null,
                salesChannelIds: new Set<string>(),
              });
            }
          });

          return Array.from(aggregation.entries()).map(([emailKey, data]) => {
            const stored = customerByEmail.get(emailKey);
            return {
              id: stored?.id ?? null,
              email: data.email,
              name: stored?.name || data.name || data.email,
              phone: stored?.phone ?? data.phone ?? null,
              company: stored?.company ?? data.company ?? null,
              status: stored?.status ?? "active",
              tags: stored?.tags ?? [],
              totalOrders: data.totalOrders,
              totalRevenue: data.totalRevenue,
              lastOrderNumber: data.lastOrderNumber ?? null,
              lastOrderDate: data.lastOrderDate ?? null,
              salesChannelIds: Array.from(data.salesChannelIds),
            };
          });
        },
      });

      const filtered = rawQuery
        ? list.filter((item) =>
            [item.name, item.email, item.company, item.lastOrderNumber]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(rawQuery))
          )
        : list;

      res.json({ customers: filtered });
    } catch (error: any) {
      console.error("Error loading CRM customers:", error);
      res.status(500).json({ error: "Failed to load customers" });
    }
  });

  app.get("/api/crm/customers/resolve", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
      const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      let customer = await storage.getCustomerByEmail(email);
      if (!customer) {
        customer = await storage.createCustomer({
          email,
          name: name || email,
          status: "active",
        } as any);
      }
      res.json({ customer });
    } catch (error: any) {
      console.error("Error resolving CRM customer:", error);
      res.status(500).json({ error: "Failed to resolve customer" });
    }
  });

  app.get("/api/crm/customers/:id/overview", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      let customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const customerId = customer.id;
      const customerEmail = customer.email.toLowerCase();

      const allowedChannelIds = await getSalesChannelFilter(req);
      const settings = await storage.getShopwareSettings();
      let orders: Order[] = [];
      if (settings) {
        const client = new ShopwareClient(settings);
        const { orders: allOrders } = await getOrdersWithCache(client, (req as any).tenantId ?? null);
        orders = filterOrdersBySalesChannels(allOrders, allowedChannelIds)
          .filter((order) => order.customerEmail?.toLowerCase() === customerEmail);
      }

      const tickets = await storage.getAllTickets();
      const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, (req.user as any)?.id);
      const customerTickets = filteredTickets.filter((ticket) => ticket.customerEmail?.toLowerCase() === customerEmail);
      const interactions = await storage.getCustomerInteractions(customerId);

      if (orders.length > 0) {
        const latestOrder = [...orders].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())[0];
        const nextUpdates: any = {};
        if (!customer.name || customer.name === customer.email) {
          nextUpdates.name = latestOrder.customerName;
        }
        if (!customer.phone && latestOrder.customerPhone) {
          nextUpdates.phone = latestOrder.customerPhone;
        }
        if (!customer.company && latestOrder.billingAddress?.company) {
          nextUpdates.company = latestOrder.billingAddress.company;
        }
        if (Object.keys(nextUpdates).length > 0) {
          customer = (await storage.updateCustomer(customer.id, nextUpdates)) || customer;
        }
      }

      res.json({
        customer,
        orders,
        tickets: customerTickets,
        interactions,
      });
    } catch (error: any) {
      console.error("Error loading CRM customer overview:", error);
      res.status(500).json({ error: "Failed to load customer overview" });
    }
  });

  // Bestandskunden-Abgleich: prüft über mehrere Felder (E-Mail, Name, Firma,
  // Telefon), ob der Shop-Kunde bereits als bestehender Shopware-Kunde mit
  // Kundennummer existiert. Rein lesend.
  app.get("/api/crm/customers/:id/match", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, self: null, matches: [] });
      }
      const client = new ShopwareClient(settings);

      // Namen best-effort in Vor-/Nachname zerlegen.
      const nameParts = (customer.name || "").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts.length > 1 ? nameParts[0] : "";
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : nameParts[0] || "";

      const candidates = await client.searchExistingCustomers({
        email: customer.email,
        firstName,
        lastName,
        name: customer.name,
        company: customer.company,
        limit: 25,
      });

      const norm = (s?: string | null) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const normCompany = (s?: string | null) =>
        norm(s)
          .replace(/\b(gmbh|ag|kg|ohg|e\.?\s?k\.?|mbh|co\.?|kgaa|ug|gbr|ltd|inc|gesellschaft|und|&)\b/g, " ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const digits = (s?: string | null) => (s || "").replace(/\D+/g, "");

      // Bestandskunden sitzen in den "Händler Portal"-Kundengruppen, Shopkunden in
      // "META B2B DE". Per Env überschreibbar (CRM_BESTANDSKUNDE_GROUP_PATTERN).
      const bestandskundePattern = (() => {
        const raw = process.env.CRM_BESTANDSKUNDE_GROUP_PATTERN;
        try {
          return raw ? new RegExp(raw, "i") : /portal|h(ä|ae)ndler/i;
        } catch {
          return /portal|h(ä|ae)ndler/i;
        }
      })();
      const isBestandskundeGroup = (name?: string | null) => !!name && bestandskundePattern.test(name);

      const custEmail = norm(customer.email);
      const custCompany = normCompany(customer.company);
      const custName = norm(customer.name);
      const custPhone = digits(customer.phone);

      const scored = candidates.map((c) => {
        const reasons: string[] = [];
        let score = 0;

        if (norm(c.email) && norm(c.email) === custEmail) {
          reasons.push("email");
          score += 50;
        }

        const candCompany = normCompany(c.company) || normCompany(c.billingAddress?.company);
        if (custCompany && candCompany && candCompany === custCompany) {
          reasons.push("company");
          score += 30;
        }

        const candName = norm([c.firstName, c.lastName].filter(Boolean).join(" "));
        if (custName && candName && (candName === custName || candName.includes(custName) || custName.includes(candName))) {
          reasons.push("name");
          score += 20;
        }

        const candPhone = digits(c.billingAddress?.phoneNumber);
        if (custPhone && candPhone && custPhone === candPhone) {
          reasons.push("phone");
          score += 20;
        }

        return {
          customerId: c.id,
          customerNumber: c.customerNumber,
          email: c.email,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
          company: c.company || c.billingAddress?.company || null,
          billingAddress: c.billingAddress || null,
          groupName: c.groupName,
          isBestandskunde: isBestandskundeGroup(c.groupName),
          reasons,
          score,
          isSelf: norm(c.email) === custEmail,
        };
      });

      // Eigener Shopware-Datensatz (gleiche E-Mail) separat zurückgeben.
      const self = scored.find((m) => m.isSelf) || null;

      // Bestandskunden-Kandidaten: alle Treffer mit Score > 0, ohne den eigenen
      // Datensatz. Echte Bestandskunden (Händler-Portal-Gruppe) zuerst.
      const matches = scored
        .filter((m) => !m.isSelf && m.score > 0)
        .sort((a, b) => Number(b.isBestandskunde) - Number(a.isBestandskunde) || b.score - a.score);

      res.json({
        configured: true,
        self: self ? { customerId: self.customerId, customerNumber: self.customerNumber } : null,
        matches,
      });
    } catch (error: any) {
      console.error("Error matching CRM customer:", error?.message || error);
      res.status(500).json({ error: "Failed to match customer" });
    }
  });

  // Manueller Kunden-Merge: hängt die Bestellungen eines doppelten Shop-Kontos
  // (duplicate) auf einen bestehenden Bestandskunden (target) um und deaktiviert
  // anschließend das Dubletten-Konto. Schreibt auf Shopware -> requireManageCrm.
  // Mit dryRun=true wird nur eine Vorschau (betroffene Bestellungen) geliefert.
  app.post("/api/crm/customers/merge", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const duplicateId = String(req.body?.duplicateShopwareCustomerId || "").trim();
      const targetId = String(req.body?.targetShopwareCustomerId || "").trim();
      const dryRun = req.body?.dryRun === true;

      if (!duplicateId || !targetId) {
        return res.status(400).json({ error: "duplicateShopwareCustomerId and targetShopwareCustomerId are required" });
      }
      if (duplicateId === targetId) {
        return res.status(400).json({ error: "Quelle und Ziel dürfen nicht identisch sein" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware not configured" });
      }
      const client = new ShopwareClient(settings);

      const [duplicate, target] = await Promise.all([
        client.getCustomerById(duplicateId),
        client.getCustomerById(targetId),
      ]);
      if (!duplicate) return res.status(404).json({ error: "Duplicate customer not found" });
      if (!target) return res.status(404).json({ error: "Target customer not found" });
      if (!target.customerNumber) {
        return res.status(400).json({ error: "Zielkunde hat keine Kundennummer" });
      }

      const allowedChannelIds = await getSalesChannelFilter(req);
      const orderCustomers = await client.findOrderCustomersByCustomerId(duplicateId);

      // Verkaufskanal-Bindung: nur Bestellungen innerhalb erlaubter Kanäle umhängen.
      const inScope = orderCustomers.filter(
        (oc) => allowedChannelIds === null || (oc.salesChannelId != null && allowedChannelIds.includes(oc.salesChannelId)),
      );
      const outOfScope = orderCustomers.length - inScope.length;

      if (dryRun) {
        return res.json({
          dryRun: true,
          duplicate: { id: duplicate.id, email: duplicate.email, customerNumber: duplicate.customerNumber },
          target: { id: target.id, email: target.email, customerNumber: target.customerNumber },
          ordersTotal: orderCustomers.length,
          ordersInScope: inScope.length,
          ordersOutOfScope: outOfScope,
        });
      }

      if (outOfScope > 0) {
        return res.status(403).json({
          error: "Einige Bestellungen liegen außerhalb deiner Verkaufskanäle – Merge abgebrochen.",
          ordersOutOfScope: outOfScope,
        });
      }

      const reassignedOrders: string[] = [];
      const failures: Array<{ orderNumber: string | null; error: string }> = [];
      for (const oc of inScope) {
        try {
          await client.reassignOrderCustomer(oc.orderCustomerId, {
            customerId: target.id,
            customerNumber: target.customerNumber,
            email: target.email,
            firstName: target.firstName,
            lastName: target.lastName,
          });
          reassignedOrders.push(oc.orderNumber || oc.orderCustomerId);
        } catch (e: any) {
          failures.push({ orderNumber: oc.orderNumber, error: e?.message || String(e) });
        }
      }

      // Dublette nur deaktivieren, wenn alle Bestellungen erfolgreich umgehängt wurden.
      let deactivated = false;
      let deactivateError: string | null = null;
      if (failures.length === 0) {
        try {
          deactivated = await client.deactivateCustomer(duplicateId);
        } catch (e: any) {
          deactivateError = e?.message || String(e);
        }
      }

      // Lokales Protokoll an den lokalen CRM-Kunden (über die E-Mail der Dublette).
      try {
        if (duplicate.email) {
          let localCustomer = await storage.getCustomerByEmail(duplicate.email);
          if (!localCustomer) {
            localCustomer = await storage.createCustomer({
              email: duplicate.email,
              name: duplicate.email,
              status: "inactive",
            } as any);
          }
          await storage.createCustomerInteraction({
            customerId: localCustomer.id,
            userId: (req.user as any)?.id ?? null,
            interactionType: "other",
            subject: "Kunde zusammengeführt",
            body: JSON.stringify({
              action: "merge",
              duplicate: { id: duplicate.id, email: duplicate.email, customerNumber: duplicate.customerNumber },
              target: { id: target.id, email: target.email, customerNumber: target.customerNumber },
              reassignedOrders,
              failures,
              deactivated,
            }),
          } as any);
        }
      } catch (logErr) {
        console.warn("[merge] logging failed:", logErr);
      }

      res.json({
        success: failures.length === 0 && !deactivateError,
        reassignedCount: reassignedOrders.length,
        reassignedOrders,
        failures,
        deactivated,
        deactivateError,
        target: { customerNumber: target.customerNumber, email: target.email },
      });
    } catch (error: any) {
      console.error("Error merging CRM customers:", error?.message || error);
      res.status(500).json({ error: "Failed to merge customers" });
    }
  });

  // Kundenindividuelle Preise (B2Bsellers Suite). Löst den Shopware-Kunden über
  // die E-Mail auf und liest dessen individuelle Preise aus dem Plugin.
  app.get("/api/crm/customers/:id/individual-prices", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ available: false, total: 0, prices: [], resolved: false, configured: false });
      }

      const client = new ShopwareClient(settings);
      let resolved: any = null;
      try {
        resolved = await client.findCustomerByEmail(customer.email);
      } catch (resolveError: any) {
        console.warn("[individual-prices] customer resolve failed:", resolveError?.message || resolveError);
      }
      const swCustomerId: string | undefined = resolved?.id;
      const swCustomerNumber: string | null =
        (resolved?.attributes?.customerNumber ?? resolved?.customerNumber)
          ? String(resolved.attributes?.customerNumber ?? resolved.customerNumber)
          : null;

      if (!swCustomerId && !swCustomerNumber) {
        // Kein Shopware-Kunde zur E-Mail gefunden -> keine individuellen Preise ermittelbar.
        return res.json({ available: false, total: 0, prices: [], resolved: false, configured: true });
      }

      const result = await client.fetchCustomerSpecificPrices({
        customerId: swCustomerId,
        customerNumber: swCustomerNumber,
        limit: 200,
      });

      res.json({
        available: result.available,
        total: result.total,
        prices: result.prices,
        resolved: true,
        configured: true,
        customerId: swCustomerId ?? null,
        customerNumber: swCustomerNumber,
        pluginDetected: result.entity != null,
      });
    } catch (error: any) {
      console.error("Error loading customer individual prices:", error?.message || error);
      res.status(500).json({ error: "Failed to load individual prices" });
    }
  });

  // Index aller Kunden mit kundenindividuellen Preisen (B2Bsellers Suite).
  // Liefert Anzahl + E-Mails, damit die CRM-Kundenliste nach "hat individuelle Preise" filtern kann.
  app.get("/api/crm/customers/individual-prices-index", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, pluginDetected: false, customerCount: 0, emails: [] });
      }

      const tenantId = (req as any).tenantId ?? null;
      const client = new ShopwareClient(settings);

      const { data: index } = await getHashCached({
        cacheKey: "crm_individual_prices_index_v1",
        tenantId,
        fetchFingerprint: () => client.fetchIndividualPriceCustomerFingerprint(),
        fetchFull: () => client.fetchIndividualPriceCustomerIndex(),
      });

      res.json({
        configured: true,
        pluginDetected: index.entity != null,
        customerCount: index.customerCount,
        emails: index.emails,
      });
    } catch (error: any) {
      console.error("Error loading individual prices index:", error?.message || error);
      res.status(500).json({ error: "Failed to load individual prices index" });
    }
  });

  // Index der Bestandskunden-Firmen (Händler-Portal-Gruppen) für den CRM-Filter
  // "möglicher Bestandskunde". Liefert normalisierte Firmennamen -> Kundennummer;
  // der Abgleich gegen die CRM-Liste erfolgt clientseitig per Firmen-Match.
  app.get("/api/crm/customers/possible-existing-index", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, customerCount: 0, companies: {} });
      }

      const tenantId = (req as any).tenantId ?? null;
      const client = new ShopwareClient(settings);

      const normCompany = (s?: string | null) =>
        (s || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\b(gmbh|ag|kg|ohg|e\.?\s?k\.?|mbh|co\.?|kgaa|ug|gbr|ltd|inc|gesellschaft|und|&)\b/g, " ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();

      const { data: cached, fromCache } = await getHashCached({
        cacheKey: "crm_bestandskunden_index_v1",
        tenantId,
        fetchFingerprint: () => client.fetchBestandskundenFingerprint(BESTANDSKUNDEN_GROUP_TERMS),
        fetchFull: async () => {
          const rows = await client.fetchBestandskundenIndex(BESTANDSKUNDEN_GROUP_TERMS);
          const companies: Record<string, string | null> = {};
          for (const row of rows) {
            const key = normCompany(row.company);
            if (key.length >= 3 && !(key in companies)) {
              companies[key] = row.customerNumber;
            }
          }
          return { customerCount: rows.length, companies };
        },
      });

      if (fromCache) {
        console.log(`[hash-cache] bestandskunden index served from cache (${cached.customerCount} customers)`);
      }

      res.json({
        configured: true,
        customerCount: cached.customerCount,
        companies: cached.companies,
      });
    } catch (error: any) {
      console.error("Error loading possible-existing index:", error?.message || error);
      res.status(500).json({ error: "Failed to load possible-existing index" });
    }
  });

  app.post("/api/crm/customers/:id/interactions", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const data = insertCustomerInteractionSchema.parse({
        ...req.body,
        customerId: id,
        userId: (req.user as any)?.id,
      });
      const created = await storage.createCustomerInteraction(data);
      res.status(201).json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid interaction data", details: error.errors });
      }
      console.error("Error creating CRM interaction:", error);
      res.status(500).json({ error: "Failed to create interaction" });
    }
  });

  app.get("/api/crm/assignees", requireAuth, requireManageCrm, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const simplified = users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        skills: user.skills || [],
      }));
      res.json(simplified);
    } catch (error: any) {
      console.error("Error loading CRM assignees:", error);
      res.status(500).json({ error: "Failed to load assignees" });
    }
  });

  app.get("/api/crm/assignments", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
      let assignments = orderId
        ? await storage.getOrderAssignmentsByOrderId(orderId)
        : await storage.getOrderAssignments();
      if (status) {
        assignments = assignments.filter((assignment) => assignment.status === status);
      }
      const users = await storage.getAllUsers();
      const userById = new Map(users.map((user) => [user.id, user.username]));
      const enriched = assignments.map((assignment) => ({
        ...assignment,
        requestedByUserName: assignment.requestedByUserId ? userById.get(assignment.requestedByUserId) || null : null,
        assignedToUserName: assignment.assignedToUserId ? userById.get(assignment.assignedToUserId) || null : null,
        approvedByUserName: assignment.approvedByUserId ? userById.get(assignment.approvedByUserId) || null : null,
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error loading CRM assignments:", error);
      res.status(500).json({ error: "Failed to load assignments" });
    }
  });

  app.post("/api/crm/assignments", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const data = insertOrderAssignmentSchema.parse(req.body);
      const existing = await storage.getOrderAssignmentsByOrderId(data.orderId);
      if (existing.some((assignment) => assignment.status === "requested")) {
        return res.status(409).json({ error: "Assignment request already pending" });
      }
      const created = await storage.createOrderAssignment({
        ...data,
        requestedByUserId: (req.user as any)?.id,
        status: "requested",
      });
      res.status(201).json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid assignment data", details: error.errors });
      }
      console.error("Error creating CRM assignment:", error);
      res.status(500).json({ error: "Failed to create assignment" });
    }
  });

  app.post("/api/crm/assignments/:id/approve", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getOrderAssignment(id);
      if (!existing) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      const updated = await storage.updateOrderAssignment(id, {
        status: "approved",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Error approving CRM assignment:", error);
      res.status(500).json({ error: "Failed to approve assignment" });
    }
  });

  app.post("/api/crm/assignments/:id/reject", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getOrderAssignment(id);
      if (!existing) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      const updated = await storage.updateOrderAssignment(id, {
        status: "rejected",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Error rejecting CRM assignment:", error);
      res.status(500).json({ error: "Failed to reject assignment" });
    }
  });

  app.get("/api/crm/discount-requests", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId : "";
      let requests = ticketId
        ? await storage.getDiscountRequestsByTicketId(ticketId)
        : await storage.getDiscountRequests();
      if (status) {
        requests = requests.filter((request) => request.status === status);
      }
      const users = await storage.getAllUsers();
      const userById = new Map(users.map((user) => [user.id, user.username]));
      const enriched = requests.map((request) => ({
        ...request,
        requestedByUserName: request.requestedByUserId ? userById.get(request.requestedByUserId) || null : null,
        approvedByUserName: request.approvedByUserId ? userById.get(request.approvedByUserId) || null : null,
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error loading CRM discount requests:", error);
      res.status(500).json({ error: "Failed to load discount requests" });
    }
  });

  app.post("/api/crm/discount-requests", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const data = insertDiscountRequestSchema.parse(req.body);
      const created = await storage.createDiscountRequest({
        ...data,
        requestedByUserId: (req.user as any)?.id,
        status: "requested",
      });
      if (created.ticketId) {
        await storage.createTicketActivityLog({
          ticketId: created.ticketId,
          userId: (req.user as any)?.id,
          action: "discount_requested",
          fieldName: "discount",
          oldValue: null,
          newValue: JSON.stringify({
            type: created.discountType,
            value: created.discountValue,
            currency: created.currency,
          }),
        });
      }
      res.status(201).json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid discount request data", details: error.errors });
      }
      console.error("Error creating CRM discount request:", error);
      res.status(500).json({ error: "Failed to create discount request" });
    }
  });

  app.post("/api/crm/discount-requests/:id/approve", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getDiscountRequest(id);
      if (!existing) {
        return res.status(404).json({ error: "Discount request not found" });
      }
      const updated = await storage.updateDiscountRequest(id, {
        status: "approved",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Error approving CRM discount request:", error);
      res.status(500).json({ error: "Failed to approve discount request" });
    }
  });

  app.post("/api/crm/discount-requests/:id/reject", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getDiscountRequest(id);
      if (!existing) {
        return res.status(404).json({ error: "Discount request not found" });
      }
      const updated = await storage.updateDiscountRequest(id, {
        status: "rejected",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Error rejecting CRM discount request:", error);
      res.status(500).json({ error: "Failed to reject discount request" });
    }
  });

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
      const jwt = await import("./jwt");
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

  // ============================================
  // COMMERCIAL DRAFTS — einheitlicher KI-Upload (Intent → Angebot oder Bestellung)
  // ============================================

  function commercialManualDraftFileFilter(
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) {
    const allowedMimeTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
      "application/vnd.ms-outlook",
      "message/rfc822",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (
      allowedMimeTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(pdf|png|jpg|jpeg|gif|webp|msg|eml|txt|docx|doc)$/i)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Ungültiger Dateityp. Erlaubt: PDF, Bilder, Word (.docx/.doc), .msg, .eml, .txt"
        )
      );
    }
  }

  const commercialUnifiedDraftStorage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), "commercial-drafts");
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, path.join(getUploadsRoot(), "commercial-drafts"));
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
      const sanitizedFilename = sanitizeFilename(file.originalname);
      cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
    },
  });

  const commercialUnifiedDraftUpload = multer({
    storage: commercialUnifiedDraftStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: commercialManualDraftFileFilter,
  });

  app.post(
    "/api/commercial-drafts/upload",
    requireAuthOrIntegrationKey,
    requireManageCommercialDraftUpload,
    uploadRateLimiter,
    commercialUnifiedDraftUpload.single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "Keine Datei hochgeladen" });
        }

        const userId = (req.user as any).id;
        const file = req.file;
        const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
        const bodyNote = typeof req.body?.body === "string" ? req.body.body : "";
        const uploadIntentHint = parseUploadIntentHint(req.body?.intentHint);

        const aiSettings = await getAISettings(storage);
        if (aiSettings.mode === "openai_only") {
          try {
            const openaiSettings = await storage.getSetting("openai_settings");
            const { getOpenAIClient } = await import("./openaiClient");
            getOpenAIClient(openaiSettings?.apiKey);
          } catch {
            await fs.unlink(file.path);
            return res.status(400).json({
              error:
                "OpenAI nicht konfiguriert. Bitte API-Schlüssel in den Einstellungen hinterlegen.",
            });
          }
        }

        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          await fs.unlink(file.path);
          return res.status(400).json({
            error: "Shopware nicht konfiguriert.",
          });
        }

        const user = req.user as any;
        const roleDetails = user?.roleDetails;
        const permissions = roleDetails?.permissions;
        let canOrder = false;
        let canOffer = false;
        if (permissions) {
          if (Array.isArray(permissions)) {
            canOrder = permissions.includes("manageOrderDrafts");
            canOffer = permissions.includes("manageOffers");
          } else {
            canOrder = Boolean(permissions.manageOrderDrafts);
            canOffer = Boolean(permissions.manageOffers);
          }
        }

        const fileBuffer = await fs.readFile(file.path);
        const docPreview = await extractDocumentTextPreviewForIntent(
          fileBuffer,
          file.mimetype,
          file.originalname,
          { ocrEnabled: aiSettings.ocrEnabled }
        );

        const intent = await classifyCommercialDocumentIntent(storage, {
          subject,
          emailBody: bodyNote,
          documentTextPreview: docPreview || undefined,
          tenantId: req.tenantId ?? null,
          traceId: `manual-upload-${Date.now()}`,
          uploadHint: uploadIntentHint ?? null,
        });

        let useOrderPipeline = intent.intent === "purchase_order" && intent.confidence >= 0.5;
        let intentRoutedAsOfferDueToPermission = false;

        if (useOrderPipeline && !canOrder) {
          if (canOffer) {
            useOrderPipeline = false;
            intentRoutedAsOfferDueToPermission = true;
          } else {
            await fs.unlink(file.path);
            return res.status(403).json({
              error: "Keine Berechtigung für Bestellentwürfe; Intent war „Bestellung“.",
            });
          }
        }

        if (!useOrderPipeline && !canOffer) {
          await fs.unlink(file.path);
          return res.status(403).json({
            error: "Keine Berechtigung für Angebotsentwürfe.",
          });
        }

        const emailContext =
          subject.trim() || bodyNote.trim()
            ? [
                subject.trim() && `Betreff (Formular): ${subject.trim()}`,
                bodyNote.trim() && `Zusatztext (Formular):\n${bodyNote.trim()}`,
              ]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 12000)
            : undefined;

        const commercialIntentMetadata = {
          intent: intent.intent,
          confidence: intent.confidence,
          rationale: intent.rationale,
          intentRoutedAsOfferDueToPermission,
          uploadExpectedPipeline: useOrderPipeline ? ("order" as const) : ("offer" as const),
          uploadHint: uploadIntentHint,
        };

        const agentComm = await getCommercialAgentSettings(storage);

        const pipelineOpts = {
          storage,
          tenantId: req.tenantId ?? null,
          filePath: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          createdByUserId: userId,
          emailContext,
          commercialIntentMetadata,
        };

        if (useOrderPipeline) {
          const { draft, timings } = await runOrderDraftPipeline(pipelineOpts);
          emitCommercialDraftWebhooks({
            draft,
            draftKind: "order",
            intent: intent.intent,
            intentConfidence: intent.confidence,
            messageId: null,
            source: "manual_upload",
          });
          let strictAutoCreate: Awaited<ReturnType<typeof runStrictCommercialAutoCreateIfAllowed>> | null =
            null;
          if (agentComm.enabled && agentComm.strictAutoCreateOnly !== false) {
            const extracted = (draft.extractedData ?? {}) as Record<string, unknown>;
            strictAutoCreate = await runStrictCommercialAutoCreateIfAllowed({
              storage,
              tenantId: req.tenantId ?? null,
              draftId: draft.id,
              draftKind: "order",
              agentSettings: agentComm,
              extractedData: extracted,
              matchingResults: (draft.matchingResults ?? null) as MatchingResult | null,
              shopwareCustomerId: draft.shopwareCustomerId ?? null,
              intent: { intent: intent.intent, confidence: intent.confidence },
              messageId: null,
            });
          }
          return res.json({
            draft,
            draftKind: "order" as const,
            timings,
            commercialIntent: intent.intent,
            commercialIntentConfidence: intent.confidence,
            commercialIntentRationale: intent.rationale ?? null,
            intentRoutedAsOfferDueToPermission,
            uploadIntentHint: uploadIntentHint ?? null,
            strictAutoCreate,
          });
        }

        const { draft, timings } = await runOfferDraftPipeline(pipelineOpts);
        emitCommercialDraftWebhooks({
          draft,
          draftKind: "offer",
          intent: intent.intent,
          intentConfidence: intent.confidence,
          messageId: null,
          source: "manual_upload",
        });
        let strictAutoCreateOffer: Awaited<ReturnType<typeof runStrictCommercialAutoCreateIfAllowed>> | null =
          null;
        if (agentComm.enabled && agentComm.strictAutoCreateOnly !== false) {
          const extractedOffer = (draft.extractedData ?? {}) as Record<string, unknown>;
          strictAutoCreateOffer = await runStrictCommercialAutoCreateIfAllowed({
            storage,
            tenantId: req.tenantId ?? null,
            draftId: draft.id,
            draftKind: "offer",
            agentSettings: agentComm,
            extractedData: extractedOffer,
            matchingResults: (draft.matchingResults ?? null) as MatchingResult | null,
            shopwareCustomerId: draft.shopwareCustomerId ?? null,
            intent: { intent: intent.intent, confidence: intent.confidence },
            messageId: null,
          });
        }
        return res.json({
          draft,
          draftKind: "offer" as const,
          timings,
          commercialIntent: intent.intent,
          commercialIntentConfidence: intent.confidence,
          commercialIntentRationale: intent.rationale ?? null,
          intentRoutedAsOfferDueToPermission,
          uploadIntentHint: uploadIntentHint ?? null,
          strictAutoCreate: strictAutoCreateOffer,
        });
      } catch (error: any) {
        console.error("[Commercial draft upload]", error);
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch {
            /* ignore */
          }
        }
        res.status(500).json({
          error: error.message || "Commercial-Draft-Upload fehlgeschlagen",
        });
      }
    }
  );

  // ============================================
  // ORDER DRAFTS ROUTES (AI-powered order creation)
  // ============================================

  // Configure multer for order draft uploads
  const orderDraftStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), 'order-drafts');
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, uploadPath);
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const sanitizedFilename = sanitizeFilename(file.originalname);
      cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
    },
  });

  const orderDraftUpload = multer({
    storage: orderDraftStorage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: commercialManualDraftFileFilter,
  });

  // POST /api/order-drafts/upload - Upload file and extract order data
  app.post(
    "/api/order-drafts/upload",
    requireAuth,
    requireManageOrderDrafts,
    uploadRateLimiter,
    orderDraftUpload.single('file'),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = (req.user as any).id;
        const file = req.file;

        const aiSettings = await getAISettings(storage);
        if (aiSettings.mode === "openai_only") {
          try {
            const openaiSettings = await storage.getSetting("openai_settings");
            const { getOpenAIClient } = await import("./openaiClient");
            getOpenAIClient(openaiSettings?.apiKey);
          } catch {
            await fs.unlink(file.path);
            return res.status(400).json({
              error:
                "OpenAI integration not available. Please configure OpenAI API key in settings or ensure Replit OpenAI Integration is set up.",
            });
          }
        }

        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          await fs.unlink(file.path);
          return res.status(400).json({
            error: "Shopware settings not configured. Please configure Shopware connection first.",
          });
        }

        const orderFileBuffer = await fs.readFile(file.path);
        const orderDocPreview = await extractDocumentTextPreviewForIntent(
          orderFileBuffer,
          file.mimetype,
          file.originalname,
          { ocrEnabled: aiSettings.ocrEnabled }
        );
        const orderIntent = await classifyCommercialDocumentIntent(storage, {
          subject: file.originalname,
          emailBody: "",
          documentTextPreview: orderDocPreview || undefined,
          tenantId: req.tenantId ?? null,
          traceId: `order-draft-upload-${Date.now()}`,
        });

        console.log(`[Order Draft] Pipeline for ${file.originalname} (${aiSettings.mode})...`);
        const { draft: orderDraft, timings } = await runOrderDraftPipeline({
          storage,
          tenantId: req.tenantId ?? null,
          filePath: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          createdByUserId: userId,
          commercialIntentMetadata: {
            intent: orderIntent.intent,
            confidence: orderIntent.confidence,
            rationale: orderIntent.rationale,
            uploadExpectedPipeline: "order",
          },
        });

        console.log(`[Order Draft] Created draft ${orderDraft.id} with status: ${orderDraft.status}`);
        console.log("[Order Draft] Timings (ms):", timings);
        res.json(orderDraft);
      } catch (error: any) {
        console.error("Error uploading order draft:", error);
        
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            console.error("Error deleting file:", unlinkError);
          }
        }
        
        res.status(500).json({ 
          error: error.message || "Failed to process order draft upload" 
        });
      }
    }
  );

  // GET /api/order-drafts - Get all order drafts
  app.get("/api/order-drafts", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const orderDrafts = await storage.getAllOrderDrafts();
      res.json(orderDrafts);
    } catch (error) {
      console.error("Error fetching order drafts:", error);
      res.status(500).json({ error: "Failed to fetch order drafts" });
    }
  });

  // GET /api/order-drafts/:id - Get single order draft with cross-selling suggestions
  app.get("/api/order-drafts/:id", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const orderDraft = await storage.getOrderDraft(id);
      
      if (!orderDraft) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      // Generate cross-selling suggestions for matched products
      let crossSellingSuggestions: any[] = [];
      
      if (orderDraft.matchingResults?.items) {
        try {
          // Get Shopware client and cross-selling rules
          const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
          if (shopwareSettings) {
            const shopwareClient = new ShopwareClient(shopwareSettings);
            
            // Get all active cross-selling rules (manual + AI)
            const crossSellingRules = await getCombinedCrossSellingRules(req.tenantId ?? null);
            const ruleEngine = new RuleEngine();
            const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
            const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
            
            // For each matched product, find cross-selling suggestions
            for (const item of orderDraft.matchingResults.items) {
              if (item.matchedProduct && item.status === "matched") {
                try {
                  const productNumber = item.matchedProduct.productNumber;
                  if (!productNumber) {
                    continue;
                  }
                  const { products } = await shopwareClient.fetchProducts(
                    25,
                    1,
                    productNumber,
                    undefined,
                    false,
                    undefined,
                    undefined,
                    undefined,
                    true
                  );
                  const fullProduct = products.find((p) => p.productNumber === productNumber) || products[0];
                  if (fullProduct) {
                    // Get cross-selling suggestions using rule engine
                    const suggestions = await ruleEngine.suggestCrossSelling(
                      fullProduct,
                      crossSellingRules,
                      shopwareClient,
                      suggestOpts,
                    );
                    const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
                    
                    // Add suggestions for this product (limit to top 10)
                    crossSellingSuggestions.push({
                      forProduct: {
                        id: item.matchedProduct.id,
                        name: item.matchedProduct.name,
                        productNumber: item.matchedProduct.productNumber,
                      },
                      suggestions: limitedSuggestions.map(s => ({
                        id: s.id,
                        productNumber: s.productNumber,
                        name: s.name,
                        price: s.price,
                        netPrice: s.netPrice,
                        imageUrl: s.imageUrl,
                        stock: s.stock,
                        available: s.available,
                        crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
                        hybridScore: (s as { hybridScore?: number }).hybridScore,
                      })),
                    });
                  }
                } catch (productError) {
                  console.warn(`[Cross-Selling] Failed to fetch suggestions for product ${item.matchedProduct.id}:`, productError);
                }
              }
            }
          }
        } catch (crossSellingError) {
          console.warn("[Cross-Selling] Failed to generate suggestions:", crossSellingError);
        }
      }
      
      // Return draft with cross-selling suggestions
      res.json({
        ...orderDraft,
        crossSellingSuggestions,
      });
    } catch (error) {
      console.error("Error fetching order draft:", error);
      res.status(500).json({ error: "Failed to fetch order draft" });
    }
  });

  // GET /api/order-drafts/:id/clarification-email — Vorschau Rückfrage-Mail (kein Versand)
  app.get(
    "/api/order-drafts/:id/clarification-email",
    requireAuth,
    requireManageOrderDrafts,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const draft = await storage.getOrderDraft(id);
        if (!draft) return res.status(404).json({ error: "Order draft not found" });
        const payload = buildCommercialClarificationEmail({
          kind: "order",
          originalFileName: draft.originalFileName,
          extractedData: draft.extractedData as Record<string, unknown> | null,
          matchingResults: draft.matchingResults as any,
        });
        res.json(payload);
      } catch (error: any) {
        console.error("Error building order draft clarification email:", error);
        res.status(500).json({ error: error.message ?? "Failed to build clarification email" });
      }
    }
  );

  // PATCH /api/order-drafts/:id - Update order draft
  app.patch("/api/order-drafts/:id", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Validate that draft exists
      const existingDraft = await storage.getOrderDraft(id);
      if (!existingDraft) {
        return res.status(404).json({ error: "Order draft not found" });
      }

      // Validate update data
      const updateSchema = z.object({
        status: z.enum(["pending", "review_required", "approved", "rejected", "created"]).optional(),
        extractedData: z.any().optional(),
        matchingResults: z.any().optional(),
      });

      const validated = updateSchema.parse(req.body);
      const updatedDraftPayload = {
        extractedData: validated.extractedData ?? existingDraft.extractedData,
        matchingResults: validated.matchingResults ?? existingDraft.matchingResults,
      };
      
      // Update order draft
      const updatedDraft = await storage.updateOrderDraft(id, validated);
      
      if (!updatedDraft) {
        return res.status(404).json({ error: "Order draft not found" });
      }

      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          existingDraft,
          updatedDraft: updatedDraftPayload,
          tenantId: req.tenantId ?? null,
          draftKind: "order",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        console.warn("[Commercial product learning] order patch feedback failed:", learningError);
      }
      
      res.json(updatedDraft);
    } catch (error: any) {
      console.error("Error updating order draft:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update order draft" });
    }
  });

  app.post(
    "/api/order-drafts/:id/create-shopware-customer",
    requireAuth,
    requireManageOrderDrafts,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const bodySchema = z.object({ extractedData: z.any().optional() });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültiger Request", details: parsed.error.errors });
        }
        const draft = await storage.getOrderDraft(id);
        if (!draft) {
          return res.status(404).json({ error: "Order draft not found" });
        }
        const mergedRaw = mergeDraftExtractedData(
          draft.extractedData as Record<string, unknown> | null | undefined,
          parsed.data.extractedData as Record<string, unknown> | null | undefined,
        );
        const resolvedEmail = resolveEmailForShopwareCustomerCreate(mergedRaw);
        if ("error" in resolvedEmail) {
          return res.status(400).json({ error: resolvedEmail.error });
        }
        const { email, merged } = resolvedEmail;
        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          return res.status(400).json({ error: "Shopware nicht konfiguriert" });
        }
        const shopwareClient = new ShopwareClient(shopwareSettings);
        const created = await tryCreateShopwareCustomerFromExtractedData(shopwareClient, merged as {
          customer?: DraftExtractedCustomer;
          billingAddress?: DraftBillingAddressInput;
          shippingAddress?: DraftBillingAddressInput;
        }, email);
        if ("error" in created) {
          return res.status(400).json({ error: created.error });
        }
        const agentComm = await getCommercialAgentSettings(storage);
        const minCust = agentComm.customerMatchAutoMinConfidence ?? 72;
        const prevCust =
          typeof merged.customer === "object" && merged.customer ? { ...merged.customer } : {};
        const cust = { ...prevCust, customerMatchConfidence: Math.min(100, minCust + 8) };
        const updatedDraft = await storage.updateOrderDraft(id, {
          shopwareCustomerId: created.id,
          extractedData: { ...merged, customer: cust },
        });
        if (!updatedDraft) {
          return res.status(404).json({ error: "Order draft not found" });
        }
        res.json(updatedDraft);
      } catch (error: any) {
        console.error("Error creating Shopware customer from order draft:", error);
        res.status(500).json({ error: error.message || "Anlage fehlgeschlagen" });
      }
    }
  );

  // POST /api/order-drafts/:id/add-product - Add a cross-selling product to draft
  app.post("/api/order-drafts/:id/add-product", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { productId, quantity = 1 } = req.body;
      
      if (!productId) {
        return res.status(400).json({ error: "Product ID is required" });
      }
      
      // Get order draft
      const draft = await storage.getOrderDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      // Get Shopware product details
      const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!shopwareSettings) {
        return res.status(400).json({ error: "Shopware integration not configured" });
      }
      const shopwareClient = new ShopwareClient(shopwareSettings);
      const productMeta = await shopwareClient.fetchProductDataQuality(productId);
      const searchTerm = productMeta?.productNumber || productId;
      const { products } = await shopwareClient.fetchProducts(25, 1, searchTerm);
      const product = products.find((p) => p.id === productId) || products[0];
      if (!product) {
        return res.status(404).json({ error: "Product not found in Shopware" });
      }
      
      // Add product to matching results
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: product.name,
        extractedProductNumber: product.productNumber,
        quantity: quantity,
        matchedProduct: {
          id: product.id,
          productNumber: product.productNumber,
          name: product.name,
          price: product.price,
        },
        confidence: 100, // Manually added = 100% confidence
        status: "matched",
      });
      
      // Calculate new overall confidence
      const totalConfidence = updatedItems.reduce((sum, item) => sum + (item.confidence || 0), 0);
      const overallConfidence = updatedItems.length > 0 ? Math.round(totalConfidence / updatedItems.length) : 0;
      
      // Update draft
      const updatedDraft = await storage.updateOrderDraft(id, {
        matchingResults: {
          items: updatedItems,
          overallConfidence,
        },
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      console.error("Error adding product to draft:", error);
      res.status(500).json({ error: "Failed to add product to draft" });
    }
  });

  // POST /api/order-drafts/:id/add-bundle - Add a bundle to draft
  app.post("/api/order-drafts/:id/add-bundle", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { bundleId, quantity = 1 } = req.body;
      
      if (!bundleId) {
        return res.status(400).json({ error: "Bundle ID is required" });
      }
      
      // Get order draft
      const draft = await storage.getOrderDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      
      if (bundle.active !== 1) {
        return res.status(400).json({ error: "Bundle is inactive" });
      }
      
      const { productCache } = await import("./productCache");
      const invalidProducts: string[] = [];
      const components = bundle.items.map((item) => {
        const product = productCache.getProductByNumber(item.productNumber);
        if (!product) {
          invalidProducts.push(item.productNumber);
        }
        return {
          productNumber: item.productNumber,
          productId: item.productId || product?.id,
          productName: product?.name,
          quantity: item.quantity,
        };
      });
      
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Some bundle products could not be resolved",
          invalidProducts,
        });
      }
      
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: bundle.name,
        extractedProductNumber: bundle.mockProductNumber,
        quantity,
        bundle: {
          id: bundle.id,
          name: bundle.name,
          mockProductNumber: bundle.mockProductNumber,
          components,
        },
        confidence: 100,
        status: "matched",
      });
      
      const totalConfidence = updatedItems.reduce((sum, item) => sum + (item.confidence || 0), 0);
      const overallConfidence = updatedItems.length > 0 ? Math.round(totalConfidence / updatedItems.length) : 0;
      
      const updatedDraft = await storage.updateOrderDraft(id, {
        matchingResults: {
          items: updatedItems,
          overallConfidence,
        },
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      console.error("Error adding bundle to order draft:", error);
      res.status(500).json({ error: "Failed to add bundle to draft" });
    }
  });

  // POST /api/order-drafts/:id/create-order - Create Shopware order from draft
  app.post("/api/order-drafts/:id/create-order", requireAuthOrIntegrationKey, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await executeCreateOrderFromDraft(storage, id, { tenantId: req.tenantId ?? null });
      if (!result.ok) {
        return res.status(result.statusCode).json({ error: result.error });
      }
      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          updatedDraft: {
            extractedData: result.draft.extractedData as any,
            matchingResults: result.draft.matchingResults as any,
          },
          tenantId: req.tenantId ?? null,
          draftKind: "order",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        console.warn("[Commercial product learning] order create feedback failed:", learningError);
      }
      res.json({
        message: "Order created successfully",
        draft: result.draft,
        order: { id: result.orderId },
      });
    } catch (error: any) {
      console.error("Error creating order from draft:", error);
      res.status(500).json({
        error: error.message || "Failed to create order from draft",
      });
    }
  });

  // DELETE /api/order-drafts/:id - Delete order draft
  app.delete("/api/order-drafts/:id", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get draft to delete file
      const draft = await storage.getOrderDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Order draft not found" });
      }

      // Delete uploaded file if it exists
      if (draft.originalFilePath) {
        try {
          await fs.unlink(draft.originalFilePath);
        } catch (error) {
          console.error("Error deleting file:", error);
          // Continue with draft deletion even if file deletion fails
        }
      }

      // Delete draft from database
      const deleted = await storage.deleteOrderDraft(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      res.json({ message: "Order draft deleted successfully" });
    } catch (error) {
      console.error("Error deleting order draft:", error);
      res.status(500).json({ error: "Failed to delete order draft" });
    }
  });

  // ============================================
  // OFFER DRAFTS ROUTES (AI-powered quote/offer creation)
  // ============================================

  // Configure multer for offer draft uploads
  const offerDraftStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), 'offer-drafts');
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, uploadPath);
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const sanitizedFilename = sanitizeFilename(file.originalname);
      cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
    },
  });

  const offerDraftUpload = multer({
    storage: offerDraftStorage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: commercialManualDraftFileFilter,
  });

  // POST /api/offer-drafts/upload - Upload file and extract offer data
  app.post(
    "/api/offer-drafts/upload",
    requireAuth,
    requireManageOffers,
    uploadRateLimiter,
    offerDraftUpload.single('file'),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = (req.user as any).id;
        const file = req.file;

        const aiSettings = await getAISettings(storage);
        if (aiSettings.mode === "openai_only") {
          try {
            const openaiSettings = await storage.getSetting("openai_settings");
            const { getOpenAIClient } = await import("./openaiClient");
            getOpenAIClient(openaiSettings?.apiKey);
          } catch {
            await fs.unlink(file.path);
            return res.status(400).json({
              error:
                "OpenAI integration not available. Please configure OpenAI API key in settings or ensure Replit OpenAI Integration is set up.",
            });
          }
        }

        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          await fs.unlink(file.path);
          return res.status(400).json({
            error: "Shopware settings not configured. Please configure Shopware connection first.",
          });
        }

        const offerFileBuffer = await fs.readFile(file.path);
        const offerDocPreview = await extractDocumentTextPreviewForIntent(
          offerFileBuffer,
          file.mimetype,
          file.originalname,
          { ocrEnabled: aiSettings.ocrEnabled }
        );
        const offerIntent = await classifyCommercialDocumentIntent(storage, {
          subject: file.originalname,
          emailBody: "",
          documentTextPreview: offerDocPreview || undefined,
          tenantId: req.tenantId ?? null,
          traceId: `offer-draft-upload-${Date.now()}`,
        });

        console.log(`[Offer Draft] Pipeline for ${file.originalname} (${aiSettings.mode})...`);
        const { draft: offerDraft, timings } = await runOfferDraftPipeline({
          storage,
          tenantId: req.tenantId ?? null,
          filePath: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          createdByUserId: userId,
          commercialIntentMetadata: {
            intent: offerIntent.intent,
            confidence: offerIntent.confidence,
            rationale: offerIntent.rationale,
            uploadExpectedPipeline: "offer",
          },
        });

        console.log(`[Offer Draft] Created draft ${offerDraft.id} with status: ${offerDraft.status}`);
        console.log("[Offer Draft] Timings (ms):", timings);
        res.json(offerDraft);
      } catch (error: any) {
        console.error("Error uploading offer draft:", error);
        
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            console.error("Error deleting file:", unlinkError);
          }
        }
        
        res.status(500).json({ 
          error: error.message || "Failed to process offer draft upload" 
        });
      }
    }
  );

  // POST /api/offer-drafts/from-cpq - Create offer draft from CPQ Konfigurator
  app.post("/api/offer-drafts/from-cpq", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { systemId, systemName, config, billOfMaterials, cpqConfigurationId } = req.body;
      const user = req.user as { id?: string; username?: string };
      const userId = user?.id ?? user?.username ?? "unknown";

      if (!billOfMaterials || !billOfMaterials.items || billOfMaterials.items.length === 0) {
        return res.status(400).json({ error: "Stückliste ist leer. Bitte zuerst die Konfiguration im CPQ-Konfigurator vervollständigen." });
      }

      type BomItemIn = {
        productId: string;
        productNumber: string;
        name: string;
        quantity: number;
        unitPrice: number;
        lineTotal?: number;
        componentType?: string;
      };

      const bomItems: BomItemIn[] = billOfMaterials.items;

      const matchingResults = {
        items: bomItems.map((item) => ({
          extractedProductName: item.name,
          extractedProductNumber: item.productNumber,
          quantity: item.quantity,
          matchedProduct: {
            id: item.productId,
            productNumber: item.productNumber,
            name: item.name,
            catalogPrice: item.unitPrice,
            suggestedPrice: item.unitPrice,
            suggestedDiscount: 0,
          },
          confidence: 100,
          status: "matched",
          productScreen: { likelihood: "likely_product" as const, reasons: ["CPQ-Stückliste"] },
        })),
        overallConfidence: 100,
        pricingRecommendations: {
          totalCatalogValue: billOfMaterials.totalPrice,
          totalSuggestedValue: billOfMaterials.totalPrice,
          totalDiscountPercentage: 0,
          reasoning: "CPQ-Konfigurator",
        },
      };

      const offerDraft = await storage.createOfferDraft(
        {
          status: "approved",
          originalFileName: `CPQ-${systemName ?? systemId ?? "Konfiguration"}-${new Date().toISOString().slice(0, 10)}.json`,
          originalFilePath: null,
        extractedData: {
          offerNotes: `CPQ-Konfigurator: ${systemName ?? systemId ?? "Regalsystem"}`,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          cpqSource: {
            systemId: systemId ?? null,
            systemName: systemName ?? null,
            config: config && typeof config === "object" ? config : null,
            cpqConfigurationId: typeof cpqConfigurationId === "string" ? cpqConfigurationId : null,
            billOfMaterials: {
              items: bomItems.map((item) => ({
                productId: item.productId,
                productNumber: item.productNumber,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
                componentType: item.componentType,
              })),
              totalPrice: billOfMaterials.totalPrice,
            },
          },
        },
        matchingResults,
        shopwareCustomerId: null,
        shopwareOfferId: null,
        createdByUserId: userId,
        },
        req.tenantId ?? null
      );

      res.json(offerDraft);
    } catch (error: any) {
      console.error("Error creating offer draft from CPQ:", error);
      res.status(500).json({ error: error.message ?? "Fehler beim Erstellen des Angebotsentwurfs" });
    }
  });

  // GET /api/offer-drafts - Get all offer drafts
  app.get("/api/offer-drafts", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const offerDrafts = await storage.getAllOfferDrafts();
      res.json(offerDrafts);
    } catch (error) {
      console.error("Error fetching offer drafts:", error);
      res.status(500).json({ error: "Failed to fetch offer drafts" });
    }
  });

  // GET /api/offer-drafts/customer-search?q=... - Search Shopware customers for draft assignment
  app.get("/api/offer-drafts/customer-search", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string)?.trim() ?? "";
      const limit = Math.min(50, Math.max(5, parseInt(String(req.query.limit || 20), 10) || 20));
      if (q.length < 2) {
        return res.json({ customers: [] });
      }
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware-Einstellungen nicht konfiguriert" });
      }
      const client = new ShopwareClient(settings);
      const customers = await client.searchCustomers(q, limit);
      res.json({ customers });
    } catch (error: any) {
      console.error("Error searching customers for offer draft:", error);
      res.status(500).json({ error: error.message ?? "Kundensuche fehlgeschlagen" });
    }
  });

  // GET /api/offer-drafts/:id - Get single offer draft with cross-selling suggestions
  app.get("/api/offer-drafts/:id", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const offerDraft = await storage.getOfferDraft(id);
      
      if (!offerDraft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      // Generate cross-selling suggestions for matched products
      let crossSellingSuggestions: any[] = [];
      
      if (offerDraft.matchingResults?.items) {
        try {
          // Get Shopware client and cross-selling rules
          const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
          if (shopwareSettings) {
            const shopwareClient = new ShopwareClient(shopwareSettings);
            
            // Get all active cross-selling rules
            const crossSellingRules = await getCombinedCrossSellingRules(req.tenantId ?? null);
            const ruleEngine = new RuleEngine();
            const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
            const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
            
            // For each matched product, find cross-selling suggestions
            for (const item of offerDraft.matchingResults.items) {
              if (item.matchedProduct && item.status === "matched") {
                try {
                  const productNumber = item.matchedProduct.productNumber;
                  if (!productNumber) {
                    continue;
                  }
                  const { products } = await shopwareClient.fetchProducts(
                    25,
                    1,
                    productNumber,
                    undefined,
                    false,
                    undefined,
                    undefined,
                    undefined,
                    true
                  );
                  const fullProduct = products.find((p) => p.productNumber === productNumber) || products[0];
                  if (fullProduct) {
                    // Get cross-selling suggestions using rule engine
                    const suggestions = await ruleEngine.suggestCrossSelling(
                      fullProduct,
                      crossSellingRules,
                      shopwareClient,
                      suggestOpts,
                    );
                    const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
                    
                    // Add suggestions for this product (limit to top 10)
                    crossSellingSuggestions.push({
                      forProduct: {
                        id: item.matchedProduct.id,
                        name: item.matchedProduct.name,
                        productNumber: item.matchedProduct.productNumber,
                      },
                      suggestions: limitedSuggestions.map(s => ({
                        id: s.id,
                        productNumber: s.productNumber,
                        name: s.name,
                        price: s.price,
                        netPrice: s.netPrice,
                        imageUrl: s.imageUrl,
                        stock: s.stock,
                        available: s.available,
                        crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
                        hybridScore: (s as { hybridScore?: number }).hybridScore,
                      })),
                    });
                  }
                } catch (productError) {
                  console.warn(`[Cross-Selling] Failed to fetch suggestions for product ${item.matchedProduct.id}:`, productError);
                }
              }
            }
          }
        } catch (crossSellingError) {
          console.warn("[Cross-Selling] Failed to generate suggestions:", crossSellingError);
        }
      }
      
      // Return draft with cross-selling suggestions
      res.json({
        ...offerDraft,
        crossSellingSuggestions,
      });
    } catch (error) {
      console.error("Error fetching offer draft:", error);
      res.status(500).json({ error: "Failed to fetch offer draft" });
    }
  });

  // GET /api/offer-drafts/:id/clarification-email — Vorschau Rückfrage-Mail (kein Versand)
  app.get("/api/offer-drafts/:id/clarification-email", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const draft = await storage.getOfferDraft(id);
      if (!draft) return res.status(404).json({ error: "Offer draft not found" });
      const payload = buildCommercialClarificationEmail({
        kind: "offer",
        originalFileName: draft.originalFileName,
        extractedData: draft.extractedData as Record<string, unknown> | null,
        matchingResults: draft.matchingResults as any,
      });
      res.json(payload);
    } catch (error: any) {
      console.error("Error building offer draft clarification email:", error);
      res.status(500).json({ error: error.message ?? "Failed to build clarification email" });
    }
  });

  // PATCH /api/offer-drafts/:id - Update offer draft
  app.patch("/api/offer-drafts/:id", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Validate that draft exists
      const existingDraft = await storage.getOfferDraft(id);
      if (!existingDraft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      // Validate update data
      const updateSchema = z.object({
        status: z.enum(["pending", "review_required", "approved", "rejected", "created"]).optional(),
        extractedData: z.any().optional(),
        matchingResults: z.any().optional(),
        shopwareCustomerId: z.string().nullable().optional(),
      });

      const validated = updateSchema.parse(req.body);
      const updatedDraftPayload = {
        extractedData: validated.extractedData ?? existingDraft.extractedData,
        matchingResults: validated.matchingResults ?? existingDraft.matchingResults,
      };
      
      // Update offer draft
      const updatedDraft = await storage.updateOfferDraft(id, validated);
      
      if (!updatedDraft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          existingDraft,
          updatedDraft: updatedDraftPayload,
          tenantId: req.tenantId ?? null,
          draftKind: "offer",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        console.warn("[Commercial product learning] offer patch feedback failed:", learningError);
      }
      
      res.json(updatedDraft);
    } catch (error: any) {
      console.error("Error updating offer draft:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update offer draft" });
    }
  });

  app.post(
    "/api/offer-drafts/:id/create-shopware-customer",
    requireAuth,
    requireManageOffers,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const bodySchema = z.object({ extractedData: z.any().optional() });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültiger Request", details: parsed.error.errors });
        }
        const draft = await storage.getOfferDraft(id);
        if (!draft) {
          return res.status(404).json({ error: "Offer draft not found" });
        }
        const mergedRaw = mergeDraftExtractedData(
          draft.extractedData as Record<string, unknown> | null | undefined,
          parsed.data.extractedData as Record<string, unknown> | null | undefined,
        );
        const resolvedEmail = resolveEmailForShopwareCustomerCreate(mergedRaw);
        if ("error" in resolvedEmail) {
          return res.status(400).json({ error: resolvedEmail.error });
        }
        const { email, merged } = resolvedEmail;
        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          return res.status(400).json({ error: "Shopware nicht konfiguriert" });
        }
        const shopwareClient = new ShopwareClient(shopwareSettings);
        const created = await tryCreateShopwareCustomerFromExtractedData(shopwareClient, merged as {
          customer?: DraftExtractedCustomer;
          billingAddress?: DraftBillingAddressInput;
          shippingAddress?: DraftBillingAddressInput;
        }, email);
        if ("error" in created) {
          return res.status(400).json({ error: created.error });
        }
        const agentComm = await getCommercialAgentSettings(storage);
        const minCust = agentComm.customerMatchAutoMinConfidence ?? 72;
        const prevCust =
          typeof merged.customer === "object" && merged.customer ? { ...merged.customer } : {};
        const cust = { ...prevCust, customerMatchConfidence: Math.min(100, minCust + 8) };
        const updatedDraft = await storage.updateOfferDraft(id, {
          shopwareCustomerId: created.id,
          extractedData: { ...merged, customer: cust },
        });
        if (!updatedDraft) {
          return res.status(404).json({ error: "Offer draft not found" });
        }
        res.json(updatedDraft);
      } catch (error: any) {
        console.error("Error creating Shopware customer from offer draft:", error);
        res.status(500).json({ error: error.message || "Anlage fehlgeschlagen" });
      }
    }
  );

  // GET /api/offer-drafts/:id/pdf - Generate PDF from offer draft (Phase 6)
  app.get("/api/offer-drafts/:id/pdf", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { download } = req.query;

      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      if (!draft.matchingResults?.items?.length && !draft.extractedData) {
        return res.status(400).json({ error: "Draft has no data to generate PDF" });
      }

      const { generateOfferDraftPdf } = await import("./offerDraftPdf");
      const pdfBuffer = await generateOfferDraftPdf({
        ...draft,
        extractedData: draft.extractedData ?? undefined,
        matchingResults: draft.matchingResults ?? undefined,
      });

      res.setHeader("Content-Type", "application/pdf");
      if (download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="Angebotsentwurf-${draft.originalFileName || id}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="Angebotsentwurf-${id}.pdf"`);
      }
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating offer draft PDF:", error);
      res.status(500).json({ error: error.message || "Failed to generate PDF" });
    }
  });

  // POST /api/offer-drafts/:id/add-product - Add a cross-selling product to draft
  app.post("/api/offer-drafts/:id/add-product", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { productId, quantity = 1 } = req.body;
      
      if (!productId) {
        return res.status(400).json({ error: "Product ID is required" });
      }
      
      // Get offer draft
      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      // Get Shopware product details
      const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!shopwareSettings) {
        return res.status(400).json({ error: "Shopware integration not configured" });
      }
      const shopwareClient = new ShopwareClient(shopwareSettings);
      const productMeta = await shopwareClient.fetchProductDataQuality(productId);
      const searchTerm = productMeta?.productNumber || productId;
      const { products } = await shopwareClient.fetchProducts(25, 1, searchTerm);
      const product = products.find((p) => p.id === productId) || products[0];
      if (!product) {
        return res.status(404).json({ error: "Product not found in Shopware" });
      }
      
      // Add product to matching results
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: product.name,
        extractedProductNumber: product.productNumber,
        quantity: quantity,
        matchedProduct: {
          id: product.id,
          productNumber: product.productNumber,
          name: product.name,
          catalogPrice: product.price,
        },
        confidence: 100, // Manually added = 100% confidence
        status: "matched",
        productScreen: {
          likelihood: "likely_product" as const,
          reasons: ["Manuell zum Entwurf hinzugefügt"],
        },
      });
      
      const { recomputeOfferOverallConfidence } = await import("./lineItemProductScreening");
      const overallConfidence = recomputeOfferOverallConfidence(updatedItems);
      
      // Update draft
      const updatedDraft = await storage.updateOfferDraft(id, {
        matchingResults: {
          ...draft.matchingResults,
          items: updatedItems,
          overallConfidence,
        },
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      console.error("Error adding product to offer draft:", error);
      res.status(500).json({ error: "Failed to add product to draft" });
    }
  });

  // POST /api/offer-drafts/:id/add-bundle - Add a bundle to draft
  app.post("/api/offer-drafts/:id/add-bundle", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { bundleId, quantity = 1 } = req.body;
      
      if (!bundleId) {
        return res.status(400).json({ error: "Bundle ID is required" });
      }
      
      // Get offer draft
      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      
      if (bundle.active !== 1) {
        return res.status(400).json({ error: "Bundle is inactive" });
      }
      
      const { productCache } = await import("./productCache");
      const invalidProducts: string[] = [];
      const components = bundle.items.map((item) => {
        const product = productCache.getProductByNumber(item.productNumber);
        if (!product) {
          invalidProducts.push(item.productNumber);
        }
        return {
          productNumber: item.productNumber,
          productId: item.productId || product?.id,
          productName: product?.name,
          quantity: item.quantity,
        };
      });
      
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Some bundle products could not be resolved",
          invalidProducts,
        });
      }
      
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: bundle.name,
        extractedProductNumber: bundle.mockProductNumber,
        quantity,
        bundle: {
          id: bundle.id,
          name: bundle.name,
          mockProductNumber: bundle.mockProductNumber,
          components,
        },
        confidence: 100,
        status: "matched",
        productScreen: {
          likelihood: "likely_product" as const,
          reasons: ["Bundle manuell hinzugefügt"],
        },
      });
      
      const { recomputeOfferOverallConfidence } = await import("./lineItemProductScreening");
      const overallConfidence = recomputeOfferOverallConfidence(updatedItems);
      
      const updatedDraft = await storage.updateOfferDraft(id, {
        matchingResults: {
          ...draft.matchingResults,
          items: updatedItems,
          overallConfidence,
        },
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      console.error("Error adding bundle to offer draft:", error);
      res.status(500).json({ error: "Failed to add bundle to draft" });
    }
  });

  // DELETE /api/offer-drafts/:id - Delete offer draft and file
  app.delete("/api/offer-drafts/:id", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get draft to delete file
      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      // Delete uploaded file if it exists
      if (draft.originalFilePath) {
        try {
          await fs.unlink(draft.originalFilePath);
        } catch (error) {
          console.error("Error deleting file:", error);
          // Continue with draft deletion even if file deletion fails
        }
      }

      // Delete draft from database
      const deleted = await storage.deleteOfferDraft(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      res.json({ message: "Offer draft deleted successfully" });
    } catch (error) {
      console.error("Error deleting offer draft:", error);
      res.status(500).json({ error: "Failed to delete offer draft" });
    }
  });

  // POST /api/offer-drafts/:id/create-offer - Create Shopware offer from draft
  app.post("/api/offer-drafts/:id/create-offer", requireAuthOrIntegrationKey, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const allowedChannelIds = await getSalesChannelFilter(req);
      const channelResult = await resolveOfferSalesChannelId(storage, {
        tenantId: req.tenantId ?? null,
        requestedChannelId: req.body?.sales_channel_id,
        allowedChannelIds,
      });
      if (!channelResult.ok) {
        return res.status(channelResult.statusCode).json({ error: channelResult.error });
      }
      const result = await executeCreateOfferFromDraft(storage, id, {
        salesChannelId: channelResult.salesChannelId,
        tenantId: req.tenantId ?? null,
      });
      if (!result.ok) {
        return res.status(result.statusCode).json({ error: result.error });
      }
      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          updatedDraft: {
            extractedData: result.draft.extractedData as any,
            matchingResults: result.draft.matchingResults as any,
          },
          tenantId: req.tenantId ?? null,
          draftKind: "offer",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        console.warn("[Commercial product learning] offer create feedback failed:", learningError);
      }
      res.json({
        message: "Angebot in B2B-Sellers-Suite erstellt.",
        id: result.offerId,
        draft: result.draft,
      });
    } catch (error: any) {
      console.error("Error creating offer from draft:", error);
      res.status(500).json({
        error: error.message || "Failed to create offer from draft",
      });
    }
  });

  // GET /api/offers - Get all offers from B2B Sellers Suite
  app.get("/api/offers", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const {
        search,
        status,
        customer,
        dateFrom,
        dateTo,
        page,
        limit,
      } = req.query as Record<string, string | undefined>;

      const allowedChannelIds = await getSalesChannelFilter(req);
      const { offers, total } = await client.fetchOffers({
        search,
        status,
        customer,
        dateFrom,
        dateTo,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        salesChannelIds: allowedChannelIds,
      });
      res.json({ offers, total });
    } catch (error: any) {
      console.error("Error fetching offers:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offers" });
    }
  });

  // GET /api/b2b/offer-status-mapping - Return status label/id mapping
  app.get("/api/b2b/offer-status-mapping", requireAuth, requireViewOffers, async (_req: Request, res: Response) => {
    const stored = (await storage.getSetting("b2b.offerStatusMapping")) as OfferStatusMapping | undefined;
    res.json(getOfferStatusMapping(stored));
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

  // GET /api/offers/:id/config-pdf - METAorder PDF with MetaCalc image, description, BOM, overview (Versand, Montage, MwSt.)
  app.get("/api/offers/:id/config-pdf", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { download } = req.query;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

      const input = await buildOfferConfigPdfInputWithCpqFallback(
        storage,
        id,
        (req as any).tenantId,
        rawOffer.data,
        mapped,
        settings
      );
      if (!input) {
        return res.status(404).json({ error: "Kein MetaCalc-Konfigurationsangebot (kein Konfigurations-Payload)." });
      }

      await enrichOfferConfigPdfInputWithTexts(
        storage,
        input,
        mapped.items || [],
        (req as any).tenantId ?? null,
      );

      const pdfInput = applyOfferConfigPdfLayoutFromRequest(input, req.query as Record<string, unknown>);
      const pdfBuffer = await generateOfferConfigPdf(pdfInput);
      const safeName = `angebot-konfiguration-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

      res.setHeader("Content-Type", "application/pdf");
      if (download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      }
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating offer config PDF:", error);
      res.status(500).json({ error: error.message || "Failed to generate configuration PDF" });
    }
  });

  // GET /api/offers/:id/pdf - Download or preview offer PDF (optional, if configured)
  app.get("/api/offers/:id/pdf", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { download } = req.query;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

      // METAorder-Angebots-PDF: MetaCalc-Konfiguration falls vorhanden, sonst Standard-Angebot.
      const configInput = await buildOfferConfigPdfInputWithCpqFallback(
        storage,
        id,
        (req as any).tenantId,
        rawOffer.data,
        mapped,
        settings
      );
      const input =
        configInput ?? (await buildPlainOfferPdfInput(rawOffer.data, mapped, settings));

      await enrichOfferConfigPdfInputWithTexts(
        storage,
        input,
        mapped.items || [],
        (req as any).tenantId ?? null,
      );

      const pdfInput = applyOfferConfigPdfLayoutFromRequest(input, req.query as Record<string, unknown>);
      const pdfBuffer = await generateOfferConfigPdf(pdfInput);
      const safeName = `angebot-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

      res.setHeader("Content-Type", "application/pdf");
      if (download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      }
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating offer PDF:", error);
      res.status(500).json({ error: error.message || "PDF not available" });
    }
  });

  // GET /api/offers/:id/export.csv — ERP-Import (CSV, UTF-8 mit BOM, Semikolon)
  app.get("/api/offers/:id/export.csv", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);
      const model = await buildOfferErpExportModel(settings, mapped);
      const csv = offerErpExportToCsv(model);
      const safeName = `angebot-erp-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
      res.send(Buffer.from(csv, "utf8"));
    } catch (error: any) {
      console.error("Error generating offer ERP CSV:", error);
      res.status(500).json({ error: error.message || "Failed to export offer CSV" });
    }
  });

  // GET /api/offers/:id/export.xml — ERP-Import (XML)
  app.get("/api/offers/:id/export.xml", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);
      const model = await buildOfferErpExportModel(settings, mapped);
      const xml = offerErpExportToXml(model);
      const safeName = `angebot-erp-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xml"`);
      res.send(Buffer.from(xml, "utf8"));
    } catch (error: any) {
      console.error("Error generating offer ERP XML:", error);
      res.status(500).json({ error: error.message || "Failed to export offer XML" });
    }
  });

  // GET /api/offers/:id - Get single offer with full details
  app.get("/api/offers/:id", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const detail = await buildOfferDetailJson(storage, id, (req as any).tenantId);
      res.json(detail);
    } catch (error: any) {
      console.error("Error fetching offer details:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer details" });
    }
  });

  // GET /api/offers/:id/share-link — aktiver öffentlicher Link (ohne Klartext-Token)
  app.get("/api/offers/:id/share-link", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const active = await storage.getActiveOfferPublicLinkForOffer(id, (req as any).tenantId);
      if (!active) {
        return res.json({ active: false });
      }
      res.json({
        active: true,
        linkId: active.id,
        expiresAt: active.expiresAt instanceof Date ? active.expiresAt.toISOString() : active.expiresAt,
        createdAt: active.createdAt instanceof Date ? active.createdAt.toISOString() : active.createdAt,
        lastAccessAt: active.lastAccessAt
          ? active.lastAccessAt instanceof Date
            ? active.lastAccessAt.toISOString()
            : active.lastAccessAt
          : null,
      });
    } catch (error: any) {
      console.error("Error fetching offer share link:", error);
      res.status(500).json({ error: error.message || "Failed to fetch share link" });
    }
  });

  // POST /api/offers/:id/share-link — neuen Link erzeugen (ersetzt frühere aktive Links)
  app.post(
    "/api/offers/:id/share-link",
    requireAuth,
    requireManageOffers,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const tenantId = (req as any).tenantId;
        const userId = (req as any).user?.id as string | undefined;
        const bodySchema = z.object({
          expiresInDays: z.number().int().min(1).max(365).optional(),
        });
        const parsed = bodySchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültige Parameter" });
        }
        const days = parsed.data.expiresInDays ?? 30;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
        const client = new B2BSellersClient(settings, { statusMapping });
        await client.fetchOfferById(id);

        const plain = generateOfferPlainToken();
        const tokenHash = hashOfferPublicToken(plain);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        await storage.createOfferPublicLink(
          {
            tenantId: tenantId ?? null,
            shopwareOfferId: id,
            tokenHash,
            expiresAt,
            revokedAt: null,
            createdByUserId: userId ?? null,
            lastAccessAt: null,
          },
          tenantId
        );

        const base =
          process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
          `${req.protocol}://${req.get("host") || ""}`.replace(/\/$/, "");
        const publicUrl = `${base}/angebot/${encodeURIComponent(plain)}`;

        res.json({
          token: plain,
          publicUrl,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error: any) {
        console.error("Error creating offer share link:", error);
        res.status(500).json({ error: error.message || "Failed to create share link" });
      }
    }
  );

  // DELETE /api/offers/:id/share-link — alle öffentlichen Links zu diesem Angebot widerrufen
  app.delete(
    "/api/offers/:id/share-link",
    requireAuth,
    requireManageOffers,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        await storage.revokeOfferPublicLinksForOffer(id, (req as any).tenantId);
        res.json({ success: true });
      } catch (error: any) {
        console.error("Error revoking offer share link:", error);
        res.status(500).json({ error: error.message || "Failed to revoke share link" });
      }
    }
  );

  // PATCH /api/offers/:id - Update offer details
  app.patch("/api/offers/:id", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateSchema = z.object({
        status: z.string().optional(),
        customerName: z.string().optional(),
        customerEmail: z.string().email().optional(),
        offerNumber: z.string().optional(),
        expirationDate: z.string().nullable().optional(),
        totalPrice: z.number().optional(),
        netPrice: z.number().optional(),
      });

      const validated = updateSchema.parse(req.body);
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.updateOffer(id, validated);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating offer:", error);
      res.status(500).json({ error: error.message || "Failed to update offer" });
    }
  });

  // POST /api/offers/:id/approve
  app.post("/api/offers/:id/approve", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.approveOffer(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error approving offer:", error);
      res.status(500).json({ error: error.message || "Failed to approve offer" });
    }
  });

  // POST /api/offers/:id/reject
  app.post("/api/offers/:id/reject", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.rejectOffer(id, reason);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error rejecting offer:", error);
      res.status(500).json({ error: error.message || "Failed to reject offer" });
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
      // - Status is "in_progress" (not open, completed, or cancelled)
      // - Payment status is "paid" or "authorized"
      // - No tracking number yet (not yet shipped)
      const shippingReadyOrders = accessibleOrders.filter((order: Order) => {
        const isPaid = order.paymentStatus === 'paid' || order.paymentStatus === 'authorized';
        const isInProgress = order.status === 'in_progress';
        const notShippedYet = !order.shippingInfo?.trackingNumber;
        
        return isPaid && isInProgress && notShippedYet;
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
        maxAttempts: config.maxAttempts,
        initialBackoffMs: config.initialBackoffMs,
        backoffFactor: Number(config.backoffFactor),
        timeoutMs: config.timeoutMs,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }));
      
      res.json(transformedConfigs);
    } catch (error) {
      console.error("Error fetching webhook configs:", error);
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
      });
    } catch (error) {
      console.error("Error fetching webhook config:", error);
      res.status(500).json({ error: "Failed to fetch webhook configuration" });
    }
  });

  // Update a webhook configuration
  app.patch("/api/settings/webhooks/:eventType", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const eventType = req.params.eventType as WebhookEventType;
      const { url, enabled, secret } = req.body;

      // Validate if config exists
      const existingConfig = await storage.getWebhookConfig(eventType);
      if (!existingConfig) {
        return res.status(404).json({ error: "Webhook configuration not found" });
      }

      // Transform frontend API format to DB schema format
      const updates: Partial<{targetUrl: string | null, enabled: number, secret: string}> = {};
      if (url !== undefined) updates.targetUrl = url;
      if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
      if (secret !== undefined) updates.secret = secret;

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

      res.json(updatedConfig);
    } catch (error) {
      console.error("Error updating webhook config:", error);
      res.status(500).json({ error: "Failed to update webhook configuration" });
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
  registerB2BAdminRoutes(app, { getSalesChannelFilter });

  const httpServer = createServer(app);

  return httpServer;
}
