import bcrypt from "bcryptjs";
import type { IStorage } from "./storage";

export async function seedDatabase(storage: IStorage) {
  try {
    const ensureTenant = async (name: string) => {
      const existing = await storage.getTenantByName(name);
      if (existing) return existing;
      console.log(`Creating tenant: ${name}...`);
      return storage.createTenant({ name });
    };

    const devTenant = await ensureTenant("Dev");
    await ensureTenant("Testing");
    await ensureTenant("Live");

    // Create default roles first
    const roles = await storage.getAllRoles();
    
    if (roles.length === 0) {
      console.log("Seeding default roles...");
      
      const administratorRole = await storage.createRole({
        name: "Administrator",
        salesChannelIds: null,
        permissions: {
          viewOrders: true,
          editOrders: true,
          exportData: true,
          viewAnalytics: true,
          viewDelayedOrders: true,
          viewShipping: true,
          manageUsers: true,
          manageRoles: true,
          manageSettings: true,
          manageCrossSellingGroups: true,
          manageCrossSellingRules: true,
          viewTickets: true,
          manageTickets: true,
          manageAutomations: true,
          manageOrderDrafts: true,
          viewOffers: true,
          manageOffers: true,
          viewNaturalLanguageAnalytics: true,
          viewDocuments: true,
          manageDocuments: true,
          manageProducts: true,
          viewAccounting: true,
          viewCrm: true,
          manageCrm: true,
          approveCrm: true,
          viewCPQ: true,
          manageCPQ: true,
          manageCPQDiscountLevels: true,
          approveCPQQuotes: true,
          viewB2B: true,
          manageB2B: true,
          approveB2BBudgets: true,
        },
      });
      
      const employeeRole = await storage.createRole({
        name: "Employee",
        salesChannelIds: null,
        permissions: {
          viewOrders: true,
          editOrders: true,
          exportData: false,
          viewAnalytics: false,
          viewDelayedOrders: false,
          viewShipping: false,
          manageUsers: false,
          manageRoles: false,
          manageSettings: false,
          manageCrossSellingGroups: false,
          manageCrossSellingRules: false,
          viewTickets: true,
          manageTickets: false,
          manageAutomations: false,
          manageOrderDrafts: false,
          viewOffers: false,
          manageOffers: false,
          viewNaturalLanguageAnalytics: false,
          viewDocuments: false,
          manageDocuments: false,
          manageProducts: false,
          viewAccounting: false,
          viewCrm: true,
          manageCrm: true,
          approveCrm: false,
          viewCPQ: false,
          manageCPQ: false,
          manageCPQDiscountLevels: false,
          approveCPQQuotes: false,
          viewB2B: false,
          manageB2B: false,
          approveB2BBudgets: false,
        },
      });
      
      const warehouseManagerRole = await storage.createRole({
        name: "Warehouse Manager",
        salesChannelIds: null,
        permissions: {
          viewOrders: true,
          editOrders: true,
          exportData: true,
          viewAnalytics: true,
          viewDelayedOrders: true,
          viewShipping: true,
          manageUsers: false,
          manageRoles: false,
          manageSettings: false,
          manageCrossSellingGroups: true,
          manageCrossSellingRules: true,
          viewTickets: true,
          manageTickets: false,
          manageAutomations: false,
          manageOrderDrafts: true,
          viewOffers: true,
          manageOffers: true,
          viewNaturalLanguageAnalytics: false,
          viewDocuments: true,
          manageDocuments: true,
          manageProducts: false,
          viewAccounting: false,
          viewCrm: true,
          manageCrm: true,
          approveCrm: false,
          viewCPQ: true,
          manageCPQ: false,
          manageCPQDiscountLevels: false,
          approveCPQQuotes: false,
          viewB2B: true,
          manageB2B: true,
          approveB2BBudgets: false,
        },
      });

      await storage.createRole({
        name: "Accounting",
        salesChannelIds: null,
        permissions: {
          viewOrders: false,
          editOrders: false,
          exportData: false,
          viewAnalytics: false,
          viewDelayedOrders: false,
          viewShipping: false,
          manageUsers: false,
          manageRoles: false,
          manageSettings: false,
          manageCrossSellingGroups: false,
          manageCrossSellingRules: false,
          viewTickets: false,
          manageTickets: false,
          manageAutomations: false,
          manageOrderDrafts: false,
          viewOffers: false,
          manageOffers: false,
          viewNaturalLanguageAnalytics: false,
          viewDocuments: false,
          manageDocuments: false,
          manageProducts: false,
          viewAccounting: true,
          viewCrm: false,
          manageCrm: false,
          approveCrm: false,
          viewCPQ: false,
          manageCPQ: false,
          manageCPQDiscountLevels: false,
          approveCPQQuotes: false,
          viewB2B: false,
          manageB2B: false,
          approveB2BBudgets: false,
        },
      });
      
      console.log("Default roles created!");
      
      // Check if admin user already exists
      const existingAdmin = await storage.getUserByUsername("admin");
      
      if (!existingAdmin) {
        console.log("Seeding initial users...");
        
        // Create admin user
        const adminPassword = await bcrypt.hash("admin123", 10);
        const adminUser = await storage.createUser({
          username: "admin",
          password: adminPassword,
        });
        
        await storage.updateUser(adminUser.id, {
          role: "admin",
          roleId: administratorRole.id,
          salesChannelIds: null,
        });
        
        // Create employee user for Austria
        const employeePassword = await bcrypt.hash("employee123", 10);
        const austriaEmployee = await storage.createUser({
          username: "austria",
          password: employeePassword,
        });
        
        await storage.updateUser(austriaEmployee.id, {
          role: "employee",
          roleId: employeeRole.id,
          salesChannelIds: ["0190b599291076e3beecdfca3d1b1b30"],
        });
        
        // Create employee user for Poland
        const polandEmployee = await storage.createUser({
          username: "poland",
          password: employeePassword,
        });
        
        await storage.updateUser(polandEmployee.id, {
          role: "employee",
          roleId: employeeRole.id,
          salesChannelIds: ["0193595640017e1ab0b5ae3313b4181c"],
        });
        
        console.log("Database seeded successfully!");
        console.log("Admin credentials: username=admin, password=admin123");
        console.log("Employee credentials: username=austria/poland, password=employee123");
      }
    }

    // Seed process updates (internal FAQ/news) if none exist
    const existingProcessUpdates = await storage.getProcessUpdates();
    if (existingProcessUpdates.length === 0) {
      console.log("Seeding process updates...");
      const allUsers = await storage.getAllUsers();
      const adminUser = allUsers.find((user) => user.username === "admin");
      const createdByUserId = adminUser?.id ?? null;

      const now = new Date();
      await storage.createProcessUpdate({
        title: "Neue Versandrichtlinie ab sofort",
        content:
          "Bitte prüfen Sie die Versandetiketten vor dem Druck. Änderungen betreffen die Sendungsauswahl und die Pflichtfelder für internationale Lieferungen.",
        tags: ["Versand", "Compliance"],
        effectiveDate: now,
        createdByUserId,
      });

      await storage.createProcessUpdate({
        title: "Reklamationen: Neuer Ablauf",
        content:
          "Reklamationen werden ab sofort über das Ticket-Formular mit dem Tag \"Reklamation\" erfasst. Bitte immer Fotos als Anhang hinzufügen.",
        tags: ["Support", "Reklamation"],
        effectiveDate: now,
        createdByUserId,
      });
    }

    // Initialize webhook configurations for all event types
    const webhookConfigs = await storage.getAllWebhookConfigs();
    const existingEventTypes = new Set(webhookConfigs.map((config) => config.eventType));
    const eventTypes = [
      'ticket.created',
      'ticket.updated',
      'ticket.commented',
      'ticket.assigned',
      'ticket.customer_replied',
      'ticket.agent_replied',
      'order.ready_to_ship',
      'document.created',
      'commercial.draft_created',
      'commercial.draft_review_required',
      'commercial.auto_offer_created',
      'commercial.auto_order_created',
      'b2b.approval_required',
      'b2b.approval_decided',
    ] as const;

    for (const eventType of eventTypes) {
      if (existingEventTypes.has(eventType)) continue;
      await storage.upsertWebhookConfig({
        eventType,
        targetUrl: null,
        enabled: 0 as 0,
        secret: null,
        maxAttempts: 3,
        initialBackoffMs: 1000,
        backoffFactor: 2.0,
        timeoutMs: 10000,
      });
    }

    // Ensure N8N Service role and account exist (for webhook integrations)
    const allRoles = await storage.getAllRoles();
    let n8nServiceRole = allRoles.find(r => r.name === "N8N Service");
    
    if (!n8nServiceRole) {
      console.log("Creating N8N Service role...");
      n8nServiceRole = await storage.createRole({
        name: "N8N Service",
        salesChannelIds: null, // Service accounts have no sales channel restrictions
        permissions: {
          viewOrders: true,
          editOrders: false,
          exportData: false,
          viewAnalytics: false,
          viewDelayedOrders: false,
          viewShipping: false,
          manageUsers: false,
          manageRoles: false,
          manageSettings: false,
          manageCrossSellingGroups: false,
          manageCrossSellingRules: false,
          viewTickets: true, // Can view tickets for context
          manageTickets: true, // Can create/update tickets (primary purpose)
          manageAutomations: false,
          manageOrderDrafts: true,
          viewOffers: true,
          manageOffers: true,
          viewNaturalLanguageAnalytics: false,
          viewDocuments: false,
          manageDocuments: false,
          manageProducts: false,
          viewAccounting: false,
          viewCrm: false,
          manageCrm: false,
          approveCrm: false,
          viewCPQ: false,
          manageCPQ: false,
          manageCPQDiscountLevels: false,
          approveCPQQuotes: false,
          viewB2B: true,
          manageB2B: true,
          approveB2BBudgets: false,
        },
      });
      console.log("N8N Service role created!");
    } else {
      const p = n8nServiceRole.permissions as Record<string, boolean>;
      if (!p.manageOffers || !p.manageOrderDrafts || !p.viewOffers || !p.viewOrders) {
        await storage.updateRole(n8nServiceRole.id, {
          permissions: {
            ...n8nServiceRole.permissions,
            viewOffers: true,
            manageOffers: true,
            viewOrders: true,
            manageOrderDrafts: true,
          },
        });
        console.log("N8N Service role: Commercial-/Entwurfs-Rechte ergänzt.");
      }
    }
    
    // Check if n8n-service user exists — separate try/catch so a missing
    // N8N_SERVICE_PASSWORD doesn't prevent tenant assignments below.
    const existingN8NUser = await storage.getUserByUsername("n8n-service");
    if (!existingN8NUser) {
      try {
        if (!process.env.N8N_SERVICE_PASSWORD) {
          console.warn("WARNING: N8N_SERVICE_PASSWORD not set — skipping n8n-service account creation");
          console.warn("Set N8N_SERVICE_PASSWORD to enable the n8n integration account");
        } else {
          console.log("Creating n8n-service user...");
          const hashedPassword = await bcrypt.hash(process.env.N8N_SERVICE_PASSWORD, 10);

          const n8nUser = await storage.createUser({
            username: "n8n-service",
            email: "n8n-service@metaorder.internal",
            password: hashedPassword,
          });

          await storage.updateUser(n8nUser.id, {
            roleId: n8nServiceRole.id,
            salesChannelIds: null,
          });

          console.log("n8n-service user created successfully!");
        }
      } catch (n8nError) {
        console.error("Error creating n8n-service account (non-fatal):", n8nError);
      }
    }

    const allUsers = await storage.getAllUsers();
    const allTenants = await storage.getAllTenants();
    for (const user of allUsers) {
      const userTenants = await storage.getTenantsForUser(user.id);
      const userTenantIds = new Set(userTenants.map((tenant) => tenant.id));
      const role = user.roleId ? await storage.getRole(user.roleId) : undefined;
      const isAdmin = user.role === "admin" || role?.name === "Administrator";

      if (isAdmin) {
        for (const tenant of allTenants) {
          if (!userTenantIds.has(tenant.id)) {
            await storage.addUserToTenant({
              tenantId: tenant.id,
              userId: user.id,
            });
          }
        }
      } else if (userTenants.length === 0) {
        await storage.addUserToTenant({
          tenantId: devTenant.id,
          userId: user.id,
        });
      }

      if (!user.activeTenantId) {
        await storage.updateUser(user.id, { activeTenantId: devTenant.id });
      }
    }
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
