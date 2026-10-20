import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  acquireIntakeSlot,
  finishIntakeAttempt,
  INTAKE_ATTEMPTS_KEY,
  INTAKE_MAX_ATTEMPTS,
  pruneIntakeAttempts,
  startIntakeAttempt,
} from "../../server/commercial/emailIntakeUpload";

function memoryStore() {
  const map = new Map<string, unknown>();
  return {
    map,
    getSetting: async (key: string, tenantId?: string | null) => map.get(`${tenantId}:${key}`),
    saveSetting: async (key: string, value: unknown, tenantId?: string | null) => void map.set(`${tenantId}:${key}`, JSON.parse(JSON.stringify(value))),
  } as any;
}

describe("E-Mail-Eingang: höchstens zwei Mails gleichzeitig", () => {
  it("dritte Mail wartet, bis ein Platz frei wird; doppeltes Freigeben zählt nicht", async () => {
    const a = await acquireIntakeSlot(2);
    const b = await acquireIntakeSlot(2);
    let thirdStarted = false;
    const third = acquireIntakeSlot(2).then((release) => {
      thirdStarted = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(thirdStarted).toBe(false);
    a();
    a(); // zweites Freigeben derselben Belegung darf keinen weiteren Platz schaffen
    const c = await third;
    expect(thirdStarted).toBe(true);
    let fourthStarted = false;
    const fourth = acquireIntakeSlot(2).then((release) => {
      fourthStarted = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(fourthStarted).toBe(false);
    b();
    (await fourth)();
    c();
  });
});

describe("E-Mail-Eingang: Absturzschutz", () => {
  const now = new Date("2026-10-20T10:00:00Z");

  it("zählt begonnene Verarbeitungen je Mail und Mandant; Abschluss löscht den Zähler", async () => {
    const store = memoryStore();
    expect(await startIntakeAttempt(store, "t1", "mail:A", now)).toBe(0);
    // Prozess „stirbt“: kein finish → nächster Versuch sieht 1, dann 2
    expect(await startIntakeAttempt(store, "t1", "mail:A", now)).toBe(1);
    expect(await startIntakeAttempt(store, "t1", "mail:A", now)).toBe(INTAKE_MAX_ATTEMPTS);
    expect(await startIntakeAttempt(store, "t2", "mail:A", now)).toBe(0);
    await finishIntakeAttempt(store, "t1", "mail:A", now);
    expect(store.map.get(`t1:${INTAKE_ATTEMPTS_KEY}`)).toEqual({});
    expect(await startIntakeAttempt(store, "t1", "mail:A", now)).toBe(0);
  });

  it("parallele Mails überschreiben sich nicht", async () => {
    const store = memoryStore();
    await Promise.all(["mail:1", "mail:2", "mail:3", "mail:4", "mail:5"].map((k) => startIntakeAttempt(store, "t1", k, now)));
    expect(Object.keys(store.map.get(`t1:${INTAKE_ATTEMPTS_KEY}`)).sort()).toEqual(["mail:1", "mail:2", "mail:3", "mail:4", "mail:5"]);
  });

  it("vergisst Einträge nach 24 Stunden", () => {
    const pruned = pruneIntakeAttempts(
      { alt: { count: 2, at: "2026-10-19T09:00:00.000Z" }, neu: { count: 1, at: "2026-10-20T09:00:00.000Z" }, kaputt: null as any },
      now,
    );
    expect(pruned).toEqual({ neu: { count: 1, at: "2026-10-20T09:00:00.000Z" } });
  });
});
