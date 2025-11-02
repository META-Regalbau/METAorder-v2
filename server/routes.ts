import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import bcrypt from "bcryptjs";
import passport from "passport";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { storage } from "./storage";
import { ShopwareClient } from "./shopware";
import { RuleEngine } from "./ruleEngine";
import { shopwareSettingsSchema, insertCrossSellingRuleSchema, type Product, insertUserSchema, type Role, insertTicketSchema, insertTicketCommentSchema, insertTicketAssignmentRuleSchema, type Ticket, insertNotificationSchema } from "@shared/schema";
import { requireAuth, requireViewDelayedOrders, requireManageUsers, requireManageRoles, requireManageSettings, requireManageCrossSellingGroups, requireManageCrossSellingRules, requireViewTickets, requireManageTickets } from "./auth";
import * as XLSX from 'xlsx';
import { generateToken } from "./jwt";
import { parseEmailFile } from "./emailParser";
import { notificationEvents } from "./events";

// Rate limiter for login endpoint - prevents brute force attacks
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});

// Auto-assignment helper function
async function assignTicketAutomatically(ticket: Ticket): Promise<string | null> {
  try {
    const rules = await storage.getActiveTicketAssignmentRules();
    
    if (rules.length === 0) {
      return null; // No auto-assignment rules
    }

    // Sort by priority (highest first)
    const sortedRules = rules.sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (rule.assignmentType === 'round_robin') {
        // Round-robin: Find all users with manageTickets permission
        const allUsers = await storage.getAllUsers();
        const allRoles = await storage.getAllRoles();
        
        // Filter users with manageTickets permission
        const eligibleUsers = allUsers.filter(user => {
          if (user.roleId) {
            const userRole = allRoles.find(r => r.id === user.roleId);
            return userRole?.permissions?.manageTickets === true;
          }
          return false;
        });

        if (eligibleUsers.length === 0) continue;

        // Get all tickets to calculate round-robin
        const allTickets = await storage.getAllTickets();
        const assignedCounts = new Map<string, number>();
        
        // Count assignments per user
        eligibleUsers.forEach(user => assignedCounts.set(user.id, 0));
        allTickets.forEach(t => {
          if (t.assignedToUserId && assignedCounts.has(t.assignedToUserId)) {
            assignedCounts.set(t.assignedToUserId, (assignedCounts.get(t.assignedToUserId) || 0) + 1);
          }
        });

        // Find user with least assignments
        let minAssignments = Infinity;
        let selectedUserId: string | null = null;
        
        eligibleUsers.forEach(user => {
          const count = assignedCounts.get(user.id) || 0;
          if (count < minAssignments) {
            minAssignments = count;
            selectedUserId = user.id;
          }
        });

        if (selectedUserId) {
          return selectedUserId;
        }
      } else if (rule.assignmentType === 'rule_based' && rule.conditions) {
        // Rule-based assignment
        try {
          const conditions = JSON.parse(rule.conditions);
          
          // Check if all conditions match
          let conditionsMatch = true;
          
          if (conditions.priority && conditions.priority !== ticket.priority) {
            conditionsMatch = false;
          }
          if (conditions.category && conditions.category !== ticket.category) {
            conditionsMatch = false;
          }
          if (conditions.status && conditions.status !== ticket.status) {
            conditionsMatch = false;
          }
          
          if (conditionsMatch) {
            // Assign to specified user or role
            if (rule.assignToUserId) {
              return rule.assignToUserId;
            } else if (rule.assignToRoleId) {
              // Find first user with this role
              const allUsers = await storage.getAllUsers();
              const userWithRole = allUsers.find(u => u.roleId === rule.assignToRoleId);
              if (userWithRole) {
                return userWithRole.id;
              }
            }
          }
        } catch (error) {
          console.error("Error parsing rule conditions:", error);
          continue;
        }
      }
    }

    return null; // No matching rule
  } catch (error) {
    console.error("Error in auto-assignment:", error);
    return null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", loginRateLimiter, (req, res, next) => {
    console.log('[LOGIN] Login request received', { username: req.body?.username });
    passport.authenticate("local", (err: any, user: any, info: any) => {
      console.log('[LOGIN] Passport authenticate callback', { err: !!err, user: !!user, info });
      if (err) {
        console.error('[LOGIN] Authentication error:', err);
        return res.status(500).json({ error: "Internal server error" });
      }
      
      if (!user) {
        console.log('[LOGIN] No user found, invalid credentials');
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      
      console.log('[LOGIN] User authenticated successfully, generating tokens');
      // Generate JWT token
      const token = generateToken(user);
      
      // Generate CSRF token for Double-Submit Cookie Pattern
      const csrfToken = crypto.randomBytes(32).toString('hex');
      
      // Set JWT token in httpOnly cookie (XSS-safe)
      res.cookie('auth_token', token, {
        httpOnly: true,  // Cannot be accessed by JavaScript
        secure: true,    // HTTPS only (Replit always uses HTTPS)
        sameSite: 'lax', // CSRF protection while allowing same-site navigation
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });
      
      // Set CSRF token in non-httpOnly cookie (frontend can read it)
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false, // Frontend must read and send in X-CSRF-Token header
        secure: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
      
      // Don't send password to client
      const { password, ...userWithoutPassword } = user;
      
      return res.json({ 
        user: userWithoutPassword
        // Token is now in cookie, not in response body
      });
    })(req, res, next);
  });
  
  app.post("/api/auth/logout", (req, res) => {
    // Clear the auth cookie
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax'
    });
    // Clear CSRF token cookie
    res.clearCookie('csrf_token', {
      httpOnly: false,
      secure: true,
      sameSite: 'lax'
    });
    res.json({ message: "Logged out successfully" });
  });
  
  app.get("/api/auth/me", requireAuth, (req, res) => {
    // req.user is set by requireAuth middleware
    const { password, roleDetails, ...userWithoutPassword } = req.user as any;
    res.json({ 
      user: {
        ...userWithoutPassword,
        permissions: roleDetails?.permissions || {}
      }
    });
  });
  
  // Get JWT token from cookie (for SSE initialization)
  app.get("/api/auth/token", requireAuth, (req, res) => {
    // Read token from cookie and return it for SSE usage
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.status(401).json({ error: "No token found" });
    }
    res.json({ token });
  });

  // Get assignable users (for ticket assignment - requires manageTickets permission)
  app.get("/api/users/assignable", requireAuth, requireManageTickets, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      
      // Return only id + username for ticket assignment
      const assignableUsers = users.map(({ id, username }) => ({ id, username }));
      
      res.json(assignableUsers);
    } catch (error) {
      console.error("Error fetching assignable users:", error);
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
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAuth, requireManageUsers, async (req, res) => {
    try {
      const validated = insertUserSchema.extend({
        roleId: z.string().min(1, "Role is required"),
        salesChannelIds: z.array(z.string()).optional(),
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
      
      await storage.updateUser(user.id, {
        role: role.name.toLowerCase() === "administrator" ? "admin" : "employee",
        roleId: validated.roleId,
        salesChannelIds: validated.salesChannelIds || null,
      });
      
      const updatedUser = await storage.getUser(user.id);
      const { password, ...userWithoutPassword } = updatedUser!;
      
      res.json({
        ...userWithoutPassword,
        roleId: validated.roleId,
        roleName: role.name,
      });
    } catch (error: any) {
      console.error("Error creating user:", error);
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
      console.error("Error updating user:", error);
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
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Role management routes (Requires manageRoles permission)
  app.get("/api/roles", requireAuth, requireManageRoles, async (req, res) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching roles:", error);
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
        }),
      });
      
      const validated = roleSchema.parse(req.body);
      const role = await storage.createRole({
        ...validated,
        salesChannelIds: validated.salesChannelIds || null,
      });
      
      res.json(role);
    } catch (error: any) {
      console.error("Error creating role:", error);
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
        }).optional(),
      });
      
      const validated = roleSchema.parse(req.body);
      const role = await storage.updateRole(req.params.id, validated);
      
      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }
      
      res.json(role);
    } catch (error: any) {
      console.error("Error updating role:", error);
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
      console.error("Error deleting role:", error);
      res.status(500).json({ error: "Failed to delete role" });
    }
  });
  
  // Shopware settings routes
  app.get("/api/settings/shopware", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(404).json({ error: "No Shopware settings found" });
      }
      // Don't send the secret back to the frontend
      res.json({
        shopwareUrl: settings.shopwareUrl,
        apiKey: settings.apiKey,
        hasSecret: !!settings.apiSecret,
      });
    } catch (error) {
      console.error("Error fetching Shopware settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings/shopware", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const validated = shopwareSettingsSchema.parse(req.body);
      const settings = await storage.saveShopwareSettings(validated);
      
      res.json({
        message: "Settings saved successfully",
        shopwareUrl: settings.shopwareUrl,
      });
    } catch (error: any) {
      console.error("Error saving Shopware settings:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid settings data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/settings/shopware/test", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const validated = shopwareSettingsSchema.parse(req.body);
      const client = new ShopwareClient(validated);
      const isConnected = await client.testConnection();
      
      if (isConnected) {
        res.json({ success: true, message: "Connection successful" });
      } else {
        res.status(400).json({ success: false, error: "Failed to connect to Shopware" });
      }
    } catch (error: any) {
      console.error("Error testing Shopware connection:", error);
      res.status(500).json({ success: false, error: error.message || "Connection test failed" });
    }
  });

  // Sales channels routes
  app.get("/api/sales-channels", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const salesChannels = await client.fetchSalesChannels();
      
      res.json(salesChannels);
    } catch (error: any) {
      console.error("Error fetching sales channels:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales channels" });
    }
  });

  // Orders routes
  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrders();
      
      // Filter by sales channel if provided in query params
      const salesChannelIds = req.query.salesChannelIds as string | undefined;
      let filteredOrders = orders;
      
      if (salesChannelIds) {
        const channelIdsArray = salesChannelIds.split(',');
        filteredOrders = orders.filter(order => 
          channelIdsArray.includes(order.salesChannelId)
        );
      }
      
      res.json(filteredOrders);
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch orders" });
    }
  });

  // Delayed orders route
  app.get("/api/orders/delayed", requireAuth, requireViewDelayedOrders, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrders();
      
      // Default threshold: 3 days
      const daysThreshold = parseInt(req.query.days as string) || 3;
      const now = new Date();
      const thresholdDate = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000);
      
      // Filter delayed orders: deliveryDateLatest passed or order old, not completed/cancelled, and payment is paid
      const delayedOrders = orders
        .filter(order => {
          // Must not be completed or cancelled
          const isNotFinished = order.status !== 'completed' && order.status !== 'cancelled';
          
          // Payment must be paid (not failed, cancelled, or open)
          const hasValidPayment = order.paymentStatus === 'paid';
          
          if (!isNotFinished || !hasValidPayment) {
            return false;
          }
          
          // Check if delivery date is overdue or order is old
          if (order.deliveryDateLatest) {
            const deliveryDate = new Date(order.deliveryDateLatest);
            const isOverdue = deliveryDate < thresholdDate;
            return isOverdue;
          } else {
            // Fallback to order date if no delivery date
            const orderDate = new Date(order.orderDate);
            const isOld = orderDate < thresholdDate;
            return isOld;
          }
        })
        .map(order => {
          // Calculate days since expected delivery (or order date as fallback)
          const referenceDate = order.deliveryDateLatest 
            ? new Date(order.deliveryDateLatest)
            : new Date(order.orderDate);
          const daysSinceOrder = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
          
          return {
            ...order,
            daysSinceOrder,
          };
        })
        .sort((a, b) => {
          // Sort by delivery date (latest delivery date first = most overdue)
          const dateA = a.deliveryDateLatest ? new Date(a.deliveryDateLatest) : new Date(a.orderDate);
          const dateB = b.deliveryDateLatest ? new Date(b.deliveryDateLatest) : new Date(b.orderDate);
          return dateA.getTime() - dateB.getTime(); // Earliest date first (most overdue)
        });
      
      res.json(delayedOrders);
    } catch (error: any) {
      console.error("Error fetching delayed orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch delayed orders" });
    }
  });

  // Export orders endpoint
  app.post("/api/orders/export", requireAuth, async (req, res) => {
    try {
      // Validate request body
      const exportSchema = z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        format: z.enum(['csv', 'xlsx', 'json']),
        columns: z.array(z.string()).min(1, "At least one column must be selected"),
        salesChannelIds: z.array(z.string()).optional(), // Admin can select specific channels
      });

      const validated = exportSchema.parse(req.body);
      const { dateFrom, dateTo, format, columns, salesChannelIds } = validated;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allOrders = await client.fetchOrders();

      // Get user information
      const user = req.user as any;
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';

      // Filter by sales channel based on role
      let filteredOrders = allOrders;
      
      if (!isAdmin) {
        // Non-admin users: filter by their assigned sales channels
        const userChannels = user?.salesChannelIds || [];
        if (userChannels.length > 0) {
          filteredOrders = allOrders.filter(order => 
            userChannels.includes(order.salesChannelId)
          );
        } else {
          // If no channels assigned, return empty result
          filteredOrders = [];
        }
      } else if (salesChannelIds && salesChannelIds.length > 0) {
        // Admin users: optionally filter by selected sales channels
        filteredOrders = allOrders.filter(order => 
          salesChannelIds.includes(order.salesChannelId)
        );
      }

      // Filter by date range
      if (dateFrom || dateTo) {
        filteredOrders = filteredOrders.filter(order => {
          const orderDate = new Date(order.orderDate);
          if (dateFrom && orderDate < new Date(dateFrom)) return false;
          if (dateTo && orderDate > new Date(dateTo)) return false;
          return true;
        });
      }

      // Extract only selected columns
      const exportData = filteredOrders.map(order => {
        const row: any = {};
        columns.forEach((col: string) => {
          switch (col) {
            case 'orderNumber':
              row['Order Number'] = order.orderNumber;
              break;
            case 'customerName':
              row['Customer Name'] = order.customerName;
              break;
            case 'customerEmail':
              row['Customer Email'] = order.customerEmail;
              break;
            case 'orderDate':
              row['Order Date'] = new Date(order.orderDate).toLocaleDateString('de-DE');
              break;
            case 'status':
              row['Status'] = order.status;
              break;
            case 'totalAmount':
              row['Total Amount (Gross)'] = `€${order.totalAmount.toFixed(2)}`;
              break;
            case 'netTotalAmount':
              row['Total Amount (Net)'] = `€${(order.netTotalAmount || 0).toFixed(2)}`;
              break;
            case 'carrier':
              row['Carrier'] = order.shippingInfo?.carrier || '';
              break;
            case 'trackingNumber':
              row['Tracking Number'] = order.shippingInfo?.trackingNumber || '';
              break;
            case 'invoiceNumber':
              row['Invoice Number'] = order.invoiceNumber || '';
              break;
            case 'deliveryNoteNumber':
              row['Delivery Note Number'] = order.deliveryNoteNumber || '';
              break;
            case 'erpNumber':
              row['ERP Number'] = order.erpNumber || '';
              break;
          }
        });
        return row;
      });

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.json"`);
        res.send(JSON.stringify(exportData, null, 2));
      } else if (format === 'csv') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.csv"`);
        res.send('\uFEFF' + csv); // BOM for proper UTF-8 encoding in Excel
      } else if (format === 'xlsx') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
        
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.xlsx"`);
        res.send(buffer);
      } else {
        res.status(400).json({ error: 'Invalid format' });
      }
    } catch (error: any) {
      console.error("Error exporting orders:", error);
      
      // Handle Zod validation errors
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }
      
      res.status(500).json({ error: error.message || "Failed to export orders" });
    }
  });

  app.get("/api/orders/:orderId/documents", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const documents = await client.fetchOrderDocuments(req.params.orderId);
      
      res.json(documents);
    } catch (error: any) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: error.message || "Failed to fetch documents" });
    }
  });

  app.get("/api/orders/:orderId/document/:documentId/:deepLinkCode", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { documentId, deepLinkCode } = req.params;
      const client = new ShopwareClient(settings);
      
      const pdfBlob = await client.downloadDocumentPdf(documentId, deepLinkCode);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="document-${documentId}.pdf"`);
      res.send(Buffer.from(await pdfBlob.arrayBuffer()));
    } catch (error: any) {
      console.error("Error downloading document:", error);
      res.status(500).json({ error: error.message || "Failed to download document" });
    }
  });

  // Update order shipping information and set status to shipped
  app.patch("/api/orders/:orderId/shipping", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const shippingInfo = req.body;

      // Validate shipping info
      if (!shippingInfo.carrier && !shippingInfo.trackingNumber && !shippingInfo.shippedDate) {
        return res.status(400).json({ error: "At least one shipping field is required" });
      }

      const client = new ShopwareClient(settings);
      
      // Update shipping info and set status to shipped in Shopware
      await client.updateOrderShipping(orderId, shippingInfo);
      
      res.json({ 
        success: true,
        message: "Shipping information updated and order marked as shipped",
        orderId,
        shippingInfo
      });
    } catch (error: any) {
      console.error("Error updating order shipping:", error);
      res.status(500).json({ error: error.message || "Failed to update shipping information" });
    }
  });

  // Products routes
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Get pagination and search parameters
      const limit = parseInt(req.query.limit as string) || 100;
      const page = parseInt(req.query.page as string) || 1;
      const search = req.query.search as string | undefined;
      const categoryId = req.query.categoryId as string | undefined;
      
      // Get dimensions filter parameters
      const width = req.query.width ? parseFloat(req.query.width as string) : undefined;
      const height = req.query.height ? parseFloat(req.query.height as string) : undefined;
      const depth = req.query.depth ? parseFloat(req.query.depth as string) : undefined;
      
      // Determine if user is admin
      const user = req.user as any;
      
      // Check both roleDetails.name (new system) and user.role (legacy fallback)
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';
      
      // Admin-only: Check if user wants to see only inactive products
      const showInactive = isAdmin && req.query.showInactive === 'true';
      
      console.log(`[/api/products] User: ${user?.username}, Role: ${user?.roleDetails?.name || user?.role}, isAdmin: ${isAdmin}, showInactive: ${showInactive}, categoryId: ${categoryId || 'all'}, width: ${width || 'any'}, height: ${height || 'any'}, depth: ${depth || 'any'}`);
      
      const result = await client.fetchProducts(limit, page, search, categoryId, showInactive, width, height, depth, false);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching products:", error);
      res.status(500).json({ error: error.message || "Failed to fetch products" });
    }
  });

  // Categories route
  app.get("/api/categories", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const categories = await client.fetchCategories();
      res.json(categories);
    } catch (error: any) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: error.message || "Failed to fetch categories" });
    }
  });

  // Cross-Selling routes
  app.get("/api/products/:productId/cross-selling", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;
      
      console.log(`Fetching cross-selling for product ${productId}...`);
      const crossSellings = await client.fetchProductCrossSelling(productId);
      
      // Fetch products for each cross-selling group
      console.log(`Fetching products for ${crossSellings.length} cross-selling groups...`);
      const crossSellingsWithProducts = await Promise.all(
        crossSellings.map(async (cs) => {
          const products = await client.fetchCrossSellingProducts(productId, cs.id);
          return { ...cs, products };
        })
      );
      
      console.log('Final result:', JSON.stringify(crossSellingsWithProducts, null, 2));
      
      // Set cache headers to prevent 304 responses during debugging
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json({ crossSellings: crossSellingsWithProducts });
    } catch (error: any) {
      console.error("Error fetching cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to fetch cross-selling" });
    }
  });

  app.post("/api/products/:productId/cross-selling", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Validate request body
      const createSchema = z.object({
        name: z.string().min(1, "Name is required"),
        productIds: z.array(z.string()).default([]),
      });

      const validation = createSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;
      const { name, productIds } = validation.data;
      
      // Create cross-selling group
      const crossSellingId = await client.createProductCrossSelling(productId, name);
      
      // Assign products to the group
      if (productIds.length > 0) {
        await client.assignProductsToCrossSelling(crossSellingId, productIds);
      }
      
      res.json({ id: crossSellingId, message: "Cross-selling created successfully" });
    } catch (error: any) {
      console.error("Error creating cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to create cross-selling" });
    }
  });

  app.put("/api/products/:productId/cross-selling/:crossSellingId", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Validate request body
      const updateSchema = z.object({
        productIds: z.array(z.string()),
      });

      const validation = updateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const client = new ShopwareClient(settings);
      const { productId, crossSellingId } = req.params;
      const { productIds } = validation.data;
      
      console.log(`Updating cross-selling ${crossSellingId} for product ${productId}`);
      console.log(`New product IDs: ${JSON.stringify(productIds)}`);
      
      // Get current products to determine what to add/remove
      const currentProducts = await client.fetchCrossSellingProducts(productId, crossSellingId);
      const currentProductIds = currentProducts.map(p => p.id);
      
      console.log(`Current product IDs: ${JSON.stringify(currentProductIds)}`);
      
      // Determine which products to add and remove
      const toAdd = productIds.filter(id => !currentProductIds.includes(id));
      const toRemove = currentProductIds.filter(id => !productIds.includes(id));
      
      console.log(`Products to add: ${JSON.stringify(toAdd)}`);
      console.log(`Products to remove: ${JSON.stringify(toRemove)}`);
      
      // Update assignments
      if (toRemove.length > 0) {
        await client.removeProductsFromCrossSelling(crossSellingId, toRemove);
      }
      if (toAdd.length > 0) {
        console.log(`Calling assignProductsToCrossSelling with crossSellingId=${crossSellingId}, productIds=${JSON.stringify(toAdd)}`);
        await client.assignProductsToCrossSelling(crossSellingId, toAdd);
      }
      
      res.json({ message: "Cross-selling updated successfully" });
    } catch (error: any) {
      console.error("Error updating cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to update cross-selling" });
    }
  });

  app.delete("/api/products/:productId/cross-selling/:crossSellingId", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { crossSellingId } = req.params;
      
      await client.deleteProductCrossSelling(crossSellingId);
      
      res.json({ message: "Cross-selling deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to delete cross-selling" });
    }
  });

  // Cross-Selling Rules routes
  app.get("/api/cross-selling-rules/available-fields", requireAuth, requireManageCrossSellingGroups, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        // Return default fields if Shopware not configured
        return res.json({
          standardFields: [
            { field: 'name', label: 'Product Name', description: 'The product name' },
            { field: 'productNumber', label: 'Product Number', description: 'The unique product number/SKU' },
            { field: 'manufacturerNumber', label: 'Manufacturer Number', description: 'Manufacturer\'s product number' },
            { field: 'ean', label: 'EAN', description: 'European Article Number / Barcode' },
            { field: 'stock', label: 'Stock', description: 'Current stock level' },
            { field: 'available', label: 'Available', description: 'Product availability status' },
            { field: 'price', label: 'Price', description: 'Product price' },
            { field: 'weight', label: 'Weight', description: 'Product weight' },
            { field: 'dimensions.width', label: 'Width', description: 'Product width dimension' },
            { field: 'dimensions.height', label: 'Height', description: 'Product height dimension' },
            { field: 'dimensions.length', label: 'Length', description: 'Product length/depth dimension' },
            { field: 'categoryNames', label: 'Categories', description: 'Product categories (array)' },
            { field: 'manufacturer.name', label: 'Manufacturer Name', description: 'Name of the manufacturer' },
          ],
          customFields: []
        });
      }

      const shopware = new ShopwareClient(settings);
      const fields = await shopware.fetchAvailableFields();
      res.json(fields);
    } catch (error: any) {
      console.error("Error fetching available fields:", error);
      res.status(500).json({ error: error.message || "Failed to fetch available fields" });
    }
  });

  app.get("/api/cross-selling-rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const rules = await storage.getAllCrossSellingRules();
      res.json({ rules });
    } catch (error: any) {
      console.error("Error fetching cross-selling rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rules" });
    }
  });

  app.get("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const rule = await storage.getCrossSellingRule(req.params.id);
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      console.error("Error fetching cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rule" });
    }
  });

  app.post("/api/cross-selling-rules", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      // Validate request body
      const validation = insertCrossSellingRuleSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      // Convert arrays to JSON strings for storage
      const ruleData = {
        ...validation.data,
        sourceConditions: JSON.stringify(validation.data.sourceConditions),
        targetCriteria: JSON.stringify(validation.data.targetCriteria),
      } as any;

      const rule = await storage.createCrossSellingRule(ruleData);
      res.json(rule);
    } catch (error: any) {
      console.error("Error creating cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to create rule" });
    }
  });

  app.put("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      // Validate request body (partial updates allowed)
      const validation = insertCrossSellingRuleSchema.partial().safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      // Convert arrays to JSON strings for storage
      const updates: any = { ...validation.data };
      if (updates.sourceConditions) {
        updates.sourceConditions = JSON.stringify(updates.sourceConditions);
      }
      if (updates.targetCriteria) {
        updates.targetCriteria = JSON.stringify(updates.targetCriteria);
      }

      const rule = await storage.updateCrossSellingRule(req.params.id, updates);
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      console.error("Error updating cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to update rule" });
    }
  });

  app.delete("/api/cross-selling-rules/:id", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const deleted = await storage.deleteCrossSellingRule(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json({ message: "Rule deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting cross-selling rule:", error);
      res.status(500).json({ error: error.message || "Failed to delete rule" });
    }
  });

  // Bulk execution of cross-selling rules
  app.post("/api/cross-selling-rules/execute-bulk", requireAuth, requireManageCrossSellingRules, async (req, res) => {
    try {
      const { ruleId } = req.body; // Optional: if provided, only execute this rule
      
      console.log(`[Bulk Execution] Starting bulk execution${ruleId ? ` for rule ${ruleId}` : ' for all rules'}...`);
      
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const ruleEngine = new RuleEngine();

      // Fetch rules to execute
      const rules = ruleId 
        ? await storage.getCrossSellingRule(ruleId).then(r => r ? [r] : [])
        : await storage.getAllCrossSellingRules();
      
      if (rules.length === 0) {
        return res.status(404).json({ error: "No rules found" });
      }

      console.log(`[Bulk Execution] Executing ${rules.length} rule(s)...`);

      // Fetch all products (limit to a reasonable amount for performance) - include inactive for rule matching
      const productsResult = await client.fetchProducts(50, 1, undefined, undefined, false, undefined, undefined, undefined, true);
      const allProducts = productsResult.products;
      
      console.log(`[Bulk Execution] Processing ${allProducts.length} products...`);

      // Track results
      const results = {
        totalProducts: allProducts.length,
        productsProcessed: 0,
        crossSellingsCreated: 0,
        productsSkipped: 0,
        errors: [] as Array<{ productId: string; productName: string; error: string }>,
      };

      // Process each product
      for (const product of allProducts) {
        try {
          console.log(`[Bulk Execution] Processing product: ${product.name} (${product.productNumber})`);
          
          // Get cross-selling suggestions for this product using rule engine
          const suggestions = await ruleEngine.suggestCrossSelling(product, rules, client);
          
          if (suggestions.length === 0) {
            console.log(`[Bulk Execution] No suggestions for product ${product.name}`);
            results.productsSkipped++;
            results.productsProcessed++;
            continue;
          }

          console.log(`[Bulk Execution] Found ${suggestions.length} suggestions for product ${product.name}`);
          
          // Create or update cross-selling group in Shopware
          const crossSellingName = `Auto Cross-Selling (${new Date().toLocaleDateString()})`;
          
          try {
            // Create cross-selling group
            const crossSellingId = await client.createProductCrossSelling(product.id, crossSellingName);
            console.log(`[Bulk Execution] Created cross-selling group ${crossSellingId} for product ${product.name}`);
            
            // Assign suggested products
            const suggestionIds = suggestions.map(s => s.id);
            await client.assignProductsToCrossSelling(crossSellingId, suggestionIds);
            console.log(`[Bulk Execution] Assigned ${suggestionIds.length} products to cross-selling group`);
            
            results.crossSellingsCreated++;
          } catch (error: any) {
            console.error(`[Bulk Execution] Error creating cross-selling for product ${product.name}:`, error);
            results.errors.push({
              productId: product.id,
              productName: product.name,
              error: error.message || 'Unknown error',
            });
          }
          
          results.productsProcessed++;
        } catch (error: any) {
          console.error(`[Bulk Execution] Error processing product ${product.name}:`, error);
          results.errors.push({
            productId: product.id,
            productName: product.name,
            error: error.message || 'Unknown error',
          });
          results.productsProcessed++;
        }
      }

      console.log(`[Bulk Execution] Complete. Processed: ${results.productsProcessed}, Created: ${results.crossSellingsCreated}, Skipped: ${results.productsSkipped}, Errors: ${results.errors.length}`);
      
      res.json(results);
    } catch (error: any) {
      console.error("Error executing bulk cross-selling:", error);
      res.status(500).json({ error: error.message || "Failed to execute bulk cross-selling" });
    }
  });

  // DEBUG: Test endpoint to fetch a specific product by product number
  app.get("/api/debug/product/:productNumber", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productNumber } = req.params;
      
      console.log(`[DEBUG] Fetching product with productNumber: ${productNumber}`);
      
      // Search for the specific product - include inactive for debugging
      const result = await client.fetchProducts(10, 1, productNumber, undefined, false, undefined, undefined, undefined, true);
      
      console.log(`[DEBUG] Found ${result.products.length} products, total: ${result.total}`);
      if (result.products.length > 0) {
        console.log(`[DEBUG] Product:`, JSON.stringify(result.products[0], null, 2));
      }
      
      res.json({
        found: result.products.length > 0,
        total: result.total,
        product: result.products[0] || null,
      });
    } catch (error: any) {
      console.error("[DEBUG] Error fetching product:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cross-Selling Suggestions endpoint (rule-based)
  app.get("/api/products/:productId/cross-selling-suggestions", async (req, res) => {
    try {
      console.log(`[Suggestions] Generating cross-selling suggestions for product ${req.params.productId}...`);
      
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        console.log("[Suggestions] Shopware settings not configured");
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const { productId } = req.params;

      // Fetch the source product by ID - include inactive for suggestions
      console.log(`[Suggestions] Fetching source product ${productId}...`);
      const productResult = await client.fetchProducts(1, 1, undefined, undefined, false, undefined, undefined, undefined, true);
      
      // We need to fetch by ID, so let's do a small workaround
      // Try to search for the product by fetching it directly
      const allProductsResult = await client.fetchProducts(500, 1, undefined, undefined, false, undefined, undefined, undefined, true);
      const sourceProduct = allProductsResult.products.find(p => p.id === productId);

      if (!sourceProduct) {
        console.log(`[Suggestions] Source product ${productId} not found`);
        return res.status(404).json({ error: "Product not found" });
      }
      
      console.log(`[Suggestions] Source product found: ${sourceProduct.name} (${sourceProduct.productNumber})`);

      // Get all active rules
      const rules = await storage.getAllCrossSellingRules();
      console.log(`[Suggestions] Total rules in storage: ${rules.length}`);
      const activeRules = rules.filter(r => r.active === 1);
      console.log(`[Suggestions] Active rules: ${activeRules.length}`);

      if (activeRules.length === 0) {
        console.log("[Suggestions] No active rules found, returning empty suggestions");
        return res.json({ suggestions: [] });
      }
      
      console.log(`[Suggestions] Active rules details:`, JSON.stringify(activeRules, null, 2));

      // Apply rules to find suggestions using Shopware search
      const ruleEngine = new RuleEngine();
      console.log("[Suggestions] Applying rules to generate suggestions using Shopware search...");
      const suggestions = await ruleEngine.suggestCrossSelling(
        sourceProduct,
        activeRules,
        client
      );
      
      console.log(`[Suggestions] Generated ${suggestions.length} suggestions`);
      console.log(`[Suggestions] Suggestions:`, suggestions.map(s => `${s.name} (${s.productNumber})`).join(', '));

      res.json({ suggestions });
    } catch (error: any) {
      console.error("[Suggestions] Error generating cross-selling suggestions:", error);
      console.error("[Suggestions] Error stack:", error.stack);
      res.status(500).json({ error: error.message || "Failed to generate suggestions" });
    }
  });

  app.get("/api/orders/:orderId/invoice", async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const pdfBlob = await client.downloadInvoicePdf(req.params.orderId);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.orderId}.pdf"`);
      res.send(Buffer.from(await pdfBlob.arrayBuffer()));
    } catch (error: any) {
      console.error("Error downloading invoice:", error);
      res.status(500).json({ error: error.message || "Failed to download invoice" });
    }
  });

  // Analytics Endpoints
  app.get("/api/analytics/summary", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const salesChannelIdsParam = req.query.salesChannelIds as string | undefined;
      const salesChannelIds = salesChannelIdsParam ? salesChannelIdsParam.split(',') : undefined;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds);

      // Calculate summary metrics
      const totalOrders = orders.length;
      const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
      const totalNetRevenue = orders.reduce((sum, order) => sum + order.netTotalAmount, 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const averageNetOrderValue = totalOrders > 0 ? totalNetRevenue / totalOrders : 0;

      // Count unique customers
      const uniqueCustomers = new Set(orders.map(o => o.customerEmail || o.customerName)).size;

      res.json({
        totalOrders,
        totalRevenue,
        totalNetRevenue,
        averageOrderValue,
        averageNetOrderValue,
        uniqueCustomers,
        dateFrom,
        dateTo,
      });
    } catch (error: any) {
      console.error("Error fetching analytics summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch analytics summary" });
    }
  });

  app.get("/api/analytics/order-status", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const salesChannelIdsParam = req.query.salesChannelIds as string | undefined;
      const salesChannelIds = salesChannelIdsParam ? salesChannelIdsParam.split(',') : undefined;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds);

      // Group by order status
      const statusDistribution: Record<string, number> = {};
      orders.forEach(order => {
        statusDistribution[order.status] = (statusDistribution[order.status] || 0) + 1;
      });

      res.json(statusDistribution);
    } catch (error: any) {
      console.error("Error fetching order status distribution:", error);
      res.status(500).json({ error: error.message || "Failed to fetch order status distribution" });
    }
  });

  app.get("/api/analytics/payment-status", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const salesChannelIdsParam = req.query.salesChannelIds as string | undefined;
      const salesChannelIds = salesChannelIdsParam ? salesChannelIdsParam.split(',') : undefined;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds);

      // Group by payment status
      const paymentDistribution: Record<string, number> = {};
      orders.forEach(order => {
        paymentDistribution[order.paymentStatus] = (paymentDistribution[order.paymentStatus] || 0) + 1;
      });

      res.json(paymentDistribution);
    } catch (error: any) {
      console.error("Error fetching payment status distribution:", error);
      res.status(500).json({ error: error.message || "Failed to fetch payment status distribution" });
    }
  });

  app.get("/api/analytics/product-overview", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Fetch only count, not actual products - use limit 1 to minimize data transfer
      // Fetch active products count
      const activeResult = await client.fetchProducts(1, 1, undefined, undefined, false, undefined, undefined, undefined, false);
      const activeCount = activeResult.total || 0;
      
      // Fetch inactive products count by setting showInactive=true (which gives only inactive)
      const inactiveResult = await client.fetchProducts(1, 1, undefined, undefined, true, undefined, undefined, undefined, false);
      const inactiveCount = inactiveResult.total || 0;

      res.json({
        total: activeCount + inactiveCount,
        active: activeCount,
        inactive: inactiveCount,
      });
    } catch (error: any) {
      console.error("Error fetching product overview:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product overview" });
    }
  });

  app.get("/api/analytics/category-sales", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const salesChannelIdsParam = req.query.salesChannelIds as string | undefined;
      const salesChannelIds = salesChannelIdsParam ? salesChannelIdsParam.split(',') : undefined;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds);

      // Calculate sales by category
      const categorySales: Record<string, { revenue: number; netRevenue: number; quantity: number }> = {};
      
      orders.forEach(order => {
        order.items.forEach(item => {
          // Use product name as category if categoryNames not available
          const categories = item.categoryNames || ['Uncategorized'];
          
          categories.forEach(category => {
            if (!categorySales[category]) {
              categorySales[category] = { revenue: 0, netRevenue: 0, quantity: 0 };
            }
            categorySales[category].revenue += item.total;
            categorySales[category].netRevenue += item.netTotal;
            categorySales[category].quantity += item.quantity;
          });
        });
      });

      // Convert to array and sort by revenue
      const sortedCategories = Object.entries(categorySales)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue);

      res.json(sortedCategories);
    } catch (error: any) {
      console.error("Error fetching category sales:", error);
      res.status(500).json({ error: error.message || "Failed to fetch category sales" });
    }
  });

  app.get("/api/analytics/product-performance", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const salesChannelIdsParam = req.query.salesChannelIds as string | undefined;
      const salesChannelIds = salesChannelIdsParam ? salesChannelIdsParam.split(',') : undefined;
      const minQuantity = parseInt(req.query.minQuantity as string) || 1;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds);

      // Calculate product performance
      const productPerformance: Record<string, {
        name: string;
        totalQuantity: number;
        totalRevenue: number;
        totalNetRevenue: number;
        orderCount: number;
      }> = {};

      orders.forEach(order => {
        order.items.forEach(item => {
          const key = item.name;
          if (!productPerformance[key]) {
            productPerformance[key] = {
              name: item.name,
              totalQuantity: 0,
              totalRevenue: 0,
              totalNetRevenue: 0,
              orderCount: 0,
            };
          }
          productPerformance[key].totalQuantity += item.quantity;
          productPerformance[key].totalRevenue += item.total;
          productPerformance[key].totalNetRevenue += item.netTotal;
          productPerformance[key].orderCount += 1;
        });
      });

      // Filter by minimum quantity and sort by quantity
      const topProducts = Object.values(productPerformance)
        .filter(p => p.totalQuantity >= minQuantity)
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 50); // Top 50 products

      // Get bottom performers (Penner) - products with low sales
      const bottomProducts = Object.values(productPerformance)
        .filter(p => p.totalQuantity >= minQuantity)
        .sort((a, b) => a.totalQuantity - b.totalQuantity)
        .slice(0, 50); // Bottom 50 products

      res.json({
        topProducts,
        bottomProducts,
      });
    } catch (error: any) {
      console.error("Error fetching product performance:", error);
      res.status(500).json({ error: error.message || "Failed to fetch product performance" });
    }
  });

  app.get("/api/analytics/sales-trend", requireAuth, async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const salesChannelIdsParam = req.query.salesChannelIds as string | undefined;
      const salesChannelIds = salesChannelIdsParam ? salesChannelIdsParam.split(',') : undefined;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const orders = await client.fetchOrdersForAnalytics(dateFrom, dateTo, salesChannelIds);

      // Group by date
      const dailySales: Record<string, { date: string; revenue: number; netRevenue: number; orderCount: number }> = {};

      orders.forEach(order => {
        const date = order.orderDate.split('T')[0]; // Get date part only
        if (!dailySales[date]) {
          dailySales[date] = {
            date,
            revenue: 0,
            netRevenue: 0,
            orderCount: 0,
          };
        }
        dailySales[date].revenue += order.totalAmount;
        dailySales[date].netRevenue += order.netTotalAmount;
        dailySales[date].orderCount += 1;
      });

      // Convert to array and sort by date
      const trendData = Object.values(dailySales).sort((a, b) => a.date.localeCompare(b.date));

      res.json(trendData);
    } catch (error: any) {
      console.error("Error fetching sales trend:", error);
      res.status(500).json({ error: error.message || "Failed to fetch sales trend" });
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
      const user = req.user as any;
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';

      const tickets = await storage.getAllTickets();
      const users = await storage.getAllUsers();
      
      // Filter by sales channel based on role
      let filteredTickets = tickets;
      
      if (!isAdmin) {
        // Non-admin users: filter by their assigned sales channels
        const userChannels = user?.salesChannelIds || [];
        
        if (userChannels.length > 0) {
          // Get unique orderIds from all tickets
          const uniqueOrderIds = Array.from(new Set(tickets.filter(t => t.orderId).map(t => t.orderId!)));
          
          // Fetch only the orders that are referenced by tickets
          const settings = await storage.getShopwareSettings();
          let ordersBySalesChannel: Map<string, string> = new Map(); // orderId -> salesChannelId
          
          if (settings && uniqueOrderIds.length > 0) {
            try {
              const client = new ShopwareClient(settings);
              const ordersMap = await client.fetchOrdersByIds(uniqueOrderIds);
              
              // Convert to salesChannelId map
              ordersMap.forEach((order, orderId) => {
                ordersBySalesChannel.set(orderId, order.salesChannelId);
              });
            } catch (error) {
              console.error("Error fetching orders for ticket filtering:", error);
            }
          }
          
          // Filter tickets: include if orderId matches user's sales channels, or if no orderId (standalone tickets)
          filteredTickets = tickets.filter(ticket => {
            // Tickets without orderId are visible to all (standalone tickets)
            if (!ticket.orderId) {
              return true;
            }
            
            // Check if the order's sales channel matches user's assigned channels
            const orderSalesChannel = ordersBySalesChannel.get(ticket.orderId);
            return orderSalesChannel && userChannels.includes(orderSalesChannel);
          });
        } else {
          // If no channels assigned, return empty result (except standalone tickets)
          filteredTickets = tickets.filter(ticket => !ticket.orderId);
        }
      }
      
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
      
      res.json(ticketsWithDetails);
    } catch (error) {
      console.error("Error fetching tickets:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  // Get single ticket by ID
  app.get("/api/tickets/:id", requireAuth, requireViewTickets, async (req, res) => {
    try {
      const user = req.user as any;
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';

      const ticket = await storage.getTicket(req.params.id);
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      
      // Check sales channel access for non-admin users
      if (!isAdmin && ticket.orderId) {
        const userChannels = user?.salesChannelIds || [];
        
        if (userChannels.length > 0) {
          // Fetch the specific order to get salesChannelId
          const settings = await storage.getShopwareSettings();
          let hasAccess = false;
          
          if (settings && ticket.orderId) {
            try {
              const client = new ShopwareClient(settings);
              const ordersMap = await client.fetchOrdersByIds([ticket.orderId]);
              const order = ordersMap.get(ticket.orderId);
              
              if (order && userChannels.includes(order.salesChannelId)) {
                hasAccess = true;
              }
            } catch (error) {
              console.error("Error checking ticket access:", error);
            }
          }
          
          if (!hasAccess) {
            return res.status(403).json({ error: "You don't have access to this ticket" });
          }
        } else {
          // User has no sales channels assigned - no access to order-linked tickets
          return res.status(403).json({ error: "You don't have access to this ticket" });
        }
      }
      // Standalone tickets (no orderId) are accessible to all
      
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

  // Get tickets by order ID
  app.get("/api/orders/:orderId/tickets", requireAuth, async (req, res) => {
    try {
      const tickets = await storage.getTicketsByOrderId(req.params.orderId);
      res.json(tickets);
    } catch (error) {
      console.error("Error fetching tickets for order:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });

  // Get ticket counts for all orders
  app.get("/api/orders/ticket-counts", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';

      const tickets = await storage.getAllTickets();
      
      // Filter tickets by sales channel if not admin
      let filteredTickets = tickets;
      
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
              console.error("Error fetching orders for ticket count filtering:", error);
            }
          }
          
          // Filter tickets by sales channel
          filteredTickets = tickets.filter(ticket => {
            if (!ticket.orderId) return false; // Skip standalone tickets for counts
            const orderSalesChannel = ordersBySalesChannel.get(ticket.orderId);
            return orderSalesChannel && userChannels.includes(orderSalesChannel);
          });
        } else {
          filteredTickets = [];
        }
      }
      
      const ticketCounts: Record<string, number> = {};
      filteredTickets.forEach(ticket => {
        if (ticket.orderId) {
          ticketCounts[ticket.orderId] = (ticketCounts[ticket.orderId] || 0) + 1;
        }
      });
      
      res.json(ticketCounts);
    } catch (error) {
      console.error("Error fetching ticket counts:", error);
      res.status(500).json({ error: "Failed to fetch ticket counts" });
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
      
      let ticket = await storage.createTicket(validated);
      
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
          }
        }
      }
      
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

      // Update the ticket
      const updated = await storage.updateTicket(req.params.id, validated);
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
      
      const commentsWithUsernames = comments.map(comment => {
        const user = users.find(u => u.id === comment.userId);
        return {
          ...comment,
          username: user?.username || "Unknown",
        };
      });
      
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
      });
      
      const comment = await storage.createTicketComment(validated);
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

  // ============================================
  // Ticket Attachments Routes
  // ============================================

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
      const { filename, fileData, category, priority } = req.body;

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

  // ============================================
  // NOTIFICATIONS
  // ============================================

  // Get user's notifications
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      const notifications = await storage.getNotificationsByUserId(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // Server-Sent Events stream for real-time notifications
  app.get("/api/notifications/stream", async (req: Request, res: Response) => {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify JWT token
    let userId: string;
    try {
      const jwt = await import("./jwt");
      const decoded = jwt.verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ error: "Invalid token" });
      }
      userId = decoded.userId;
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    
    // Create notification listener
    const notificationListener = async ({ notification }: { notification: any }) => {
      // Only send notifications for this user
      if (notification.userId === userId) {
        res.write(`event: notification\n`);
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
      }
    };
    
    // Register listener
    notificationEvents.onNotificationCreated(notificationListener);
    
    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      res.write(`:heartbeat\n\n`);
    }, 30000);
    
    // Cleanup on connection close
    req.on("close", () => {
      clearInterval(heartbeatInterval);
      notificationEvents.removeNotificationCreatedListener(notificationListener);
    });
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req.user as any).id;
      
      // Verify notification belongs to user
      const notification = await storage.getNotificationsByUserId(userId);
      const found = notification.find(n => n.id === id);
      
      if (!found) {
        return res.status(404).json({ error: "Notification not found" });
      }
      
      const updated = await storage.markNotificationAsRead(id);
      res.json(updated);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const count = await storage.markAllNotificationsAsRead(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
