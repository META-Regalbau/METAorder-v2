import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/product-variants.js"), "utf8");
const context: Record<string, any> = {};
vm.runInNewContext(source, context);
type Option = { label: string; current?: boolean; href?: string; note?: string; colors?: string[] };
const { buildGroups, surfaceInfo } = context.MetaProductVariants as {
  buildGroups: (name: string, items: Array<{ name: string; href: string }>) => Array<{ key: string; label: string; options: Option[] }>;
  surfaceInfo: (s: string) => { label: string; colors: string[] };
};

const current = "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt";
const item = (name: string) => ({ name, href: `https://shop/${encodeURIComponent(name)}` });
const view = (groups: ReturnType<typeof buildGroups>) =>
  groups.map((g) => `${g.label}: ${g.options.map((o) => (o.current ? `[${o.label}]` : o.label) + (o.note ? ` (${o.note})` : "")).join(", ")}`);

describe("Auch erhältlich in (Storefront-Skript)", () => {
  it("ordnet Ausführungen nach Höhe, Tiefe und Farbe, mit dem angezeigten Wert markiert", () => {
    const groups = buildGroups(current, [
      item("META CLIP | Fachbodenregal | Grundregal | 3000 x 1000 x 400 mm | Fachlast 230 kg | 6+1 Ebenen | verzinkt"),
      item("META CLIP | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | verzinkt"),
      item("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 600 mm | Fachlast 330 kg | 5 Ebenen | verzinkt"),
      item("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 300 mm | Fachlast 230 kg | 5 Ebenen | verzinkt"),
      item("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 230 kg | 5 Ebenen | RAL 7035"),
    ]);
    expect(view(groups)).toEqual([
      "Höhe: [2000 mm], 2500 mm, 3000 mm",
      "Tiefe: 300 mm, [400 mm], 600 mm (Fachlast 330 kg)",
      "Farbe: [Verzinkt], RAL 7035 lichtgrau",
    ]);
    expect(groups[0].options[1].href).toContain("2500");
  });

  it("lässt Artikel weg, die sich in mehr als einem Merkmal, in der Breite oder Bauart unterscheiden", () => {
    const groups = buildGroups(current, [
      item("META CLIP | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | RAL 7035"),
      item("META CLIP | Fachbodenregal | Grundregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt"),
      item("META CLIP | Fachbodenregal | Anbauregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | verzinkt"),
      item("META CLIP S3 | Fachbodenregal | Grundregal | 2500 x 1000 x 400 mm | Fachlast 230 kg | 6 Ebenen | verzinkt"),
      item("META CLIP | Zusatz-Fachboden | 1000 x 400 mm | 230 kg | verzinkt"),
    ]);
    expect(groups).toEqual([]);
  });

  it("kein Bereich für Artikel außerhalb des Namensschemas", () => {
    expect(buildGroups("Wandbefestigung", [item(current)])).toEqual([]);
  });

  it("Farbnamen und Farbpunkte", () => {
    expect(surfaceInfo("RAL 5010")).toMatchObject({ label: "RAL 5010 enzianblau" });
    expect(surfaceInfo("verzinkt/RAL 7035").colors).toHaveLength(2);
    expect(surfaceInfo("feuerverzinkt").label).toBe("Feuerverzinkt");
  });
});
