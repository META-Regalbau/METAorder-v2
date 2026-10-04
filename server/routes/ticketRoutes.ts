// Tickets: Ticket-API, Kundenportal, Vorlagen, Zuweisungs- und Automatisierungsregeln, Anhaenge.
import { parseStoredRuleList, validateAutomationRule, type AutomationActionInput, type AutomationConditionInput } from "@shared/automation";
import { createAutomationDeps } from "../automation";
import { previewScheduledRule } from "../automation/scheduler";
import { requireAuth, requireManageTickets, requireManageAutomations, requireViewTickets } from "../auth/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertTicketTemplateSchema, insertAutomationRuleSchema, insertTicketCommentSchema, insertTicketSchema, insertTicketAssignmentRuleSchema } from "@shared/schema";
import { ShopwareClient } from "../shopware/shopware";
import { requireCustomerAuth, type CustomerRequest } from "../auth/authCustomer";
import type { Request, Response, Express } from "express";
import { webhookService } from "../lib/webhookService";
import { notifyNewTicket } from "../lib/notifications";
import { notificationEvents } from "../lib/events";
import { getEmailOutboundSettings, sendEmail } from "../email/emailOutbound";
import multer from "multer";
import path from "path";
import { getUploadsRoot } from "../uploadsRoot";
import fs from "fs/promises";
import crypto from "crypto";
import { getTenantIdFromContext, restoreTenantContext } from "../lib/tenantContext";
import { objectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { parseEmailFile } from "../email/emailParser";
import * as XLSX from "xlsx";
import { DEFAULT_TICKET_SLA_SETTINGS, assignTicketAutomatically, filterTicketsBySalesChannels, getSalesChannelFilter, getTicketSlaSettings, resolveAttachmentPath, sanitizeFilename, uploadRateLimiter } from "./routeHelpers";

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

/** Für HTML-E-Mail-Bodies, die Freitext (z. B. Ticket-Kommentare) einbetten. */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface TicketRouteDeps {
  useObjectStorage: boolean;
}

/** Gespeicherte Regel mit (Teil-)Aenderungen zusammenfuehren und gegen den Katalog pruefen. */
function validateStoredAutomationRule(
  existing: { triggerType: string; conditions: string | null; actions: string },
  changes: { triggerType?: string; conditions?: AutomationConditionInput[] | null; actions?: AutomationActionInput[] },
): string[] {
  const parse = <T,>(raw: string | null): T[] => parseStoredRuleList<T>(raw) ?? [];
  return validateAutomationRule({
    triggerType: changes.triggerType ?? existing.triggerType,
    conditions: changes.conditions !== undefined ? changes.conditions ?? [] : parse<AutomationConditionInput>(existing.conditions),
    actions: changes.actions ?? parse<AutomationActionInput>(existing.actions),
  });
}

export function registerTicketRoutes(app: Express, deps: TicketRouteDeps): void {
  const { useObjectStorage } = deps;

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
  // Automation Rules - Vorschau fuer zeitgesteuerte Regeln: welche Bestellungen jetzt betroffen
  // waeren (fuehrt nichts aus). Optional ruleId, um bereits erledigte Bestellungen abzuziehen.
  app.post("/api/automation-rules/preview", requireAuth, requireManageAutomations, async (req, res) => {
    try {
      const body = insertAutomationRuleSchema.pick({ triggerType: true, conditions: true }).extend({ ruleId: z.string().optional() }).parse(req.body);
      if (body.triggerType !== "scheduled") {
        return res.status(400).json({ error: "Vorschau gibt es nur fuer zeitgesteuerte Regeln" });
      }
      const conditions = body.conditions ?? [];
      const ruleErrors = validateAutomationRule({ triggerType: body.triggerType, conditions, actions: [{ type: "create_ticket", params: { title: "x", description: "x" } }] });
      if (ruleErrors.length > 0) {
        return res.status(400).json({ error: "Regel unvollständig", details: ruleErrors });
      }
      if (body.ruleId && !(await storage.getAutomationRule(body.ruleId))) {
        return res.status(404).json({ error: "Automation rule not found" });
      }
      const preview = await previewScheduledRule(createAutomationDeps(storage), getTenantIdFromContext(), conditions, body.ruleId ?? null);
      res.json(preview);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid preview data", details: error.errors });
      }
      console.error("Error previewing automation rule:", error);
      res.status(500).json({ error: "Failed to preview automation rule" });
    }
  });

  // Automation Rules - Benutzer des aktiven Mandanten (Auswahl fuer "zuweisen"/"benachrichtigen").
  // Muss VOR "/api/automation-rules/:id" stehen, sonst faengt :id den Pfad "users" ab.
  app.get("/api/automation-rules/users", requireAuth, requireManageAutomations, async (_req, res) => {
    try {
      const tenantId = getTenantIdFromContext();
      const users = await storage.getAllUsers();
      const visible = tenantId
        ? (await Promise.all(users.map(async (u) => ((await storage.getTenantsForUser(u.id)).some((t) => t.id === tenantId) ? u : null))))
            .filter((u): u is NonNullable<typeof u> => u !== null)
        : users;
      res.json(visible.map(({ id, username }) => ({ id, username })));
    } catch (error) {
      console.error("Error fetching automation users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

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
      const ruleErrors = validateAutomationRule({
        triggerType: validatedData.triggerType,
        conditions: validatedData.conditions ?? [],
        actions: validatedData.actions,
      });
      if (ruleErrors.length > 0) {
        return res.status(400).json({ error: "Regel unvollständig", details: ruleErrors });
      }
      
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
      if (
        validatedData.triggerType !== undefined ||
        validatedData.conditions !== undefined ||
        validatedData.actions !== undefined ||
        validatedData.enabled === true
      ) {
        const existing = await storage.getAutomationRule(id);
        if (!existing) {
          return res.status(404).json({ error: "Automation rule not found" });
        }
        const ruleErrors = validateStoredAutomationRule(existing, validatedData);
        if (ruleErrors.length > 0) {
          return res.status(400).json({ error: "Regel unvollständig", details: ruleErrors });
        }
      }
      
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
      if (enabled) {
        const existing = await storage.getAutomationRule(id);
        if (!existing) {
          return res.status(404).json({ error: "Automation rule not found" });
        }
        const ruleErrors = validateStoredAutomationRule(existing, {});
        if (ruleErrors.length > 0) {
          return res.status(400).json({ error: "Regel unvollständig", details: ruleErrors });
        }
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
                html: `<p>${escapeHtml(comment.comment).replace(/\n/g, "<br/>")}</p>`,
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
    attachmentUpload.array('files', 10), restoreTenantContext,
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
}
