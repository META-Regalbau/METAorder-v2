/**
 * Adress-Parameter (?q=..., ?search=...) ueber wouter useSearch() lesen. useLocation() liefert in
 * wouter 3 nur den Pfad: "location.split('?')[1]" war immer leer. Folgen: Suchen auf der Suchseite
 * lief nie (nur Aufruf mit ?q= von aussen), Links aus Suchergebnissen (/products?search=...,
 * /offers?search=..., /tickets?search=...) und /orders?search=... setzten keinen Filter.
 * Statische Pruefung des Client-Codes. Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const CLIENT = path.resolve(__dirname, "../../client/src");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });

describe("Adress-Parameter", () => {
  it("kein Query aus useLocation (immer leer)", () => {
    const found = files(CLIENT).filter((f) => /location\.split\(["']\?["']\)\[1\]|location\.includes\(["']\?["']\)/.test(fs.readFileSync(f, "utf8")));
    expect(found.map((f) => path.relative(CLIENT, f))).toEqual([]);
  });

  it("Suchseite und Ziele der Suchergebnisse lesen useSearch()", () => {
    for (const f of ["pages/SemanticSearchPage.tsx", "pages/ProductsPage.tsx", "pages/OffersPage.tsx", "pages/TicketsPage.tsx", "pages/OrdersPage.tsx", "components/TopBar.tsx"]) {
      expect(fs.readFileSync(path.join(CLIENT, f), "utf8"), f).toContain("const searchString = useSearch();");
    }
  });
});
