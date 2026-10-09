/**
 * Cross-Selling-Hintergrundjobs (Statusabfrage, Neustart) und Lernlauf im Mandanten-Kontext.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  startCrossSellJob,
  getCrossSellJobStatus,
  resetCrossSellJobsForTests,
} from "../../server/cross-selling/crossSellJobs";
import { runCrossSellLearningForAllTenants, resolveLearningIntervalHours } from "../../server/cross-selling/crossSellScheduler";
import { getTenantIdFromContext } from "../../server/lib/tenantContext";

function memoryStore() {
  const data = new Map<string, any>();
  return {
    data,
    getSetting: async (key: string, tenantId?: string | null) => data.get(`${tenantId ?? ""}:${key}`) ?? null,
    saveSetting: async (key: string, value: any, tenantId?: string | null) => {
      data.set(`${tenantId ?? ""}:${key}`, value);
      return value;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Cross-Selling-Jobs", () => {
  beforeEach(() => resetCrossSellJobsForTests());

  it("laeuft im Hintergrund, meldet Fortschritt und Ergebnis", async () => {
    const store = memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let seenTenant: string | null = "unset";
    const { started } = startCrossSellJob(store, "t1", "staging", async (job) => {
      seenTenant = getTenantIdFromContext();
      job.processed = 5;
      job.total = 10;
      await gate;
      return { suggestionsCount: 3 };
    });
    expect(started).toBe(true);
    await flush();
    expect(await getCrossSellJobStatus(store, "t1", "staging")).toMatchObject({ status: "running", processed: 5, total: 10 });

    const second = startCrossSellJob(store, "t1", "staging", async () => ({}));
    expect(second.started).toBe(false);

    release();
    await flush();
    await flush();
    expect(await getCrossSellJobStatus(store, "t1", "staging")).toMatchObject({ status: "done", result: { suggestionsCount: 3 } });
    expect(seenTenant).toBe("t1");
  });

  it("Fehler wird gemeldet; andere Mandanten sind unabhaengig", async () => {
    const store = memoryStore();
    startCrossSellJob(store, "t1", "ai", async () => {
      throw new Error("kaputt");
    });
    await flush();
    await flush();
    expect(await getCrossSellJobStatus(store, "t1", "ai")).toMatchObject({ status: "error", error: "kaputt" });
    expect(await getCrossSellJobStatus(store, "t2", "ai")).toEqual({ status: "idle" });
  });

  it("nach Neustart: gespeichert 'running' ergibt 'interrupted'", async () => {
    const store = memoryStore();
    await store.saveSetting("cross_sell_job_last_staging", { type: "staging", status: "running", startedAt: "x", processed: 1, total: 2 }, "t1");
    const status = await getCrossSellJobStatus(store, "t1", "staging");
    expect(status).toMatchObject({ status: "error", code: "interrupted" });
  });
});

describe("Cross-Selling-Lernlauf (Scheduler)", () => {
  it("laeuft je Mandant im Mandanten-Kontext und ueberspringt Mandanten ohne Shopware", async () => {
    const seen: Array<{ tenantId: string | null; context: string | null }> = [];
    await runCrossSellLearningForAllTenants({
      storage: {
        getAllTenants: async () => [{ id: "a" }, { id: "b" }, { id: "c" }] as any,
        getShopwareSettings: async (tenantId?: string | null) => (tenantId === "b" ? undefined : ({ shopUrl: "x" } as any)),
      },
      runLearning: async (_settings, tenantId) => {
        seen.push({ tenantId, context: getTenantIdFromContext() });
        if (tenantId === "a") throw new Error("Fehler bei a stoppt c nicht");
      },
    });
    expect(seen).toEqual([
      { tenantId: "a", context: "a" },
      { tenantId: "c", context: "c" },
    ]);
  });

  it("Intervall: Standard 24 h, ungueltige Werte ignoriert", () => {
    expect(resolveLearningIntervalHours(undefined)).toBe(24);
    expect(resolveLearningIntervalHours("0")).toBe(24);
    expect(resolveLearningIntervalHours("6")).toBe(6);
  });
});
