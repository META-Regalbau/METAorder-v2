import {
  type User,
  type InsertUser,
  type Role,
  type ShopwareSettings,
  type InsertShopwareSettings,
  type CrossSellingRule,
  type InsertCrossSellingRule,
  type Ticket,
  type InsertTicket,
  type TicketComment,
  type InsertTicketComment,
  type TicketAttachment,
  type InsertTicketAttachment,
  type TicketActivityLog,
  type InsertTicketActivityLog,
  type TicketAssignmentRule,
  type InsertTicketAssignmentRule,
  type Notification,
  type InsertNotification,
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
  
  // Tickets
  getAllTickets(): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket | undefined>;
  getTicketsByOrderId(orderId: string): Promise<Ticket[]>;
  createTicket(ticket: InsertTicket): Promise<Ticket>;
  updateTicket(id: string, updates: Partial<InsertTicket>): Promise<Ticket | undefined>;
  deleteTicket(id: string): Promise<boolean>;
  
  // Ticket Comments
  getTicketComments(ticketId: string): Promise<TicketComment[]>;
  createTicketComment(comment: InsertTicketComment): Promise<TicketComment>;
  deleteTicketComment(id: string): Promise<boolean>;
  
  // Ticket Attachments
  getTicketAttachments(ticketId: string): Promise<TicketAttachment[]>;
  getTicketAttachment(id: string): Promise<TicketAttachment | undefined>;
  createTicketAttachment(attachment: InsertTicketAttachment): Promise<TicketAttachment>;
  deleteTicketAttachment(id: string): Promise<boolean>;
  
  // Ticket Views (Read/Unread tracking)
  markTicketCommentsAsRead(ticketId: string, userId: string): Promise<void>;
  markTicketAttachmentsAsRead(ticketId: string, userId: string): Promise<void>;
  getUnreadCounts(ticketId: string, userId: string): Promise<{ unreadComments: number; unreadAttachments: number }>;
  
  // Ticket Activity Log
  getTicketActivityLog(ticketId: string): Promise<TicketActivityLog[]>;
  createTicketActivityLog(log: InsertTicketActivityLog): Promise<TicketActivityLog>;
  
  // Ticket Assignment Rules
  getAllTicketAssignmentRules(): Promise<TicketAssignmentRule[]>;
  getActiveTicketAssignmentRules(): Promise<TicketAssignmentRule[]>;
  getTicketAssignmentRule(id: string): Promise<TicketAssignmentRule | undefined>;
  createTicketAssignmentRule(rule: InsertTicketAssignmentRule): Promise<TicketAssignmentRule>;
  updateTicketAssignmentRule(id: string, updates: Partial<InsertTicketAssignmentRule>): Promise<TicketAssignmentRule | undefined>;
  deleteTicketAssignmentRule(id: string): Promise<boolean>;
  
  // Notifications
  getNotificationsByUserId(userId: string, limit?: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string): Promise<number>;
  deleteNotification(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private roles: Map<string, Role>;
  private shopwareSettings: ShopwareSettings | undefined;
  private crossSellingRules: Map<string, CrossSellingRule>;
  private tickets: Map<string, Ticket>;
  private ticketComments: Map<string, TicketComment>;
  private ticketAttachments: Map<string, TicketAttachment>;
  private ticketActivityLogs: Map<string, TicketActivityLog>;
  private ticketAssignmentRules: Map<string, TicketAssignmentRule>;
  private notifications: Map<string, Notification>;
  private ticketCounter: number;

  constructor() {
    this.users = new Map();
    this.roles = new Map();
    this.shopwareSettings = undefined;
    this.crossSellingRules = new Map();
    this.tickets = new Map();
    this.ticketComments = new Map();
    this.ticketAttachments = new Map();
    this.ticketActivityLogs = new Map();
    this.ticketAssignmentRules = new Map();
    this.notifications = new Map();
    this.ticketCounter = 1000;
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
    const user: User = { 
      ...insertUser, 
      id, 
      role: "employee", 
      roleId: null, 
      salesChannelIds: null,
      email: insertUser.email ?? null 
    };
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

  async getAllTickets(): Promise<Ticket[]> {
    return Array.from(this.tickets.values());
  }

  async getTicket(id: string): Promise<Ticket | undefined> {
    return this.tickets.get(id);
  }

  async getTicketsByOrderId(orderId: string): Promise<Ticket[]> {
    return Array.from(this.tickets.values()).filter(
      (ticket) => ticket.orderId === orderId
    );
  }

  async createTicket(insertTicket: InsertTicket): Promise<Ticket> {
    const id = randomUUID();
    const ticketNumber = `T-${this.ticketCounter++}`;
    const now = new Date();
    
    const ticket: Ticket = {
      id,
      ticketNumber,
      title: insertTicket.title,
      description: insertTicket.description,
      status: insertTicket.status || "open",
      priority: insertTicket.priority || "normal",
      category: insertTicket.category || "general",
      orderId: insertTicket.orderId || null,
      orderNumber: insertTicket.orderNumber || null,
      assignedToUserId: insertTicket.assignedToUserId || null,
      createdByUserId: insertTicket.createdByUserId || null,
      dueDate: insertTicket.dueDate || null,
      tags: insertTicket.tags || null,
      emailSubject: insertTicket.emailSubject || null,
      emailFrom: insertTicket.emailFrom || null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      closedAt: null,
    };
    
    this.tickets.set(id, ticket);
    return ticket;
  }

  async updateTicket(id: string, updates: Partial<InsertTicket>): Promise<Ticket | undefined> {
    const ticket = this.tickets.get(id);
    if (!ticket) return undefined;

    const now = new Date();
    const updatedTicket: Ticket = {
      ...ticket,
      ...updates,
      updatedAt: now,
      resolvedAt: updates.status === "resolved" ? (ticket.resolvedAt || now) : ticket.resolvedAt,
      closedAt: updates.status === "closed" ? (ticket.closedAt || now) : ticket.closedAt,
    };
    
    this.tickets.set(id, updatedTicket);
    return updatedTicket;
  }

  async deleteTicket(id: string): Promise<boolean> {
    return this.tickets.delete(id);
  }

  async getTicketComments(ticketId: string): Promise<TicketComment[]> {
    return Array.from(this.ticketComments.values()).filter(
      (comment) => comment.ticketId === ticketId
    );
  }

  async createTicketComment(insertComment: InsertTicketComment): Promise<TicketComment> {
    const id = randomUUID();
    const comment: TicketComment = {
      id,
      ticketId: insertComment.ticketId,
      userId: insertComment.userId,
      comment: insertComment.comment,
      isInternal: insertComment.isInternal || 0,
      createdAt: new Date(),
    };
    
    this.ticketComments.set(id, comment);
    return comment;
  }

  async deleteTicketComment(id: string): Promise<boolean> {
    return this.ticketComments.delete(id);
  }

  async getTicketAttachments(ticketId: string): Promise<TicketAttachment[]> {
    return Array.from(this.ticketAttachments.values()).filter(
      (attachment) => attachment.ticketId === ticketId
    );
  }

  async getTicketAttachment(id: string): Promise<TicketAttachment | undefined> {
    return this.ticketAttachments.get(id);
  }

  async createTicketAttachment(insertAttachment: InsertTicketAttachment): Promise<TicketAttachment> {
    const id = randomUUID();
    const attachment: TicketAttachment = {
      id,
      ...insertAttachment,
      createdAt: new Date(),
    };
    
    this.ticketAttachments.set(id, attachment);
    return attachment;
  }

  async deleteTicketAttachment(id: string): Promise<boolean> {
    return this.ticketAttachments.delete(id);
  }

  async markTicketCommentsAsRead(ticketId: string, userId: string): Promise<void> {
    // Stub implementation - not used in production (using DbStorage)
  }

  async markTicketAttachmentsAsRead(ticketId: string, userId: string): Promise<void> {
    // Stub implementation - not used in production (using DbStorage)
  }

  async getUnreadCounts(ticketId: string, userId: string): Promise<{ unreadComments: number; unreadAttachments: number }> {
    // Stub implementation - not used in production (using DbStorage)
    return { unreadComments: 0, unreadAttachments: 0 };
  }

  async getTicketActivityLog(ticketId: string): Promise<TicketActivityLog[]> {
    return Array.from(this.ticketActivityLogs.values())
      .filter(log => log.ticketId === ticketId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createTicketActivityLog(log: InsertTicketActivityLog): Promise<TicketActivityLog> {
    const newLog: TicketActivityLog = {
      ...log,
      id: randomUUID(),
      fieldName: log.fieldName || null,
      oldValue: log.oldValue || null,
      newValue: log.newValue || null,
      createdAt: new Date(),
    };
    this.ticketActivityLogs.set(newLog.id, newLog);
    return newLog;
  }

  // Ticket Assignment Rules
  async getAllTicketAssignmentRules(): Promise<TicketAssignmentRule[]> {
    return Array.from(this.ticketAssignmentRules.values())
      .sort((a, b) => b.priority - a.priority);
  }

  async getActiveTicketAssignmentRules(): Promise<TicketAssignmentRule[]> {
    return Array.from(this.ticketAssignmentRules.values())
      .filter(rule => rule.active === 1)
      .sort((a, b) => b.priority - a.priority);
  }

  async getTicketAssignmentRule(id: string): Promise<TicketAssignmentRule | undefined> {
    return this.ticketAssignmentRules.get(id);
  }

  async createTicketAssignmentRule(insertRule: InsertTicketAssignmentRule): Promise<TicketAssignmentRule> {
    const id = randomUUID();
    const rule: TicketAssignmentRule = {
      id,
      ...insertRule,
      active: insertRule.active ?? 1,
      priority: insertRule.priority ?? 0,
      conditions: insertRule.conditions ?? null,
      assignToUserId: insertRule.assignToUserId ?? null,
      assignToRoleId: insertRule.assignToRoleId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.ticketAssignmentRules.set(id, rule);
    return rule;
  }

  async updateTicketAssignmentRule(id: string, updates: Partial<InsertTicketAssignmentRule>): Promise<TicketAssignmentRule | undefined> {
    const existing = this.ticketAssignmentRules.get(id);
    if (!existing) return undefined;

    const updated: TicketAssignmentRule = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.ticketAssignmentRules.set(id, updated);
    return updated;
  }

  async deleteTicketAssignmentRule(id: string): Promise<boolean> {
    return this.ticketAssignmentRules.delete(id);
  }

  // Notifications
  async getNotificationsByUserId(userId: string, limit?: number): Promise<Notification[]> {
    const userNotifications = Array.from(this.notifications.values())
      .filter(n => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return limit ? userNotifications.slice(0, limit) : userNotifications;
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    return Array.from(this.notifications.values())
      .filter(n => n.userId === userId && n.read === 0)
      .length;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const id = randomUUID();
    const notification: Notification = {
      id,
      ...insertNotification,
      ticketId: insertNotification.ticketId ?? null,
      ticketNumber: insertNotification.ticketNumber ?? null,
      createdAt: new Date(),
    };
    
    this.notifications.set(id, notification);
    return notification;
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const notification = this.notifications.get(id);
    if (!notification) return undefined;

    const updated: Notification = {
      ...notification,
      read: 1,
    };
    this.notifications.set(id, updated);
    return updated;
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    let count = 0;
    for (const [id, notification] of this.notifications.entries()) {
      if (notification.userId === userId && notification.read === 0) {
        this.notifications.set(id, { ...notification, read: 1 });
        count++;
      }
    }
    return count;
  }

  async deleteNotification(id: string): Promise<boolean> {
    return this.notifications.delete(id);
  }
}

// Import DbStorage and use it as the default storage implementation
import { DbStorage } from "./dbStorage";

// Export DbStorage as the default storage
export const storage = new DbStorage();

// Keep MemStorage available for testing/development if needed
// export const storage = new MemStorage();
