import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  roles,
  settings,
  crossSellingRules,
  type User,
  type InsertUser,
  type Role,
  type ShopwareSettings,
  type InsertShopwareSettings,
  type CrossSellingRule,
  type InsertCrossSellingRule,
} from "@shared/schema";
import type { IStorage, InsertRole, UpdateUser } from "./storage";

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

  // Roles
  async getRole(id: string): Promise<Role | undefined> {
    const result = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return result[0];
  }

  async getAllRoles(): Promise<Role[]> {
    return await db.select().from(roles);
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
  async getShopwareSettings(): Promise<ShopwareSettings | undefined> {
    const result = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "shopware"))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    return result[0].value as ShopwareSettings;
  }

  async saveShopwareSettings(shopwareSettings: InsertShopwareSettings): Promise<ShopwareSettings> {
    // Upsert: Update if exists, insert if not
    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "shopware"))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({
          value: shopwareSettings,
          updatedAt: new Date(),
        })
        .where(eq(settings.key, "shopware"));
    } else {
      await db.insert(settings).values({
        key: "shopware",
        value: shopwareSettings,
      });
    }

    return shopwareSettings;
  }

  // Cross-Selling Rules
  async getAllCrossSellingRules(): Promise<CrossSellingRule[]> {
    const dbRules = await db.select().from(crossSellingRules);
    
    // Convert DB format to CrossSellingRule format
    return dbRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      description: rule.description || undefined,
      active: rule.active,
      sourceConditions: typeof rule.sourceConditions === 'string'
        ? JSON.parse(rule.sourceConditions)
        : rule.sourceConditions,
      targetCriteria: typeof rule.targetCriteria === 'string'
        ? JSON.parse(rule.targetCriteria)
        : rule.targetCriteria,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    }));
  }

  async getCrossSellingRule(id: string): Promise<CrossSellingRule | undefined> {
    const result = await db
      .select()
      .from(crossSellingRules)
      .where(eq(crossSellingRules.id, id))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    const rule = result[0];
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description || undefined,
      active: rule.active,
      sourceConditions: typeof rule.sourceConditions === 'string'
        ? JSON.parse(rule.sourceConditions)
        : rule.sourceConditions,
      targetCriteria: typeof rule.targetCriteria === 'string'
        ? JSON.parse(rule.targetCriteria)
        : rule.targetCriteria,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  async createCrossSellingRule(insertRule: InsertCrossSellingRule): Promise<CrossSellingRule> {
    const result = await db
      .insert(crossSellingRules)
      .values({
        name: insertRule.name,
        description: insertRule.description,
        active: insertRule.active ?? 1,
        // Data is already JSON stringified from routes.ts, don't stringify again
        sourceConditions: insertRule.sourceConditions as any,
        targetCriteria: insertRule.targetCriteria as any,
      })
      .returning();
    
    const rule = result[0];
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description || undefined,
      active: rule.active,
      sourceConditions: typeof rule.sourceConditions === 'string'
        ? JSON.parse(rule.sourceConditions)
        : rule.sourceConditions,
      targetCriteria: typeof rule.targetCriteria === 'string'
        ? JSON.parse(rule.targetCriteria)
        : rule.targetCriteria,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  async updateCrossSellingRule(
    id: string,
    updates: Partial<InsertCrossSellingRule>
  ): Promise<CrossSellingRule | undefined> {
    const updateData: any = { updatedAt: new Date() };
    
    if (updates.name) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.active !== undefined) updateData.active = updates.active;
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
      .where(eq(crossSellingRules.id, id))
      .returning();
    
    if (!result[0]) return undefined;
    
    const rule = result[0];
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description || undefined,
      active: rule.active,
      sourceConditions: typeof rule.sourceConditions === 'string'
        ? JSON.parse(rule.sourceConditions)
        : rule.sourceConditions,
      targetCriteria: typeof rule.targetCriteria === 'string'
        ? JSON.parse(rule.targetCriteria)
        : rule.targetCriteria,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  async deleteCrossSellingRule(id: string): Promise<boolean> {
    const result = await db
      .delete(crossSellingRules)
      .where(eq(crossSellingRules.id, id))
      .returning();
    return result.length > 0;
  }
}
