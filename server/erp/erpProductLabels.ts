/**
 * ERP: Shopware-Produktlabels (Nummer · Name · Größe · Farbe) und Suche.
 * Primär lokaler Spiegel (inkl. Inaktiver), Fallback Shopware-API.
 */
import type { Express } from "express";
import { z } from "zod";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { requireAuth, requireCsrf, requireManageInventory, requirePermission } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { shopwareProducts, type Product } from "@shared/schema";
import { ShopwareClient } from "../shopware";
import {
  buildErpProductLabel,
  type ErpProductLabel,
} from "@shared/productVariantLabel";

function requireTenantFromReq(req: any): string | null {
  return (req.tenantId as string | null | undefined) ?? (req.user as any)?.activeTenantId ?? null;
}

function allowAdminOr(permissionMw: ReturnType<typeof requirePermission>) {
  return (req: any, res: any, next: any) => {
    const user = req.user as any;
    const isAdmin =
      user?.roleDetails?.name === "Administrator" || user?.role === "admin";
    if (isAdmin) return next();
    return permissionMw(req, res, next);
  };
}

function optionsFromPayload(payload: unknown): Array<{ group: string; option: string }> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { options?: Array<{ group?: string; option?: string }> };
  if (!Array.isArray(p.options) || !p.options.length) return undefined;
  const mapped = p.options
    .map((o) => ({ group: String(o.group || "").trim(), option: String(o.option || "").trim() }))
    .filter((o) => o.option);
  return mapped.length ? mapped : undefined;
}

function propertiesFromPayload(
  payload: unknown,
): Array<{ groupName: string; optionName: string }> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as { properties?: Array<{ groupName?: string; optionName?: string }> };
  if (!Array.isArray(p.properties) || !p.properties.length) return undefined;
  const mapped = p.properties
    .map((o) => ({
      groupName: String(o.groupName || "").trim(),
      optionName: String(o.optionName || "").trim(),
    }))
    .filter((o) => o.optionName);
  return mapped.length ? mapped : undefined;
}

function isParentPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return Number((payload as { childCount?: number }).childCount ?? 0) > 0;
}

function parentIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { parentId?: string | null }).parentId;
  return id ? String(id) : null;
}

type MirrorRow = {
  shopwareId: string;
  productNumber: string;
  name: string | null;
  active: boolean | null;
  payload: unknown;
};

function labelFromMirrorRow(
  row: MirrorRow,
  parentNameById?: Map<string, string>,
): ErpProductLabel | null {
  const isParent = isParentPayload(row.payload);
  // Eltern mit Varianten nicht als buchbare SKU in der Suche
  if (isParent) return null;
  const parentId = parentIdFromPayload(row.payload);
  const parentName = parentId && parentNameById ? parentNameById.get(parentId) : undefined;
  return buildErpProductLabel({
    productNumber: row.productNumber,
    name: row.name,
    parentName,
    options: optionsFromPayload(row.payload),
    properties: propertiesFromPayload(row.payload),
    shopwareId: row.shopwareId,
    active: row.active,
    isParent: false,
  });
}

function flattenProductsForErp(products: Product[]): ErpProductLabel[] {
  const out: ErpProductLabel[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    if (p.variants && p.variants.length > 0) {
      for (const v of p.variants) {
        const pn = String(v.productNumber || "").trim();
        if (!pn || seen.has(pn)) continue;
        seen.add(pn);
        out.push(
          buildErpProductLabel({
            productNumber: pn,
            name: v.name || p.name,
            parentName: p.name,
            options: v.options,
            properties: p.properties,
            shopwareId: v.id || null,
            active: (v as { active?: boolean | null }).active ?? p.active ?? null,
          }),
        );
      }
      continue;
    }

    if ((p.childCount ?? 0) > 0) continue;

    const pn = String(p.productNumber || "").trim();
    if (!pn || seen.has(pn)) continue;
    seen.add(pn);
    out.push(
      buildErpProductLabel({
        productNumber: pn,
        name: p.name,
        properties: p.properties,
        shopwareId: p.id || null,
        active: p.active ?? null,
      }),
    );
  }

  return out;
}

