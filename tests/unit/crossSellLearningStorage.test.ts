/**
 * Cross-Selling-Lernlauf speichern: Testing hat 58.080 Paare - ein einziger INSERT liess drizzle mit
 * "Maximum call stack size exceeded" abbrechen, der Lernlauf scheiterte bei jedem Lauf (die Insights
 * blieben auf altem Stand). Ohne Transaktion waren die alten Zeilen danach trotzdem geloescht.
 * Jetzt: Loeschen und Einfuegen in einer Transaktion, eingefuegt in Bloecken.
 * Datenbank gemockt. Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ log: [] as string[], failInsertAt: -1, inserts: 0 }));
vi.mock("../../server/db", () => {
  const tx = {
    delete: () => ({ where: async () => { dbMock.log.push("delete"); } }),
    insert: () => ({
      values: async (rows: unknown[]) => {
        dbMock.inserts += 1;
        if (dbMock.inserts === dbMock.failInsertAt) throw new Error("Insert fehlgeschlagen");
        dbMock.log.push(`insert:${rows.length}`);
      },
    }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<void>) => {
        dbMock.log.push("begin");
        try {
          await fn(tx);
          dbMock.log.push("commit");
        } catch (e) {
          dbMock.log.push("rollback");
          throw e;
        }
      },
      // ohne Transaktion darf nicht geschrieben werden
      delete: () => { throw new Error("delete ohne Transaktion"); },
      insert: () => { throw new Error("insert ohne Transaktion"); },
    },
    pool: {},
  };
});

import { DbStorage, REPLACE_ROWS_CHUNK } from "../../server/dbStorage";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ productNumberA: `A${i}`, productNumberB: `B${i}` })) as any[];

beforeEach(() => {
  dbMock.log = [];
  dbMock.failInsertAt = -1;
  dbMock.inserts = 0;
});

describe("Lernergebnisse ersetzen", () => {
  it("58.080 Paare: in Bloecken, in einer Transaktion", async () => {
    await new DbStorage().replaceCrossSellCooccurrences(rows(58080), "t1");
    const inserts = dbMock.log.filter((e) => e.startsWith("insert:"));
    expect(inserts).toHaveLength(Math.ceil(58080 / REPLACE_ROWS_CHUNK));
    expect(inserts.every((e) => Number(e.split(":")[1]) <= REPLACE_ROWS_CHUNK)).toBe(true);
    expect(dbMock.log[0]).toBe("begin");
    expect(dbMock.log[1]).toBe("delete");
    expect(dbMock.log.at(-1)).toBe("commit");
  });

  it("Fehler beim Einfuegen: Rollback (alte Zeilen bleiben)", async () => {
    dbMock.failInsertAt = 3;
    await expect(new DbStorage().replaceAiCrossSellRules(rows(5000), "t1")).rejects.toThrow("Insert fehlgeschlagen");
    expect(dbMock.log.at(-1)).toBe("rollback");
  });

  it("alle vier Ergebnisse des Lernlaufs; ohne Zeilen nur Loeschen", async () => {
    const storage = new DbStorage();
    await storage.replaceAiRecommendations(rows(1), "t1");
    await storage.replaceAiInsights([], "t1");
    expect(dbMock.log).toEqual(["begin", "delete", "insert:1", "commit", "begin", "delete", "commit"]);
  });
});
