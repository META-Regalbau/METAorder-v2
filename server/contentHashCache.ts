import { createHash } from "crypto";
import { storage } from "./storage";

/** Persistierter Cache-Eintrag in der Settings-Tabelle. */
export type PersistedHashCache<T> = {
  fetchedAt: string;
  fingerprint: string;
  data: T;
};

type MemoryEntry<T> = {
  fingerprint: string;
  data: T;
  expiresAt: number;
};

const memoryLayer = new Map<string, MemoryEntry<unknown>>();

/** Deterministischer Kurz-Fingerprint aus sortierten Key-Value-Paaren. */
export function stableFingerprint(parts: Record<string, string | number | null | undefined>): string {
  const normalized = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${parts[key] ?? ""}`)
    .join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

/** SHA-256 über serialisierte Nutzdaten (Fallback wenn keine Quellen-Fingerprint-API existiert). */
export function hashPayload(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function invalidateMemoryHashCache(cacheKey: string, tenantId?: string | null): void {
  memoryLayer.delete(`${tenantId ?? "__global__"}:${cacheKey}`);
}

/**
 * Zwei-stufiger Cache (Memory + DB): Zuerst leichter Fingerprint von der Quelle,
 * nur bei Änderung voller Reload. Typisches Muster für Shopware-Indizes.
 */
export async function getHashCached<T>(options: {
  cacheKey: string;
  tenantId?: string | null;
  ttlMs?: number;
  memoryTtlMs?: number;
  fetchFingerprint: () => Promise<string | null>;
  fetchFull: () => Promise<T>;
}): Promise<{ data: T; fromCache: boolean; fingerprint: string }> {
  const {
    cacheKey,
    tenantId,
    ttlMs = 24 * 60 * 60 * 1000,
    memoryTtlMs = 2 * 60 * 1000,
    fetchFingerprint,
    fetchFull,
  } = options;

  const memKey = `${tenantId ?? "__global__"}:${cacheKey}`;

  let sourceFingerprint: string | null = null;
  try {
    sourceFingerprint = await fetchFingerprint();
  } catch (error) {
    console.warn(`[hash-cache] fingerprint failed for ${cacheKey}:`, error);
  }

  const persisted = (await storage.getSetting(cacheKey, tenantId)) as PersistedHashCache<T> | undefined;

  const memoryHit = memoryLayer.get(memKey) as MemoryEntry<T> | undefined;
  if (
    memoryHit &&
    Date.now() < memoryHit.expiresAt &&
    sourceFingerprint &&
    memoryHit.fingerprint === sourceFingerprint
  ) {
    return { data: memoryHit.data, fromCache: true, fingerprint: sourceFingerprint };
  }

  if (
    persisted?.data != null &&
    persisted.fingerprint &&
    sourceFingerprint &&
    persisted.fingerprint === sourceFingerprint
  ) {
    memoryLayer.set(memKey, {
      fingerprint: sourceFingerprint,
      data: persisted.data,
      expiresAt: Date.now() + memoryTtlMs,
    });
    return { data: persisted.data, fromCache: true, fingerprint: sourceFingerprint };
  }

  const ttlExpired =
    !persisted?.fetchedAt ||
    Date.now() - new Date(persisted.fetchedAt).getTime() >= ttlMs;

  if (
    persisted?.data != null &&
    persisted.fingerprint &&
    !sourceFingerprint &&
    !ttlExpired
  ) {
    return { data: persisted.data, fromCache: true, fingerprint: persisted.fingerprint };
  }

  const data = await fetchFull();
  const fingerprint = sourceFingerprint ?? hashPayload(data);
  const entry: PersistedHashCache<T> = {
    fetchedAt: new Date().toISOString(),
    fingerprint,
    data,
  };
  await storage.saveSetting(cacheKey, entry, tenantId);
  memoryLayer.set(memKey, {
    fingerprint,
    data,
    expiresAt: Date.now() + memoryTtlMs,
  });

  if (persisted?.fingerprint && persisted.fingerprint !== fingerprint) {
    console.log(`[hash-cache] ${cacheKey}: source changed (${persisted.fingerprint.slice(0, 8)} → ${fingerprint.slice(0, 8)})`);
  } else if (!persisted?.fingerprint) {
    console.log(`[hash-cache] ${cacheKey}: cold load`);
  }

  return { data, fromCache: false, fingerprint };
}

/** Nur In-Memory: für große Datenmengen (Produktkatalog), die nicht in Settings passen. */
export async function getInMemoryHashCached<T>(options: {
  cacheKey: string;
  tenantId?: string | null;
  ttlMs?: number;
  lastFingerprint?: string | null;
  fetchFingerprint: () => Promise<string | null>;
  fetchFull: () => Promise<T>;
  onStore?: (data: T, fingerprint: string) => void;
}): Promise<{ data: T; fromCache: boolean; fingerprint: string }> {
  const { cacheKey, tenantId, ttlMs = 6 * 60 * 60 * 1000, lastFingerprint, fetchFingerprint, fetchFull, onStore } =
    options;
  const memKey = `${tenantId ?? "__global__"}:${cacheKey}`;

  let sourceFingerprint: string | null = null;
  try {
    sourceFingerprint = await fetchFingerprint();
  } catch (error) {
    console.warn(`[hash-cache] in-memory fingerprint failed for ${cacheKey}:`, error);
  }

  const memoryHit = memoryLayer.get(memKey) as MemoryEntry<T> | undefined;
  if (
    memoryHit &&
    Date.now() < memoryHit.expiresAt &&
    sourceFingerprint &&
    memoryHit.fingerprint === sourceFingerprint
  ) {
    return { data: memoryHit.data, fromCache: true, fingerprint: sourceFingerprint };
  }

  if (sourceFingerprint && lastFingerprint && sourceFingerprint === lastFingerprint && memoryHit?.data) {
    memoryLayer.set(memKey, {
      fingerprint: sourceFingerprint,
      data: memoryHit.data,
      expiresAt: Date.now() + ttlMs,
    });
    return { data: memoryHit.data, fromCache: true, fingerprint: sourceFingerprint };
  }

  const data = await fetchFull();
  const fingerprint = sourceFingerprint ?? hashPayload(data);
  memoryLayer.set(memKey, {
    fingerprint,
    data,
    expiresAt: Date.now() + ttlMs,
  });
  onStore?.(data, fingerprint);

  return { data, fromCache: false, fingerprint };
}
