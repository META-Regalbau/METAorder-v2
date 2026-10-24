import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  buildConfigCode,
  buildTuples,
  choicesFor,
  feldlastFor,
  isChoiceAvailable,
  rearAvailable,
  snapToCatalog,
  toConfigContext,
  toCpqCoreInput,
  parseConfigCode,
  arPageUrl,
  type MetaClipCombinations,
} from "../../client/src/lib/metaClipCpq";

const COMBOS: MetaClipCombinations = {
  frames: [
    { variant: "clinch", height: 2000, depth: 500, surface: "verzinkt", feldlast: 1650 },
    { variant: "clinch", height: 2500, depth: 500, surface: "verzinkt", feldlast: 2400 },
    { variant: "clinch", height: 2000, depth: 500, surface: "lackiert", feldlast: 1650 },
    { variant: "s3", height: 2000, depth: 500, surface: "verzinkt", feldlast: 1100 },
  ],
  shelves: [
    { width: 1000, depth: 500, load: 230, surface: "verzinkt" },
    { width: 1000, depth: 500, load: 330, surface: "verzinkt" },
    { width: 1500, depth: 500, load: 200, surface: "verzinkt" },
    { width: 1000, depth: 500, load: 230, surface: "lackiert" },
    // ohne passenden Diagonalstab: nicht baubar
    { width: 1700, depth: 500, load: 200, surface: "verzinkt" },
  ],
  rears: [{ height: 2000, width: 1000, surface: "verzinkt" }],
  diagonals: [1000, 1500],
};
const tuples = buildTuples(COMBOS);
const start = { ...DEFAULT_STATE, hoehe: 2000, breite: 1000, tiefe: 500, last: 230, surface: "verzinkt" as const, rahmen: "clinch" as const };

describe("Regalplaner: Kombinationen aus dem Katalog", () => {
  it("baut Rahmen × Boden nur bei gleicher Tiefe, Oberfläche und vorhandenem Diagonalstab", () => {
    expect(choicesFor("breite", tuples)).toEqual([1000, 1500]);
    expect(choicesFor("rahmen", tuples)).toEqual(["clinch", "s3"]);
    expect(tuples.filter((t) => t.surface === "lackiert")).toHaveLength(1);
  });

  it("kennzeichnet Werte, die mit den übrigen Einstellungen nicht baubar sind", () => {
    expect(isChoiceAvailable(start, "last", 330, tuples)).toBe(true);
    expect(isChoiceAvailable(start, "last", 200, tuples)).toBe(false);
    expect(isChoiceAvailable(start, "hoehe", 2500, tuples)).toBe(true);
    expect(isChoiceAvailable({ ...start, surface: "lackiert" }, "hoehe", 2500, tuples)).toBe(false);
  });

  it("rückt bei einer Auswahl die übrigen Werte auf die nächste baubare Kombination", () => {
    // 1500er Böden gibt es nur mit 200 kg
    expect(snapToCatalog(start, { breite: 1500 }, tuples)).toMatchObject({ breite: 1500, last: 200, hoehe: 2000, rahmen: "clinch" });
    // S3 nur in 2000 mm: Höhe springt mit
    expect(snapToCatalog({ ...start, hoehe: 2500 }, { rahmen: "s3" }, tuples)).toMatchObject({ rahmen: "s3", hoehe: 2000 });
    // Lackiert gibt es nur in 2000 x 1000 mit 230 kg
    expect(snapToCatalog({ ...start, hoehe: 2500, last: 330 }, { surface: "lackiert" }, tuples)).toMatchObject({ surface: "lackiert", hoehe: 2000, last: 230 });
    // Baubar: nichts ändert sich
    expect(snapToCatalog(start, { last: 330 }, tuples)).toMatchObject({ ...start, last: 330 });
  });

  it("gibt die Feldlast des Rahmens an die Regelprüfung weiter", () => {
    expect(feldlastFor({ ...start, rahmen: "s3" }, tuples)).toBe(1100);
    expect(toCpqCoreInput({ ...start, rahmen: "s3" }, 1100)).toMatchObject({ connectionType: "s3", frame: { maxFeldlastKg: 1100 } });
    expect(toConfigContext({ ...start, rahmen: "s3" }).frame_variant).toBe("s3");
    expect(buildConfigCode({ ...start, rahmen: "s3", felder: 2, boeden: 5 })).toBe("CLIP-S3-2000-1000-500-2F5-230-V-NR");
  });

  it("bietet die Rückwand nur an, wenn es sie in Höhe × Feldbreite × Oberfläche gibt", () => {
    expect(rearAvailable(start, COMBOS)).toBe(true);
    expect(rearAvailable({ ...start, breite: 1500 }, COMBOS)).toBe(false);
    expect(rearAvailable({ ...start, surface: "lackiert" }, COMBOS)).toBe(false);
    expect(rearAvailable(start, null)).toBe(true);
  });

  it("verhält sich ohne Kombinationen (alte Mappings) wie bisher", () => {
    expect(buildTuples(null)).toEqual([]);
    expect(snapToCatalog(start, { breite: 1300 }, [])).toMatchObject({ breite: 1300 });
    expect(isChoiceAvailable(start, "breite", 1300, [])).toBe(true);
  });
});

describe("Regalplaner: Konfigurations-Code für die AR-Seite", () => {
  it("liest den Code zurück, den buildConfigCode schreibt", () => {
    const s = { ...start, rahmen: "s3" as const, felder: 3, boeden: 6, last: 330, surface: "lackiert" as const, rear: true };
    expect(parseConfigCode(buildConfigCode(s))).toEqual({
      rahmen: "s3", hoehe: 2000, breite: 1000, tiefe: 500, felder: 3, boeden: 6, last: 330, surface: "lackiert", rear: true,
    });
    expect(parseConfigCode("CLIP-2500-1300-400-2F5-230-V-NR")).toMatchObject({ rahmen: "clinch", hoehe: 2500, breite: 1300, rear: false });
  });

  it("lehnt Unbekanntes und Unplausibles ab", () => {
    expect(parseConfigCode("")).toBeNull();
    expect(parseConfigCode("MULTIPAL-2500-1000-500-2F5-230-V-NR")).toBeNull();
    expect(parseConfigCode("CLIP-2500-1000-500-0F5-230-V-NR")).toBeNull();
    expect(parseConfigCode("CLIP-9999-1000-500-2F5-230-V-NR")).toBeNull();
  });

  it("baut die Adresse der AR-Seite", () => {
    expect(arPageUrl("https://metaorder.example", { ...start, felder: 2, boeden: 5 })).toBe(
      "https://metaorder.example/regalplaner/ar?rp=CLIP-2000-1000-500-2F5-230-V-NR&lang=de",
    );
  });
});
