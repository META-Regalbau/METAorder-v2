/**
 * Shop-Puls Stufe 2 (S2-1): Maßnahmen-Protokoll aus den automatischen Quellen nachziehen. Läuft in jedem
 * Shop-Puls-Takt, vor dem Wochenbericht und beim Öffnen des Protokolls auf der Seite. Nur lesend aus der
 * eigenen Datenbank (Shop-Inhalte, Meldungen, Stand des Shop-Wächters, Preis-Historie); doppelte Einträge
 * verhindert der feste Schlüssel je Quelle (actionLog.ts).
 */
import { and, eq, gte, inArray, isNotNull, isNull, sql, type AnyColumn } from "drizzle-orm";
import { shopContentItems, shopContentPublications, shopContentVersions, shopPulseSignals } from "@shared/schema";
import type { IStorage } from "../storage";
import { db } from "../db";
import { logger } from "../lib/logger";
import { INDUSTRY_PAGES } from "../products/industryPages";
import { getShopWatchState } from "../shopContent/shopWatch";
import { loadPriceChanges } from "./buyabilityData";
import { rowToSignal } from "./shopPulseRepository";
import {
  actionsFromDeploys,
  actionsFromPriceChanges,
  actionsFromPublications,
  actionsFromResolvedSignals,
  type ActionCandidate,
  type PublicationRow,
} from "./actionLog";
import { insertCandidates } from "./actionLogRepository";

const log = logger.child({ component: "shopPulse/actionSync" });

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const DAY_MS = 24 * 60 * 60 * 1000;
/** So weit zurück werden Meldungen und Preisänderungen gelesen (der Abgleich läuft alle 15 Minuten) */
const LOOKBACK_DAYS = 60;

async function loadLivePublications(tenantId: string | null): Promise<PublicationRow[]> {
  return db
    .select({
      id: shopContentPublications.id,
      target: shopContentPublications.target,
      status: shopContentPublications.status,
      publishedAt: shopContentPublications.publishedAt,
      publishedByName: shopContentPublications.publishedByName,
      revertedAt: shopContentPublications.revertedAt,
      revertedByName: shopContentPublications.revertedByName,
      itemKind: shopContentItems.kind,
      itemKey: shopContentItems.key,
      itemName: shopContentItems.name,
      versionNo: shopContentVersions.versionNo,
      url: sql<string | null>`${shopContentVersions.data}->>'url'`,
    })
    .from(shopContentPublications)
    .leftJoin(shopContentItems, eq(shopContentItems.id, shopContentPublications.itemId))
    .leftJoin(shopContentVersions, eq(shopContentVersions.id, shopContentPublications.versionId))
    .where(
      and(
        tenantIs(shopContentPublications.tenantId, tenantId),
        eq(shopContentPublications.target, "live"),
        inArray(shopContentPublications.status, ["ok", "reverted"]),
      ),
    );
}

async function loadManuallyResolved(tenantId: string | null, since: Date) {
  const rows = await db
    .select()
    .from(shopPulseSignals)
    .where(
      and(
        tenantIs(shopPulseSignals.tenantId, tenantId),
        eq(shopPulseSignals.status, "resolved"),
        isNotNull(shopPulseSignals.resolvedBy),
        gte(shopPulseSignals.resolvedAt, since),
      ),
    );
  return rows.map(rowToSignal);
}

export type ActionSyncResult = { inserted: number; failed: string[] };

/**
 * Alle Quellen lesen und neue Einträge anlegen. Eine Quelle, die scheitert, hält die anderen nicht auf
 * (failed nennt sie); was fehlt, kommt beim nächsten Abgleich.
 */
export async function syncActionLog(storage: Pick<IStorage, "getSetting" | "saveSetting" | "getShopwareSettings">, tenantId: string | null, now: Date): Promise<ActionSyncResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const sources: Array<[string, () => Promise<ActionCandidate[]>]> = [
    ["shopContent", async () => actionsFromPublications(await loadLivePublications(tenantId), INDUSTRY_PAGES.map((p) => p.url))],
    ["shopPulse", async () => actionsFromResolvedSignals(await loadManuallyResolved(tenantId, since))],
    ["shopWatch", async () => actionsFromDeploys((await getShopWatchState(storage, tenantId)).history ?? [])],
    ["priceHistory", async () => actionsFromPriceChanges(await loadPriceChanges(tenantId, since), now)],
  ];
  const candidates: ActionCandidate[] = [];
  const failed: string[] = [];
  for (const [name, load] of sources) {
    try {
      candidates.push(...(await load()));
    } catch (err) {
      failed.push(name);
      log.warn({ err, tenantId, source: name }, "Maßnahmen-Protokoll: Quelle nicht gelesen");
    }
  }
  const inserted = await insertCandidates(tenantId, candidates);
  if (inserted.length) log.info({ tenantId, inserted: inserted.length }, "Maßnahmen-Protokoll: Einträge übernommen");
  return { inserted: inserted.length, failed };
}
