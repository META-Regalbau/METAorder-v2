import { createHash, randomBytes } from "crypto";
import { eq, sql as drizzleSql, desc, asc, and, isNull, lte, gt, gte, sql, inArray, count } from "drizzle-orm";
import { db } from "./db";
import { getTenantIdFromContext } from "./tenantContext";
import {
  users,
  tenants,
  tenantUsers,
  tenantIntegrationApiKeys,
  roles,
  settings,
  crossSellingRules,
  crossSellCooccurrences,
  crossSellEvents,
  aiCrossSellRules,
  aiRecommendations,
  aiInsights,
  crossSellStagingBatches,
  crossSellStagingRules,
  crossSellStagingSuggestions,
  offerLearningInsights,
  tickets,
  ticketComments,
  ticketEmailMessages,
  m365Connections,
  ticketAttachments,
  ticketCommentViews,
  ticketAttachmentViews,
  ticketActivityLog,
  ticketAssignmentRules,
  customers,
  customerInteractions,
  orderAssignments,
  discountRequests,
  notifications,
  ticketTemplates,
  processUpdates,
  automationRules,
  automationExecutions,
  orderDrafts,
  offerDrafts,
  bundles,
  bundleItems,
  erpAutomationRuns,
  shippingCarriers,
  webhookConfigs,
  webhookLogs,
  semanticDocuments,
  orderDunningStatus,
  installmentPlans,
  installmentInvoices,
  commercialAgentExemplars,
  commercialProductMatchFeedback,
  offerPublicLinks,
  offerPublicEvents,
  b2bApprovalLog,
  type User,
  type InsertUser,
  type Role,
  type Tenant,
  type InsertTenant,
  type TenantUser,
  type InsertTenantUser,
  type ShopwareSettings,
  type InsertShopwareSettings,
  type MonduSettings,
  type InsertMonduSettings,
  type ProformaNumberRangeSettings,
  type InsertProformaNumberRangeSettings,
  type DunningSettings,
  type InsertDunningSettings,
  type OrderDunningStatus,
  type InsertOrderDunningStatus,
  type CrossSellingRule,
  type InsertCrossSellingRule,
  type Ticket,
  type InsertTicket,
  type TicketComment,
  type InsertTicketComment,
  type TicketEmailMessage,
  type InsertTicketEmailMessage,
  type TicketAttachment,
  type InsertTicketAttachment,
  type TicketActivityLog,
  type InsertTicketActivityLog,
  type TicketAssignmentRule,
  type InsertTicketAssignmentRule,
  type Notification,
  type InsertNotification,
  type TicketTemplate,
  type InsertTicketTemplate,
  type ProcessUpdate,
  type InsertProcessUpdate,
  type AutomationRule,
  type InsertAutomationRule,
  type AutomationExecution,
  type InsertAutomationExecution,
  type OrderDraft,
  type InsertOrderDraft,
  type OfferDraft,
  type InsertOfferDraft,
  type Bundle,
  type InsertBundle,
  type BundleItem,
  type BundleItemInput,
  type BundleWithItems,
  type ErpAutomationRun,
  type InsertErpAutomationRun,
  type ShippingCarrier,
  type InsertShippingCarrier,
  type WebhookConfig,
  type InsertWebhookConfig,
  type WebhookLog,
  type InsertWebhookLog,
  type WebhookEventType,
  type CrossSellCooccurrence,
  type InsertCrossSellCooccurrence,
  type AiCrossSellRule,
  type InsertAiCrossSellRule,
  type AiRecommendation,
  type InsertAiRecommendation,
  type AiInsight,
  type InsertAiInsight,
  type InsertCrossSellEvent,
  type CrossSellEventPairStats,
  type CrossSellStagingBatch,
  type InsertCrossSellStagingBatch,
  type CrossSellStagingRule,
  type InsertCrossSellStagingRule,
  type CrossSellStagingSuggestion,
  type InsertCrossSellStagingSuggestion,
  type OfferLearningInsight,
  type InsertOfferLearningInsight,
  type M365Connection,
  type InsertM365Connection,
  type SemanticDocument,
  type InsertSemanticDocument,
  type Customer,
  type InsertCustomer,
  type CustomerInteraction,
  type InsertCustomerInteraction,
  type OrderAssignment,
  type InsertOrderAssignment,
  type DiscountRequest,
  type InsertDiscountRequest,
  type InstallmentPlan,
  type InsertInstallmentPlan,
  type InstallmentInvoice,
  type InsertInstallmentInvoice,
  type CommercialAgentExemplar,
  type InsertCommercialAgentExemplar,
  type CommercialProductMatchFeedback,
  type InsertCommercialProductMatchFeedback,
  type OfferPublicLink,
  type InsertOfferPublicLink,
  type OfferPublicEvent,
  type InsertOfferPublicEvent,
  type B2bApprovalLog,
  type InsertB2bApprovalLog,
} from "@shared/schema";
import type { IStorage, InsertRole, UpdateUser } from "./storage";
import { encrypt, decrypt } from "./encryption";

const toIsoString = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

/** Timestamps aus PG/Neon können Date oder ISO-String sein; .toISOString() nur auf Date. */
function timestampToApiIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

type CrossSellingRuleRow = typeof crossSellingRules.$inferSelect;

function crossSellingJsonField<T>(
  raw: unknown,
  ruleId: string,
  fieldName: "sourceConditions" | "targetCriteria",
  fallback: T,
): T {
  if (raw == null) {
    return fallback;
  }
  if (typeof raw !== "string") {
    return raw as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e: unknown) {
    console.error(
      `[DbStorage] cross_selling_rules ${fieldName} JSON parse failed for rule ${ruleId}:`,
      e instanceof Error ? e.message : e,
    );
    return fallback;
  }
}

function mapCrossSellingRuleRow(rule: CrossSellingRuleRow): CrossSellingRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description || undefined,
    active: rule.active,
    category: rule.category ?? undefined,
    sourceConditions: crossSellingJsonField(
      rule.sourceConditions,
      rule.id,
      "sourceConditions",
      [] as CrossSellingRule["sourceConditions"],
    ),
    targetCriteria: crossSellingJsonField(
      rule.targetCriteria,
      rule.id,
      "targetCriteria",
      [] as CrossSellingRule["targetCriteria"],
    ),
    createdAt: timestampToApiIso(rule.createdAt),
    updatedAt: timestampToApiIso(rule.updatedAt),
  };
}

const resolveTenantId = (tenantId?: string | null) =>
  tenantId === undefined ? getTenantIdFromContext() : tenantId;
const tenantFilterFor = <T>(column: T, tenantId?: string | null) => {
  const resolved = resolveTenantId(tenantId);
  return resolved ? eq(column as any, resolved) : isNull(column as any);
};

const mapStagingBatch = (batch: any): CrossSellStagingBatch => ({
  id: batch.id,
  tenantId: batch.tenantId ?? null,
  createdByUserId: batch.createdByUserId ?? null,
  status: batch.status,
  createdAt: batch.createdAt instanceof Date ? batch.createdAt.toISOString() : batch.createdAt,
  updatedAt: batch.updatedAt instanceof Date ? batch.updatedAt.toISOString() : batch.updatedAt,
});

const mapStagingRule = (rule: any): CrossSellStagingRule => ({
  id: rule.id,
  batchId: rule.batchId,
  tenantId: rule.tenantId ?? null,
  ruleType: rule.ruleType,
  name: rule.name,
  description: rule.description ?? null,
  active: rule.active,
  sourceConditions: typeof rule.sourceConditions === "string"
    ? JSON.parse(rule.sourceConditions)
    : rule.sourceConditions,
  targetCriteria: typeof rule.targetCriteria === "string"
    ? JSON.parse(rule.targetCriteria)
    : rule.targetCriteria,
  sourceProductNumber: rule.sourceProductNumber ?? null,
  targetProductNumber: rule.targetProductNumber ?? null,
  createdAt: rule.createdAt instanceof Date ? rule.createdAt.toISOString() : rule.createdAt,
  updatedAt: rule.updatedAt instanceof Date ? rule.updatedAt.toISOString() : rule.updatedAt,
});

const mapStagingSuggestion = (suggestion: any): CrossSellStagingSuggestion => ({
  id: suggestion.id,
  batchId: suggestion.batchId,
  tenantId: suggestion.tenantId ?? null,
  sourceProductId: suggestion.sourceProductId ?? null,
  sourceProductNumber: suggestion.sourceProductNumber,
  targetProductId: suggestion.targetProductId ?? null,
  targetProductNumber: suggestion.targetProductNumber,
  active: suggestion.active,
  createdAt: suggestion.createdAt instanceof Date ? suggestion.createdAt.toISOString() : suggestion.createdAt,
  updatedAt: suggestion.updatedAt instanceof Date ? suggestion.updatedAt.toISOString() : suggestion.updatedAt,
});

// Normalize role permissions by adding missing permission keys with false defaults
function normalizeRolePermissions(role: Role): Role {
  const defaultPermissions = {
    viewOrders: false,
    editOrders: false,
    exportData: false,
    viewAnalytics: false,
    viewDelayedOrders: false,
    viewShipping: false,
    manageUsers: false,
    manageRoles: false,
    manageSettings: false,
    manageCrossSellingGroups: false,
    manageCrossSellingRules: false,
    viewTickets: false,
    manageTickets: false,
    manageAutomations: false,
    manageOrderDrafts: false,
    viewOffers: false,
    manageOffers: false,
    viewNaturalLanguageAnalytics: false,
    viewDocuments: false,
    manageDocuments: false,
    manageProducts: false,
    viewAccounting: false,
    viewCrm: false,
    manageCrm: false,
    approveCrm: false,
    viewCPQ: false,
    manageCPQ: false,
    manageCPQDiscountLevels: false,
    approveCPQQuotes: false,
    viewB2B: false,
    manageB2B: false,
    approveB2BBudgets: false,
  };

  const mergedPermissions = {
    ...defaultPermissions,
    ...role.permissions,
  };

  if (role.name === "Administrator") {
    mergedPermissions.viewCrm = true;
    mergedPermissions.manageCrm = true;
    mergedPermissions.approveCrm = true;
    mergedPermissions.viewB2B = true;
    mergedPermissions.manageB2B = true;
    mergedPermissions.approveB2BBudgets = true;
  } else if (role.name === "Employee" || role.name === "Warehouse Manager") {
    mergedPermissions.viewCrm = true;
    mergedPermissions.manageCrm = true;
  }

  return {
    ...role,
    permissions: mergedPermissions,
  };
}

