import { describe, expect, it } from "vitest";
import {
  CLIP_SALES_CHANNEL_ID,
  buildClipMappingPlan,
  classifyClipPart,
  clipCombinationsFromMappings,
  diffClipMappings,
  frameLoadTable,
  type ClipCatalogProduct,
} from "../../server/cpq/clipCatalogSync";
import { resolveBillOfMaterials } from "../../server/cpq/cpqBillOfMaterials";
import type { CpqComponentType, CpqProductMapping } from "@shared/schema";

const product = (productNumber: string, name: string, extra: Partial<ClipCatalogProduct> = {}): ClipCatalogProduct => ({
  shopwareId: `sw-${productNumber}`,
  productNumber,
  name,
  active: true,
  salesChannelIds: [CLIP_SALES_CHANNEL_ID],
  properties: {},
  ...extra,
});

const set = (n: string, name: string, props: Record<string, string>) => product(n, name, { properties: { Bauweise: "Einfachregal", ...props } });

const CATALOG: ClipCatalogProduct[] = [
  product("f1", "META CLIP | Ständerrahmen T1N | 2000 x 500 mm | verzinkt"),
  product("f2", "META CLIP S3 | Ständerrahmen T1N | 2000 x 500 mm | vzk"),
  product("f3", "META CLIP S3 | Ständerrahmen T2N | 2200 x 500 mm | vzk"),
  product("s1", "META CLIP | Zusatz-Fachboden | 1000 x 500 mm | 230 kg | verzinkt"),
  product("s2", "META CLIP SPLIT | Zusatz-Fachboden | 1000 x 400 mm | 230 kg | verzinkt | 2 Stück"),
  product("s3", "META FIX | Zusatz-Fachboden | 1000 x 500 mm | 80 kg | verzinkt"),
  product("d1", "META CLIP | Diagonalstab | für Regalbreite 750 mm| verzinkt"),
  product("r1", "META CLIP | Vollblech-Rückwand | 2000 x 1000 mm | RAL 7035"),
  product("k1", "META CLIP | Klemmfuß Einfachregal | verzinkt | 10 Stück"),
  product("x1", "META CLIP | Spannschloss | für CLIP Diagonalstab | verzinkt", { salesChannelIds: [] }),
  set("g1", "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", {
    Höhe: "2000 mm", "Rahmentyp/Profiltyp": "Rahmen T1 N", "max. Feldlast": "1650 kg",
  }),
  set("g2", "META CLIP S3 | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 150 kg | 5 Ebenen | verzinkt", {
    Höhe: "2000 mm", "Rahmentyp/Profiltyp": "Profil T1 N", "max. Feldlast": "1150 kg",
  }),
  set("g3", "META CLIP S3 | Fachbodenregal | Anbauregal | 2000 x 1000 x 500 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", {
    Höhe: "2000 mm", "Rahmentyp/Profiltyp": "Profil T1 N", "max. Feldlast": "1.100 kg",
  }),
];

