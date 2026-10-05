/**
 * Limit fuer den Reiter "Natuerliche Sprache": jede Frage kostet 2-3 KI-Aufrufe (Abfrage verstehen,
 * Erkenntnisse, bei Prognosen Vorschlaege). Ohne Grenze konnte jeder berechtigte Nutzer beliebig
 * viele Fragen stellen.
 * - je Nutzer und Minute (Schutz gegen Dauerfeuer, im Speicher)
 * - je Nutzer und Tag, je Mandant und Tag (in der Datenbank, uebersteht Neustarts/Deploys)
 * Der Tag wechselt um Mitternacht deutscher Zeit. Gezaehlt wird jede angenommene Frage, auch wenn
 * die KI sie danach nicht versteht - der Aufruf hat dann trotzdem gekostet.
 */

export const NL_LIMIT_DEFAULTS = { perUserPerDay: 30, perTenantPerDay: 300, perUserPerMinute: 5 } as const;
export const NL_LIMIT_MAX = 10_000;

export type NlLimits = { perUserPerDay: number; perTenantPerDay: number; perUserPerMinute: number };

/** Zaehler pro Mandant/Nutzer/Tag; Produktion: Datenbank (nlQueryUsageStore.ts), Tests: im Speicher. */
export interface NlUsageStore {
  userCount(tenantId: string, userId: string, day: string): Promise<number>;
  tenantCount(tenantId: string, day: string): Promise<number>;
  /** Erhoeht nur, wenn der Zaehler noch unter `limit` liegt (atomar); liefert den neuen Stand oder null. */
  incrementIfBelow(tenantId: string, userId: string, day: string, limit: number): Promise<number | null>;
}

/** Limits aus den KI-Einstellungen (openai_settings), fehlende oder ungueltige Werte -> Standard */
export function resolveNlLimits(aiSettings: unknown): NlLimits {
  const s = (aiSettings && typeof aiSettings === "object" ? aiSettings : {}) as Record<string, unknown>;
  const pick = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= NL_LIMIT_MAX ? v : fallback;
  return {
    perUserPerDay: pick(s.nlDailyLimitPerUser, NL_LIMIT_DEFAULTS.perUserPerDay),
    perTenantPerDay: pick(s.nlDailyLimitPerTenant, NL_LIMIT_DEFAULTS.perTenantPerDay),
    perUserPerMinute: NL_LIMIT_DEFAULTS.perUserPerMinute,
  };
}

/** Kalendertag in Deutschland (YYYY-MM-DD), unabhaengig von der Zeitzone des Servers */
export function berlinDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Minutenfenster je Nutzer (nur dieser Server-Prozess; reicht gegen Dauerfeuer)
const minuteBuckets = new Map<string, { count: number; resetAt: number }>();

export function takeMinuteSlot(key: string, perMinute: number, now: number = Date.now()): boolean {
  let bucket = minuteBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    minuteBuckets.set(key, bucket);
  }
  if (bucket.count >= perMinute) return false;
  bucket.count += 1;
  // alte Eintraege gelegentlich aufraeumen
  if (minuteBuckets.size > 5_000) {
    for (const [k, b] of minuteBuckets) if (now >= b.resetAt) minuteBuckets.delete(k);
  }
  return true;
}

export function resetMinuteBucketsForTests() {
  minuteBuckets.clear();
}

export type NlQuotaResult =
  | { ok: true; used: number; limit: number }
  | { ok: false; reason: "rate_limited" | "daily_limit_user" | "daily_limit_tenant"; used: number; limit: number };

/**
 * Eine Frage verbuchen, wenn alle Grenzen es erlauben. Reihenfolge: Minute (billig, im Speicher),
 * Mandant/Tag, Nutzer/Tag (atomar in der Datenbank - zwei gleichzeitige Fragen am Limit schaffen
 * nicht beide). Die Mandantensumme wird vorher gelesen; gleichzeitige Fragen verschiedener Nutzer
 * koennen sie um wenige ueberschreiten.
 */
export async function consumeNlQuota(
  store: NlUsageStore,
  args: { tenantId: string; userId: string; limits: NlLimits; now?: Date },
): Promise<NlQuotaResult> {
  const { tenantId, userId, limits } = args;
  const now = args.now ?? new Date();
  const day = berlinDay(now);

  if (!takeMinuteSlot(`${tenantId}:${userId}`, limits.perUserPerMinute, now.getTime())) {
    return { ok: false, reason: "rate_limited", used: limits.perUserPerMinute, limit: limits.perUserPerMinute };
  }
  const tenantUsed = await store.tenantCount(tenantId, day);
  if (tenantUsed >= limits.perTenantPerDay) {
    return { ok: false, reason: "daily_limit_tenant", used: tenantUsed, limit: limits.perTenantPerDay };
  }
  if (limits.perUserPerDay <= 0) {
    return { ok: false, reason: "daily_limit_user", used: 0, limit: 0 };
  }
  const used = await store.incrementIfBelow(tenantId, userId, day, limits.perUserPerDay);
  if (used === null) {
    return { ok: false, reason: "daily_limit_user", used: limits.perUserPerDay, limit: limits.perUserPerDay };
  }
  return { ok: true, used, limit: limits.perUserPerDay };
}

/** Stand fuer die Anzeige "x von y Fragen heute" */
export async function getNlUsage(store: NlUsageStore, args: { tenantId: string; userId: string; limits: NlLimits; now?: Date }) {
  const day = berlinDay(args.now ?? new Date());
  const [used, tenantUsed] = await Promise.all([
    store.userCount(args.tenantId, args.userId, day),
    store.tenantCount(args.tenantId, day),
  ]);
  return { used, limit: args.limits.perUserPerDay, tenantUsed, tenantLimit: args.limits.perTenantPerDay };
}