export class DbStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db
      .insert(users)
      .values({
        ...insertUser,
        role: "employee", // Default role
      })
      .returning();
    return result[0];
  }

  async updateUser(id: string, updates: UpdateUser): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  // Tenants
  async getTenant(id: string): Promise<Tenant | undefined> {
    const result = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return result[0];
  }

  async getTenantByName(name: string): Promise<Tenant | undefined> {
    const result = await db
      .select()
      .from(tenants)
      .where(eq(tenants.name, name))
      .limit(1);
    return result[0];
  }

  async getAllTenants(): Promise<Tenant[]> {
    return await db.select().from(tenants);
  }

  async getTenantsForUser(userId: string): Promise<Tenant[]> {
    const result = await db
      .select()
      .from(tenantUsers)
      .leftJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.userId, userId));
    return result
      .map((row) => row.tenants)
      .filter((tenant): tenant is Tenant => !!tenant);
  }

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const result = await db.insert(tenants).values(tenant).returning();
    return result[0];
  }

  async addUserToTenant(tenantUser: InsertTenantUser): Promise<TenantUser> {
    const result = await db.insert(tenantUsers).values(tenantUser).returning();
    return result[0];
  }

  async findTenantIdByIntegrationKeyHash(keyHash: string): Promise<string | null> {
    const row = await db
      .select({ tenantId: tenantIntegrationApiKeys.tenantId })
      .from(tenantIntegrationApiKeys)
      .where(eq(tenantIntegrationApiKeys.keyHash, keyHash))
      .limit(1);
    return row[0]?.tenantId ?? null;
  }

  async createTenantIntegrationApiKey(
    tenantId: string,
    name: string
  ): Promise<{ id: string; apiKey: string }> {
    const apiKey = `mo_${randomBytes(32).toString("base64url")}`;
    const keyHash = createHash("sha256").update(apiKey, "utf8").digest("hex");
    const [created] = await db
      .insert(tenantIntegrationApiKeys)
      .values({ tenantId, keyHash, name: name.trim() || "" })
      .returning({ id: tenantIntegrationApiKeys.id });
    return { id: created!.id, apiKey };
  }

  async listTenantIntegrationApiKeys(
    tenantId: string
  ): Promise<Array<{ id: string; name: string; createdAt: Date }>> {
    const rows = await db
      .select({
        id: tenantIntegrationApiKeys.id,
        name: tenantIntegrationApiKeys.name,
        createdAt: tenantIntegrationApiKeys.createdAt,
      })
      .from(tenantIntegrationApiKeys)
      .where(eq(tenantIntegrationApiKeys.tenantId, tenantId))
      .orderBy(desc(tenantIntegrationApiKeys.createdAt));
    return rows;
  }

  async deleteTenantIntegrationApiKey(id: string, tenantId: string): Promise<boolean> {
    const result = await db
      .delete(tenantIntegrationApiKeys)
      .where(
        and(eq(tenantIntegrationApiKeys.id, id), eq(tenantIntegrationApiKeys.tenantId, tenantId))
      )
      .returning({ id: tenantIntegrationApiKeys.id });
    return result.length > 0;
  }

  // Roles
  async getRole(id: string): Promise<Role | undefined> {
    const result = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return result[0] ? normalizeRolePermissions(result[0]) : undefined;
  }

  async getAllRoles(): Promise<Role[]> {
    const rolesList = await db.select().from(roles);
    return rolesList.map(normalizeRolePermissions);
  }

  async createRole(insertRole: InsertRole): Promise<Role> {
    const result = await db
      .insert(roles)
      .values({
        name: insertRole.name,
        salesChannelIds: insertRole.salesChannelIds,
        permissions: insertRole.permissions,
      })
      .returning();
    return result[0];
  }

  async updateRole(id: string, updates: Partial<InsertRole>): Promise<Role | undefined> {
    const result = await db
      .update(roles)
      .set(updates)
      .where(eq(roles.id, id))
      .returning();
    return result[0];
  }

  async deleteRole(id: string): Promise<boolean> {
    const result = await db.delete(roles).where(eq(roles.id, id)).returning();
    return result.length > 0;
  }

  // Shopware settings
  async getShopwareSettings(tenantId?: string | null): Promise<ShopwareSettings | undefined> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const result = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "shopware"), tenantFilter))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    const shopwareSettings = result[0].value as ShopwareSettings;
    
    // Decrypt API credentials
    if (shopwareSettings.apiKey) {
      shopwareSettings.apiKey = decrypt(shopwareSettings.apiKey);
    }
    if (shopwareSettings.apiSecret) {
      shopwareSettings.apiSecret = decrypt(shopwareSettings.apiSecret);
    }
    
    return shopwareSettings;
  }

  async saveShopwareSettings(shopwareSettings: InsertShopwareSettings, tenantId?: string | null): Promise<ShopwareSettings> {
    const encryptedSettings = {
      ...shopwareSettings,
      apiKey: shopwareSettings.apiKey ? encrypt(shopwareSettings.apiKey) : shopwareSettings.apiKey,
      apiSecret: shopwareSettings.apiSecret ? encrypt(shopwareSettings.apiSecret) : shopwareSettings.apiSecret,
    };
    const resolved = resolveTenantId(tenantId);
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    
    const existing = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "shopware"), tenantFilter))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({
          value: encryptedSettings,
          updatedAt: new Date(),
        })
        .where(and(eq(settings.key, "shopware"), tenantFilter));
    } else {
      await db.insert(settings).values({
        tenantId: resolved ?? null,
        key: "shopware",
        value: encryptedSettings,
      });
    }

    return shopwareSettings;
  }

  // Mondu settings
  async getMonduSettings(tenantId?: string | null): Promise<MonduSettings | undefined> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const result = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "mondu"), tenantFilter))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    const monduSettings = result[0].value as MonduSettings;
    
    // Decrypt API key
    if (monduSettings.apiKey) {
      monduSettings.apiKey = decrypt(monduSettings.apiKey);
    }
    
    return monduSettings;
  }

  async saveMonduSettings(monduSettings: InsertMonduSettings, tenantId?: string | null): Promise<MonduSettings> {
    const encryptedSettings = {
      ...monduSettings,
      apiKey: monduSettings.apiKey ? encrypt(monduSettings.apiKey) : monduSettings.apiKey,
    };
    const resolved = resolveTenantId(tenantId);
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);

    const existing = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "mondu"), tenantFilter))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({
          value: encryptedSettings,
          updatedAt: new Date(),
        })
        .where(and(eq(settings.key, "mondu"), tenantFilter));
    } else {
      await db.insert(settings).values({
        tenantId: resolved ?? null,
        key: "mondu",
        value: encryptedSettings,
      });
    }

    const existingSettings = await this.getMonduSettings(tenantId);
    return {
      apiKey: monduSettings.apiKey ?? existingSettings?.apiKey ?? "",
      sandboxMode: monduSettings.sandboxMode ?? existingSettings?.sandboxMode ?? true,
    };
  }

  // Proforma number range settings
  async getProformaNumberRangeSettings(tenantId?: string | null): Promise<ProformaNumberRangeSettings | undefined> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const result = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "proforma_number_range"), tenantFilter))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    return result[0].value as ProformaNumberRangeSettings;
  }

  async saveProformaNumberRangeSettings(
    proformaSettings: InsertProformaNumberRangeSettings,
    tenantId?: string | null
  ): Promise<ProformaNumberRangeSettings> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const resolvedTenantId = resolveTenantId(tenantId);
    const existing = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "proforma_number_range"), tenantFilter))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({
          value: proformaSettings,
          updatedAt: new Date(),
        })
        .where(and(eq(settings.key, "proforma_number_range"), tenantFilter));
    } else {
      await db.insert(settings).values({
        tenantId: resolvedTenantId ?? null,
        key: "proforma_number_range",
        value: proformaSettings,
      });
    }

    return proformaSettings;
  }

  // Dunning settings
  async getDunningSettings(tenantId?: string | null): Promise<DunningSettings | undefined> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const result = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "dunning_settings"), tenantFilter))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    return result[0].value as DunningSettings;
  }

  async saveDunningSettings(dunningSettings: InsertDunningSettings, tenantId?: string | null): Promise<DunningSettings> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const resolvedTenantId = resolveTenantId(tenantId);
    const existing = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, "dunning_settings"), tenantFilter))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({
          value: dunningSettings,
          updatedAt: new Date(),
        })
        .where(and(eq(settings.key, "dunning_settings"), tenantFilter));
    } else {
      await db.insert(settings).values({
        tenantId: resolvedTenantId ?? null,
        key: "dunning_settings",
        value: dunningSettings,
      });
    }

    return dunningSettings;
  }

  // Dunning status per order
  async getOrderDunningStatus(orderId: string, tenantId?: string | null): Promise<OrderDunningStatus | undefined> {
    const tenantFilter = tenantFilterFor(orderDunningStatus.tenantId, tenantId);
    const result = await db
      .select()
      .from(orderDunningStatus)
      .where(and(eq(orderDunningStatus.orderId, orderId), tenantFilter))
      .limit(1);
    return result[0];
  }

  async getOrderDunningStatuses(orderIds: string[], tenantId?: string | null): Promise<OrderDunningStatus[]> {
    if (orderIds.length === 0) return [];
    const tenantFilter = tenantFilterFor(orderDunningStatus.tenantId, tenantId);
    return db
      .select()
      .from(orderDunningStatus)
      .where(and(inArray(orderDunningStatus.orderId, orderIds), tenantFilter));
  }

  async upsertOrderDunningStatus(
    status: InsertOrderDunningStatus,
    tenantId?: string | null
  ): Promise<OrderDunningStatus> {
    const tenantFilter = tenantFilterFor(orderDunningStatus.tenantId, tenantId);
    const existing = await db
      .select()
      .from(orderDunningStatus)
      .where(and(eq(orderDunningStatus.orderId, status.orderId), tenantFilter))
      .limit(1);

    if (existing.length > 0) {
      const updated = await db
        .update(orderDunningStatus)
        .set({
          stage: status.stage ?? existing[0].stage,
          lastSentAt: status.lastSentAt ?? existing[0].lastSentAt,
          lastDocumentId: status.lastDocumentId ?? existing[0].lastDocumentId,
          lastPdfUrl: status.lastPdfUrl ?? existing[0].lastPdfUrl,
          updatedAt: new Date(),
        })
        .where(and(eq(orderDunningStatus.orderId, status.orderId), tenantFilter))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(orderDunningStatus)
      .values({
        ...status,
        tenantId: tenantId ?? null,
      })
      .returning();
    return inserted[0];
  }

  // Cross-Selling Rules
  async getAllCrossSellingRules(tenantId?: string | null): Promise<CrossSellingRule[]> {
    const tenantFilter = tenantFilterFor(crossSellingRules.tenantId, tenantId);
    const dbRules = await db.select().from(crossSellingRules).where(tenantFilter);
    return dbRules.map(mapCrossSellingRuleRow);
  }

  async getCrossSellingRule(id: string, tenantId?: string | null): Promise<CrossSellingRule | undefined> {
    const tenantFilter = tenantFilterFor(crossSellingRules.tenantId, tenantId);
    const result = await db
      .select()
      .from(crossSellingRules)
      .where(and(eq(crossSellingRules.id, id), tenantFilter))
      .limit(1);
    
    if (!result[0]) return undefined;

    return mapCrossSellingRuleRow(result[0]);
  }

  async createCrossSellingRule(insertRule: InsertCrossSellingRule, tenantId?: string | null): Promise<CrossSellingRule> {
    const result = await db
      .insert(crossSellingRules)
      .values({
        tenantId: tenantId ?? null,
        name: insertRule.name,
        description: insertRule.description,
        active: insertRule.active ?? 1,
        category: insertRule.category ?? null,
        // Data is already JSON stringified from routes.ts, don't stringify again
        sourceConditions: insertRule.sourceConditions as any,
        targetCriteria: insertRule.targetCriteria as any,
      })
      .returning();
    
    return mapCrossSellingRuleRow(result[0]);
  }

  async updateCrossSellingRule(
    id: string,
    updates: Partial<InsertCrossSellingRule>,
    tenantId?: string | null
  ): Promise<CrossSellingRule | undefined> {
    const tenantFilter = tenantFilterFor(crossSellingRules.tenantId, tenantId);
    const updateData: any = { updatedAt: new Date() };
    
    if (updates.name) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.active !== undefined) updateData.active = updates.active;
    if (updates.category !== undefined) updateData.category = updates.category;
    if (updates.sourceConditions) {
      // Data is already JSON stringified from routes.ts, don't stringify again
      updateData.sourceConditions = updates.sourceConditions;
    }
    if (updates.targetCriteria) {
      // Data is already JSON stringified from routes.ts, don't stringify again
      updateData.targetCriteria = updates.targetCriteria;
    }
    
    const result = await db
      .update(crossSellingRules)
      .set(updateData)
      .where(and(eq(crossSellingRules.id, id), tenantFilter))
      .returning();
    
    if (!result[0]) return undefined;

    return mapCrossSellingRuleRow(result[0]);
  }

  async deleteCrossSellingRule(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(crossSellingRules.tenantId, tenantId);
    const result = await db
      .delete(crossSellingRules)
      .where(and(eq(crossSellingRules.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Tickets
  async getAllTickets(tenantId?: string | null): Promise<Ticket[]> {
    const tenantFilter = tenantFilterFor(tickets.tenantId, tenantId);
    return await db.select().from(tickets).where(tenantFilter);
  }

  async getTicketsPaginated(limit: number, offset: number, tenantId?: string | null): Promise<{ tickets: Ticket[]; total: number }> {
    const tenantFilter = tenantFilterFor(tickets.tenantId, tenantId);
    // Get total count
    const countResult = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(tickets)
      .where(tenantFilter);
    const total = countResult[0]?.count || 0;
    
    // Get paginated tickets sorted by createdAt DESC (newest first)
    const paginatedTickets = await db
      .select()
      .from(tickets)
      .where(tenantFilter)
      .orderBy(desc(tickets.createdAt))
      .limit(limit)
      .offset(offset);
    
    return {
      tickets: paginatedTickets,
      total,
    };
  }

  async getTicket(id: string, tenantId?: string | null): Promise<Ticket | undefined> {
    const tenantFilter = tenantFilterFor(tickets.tenantId, tenantId);
    const result = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async getTicketsByOrderId(orderId: string, tenantId?: string | null): Promise<Ticket[]> {
    const tenantFilter = tenantFilterFor(tickets.tenantId, tenantId);
    return await db.select().from(tickets).where(and(eq(tickets.orderId, orderId), tenantFilter));
  }

  async createTicket(insertTicket: InsertTicket, tenantId?: string | null): Promise<Ticket> {
    const ticketNumber = await this.generateTicketNumber();
    
    const result = await db
      .insert(tickets)
      .values({
        ...insertTicket,
        tenantId: tenantId ?? null,
        ticketNumber,
      })
      .returning();
    return result[0];
  }

  async updateTicket(id: string, updates: Partial<InsertTicket>, tenantId?: string | null): Promise<Ticket | undefined> {
    const tenantFilter = tenantFilterFor(tickets.tenantId, tenantId);
    const updateData: any = { ...updates, updatedAt: new Date() };
    
    if (updates.status === "resolved") {
      const existing = await this.getTicket(id, tenantId);
      if (existing && !existing.resolvedAt) {
        updateData.resolvedAt = new Date();
      }
    }
    
    if (updates.status === "closed") {
      const existing = await this.getTicket(id, tenantId);
      if (existing && !existing.closedAt) {
        updateData.closedAt = new Date();
      }
    }
    
    const result = await db
      .update(tickets)
      .set(updateData)
      .where(and(eq(tickets.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteTicket(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(tickets.tenantId, tenantId);
    const result = await db
      .delete(tickets)
      .where(and(eq(tickets.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // CRM - Customers
  async getAllCustomers(tenantId?: string | null): Promise<Customer[]> {
    const tenantFilter = tenantFilterFor(customers.tenantId, tenantId);
    return await db.select().from(customers).where(tenantFilter).orderBy(desc(customers.updatedAt));
  }

  async getCustomer(id: string, tenantId?: string | null): Promise<Customer | undefined> {
    const tenantFilter = tenantFilterFor(customers.tenantId, tenantId);
    const result = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async getCustomerByEmail(email: string, tenantId?: string | null): Promise<Customer | undefined> {
    const tenantFilter = tenantFilterFor(customers.tenantId, tenantId);
    const result = await db
      .select()
      .from(customers)
      .where(and(eq(customers.email, email), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createCustomer(customer: InsertCustomer, tenantId?: string | null): Promise<Customer> {
    const resolvedTenantId = resolveTenantId(tenantId);
    const result = await db
      .insert(customers)
      .values({
        ...customer,
        tenantId: resolvedTenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateCustomer(id: string, updates: Partial<InsertCustomer>, tenantId?: string | null): Promise<Customer | undefined> {
    const tenantFilter = tenantFilterFor(customers.tenantId, tenantId);
    const result = await db
      .update(customers)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(customers.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteCustomer(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(customers.tenantId, tenantId);
    const result = await db
      .delete(customers)
      .where(and(eq(customers.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // CRM - Customer Interactions
  async getCustomerInteractions(customerId: string, tenantId?: string | null): Promise<CustomerInteraction[]> {
    const tenantFilter = tenantFilterFor(customerInteractions.tenantId, tenantId);
    return await db
      .select()
      .from(customerInteractions)
      .where(and(eq(customerInteractions.customerId, customerId), tenantFilter))
      .orderBy(desc(customerInteractions.createdAt));
  }

  async getRecentCustomerInteractions(limit: number, tenantId?: string | null): Promise<CustomerInteraction[]> {
    const tenantFilter = tenantFilterFor(customerInteractions.tenantId, tenantId);
    return await db
      .select()
      .from(customerInteractions)
      .where(tenantFilter)
      .orderBy(desc(customerInteractions.createdAt))
      .limit(limit);
  }

  async createCustomerInteraction(interaction: InsertCustomerInteraction, tenantId?: string | null): Promise<CustomerInteraction> {
    const resolvedTenantId = resolveTenantId(tenantId);
    const result = await db
      .insert(customerInteractions)
      .values({
        ...interaction,
        tenantId: resolvedTenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async deleteCustomerInteraction(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(customerInteractions.tenantId, tenantId);
    const result = await db
      .delete(customerInteractions)
      .where(and(eq(customerInteractions.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // CRM - Order Assignments
  async getOrderAssignments(tenantId?: string | null): Promise<OrderAssignment[]> {
    const tenantFilter = tenantFilterFor(orderAssignments.tenantId, tenantId);
    return await db.select().from(orderAssignments).where(tenantFilter).orderBy(desc(orderAssignments.createdAt));
  }

  async getOrderAssignmentsByOrderId(orderId: string, tenantId?: string | null): Promise<OrderAssignment[]> {
    const tenantFilter = tenantFilterFor(orderAssignments.tenantId, tenantId);
    return await db
      .select()
      .from(orderAssignments)
      .where(and(eq(orderAssignments.orderId, orderId), tenantFilter))
      .orderBy(desc(orderAssignments.createdAt));
  }

  async getOrderAssignment(id: string, tenantId?: string | null): Promise<OrderAssignment | undefined> {
    const tenantFilter = tenantFilterFor(orderAssignments.tenantId, tenantId);
    const result = await db
      .select()
      .from(orderAssignments)
      .where(and(eq(orderAssignments.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createOrderAssignment(assignment: InsertOrderAssignment, tenantId?: string | null): Promise<OrderAssignment> {
    const resolvedTenantId = resolveTenantId(tenantId);
    const result = await db
      .insert(orderAssignments)
      .values({
        ...assignment,
        tenantId: resolvedTenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateOrderAssignment(id: string, updates: Partial<InsertOrderAssignment>, tenantId?: string | null): Promise<OrderAssignment | undefined> {
    const tenantFilter = tenantFilterFor(orderAssignments.tenantId, tenantId);
    const result = await db
      .update(orderAssignments)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(orderAssignments.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  // CRM - Discount Requests
  async getDiscountRequests(tenantId?: string | null): Promise<DiscountRequest[]> {
    const tenantFilter = tenantFilterFor(discountRequests.tenantId, tenantId);
    return await db.select().from(discountRequests).where(tenantFilter).orderBy(desc(discountRequests.createdAt));
  }

  async getDiscountRequestsByTicketId(ticketId: string, tenantId?: string | null): Promise<DiscountRequest[]> {
    const tenantFilter = tenantFilterFor(discountRequests.tenantId, tenantId);
    return await db
      .select()
      .from(discountRequests)
      .where(and(eq(discountRequests.ticketId, ticketId), tenantFilter))
      .orderBy(desc(discountRequests.createdAt));
  }

  async getDiscountRequest(id: string, tenantId?: string | null): Promise<DiscountRequest | undefined> {
    const tenantFilter = tenantFilterFor(discountRequests.tenantId, tenantId);
    const result = await db
      .select()
      .from(discountRequests)
      .where(and(eq(discountRequests.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createDiscountRequest(request: InsertDiscountRequest, tenantId?: string | null): Promise<DiscountRequest> {
    const resolvedTenantId = resolveTenantId(tenantId);
    const result = await db
      .insert(discountRequests)
      .values({
        ...request,
        discountValue: String(request.discountValue),
        tenantId: resolvedTenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateDiscountRequest(id: string, updates: Partial<InsertDiscountRequest>, tenantId?: string | null): Promise<DiscountRequest | undefined> {
    const tenantFilter = tenantFilterFor(discountRequests.tenantId, tenantId);
    const setValues: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    if (updates.discountValue !== undefined) {
      setValues.discountValue = String(updates.discountValue);
    }
    const result = await db
      .update(discountRequests)
      .set(setValues)
      .where(and(eq(discountRequests.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  // Ticket Comments
  async getTicketComments(ticketId: string, tenantId?: string | null): Promise<TicketComment[]> {
    const tenantFilter = tenantFilterFor(ticketComments.tenantId, tenantId);
    return await db
      .select()
      .from(ticketComments)
      .where(and(eq(ticketComments.ticketId, ticketId), tenantFilter));
  }

  async createTicketComment(insertComment: InsertTicketComment, tenantId?: string | null): Promise<TicketComment> {
    const result = await db
      .insert(ticketComments)
      .values({
        ...insertComment,
        tenantId: tenantId ?? null,
      })
      .returning();
    
    await db
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, insertComment.ticketId));
    
    return result[0];
  }

  async deleteTicketComment(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(ticketComments.tenantId, tenantId);
    const result = await db
      .delete(ticketComments)
      .where(and(eq(ticketComments.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Ticket Email Messages
  async getTicketEmailMessageByMessageId(messageId: string, tenantId?: string | null): Promise<TicketEmailMessage | undefined> {
    const tenantFilter = tenantFilterFor(ticketEmailMessages.tenantId, tenantId);
    const result = await db
      .select()
      .from(ticketEmailMessages)
      .where(and(eq(ticketEmailMessages.messageId, messageId), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createTicketEmailMessage(message: InsertTicketEmailMessage, tenantId?: string | null): Promise<TicketEmailMessage> {
    const result = await db
      .insert(ticketEmailMessages)
      .values({
        ...message,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async getLatestTicketEmailMessage(ticketId: string, tenantId?: string | null): Promise<TicketEmailMessage | undefined> {
    const tenantFilter = tenantFilterFor(ticketEmailMessages.tenantId, tenantId);
    const result = await db
      .select()
      .from(ticketEmailMessages)
      .where(and(eq(ticketEmailMessages.ticketId, ticketId), tenantFilter))
      .orderBy(desc(ticketEmailMessages.createdAt))
      .limit(1);
    return result[0];
  }

  // M365 Connections
  async getM365Connections(tenantId?: string | null): Promise<M365Connection[]> {
    const tenantFilter = tenantFilterFor(m365Connections.tenantId, tenantId);
    const result = await db.select().from(m365Connections).where(tenantFilter);
    return result.map((connection) => ({
      ...connection,
      accessToken: decrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    }));
  }

  async getM365Connection(id: string, tenantId?: string | null): Promise<M365Connection | undefined> {
    const tenantFilter = tenantFilterFor(m365Connections.tenantId, tenantId);
    const result = await db
      .select()
      .from(m365Connections)
      .where(and(eq(m365Connections.id, id), tenantFilter))
      .limit(1);
    const connection = result[0];
    if (!connection) return undefined;
    return {
      ...connection,
      accessToken: decrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    };
  }

  async getM365ConnectionByEmail(email: string, tenantId?: string | null): Promise<M365Connection | undefined> {
    const tenantFilter = tenantFilterFor(m365Connections.tenantId, tenantId);
    const result = await db
      .select()
      .from(m365Connections)
      .where(and(eq(m365Connections.email, email), tenantFilter))
      .limit(1);
    const connection = result[0];
    if (!connection) return undefined;
    return {
      ...connection,
      accessToken: decrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    };
  }

  async createM365Connection(connection: InsertM365Connection, tenantId?: string | null): Promise<M365Connection> {
    const payload = {
      ...connection,
      tenantId: tenantId ?? connection.tenantId ?? null,
      accessToken: encrypt(connection.accessToken),
      refreshToken: connection.refreshToken ? encrypt(connection.refreshToken) : null,
      updatedAt: new Date(),
    };
    const result = await db.insert(m365Connections).values(payload).returning();
    return {
      ...result[0],
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken || null,
    };
  }

  async updateM365Connection(id: string, updates: Partial<InsertM365Connection>, tenantId?: string | null): Promise<M365Connection | undefined> {
    const tenantFilter = tenantFilterFor(m365Connections.tenantId, tenantId);
    const payload: Partial<InsertM365Connection> = {
      ...updates,
      updatedAt: new Date(),
    };
    if (updates.accessToken) {
      payload.accessToken = encrypt(updates.accessToken);
    }
    if (updates.refreshToken !== undefined) {
      payload.refreshToken = updates.refreshToken ? encrypt(updates.refreshToken) : null;
    }
    const result = await db
      .update(m365Connections)
      .set(payload)
      .where(and(eq(m365Connections.id, id), tenantFilter))
      .returning();
    const connection = result[0];
    if (!connection) return undefined;
    return {
      ...connection,
      accessToken: updates.accessToken ? updates.accessToken : decrypt(connection.accessToken),
      refreshToken: updates.refreshToken !== undefined
        ? updates.refreshToken || null
        : connection.refreshToken
          ? decrypt(connection.refreshToken)
          : null,
    };
  }

  async deleteM365Connection(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(m365Connections.tenantId, tenantId);
    const result = await db
      .delete(m365Connections)
      .where(and(eq(m365Connections.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Ticket Attachments
  async getTicketAttachments(ticketId: string, tenantId?: string | null): Promise<TicketAttachment[]> {
    const tenantFilter = tenantFilterFor(ticketAttachments.tenantId, tenantId);
    return await db
      .select()
      .from(ticketAttachments)
      .where(and(eq(ticketAttachments.ticketId, ticketId), tenantFilter));
  }

  async getTicketAttachment(id: string, tenantId?: string | null): Promise<TicketAttachment | undefined> {
    const tenantFilter = tenantFilterFor(ticketAttachments.tenantId, tenantId);
    const result = await db
      .select()
      .from(ticketAttachments)
      .where(and(eq(ticketAttachments.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createTicketAttachment(insertAttachment: InsertTicketAttachment, tenantId?: string | null): Promise<TicketAttachment> {
    const result = await db
      .insert(ticketAttachments)
      .values({
        ...insertAttachment,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async deleteTicketAttachment(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(ticketAttachments.tenantId, tenantId);
    const result = await db
      .delete(ticketAttachments)
      .where(and(eq(ticketAttachments.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Ticket Views (Read/Unread tracking)
  async markTicketCommentsAsRead(ticketId: string, userId: string, tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(ticketComments.tenantId, tenantId);
    // Get all comments for the ticket
    const comments = await db
      .select({ id: ticketComments.id })
      .from(ticketComments)
      .where(and(eq(ticketComments.ticketId, ticketId), tenantFilter));
    
    // Insert view records for each comment (ignore if already exists)
    for (const comment of comments) {
      await db
        .insert(ticketCommentViews)
        .values({
          tenantId: tenantId ?? null,
          commentId: comment.id,
          userId: userId,
        })
        .onConflictDoNothing();
    }
  }

  async markTicketAttachmentsAsRead(ticketId: string, userId: string, tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(ticketAttachments.tenantId, tenantId);
    // Get all attachments for the ticket
    const attachments = await db
      .select({ id: ticketAttachments.id })
      .from(ticketAttachments)
      .where(and(eq(ticketAttachments.ticketId, ticketId), tenantFilter));
    
    // Insert view records for each attachment (ignore if already exists)
    for (const attachment of attachments) {
      await db
        .insert(ticketAttachmentViews)
        .values({
          tenantId: tenantId ?? null,
          attachmentId: attachment.id,
          userId: userId,
        })
        .onConflictDoNothing();
    }
  }

  async getUnreadCounts(ticketId: string, userId: string, tenantId?: string | null): Promise<{ unreadComments: number; unreadAttachments: number }> {
    const commentTenantFilter = tenantFilterFor(ticketComments.tenantId, tenantId);
    const attachmentTenantFilter = tenantFilterFor(ticketAttachments.tenantId, tenantId);
    // Count unread comments using LEFT JOIN
    const unreadCommentsResult = await db
      .select({
        count: drizzleSql<number>`count(${ticketComments.id})::int`,
      })
      .from(ticketComments)
      .leftJoin(
        ticketCommentViews,
        and(
          eq(ticketComments.id, ticketCommentViews.commentId),
          eq(ticketCommentViews.userId, userId)
        )
      )
      .where(
        and(
          eq(ticketComments.ticketId, ticketId),
          commentTenantFilter,
          isNull(ticketCommentViews.id)
        )
      );
    
    // Count unread attachments using LEFT JOIN
    const unreadAttachmentsResult = await db
      .select({
        count: drizzleSql<number>`count(${ticketAttachments.id})::int`,
      })
      .from(ticketAttachments)
      .leftJoin(
        ticketAttachmentViews,
        and(
          eq(ticketAttachments.id, ticketAttachmentViews.attachmentId),
          eq(ticketAttachmentViews.userId, userId)
        )
      )
      .where(
        and(
          eq(ticketAttachments.ticketId, ticketId),
          attachmentTenantFilter,
          isNull(ticketAttachmentViews.id)
        )
      );
    
    return {
      unreadComments: unreadCommentsResult[0]?.count || 0,
      unreadAttachments: unreadAttachmentsResult[0]?.count || 0,
    };
  }

  async getTicketActivityLog(ticketId: string, tenantId?: string | null): Promise<TicketActivityLog[]> {
    const tenantFilter = tenantFilterFor(ticketActivityLog.tenantId, tenantId);
    return await db
      .select()
      .from(ticketActivityLog)
      .where(and(eq(ticketActivityLog.ticketId, ticketId), tenantFilter))
      .orderBy(drizzleSql`${ticketActivityLog.createdAt} DESC`);
  }

  async createTicketActivityLog(log: InsertTicketActivityLog, tenantId?: string | null): Promise<TicketActivityLog> {
    const result = await db
      .insert(ticketActivityLog)
      .values({
        ...log,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  // Ticket Assignment Rules
  async getAllTicketAssignmentRules(tenantId?: string | null): Promise<TicketAssignmentRule[]> {
    const tenantFilter = tenantFilterFor(ticketAssignmentRules.tenantId, tenantId);
    return await db
      .select()
      .from(ticketAssignmentRules)
      .where(tenantFilter)
      .orderBy(desc(ticketAssignmentRules.priority));
  }

  async getActiveTicketAssignmentRules(tenantId?: string | null): Promise<TicketAssignmentRule[]> {
    const tenantFilter = tenantFilterFor(ticketAssignmentRules.tenantId, tenantId);
    return await db
      .select()
      .from(ticketAssignmentRules)
      .where(and(eq(ticketAssignmentRules.active, 1), tenantFilter))
      .orderBy(desc(ticketAssignmentRules.priority));
  }

  async getTicketAssignmentRule(id: string, tenantId?: string | null): Promise<TicketAssignmentRule | undefined> {
    const tenantFilter = tenantFilterFor(ticketAssignmentRules.tenantId, tenantId);
    const result = await db
      .select()
      .from(ticketAssignmentRules)
      .where(and(eq(ticketAssignmentRules.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createTicketAssignmentRule(insertRule: InsertTicketAssignmentRule, tenantId?: string | null): Promise<TicketAssignmentRule> {
    const result = await db
      .insert(ticketAssignmentRules)
      .values({
        ...insertRule,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateTicketAssignmentRule(id: string, updates: Partial<InsertTicketAssignmentRule>, tenantId?: string | null): Promise<TicketAssignmentRule | undefined> {
    const tenantFilter = tenantFilterFor(ticketAssignmentRules.tenantId, tenantId);
    const result = await db
      .update(ticketAssignmentRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(ticketAssignmentRules.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteTicketAssignmentRule(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(ticketAssignmentRules.tenantId, tenantId);
    const result = await db
      .delete(ticketAssignmentRules)
      .where(and(eq(ticketAssignmentRules.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Notifications
  async getNotificationsByUserId(userId: string, limit?: number, tenantId?: string | null): Promise<Notification[]> {
    const tenantFilter = tenantFilterFor(notifications.tenantId, tenantId);
    let query = db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), tenantFilter))
      .orderBy(desc(notifications.createdAt));
    
    if (limit) {
      query = query.limit(limit) as any;
    }
    
    return await query;
  }

  async getUnreadNotificationCount(userId: string, tenantId?: string | null): Promise<number> {
    const tenantFilter = tenantFilterFor(notifications.tenantId, tenantId);
    const result = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.read, 0),
        tenantFilter
      ));
    
    return result[0]?.count || 0;
  }

  async createNotification(insertNotification: InsertNotification, tenantId?: string | null): Promise<Notification> {
    const result = await db
      .insert(notifications)
      .values({
        ...insertNotification,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async markNotificationAsRead(id: string, tenantId?: string | null): Promise<Notification | undefined> {
    const tenantFilter = tenantFilterFor(notifications.tenantId, tenantId);
    const result = await db
      .update(notifications)
      .set({ read: 1 })
      .where(and(eq(notifications.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async markAllNotificationsAsRead(userId: string, tenantId?: string | null): Promise<number> {
    const tenantFilter = tenantFilterFor(notifications.tenantId, tenantId);
    const result = await db
      .update(notifications)
      .set({ read: 1 })
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.read, 0),
        tenantFilter
      ))
      .returning();
    
    return result.length;
  }

  async deleteNotification(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(notifications.tenantId, tenantId);
    const result = await db
      .delete(notifications)
      .where(and(eq(notifications.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Ticket Templates
  async getAllTicketTemplates(tenantId?: string | null): Promise<TicketTemplate[]> {
    const tenantFilter = tenantFilterFor(ticketTemplates.tenantId, tenantId);
    return await db
      .select()
      .from(ticketTemplates)
      .where(tenantFilter)
      .orderBy(desc(ticketTemplates.createdAt));
  }

  async getTicketTemplate(id: string, tenantId?: string | null): Promise<TicketTemplate | undefined> {
    const tenantFilter = tenantFilterFor(ticketTemplates.tenantId, tenantId);
    const result = await db
      .select()
      .from(ticketTemplates)
      .where(and(eq(ticketTemplates.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createTicketTemplate(insertTemplate: InsertTicketTemplate, tenantId?: string | null): Promise<TicketTemplate> {
    const result = await db
      .insert(ticketTemplates)
      .values({
        ...insertTemplate,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateTicketTemplate(id: string, updates: Partial<InsertTicketTemplate>, tenantId?: string | null): Promise<TicketTemplate | undefined> {
    const tenantFilter = tenantFilterFor(ticketTemplates.tenantId, tenantId);
    const result = await db
      .update(ticketTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(ticketTemplates.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteTicketTemplate(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(ticketTemplates.tenantId, tenantId);
    const result = await db
      .delete(ticketTemplates)
      .where(and(eq(ticketTemplates.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Process Updates
  async getProcessUpdates(tenantId?: string | null): Promise<ProcessUpdate[]> {
    const tenantFilter = tenantFilterFor(processUpdates.tenantId, tenantId);
    return await db
      .select()
      .from(processUpdates)
      .where(tenantFilter)
      .orderBy(desc(processUpdates.effectiveDate));
  }

  async getProcessUpdate(id: string, tenantId?: string | null): Promise<ProcessUpdate | undefined> {
    const tenantFilter = tenantFilterFor(processUpdates.tenantId, tenantId);
    const result = await db
      .select()
      .from(processUpdates)
      .where(and(eq(processUpdates.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createProcessUpdate(update: InsertProcessUpdate, tenantId?: string | null): Promise<ProcessUpdate> {
    const result = await db
      .insert(processUpdates)
      .values({
        ...update,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateProcessUpdate(
    id: string,
    updates: Partial<InsertProcessUpdate>,
    tenantId?: string | null
  ): Promise<ProcessUpdate | undefined> {
    const tenantFilter = tenantFilterFor(processUpdates.tenantId, tenantId);
    const result = await db
      .update(processUpdates)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(processUpdates.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteProcessUpdate(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(processUpdates.tenantId, tenantId);
    const result = await db
      .delete(processUpdates)
      .where(and(eq(processUpdates.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // Settings (generic key-value store)
  async getSetting(key: string, tenantId?: string | null): Promise<any | undefined> {
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const result = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, key), tenantFilter))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    return result[0].value;
  }

  async saveSetting(key: string, value: any, tenantId?: string | null): Promise<void> {
    const resolved = resolveTenantId(tenantId);
    const tenantFilter = tenantFilterFor(settings.tenantId, tenantId);
    const existing = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, key), tenantFilter))
      .limit(1);

    if (existing[0]) {
      await db
        .update(settings)
        .set({ value, updatedAt: new Date() })
        .where(and(eq(settings.key, key), tenantFilter));
    } else {
      await db.insert(settings).values({ key, value, tenantId: resolved ?? null });
    }
  }

  // AI Cross-Selling learning
  async replaceCrossSellCooccurrences(rows: InsertCrossSellCooccurrence[], tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(crossSellCooccurrences.tenantId, tenantId);
    await db.delete(crossSellCooccurrences).where(tenantFilter);
    if (rows.length > 0) {
      await db.insert(crossSellCooccurrences).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async getCrossSellCooccurrences(tenantId?: string | null): Promise<CrossSellCooccurrence[]> {
    const tenantFilter = tenantFilterFor(crossSellCooccurrences.tenantId, tenantId);
    const rows = await db
      .select()
      .from(crossSellCooccurrences)
      .where(tenantFilter)
      .orderBy(desc(crossSellCooccurrences.lift));
    return rows.map((row) => ({
      ...row,
      generatedAt: toIsoString(row.generatedAt),
    }));
  }

  async replaceAiCrossSellRules(rows: InsertAiCrossSellRule[], tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(aiCrossSellRules.tenantId, tenantId);
    await db.delete(aiCrossSellRules).where(tenantFilter);
    if (rows.length > 0) {
      await db.insert(aiCrossSellRules).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async getAiCrossSellRules(tenantId?: string | null): Promise<AiCrossSellRule[]> {
    const tenantFilter = tenantFilterFor(aiCrossSellRules.tenantId, tenantId);
    const rows = await db
      .select()
      .from(aiCrossSellRules)
      .where(tenantFilter)
      .orderBy(desc(aiCrossSellRules.lift));
    // #endregion
    return rows.map((row) => ({
      ...row,
      reason: row.reason ?? undefined,
      generatedAt: toIsoString(row.generatedAt),
    }));
  }

  async replaceAiRecommendations(rows: InsertAiRecommendation[], tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(aiRecommendations.tenantId, tenantId);
    await db.delete(aiRecommendations).where(tenantFilter);
    if (rows.length > 0) {
      await db.insert(aiRecommendations).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async getAiRecommendations(productNumber?: string, limit: number = 10, tenantId?: string | null): Promise<AiRecommendation[]> {
    const tenantFilter = tenantFilterFor(aiRecommendations.tenantId, tenantId);
    if (productNumber) {
      const rows = await db
        .select()
        .from(aiRecommendations)
        .where(and(eq(aiRecommendations.productNumber, productNumber), tenantFilter))
        .orderBy(desc(aiRecommendations.score))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        reason: row.reason ?? undefined,
        generatedAt: toIsoString(row.generatedAt),
      }));
    }
    const rows = await db
      .select()
      .from(aiRecommendations)
      .where(tenantFilter)
      .orderBy(desc(aiRecommendations.score))
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      reason: row.reason ?? undefined,
      generatedAt: toIsoString(row.generatedAt),
    }));
  }

  async replaceAiInsights(rows: InsertAiInsight[], tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(aiInsights.tenantId, tenantId);
    await db.delete(aiInsights).where(tenantFilter);
    if (rows.length > 0) {
      await db.insert(aiInsights).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async getAiInsights(tenantId?: string | null): Promise<AiInsight[]> {
    const tenantFilter = tenantFilterFor(aiInsights.tenantId, tenantId);
    const rows = await db.select().from(aiInsights).where(tenantFilter).orderBy(desc(aiInsights.generatedAt));
    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      data: (row.data as Record<string, any> | null | undefined) ?? undefined,
      generatedAt: toIsoString(row.generatedAt),
    }));
  }

  async recordCrossSellEvent(row: InsertCrossSellEvent, tenantId?: string | null): Promise<void> {
    const resolvedTenant = tenantId !== undefined ? tenantId : (row.tenantId ?? null);
    await db.insert(crossSellEvents).values({
      eventType: row.eventType,
      sourceProductNumber: row.sourceProductNumber,
      targetProductNumber: row.targetProductNumber,
      context: row.context ?? null,
      draftId: row.draftId ?? null,
      userId: row.userId ?? null,
      metadata: row.metadata ?? null,
      tenantId: resolvedTenant,
    });
  }

  async getCrossSellEventStats(tenantId: string | null, since: Date): Promise<CrossSellEventPairStats[]> {
    const tenantFilter = tenantFilterFor(crossSellEvents.tenantId, tenantId);
    const rows = await db
      .select({
        sourceProductNumber: crossSellEvents.sourceProductNumber,
        targetProductNumber: crossSellEvents.targetProductNumber,
        impressions: sql<number>`coalesce(sum(case when ${crossSellEvents.eventType} in ('product_suggestion_impression','draft_suggestions_impression') then 1 else 0 end), 0)::int`,
        clicks: sql<number>`coalesce(sum(case when ${crossSellEvents.eventType} = 'product_suggestion_click' then 1 else 0 end), 0)::int`,
        adds: sql<number>`coalesce(sum(case when ${crossSellEvents.eventType} in ('product_suggestion_add_to_group','draft_suggestion_add') then 1 else 0 end), 0)::int`,
        removes: sql<number>`coalesce(sum(case when ${crossSellEvents.eventType} = 'product_suggestion_remove' then 1 else 0 end), 0)::int`,
        returns: sql<number>`coalesce(sum(case when ${crossSellEvents.eventType} = 'product_suggestion_return' then 1 else 0 end), 0)::int`,
      })
      .from(crossSellEvents)
      .where(and(tenantFilter, gte(crossSellEvents.createdAt, since)))
      .groupBy(crossSellEvents.sourceProductNumber, crossSellEvents.targetProductNumber);

    return rows.map((r) => ({
      sourceProductNumber: r.sourceProductNumber,
      targetProductNumber: r.targetProductNumber,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      adds: Number(r.adds) || 0,
      removes: Number(r.removes) || 0,
      returns: Number(r.returns) || 0,
    }));
  }

  async createCrossSellStagingBatch(
    batch: InsertCrossSellStagingBatch,
    tenantId?: string | null
  ): Promise<CrossSellStagingBatch> {
    const result = await db
      .insert(crossSellStagingBatches)
      .values({
        ...batch,
        tenantId: tenantId ?? batch.tenantId ?? null,
      })
      .returning();
    return mapStagingBatch(result[0]);
  }

  async getLatestCrossSellStagingBatch(tenantId?: string | null): Promise<CrossSellStagingBatch | undefined> {
    const tenantFilter = tenantFilterFor(crossSellStagingBatches.tenantId, tenantId);
    const result = await db
      .select()
      .from(crossSellStagingBatches)
      .where(tenantFilter)
      .orderBy(desc(crossSellStagingBatches.createdAt))
      .limit(1);
    return result[0] ? mapStagingBatch(result[0]) : undefined;
  }

  async getCrossSellStagingBatch(id: string, tenantId?: string | null): Promise<CrossSellStagingBatch | undefined> {
    const tenantFilter = tenantFilterFor(crossSellStagingBatches.tenantId, tenantId);
    const result = await db
      .select()
      .from(crossSellStagingBatches)
      .where(and(eq(crossSellStagingBatches.id, id), tenantFilter))
      .limit(1);
    return result[0] ? mapStagingBatch(result[0]) : undefined;
  }

  async getCrossSellStagingRules(batchId: string, tenantId?: string | null): Promise<CrossSellStagingRule[]> {
    const tenantFilter = tenantFilterFor(crossSellStagingRules.tenantId, tenantId);
    const rows = await db
      .select()
      .from(crossSellStagingRules)
      .where(and(eq(crossSellStagingRules.batchId, batchId), tenantFilter))
      .orderBy(desc(crossSellStagingRules.createdAt));
    return rows.map(mapStagingRule);
  }

  async getCrossSellStagingSuggestions(
    batchId: string,
    tenantId?: string | null
  ): Promise<CrossSellStagingSuggestion[]> {
    const tenantFilter = tenantFilterFor(crossSellStagingSuggestions.tenantId, tenantId);
    const rows = await db
      .select()
      .from(crossSellStagingSuggestions)
      .where(and(eq(crossSellStagingSuggestions.batchId, batchId), tenantFilter))
      .orderBy(desc(crossSellStagingSuggestions.createdAt));
    return rows.map(mapStagingSuggestion);
  }

  async replaceCrossSellStagingRules(
    batchId: string,
    rows: InsertCrossSellStagingRule[],
    tenantId?: string | null
  ): Promise<void> {
    const tenantFilter = tenantFilterFor(crossSellStagingRules.tenantId, tenantId);
    await db
      .delete(crossSellStagingRules)
      .where(and(eq(crossSellStagingRules.batchId, batchId), tenantFilter));
    if (rows.length > 0) {
      await db.insert(crossSellStagingRules).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async replaceCrossSellStagingSuggestions(
    batchId: string,
    rows: InsertCrossSellStagingSuggestion[],
    tenantId?: string | null
  ): Promise<void> {
    const tenantFilter = tenantFilterFor(crossSellStagingSuggestions.tenantId, tenantId);
    await db
      .delete(crossSellStagingSuggestions)
      .where(and(eq(crossSellStagingSuggestions.batchId, batchId), tenantFilter));
    if (rows.length > 0) {
      await db.insert(crossSellStagingSuggestions).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async replaceCrossSellStagingSuggestionsForSource(
    batchId: string,
    sourceProductNumber: string,
    rows: InsertCrossSellStagingSuggestion[],
    tenantId?: string | null
  ): Promise<void> {
    const tenantFilter = tenantFilterFor(crossSellStagingSuggestions.tenantId, tenantId);
    await db
      .delete(crossSellStagingSuggestions)
      .where(
        and(
          eq(crossSellStagingSuggestions.batchId, batchId),
          eq(crossSellStagingSuggestions.sourceProductNumber, sourceProductNumber),
          tenantFilter
        )
      );
    if (rows.length > 0) {
      await db.insert(crossSellStagingSuggestions).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async updateCrossSellStagingRule(
    id: string,
    updates: Partial<InsertCrossSellStagingRule>,
    tenantId?: string | null
  ): Promise<CrossSellStagingRule | undefined> {
    const tenantFilter = tenantFilterFor(crossSellStagingRules.tenantId, tenantId);
    const result = await db
      .update(crossSellStagingRules)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(crossSellStagingRules.id, id), tenantFilter))
      .returning();
    return result[0] ? mapStagingRule(result[0]) : undefined;
  }

  async updateCrossSellStagingSuggestion(
    id: string,
    updates: Partial<InsertCrossSellStagingSuggestion>,
    tenantId?: string | null
  ): Promise<CrossSellStagingSuggestion | undefined> {
    const tenantFilter = tenantFilterFor(crossSellStagingSuggestions.tenantId, tenantId);
    const result = await db
      .update(crossSellStagingSuggestions)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(crossSellStagingSuggestions.id, id), tenantFilter))
      .returning();
    return result[0] ? mapStagingSuggestion(result[0]) : undefined;
  }

  async replaceOfferLearningInsights(rows: InsertOfferLearningInsight[], tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(offerLearningInsights.tenantId, tenantId);
    await db.delete(offerLearningInsights).where(tenantFilter);
    if (rows.length > 0) {
      await db.insert(offerLearningInsights).values(
        rows.map((row) => ({
          ...row,
          tenantId: tenantId ?? null,
        }))
      );
    }
  }

  async getOfferLearningInsights(tenantId?: string | null): Promise<OfferLearningInsight[]> {
    const tenantFilter = tenantFilterFor(offerLearningInsights.tenantId, tenantId);
    const rows = await db
      .select()
      .from(offerLearningInsights)
      .where(tenantFilter)
      .orderBy(desc(offerLearningInsights.generatedAt));
    return rows.map((row) => ({
      ...row,
      description: row.description ?? undefined,
      data: (row.data as Record<string, any> | null | undefined) ?? undefined,
      generatedAt: toIsoString(row.generatedAt),
    }));
  }

  // Automation Rules
  async getAllAutomationRules(tenantId?: string | null): Promise<AutomationRule[]> {
    const tenantFilter = tenantFilterFor(automationRules.tenantId, tenantId);
    return await db
      .select()
      .from(automationRules)
      .where(tenantFilter)
      .orderBy(desc(automationRules.createdAt));
  }

  async getActiveAutomationRules(tenantId?: string | null): Promise<AutomationRule[]> {
    const tenantFilter = tenantFilterFor(automationRules.tenantId, tenantId);
    return await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.enabled, 1), tenantFilter))
      .orderBy(desc(automationRules.createdAt));
  }

  async getAutomationRule(id: string, tenantId?: string | null): Promise<AutomationRule | undefined> {
    const tenantFilter = tenantFilterFor(automationRules.tenantId, tenantId);
    const result = await db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createAutomationRule(insertRule: InsertAutomationRule, tenantId?: string | null): Promise<AutomationRule> {
    const result = await db
      .insert(automationRules)
      .values({
        ...insertRule,
        tenantId: tenantId ?? null,
        conditions: JSON.stringify(insertRule.conditions),
        actions: JSON.stringify(insertRule.actions),
      })
      .returning();
    return result[0];
  }

  async updateAutomationRule(id: string, updates: Partial<InsertAutomationRule>, tenantId?: string | null): Promise<AutomationRule | undefined> {
    const tenantFilter = tenantFilterFor(automationRules.tenantId, tenantId);
    const updateData: any = { ...updates, updatedAt: new Date() };
    
    // Handle JSON fields - allow null/empty values
    if ('conditions' in updates) {
      updateData.conditions = updates.conditions ? JSON.stringify(updates.conditions) : null;
    }
    if ('actions' in updates) {
      updateData.actions = updates.actions ? JSON.stringify(updates.actions) : null;
    }
    
    const result = await db
      .update(automationRules)
      .set(updateData)
      .where(and(eq(automationRules.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteAutomationRule(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(automationRules.tenantId, tenantId);
    const result = await db
      .delete(automationRules)
      .where(and(eq(automationRules.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  async incrementRuleExecutionCount(id: string, tenantId?: string | null): Promise<void> {
    const tenantFilter = tenantFilterFor(automationRules.tenantId, tenantId);
    await db
      .update(automationRules)
      .set({
        executionCount: drizzleSql`${automationRules.executionCount} + 1`,
        lastExecutedAt: new Date(),
      })
      .where(and(eq(automationRules.id, id), tenantFilter));
  }

  async createAutomationExecution(execution: InsertAutomationExecution, tenantId?: string | null): Promise<AutomationExecution> {
    const [result] = await db
      .insert(automationExecutions)
      .values({
        ...execution,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result;
  }

  async getAutomationExecutions(ruleId: string, limit: number = 50, tenantId?: string | null): Promise<AutomationExecution[]> {
    const tenantFilter = tenantFilterFor(automationExecutions.tenantId, tenantId);
    const executions = await db
      .select()
      .from(automationExecutions)
      .where(and(eq(automationExecutions.ruleId, ruleId), tenantFilter))
      .orderBy(desc(automationExecutions.executedAt))
      .limit(limit);
    return executions;
  }

  // Order Drafts (AI-powered order creation)
  async getAllOrderDrafts(tenantId?: string | null): Promise<OrderDraft[]> {
    const tenantFilter = tenantFilterFor(orderDrafts.tenantId, tenantId);
    return await db.select().from(orderDrafts).where(tenantFilter).orderBy(desc(orderDrafts.createdAt));
  }

  async getOrderDraft(id: string, tenantId?: string | null): Promise<OrderDraft | undefined> {
    const tenantFilter = tenantFilterFor(orderDrafts.tenantId, tenantId);
    const result = await db
      .select()
      .from(orderDrafts)
      .where(and(eq(orderDrafts.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createOrderDraft(draft: InsertOrderDraft, tenantId?: string | null): Promise<OrderDraft> {
    const result = await db
      .insert(orderDrafts)
      .values({
        ...(draft as typeof orderDrafts.$inferInsert),
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateOrderDraft(id: string, updates: Partial<InsertOrderDraft>, tenantId?: string | null): Promise<OrderDraft | undefined> {
    const tenantFilter = tenantFilterFor(orderDrafts.tenantId, tenantId);
    const result = await db
      .update(orderDrafts)
      .set({ ...(updates as Partial<typeof orderDrafts.$inferInsert>), updatedAt: new Date() })
      .where(and(eq(orderDrafts.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteOrderDraft(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(orderDrafts.tenantId, tenantId);
    const result = await db
      .delete(orderDrafts)
      .where(and(eq(orderDrafts.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }
  
  // Offer Drafts (AI-powered offer/quote creation)
  async getAllOfferDrafts(tenantId?: string | null): Promise<OfferDraft[]> {
    const tenantFilter = tenantFilterFor(offerDrafts.tenantId, tenantId);
    return await db.select().from(offerDrafts).where(tenantFilter).orderBy(desc(offerDrafts.createdAt));
  }

  async getOfferDraft(id: string, tenantId?: string | null): Promise<OfferDraft | undefined> {
    const tenantFilter = tenantFilterFor(offerDrafts.tenantId, tenantId);
    const result = await db
      .select()
      .from(offerDrafts)
      .where(and(eq(offerDrafts.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async getOfferDraftByShopwareOfferId(
    shopwareOfferId: string,
    tenantId?: string | null
  ): Promise<OfferDraft | undefined> {
    if (!shopwareOfferId?.trim()) return undefined;
    const tenantFilter = tenantFilterFor(offerDrafts.tenantId, tenantId);
    const result = await db
      .select()
      .from(offerDrafts)
      .where(and(eq(offerDrafts.shopwareOfferId, shopwareOfferId.trim()), tenantFilter))
      .orderBy(desc(offerDrafts.updatedAt))
      .limit(1);
    return result[0];
  }

  async createOfferDraft(draft: InsertOfferDraft, tenantId?: string | null): Promise<OfferDraft> {
    const result = await db
      .insert(offerDrafts)
      .values({
        ...(draft as typeof offerDrafts.$inferInsert),
        tenantId: tenantId ?? null,
      })
      .returning();
    return result[0];
  }

  async updateOfferDraft(id: string, updates: Partial<InsertOfferDraft>, tenantId?: string | null): Promise<OfferDraft | undefined> {
    const tenantFilter = tenantFilterFor(offerDrafts.tenantId, tenantId);
    const result = await db
      .update(offerDrafts)
      .set({ ...(updates as Partial<typeof offerDrafts.$inferInsert>), updatedAt: new Date() })
      .where(and(eq(offerDrafts.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteOfferDraft(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(offerDrafts.tenantId, tenantId);
    const result = await db
      .delete(offerDrafts)
      .where(and(eq(offerDrafts.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  async createCommercialAgentExemplar(
    row: InsertCommercialAgentExemplar,
    tenantId?: string | null
  ): Promise<CommercialAgentExemplar> {
    const resolvedTenant = row.tenantId ?? resolveTenantId(tenantId);
    const [created] = await db
      .insert(commercialAgentExemplars)
      .values({
        tenantId: resolvedTenant ?? null,
        sourceKind: row.sourceKind,
        intentLabel: row.intentLabel,
        subjectExcerpt: row.subjectExcerpt ?? null,
        emailExcerpt: row.emailExcerpt ?? null,
        pdfExcerpt: row.pdfExcerpt ?? null,
        signalsJson:
          row.signalsJson != null && typeof row.signalsJson === "object" && !Array.isArray(row.signalsJson)
            ? (row.signalsJson as Record<string, unknown>)
            : null,
        qualityScore: row.qualityScore ?? 1,
        draftKind: row.draftKind ?? null,
        referenceDraftId: row.referenceDraftId ?? null,
      })
      .returning();

    const tenantFilter = tenantFilterFor(commercialAgentExemplars.tenantId, resolvedTenant);
    const [cntRow] = await db
      .select({ n: count() })
      .from(commercialAgentExemplars)
      .where(tenantFilter);
    const n = Number(cntRow?.n ?? 0);
    if (n > 250) {
      const toDrop = n - 250;
      const olds = await db
        .select({ id: commercialAgentExemplars.id })
        .from(commercialAgentExemplars)
        .where(tenantFilter)
        .orderBy(asc(commercialAgentExemplars.createdAt))
        .limit(toDrop);
      const ids = olds.map((o) => o.id);
      if (ids.length) {
        await db.delete(commercialAgentExemplars).where(inArray(commercialAgentExemplars.id, ids));
      }
    }

    return created as CommercialAgentExemplar;
  }

  async getCommercialAgentExemplarsForPrompt(
    tenantId: string,
    limit: number
  ): Promise<CommercialAgentExemplar[]> {
    const tenantFilter = tenantFilterFor(commercialAgentExemplars.tenantId, tenantId);
    const lim = Math.max(1, Math.min(12, limit));
    return db
      .select()
      .from(commercialAgentExemplars)
      .where(tenantFilter)
      .orderBy(desc(commercialAgentExemplars.qualityScore), desc(commercialAgentExemplars.createdAt))
      .limit(lim);
  }

  async countCommercialAgentExemplars(tenantId?: string | null): Promise<number> {
    const tenantFilter = tenantFilterFor(commercialAgentExemplars.tenantId, tenantId);
    const [r] = await db.select({ n: count() }).from(commercialAgentExemplars).where(tenantFilter);
    return Number(r?.n ?? 0);
  }

  async createCommercialProductMatchFeedback(
    rows: InsertCommercialProductMatchFeedback[],
    tenantId?: string | null
  ): Promise<number> {
    if (!rows?.length) return 0;
    const resolvedTenant = resolveTenantId(tenantId);
    const values = rows
      .filter((r) => r?.lineKey?.trim() && r?.outcome?.trim())
      .map((r) => ({
        tenantId: r.tenantId ?? resolvedTenant ?? null,
        draftKind: r.draftKind,
        outcome: r.outcome,
        lineKey: r.lineKey,
        sourceLine: r.sourceLine ?? null,
        sourceIdentifier: r.sourceIdentifier ?? null,
        selectedProductId: r.selectedProductId ?? null,
        selectedIdentifier: r.selectedIdentifier ?? null,
        selectedStrategy: r.selectedStrategy ?? null,
        createdByUserId: r.createdByUserId ?? null,
      }));
    if (!values.length) return 0;
    const inserted = await db.insert(commercialProductMatchFeedback).values(values).returning({
      id: commercialProductMatchFeedback.id,
    });
    return inserted.length;
  }

  async getCommercialProductMatchFeedbackByLineKeys(
    lineKeys: string[],
    tenantId?: string | null,
    limit: number = 300
  ): Promise<CommercialProductMatchFeedback[]> {
    const uniqKeys = Array.from(new Set((lineKeys ?? []).map((k) => k.trim()).filter(Boolean))).slice(0, 200);
    if (!uniqKeys.length) return [];
    const tenantFilter = tenantFilterFor(commercialProductMatchFeedback.tenantId, tenantId);
    const maxRows = Math.max(1, Math.min(2000, limit));
    return db
      .select()
      .from(commercialProductMatchFeedback)
      .where(and(tenantFilter, inArray(commercialProductMatchFeedback.lineKey, uniqKeys)))
      .orderBy(desc(commercialProductMatchFeedback.createdAt))
      .limit(maxRows);
  }

  // Bundles
  async getAllBundles(tenantId?: string | null): Promise<BundleWithItems[]> {
    const tenantFilter = tenantFilterFor(bundles.tenantId, tenantId);
    const bundleRows = await db.select().from(bundles).where(tenantFilter).orderBy(desc(bundles.updatedAt));
    if (bundleRows.length === 0) return [];
    
    const bundleIds = bundleRows.map((bundle) => bundle.id);
    const itemTenantFilter = tenantFilterFor(bundleItems.tenantId, tenantId);
    const itemRows = await db
      .select()
      .from(bundleItems)
      .where(and(itemTenantFilter, inArray(bundleItems.bundleId, bundleIds)))
      .orderBy(bundleItems.sortOrder);
    
    const itemsByBundleId = new Map<string, BundleItem[]>();
    itemRows.forEach((item) => {
      const list = itemsByBundleId.get(item.bundleId) ?? [];
      list.push(item);
      itemsByBundleId.set(item.bundleId, list);
    });
    
    return bundleRows.map((bundle) => ({
      ...bundle,
      items: itemsByBundleId.get(bundle.id) ?? [],
    }));
  }

  async getBundle(id: string, tenantId?: string | null): Promise<BundleWithItems | undefined> {
    const tenantFilter = tenantFilterFor(bundles.tenantId, tenantId);
    const bundleResult = await db
      .select()
      .from(bundles)
      .where(and(eq(bundles.id, id), tenantFilter))
      .limit(1);
    const bundle = bundleResult[0];
    if (!bundle) return undefined;
    
    const itemTenantFilter = tenantFilterFor(bundleItems.tenantId, tenantId);
    const items = await db
      .select()
      .from(bundleItems)
      .where(and(eq(bundleItems.bundleId, id), itemTenantFilter))
      .orderBy(bundleItems.sortOrder);
    
    return {
      ...bundle,
      items,
    };
  }

  async getBundleByMockNumber(mockProductNumber: string, tenantId?: string | null): Promise<Bundle | undefined> {
    const tenantFilter = tenantFilterFor(bundles.tenantId, tenantId);
    const result = await db
      .select()
      .from(bundles)
      .where(and(eq(bundles.mockProductNumber, mockProductNumber), tenantFilter))
      .limit(1);
    return result[0];
  }

  async createBundle(bundle: InsertBundle, items: BundleItemInput[], tenantId?: string | null): Promise<BundleWithItems> {
    const [created] = await db
      .insert(bundles)
      .values({
        ...bundle,
        tenantId: tenantId ?? null,
      })
      .returning();
    
    const itemsToInsert = items.map((item) => ({
      ...item,
      bundleId: created.id,
      tenantId: tenantId ?? null,
    }));
    
    const createdItems = itemsToInsert.length > 0
      ? await db.insert(bundleItems).values(itemsToInsert).returning()
      : [];
    
    return {
      ...created,
      items: createdItems,
    };
  }

  async updateBundle(
    id: string,
    updates: Partial<InsertBundle>,
    items: BundleItemInput[] | undefined,
    tenantId?: string | null
  ): Promise<BundleWithItems | undefined> {
    const tenantFilter = tenantFilterFor(bundles.tenantId, tenantId);
    const result = await db
      .update(bundles)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(bundles.id, id), tenantFilter))
      .returning();
    const updated = result[0];
    if (!updated) return undefined;
    
    let updatedItems: BundleItem[] = [];
    if (items) {
      const itemTenantFilter = tenantFilterFor(bundleItems.tenantId, tenantId);
      await db
        .delete(bundleItems)
        .where(and(eq(bundleItems.bundleId, id), itemTenantFilter));
      
      if (items.length > 0) {
        const itemsToInsert = items.map((item) => ({
          ...item,
          bundleId: id,
          tenantId: tenantId ?? null,
        }));
        updatedItems = await db.insert(bundleItems).values(itemsToInsert).returning();
      }
    } else {
      const itemTenantFilter = tenantFilterFor(bundleItems.tenantId, tenantId);
      updatedItems = await db
        .select()
        .from(bundleItems)
        .where(and(eq(bundleItems.bundleId, id), itemTenantFilter))
        .orderBy(bundleItems.sortOrder);
    }
    
    return {
      ...updated,
      items: updatedItems,
    };
  }

  async deleteBundle(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(bundles.tenantId, tenantId);
    const result = await db
      .delete(bundles)
      .where(and(eq(bundles.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  // ERP Automation Runs (tracking automated actions triggered by CustomFields)
  async getAllErpAutomationRuns(limit: number = 100, offset: number = 0, tenantId?: string | null): Promise<ErpAutomationRun[]> {
    const tenantFilter = tenantFilterFor(erpAutomationRuns.tenantId, tenantId);
    return await db
      .select()
      .from(erpAutomationRuns)
      .where(tenantFilter)
      .orderBy(desc(erpAutomationRuns.executedAt))
      .limit(limit)
      .offset(offset);
  }

  async getErpAutomationRunsByOrderId(orderId: string, tenantId?: string | null): Promise<ErpAutomationRun[]> {
    const tenantFilter = tenantFilterFor(erpAutomationRuns.tenantId, tenantId);
    return await db
      .select()
      .from(erpAutomationRuns)
      .where(and(eq(erpAutomationRuns.orderId, orderId), tenantFilter))
      .orderBy(desc(erpAutomationRuns.executedAt));
  }

  async createErpAutomationRun(run: InsertErpAutomationRun, tenantId?: string | null): Promise<ErpAutomationRun> {
    const [result] = await db
      .insert(erpAutomationRuns)
      .values({
        ...(run as typeof erpAutomationRuns.$inferInsert),
        tenantId: tenantId ?? null,
      })
      .returning();
    return result;
  }

  async getLatestAutomationRun(orderId: string, trigger: string, tenantId?: string | null): Promise<ErpAutomationRun | undefined> {
    const tenantFilter = tenantFilterFor(erpAutomationRuns.tenantId, tenantId);
    const result = await db
      .select()
      .from(erpAutomationRuns)
      .where(
        and(
          eq(erpAutomationRuns.orderId, orderId),
          eq(erpAutomationRuns.trigger, trigger),
          tenantFilter
        )
      )
      .orderBy(desc(erpAutomationRuns.executedAt))
      .limit(1);
    return result[0];
  }

  private async generateTicketNumber(): Promise<string> {
    const result = await db.execute(drizzleSql`
      SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 3) AS INTEGER)), 999) + 1 AS next_number
      FROM tickets
      WHERE ticket_number LIKE 'T-%'
    `);
    
    const nextNumber = (result.rows[0] as any).next_number || 1000;
    return `T-${nextNumber}`;
  }

  async getAllShippingCarriers(tenantId?: string | null): Promise<ShippingCarrier[]> {
    const tenantFilter = tenantFilterFor(shippingCarriers.tenantId, tenantId);
    return await db
      .select()
      .from(shippingCarriers)
      .where(tenantFilter)
      .orderBy(shippingCarriers.name);
  }

  async createShippingCarrier(carrier: InsertShippingCarrier, tenantId?: string | null): Promise<ShippingCarrier> {
    const [result] = await db
      .insert(shippingCarriers)
      .values({
        ...carrier,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result;
  }

  async deleteShippingCarrier(id: number, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(shippingCarriers.tenantId, tenantId);
    const result = await db
      .delete(shippingCarriers)
      .where(and(eq(shippingCarriers.id, id), tenantFilter));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Webhook Configuration
  async getAllWebhookConfigs(tenantId?: string | null): Promise<WebhookConfig[]> {
    const tenantFilter = tenantFilterFor(webhookConfigs.tenantId, tenantId);
    return await db.select().from(webhookConfigs).where(tenantFilter);
  }

  async getWebhookConfig(eventType: WebhookEventType, tenantId?: string | null): Promise<WebhookConfig | undefined> {
    const tenantFilter = tenantFilterFor(webhookConfigs.tenantId, tenantId);
    const result = await db
      .select()
      .from(webhookConfigs)
      .where(and(eq(webhookConfigs.eventType, eventType), tenantFilter))
      .limit(1);
    return result[0];
  }

  async upsertWebhookConfig(config: InsertWebhookConfig, tenantId?: string | null): Promise<WebhookConfig> {
    const result = await db
      .insert(webhookConfigs)
      .values({
        ...config,
        tenantId: tenantId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [webhookConfigs.tenantId, webhookConfigs.eventType],
        set: {
          ...config,
          tenantId: tenantId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  }

  async updateWebhookConfig(eventType: WebhookEventType, updates: Partial<InsertWebhookConfig>, tenantId?: string | null): Promise<WebhookConfig | undefined> {
    const tenantFilter = tenantFilterFor(webhookConfigs.tenantId, tenantId);
    const result = await db
      .update(webhookConfigs)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(webhookConfigs.eventType, eventType), tenantFilter))
      .returning();
    return result[0];
  }

  // Webhook Logs
  async createWebhookLog(log: InsertWebhookLog, tenantId?: string | null): Promise<WebhookLog> {
    const [result] = await db
      .insert(webhookLogs)
      .values({
        ...log,
        tenantId: tenantId ?? null,
      })
      .returning();
    return result;
  }

  async getWebhookLogs(filters?: { eventType?: string; status?: string; limit?: number; offset?: number }, tenantId?: string | null): Promise<{ logs: WebhookLog[]; total: number }> {
    const { eventType, status, limit = 100, offset = 0 } = filters || {};
    const tenantFilter = tenantFilterFor(webhookLogs.tenantId, tenantId);
    const baseQuery = db.select().from(webhookLogs);
    const baseCountQuery = db.select({ count: sql<number>`count(*)::int` }).from(webhookLogs);

    const conditions = [tenantFilter];
    if (eventType) conditions.push(eq(webhookLogs.eventType, eventType));
    if (status) conditions.push(eq(webhookLogs.status, status));

    const whereClause = and(...conditions);
    const query = baseQuery.where(whereClause);
    const countQuery = baseCountQuery.where(whereClause);
    
    const [logs, countResult] = await Promise.all([
      query.orderBy(desc(webhookLogs.executedAt)).limit(limit).offset(offset),
      countQuery
    ]);

    return {
      logs,
      total: countResult[0]?.count || 0
    };
  }

  async getWebhookLogsByRequestId(requestId: string, tenantId?: string | null): Promise<WebhookLog[]> {
    const tenantFilter = tenantFilterFor(webhookLogs.tenantId, tenantId);
    return await db
      .select()
      .from(webhookLogs)
      .where(and(eq(webhookLogs.requestId, requestId), tenantFilter))
      .orderBy(webhookLogs.attempt);
  }

  async cleanupOldWebhookLogs(retentionDays: number, tenantId?: string | null): Promise<number> {
    const tenantFilter = tenantFilterFor(webhookLogs.tenantId, tenantId);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const result = await db
      .delete(webhookLogs)
      .where(and(lte(webhookLogs.executedAt, cutoffDate), tenantFilter));
    
    return result.rowCount || 0;
  }

  // Semantic Documents
  async upsertSemanticDocuments(rows: InsertSemanticDocument[], tenantId?: string | null): Promise<void> {
    if (rows.length === 0) return;
    const resolvedTenantId = resolveTenantId(tenantId);
    const rowsWithTenant = rows.map((row) => ({
      ...row,
      tenantId: row.tenantId ?? resolvedTenantId ?? null,
      updatedAt: new Date(),
    }));

    await db
      .insert(semanticDocuments)
      .values(rowsWithTenant)
      .onConflictDoUpdate({
        target: [
          semanticDocuments.tenantId,
          semanticDocuments.sourceType,
          semanticDocuments.sourceId,
        ],
        set: {
          title: sql`excluded.title`,
          content: sql`excluded.content`,
          metadata: sql`excluded.metadata`,
          embedding: sql`excluded.embedding`,
          embeddingProvider: sql`excluded.embedding_provider`,
          embeddingModel: sql`excluded.embedding_model`,
          contentHash: sql`excluded.content_hash`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async deleteSemanticDocumentsBySourceTypes(
    sourceTypes: string[],
    tenantId?: string | null
  ): Promise<number> {
    if (sourceTypes.length === 0) return 0;
    const tenantFilter = tenantFilterFor(semanticDocuments.tenantId, tenantId);
    const result = await db
      .delete(semanticDocuments)
      .where(and(tenantFilter, inArray(semanticDocuments.sourceType, sourceTypes)));
    return result.rowCount || 0;
  }

  async getSemanticDocumentEmbedding(
    sourceType: string,
    sourceId: string,
    tenantId?: string | null
  ): Promise<number[] | null> {
    const tenantFilter = tenantFilterFor(semanticDocuments.tenantId, tenantId);
    const result = await db
      .select({ embedding: semanticDocuments.embedding })
      .from(semanticDocuments)
      .where(and(tenantFilter, eq(semanticDocuments.sourceType, sourceType), eq(semanticDocuments.sourceId, sourceId)))
      .limit(1);
    return (result[0]?.embedding as number[] | undefined) ?? null;
  }

  async searchSemanticDocuments(
    queryEmbedding: number[],
    options: { limit: number; sourceTypes?: string[]; query?: string },
    tenantId?: string | null
  ): Promise<Array<SemanticDocument & { distance: number; textRank: number }>> {
    const requestedLimit = Number(options.limit) || 10;
    const fetchLimit = Math.max(requestedLimit * 3, 20);
    const tenantFilter = tenantFilterFor(semanticDocuments.tenantId, tenantId);
    const filters = [tenantFilter];
    if (options.sourceTypes?.length) {
      filters.push(inArray(semanticDocuments.sourceType, options.sourceTypes));
    }

    const whereSql = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;
    const vectorSql = sql`${vectorLiteral}::vector`;
    const textQuery = options.query?.trim();
    const textRankSql = textQuery
      ? sql`ts_rank_cd(to_tsvector('simple', ${semanticDocuments.content}), websearch_to_tsquery('simple', ${textQuery}))`
      : sql`0`;

    const result = await db.execute(
      sql`
        SELECT
          ${semanticDocuments.id} AS id,
          ${semanticDocuments.tenantId} AS tenant_id,
          ${semanticDocuments.sourceType} AS source_type,
          ${semanticDocuments.sourceId} AS source_id,
          ${semanticDocuments.title} AS title,
          ${semanticDocuments.content} AS content,
          ${semanticDocuments.metadata} AS metadata,
          ${semanticDocuments.embedding} AS embedding,
          ${semanticDocuments.embeddingProvider} AS embedding_provider,
          ${semanticDocuments.embeddingModel} AS embedding_model,
          ${semanticDocuments.contentHash} AS content_hash,
          ${semanticDocuments.createdAt} AS created_at,
          ${semanticDocuments.updatedAt} AS updated_at,
          (${semanticDocuments.embedding} <=> ${vectorSql}) AS distance,
          ${textRankSql} AS text_rank
        FROM ${semanticDocuments}
        ${whereSql}
        ORDER BY distance ASC, text_rank DESC
        LIMIT ${fetchLimit}
      `
    );

    const rows = Array.isArray(result) ? result : result.rows;
    const rankingSettings = (await this.getSetting("semantic_ranking", tenantId)) || {};
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const normalizeNumber = (value: any, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const vectorWeight = clamp(normalizeNumber(rankingSettings.vectorWeight, 0.65), 0, 1);
    const textWeight = clamp(normalizeNumber(rankingSettings.textWeight, 0.25), 0, 1);
    const metadataWeight = clamp(normalizeNumber(rankingSettings.metadataWeight, 0.1), 0, 1);
    const feedbackWeight = clamp(normalizeNumber(rankingSettings.feedbackWeight, 0.12), 0, 1);
    const weightSum = vectorWeight + textWeight + metadataWeight + feedbackWeight || 1;
    const normalizedWeights = {
      vector: vectorWeight / weightSum,
      text: textWeight / weightSum,
      metadata: metadataWeight / weightSum,
      feedback: feedbackWeight / weightSum,
    };
    const metadataExactBoost = clamp(normalizeNumber(rankingSettings.metadataExactBoost, 0.15), 0, 1);
    const metadataPartialBoost = clamp(normalizeNumber(rankingSettings.metadataPartialBoost, 0.08), 0, 1);
    const titleTokenBoost = clamp(normalizeNumber(rankingSettings.titleTokenBoost, 0.06), 0, 1);
    const queryTokens =
      textQuery?.toLowerCase().match(/[A-Za-z0-9ÄÖÜäöüß]+/g)?.filter(Boolean) || [];

    const normalizeQuery = (value: string) => value.trim().toLowerCase();
    const normalizedQuery = textQuery ? normalizeQuery(textQuery) : "";
    const feedbackEntries = normalizedQuery
      ? (await this.getSetting("semantic_search_feedback", tenantId)) || []
      : [];
    const feedbackCounts = new Map<string, number>();
    if (Array.isArray(feedbackEntries) && normalizedQuery) {
      feedbackEntries.forEach((entry: any) => {
        if (!entry || typeof entry.query !== "string") return;
        if (normalizeQuery(entry.query) !== normalizedQuery) return;
        const sourceType = entry.sourceType;
        const sourceId = entry.sourceId;
        if (!sourceType || !sourceId) return;
        const key = `${sourceType}:${sourceId}`;
        feedbackCounts.set(key, (feedbackCounts.get(key) || 0) + 1);
      });
    }
    let maxFeedbackCount = 0;
    feedbackCounts.forEach((count) => {
      if (count > maxFeedbackCount) maxFeedbackCount = count;
    });

    const normalizeTextRank = (rank: number) => (rank > 0 ? rank / (rank + 1) : 0);
    const collectMetadataFields = (metadata: any): string[] => {
      if (!metadata || typeof metadata !== "object") return [];
      const fields: Array<string | string[] | undefined | null> = [
        metadata.productNumber,
        metadata.manufacturerNumber,
        metadata.ean,
        metadata.offerNumber,
        metadata.ticketNumber,
        metadata.customerName,
        metadata.customerEmail,
        metadata.categories,
      ];
      return fields
        .flat()
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
    };
    const getMetadataBoost = (entry: any) => {
      if (queryTokens.length === 0) return 0;
      const metadataFields = collectMetadataFields(entry.metadata);
      const title = String(entry.title || "").toLowerCase();
      let boost = 0;
      queryTokens.forEach((token) => {
        if (!token) return;
        if (metadataFields.some((field) => field === token)) {
          boost = Math.max(boost, metadataExactBoost);
          return;
        }
        if (metadataFields.some((field) => field.includes(token))) {
          boost = Math.max(boost, metadataPartialBoost);
        }
        if (title.includes(token)) {
          boost = Math.max(boost, titleTokenBoost);
        }
      });
      return boost;
    };
    const getFeedbackScore = (entry: any) => {
      if (!maxFeedbackCount) return 0;
      const key = `${entry.source_type}:${entry.source_id}`;
      const count = feedbackCounts.get(key) || 0;
      return count / maxFeedbackCount;
    };

    const mapped = rows.map((row: any) => {
      const distance = Number(row.distance ?? 0);
      const textRank = Number(row.text_rank ?? 0);
      const vectorScore = Math.max(0, 1 - distance);
      const textScore = normalizeTextRank(textRank);
      const metadataBoost = getMetadataBoost(row);
      const feedbackScore = getFeedbackScore(row);
      const hybridScore =
        vectorScore * normalizedWeights.vector +
        textScore * normalizedWeights.text +
        metadataBoost * normalizedWeights.metadata +
        feedbackScore * normalizedWeights.feedback;
      return {
        id: row.id,
        tenantId: row.tenant_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        title: row.title,
        content: row.content,
        metadata: row.metadata,
        embedding: row.embedding,
        embeddingProvider: row.embedding_provider,
        embeddingModel: row.embedding_model,
        contentHash: row.content_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        distance,
        textRank,
        hybridScore,
      };
    });

    const sorted = queryTokens.length
      ? mapped.sort((a: any, b: any) => b.hybridScore - a.hybridScore || a.distance - b.distance)
      : mapped.sort((a: any, b: any) => a.distance - b.distance);

    return sorted.slice(0, requestedLimit);
  }

  async createInstallmentPlanWithInvoices(
    plan: InsertInstallmentPlan,
    invoiceRows: Array<Omit<InsertInstallmentInvoice, "installmentPlanId" | "tenantId">>,
    tenantId?: string | null
  ): Promise<{ plan: InstallmentPlan; invoices: InstallmentInvoice[] }> {
    const tid = resolveTenantId(tenantId);
    return db.transaction(async (tx) => {
      const [planRow] = await tx
        .insert(installmentPlans)
        .values({
          ...plan,
          tenantId: tid ?? null,
        })
        .returning();
      if (!planRow) {
        throw new Error("Failed to create installment plan");
      }
      if (invoiceRows.length === 0) {
        return { plan: planRow, invoices: [] };
      }
      const invValues = invoiceRows.map((row) => ({
        ...row,
        tenantId: tid ?? null,
        installmentPlanId: planRow.id,
      }));
      const invoices = await tx.insert(installmentInvoices).values(invValues).returning();
      return { plan: planRow, invoices };
    });
  }

  async getInstallmentPlan(id: string, tenantId?: string | null): Promise<InstallmentPlan | undefined> {
    const tenantFilter = tenantFilterFor(installmentPlans.tenantId, tenantId);
    const result = await db
      .select()
      .from(installmentPlans)
      .where(and(eq(installmentPlans.id, id), tenantFilter))
      .limit(1);
    return result[0];
  }

  async getInstallmentPlansByOrder(orderId: string, tenantId?: string | null): Promise<InstallmentPlan[]> {
    const tenantFilter = tenantFilterFor(installmentPlans.tenantId, tenantId);
    return db
      .select()
      .from(installmentPlans)
      .where(and(eq(installmentPlans.orderId, orderId), tenantFilter))
      .orderBy(desc(installmentPlans.createdAt));
  }

  async updateInstallmentPlan(
    id: string,
    updates: Partial<InsertInstallmentPlan>,
    tenantId?: string | null
  ): Promise<InstallmentPlan | undefined> {
    const tenantFilter = tenantFilterFor(installmentPlans.tenantId, tenantId);
    const result = await db
      .update(installmentPlans)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(installmentPlans.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async deleteInstallmentPlan(id: string, tenantId?: string | null): Promise<boolean> {
    const tenantFilter = tenantFilterFor(installmentPlans.tenantId, tenantId);
    const result = await db
      .delete(installmentPlans)
      .where(and(eq(installmentPlans.id, id), tenantFilter))
      .returning();
    return result.length > 0;
  }

  async getInstallmentInvoices(planId: string, tenantId?: string | null): Promise<InstallmentInvoice[]> {
    const tenantFilter = tenantFilterFor(installmentInvoices.tenantId, tenantId);
    return db
      .select()
      .from(installmentInvoices)
      .where(and(eq(installmentInvoices.installmentPlanId, planId), tenantFilter))
      .orderBy(installmentInvoices.sequenceNumber);
  }

  async updateInstallmentInvoice(
    id: string,
    updates: Partial<InsertInstallmentInvoice>,
    tenantId?: string | null
  ): Promise<InstallmentInvoice | undefined> {
    const tenantFilter = tenantFilterFor(installmentInvoices.tenantId, tenantId);
    const result = await db
      .update(installmentInvoices)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(installmentInvoices.id, id), tenantFilter))
      .returning();
    return result[0];
  }

  async createOfferPublicLink(
    row: Omit<InsertOfferPublicLink, "id" | "createdAt">,
    tenantId?: string | null
  ): Promise<OfferPublicLink> {
    const tid = resolveTenantId(tenantId);
    const tenantCol = offerPublicLinks.tenantId;
    const offerCol = offerPublicLinks.shopwareOfferId;
    const revokedCol = offerPublicLinks.revokedAt;
    return db.transaction(async (tx) => {
      const revokeCond = and(
        eq(offerCol, row.shopwareOfferId),
        tid ? eq(tenantCol, tid) : isNull(tenantCol),
        isNull(revokedCol),
      );
      await tx.update(offerPublicLinks).set({ revokedAt: new Date() }).where(revokeCond);
      const [created] = await tx
        .insert(offerPublicLinks)
        .values({
          ...row,
          tenantId: tid ?? null,
        })
        .returning();
      if (!created) throw new Error("Failed to create offer public link");
      return created;
    });
  }

  async revokeOfferPublicLinksForOffer(shopwareOfferId: string, tenantId?: string | null): Promise<void> {
    const tid = resolveTenantId(tenantId);
    const tenantCol = offerPublicLinks.tenantId;
    await db
      .update(offerPublicLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(offerPublicLinks.shopwareOfferId, shopwareOfferId),
          tid ? eq(tenantCol, tid) : isNull(tenantCol),
          isNull(offerPublicLinks.revokedAt),
        ),
      );
  }

  async getOfferPublicLinkByTokenHash(tokenHash: string): Promise<OfferPublicLink | undefined> {
    const result = await db
      .select()
      .from(offerPublicLinks)
      .where(eq(offerPublicLinks.tokenHash, tokenHash))
      .limit(1);
    return result[0];
  }

  async getActiveOfferPublicLinkForOffer(
    shopwareOfferId: string,
    tenantId?: string | null
  ): Promise<OfferPublicLink | undefined> {
    const tid = resolveTenantId(tenantId);
    const tenantCol = offerPublicLinks.tenantId;
    const result = await db
      .select()
      .from(offerPublicLinks)
      .where(
        and(
          eq(offerPublicLinks.shopwareOfferId, shopwareOfferId),
          tid ? eq(tenantCol, tid) : isNull(tenantCol),
          isNull(offerPublicLinks.revokedAt),
          gt(offerPublicLinks.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(offerPublicLinks.createdAt))
      .limit(1);
    return result[0];
  }

  async touchOfferPublicLinkAccess(linkId: string): Promise<void> {
    await db
      .update(offerPublicLinks)
      .set({ lastAccessAt: new Date() })
      .where(eq(offerPublicLinks.id, linkId));
  }

  async createOfferPublicEvent(
    row: Omit<InsertOfferPublicEvent, "id" | "createdAt">,
    _tenantId?: string | null
  ): Promise<OfferPublicEvent> {
    const [ev] = await db.insert(offerPublicEvents).values(row).returning();
    if (!ev) throw new Error("Failed to create offer public event");
    return ev;
  }

  async createB2bApprovalLog(
    row: Omit<InsertB2bApprovalLog, "id" | "createdAt">,
    tenantId?: string | null
  ): Promise<B2bApprovalLog> {
    const [log] = await db
      .insert(b2bApprovalLog)
      .values({ ...row, tenantId: tenantId ?? row.tenantId ?? null })
      .returning();
    if (!log) throw new Error("Failed to create B2B approval log");
    return log;
  }

  async listB2bApprovalLogs(
    tenantId?: string | null,
    options?: { limit?: number }
  ): Promise<B2bApprovalLog[]> {
    const tid = tenantId ?? null;
    const limit = options?.limit ?? 50;
    const tenantFilter = tenantFilterFor(b2bApprovalLog.tenantId, tid);
    return await db
      .select()
      .from(b2bApprovalLog)
      .where(tenantFilter)
      .orderBy(desc(b2bApprovalLog.createdAt))
      .limit(limit);
  }
}
