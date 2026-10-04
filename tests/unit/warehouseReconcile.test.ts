/**
 * Lager-Abgleich: weniger Daten fuer dieselbe Anzeige. In Testing lud die Lagerseite fuer
 * Bestaende + Abgleich ~30 MB: die Abgleich-Liste zweimal (alle / nur Abweichungen, je ~7,7 MB)
 * und dieselben Bezeichnungen noch einmal in ~34 Einzelanfragen je Reiter.
 * - Server: "nur Abweichungen" ist genau die vollstaendige Liste gefiltert mit isStockReconcileDiff
 *   (gleiche Summen) - die Seite darf also selbst filtern.
 * - Seite: eine Abfrage fuer beide Reiter; Bezeichnungen nur nachladen, wo die Liste keine hat.
 * - Antworten gzip-komprimiert, Server-Sent Events ausgenommen.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import express from "express";
import type { AddressInfo } from "node:net";
import { db } from "../../server/db";
import { erpStorage } from "../../server/erp/erpStorage";
import { buildStockReconcileDiff } from "../../server/erp/erpStockReconcile";
import { isStockReconcileDiff } from "../../shared/stockReconcile";
import { productNumbersNeedingLabels, reconcileLabelMap, stockReconcileUrl } from "../../client/src/lib/warehouseReconcile";
import { responseCompression } from "../../server/lib/responseCompression";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("Server: nur Abweichungen = vollstaendige Liste gefiltert", () => {
  const mirror = [
    { shopwareId: "p1", productNumber: "GLEICH", name: "Regal A", active: true, payload: { stock: 5, priceNet: 10 } },
    { shopwareId: "p2", productNumber: "MEHR", name: "Regal B", active: true, payload: { stock: 9 } },
    { shopwareId: "p3", productNumber: "NUR-SW", name: "Regal C", active: false, payload: { stock: 2 } },
    { shopwareId: "p4", productNumber: "NULL", name: "Regal D", active: true, payload: { stock: 0 } },
    { shopwareId: "eltern", productNumber: "ELTERN", name: "Regal E", active: true, payload: { stock: 1, childCount: 3 } },
    {
      shopwareId: "v1", productNumber: "VAR", name: null, active: true,
      payload: { stock: 1, parentId: "eltern", options: [{ group: "Größe", option: "2000 mm" }] },
    },
  ];
  const levels = [
    { productNumber: "GLEICH", quantity: 3, reservedQuantity: 0 },
    { productNumber: "GLEICH", quantity: 2, reservedQuantity: 1 }, // zweiter Lagerplatz: Summe 5
    { productNumber: "MEHR", quantity: 4, reservedQuantity: 0 },
    { productNumber: "NUR-ERP", quantity: 7, reservedQuantity: 0 },
    { productNumber: "VAR", quantity: 1, reservedQuantity: 0 },
  ];

  beforeAll(() => {
    vi.spyOn(db, "select").mockImplementation(() => ({ from: () => ({ where: async () => mirror }) }) as any);
    vi.spyOn(erpStorage, "listWarehouses").mockResolvedValue([{ id: "wh", code: "HL", name: "Hauptlager", isDefault: true, active: true }] as any);
    vi.spyOn(erpStorage, "listStockLevels").mockResolvedValue(levels as any);
  });
  afterAll(() => vi.restoreAllMocks());

  it("gleiche Zeilen und Summen wie onlyDiffs: true", async () => {
    const all = await buildStockReconcileDiff("t1", { onlyDiffs: false });
    const diffs = await buildStockReconcileDiff("t1", { onlyDiffs: true });
    expect(all.rows.map((r) => r.productNumber)).toEqual(["GLEICH", "MEHR", "NULL", "NUR-ERP", "NUR-SW", "VAR"]);
    expect(all.rows.filter(isStockReconcileDiff)).toEqual(diffs.rows);
    expect(diffs.rows.map((r) => [r.productNumber, r.delta])).toEqual([["MEHR", 5], ["NUR-ERP", -7], ["NUR-SW", 2]]);
    expect(all.totals).toEqual(diffs.totals);
    expect(all.totals).toEqual({ compared: 6, diffs: 3, onlyShopware: 2, onlyErp: 1, skippedParents: 1 });
    // ohne Angabe wie bisher nur Abweichungen (Buchen/Push nach Shopware verlassen sich darauf)
    expect((await buildStockReconcileDiff("t1")).rows).toEqual(diffs.rows);
  });

  it("Bezeichnungen kommen mit: Name aus dem Spiegel, Variante mit Elternname", async () => {
    const all = await buildStockReconcileDiff("t1", { onlyDiffs: false });
    const byPn = new Map(all.rows.map((r) => [r.productNumber, r.label]));
    expect(byPn.get("MEHR")?.name).toBe("Regal B");
    expect(byPn.get("VAR")?.name).toBe("Regal E");
    expect(byPn.get("NUR-ERP")?.name).toBeNull();
  });
});

describe("Seite: Bezeichnungen nur nachladen, wo die Abgleich-Liste keine hat", () => {
  const rows = [
    { productNumber: "A", label: { name: "Regal A" } },
    { productNumber: "B", label: { name: null } },
    { productNumber: "C", label: null },
  ];

  it("reconcileLabelMap: nur Zeilen mit Namen", () => {
    expect([...reconcileLabelMap(rows).keys()]).toEqual(["A"]);
  });

  it("productNumbersNeedingLabels", () => {
    const known = reconcileLabelMap(rows);
    expect(productNumbersNeedingLabels(["A", "B", "C", "MOVE-1"], known, false)).toEqual(["B", "C", "MOVE-1"]);
    // Abgleich-Liste laedt noch: nichts anfragen, sonst kaeme alles doppelt
    expect(productNumbersNeedingLabels(["A", "B"], known, true)).toEqual([]);
    // Liste nicht geladen (anderer Reiter): alles anfragen
    expect(productNumbersNeedingLabels(["A", "B"], new Map(), false)).toEqual(["A", "B"]);
  });

  it("die Seite fragt die vollstaendige Liste an", () => {
    expect(new URL(stockReconcileUrl, "http://x").searchParams.get("onlyDiffs")).toBe("false");
  });

  it("Verdrahtung in WarehousePage", () => {
    const src = read("client/src/pages/WarehousePage.tsx");
    // eine Abfrage fuer beide Reiter, Abgleich filtert selbst
    expect(src).toContain("queryKey: stockReconcileQueryKey,");
    expect(src).toMatch(/const reconcileRows = useMemo\(\(\) => reconcileAllRows\.filter\(isStockReconcileDiff\)/);
    expect(src).toMatch(/if \(reconcileAllRows\.length > 0\) \{\s*return reconcileAllRows/);
    // Nachladen mit Abwarten, Rueckfall auf die Bezeichnung aus der Liste (auch fuer Bewegungen)
    expect(src).toContain("productNumbersNeedingLabels(nums, reconcileLabelByPn, reconcileEnabled && reconcileLoading)");
    expect(src).toContain("primary || fromInventory || reconcileLabelByPn.get(productNumber) || null");
    expect(src).toContain("label={resolveLabel(m.productNumber)}");
    expect(src).not.toMatch(/label=\{getLabel\(/);
  });

  it("Spiegel aktualisieren liefert alle Zeilen (die Seite speichert sie fuer beide Reiter)", () => {
    const route = read("server/erp/erpRoutes.ts").split('"/api/erp/stock/reconcile/refresh-mirror"')[1].split("app.")[0];
    expect(route).toContain("buildStockReconcileDiff(requireTenant(req), { onlyDiffs: false })");
  });
});

describe("Antworten komprimiert, Server-Sent Events nicht", () => {
  let server: http.Server;
  let port = 0;
  const big = { rows: Array.from({ length: 2000 }, (_, i) => ({ productNumber: `A${i}`, name: "Kragarmregal einseitig" })) };

  beforeAll(async () => {
    const app = express();
    app.use(responseCompression());
    app.get("/gross", (_req, res) => res.json(big));
    app.get("/klein", (_req, res) => res.json({ ok: true }));
    app.get("/sse", (_req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.write(`data: ${JSON.stringify({ type: "connected", pad: "x".repeat(2000) })}\n\n`);
      // offen lassen wie der echte Benachrichtigungs-Stream
    });
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  type Got = { headers: http.IncomingHttpHeaders; body: Buffer };
  /** Ganze Antwort lesen; bei firstChunkOnly nach dem ersten Datenblock abbrechen (Stream bleibt sonst offen). */
  const get = (p: string, acceptEncoding?: string, firstChunkOnly = false) =>
    new Promise<Got>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`keine Daten von ${p} nach 2 s`)), 2000);
      const req = http.get({ port, path: p, headers: acceptEncoding ? { "Accept-Encoding": acceptEncoding } : {} }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          chunks.push(c);
          if (firstChunkOnly) {
            clearTimeout(timer);
            res.destroy();
            resolve({ headers: res.headers, body: c });
          }
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ headers: res.headers, body: Buffer.concat(chunks) });
        });
      });
      req.on("error", (e) => (firstChunkOnly ? undefined : reject(e)));
    });

  it("grosse JSON-Antwort: gzip, Inhalt unveraendert", async () => {
    const r = await get("/gross", "gzip, deflate");
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(zlib.gunzipSync(r.body).toString())).toEqual(big);
    expect(r.body.length).toBeLessThan(JSON.stringify(big).length / 5);
  });

  it("Browser bieten auch Brotli an: br, Inhalt unveraendert", async () => {
    const r = await get("/gross", "gzip, deflate, br, zstd");
    expect(r.headers["content-encoding"]).toBe("br");
    expect(JSON.parse(zlib.brotliDecompressSync(r.body).toString())).toEqual(big);
  });

  it("ohne Accept-Encoding und bei kleinen Antworten: unkomprimiert", async () => {
    const plain = await get("/gross");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(plain.body.toString())).toEqual(big);
    const small = await get("/klein", "gzip");
    expect(small.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(small.body.toString())).toEqual({ ok: true });
  });

  it("Server-Sent Events: unkomprimiert, erstes Ereignis kommt sofort", async () => {
    const r = await get("/sse", "gzip, deflate, br", true);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.toString()).toMatch(/^data: \{"type":"connected"/);
  });

  it("in server/index.ts vor allen Routen eingehaengt", () => {
    const src = read("server/index.ts");
    const use = src.indexOf("app.use(responseCompression());");
    expect(use).toBeGreaterThan(-1);
    expect(use).toBeLessThan(src.indexOf("registerRoutes("));
    expect(use).toBeLessThan(src.indexOf('app.get("/healthz"'));
  });
});
