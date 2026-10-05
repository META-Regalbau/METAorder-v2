/**
 * Limit "Natuerliche Sprache" (server/analytics/nlQueryLimit.ts): jede Frage kostet 2-3 KI-Aufrufe,
 * vorher gab es keine Grenze. Je Nutzer/Minute (Speicher), je Nutzer/Tag und je Mandant/Tag
 * (Datenbank, hier simuliert). Die Atomaritaet der SQL-Erhoehung ist gegen die echte Datenbank
 * geprueft (siehe PR), hier die Regeln.
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  berlinDay,
  consumeNlQuota,
  getNlUsage,
  NL_LIMIT_DEFAULTS,
  resetMinuteBucketsForTests,
  resolveNlLimits,
  takeMinuteSlot,
  type NlLimits,
  type NlUsageStore,
} from "../../server/analytics/nlQueryLimit";

function memoryStore() {
  const counts = new Map<string, number>();
  const store: NlUsageStore = {
    userCount: async (t, u, d) => counts.get(`${t}|${u}|${d}`) ?? 0,
    tenantCount: async (t, d) => [...counts].filter(([k]) => k.startsWith(`${t}|`) && k.endsWith(`|${d}`)).reduce((s, [, n]) => s + n, 0),
    // wie das SQL: neue Zeile wird immer mit 1 angelegt (WHERE greift nur bei vorhandener Zeile)
    incrementIfBelow: async (t, u, d, limit) => {
      const key = `${t}|${u}|${d}`;
      const n = counts.get(key);
      if (n === undefined) {
        counts.set(key, 1);
        return 1;
      }
      if (n >= limit) return null;
      counts.set(key, n + 1);
      return n + 1;
    },
  };
  return { store, counts };
}

const NOON = new Date("2026-10-05T10:00:00Z");
const limits = (o: Partial<NlLimits> = {}): NlLimits => ({ perUserPerDay: 3, perTenantPerDay: 100, perUserPerMinute: 100, ...o });

beforeEach(() => resetMinuteBucketsForTests());

describe("Grenzen aus den KI-Einstellungen", () => {
  it("Standard 30 je Nutzer, 300 je Mandant, 5 je Minute", () => {
    expect(resolveNlLimits(undefined)).toEqual({ perUserPerDay: 30, perTenantPerDay: 300, perUserPerMinute: 5 });
    expect(NL_LIMIT_DEFAULTS.perUserPerMinute).toBe(5);
  });

  it("eigene Werte; ungueltige fallen auf den Standard, 0 ist erlaubt (sperrt)", () => {
    expect(resolveNlLimits({ nlDailyLimitPerUser: 10, nlDailyLimitPerTenant: 0 })).toMatchObject({ perUserPerDay: 10, perTenantPerDay: 0 });
    for (const bad of [-1, 2.5, "20", 10_001, null]) {
      expect(resolveNlLimits({ nlDailyLimitPerUser: bad }).perUserPerDay, String(bad)).toBe(30);
    }
  });
});

describe("Tag nach deutscher Zeit", () => {
  it("Mitternacht in Berlin, nicht UTC (Sommer- und Winterzeit)", () => {
    expect(berlinDay(new Date("2026-10-04T21:59:00Z"))).toBe("2026-10-04");
    expect(berlinDay(new Date("2026-10-04T22:30:00Z"))).toBe("2026-10-05"); // 00:30 MESZ
    expect(berlinDay(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16"); // 00:30 MEZ
  });
});

describe("Fragen verbuchen", () => {
  it("je Nutzer und Tag: genau bis zur Grenze, andere Nutzer unberuehrt, naechster Tag frei", async () => {
    const { store } = memoryStore();
    const ask = (userId: string, now = NOON) => consumeNlQuota(store, { tenantId: "t", userId, limits: limits(), now });
    expect((await Promise.all([ask("a"), ask("a"), ask("a")])).map((r) => r.ok && r.used)).toEqual([1, 2, 3]);
    expect(await ask("a")).toEqual({ ok: false, reason: "daily_limit_user", used: 3, limit: 3 });
    expect(await ask("b")).toEqual({ ok: true, used: 1, limit: 3 });
    expect(await ask("a", new Date("2026-10-05T22:30:00Z"))).toMatchObject({ ok: true, used: 1 }); // 06.10. in Berlin
  });

  it("je Mandant und Tag: Summe aller Nutzer, andere Mandanten unberuehrt", async () => {
    const { store } = memoryStore();
    const ask = (tenantId: string, userId: string) =>
      consumeNlQuota(store, { tenantId, userId, limits: limits({ perUserPerDay: 10, perTenantPerDay: 4 }), now: NOON });
    for (let i = 0; i < 3; i++) expect((await ask("t", "a")).ok).toBe(true);
    expect((await ask("t", "b")).ok).toBe(true);
    expect(await ask("t", "c")).toEqual({ ok: false, reason: "daily_limit_tenant", used: 4, limit: 4 });
    expect((await ask("t2", "c")).ok).toBe(true);
  });

  it("Grenze 0 sperrt ohne zu zaehlen", async () => {
    const { store, counts } = memoryStore();
    expect(await consumeNlQuota(store, { tenantId: "t", userId: "a", limits: limits({ perUserPerDay: 0 }), now: NOON })).toMatchObject({ ok: false, reason: "daily_limit_user" });
    expect(counts.size).toBe(0);
  });

  it("je Minute: 5 Fragen, die 6. wartet, nach einer Minute wieder frei; Ablehnung zaehlt nicht am Tag", async () => {
    const { store } = memoryStore();
    const lim = limits({ perUserPerDay: 100, perUserPerMinute: 5 });
    const ask = (now: Date) => consumeNlQuota(store, { tenantId: "t", userId: "a", limits: lim, now });
    for (let i = 0; i < 5; i++) expect((await ask(NOON)).ok).toBe(true);
    expect(await ask(new Date(NOON.getTime() + 30_000))).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(await ask(new Date(NOON.getTime() + 61_000))).toEqual({ ok: true, used: 6, limit: 100 });
  });

  it("Minutenfenster je Nutzer getrennt", () => {
    for (let i = 0; i < 2; i++) expect(takeMinuteSlot("t:a", 2, 0)).toBe(true);
    expect(takeMinuteSlot("t:a", 2, 0)).toBe(false);
    expect(takeMinuteSlot("t:b", 2, 0)).toBe(true);
  });

  it("Anzeige: heutiger Stand ohne zu zaehlen", async () => {
    const { store } = memoryStore();
    await consumeNlQuota(store, { tenantId: "t", userId: "a", limits: limits(), now: NOON });
    await consumeNlQuota(store, { tenantId: "t", userId: "b", limits: limits(), now: NOON });
    expect(await getNlUsage(store, { tenantId: "t", userId: "a", limits: limits(), now: NOON })).toEqual({ used: 1, limit: 3, tenantUsed: 2, tenantLimit: 100 });
    expect(await getNlUsage(store, { tenantId: "t", userId: "a", limits: limits(), now: NOON })).toMatchObject({ used: 1 });
  });
});
