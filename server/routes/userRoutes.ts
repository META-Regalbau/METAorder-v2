// Benutzer, Rollen und Mandanten (Verwaltung und Mandantenwechsel).
import { requireAuth, requireCsrf, requireManageSettings, requireManageTickets, requireManageUsers, requireManageRoles } from "../auth/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertUserSchema } from "@shared/schema";
import bcrypt from "bcryptjs";
import type { Request, Express } from "express";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/userRoutes" });


// Sales Channel Filter Helper - ensures users only see data from their assigned sales channels
// SECURITY: This is the ONLY source of truth for sales channel access control
// Returns: string[] for restricted users, null for admins with full access
// Throws: Error if user context is missing (should never happen after requireAuth)

function normalizeStoredSalesChannelIds(ids?: string[] | null): string[] | null {
  if (!ids?.length) return null;
  return ids;
}


/** Neuen User dem Mandanten des Erstellers zuweisen (oder Live / ersten verfügbaren). */
async function assignNewUserToTenant(req: Request, userId: string): Promise<string | null> {
  let tenantId: string | null = (req as any).tenantId ?? null;

  if (!tenantId) {
    const creatorTenants = await storage.getTenantsForUser((req.user as any).id);
    const live = creatorTenants.find((t) => t.name === "Live");
    tenantId = live?.id ?? creatorTenants[0]?.id ?? null;
  }

  if (!tenantId) {
    const allTenants = await storage.getAllTenants();
    const live = allTenants.find((t) => t.name === "Live");
    tenantId = live?.id ?? allTenants[0]?.id ?? null;
  }

  if (!tenantId) return null;

  try {
    await storage.addUserToTenant({ tenantId, userId });
  } catch (error) {
    log.warn({ err: error }, `[assignNewUserToTenant] skipped for user ${userId}:`);
  }

  return tenantId;
}

export function registerUserRoutes(app: Express): void {
  app.get("/api/tenants", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const tenants = await storage.getTenantsForUser(user.id);
      res.json({
        tenants,
        activeTenantId: user.activeTenantId ?? null,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error fetching tenants:");
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
      log.error({ err: error }, "Error selecting tenant:");
      res.status(500).json({ error: error.message || "Failed to select tenant" });
    }
  });

  /** Neuen Mandanten anlegen (manageSettings). Ersteller wird zugewiesen und standardmäßig aktiv gesetzt. */
  app.post("/api/tenants", requireAuth, requireCsrf, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().trim().min(1, "Name required").max(120),
        setActive: z.boolean().optional(),
      });
      const { name, setActive } = schema.parse(req.body);
      const user = req.user as any;

      const existing = await storage.getTenantByName(name);
      if (existing) {
        return res.status(409).json({ error: "Tenant name already exists" });
      }

      const tenant = await storage.createTenant({ name });
      try {
        await storage.addUserToTenant({ tenantId: tenant.id, userId: user.id });
      } catch (assignErr) {
        log.warn({ err: assignErr }, "[POST /api/tenants] assign creator failed:");
      }

      let activeTenantId = user.activeTenantId ?? null;
      if (setActive !== false) {
        const updated = await storage.updateUser(user.id, { activeTenantId: tenant.id });
        activeTenantId = updated?.activeTenantId ?? tenant.id;
        (req.user as any).activeTenantId = activeTenantId;
      }

      res.status(201).json({ tenant, activeTenantId });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      log.error({ err: error }, "Error creating tenant:");
      res.status(500).json({ error: error.message || "Failed to create tenant" });
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
      log.error({ err: error }, "Error fetching assignable users:");
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
      log.error({ err: error }, "Error fetching users:");
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

      const assignedTenantId = await assignNewUserToTenant(req, user.id);
      const userSalesChannelIds = normalizeStoredSalesChannelIds(validated.salesChannelIds);
      
      await storage.updateUser(user.id, {
        role: role.name.toLowerCase() === "administrator" ? "admin" : "employee",
        roleId: validated.roleId,
        salesChannelIds: userSalesChannelIds,
        skills: validated.skills?.length ? validated.skills : null,
        ...(assignedTenantId ? { activeTenantId: assignedTenantId } : {}),
      });
      
      const updatedUser = await storage.getUser(user.id);
      const { password, ...userWithoutPassword } = updatedUser!;
      
      res.json({
        ...userWithoutPassword,
        roleId: validated.roleId,
        roleName: role.name,
      });
    } catch (error: any) {
      log.error({ err: error }, "Error creating user:");
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

      if (validated.salesChannelIds !== undefined) {
        updates.salesChannelIds = normalizeStoredSalesChannelIds(validated.salesChannelIds);
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
      log.error({ err: error }, "Error updating user:");
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
      log.error({ err: error }, "Error deleting user:");
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Role management routes (Requires manageRoles permission)
  app.get("/api/roles", requireAuth, requireManageRoles, async (req, res) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      log.error({ err: error }, "Error fetching roles:");
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
          manageAccounting: z.boolean(),
          viewInventory: z.boolean(),
          manageInventory: z.boolean(),
          viewPurchasing: z.boolean(),
          managePurchasing: z.boolean(),
          viewReturns: z.boolean(),
          manageReturns: z.boolean(),
          viewProduction: z.boolean(),
          manageProduction: z.boolean(),
          manageShippingLabels: z.boolean(),
        }),
      });
      
      const validated = roleSchema.parse(req.body);
      const role = await storage.createRole({
        ...validated,
        salesChannelIds: validated.salesChannelIds || null,
      });
      
      res.json(role);
    } catch (error: any) {
      log.error({ err: error }, "Error creating role:");
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
          manageAccounting: z.boolean(),
          viewInventory: z.boolean(),
          manageInventory: z.boolean(),
          viewPurchasing: z.boolean(),
          managePurchasing: z.boolean(),
          viewReturns: z.boolean(),
          manageReturns: z.boolean(),
          viewProduction: z.boolean(),
          manageProduction: z.boolean(),
          manageShippingLabels: z.boolean(),
        }).optional(),
      });
      
      const validated = roleSchema.parse(req.body);
      const role = await storage.updateRole(req.params.id, validated);
      
      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }
      
      res.json(role);
    } catch (error: any) {
      log.error({ err: error }, "Error updating role:");
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
      log.error({ err: error }, "Error deleting role:");
      res.status(500).json({ error: "Failed to delete role" });
    }
  });
}