describe("Regalplaner CLIP: Teile aus dem Katalog", () => {
  it("erkennt Rahmen beider Varianten, Böden, Diagonalstäbe und Rückwände", () => {
    expect(classifyClipPart("META CLIP | Ständerrahmen T1N | 2500 x 800 mm | RAL 7035")).toEqual({
      role: "frame", frameType: "T1N", attributes: { height: 2500, depth: 800, surface: "lackiert", frameVariant: "clinch" },
    });
    expect(classifyClipPart("META CLIP S3 | Ständerrahmen T2N | 2500 x 300 mm | vzk")?.attributes).toEqual({
      height: 2500, depth: 300, surface: "verzinkt", frameVariant: "s3",
    });
    expect(classifyClipPart("META CLIP | Zusatz-Fachboden | 1300 x 400 mm | 150 kg | RAL 7035")?.attributes).toEqual({
      width: 1300, depth: 400, load: 150, surface: "lackiert",
    });
    expect(classifyClipPart("META CLIP | Diagonalstab | für Regalbreite 750 mm| verzinkt")?.attributes).toEqual({ width: 750 });
    expect(classifyClipPart("META CLIP | Vollblech-Rückwand | 2500 x 1300 mm | verzinkt")?.attributes).toEqual({ height: 2500, width: 1300, surface: "verzinkt" });
    expect(classifyClipPart("META CLIP | Fußverdübelungs-Set für Anbauregal")?.role).toBe("verankerung_anbau");
  });

  it("nimmt fremde Systeme, Doppelpacks und Rahmen ohne Rahmentyp T1N/T2N nicht auf", () => {
    expect(classifyClipPart("META FIX | Zusatz-Fachboden | 1000 x 500 mm | 80 kg | verzinkt")).toBeNull();
    expect(classifyClipPart("META MULTISTRONG L+M | Zusatz-Fachboden | 1300 x 400 mm | 330 kg | verzinkt")).toBeNull();
    expect(classifyClipPart("META CLIP SPLIT | Zusatz-Fachboden | 1000 x 400 mm | 230 kg | verzinkt | 2 Stück")).toBeNull();
    expect(classifyClipPart("META CLIP | Ständerrahmen Vollwand | 2000 x 500 mm | verzinkt")).toBeNull();
    expect(classifyClipPart("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 500 mm | Fachlast 230 kg | 5 Ebenen | verzinkt")).toBeNull();
  });

  it("liest die Feldlast je Variante, Höhe und Rahmentyp aus den Grund- und Anbauregalen (kleinster Wert)", () => {
    const table = frameLoadTable(CATALOG);
    expect(table.get("clinch:2000:T1N")).toBe(1650);
    expect(table.get("s3:2000:T1N")).toBe(1100);
    expect(table.size).toBe(2);
  });

  it("plant nur sichtbare Teile mit belegter Feldlast", () => {
    const { specs, skipped } = buildClipMappingPlan(CATALOG);
    expect(specs.map((s) => s.shopwareProductNumber).sort()).toEqual(["d1", "f1", "f2", "k1", "r1", "s1"]);
    expect(specs.find((s) => s.shopwareProductNumber === "f2")?.attributes).toMatchObject({ frameVariant: "s3", feldlast: 1100 });
    expect(skipped.map((s) => [s.productNumber, s.reason])).toEqual([
      ["f3", "keine belegte Feldlast (kein Grund-/Anbauregal s3:2200:T2N)"],
      ["x1", "nicht im Onlineshop META Regalbau DE"],
    ]);
  });
});

const mapping = (id: string, productNumber: string, componentTypeId: string, attributes: Record<string, unknown>, status = "active"): CpqProductMapping =>
  ({ id, shopwareProductNumber: productNumber, shopwareProductId: `sw-${productNumber}`, productName: productNumber, componentTypeId, attributes, status }) as CpqProductMapping;