async function loadParentNameMap(
  tenantId: string,
  parentIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(parentIds.filter(Boolean)));
  if (!unique.length) return map;
  const rows = await db
    .select({
      shopwareId: shopwareProducts.shopwareId,
      name: shopwareProducts.name,
    })
    .from(shopwareProducts)
    .where(
      and(eq(shopwareProducts.tenantId, tenantId), inArray(shopwareProducts.shopwareId, unique)),
    );
  for (const row of rows) {
    if (row.name) map.set(row.shopwareId, row.name);
  }
  return map;
}

async function searchMirrorProducts(
  tenantId: string | null,
  search: string,
  limit: number,
): Promise<ErpProductLabel[]> {
  if (!tenantId) return [];
  const q = `%${search}%`;
  const rows = await db
    .select({
      shopwareId: shopwareProducts.shopwareId,
      productNumber: shopwareProducts.productNumber,
      name: shopwareProducts.name,
      active: shopwareProducts.active,
      payload: shopwareProducts.payload,
    })
    .from(shopwareProducts)
    .where(
      and(
        eq(shopwareProducts.tenantId, tenantId),
        or(
          ilike(shopwareProducts.productNumber, q),
          ilike(shopwareProducts.name, q),
          sql`CAST(${shopwareProducts.payload} AS text) ILIKE ${q}`,
        ),
      ),
    )
    .limit(Math.min(limit * 4, 200));

  const parentIds = rows
    .map((r) => parentIdFromPayload(r.payload))
    .filter((id): id is string => !!id);
  const parentNames = await loadParentNameMap(tenantId, parentIds);

  const out: ErpProductLabel[] = [];
  const seen = new Set<string>();
  const needle = search.toLowerCase();
  for (const row of rows) {
    const label = labelFromMirrorRow(row, parentNames);
    if (!label || seen.has(label.productNumber)) continue;
    const hay = `${label.label} ${label.size || ""} ${label.color || ""} ${label.optionsLabel || ""} ${row.name || ""}`.toLowerCase();
    if (
      !hay.includes(needle) &&
      !row.productNumber.toLowerCase().includes(needle) &&
      !JSON.stringify(row.payload || {}).toLowerCase().includes(needle)
    ) {
      continue;
    }
    seen.add(label.productNumber);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

async function labelsFromMirror(
  tenantId: string | null,
  productNumbers: string[],
): Promise<Record<string, ErpProductLabel>> {
  const labels: Record<string, ErpProductLabel> = {};
  if (!tenantId || productNumbers.length === 0) return labels;

  // Chunks: Postgres inArray-Limits und große Mirror-Sets
  const CHUNK = 400;
  for (let i = 0; i < productNumbers.length; i += CHUNK) {
    const chunk = productNumbers.slice(i, i + CHUNK);
    const rows = await db
      .select({
        shopwareId: shopwareProducts.shopwareId,
        productNumber: shopwareProducts.productNumber,
        name: shopwareProducts.name,
        active: shopwareProducts.active,
        payload: shopwareProducts.payload,
      })
      .from(shopwareProducts)
      .where(
        and(
          eq(shopwareProducts.tenantId, tenantId),
          inArray(shopwareProducts.productNumber, chunk),
        ),
      );

    const parentIds = rows
      .map((r) => parentIdFromPayload(r.payload))
      .filter((id): id is string => !!id);
    const parentNames = await loadParentNameMap(tenantId, parentIds);

    for (const row of rows) {
      // Auch Parents labeln (für Anzeige), aber isParent markieren
      if (isParentPayload(row.payload)) {
        labels[row.productNumber] = buildErpProductLabel({
          productNumber: row.productNumber,
          name: row.name,
          shopwareId: row.shopwareId,
          active: row.active,
          isParent: true,
        });
        continue;
      }
      const label = labelFromMirrorRow(row, parentNames);
      if (label) labels[label.productNumber] = label;
    }
  }
  return labels;
}

/** Labels für Artikelnummern auflösen (Mirror + ggf. Shopware-Fallback). */
export async function resolveErpProductLabels(
  tenantId: string | null,
  productNumbers: string[],
  opts?: { shopwareFallback?: boolean },
): Promise<Record<string, ErpProductLabel>> {
  const unique = Array.from(
    new Set(productNumbers.map((n) => n.trim()).filter(Boolean)),
  );
  const labels: Record<string, ErpProductLabel> = {
    ...(await labelsFromMirror(tenantId, unique)),
  };

  if (opts?.shopwareFallback === false) {
    for (const pn of unique) {
      if (!labels[pn]) labels[pn] = buildErpProductLabel({ productNumber: pn });
    }
    return labels;
  }

  const missing = unique.filter((pn) => {
    const l = labels[pn];
    // Shopware nur bei fehlendem Mirror-Eintrag oder ohne Namen
    // (Größe/Farbe kommen aus Options/Name-Parse — nicht jeden SKU nachladen)
    return !l || !l.name;
  });
  const settings = await storage.getShopwareSettings(tenantId);
  if (settings && missing.length > 0) {
    try {
      const client = new ShopwareClient(settings);
      // Shopware-API in Chunks (fetchProductsByNumbers kann limitiert sein)
      const SW_CHUNK = 100;
      for (let i = 0; i < missing.length; i += SW_CHUNK) {
        const chunk = missing.slice(i, i + SW_CHUNK);
        const map = await client.fetchProductsByNumbers(chunk);
        for (const pn of chunk) {
          const p = map.get(pn) as
            | {
                id?: string;
                productNumber?: string;
                name?: string;
                active?: boolean | null;
                options?: Array<{ group: string; option: string }>;
                properties?: Array<{ groupName: string; optionName: string }>;
              }
            | undefined;
          const fromApi = buildErpProductLabel({
            productNumber: pn,
            name: p?.name,
            options: p?.options,
            properties: p?.properties,
            shopwareId: p?.id || labels[pn]?.shopwareId,
            active: p?.active ?? labels[pn]?.active,
          });
          const existing = labels[pn];
          labels[pn] = existing
            ? {
                ...fromApi,
                name: fromApi.name || existing.name,
                size: fromApi.size || existing.size,
                color: fromApi.color || existing.color,
                optionsLabel: fromApi.optionsLabel || existing.optionsLabel,
                shopwareId: fromApi.shopwareId || existing.shopwareId,
                active: fromApi.active ?? existing.active,
                label: buildErpProductLabel({
                  productNumber: pn,
                  name: fromApi.name || existing.name,
                  options: p?.options,
                  properties: p?.properties,
                  shopwareId: fromApi.shopwareId || existing.shopwareId,
                  active: fromApi.active ?? existing.active,
                }).label,
              }
            : fromApi;
        }
      }
    } catch (err) {
      console.warn("[erp/product-labels] Shopware fallback failed:", err);
    }
  }

  for (const pn of unique) {
    if (!labels[pn]) labels[pn] = buildErpProductLabel({ productNumber: pn });
  }
  return labels;
}

export function registerErpProductLabelRoutes(app: Express) {
  /** Suche für ERP-Autocomplete: Varianten flach, inkl. Inaktiver. */
  app.get("/api/erp/products/search", requireAuth, async (req, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
      if (search.length < 2) {
        return res.json({ products: [] as ErpProductLabel[] });
      }

      const tenantId = requireTenantFromReq(req);
      const fromMirror = await searchMirrorProducts(tenantId, search, limit);
      if (fromMirror.length >= Math.min(5, limit)) {
        return res.json({ products: fromMirror.slice(0, limit) });
      }

      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.json({ products: fromMirror });
      }

      const client = new ShopwareClient(settings);
      // includeInactive=true (beide), showInactive=false (nicht nur inaktiv)
      const result = await client.fetchProducts(
        limit,
        1,
        search,
        undefined,
        false, // showInactive
        undefined,
        undefined,
        undefined,
        true, // includeInactive
        undefined,
        false,
        true, // includeVariants
      );

      const fromApi = flattenProductsForErp(result.products);
      const merged = new Map<string, ErpProductLabel>();
      for (const p of [...fromMirror, ...fromApi]) {
        if (!merged.has(p.productNumber)) merged.set(p.productNumber, p);
      }
      res.json({ products: Array.from(merged.values()).slice(0, limit) });
    } catch (error: any) {
      console.error("[erp/products/search]", error);
      res.status(500).json({ error: error.message || "Product search failed" });
    }
  });

  /** Labels zu Artikelnummern (Name/Größe/Farbe/Active). */
  app.post("/api/erp/product-labels", requireAuth, requireCsrf, async (req, res) => {
    try {
      const schema = z.object({
        productNumbers: z.array(z.string()).max(2000),
      });
      const { productNumbers } = schema.parse(req.body);
      const unique = Array.from(
        new Set(productNumbers.map((n) => n.trim()).filter(Boolean)),
      ).slice(0, 2000);

      if (unique.length === 0) {
        return res.json({ labels: {} as Record<string, ErpProductLabel> });
      }

      const tenantId = requireTenantFromReq(req);
      const labels = await resolveErpProductLabels(tenantId, unique);
      res.json({ labels });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid body" });
      }
      console.error("[erp/product-labels]", error);
      res.status(500).json({ error: error.message || "Failed to resolve labels" });
    }
  });

  /**
   * ERP: Variante aktiv/inaktiv in Shopware umstellen (über Artikelnummer oder Shopware-ID).
   * Aktualisiert danach den lokalen Spiegel.
   */
  app.patch(
    "/api/erp/products/active",
    requireAuth,
    requireCsrf,
    allowAdminOr(requireManageInventory),
    async (req, res) => {
      try {
        const schema = z.object({
          active: z.boolean(),
          productNumber: z.string().optional(),
          shopwareId: z.string().optional(),
        });
        const body = schema.parse(req.body);
        if (!body.productNumber && !body.shopwareId) {
          return res.status(400).json({ error: "productNumber or shopwareId required" });
        }

        const tenantId = requireTenantFromReq(req);
        if (!tenantId) {
          return res.status(400).json({ error: "Tenant required" });
        }
        let shopwareId = body.shopwareId?.trim() || "";
        let productNumber = body.productNumber?.trim() || "";

        if (!shopwareId && productNumber) {
          const rows = await db
            .select({
              shopwareId: shopwareProducts.shopwareId,
              productNumber: shopwareProducts.productNumber,
            })
            .from(shopwareProducts)
            .where(
              and(
                eq(shopwareProducts.tenantId, tenantId),
                eq(shopwareProducts.productNumber, productNumber),
              ),
            )
            .limit(1);
          if (!rows[0]) {
            return res.status(404).json({ error: "Product not found in mirror" });
          }
          shopwareId = rows[0].shopwareId;
          productNumber = rows[0].productNumber;
        }

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const client = new ShopwareClient(settings);
        await client.setProductActive(shopwareId, body.active);

        await db
          .update(shopwareProducts)
          .set({
            active: body.active,
            syncedAt: new Date(),
          })
          .where(
            and(
              eq(shopwareProducts.tenantId, tenantId),
              eq(shopwareProducts.shopwareId, shopwareId),
            ),
          );

        res.json({
          success: true,
          active: body.active,
          shopwareId,
          productNumber: productNumber || null,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors[0]?.message || "Invalid body" });
        }
        console.error("[erp/products/active]", error);
        res.status(500).json({ error: error.message || "Failed to update active status" });
      }
    },
  );
}
