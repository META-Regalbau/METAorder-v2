import {
  type User,
  type InsertUser,
  type ShopwareSettings,
  type InsertShopwareSettings,
  type CrossSellingRule,
  type InsertCrossSellingRule,
} from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Shopware settings
  getShopwareSettings(): Promise<ShopwareSettings | undefined>;
  saveShopwareSettings(settings: InsertShopwareSettings): Promise<ShopwareSettings>;
  
  // Cross-Selling Rules
  getAllCrossSellingRules(): Promise<CrossSellingRule[]>;
  getCrossSellingRule(id: string): Promise<CrossSellingRule | undefined>;
  createCrossSellingRule(rule: InsertCrossSellingRule): Promise<CrossSellingRule>;
  updateCrossSellingRule(id: string, rule: Partial<InsertCrossSellingRule>): Promise<CrossSellingRule | undefined>;
  deleteCrossSellingRule(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private shopwareSettings: ShopwareSettings | undefined;
  private crossSellingRules: Map<string, CrossSellingRule>;

  constructor() {
    this.users = new Map();
    this.shopwareSettings = undefined;
    this.crossSellingRules = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id, role: "employee", salesChannelIds: null };
    this.users.set(id, user);
    return user;
  }

  async getShopwareSettings(): Promise<ShopwareSettings | undefined> {
    return this.shopwareSettings;
  }

  async saveShopwareSettings(settings: InsertShopwareSettings): Promise<ShopwareSettings> {
    this.shopwareSettings = settings;
    return settings;
  }

  async getAllCrossSellingRules(): Promise<CrossSellingRule[]> {
    return Array.from(this.crossSellingRules.values());
  }

  async getCrossSellingRule(id: string): Promise<CrossSellingRule | undefined> {
    return this.crossSellingRules.get(id);
  }

  async createCrossSellingRule(insertRule: InsertCrossSellingRule): Promise<CrossSellingRule> {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    // Parse JSON strings if needed (from DB), otherwise use directly
    const sourceConditions = typeof insertRule.sourceConditions === 'string' 
      ? JSON.parse(insertRule.sourceConditions)
      : insertRule.sourceConditions;
    
    const targetCriteria = typeof insertRule.targetCriteria === 'string'
      ? JSON.parse(insertRule.targetCriteria)
      : insertRule.targetCriteria;
    
    const rule: CrossSellingRule = {
      id,
      name: insertRule.name,
      description: insertRule.description || undefined,
      active: Boolean(insertRule.active),
      sourceConditions,
      targetCriteria,
      createdAt: now,
      updatedAt: now,
    };
    
    this.crossSellingRules.set(id, rule);
    return rule;
  }

  async updateCrossSellingRule(
    id: string,
    updates: Partial<InsertCrossSellingRule>
  ): Promise<CrossSellingRule | undefined> {
    const existing = this.crossSellingRules.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: CrossSellingRule = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };

    if (updates.name) {
      updated.name = updates.name;
    }
    if (updates.description !== undefined) {
      updated.description = updates.description || undefined;
    }
    if (updates.active !== undefined) {
      updated.active = Boolean(updates.active);
    }
    if (updates.sourceConditions) {
      updated.sourceConditions = typeof updates.sourceConditions === 'string'
        ? JSON.parse(updates.sourceConditions)
        : updates.sourceConditions;
    }
    if (updates.targetCriteria) {
      updated.targetCriteria = typeof updates.targetCriteria === 'string'
        ? JSON.parse(updates.targetCriteria)
        : updates.targetCriteria;
    }

    this.crossSellingRules.set(id, updated);
    return updated;
  }

  async deleteCrossSellingRule(id: string): Promise<boolean> {
    return this.crossSellingRules.delete(id);
  }
}

export const storage = new MemStorage();
