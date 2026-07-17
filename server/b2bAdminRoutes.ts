import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { User } from "@shared/schema";
import { mergeB2BEntityMapping, type B2BEntityMapping } from "@shared/b2bEntityMapping";
import { DEFAULT_B2B_ENTITY_MAPPING } from "@shared/b2bEntityMapping";
import {
  requireAuth,
  requireManageSettings,
  requireViewB2B,
  requireManageB2B,
  requireApproveB2BBudgets,
  requireCsrf,
} from "./auth";
import { storage } from "./storage";
import {
  B2BSellersAdminClient,
  createB2BAdminClient,
  getStoredB2BEntityMapping,
} from "./b2bSellersAdmin";
import { getB2BCompaniesCached } from "./b2bCompaniesCache";
import { webhookService } from "./webhookService";
import { productCache } from "./productCache";
import { ShopwareClient } from "./shopware";
import {
  createB2BPortalUsersBatch,
  createB2BPortalUser,
  updateB2BPortalUser,
  verifyB2BPortalUser,
  resolveExistingPortalCustomer,
  DEFAULT_META_ADDRESS,
  getB2BPortalUserSettings,
  saveB2BPortalUserSettings,
} from "./b2bPortalUserService";
import {
  buildB2BPortalUserTemplateBuffer,
  buildPortalUserInputsFromImport,
  parseB2BPortalUserRowsFromBuffer,
} from "./b2bUserImport";

import { getTenantIdFromContext } from "./tenantContext";

async function getAdminClient(tenantId?: string | null): Promise<B2BSellersAdminClient> {
  const settings = await storage.getShopwareSettings(tenantId ?? getTenantIdFromContext());
  if (!settings) {
    throw new Error("Shopware settings not configured");
  }
  return createB2BAdminClient(settings);
}

function getUserId(req: Request): string | null {
  return (req.user as User | undefined)?.id ?? null;
}

type B2BAdminRouteOptions = {
  getSalesChannelFilter: (req: Request) => Promise<string[] | null>;
};

function parseRequestedSalesChannelIds(req: Request): string[] {
  const raw = req.query.salesChannelIds;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

type CrmCustomerByEmail = { id: string; tags: string[] };

async function buildCrmCustomerByEmailMap(tenantId?: string | null): Promise<Map<string, CrmCustomerByEmail>> {
  const rows = await storage.getAllCustomers(tenantId);
  const map = new Map<string, CrmCustomerByEmail>();
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email) continue;
    map.set(email, {
      id: row.id,
      tags: row.tags?.filter(Boolean) ?? [],
    });
  }
  return map;
}

function resolveCrmCustomerByEmail(
  map: Map<string, CrmCustomerByEmail>,
  email: string | null | undefined,
): { crmCustomerId: string | null; tags: string[] } {
  const key = email?.trim().toLowerCase();
  if (!key) return { crmCustomerId: null, tags: [] };
  const match = map.get(key);
  return {
    crmCustomerId: match?.id ?? null,
    tags: match?.tags ?? [],
  };
}

async function resolveCompanySalesChannelIds(
  req: Request,
  getSalesChannelFilter: B2BAdminRouteOptions["getSalesChannelFilter"],
): Promise<string[] | undefined | "denied"> {
  const allowedChannelIds = await getSalesChannelFilter(req);
  const requestedChannelIds = parseRequestedSalesChannelIds(req);

  if (allowedChannelIds === null) {
    return requestedChannelIds.length > 0 ? requestedChannelIds : undefined;
  }
  if (allowedChannelIds.length === 0) {
    return "denied";
  }
  if (requestedChannelIds.length > 0) {
    const filtered = requestedChannelIds.filter((id) => allowedChannelIds.includes(id));
    return filtered.length > 0 ? filtered : "denied";
  }
  return allowedChannelIds;
}

async function getShopwareClient(tenantId?: string | null): Promise<ShopwareClient> {
  const settings = await storage.getShopwareSettings(tenantId ?? getTenantIdFromContext());
  if (!settings) {
    throw new Error("Shopware settings not configured");
  }
  return new ShopwareClient(settings);
}

const portalUserTypeSchema = z.enum(["company", "dealer", "sales_rep"]);

const portalAddressSchema = z.object({
  company: z.string().optional(),
  street: z.string().min(1),
  zipCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
});

const portalUserPayloadSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  type: portalUserTypeSchema,
  isSupervisor: z.boolean().optional(),
  groupId: z.string().min(1),
  salesChannelId: z.string().min(1),
  address: portalAddressSchema,
  metaCompanyCustomerId: z.string().optional(),
  supervisorRoleId: z.string().optional(),
  sendEmails: z.boolean().optional(),
});

const portalUserImportDefaultsSchema = z.object({
  password: z.string().optional(),
  defaultType: portalUserTypeSchema,
  defaultSupervisor: z.boolean().optional(),
  groupIdCompany: z.string().min(1),
  groupIdDealer: z.string().min(1),
  groupIdSalesRep: z.string().min(1),
  salesChannelId: z.string().min(1),
  address: portalAddressSchema,
  metaCompanyCustomerId: z.string().optional(),
  supervisorRoleId: z.string().optional(),
});

function parseMultipartBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

async function resolvePortalUserSendEmails(bodyValue: unknown): Promise<boolean> {
  if (typeof bodyValue === "boolean") return bodyValue;
  if (bodyValue === "true" || bodyValue === "1" || bodyValue === 1) return true;
  if (bodyValue === "false" || bodyValue === "0" || bodyValue === 0) return false;
  const settings = await getB2BPortalUserSettings();
  return settings.sendEmails;
}

