/**
 * Lager: Bestaende, Abgleich und Inventur-Zeilen zeigen eine Seite statt aller Zeilen (Testing:
 * ~8.200 Artikel = ~134.000 DOM-Elemente, axe brach nach 4 Minuten ab). Filter, Summen,
 * "alle markieren" und Zaehlliste arbeiten weiter auf der ganzen Liste.
 * Dazu: "Spiegel aktualisieren" im Abgleich schrieb die Antwort unter einen Cache-Schluessel,
 * den keine Abfrage liest - die Tabelle blieb alt. Bestaende und Abgleich teilen seit dem
 * Umbau der Abgleich-Antwort eine Abfrage (warehouseReconcile.test.ts).
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { pageSlice } from "../../client/src/lib/pagination";
import { stockReconcileQueryKey, storeRefreshedReconcile } from "../../client/src/lib/warehouseReconcile";

const rows = Array.from({ length: 120 }, (_, i) => `A${i + 1}`);

describe("pageSlice", () => {
  it("schneidet die Seite aus", () => {
    expect(pageSlice(rows, 1, 50)).toMatchObject({ page: 1, totalPages: 3 });
    expect(pageSlice(rows, 1, 50).rows).toHaveLength(50);
    expect(pageSlice(rows, 3, 50).rows).toEqual(rows.slice(100));
    expect(pageSlice(rows, 2, 50).rows[0]).toBe("A51");
  });

  it("begrenzt die Seite, wenn die Liste kuerzer wird (Neuladen, Filter)", () => {
    expect(pageSlice(rows.slice(0, 60), 3, 50)).toMatchObject({ page: 2, totalPages: 2 });
    expect(pageSlice(rows, 0, 50).page).toBe(1);
    expect(pageSlice(rows, -4, 50).page).toBe(1);
  });

  it("leere Liste und unsinnige Seitengroesse", () => {
    expect(pageSlice([], 5, 50)).toEqual({ rows: [], page: 1, totalPages: 1 });
    expect(pageSlice(rows, 1, Number("abc")).rows).toEqual(["A1"]);
    expect(pageSlice(rows, 1, 0).totalPages).toBe(120);
  });
});

describe("Spiegel aktualisieren im Abgleich", () => {
  it("Antwort ersetzt die Liste, die beide Reiter lesen", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    qc.setQueryData(stockReconcileQueryKey, { rows: ["alt"] });

    storeRefreshedReconcile(qc, { rows: ["neu"] });

    expect(qc.getQueryData(stockReconcileQueryKey)).toEqual({ rows: ["neu"] });
    // frueherer Schluessel ohne Modus: liest keine Abfrage
    expect(qc.getQueryData(["/api/erp/stock/reconcile"])).toBeUndefined();
  });

  it("die Seite liest denselben Schluessel", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/WarehousePage.tsx"), "utf8");
    expect(src).toContain("queryKey: stockReconcileQueryKey,");
    expect(src).not.toMatch(/setQueryData\(\["\/api\/erp\/stock\/reconcile"\]/);
  });
});

describe("Lagerseite rendert nur eine Seite", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/WarehousePage.tsx"), "utf8");

  it("keine Tabelle ueber die ganze Liste", () => {
    for (const list of ["filteredStockRows", "reconcileRows", "filteredInventoryLines"]) {
      expect(src, list).not.toMatch(new RegExp(`\\{${list}\\.map\\(`));
    }
    for (const paged of ["stockPage", "reconcilePage", "inventoryPage"]) {
      expect(src, paged).toMatch(new RegExp(`\\{${paged}\\.rows\\.map\\(`));
      expect(src, paged).toContain(`currentPage={${paged}.page}`);
    }
  });

  it("alle markieren und Zaehlliste bleiben bei der ganzen gefilterten Liste", () => {
    expect(src).toMatch(/for \(const r of filteredStockRows\) next\.add\(r\.productNumber\)/);
    expect(src).toMatch(/: filteredStockRows;\s*\n\s*\n\s*const rows: StockCountRow\[\] = source\.map/);
  });
});
