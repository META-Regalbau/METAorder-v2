/**
 * Regalplaner META CLIP: Abgleich der Produkt-Mappings mit dem Shop-Spiegel (shopware_products) eines Mandanten.
 * Soll-Stand und Vergleich: clipCatalogSync.ts. Aufruf über POST /api/cpq/admin/clip-catalog-sync (CPQ-Admin)
 * oder scripts/syncCpqClipCatalog.ts.
 *
 * Ohne apply nur Vorschau. Mit apply entsteht ein Protokoll (angelegte IDs, Stand vorher der geänderten und
 * deaktivierten Mappings), mit dem revertClipCatalogSync den Stand wiederherstellt.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { cpqComponentTypes, cpqProductMapping, cpqSystems, shopwareProducts, type CpqSystem } from "@shared/schema";
import {
  CLIP_COMPONENT_TYPES,
  buildClipMappingPlan,
  diffClipMappings,
  type ClipCatalogProduct,
  type ClipMappingDiff,
  type ClipMappingPlan,
} from "./clipCatalogSync";

export const CLIP_SYSTEM_SLUG = "meta-clip";

export type ClipCatalogSyncProtocol = {
  tenantId: string;
  systemId: string;
  at: string;
  createdSystem: boolean;
  createdComponentTypeIds: string[];
  createdMappingIds: string[];
  updated: Array<{ id: string; attributes: unknown; status: string; componentTypeId: string }>;
  deactivated: Array<{ id: string; status: string }>;
};

export type ClipCatalogSyncResult = {
  systemId: string | null;
  applied: boolean;
  plan: { specs: number; byRole: Record<string, number>; skipped: ClipMappingPlan["skipped"] };
  diff: {
    create: Array<{ productNumber: string; name: string; role: string }>;
    update: Array<{ productNumber: string; name: string; role: string }>;
    deactivate: Array<{ productNumber: string; name: string | null }>;
    unchanged: number;
  };
  missingComponentTypes: string[];
  protocol?: ClipCatalogSyncProtocol;
};

async function findClipSystem(tenantId: string): Promise<CpqSystem | undefined> {
  const rows = await db.select().from(cpqSystems).where(eq(cpqSystems.tenantId, tenantId));
  return rows.find((s) => s.slug === CLIP_SYSTEM_SLUG && s.status === "active") ?? rows.find((s) => /^META CLIP$/i.test(s.name) && s.status === "active");
}

/** CLIP-Einzelteile und CLIP-Grund-/Anbauregale (für die Feldlast) aus dem Shop-Spiegel. */
export async function loadClipCatalogProducts(tenantId: string): Promise<ClipCatalogProduct[]> {
  const rows = await db
    .select({
      shopwareId: shopwareProducts.shopwareId,
      productNumber: shopwareProducts.productNumber,
      name: shopwareProducts.name,
      active: shopwareProducts.active,
      payload: shopwareProducts.payload,
    })
    .from(shopwareProducts)
    .where(and(eq(shopwareProducts.tenantId, tenantId), sql`${shopwareProducts.name} ~ '^META CLIP'`));
  return rows.map((r) => {
    const payload = (r.payload ?? {}) as { salesChannelIds?: string[]; properties?: Array<{ groupName?: string; optionName?: string }> };
    const properties: Record<string, string> = {};
    for (const p of payload.properties ?? []) if (p.groupName && p.optionName) properties[p.groupName] = p.optionName;
    return {
      shopwareId: r.shopwareId,
      productNumber: r.productNumber,
      name: r.name ?? "",
      active: !!r.active,
      salesChannelIds: payload.salesChannelIds ?? [],
      properties,
    };
  });
}

function summarize(diff: ClipMappingDiff): ClipCatalogSyncResult["diff"] {
  return {
    create: diff.create.map((s) => ({ productNumber: s.shopwareProductNumber, name: s.productName, role: s.role })),
    update: diff.update.map((u) => ({ productNumber: u.spec.shopwareProductNumber, name: u.spec.productName, role: u.spec.role })),
    deactivate: diff.deactivate.map((d) => ({ productNumber: d.productNumber, name: d.name })),
    unchanged: diff.unchanged,
  };
}

