import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import bcrypt from "bcryptjs";
import passport from "passport";
import { storage } from "./storage";
import { ShopwareClient } from "./shopware";
import { RuleEngine } from "./ruleEngine";
import { shopwareSettingsSchema, insertCrossSellingRuleSchema, type Product, insertUserSchema, type Role } from "@shared/schema";
import { requireAuth, requireManageUsers, requireManageRoles, requireManageSettings, requireManageCrossSellingGroups, requireManageCrossSellingRules } from "./auth";
import * as XLSX from 'xlsx';

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ error: "Internal server error" });
      }
      
      if (!user) {
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      
      // Prevent session fixation attacks by regenerating session ID
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ error: "Failed to create session" });
        }
        
        req.logIn(user, (err) => {
          if (err) {
            return res.status(500).json({ error: "Failed to login" });
          }
          
          // Don't send password to client
          const { password, ...userWithoutPassword } = user;
          return res.json({ user: userWithoutPassword });
        });
      });
    })(req, res, next);
  });
  
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      
      // Destroy session for security
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ error: "Failed to destroy session" });
        }
        res.json({ message: "Logged out successfully" });
      });
    });
  });
  
  app.get("/api/auth/me", requireAuth, (req, res) => {
    if (req.user) {
      const { password, ...userWithoutPassword } = req.user as any;
      res.json({ user: userWithoutPassword });
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  // User management routes (Requires manageUsers permission)
  app.get("/api/users", requireManageUsers, async (req, res) => {
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

  app.post("/api/users", requireManageUsers, async (req, res) => {
    try {
      const validated = insertUserSchema.extend({
        roleId: z.string().min(1, "Role is required"),
        salesChannelIds: z.array(z.string()).optional(),
      }).parse(req.body);
      
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      
      const user = await storage.createUser({
        username: validated.username,
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

  app.patch("/api/users/:id", requireManageUsers, async (req, res) => {
    try {
      const updateSchema = z.object({
        username: z.string().min(3).optional(),
        password: z.string().min(6).optional(),
        roleId: z.string().optional(),
        salesChannelIds: z.array(z.string()).optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      const updates: any = { ...validated };
      
      if (validated.password) {
        updates.password = await bcrypt.hash(validated.password, 10);
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

  app.delete("/api/users/:id", requireManageUsers, async (req, res) => {
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
  app.get("/api/roles", requireManageRoles, async (req, res) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching roles:", error);
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  });

  app.post("/api/roles", requireManageRoles, async (req, res) => {
    try {
      const roleSchema = z.object({
        name: z.string().min(2),
        salesChannelIds: z.array(z.string()).optional(),
        permissions: z.object({
          viewOrders: z.boolean(),
          editOrders: z.boolean(),
          exportData: z.boolean(),
          viewAnalytics: z.boolean(),
          manageUsers: z.boolean(),
          manageRoles: z.boolean(),
          manageSettings: z.boolean(),
          manageCrossSellingGroups: z.boolean(),
          manageCrossSellingRules: z.boolean(),
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

  app.patch("/api/roles/:id", requireManageRoles, async (req, res) => {
    try {
      const roleSchema = z.object({
        name: z.string().min(2).optional(),
        salesChannelIds: z.array(z.string()).optional(),
        permissions: z.object({
          viewOrders: z.boolean(),
          editOrders: z.boolean(),
          exportData: z.boolean(),
          viewAnalytics: z.boolean(),
          manageUsers: z.boolean(),
          manageRoles: z.boolean(),
          manageSettings: z.boolean(),
          manageCrossSellingGroups: z.boolean(),
          manageCrossSellingRules: z.boolean(),
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

  app.delete("/api/roles/:id", requireManageRoles, async (req, res) => {
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
  app.get("/api/settings/shopware", async (req, res) => {
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

  app.post("/api/settings/shopware", async (req, res) => {
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

  app.post("/api/settings/shopware/test", async (req, res) => {
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
  app.get("/api/sales-channels", async (req, res) => {
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
  app.get("/api/orders", async (req, res) => {
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

  app.get("/api/orders/:orderId/documents", async (req, res) => {
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

  app.get("/api/orders/:orderId/document/:documentId/:deepLinkCode", async (req, res) => {
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
      
      // Determine if user should only see active products
      // Admin can see all products (active + inactive), others only see active
      const user = req.user as any;
      
      // Check both roleDetails.name (new system) and user.role (legacy fallback)
      const isAdmin = 
        user?.roleDetails?.name === 'Administrator' || 
        user?.role === 'admin';
      const activeOnly = !isAdmin;
      
      console.log(`[/api/products] User: ${user?.username}, Role: ${user?.roleDetails?.name || user?.role}, isAdmin: ${isAdmin}, activeOnly: ${activeOnly}`);
      
      const result = await client.fetchProducts(limit, page, search, activeOnly);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching products:", error);
      res.status(500).json({ error: error.message || "Failed to fetch products" });
    }
  });

  // Cross-Selling routes
  app.get("/api/products/:productId/cross-selling", async (req, res) => {
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

  app.post("/api/products/:productId/cross-selling", async (req, res) => {
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

  app.put("/api/products/:productId/cross-selling/:crossSellingId", async (req, res) => {
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

  app.delete("/api/products/:productId/cross-selling/:crossSellingId", async (req, res) => {
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
  app.get("/api/cross-selling-rules/available-fields", async (req, res) => {
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

  app.get("/api/cross-selling-rules", async (req, res) => {
    try {
      const rules = await storage.getAllCrossSellingRules();
      res.json({ rules });
    } catch (error: any) {
      console.error("Error fetching cross-selling rules:", error);
      res.status(500).json({ error: error.message || "Failed to fetch rules" });
    }
  });

  app.get("/api/cross-selling-rules/:id", async (req, res) => {
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

  app.post("/api/cross-selling-rules", async (req, res) => {
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

  app.put("/api/cross-selling-rules/:id", async (req, res) => {
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

  app.delete("/api/cross-selling-rules/:id", async (req, res) => {
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
  app.post("/api/cross-selling-rules/execute-bulk", requireAuth, async (req, res) => {
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

      // Fetch all products (limit to a reasonable amount)
      const productsResult = await client.fetchProducts(500, 1, undefined);
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
      
      // Search for the specific product
      const result = await client.fetchProducts(10, 1, productNumber);
      
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

      // Fetch the source product by ID
      console.log(`[Suggestions] Fetching source product ${productId}...`);
      const productResult = await client.fetchProducts(1, 1, undefined);
      
      // We need to fetch by ID, so let's do a small workaround
      // Try to search for the product by fetching it directly
      const allProductsResult = await client.fetchProducts(500, 1, undefined);
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

  const httpServer = createServer(app);

  return httpServer;
}
