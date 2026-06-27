/**
 * CPQ Storage - database operations for CPQ module
 */

import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  cpqSystems,
  cpqComponentTypes,
  cpqProductMapping,
  cpqGeometry,
  cpqRules,
  cpqRuleVersions,
  cpqConfigurations,
  cpqReviewAudit,
  cpqDiscountLevels,
  cpqDiscountLevelRules,
  cpqQuoteLog,
  type CpqSystem,
  type InsertCpqSystem,
  type CpqComponentType,
  type InsertCpqComponentType,
  type CpqProductMapping,
  type InsertCpqProductMapping,
  type CpqGeometry,
  type InsertCpqGeometry,
  type CpqRule,
  type InsertCpqRule,
  type CpqRuleVersion,
  type InsertCpqRuleVersion,
  type CpqConfiguration,
  type InsertCpqConfiguration,
  type CpqReviewAudit,
  type CpqReviewQueueStatus,
  type InsertCpqReviewAudit,
  type CpqDiscountLevel,
  type InsertCpqDiscountLevel,
  type CpqDiscountLevelRule,
  type InsertCpqDiscountLevelRule,
  type CpqQuoteLog,
  type InsertCpqQuoteLog,
} from "@shared/schema";

export const cpqStorage = {
  // Systems
  async getSystems(tenantId?: string | null): Promise<CpqSystem[]> {
    const filter = tenantId
      ? and(eq(cpqSystems.tenantId, tenantId), eq(cpqSystems.status, "active"))
      : eq(cpqSystems.status, "active");
    return db.select().from(cpqSystems).where(filter);
  },

  async getSystem(id: string, tenantId?: string | null): Promise<CpqSystem | undefined> {
    const filter = tenantId ? and(eq(cpqSystems.id, id), eq(cpqSystems.tenantId, tenantId)) : eq(cpqSystems.id, id);
    const rows = await db.select().from(cpqSystems).where(filter).limit(1);
    return rows[0];
  },

  async createSystem(data: Omit<InsertCpqSystem, "id">, tenantId?: string | null): Promise<CpqSystem> {
    const [row] = await db.insert(cpqSystems).values({ ...data, tenantId: tenantId || null }).returning();
    return row;
  },

  async updateSystem(id: string, data: Partial<InsertCpqSystem>): Promise<CpqSystem | undefined> {
    const [row] = await db.update(cpqSystems).set(data).where(eq(cpqSystems.id, id)).returning();
    return row;
  },

  // Component Types
  async getComponentTypesBySystem(systemId: string): Promise<CpqComponentType[]> {
    return db.select().from(cpqComponentTypes).where(eq(cpqComponentTypes.systemId, systemId)).orderBy(cpqComponentTypes.sortOrder);
  },

  async createComponentType(data: Omit<InsertCpqComponentType, "id">): Promise<CpqComponentType> {
    const [row] = await db.insert(cpqComponentTypes).values(data).returning();
    return row;
  },

  // Product Mapping
  async getProductMappingsBySystem(systemId: string, tenantId?: string | null): Promise<CpqProductMapping[]> {
    const filter = tenantId ? and(eq(cpqProductMapping.systemId, systemId), eq(cpqProductMapping.tenantId, tenantId)) : eq(cpqProductMapping.systemId, systemId);
    return db.select().from(cpqProductMapping).where(filter);
  },

  async getProductMappingByProductId(shopwareProductId: string, tenantId?: string | null): Promise<CpqProductMapping | undefined> {
    const filter = tenantId ? and(eq(cpqProductMapping.shopwareProductId, shopwareProductId), eq(cpqProductMapping.tenantId, tenantId)) : eq(cpqProductMapping.shopwareProductId, shopwareProductId);
    const rows = await db.select().from(cpqProductMapping).where(filter).limit(1);
    return rows[0];
  },

  async createProductMapping(data: Omit<InsertCpqProductMapping, "id">, tenantId?: string | null): Promise<CpqProductMapping> {
    const [row] = await db.insert(cpqProductMapping).values({ ...data, tenantId: tenantId || null }).returning();
    return row;
  },

  // Geometry
  async getGeometryByProductMapping(productMappingId: string): Promise<CpqGeometry | undefined> {
    const rows = await db.select().from(cpqGeometry).where(eq(cpqGeometry.productMappingId, productMappingId)).limit(1);
    return rows[0];
  },

  async getGeometry(id: string): Promise<CpqGeometry | undefined> {
    const rows = await db.select().from(cpqGeometry).where(eq(cpqGeometry.id, id)).limit(1);
    return rows[0];
  },

  async createGeometry(data: Omit<InsertCpqGeometry, "id">): Promise<CpqGeometry> {
    const [row] = await db.insert(cpqGeometry).values(data).returning();
    return row;
  },

  async updateGeometry(id: string, data: Partial<InsertCpqGeometry>): Promise<CpqGeometry | undefined> {
    const [row] = await db.update(cpqGeometry).set(data).where(eq(cpqGeometry.id, id)).returning();
    return row;
  },

  async upsertGeometryByProductMapping(
    productMappingId: string,
    data: Partial<Omit<InsertCpqGeometry, "id" | "productMappingId">>
  ): Promise<CpqGeometry> {
    const existing = await this.getGeometryByProductMapping(productMappingId);
    if (existing) {
      const updated = await this.updateGeometry(existing.id, data);
      return updated!;
    }
    return this.createGeometry({ productMappingId, ...data });
  },

  // Rules
  async getRulesBySystem(systemId: string, tenantId?: string | null): Promise<CpqRule[]> {
    const filter = tenantId ? and(eq(cpqRules.systemId, systemId), eq(cpqRules.tenantId, tenantId)) : eq(cpqRules.systemId, systemId);
    return db.select().from(cpqRules).where(filter).orderBy(cpqRules.priority, cpqRules.id);
  },

  async getRule(id: string, tenantId?: string | null): Promise<CpqRule | undefined> {
    const filter = tenantId ? and(eq(cpqRules.id, id), eq(cpqRules.tenantId, tenantId)) : eq(cpqRules.id, id);
    const rows = await db.select().from(cpqRules).where(filter).limit(1);
    return rows[0];
  },

  async createRule(data: Omit<InsertCpqRule, "id">, tenantId?: string | null): Promise<CpqRule> {
    const [row] = await db.insert(cpqRules).values({ ...data, tenantId: tenantId || null }).returning();
    return row;
  },

  async updateRule(id: string, data: Partial<InsertCpqRule>): Promise<CpqRule | undefined> {
    const [row] = await db.update(cpqRules).set(data).where(eq(cpqRules.id, id)).returning();
    return row;
  },

  async deleteRule(id: string): Promise<boolean> {
    const result = await db.delete(cpqRules).where(eq(cpqRules.id, id));
    return (result as any).rowCount > 0;
  },

  // Rule Versions
  async getRuleVersions(ruleId: string): Promise<CpqRuleVersion[]> {
    return db.select().from(cpqRuleVersions).where(eq(cpqRuleVersions.ruleId, ruleId)).orderBy(desc(cpqRuleVersions.version));
  },

  async createRuleVersion(data: Omit<InsertCpqRuleVersion, "id">): Promise<CpqRuleVersion> {
    const [row] = await db.insert(cpqRuleVersions).values(data).returning();
    return row;
  },

  // Configurations
  async getConfiguration(id: string, tenantId?: string | null): Promise<CpqConfiguration | undefined> {
    const filter = tenantId ? and(eq(cpqConfigurations.id, id), eq(cpqConfigurations.tenantId, tenantId)) : eq(cpqConfigurations.id, id);
    const rows = await db.select().from(cpqConfigurations).where(filter).limit(1);
    return rows[0];
  },

  async createConfiguration(data: Omit<InsertCpqConfiguration, "id">, tenantId?: string | null): Promise<CpqConfiguration> {
    const [row] = await db.insert(cpqConfigurations).values({ ...data, tenantId: tenantId || null }).returning();
    return row;
  },

  async updateConfiguration(id: string, data: Partial<InsertCpqConfiguration>): Promise<CpqConfiguration | undefined> {
    const [row] = await db.update(cpqConfigurations).set(data).where(eq(cpqConfigurations.id, id)).returning();
    return row;
  },

  async listReviewQueue(
    status: CpqReviewQueueStatus | undefined,
    tenantId?: string | null
  ): Promise<CpqConfiguration[]> {
    const baseFilter = tenantId
      ? and(eq(cpqConfigurations.tenantId, tenantId), eq(cpqConfigurations.reviewRequired, true))
      : eq(cpqConfigurations.reviewRequired, true);
    const filter = status
      ? and(baseFilter, eq(cpqConfigurations.reviewStatus, status))
      : baseFilter;

    return db
      .select()
      .from(cpqConfigurations)
      .where(filter)
      .orderBy(desc(cpqConfigurations.reviewRequestedAt), desc(cpqConfigurations.createdAt));
  },

  async getReviewItem(id: string, tenantId?: string | null): Promise<CpqConfiguration | undefined> {
    const filter = tenantId
      ? and(
          eq(cpqConfigurations.id, id),
          eq(cpqConfigurations.tenantId, tenantId),
          eq(cpqConfigurations.reviewRequired, true)
        )
      : and(eq(cpqConfigurations.id, id), eq(cpqConfigurations.reviewRequired, true));
    const rows = await db.select().from(cpqConfigurations).where(filter).limit(1);
    return rows[0];
  },

  async createReviewAudit(
    data: Omit<InsertCpqReviewAudit, "id">,
    tenantId?: string | null
  ): Promise<CpqReviewAudit> {
    const [row] = await db
      .insert(cpqReviewAudit)
      .values({
        ...data,
        tenantId: tenantId ?? data.tenantId ?? null,
      })
      .returning();
    return row;
  },

  async updateReviewStatus(
    id: string,
    data: {
      status: CpqReviewQueueStatus;
      reviewNotes?: string | null;
      reviewedBy?: string | null;
    },
    tenantId?: string | null
  ): Promise<CpqConfiguration | undefined> {
    const existing = await this.getReviewItem(id, tenantId);
    if (!existing) return undefined;
    const now = new Date();
    const isPending = data.status === "pending";

    const updateFilter = tenantId
      ? and(eq(cpqConfigurations.id, id), eq(cpqConfigurations.tenantId, tenantId))
      : eq(cpqConfigurations.id, id);

    const [row] = await db
      .update(cpqConfigurations)
      .set({
        reviewRequired: true,
        reviewStatus: data.status,
        reviewNotes: data.reviewNotes ?? null,
        reviewedBy: isPending ? null : (data.reviewedBy ?? null),
        reviewedAt: isPending ? null : now,
        reviewRequestedAt: isPending ? now : (existing.reviewRequestedAt ?? now),
        updatedAt: now,
      })
      .where(updateFilter)
      .returning();

    await this.createReviewAudit(
      {
        configurationId: id,
        tenantId: tenantId ?? null,
        fromStatus: existing.reviewStatus,
        toStatus: data.status,
        reviewNotes: data.reviewNotes ?? null,
        reviewedBy: data.reviewedBy ?? null,
      },
      tenantId
    );

    return row;
  },

  async countConfigurationsBySystem(systemId: string, tenantId?: string | null): Promise<number> {
    const filter = tenantId
      ? and(eq(cpqConfigurations.systemId, systemId), eq(cpqConfigurations.tenantId, tenantId))
      : eq(cpqConfigurations.systemId, systemId);
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(cpqConfigurations).where(filter);
    return result[0]?.count ?? 0;
  },

  async getConfigurationsBySystem(systemId: string, tenantId?: string | null): Promise<Array<{ id: string; name: string; configData: Record<string, unknown> | null }>> {
    const filter = tenantId
      ? and(eq(cpqConfigurations.systemId, systemId), eq(cpqConfigurations.tenantId, tenantId))
      : eq(cpqConfigurations.systemId, systemId);
    const rows = await db.select({ id: cpqConfigurations.id, name: cpqConfigurations.name, configData: cpqConfigurations.configData }).from(cpqConfigurations).where(filter);
    return rows.map((r) => ({ id: r.id, name: r.name, configData: r.configData ?? null }));
  },

  // Discount Levels
  async getDiscountLevels(tenantId?: string | null): Promise<CpqDiscountLevel[]> {
    const filter = tenantId ? and(eq(cpqDiscountLevels.tenantId, tenantId), eq(cpqDiscountLevels.status, "active")) : eq(cpqDiscountLevels.status, "active");
    return db.select().from(cpqDiscountLevels).where(filter).orderBy(cpqDiscountLevels.sortOrder, cpqDiscountLevels.discountMin);
  },

  async getAllDiscountLevels(tenantId?: string | null): Promise<CpqDiscountLevel[]> {
    const filter = tenantId != null ? eq(cpqDiscountLevels.tenantId, tenantId) : undefined;
    const results = filter
      ? await db.select().from(cpqDiscountLevels).where(filter).orderBy(cpqDiscountLevels.sortOrder, cpqDiscountLevels.discountMin)
      : await db.select().from(cpqDiscountLevels).orderBy(cpqDiscountLevels.sortOrder, cpqDiscountLevels.discountMin);
    return results;
  },

  async getDiscountLevelById(id: string, tenantId?: string | null): Promise<CpqDiscountLevel | undefined> {
    const filter = tenantId != null
      ? and(eq(cpqDiscountLevels.id, id), eq(cpqDiscountLevels.tenantId, tenantId))
      : eq(cpqDiscountLevels.id, id);
    const rows = await db.select().from(cpqDiscountLevels).where(filter).limit(1);
    return rows[0];
  },

  async createDiscountLevel(data: Omit<InsertCpqDiscountLevel, "id">, tenantId?: string | null): Promise<CpqDiscountLevel> {
    const [row] = await db.insert(cpqDiscountLevels).values({ ...data, tenantId: tenantId || null }).returning();
    return row;
  },

  async updateDiscountLevel(id: string, data: Partial<InsertCpqDiscountLevel>): Promise<CpqDiscountLevel | undefined> {
    const [row] = await db.update(cpqDiscountLevels).set(data).where(eq(cpqDiscountLevels.id, id)).returning();
    return row;
  },

  async deleteDiscountLevel(id: string): Promise<boolean> {
    const result = await db.delete(cpqDiscountLevels).where(eq(cpqDiscountLevels.id, id));
    return (result as any).rowCount > 0;
  },

  async getDiscountLevelRules(tenantId?: string | null): Promise<CpqDiscountLevelRule[]> {
    const filter = tenantId != null ? eq(cpqDiscountLevelRules.tenantId, tenantId) : undefined;
    const rows = filter
      ? await db.select().from(cpqDiscountLevelRules).where(filter).orderBy(desc(cpqDiscountLevelRules.priority))
      : await db.select().from(cpqDiscountLevelRules).orderBy(desc(cpqDiscountLevelRules.priority));
    return rows;
  },

  // Quote Log
  async createQuoteLog(data: Omit<InsertCpqQuoteLog, "id">, tenantId?: string | null): Promise<CpqQuoteLog> {
    const [row] = await db.insert(cpqQuoteLog).values({ ...data, tenantId: tenantId || null }).returning();
    return row;
  },

  async getQuoteLogByOfferId(offerId: string, tenantId?: string | null): Promise<CpqQuoteLog | undefined> {
    const filter = tenantId
      ? and(eq(cpqQuoteLog.offerId, offerId), eq(cpqQuoteLog.tenantId, tenantId))
      : eq(cpqQuoteLog.offerId, offerId);
    const rows = await db.select().from(cpqQuoteLog).where(filter).orderBy(desc(cpqQuoteLog.createdAt)).limit(1);
    return rows[0];
  },

  async updateQuoteLog(id: string, data: { approvalStatus?: string; approvedBy?: string; approvalComment?: string; approvedAt?: Date }): Promise<CpqQuoteLog | undefined> {
    const [row] = await db.update(cpqQuoteLog).set(data).where(eq(cpqQuoteLog.id, id)).returning();
    return row;
  },

  async getQuoteLogsForReporting(from: string, to: string, tenantId?: string | null): Promise<CpqQuoteLog[]> {
    const filter = tenantId
      ? and(
          gte(cpqQuoteLog.createdAt, new Date(from)),
          lte(cpqQuoteLog.createdAt, new Date(to)),
          eq(cpqQuoteLog.tenantId, tenantId)
        )
      : and(gte(cpqQuoteLog.createdAt, new Date(from)), lte(cpqQuoteLog.createdAt, new Date(to)));
    return db.select().from(cpqQuoteLog).where(filter).orderBy(desc(cpqQuoteLog.createdAt));
  },
};
