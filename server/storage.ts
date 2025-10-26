import {
  type User,
  type InsertUser,
  type Role,
  type ShopwareSettings,
  type InsertShopwareSettings,
  type CrossSellingRule,
  type InsertCrossSellingRule,
} from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export type InsertRole = Omit<Role, "id">;
export type UpdateUser = {
  username?: string;
  password?: string;
  role?: "employee" | "admin";
  roleId?: string;
  salesChannelIds?: string[] | null;
};

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: UpdateUser): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  
  // Roles
  getRole(id: string): Promise<Role | undefined>;
  getAllRoles(): Promise<Role[]>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, updates: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<boolean>;
  
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
  private roles: Map<string, Role>;
  private shopwareSettings: ShopwareSettings | undefined;
  private crossSellingRules: Map<string, CrossSellingRule>;

  constructor() {
    this.users = new Map();
    this.roles = new Map();
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

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id, role: "employee", roleId: null, salesChannelIds: null };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: UpdateUser): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updatedUser: User = {
      ...user,
      ...updates,
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  async getRole(id: string): Promise<Role | undefined> {
    return this.roles.get(id);
  }

  async getAllRoles(): Promise<Role[]> {
    return Array.from(this.roles.values());
  }

  async createRole(insertRole: InsertRole): Promise<Role> {
    const id = randomUUID();
    const role: Role = { id, ...insertRole };
    this.roles.set(id, role);
    return role;
  }

  async updateRole(id: string, updates: Partial<InsertRole>): Promise<Role | undefined> {
    const role = this.roles.get(id);
    if (!role) return undefined;

    const updatedRole: Role = {
      ...role,
      ...updates,
    };

    this.roles.set(id, updatedRole);
    return updatedRole;
  }

  async deleteRole(id: string): Promise<boolean> {
    return this.roles.delete(id);
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
      active: insertRule.active ?? 1,
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
      updated.active = updates.active;
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