export async function runClipCatalogSync(tenantId: string, opts: { apply: boolean }): Promise<ClipCatalogSyncResult> {
  const products = await loadClipCatalogProducts(tenantId);
  const plan = buildClipMappingPlan(products);
  const byRole: Record<string, number> = {};
  for (const s of plan.specs) byRole[s.role] = (byRole[s.role] ?? 0) + 1;

  const system = await findClipSystem(tenantId);
  const types = system ? await db.select().from(cpqComponentTypes).where(eq(cpqComponentTypes.systemId, system.id)) : [];
  const typeIdByRole: Record<string, string> = {};
  for (const t of types) if (!typeIdByRole[t.role]) typeIdByRole[t.role] = t.id;
  const missingComponentTypes = CLIP_COMPONENT_TYPES.filter((t) => !typeIdByRole[t.role]).map((t) => t.name);
  const current = system
    ? await db.select().from(cpqProductMapping).where(and(eq(cpqProductMapping.systemId, system.id), eq(cpqProductMapping.tenantId, tenantId)))
    : [];
  const diff = diffClipMappings(current, plan.specs, typeIdByRole);
  const result: ClipCatalogSyncResult = {
    systemId: system?.id ?? null,
    applied: false,
    plan: { specs: plan.specs.length, byRole, skipped: plan.skipped },
    diff: summarize(diff),
    missingComponentTypes,
  };
  if (!opts.apply) return result;
  if (plan.specs.length === 0) throw new Error("Keine CLIP-Artikel im Shop-Spiegel – erst den Shopware-Abgleich ausführen");

  const protocol = await db.transaction(async (tx) => {
    const log: ClipCatalogSyncProtocol = {
      tenantId,
      systemId: system?.id ?? "",
      at: new Date().toISOString(),
      createdSystem: false,
      createdComponentTypeIds: [],
      createdMappingIds: [],
      updated: [],
      deactivated: [],
    };
    let systemId = system?.id;
    if (!systemId) {
      const [row] = await tx
        .insert(cpqSystems)
        .values({ tenantId, name: "META CLIP", slug: CLIP_SYSTEM_SLUG, description: "Fachbodenregal-Steckregal (Regalplaner)", status: "active" })
        .returning();
      systemId = row.id;
      log.systemId = systemId;
      log.createdSystem = true;
    }
    for (const [i, t] of CLIP_COMPONENT_TYPES.entries()) {
      if (typeIdByRole[t.role]) continue;
      const [row] = await tx.insert(cpqComponentTypes).values({ systemId, name: t.name, role: t.role, required: t.required, sortOrder: i }).returning();
      typeIdByRole[t.role] = row.id;
      log.createdComponentTypeIds.push(row.id);
    }
    // Nach dem Anlegen fehlender Typen neu vergleichen (die Typ-IDs fließen in den Vergleich ein)
    const finalDiff = diffClipMappings(current, plan.specs, typeIdByRole);
    for (const spec of finalDiff.create) {
      const [row] = await tx
        .insert(cpqProductMapping)
        .values({
          tenantId,
          systemId,
          componentTypeId: typeIdByRole[spec.role],
          shopwareProductId: spec.shopwareProductId,
          shopwareProductNumber: spec.shopwareProductNumber,
          productName: spec.productName,
          attributes: spec.attributes,
          status: "active",
        })
        .returning({ id: cpqProductMapping.id });
      log.createdMappingIds.push(row.id);
    }
    for (const u of finalDiff.update) {
      log.updated.push({ id: u.id, ...u.before });
      await tx
        .update(cpqProductMapping)
        .set({
          componentTypeId: typeIdByRole[u.spec.role],
          shopwareProductId: u.spec.shopwareProductId,
          productName: u.spec.productName,
          attributes: u.spec.attributes,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(cpqProductMapping.id, u.id));
    }
    if (finalDiff.deactivate.length) {
      for (const d of finalDiff.deactivate) log.deactivated.push({ id: d.id, status: d.before.status });
      await tx
        .update(cpqProductMapping)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(inArray(cpqProductMapping.id, finalDiff.deactivate.map((d) => d.id)));
    }
    return log;
  });
  return { ...result, systemId: protocol.systemId, applied: true, protocol };
}

export async function revertClipCatalogSync(log: ClipCatalogSyncProtocol, tenantId: string): Promise<void> {
  if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
  await db.transaction(async (tx) => {
    const own = (id: string) => and(eq(cpqProductMapping.id, id), eq(cpqProductMapping.tenantId, tenantId));
    if (log.createdMappingIds.length) {
      await tx.delete(cpqProductMapping).where(and(inArray(cpqProductMapping.id, log.createdMappingIds), eq(cpqProductMapping.tenantId, tenantId)));
    }
    for (const u of log.updated) {
      await tx
        .update(cpqProductMapping)
        .set({ attributes: u.attributes as Record<string, number | string | boolean>, status: u.status, componentTypeId: u.componentTypeId, updatedAt: new Date() })
        .where(own(u.id));
    }
    for (const d of log.deactivated) {
      await tx.update(cpqProductMapping).set({ status: d.status, updatedAt: new Date() }).where(own(d.id));
    }
    // Bauteiltypen hängen am System: nur solche des eigenen Systems löschen
    if (log.createdComponentTypeIds.length) {
      await tx
        .delete(cpqComponentTypes)
        .where(and(inArray(cpqComponentTypes.id, log.createdComponentTypeIds), eq(cpqComponentTypes.systemId, log.systemId)));
    }
    if (log.createdSystem) await tx.delete(cpqSystems).where(and(eq(cpqSystems.id, log.systemId), eq(cpqSystems.tenantId, tenantId)));
  });
}
