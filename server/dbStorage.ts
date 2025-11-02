import { eq, sql as drizzleSql, desc, and } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  roles,
  settings,
  crossSellingRules,
  tickets,
  ticketComments,
  ticketAttachments,
  ticketActivityLog,
  ticketAssignmentRules,
  notifications,
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

  // Tickets
  async getAllTickets(): Promise<Ticket[]> {
    return await db.select().from(tickets);
  }

  async getTicket(id: string): Promise<Ticket | undefined> {
    const result = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    return result[0];
  }

  async getTicketsByOrderId(orderId: string): Promise<Ticket[]> {
    return await db.select().from(tickets).where(eq(tickets.orderId, orderId));
  }

  async createTicket(insertTicket: InsertTicket): Promise<Ticket> {
    const ticketNumber = await this.generateTicketNumber();
    
    const result = await db
      .insert(tickets)
      .values({
        ...insertTicket,
        ticketNumber,
      })
      .returning();
    return result[0];
  }

  async updateTicket(id: string, updates: Partial<InsertTicket>): Promise<Ticket | undefined> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    
    if (updates.status === "resolved") {
      const existing = await this.getTicket(id);
      if (existing && !existing.resolvedAt) {
        updateData.resolvedAt = new Date();
      }
    }
    
    if (updates.status === "closed") {
      const existing = await this.getTicket(id);
      if (existing && !existing.closedAt) {
        updateData.closedAt = new Date();
      }
    }
    
    const result = await db
      .update(tickets)
      .set(updateData)
      .where(eq(tickets.id, id))
      .returning();
    return result[0];
  }

  async deleteTicket(id: string): Promise<boolean> {
    const result = await db.delete(tickets).where(eq(tickets.id, id)).returning();
    return result.length > 0;
  }

  // Ticket Comments
  async getTicketComments(ticketId: string): Promise<TicketComment[]> {
    return await db.select().from(ticketComments).where(eq(ticketComments.ticketId, ticketId));
  }

  async createTicketComment(insertComment: InsertTicketComment): Promise<TicketComment> {
    const result = await db
      .insert(ticketComments)
      .values(insertComment)
      .returning();
    
    await db
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, insertComment.ticketId));
    
    return result[0];
  }

  async deleteTicketComment(id: string): Promise<boolean> {
    const result = await db.delete(ticketComments).where(eq(ticketComments.id, id)).returning();
    return result.length > 0;
  }

  // Ticket Attachments
  async getTicketAttachments(ticketId: string): Promise<TicketAttachment[]> {
    return await db.select().from(ticketAttachments).where(eq(ticketAttachments.ticketId, ticketId));
  }

  async createTicketAttachment(insertAttachment: InsertTicketAttachment): Promise<TicketAttachment> {
    const result = await db
      .insert(ticketAttachments)
      .values(insertAttachment)
      .returning();
    return result[0];
  }

  async deleteTicketAttachment(id: string): Promise<boolean> {
    const result = await db.delete(ticketAttachments).where(eq(ticketAttachments.id, id)).returning();
    return result.length > 0;
  }

  async getTicketActivityLog(ticketId: string): Promise<TicketActivityLog[]> {
    return await db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.ticketId, ticketId))
      .orderBy(drizzleSql`${ticketActivityLog.createdAt} DESC`);
  }

  async createTicketActivityLog(log: InsertTicketActivityLog): Promise<TicketActivityLog> {
    const result = await db.insert(ticketActivityLog).values(log).returning();
    return result[0];
  }

  // Ticket Assignment Rules
  async getAllTicketAssignmentRules(): Promise<TicketAssignmentRule[]> {
    return await db.select().from(ticketAssignmentRules).orderBy(desc(ticketAssignmentRules.priority));
  }

  async getActiveTicketAssignmentRules(): Promise<TicketAssignmentRule[]> {
    return await db
      .select()
      .from(ticketAssignmentRules)
      .where(eq(ticketAssignmentRules.active, 1))
      .orderBy(desc(ticketAssignmentRules.priority));
  }

  async getTicketAssignmentRule(id: string): Promise<TicketAssignmentRule | undefined> {
    const result = await db.select().from(ticketAssignmentRules).where(eq(ticketAssignmentRules.id, id)).limit(1);
    return result[0];
  }

  async createTicketAssignmentRule(insertRule: InsertTicketAssignmentRule): Promise<TicketAssignmentRule> {
    const result = await db.insert(ticketAssignmentRules).values(insertRule).returning();
    return result[0];
  }

  async updateTicketAssignmentRule(id: string, updates: Partial<InsertTicketAssignmentRule>): Promise<TicketAssignmentRule | undefined> {
    const result = await db
      .update(ticketAssignmentRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(ticketAssignmentRules.id, id))
      .returning();
    return result[0];
  }

  async deleteTicketAssignmentRule(id: string): Promise<boolean> {
    const result = await db.delete(ticketAssignmentRules).where(eq(ticketAssignmentRules.id, id)).returning();
    return result.length > 0;
  }

  // Notifications
  async getNotificationsByUserId(userId: string, limit?: number): Promise<Notification[]> {
    let query = db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
    
    if (limit) {
      query = query.limit(limit) as any;
    }
    
    return await query;
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.read, 0)
      ));
    
    return result[0]?.count || 0;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const result = await db.insert(notifications).values(insertNotification).returning();
    return result[0];
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const result = await db
      .update(notifications)
      .set({ read: 1 })
      .where(eq(notifications.id, id))
      .returning();
    return result[0];
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    const result = await db
      .update(notifications)
      .set({ read: 1 })
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.read, 0)
      ))
      .returning();
    
    return result.length;
  }

  async deleteNotification(id: string): Promise<boolean> {
    const result = await db.delete(notifications).where(eq(notifications.id, id)).returning();
    return result.length > 0;
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
}