describe("Regalplaner CLIP: Abgleich mit den bestehenden Mappings", () => {
  const types = { frame: "ct-frame", shelf: "ct-shelf", diagonal: "ct-diag", accessory: "ct-rear", klemmfuss: "ct-klemm" };

  it("legt neue an, ergänzt Attribute und deaktiviert Fremdteile", () => {
    const { specs } = buildClipMappingPlan(CATALOG);
    const current = [
      mapping("m1", "f1", "ct-frame", { height: 2000, depth: 500, surface: "verzinkt" }),
      mapping("m2", "s1", "ct-shelf", { width: 1000, depth: 500, load: 230, surface: "verzinkt" }),
      mapping("m3", "s3", "ct-shelf", { width: 1000, depth: 500, load: 80, surface: "verzinkt" }),
      mapping("m4", "d1", "ct-diag", { width: 750 }, "inactive"),
    ];
    const diff = diffClipMappings(current, specs, types);
    expect(diff.create.map((s) => s.shopwareProductNumber).sort()).toEqual(["f2", "k1", "r1"]);
    expect(diff.update.map((u) => [u.id, u.spec.attributes])).toEqual([
      ["m1", { height: 2000, depth: 500, surface: "verzinkt", frameVariant: "clinch", feldlast: 1650 }],
      ["m4", { width: 750 }],
    ]);
    expect(diff.deactivate.map((d) => d.id)).toEqual(["m3"]);
    expect(diff.unchanged).toBe(1);
  });

  it("ist beim zweiten Lauf ohne Änderungen", () => {
    const { specs } = buildClipMappingPlan(CATALOG);
    const current = specs.map((s, i) => mapping(`m${i}`, s.shopwareProductNumber, types[s.role as keyof typeof types], s.attributes));
    const diff = diffClipMappings(current, specs, types);
    expect(diff).toMatchObject({ create: [], update: [], deactivate: [], unchanged: specs.length });
  });

  it("liefert dem Konfigurator die baubaren Kombinationen", () => {
    const combos = clipCombinationsFromMappings(
      [
        mapping("a", "f2", "ct-frame", { height: 2000, depth: 500, surface: "verzinkt", frameVariant: "s3", feldlast: 1100 }),
        mapping("b", "s1", "ct-shelf", { width: 1000, depth: 500, load: 230, surface: "verzinkt" }),
        mapping("c", "r1", "ct-rear", { height: 2000, width: 1000, surface: "lackiert" }),
        mapping("d", "d1", "ct-diag", { width: 1000 }),
        mapping("e", "s3", "ct-shelf", { width: 1000, depth: 500, load: 80, surface: "verzinkt" }, "inactive"),
      ],
      [{ id: "ct-frame", role: "frame" }, { id: "ct-shelf", role: "shelf" }, { id: "ct-rear", role: "accessory" }, { id: "ct-diag", role: "diagonal" }],
    );
    expect(combos).toEqual({
      frames: [{ variant: "s3", height: 2000, depth: 500, surface: "verzinkt", feldlast: 1100 }],
      shelves: [{ width: 1000, depth: 500, load: 230, surface: "verzinkt" }],
      rears: [{ height: 2000, width: 1000, surface: "lackiert" }],
      diagonals: [1000],
    });
  });
});

describe("Stückliste mit Rahmenart und Rückwand", () => {
  const ct = (id: string, role: string): CpqComponentType => ({ id, name: role, role }) as CpqComponentType;
  const componentTypes = [ct("ct-frame", "frame"), ct("ct-shelf", "shelf"), ct("ct-rear", "accessory")];
  const mappings = [
    mapping("m1", "clinch", "ct-frame", { height: 2000, depth: 500, surface: "verzinkt", frameVariant: "clinch" }),
    mapping("m2", "s3", "ct-frame", { height: 2000, depth: 500, surface: "verzinkt", frameVariant: "s3" }),
    mapping("m3", "boden", "ct-shelf", { width: 1000, depth: 500, load: 230, surface: "verzinkt" }),
    mapping("m4", "rw2500", "ct-rear", { height: 2500, width: 1000, surface: "verzinkt" }),
  ];
  const getProduct = (n: string) => ({ id: `sw-${n}`, name: n, price: 10 });
  const base = { field_count: 2, level_count: 5, height: 2000, depth: 500, width: 1000, load: 230, surface: "verzinkt", accessory_quantity: 0 };

  it("wählt den Rahmen der gewählten Variante", async () => {
    const bom = await resolveBillOfMaterials("sys", { ...base, frame_variant: "s3" }, componentTypes, mappings, [], getProduct);
    expect(bom.errors).toEqual([]);
    expect(bom.items.find((i) => i.componentType === "frame")).toMatchObject({ productNumber: "s3", quantity: 3 });
  });

  it("nimmt keine Rückwand in falscher Höhe, sondern meldet sie", async () => {
    const bom = await resolveBillOfMaterials("sys", { ...base, frame_variant: "clinch", accessory_quantity: 2 }, componentTypes, mappings, [], getProduct);
    expect(bom.items.some((i) => i.productNumber === "rw2500")).toBe(false);
    expect(bom.errors).toEqual(["accessory: Kein passender Artikel für Höhe 2000 mm, Breite 1000 mm gefunden"]);
  });
});
