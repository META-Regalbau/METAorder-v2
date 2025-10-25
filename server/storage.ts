import { type User, type InsertUser, type ShopwareSettings, type InsertShopwareSettings } from "@shared/schema";
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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private shopwareSettings: ShopwareSettings | undefined;

  constructor() {
    this.users = new Map();
    this.shopwareSettings = undefined;
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
    const user: User = { ...insertUser, id, role: "employee" };
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
}

export const storage = new MemStorage();