export function registerB2BAdminRoutes(app: Express, options: B2BAdminRouteOptions): void {
  app.get("/api/settings/b2b-entity-mapping", requireAuth, requireManageSettings, async (_req, res) => {
    try {
      const stored = (await storage.getSetting("b2b.entityMapping")) as Partial<B2BEntityMapping> | undefined;
      const mapping = mergeB2BEntityMapping(stored);
      res.json({ mapping, defaults: DEFAULT_B2B_ENTITY_MAPPING, stored: stored || null });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch B2B entity mapping" });
    }
  });

  app.post("/api/settings/b2b-entity-mapping", requireAuth, requireManageSettings, async (req, res) => {
    try {
      const schema = z.object({
        company: z.string().min(1).optional(),
        employee: z.string().min(1).optional(),
        employeeRole: z.string().min(1).optional(),
        employeePermission: z.string().min(1).optional(),
        employeeCustomer: z.string().min(1).optional(),
        budget: z.string().min(1).optional(),
        budgetEmployee: z.string().min(1).optional(),
        customerPrice: z.string().min(1).optional(),
        productList: z.string().min(1).optional(),
        productListItem: z.string().min(1).optional(),
        productListType: z.string().min(1).optional(),
        customerProductNumber: z.string().min(1).optional(),
        productExplodedView: z.string().min(1).optional(),
        productExplodedViewItem: z.string().min(1).optional(),
        employeeOrder: z.string().min(1).optional(),
      });
      const validated = schema.parse(req.body);
      const normalized = mergeB2BEntityMapping(validated);
      await storage.saveSetting("b2b.entityMapping", normalized);
      res.json({ mapping: normalized });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to save B2B entity mapping" });
    }
  });

  app.get("/api/b2b/entity-mapping", requireAuth, requireViewB2B, async (_req, res) => {
    try {
      const mapping = await getStoredB2BEntityMapping();
      res.json({ mapping });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch entity mapping" });
    }
  });

  // --- Companies & employees ---
  app.get("/api/b2b/companies", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const salesChannelIds = await resolveCompanySalesChannelIds(req, options.getSalesChannelFilter);
      if (salesChannelIds === "denied") {
        return res.json({ companies: [], total: 0 });
      }
      const tenantId = (req as any).tenantId ?? null;
      const client = await getAdminClient(tenantId);
      const search = (req.query.search as string) || undefined;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;

      const result = await getB2BCompaniesCached(client, {
        search,
        page,
        limit,
        salesChannelIds,
        tenantId,
      });
      const crmByEmail = await buildCrmCustomerByEmailMap(tenantId);
      res.json({
        companies: result.companies.map((company) => ({
          ...company,
          ...resolveCrmCustomerByEmail(crmByEmail, company.email),
        })),
        total: result.total,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch companies" });
    }
  });

  app.get("/api/b2b/companies/:companyId", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const client = await getAdminClient(tenantId);
      const detail = await client.fetchCompanyDetail(req.params.companyId);
      const crmCustomer = detail.email
        ? await storage.getCustomerByEmail(detail.email, tenantId)
        : undefined;
      res.json({
        ...detail,
        crmCustomerId: crmCustomer?.id ?? null,
        tags: crmCustomer?.tags?.filter(Boolean) ?? [],
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch company detail" });
    }
  });

  app.get("/api/b2b/companies/:companyId/employees", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchEmployees({
        customerId: req.params.companyId,
        search: (req.query.search as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch employees" });
    }
  });

  app.get("/api/b2b/employees", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchEmployees({
        search: (req.query.search as string) || undefined,
        customerId: (req.query.customerId as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch employees" });
    }
  });

  app.post("/api/b2b/employees", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        languageId: z.string().min(1),
        salutationId: z.string().optional(),
        department: z.string().optional(),
        phoneNumber: z.string().optional(),
        active: z.boolean().optional(),
        customerId: z.string().optional(),
      });
      const body = schema.parse(req.body);
      const tenantId = getTenantIdFromContext();
      const [client, shopwareClient] = await Promise.all([
        getAdminClient(tenantId),
        getShopwareClient(tenantId),
      ]);
      const { customerId, ...employeePayload } = body;
      const salutationId = employeePayload.salutationId?.trim() || (await shopwareClient.getDefaultSalutationId());
      const created = await client.createEntity("employee", {
        ...employeePayload,
        salutationId,
        active: employeePayload.active ?? true,
      });
      if (customerId) {
        await client.createEntity("employeeCustomer", {
          employeeId: created.id,
          customerId,
        });
      }
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to create employee" });
    }
  });

  app.patch("/api/b2b/employees/:id", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      await client.patchEntity("employee", req.params.id, req.body);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update employee" });
    }
  });

  app.post("/api/b2b/employees/:id/deactivate", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      await client.setEmployeeActive(req.params.id, false);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to deactivate employee" });
    }
  });

  app.post("/api/b2b/employees/:id/activate", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      await client.setEmployeeActive(req.params.id, true);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to activate employee" });
    }
  });

  app.delete("/api/b2b/employees/:id", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      await client.deleteEmployee(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete employee" });
    }
  });

  app.get("/api/b2b/roles", requireAuth, requireViewB2B, async (_req, res) => {
    try {
      const client = await getAdminClient();
      const roles = await client.fetchRoles();
      res.json({ roles });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch roles" });
    }
  });

  app.get("/api/b2b/customer-groups", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const client = await getShopwareClient(tenantId);
      const groups = await client.fetchCustomerGroups();
      res.json({ groups });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch customer groups" });
    }
  });

  app.get("/api/b2b/portal-users/settings", requireAuth, requireViewB2B, async (_req, res) => {
    try {
      const settings = await getB2BPortalUserSettings();
      res.json({ settings });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch portal user settings" });
    }
  });

  app.post("/api/b2b/portal-users/settings", requireAuth, requireCsrf, requireManageB2B, async (req, res) => {
    try {
      const body = z.object({ sendEmails: z.boolean() }).parse(req.body);
      const settings = await saveB2BPortalUserSettings({ sendEmails: body.sendEmails });
      res.json({ settings });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to save portal user settings" });
    }
  });

  app.get("/api/b2b/portal-users/template", requireAuth, requireManageB2B, async (_req, res) => {
    try {
      const buffer = buildB2BPortalUserTemplateBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="b2b-portal-users-template.xlsx"');
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to build template" });
    }
  });

  app.post("/api/b2b/portal-users", requireAuth, requireCsrf, requireManageB2B, async (req, res) => {
    try {
      const body = portalUserPayloadSchema.parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const [shopwareClient, b2bClient] = await Promise.all([
        getShopwareClient(tenantId),
        getAdminClient(tenantId),
      ]);

      if (body.type === "sales_rep" && !body.metaCompanyCustomerId) {
        return res.status(400).json({ error: "META-Firma ist für Vertriebsmitarbeiter erforderlich" });
      }
      if (body.type === "sales_rep" && body.isSupervisor && !body.supervisorRoleId) {
        return res.status(400).json({ error: "Supervisor-Rolle ist erforderlich" });
      }

      const sendEmails = await resolvePortalUserSendEmails(body.sendEmails);

      const result = await createB2BPortalUser(
        { shopwareClient, b2bClient },
        {
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          password: body.password,
          type: body.type,
          isSupervisor: body.isSupervisor,
          groupId: body.groupId,
          salesChannelId: body.salesChannelId,
          address: body.address,
          metaCompanyCustomerId: body.metaCompanyCustomerId,
          supervisorRoleId: body.supervisorRoleId,
        },
        { apply: true, verifyLogin: true, sendEmails },
      );

      if (result.status === "error") {
        return res.status(400).json({ error: result.message || "Anlage fehlgeschlagen", result });
      }
      if (result.status === "skipped_duplicate") {
        return res.status(409).json({ error: result.message || "E-Mail bereits vergeben", result });
      }

      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to create portal user" });
    }
  });

  app.patch("/api/b2b/portal-users", requireAuth, requireCsrf, requireManageB2B, async (req, res) => {
    try {
      const body = portalUserPayloadSchema.extend({ password: z.string().min(6).optional() }).parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const [shopwareClient, b2bClient] = await Promise.all([
        getShopwareClient(tenantId),
        getAdminClient(tenantId),
      ]);

      const existingCustomer = await resolveExistingPortalCustomer(
        { shopwareClient, b2bClient },
        body.email.trim().toLowerCase(),
        { type: body.type, metaCompanyCustomerId: body.metaCompanyCustomerId },
      );
      if (!existingCustomer) {
        return res.status(404).json({ error: "Kein Kunde oder B2B-Mitarbeiter mit dieser E-Mail gefunden" });
      }

      if (body.type === "sales_rep" && !body.metaCompanyCustomerId) {
        return res.status(400).json({ error: "META-Firma ist für Vertriebsmitarbeiter erforderlich" });
      }
      if (body.type === "sales_rep" && body.isSupervisor && !body.supervisorRoleId) {
        return res.status(400).json({ error: "Supervisor-Rolle ist erforderlich" });
      }

      const sendEmails = await resolvePortalUserSendEmails(body.sendEmails);

      const result = await updateB2BPortalUser(
        { shopwareClient, b2bClient },
        {
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          password: body.password ?? "",
          type: body.type,
          isSupervisor: body.isSupervisor,
          groupId: body.groupId,
          salesChannelId: body.salesChannelId,
          address: body.address,
          metaCompanyCustomerId: body.metaCompanyCustomerId,
          supervisorRoleId: body.supervisorRoleId,
        },
        { id: existingCustomer.id },
        { apply: true, verifyLogin: true, sendEmails },
      );

      if (result.status === "error") {
        return res.status(400).json({ error: result.message || "Update fehlgeschlagen", result });
      }

      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to update portal user" });
    }
  });

  app.post("/api/b2b/portal-users/verify", requireAuth, requireCsrf, requireManageB2B, async (req, res) => {
    try {
      const body = portalUserPayloadSchema
        .extend({ password: z.string().min(6) })
        .parse(req.body);
      const tenantId = (req as any).tenantId ?? null;
      const [shopwareClient, b2bClient] = await Promise.all([
        getShopwareClient(tenantId),
        getAdminClient(tenantId),
      ]);

      if (body.type === "sales_rep" && !body.metaCompanyCustomerId) {
        return res.status(400).json({ error: "META-Firma ist für Vertriebsmitarbeiter erforderlich" });
      }

      const existing = await shopwareClient.findCustomerByEmail(body.email.trim().toLowerCase());
      const result = await verifyB2BPortalUser(
        { shopwareClient, b2bClient },
        {
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          password: body.password,
          type: body.type,
          isSupervisor: body.isSupervisor,
          groupId: body.groupId,
          salesChannelId: body.salesChannelId,
          address: body.address,
          metaCompanyCustomerId: body.metaCompanyCustomerId,
          supervisorRoleId: body.supervisorRoleId,
          customerId: existing ? String(existing.id || existing.attributes?.id) : undefined,
        },
        { testLogin: true, password: body.password },
      );

      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Login verification failed" });
    }
  });

  const portalUserUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });

  app.post(
    "/api/b2b/portal-users/import",
    requireAuth,
    requireCsrf,
    requireManageB2B,
    portalUserUpload.single("file"),
    async (req, res) => {
      try {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file?.buffer) {
          return res.status(400).json({ error: "Keine Excel-Datei hochgeladen" });
        }

        const apply = parseMultipartBoolean(req.body?.apply);
        const updateExisting = parseMultipartBoolean(req.body?.updateExisting);
        const importPassword = String(req.body?.password || "").trim();
        if (!updateExisting && importPassword.length < 6) {
          return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
        }

        const defaults = portalUserImportDefaultsSchema.parse({
          password: importPassword || undefined,
          defaultType: req.body?.defaultType,
          defaultSupervisor: parseMultipartBoolean(req.body?.defaultSupervisor),
          groupIdCompany: req.body?.groupIdCompany,
          groupIdDealer: req.body?.groupIdDealer,
          groupIdSalesRep: req.body?.groupIdSalesRep,
          salesChannelId: req.body?.salesChannelId,
          address: {
            company: req.body?.addressCompany || DEFAULT_META_ADDRESS.company,
            street: req.body?.addressStreet || DEFAULT_META_ADDRESS.street,
            zipCode: req.body?.addressZipCode || DEFAULT_META_ADDRESS.zipCode,
            city: req.body?.addressCity || DEFAULT_META_ADDRESS.city,
            country: req.body?.addressCountry || DEFAULT_META_ADDRESS.country,
          },
          metaCompanyCustomerId: req.body?.metaCompanyCustomerId || undefined,
          supervisorRoleId: req.body?.supervisorRoleId || undefined,
        });

        if (defaults.defaultType === "sales_rep" && !defaults.metaCompanyCustomerId) {
          return res.status(400).json({ error: "META-Firma ist für Vertriebsmitarbeiter erforderlich" });
        }
        if (defaults.defaultType === "sales_rep" && defaults.defaultSupervisor && !defaults.supervisorRoleId) {
          return res.status(400).json({ error: "Supervisor-Rolle ist erforderlich" });
        }

        let parsed;
        try {
          parsed = parseB2BPortalUserRowsFromBuffer(file.buffer);
        } catch (parseError: any) {
          return res.status(400).json({ error: parseError?.message || "Excel konnte nicht gelesen werden" });
        }

        if (parsed.rows.length === 0) {
          return res.status(400).json({
            error: "Keine gültigen Zeilen in der Excel-Datei gefunden",
            parseErrors: parsed.parseErrors,
          });
        }

        const tenantId = (req as any).tenantId ?? null;
        const [shopwareClient, b2bClient] = await Promise.all([
          getShopwareClient(tenantId),
          getAdminClient(tenantId),
        ]);

        const sendEmails = await resolvePortalUserSendEmails(req.body?.sendEmails);

        const inputs = buildPortalUserInputsFromImport(parsed, {
          password: defaults.password || "",
          defaultType: defaults.defaultType,
          defaultSupervisor: defaults.defaultSupervisor ?? false,
          groupIdByType: {
            company: defaults.groupIdCompany,
            dealer: defaults.groupIdDealer,
            sales_rep: defaults.groupIdSalesRep,
          },
          salesChannelId: defaults.salesChannelId,
          address: defaults.address,
          metaCompanyCustomerId: defaults.metaCompanyCustomerId,
          supervisorRoleId: defaults.supervisorRoleId,
        });

        const result = await createB2BPortalUsersBatch(
          { shopwareClient, b2bClient },
          inputs,
          { apply, updateExisting, verifyLogin: apply, sendEmails },
        );

        res.json({
          ...result,
          parseErrors: parsed.parseErrors,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({ error: error.message || "Portal-user import failed" });
      }
    },
  );

  // --- Budgets & approvals ---
  app.get("/api/b2b/budgets", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchBudgets({
        customerId: (req.query.customerId as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch budgets" });
    }
  });

  app.post("/api/b2b/budgets", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        sum: z.number().positive(),
        customerId: z.string().min(1),
        active: z.boolean().optional(),
      });
      const body = schema.parse(req.body);
      const client = await getAdminClient();
      const created = await client.createEntity("budget", { ...body, active: body.active ?? true });
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to create budget" });
    }
  });

  app.patch("/api/b2b/budgets/:id", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      await client.patchEntity("budget", req.params.id, req.body);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update budget" });
    }
  });

  app.get("/api/b2b/approvals", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const tenantId = (req as any).tenantId ?? null;
      const [pending, auditLog] = await Promise.all([
        client.fetchPendingApprovals({
          page: Number(req.query.page) || 1,
          limit: Number(req.query.limit) || 50,
        }),
        storage.listB2bApprovalLogs(tenantId, { limit: 50 }),
      ]);
      res.json({ ...pending, auditLog });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch approvals" });
    }
  });

  app.post("/api/b2b/approvals/:id/approve", requireAuth, requireApproveB2BBudgets, async (req, res) => {
    try {
      const client = await getAdminClient();
      const tenantId = (req as any).tenantId ?? null;
      const comment = typeof req.body?.comment === "string" ? req.body.comment : undefined;
      await client.patchEntity("employeeOrder", req.params.id, { status: "approved" });
      const log = await storage.createB2bApprovalLog(
        {
          shopwareReferenceId: req.params.id,
          referenceType: "employee_order",
          action: "approve",
          status: "completed",
          actorUserId: getUserId(req),
          comment,
          payload: req.body ?? null,
        },
        tenantId,
      );
      webhookService
        .trigger(
          "b2b.approval_decided",
          {
            referenceId: req.params.id,
            referenceType: "employee_order",
            decision: "approved",
            actorUserId: getUserId(req),
            decidedAt: new Date().toISOString(),
          },
          { source: "b2b_admin" },
        )
        .catch((err) => console.error("[B2B] webhook b2b.approval_decided:", err));
      res.json({ success: true, log });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to approve" });
    }
  });

  app.post("/api/b2b/approvals/:id/reject", requireAuth, requireApproveB2BBudgets, async (req, res) => {
    try {
      const client = await getAdminClient();
      const tenantId = (req as any).tenantId ?? null;
      const comment = typeof req.body?.comment === "string" ? req.body.comment : undefined;
      await client.patchEntity("employeeOrder", req.params.id, { status: "rejected" });
      const log = await storage.createB2bApprovalLog(
        {
          shopwareReferenceId: req.params.id,
          referenceType: "employee_order",
          action: "reject",
          status: "completed",
          actorUserId: getUserId(req),
          comment,
          payload: req.body ?? null,
        },
        tenantId,
      );
      webhookService
        .trigger(
          "b2b.approval_decided",
          {
            referenceId: req.params.id,
            referenceType: "employee_order",
            decision: "rejected",
            actorUserId: getUserId(req),
            decidedAt: new Date().toISOString(),
          },
          { source: "b2b_admin" },
        )
        .catch((err) => console.error("[B2B] webhook b2b.approval_decided:", err));
      res.json({ success: true, log });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to reject" });
    }
  });

  // --- Assortments & customer SKUs ---
  app.get("/api/b2b/assortments", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchAssortments({
        customerId: (req.query.customerId as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch assortments" });
    }
  });

  app.get("/api/b2b/customer-skus", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchCustomerSkus({
        customerId: (req.query.customerId as string) || undefined,
        search: (req.query.search as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch customer SKUs" });
    }
  });

  app.post("/api/b2b/customer-skus", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const schema = z.object({
        customerId: z.string().min(1),
        productId: z.string().min(1),
        customerProductNumber: z.string().min(1),
      });
      const body = schema.parse(req.body);
      const client = await getAdminClient();
      const created = await client.createEntity("customerProductNumber", body);
      res.status(201).json(created);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to create customer SKU" });
    }
  });

  app.delete("/api/b2b/customer-skus/:id", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      await client.deleteEntity("customerProductNumber", req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete customer SKU" });
    }
  });

  // --- Shopping lists / reorder ---
  app.get("/api/b2b/shopping-lists", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchProductLists({
        customerId: (req.query.customerId as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch shopping lists" });
    }
  });

  app.get("/api/b2b/shopping-lists/:id/items", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const items = await client.fetchProductListItems(req.params.id);
      res.json({ items });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch list items" });
    }
  });

  app.post("/api/b2b/shopping-lists/:id/reorder", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const bodySchema = z.object({
        customerId: z.string().optional(),
        createDraft: z.boolean().optional().default(true),
      });
      const { customerId, createDraft } = bodySchema.parse(req.body ?? {});
      const tenantId = (req as any).tenantId ?? null;
      const client = await getAdminClient();
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const cacheStatus = productCache.getStatus();
      if (!cacheStatus.isPopulated) {
        const swClient = new ShopwareClient(settings);
        await productCache.refresh(swClient);
      }
      const items = await client.fetchProductListItems(req.params.id);
      const lineItems = items
        .filter((i) => i.productId)
        .map((i) => ({ productId: i.productId as string, quantity: i.quantity || 1 }));

      const matchingItems = lineItems.map((li) => {
        const product = productCache.getProductById(li.productId);
        return {
          extractedProductName: product?.name || li.productId,
          extractedProductNumber: product?.productNumber,
          quantity: li.quantity,
          matchedProduct: product
            ? {
                id: product.id,
                productNumber: product.productNumber,
                name: product.name,
                price: product.price ?? 0,
              }
            : undefined,
          confidence: product ? 100 : 0,
          status: product ? "matched" : "not_found",
        };
      });

      let draftId: string | undefined;
      if (createDraft && matchingItems.some((m) => m.matchedProduct)) {
        const draft = await storage.createOrderDraft(
          {
            status: "approved",
            originalFileName: `b2b-shopping-list-${req.params.id}.json`,
            extractedData: {
              lineItems: matchingItems.map((m) => ({
                extractedProductName: m.extractedProductName,
                extractedProductNumber: m.extractedProductNumber,
                quantity: m.quantity,
              })),
              orderNotes: `Reorder from B2B shopping list ${req.params.id}`,
            },
            matchingResults: { items: matchingItems, overallConfidence: 100 },
            shopwareCustomerId: customerId,
            createdByUserId: getUserId(req) ?? undefined,
          },
          tenantId,
        );
        draftId = draft.id;
      }

      res.json({
        listId: req.params.id,
        lineItems,
        draftId,
        message: draftId
          ? "Order draft created from shopping list"
          : "Line items prepared for order draft / Shopware order creation",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to prepare reorder" });
    }
  });

  // --- Quick order CSV / barcode ---
  app.post("/api/b2b/quick-order/match", requireAuth, requireManageB2B, async (req, res) => {
    try {
      const schema = z.object({
        rows: z.array(
          z.object({
            identifier: z.string().min(1),
            quantity: z.number().positive().default(1),
          }),
        ),
        customerId: z.string().optional(),
      });
      const { rows, customerId } = schema.parse(req.body);
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const cacheStatus = productCache.getStatus();
      if (!cacheStatus.isPopulated) {
        const client = new ShopwareClient(settings);
        await productCache.refresh(client);
      }
      const client = await getAdminClient();
      let customerSkus: { customerProductNumber: string; productId: string | null }[] = [];
      if (customerId) {
        try {
          const skuResult = await client.fetchCustomerSkus({ customerId, limit: 500 });
          customerSkus = skuResult.skus.map((s) => ({
            customerProductNumber: s.customerProductNumber,
            productId: s.productId,
          }));
        } catch {
          /* optional */
        }
      }
      const skuMap = new Map(
        customerSkus.map((s) => [s.customerProductNumber.toLowerCase(), s.productId]),
      );
      const matched = rows.map((row) => {
        const id = row.identifier.trim();
        const lower = id.toLowerCase();
        let product =
          productCache.getProductByIdentifier(id) ||
          productCache.getProductByNumber(id) ||
          productCache.getProductByManufacturerNumber(id) ||
          productCache.getProducts().find((p) => p.ean === id);
        if (!product && skuMap.has(lower)) {
          const pid = skuMap.get(lower);
          if (pid) product = productCache.getProductById(pid);
        }
        return {
          identifier: id,
          quantity: row.quantity,
          matched: Boolean(product),
          productId: product?.id ?? null,
          productNumber: product?.productNumber ?? null,
          productName: product?.name ?? null,
        };
      });
      res.json({ matched, summary: { total: matched.length, found: matched.filter((m) => m.matched).length } });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message || "Failed to match quick order rows" });
    }
  });

  app.get("/api/b2b/quick-order/barcode/:code", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const cacheStatus = productCache.getStatus();
      if (!cacheStatus.isPopulated) {
        const swClient = new ShopwareClient(settings);
        await productCache.refresh(swClient);
      }
      const code = req.params.code.trim();
      const product =
        productCache.getProductByIdentifier(code) ||
        productCache.getProducts().find((p) => p.ean === code);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json({
        productId: product.id,
        productNumber: product.productNumber,
        name: product.name,
        ean: product.ean,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Barcode lookup failed" });
    }
  });

  // --- Exploded views ---
  app.get("/api/b2b/exploded-views", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const result = await client.fetchExplodedViews({
        search: (req.query.search as string) || undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch exploded views" });
    }
  });

  app.get("/api/b2b/exploded-views/:id/items", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const client = await getAdminClient();
      const items = await client.fetchExplodedViewItems(req.params.id);
      res.json({ items });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch exploded view items" });
    }
  });
}
