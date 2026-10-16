import { and, asc, desc, eq, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import {
  shopContentItems,
  shopContentPublications,
  shopContentVersions,
  type ShopContentItemRow,
  type ShopContentPublicationRow,
  type ShopContentVersionRow,
} from "@shared/schema";
import type { ShopContentIssue, ShopContentKind } from "@shared/shopContent";
import { db } from "../db";

/**
 * Datenbankzugriff der Shop-Inhalte (Tabellen shop_content_items/_versions/_publications, Migration 0052).
 * Jede Abfrage ist auf den Mandanten begrenzt; ohne Mandant nur Zeilen ohne Mandant.
 */

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

export type ShopContentItemWithVersion = { item: ShopContentItemRow; version: ShopContentVersionRow };

/** Alle Eintraege des Mandanten mit ihrer neuesten Version */
export async function listItemsWithLatestVersion(tenantId: string | null): Promise<ShopContentItemWithVersion[]> {
  const items = await db.select().from(shopContentItems).where(tenantIs(shopContentItems.tenantId, tenantId)).orderBy(asc(shopContentItems.position));
  if (items.length === 0) return [];
  const latest = db
    .select({ itemId: shopContentVersions.itemId, maxNo: sql<number>`max(${shopContentVersions.versionNo})`.as("max_no") })
    .from(shopContentVersions)
    .where(inArray(shopContentVersions.itemId, items.map((i) => i.id)))
    .groupBy(shopContentVersions.itemId)
    .as("latest");
  const versions = await db
    .select({ version: shopContentVersions })
    .from(shopContentVersions)
    .innerJoin(latest, and(eq(latest.itemId, shopContentVersions.itemId), eq(latest.maxNo, shopContentVersions.versionNo)));
  const byItem = new Map(versions.map((v) => [v.version.itemId, v.version]));
  return items.flatMap((item) => {
    const version = byItem.get(item.id);
    return version ? [{ item, version }] : [];
  });
}

export async function getItem(tenantId: string | null, id: string): Promise<ShopContentItemRow | undefined> {
  const rows = await db.select().from(shopContentItems).where(and(eq(shopContentItems.id, id), tenantIs(shopContentItems.tenantId, tenantId))).limit(1);
  return rows[0];
}

/** Version eines Eintrags; ohne Nummer die neueste */
export async function getVersion(tenantId: string | null, itemId: string, versionNo?: number): Promise<ShopContentVersionRow | undefined> {
  const rows = await db
    .select()
    .from(shopContentVersions)
    .where(
      and(
        eq(shopContentVersions.itemId, itemId),
        tenantIs(shopContentVersions.tenantId, tenantId),
        versionNo === undefined ? undefined : eq(shopContentVersions.versionNo, versionNo),
      ),
    )
    .orderBy(desc(shopContentVersions.versionNo))
    .limit(1);
  return rows[0];
}

export async function listVersions(tenantId: string | null, itemId: string) {
  return db
    .select({
      id: shopContentVersions.id,
      versionNo: shopContentVersions.versionNo,
      comment: shopContentVersions.comment,
      createdAt: shopContentVersions.createdAt,
      createdByName: shopContentVersions.createdByName,
    })
    .from(shopContentVersions)
    .where(and(eq(shopContentVersions.itemId, itemId), tenantIs(shopContentVersions.tenantId, tenantId)))
    .orderBy(desc(shopContentVersions.versionNo))
    .limit(200);
}

/** Neueste erfolgreiche Veroeffentlichung je Eintrag und Ziel (test/live), mit Versionsnummer */
export async function latestPublications(tenantId: string | null): Promise<Map<string, ShopContentPublicationRow & { versionNo: number | null }>> {
  const rows = await db
    .select({ publication: shopContentPublications, versionNo: shopContentVersions.versionNo })
    .from(shopContentPublications)
    .leftJoin(shopContentVersions, eq(shopContentVersions.id, shopContentPublications.versionId))
    .where(and(tenantIs(shopContentPublications.tenantId, tenantId), eq(shopContentPublications.status, "ok")))
    .orderBy(desc(shopContentPublications.publishedAt))
    .limit(1000);
  const map = new Map<string, ShopContentPublicationRow & { versionNo: number | null }>();
  for (const row of rows) {
    const key = `${row.publication.itemId}:${row.publication.target}`;
    if (!map.has(key)) map.set(key, { ...row.publication, versionNo: row.versionNo });
  }
  return map;
}

export async function existingKeys(tenantId: string | null): Promise<Set<string>> {
  const rows = await db.select({ kind: shopContentItems.kind, key: shopContentItems.key }).from(shopContentItems).where(tenantIs(shopContentItems.tenantId, tenantId));
  return new Set(rows.map((r) => `${r.kind}:${r.key}`));
}

/** Neuer Eintrag mit Version 1 (eine Transaktion) */
export async function createItemWithVersion(
  tenantId: string | null,
  entry: { kind: ShopContentKind; key: string; name: string; position: number; data: unknown },
  meta: { comment: string; checkResult: ShopContentIssue[]; userId: string | null; userName: string | null },
): Promise<ShopContentItemRow> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .insert(shopContentItems)
      .values({ tenantId, kind: entry.kind, key: entry.key, name: entry.name, position: entry.position })
      .returning();
    await tx.insert(shopContentVersions).values({
      tenantId,
      itemId: item!.id,
      versionNo: 1,
      data: entry.data,
      comment: meta.comment,
      checkResult: meta.checkResult,
      createdByUserId: meta.userId,
      createdByName: meta.userName,
    });
    return item!;
  });
}
