/**
 * Vorgangsprotokoll der Entwurfs-Automatik und der Rechteverwaltung: feste Ereigniscodes,
 * Bereich „drafts“, Entwurfs-ID und Benutzer als Felder (im Systemprotokoll suchbar),
 * Rechte-Unterschied bei Rollenänderungen (z. B. „DB-Werte sehen“ erteilt/entzogen).
 * Ausführung: npm test
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, setLoggerForTests } from "../../server/lib/logger";
import { auditUser, logDraftEvent } from "../../server/commercial/draftAuditLog";
import { permissionDiff } from "../../server/routes/userRoutes";

function captureLogs() {
  const lines: Record<string, any>[] = [];
  setLoggerForTests(
    createLogger({ level: "trace", format: "json", destination: { write: (chunk: string) => lines.push(JSON.parse(chunk)) } }),
  );
  return lines;
}

afterEach(() => setLoggerForTests(null));

describe("logDraftEvent", () => {
  it("schreibt Ereignis, Bereich, Entwurf und Benutzer als Felder; leere Felder entfallen", () => {
    const lines = captureLogs();
    logDraftEvent(
      "info",
      "draft.price.changed",
      {
        draftKind: "order",
        draftId: "d1",
        tenantId: "t1",
        ...auditUser({ id: "u1", username: "sb", password: "geheim" }),
        manualUnitPriceNet: 99,
        unused: undefined,
      },
      "Preis einer Entwurfsposition geändert",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      msg: "Preis einer Entwurfsposition geändert",
      area: "drafts",
      component: "commercial/draftAuditLog",
      event: "draft.price.changed",
      draftKind: "order",
      draftId: "d1",
      tenantId: "t1",
      userId: "u1",
      username: "sb",
      manualUnitPriceNet: 99,
    });
    expect(lines[0]).not.toHaveProperty("unused");
    expect(JSON.stringify(lines[0])).not.toContain("geheim");
  });

  it("ohne Mandant kein leeres tenantId-Feld (Kontext des Requests gilt)", () => {
    const lines = captureLogs();
    logDraftEvent("warn", "draft.margin.create_blocked", { draftKind: "offer", draftId: "d2", tenantId: null }, "gesperrt");
    expect(lines[0]).toMatchObject({ level: "warn", event: "draft.margin.create_blocked" });
    expect(lines[0]).not.toHaveProperty("tenantId");
  });

  it("auditUser ohne Benutzer (Automatik)", () => {
    expect(auditUser(undefined)).toEqual({ userId: null, username: null });
  });
});

describe("permissionDiff (Rollenänderung)", () => {
  it("erteilte und entzogene Rechte, sortiert", () => {
    expect(
      permissionDiff(
        { viewOrders: true, manageOffers: true, viewMarginDetails: false },
        { viewOrders: true, manageOffers: false, viewMarginDetails: true, viewCrm: true },
      ),
    ).toEqual({ granted: ["viewCrm", "viewMarginDetails"], revoked: ["manageOffers"] });
  });

  it("neue Rolle: alle gesetzten Rechte gelten als erteilt", () => {
    expect(permissionDiff({}, { viewOrders: true, editOrders: false })).toEqual({ granted: ["viewOrders"], revoked: [] });
  });
});
