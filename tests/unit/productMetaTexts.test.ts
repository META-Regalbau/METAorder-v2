import { describe, expect, it, vi } from "vitest";
import {
  isServiceArticle,
  descriptionText,
  metaReasonHint,
  pickStyleExamples,
  PRODUCT_META_TEXTS_MARKER,
  productSourceHash,
  runProductMetaTexts,
  selectMetaCandidates,
  validateGeneratedMeta,
  type GeneratedMeta,
  type MetaGenerator,
} from "../../server/products/productMetaTexts";
import type { ProductMetaSource } from "../../server/shopware/client/productMeta";

function product(partial: Partial<ProductMetaSource> & { productNumber: string }): ProductMetaSource {
  return {
    id: `id-${partial.productNumber}`,
    active: true,
    visible: true,
    name: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt",
    description: "<p>Unser META CLIP Fachbodenregal eignet sich ideal f&uuml;r Kleinteile.</p>",
    properties: [
      { group: "Regal-Typ", option: "Anbauregal" },
      { group: "max. Fachlast", option: "230 kg" },
      { group: "max. Feldlast", option: "1650 kg" },
    ],
    metaTitle: null,
    metaDescription: null,
    customFields: null,
    ...partial,
  };
}

const GOOD: GeneratedMeta = {
  metaTitle: "META CLIP Anbauregal 2000x1300x400 mm | 5 Ebenen | 230 kg | verzinkt",
  metaDescription:
    "Verzinktes META CLIP Anbauregal 2000x1300x400 mm mit 5 Ebenen und 230 kg Fachlast – zur Erweiterung Ihres Grundregals in Lager und Werkstatt.",
};

describe("descriptionText", () => {
  it("entfernt HTML und loest Entitaeten auf", () => {
    expect(descriptionText("<p>F&uuml;r Lager&nbsp;&amp; Werkstatt</p><ul><li>230 kg</li></ul>")).toBe("Für Lager & Werkstatt 230 kg");
  });
});

describe("validateGeneratedMeta", () => {
  const p = product({ productNumber: "4026212439502" });

  it("akzeptiert passende Texte", () => {
    expect(validateGeneratedMeta(p, GOOD)).toBeNull();
  });

  it("Zahlen muessen im Artikel stehen", () => {
    expect(validateGeneratedMeta(p, { ...GOOD, metaTitle: "META CLIP Anbauregal 2000x1300x400 mm | 6 Ebenen | 230 kg" })).toBe("number_6");
  });

  it("Tausenderpunkt gilt als dieselbe Zahl", () => {
    const old = product({ productNumber: "4026212101089", name: "CL GR 2000 1300 400 vzk kpl" });
    const meta: GeneratedMeta = {
      metaTitle: "META CLIP Grundregal 2000x1300x400 mm | verzinkt | komplett",
      metaDescription: "META CLIP Grundregal 2000x1300x400 mm, verzinkt, als kompletter Satz. Fachlast 230 kg, Feldlast 1.650 kg – für Lager und Werkstatt.",
    };
    expect(validateGeneratedMeta(old, meta)).toBeNull();
  });

  it("Laengen", () => {
    expect(validateGeneratedMeta(p, { ...GOOD, metaTitle: "x".repeat(71) })).toBe("title_length_71");
    expect(validateGeneratedMeta(p, { ...GOOD, metaDescription: "zu kurz" })).toBe("description_length_7");
  });

  it("keine Versprechen, die der Artikel nicht hergibt", () => {
    const desc = "Verzinktes META CLIP Anbauregal mit 5 Ebenen und 230 kg Fachlast – versandkostenfrei und robust für Lager und Werkstatt.";
    expect(validateGeneratedMeta(p, { ...GOOD, metaDescription: desc })).toBe("claim_shipping");
    const withGarantie = product({ productNumber: "1", description: "Mit 5 Jahren Garantie auf alle Teile." });
    const desc2 = "META CLIP Anbauregal mit 230 kg Fachlast und 5 Jahren Garantie – robust, verzinkt und schnell montiert für Lager und Werkstatt.";
    expect(validateGeneratedMeta(withGarantie, { ...GOOD, metaDescription: desc2 })).toBeNull();
  });

  it("nur META: Wettbewerber nur, wenn der Artikel sie selbst nennt", () => {
    const desc = "META CLIP Anbauregal mit 5 Ebenen und 230 kg Fachlast – stabil wie bei Tegometall, verzinkt für Lager und Werkstatt.";
    expect(validateGeneratedMeta(p, { ...GOOD, metaDescription: desc })).toBe("claim_competitor");
    expect(metaReasonHint("claim_competitor")).toContain("nur META");
  });

  it("Fachlast und Masse aus dem Namen haben Vorrang vor den Eigenschaften", () => {
    const shelf = product({
      productNumber: "4026212238204",
      name: "META CLIP S3 | Schrägbodenregal | Anbauregal | 2000 x 1300 x 1228 mm | Fachlast 80 kg | 4 Ebenen | verzinkt",
      properties: [{ group: "max. Fachlast", option: "200 kg" }, { group: "Tiefe", option: "1300 mm" }],
    });
    const ok: GeneratedMeta = {
      metaTitle: "META CLIP S3 Schrägbodenregal 2000x1300x1228 mm | 80 kg | 4 Ebenen",
      metaDescription: "META CLIP S3 Schrägbodenregal als Anbauregal, 2000x1300x1228 mm, 80 kg Fachlast, 4 Ebenen, verzinkt – für FIFO-Lagerung von Kartons.",
    };
    expect(validateGeneratedMeta(shelf, ok)).toBeNull();
    expect(validateGeneratedMeta(shelf, { ...ok, metaTitle: ok.metaTitle.replace("80 kg", "200 kg") })).toBe("name_kg_200");
    expect(validateGeneratedMeta(shelf, { ...ok, metaTitle: ok.metaTitle.replace("2000x1300x1228", "2000x1300x1300") })).toBe("name_dimensions_2000x1300x1300");
  });

  it("alte Kurznamen ohne kg/Masse: Werte aus den Eigenschaften erlaubt", () => {
    const foot = product({
      productNumber: "4026212393408",
      name: "KR H Fuß 220 DR 400 R5010",
      description: "",
      properties: [{ group: "Tiefe", option: "500 mm" }, { group: "Höhe", option: "220 mm" }],
    });
    const meta: GeneratedMeta = {
      metaTitle: "Kragarm Fußteil doppelseitig 220 mm RAL 5010 | MULTISTRONG H",
      metaDescription: "Fußteil doppelseitig für MULTISTRONG H Kragarmregale, Höhe 220 mm, Tiefe 500 mm, RAL 5010. Für stabilen Stand im Lager und in der Werkstatt.",
    };
    expect(validateGeneratedMeta(foot, meta)).toBeNull();
  });

  it("fvzk im Namen erlaubt feuerverzinkt", () => {
    const pipe = product({ productNumber: "4026212141696", name: "Rohr D33,7 2,5 250 fvzk", description: "", properties: [] });
    const meta: GeneratedMeta = {
      metaTitle: "Rohr Ø 33,7 x 2,5 mm | Länge 250 mm | feuerverzinkt",
      metaDescription: "Feuerverzinktes Stahlrohr mit 33,7 mm Durchmesser, 2,5 mm Wandstärke und 250 mm Länge – robust für den Einsatz im Regalbau.",
    };
    expect(validateGeneratedMeta(pipe, meta)).toBeNull();
  });

  it("RAL-Farbe ist keine Pulverbeschichtung", () => {
    const desc = "META CLIP Anbauregal mit 5 Ebenen und 230 kg Fachlast, pulverbeschichtet in Lichtgrau – robust für Lager und Werkstatt im Alltag.";
    expect(validateGeneratedMeta(p, { ...GOOD, metaDescription: desc })).toBe("claim_surface");
  });
});

describe("metaReasonHint", () => {
  it("uebersetzt Pruefcodes fuer den Neuversuch", () => {
    expect(metaReasonHint("claim_surface")).toContain("NICHT \"pulverbeschichtet\"");
    expect(metaReasonHint("title_length_77")).toBe("Meta-Title 25–70 Zeichen (war 77)");
  });
});

describe("selectMetaCandidates", () => {
  it("nur aktive, sichtbare Artikel; leere Felder werden geschrieben, eigene Texte bleiben", () => {
    const sel = selectMetaCandidates([
      product({ productNumber: "a" }),
      product({ productNumber: "b", active: false }),
      product({ productNumber: "c", visible: false }),
      product({ productNumber: "d", metaTitle: "Eigener Titel", metaDescription: "Eigene Beschreibung" }),
      product({ productNumber: "e", metaTitle: "Eigener Titel" }),
    ]);
    expect(sel.products).toBe(3);
    expect(sel.candidates.map((c) => c.product.productNumber)).toEqual(["a", "e"]);
    expect(sel.candidates[1].writeTitle).toBe(false);
    expect(sel.candidates[1].writeDescription).toBe(true);
    expect(sel.keptManualTitle).toBe(2);
    expect(sel.keptManualDescription).toBe(1);
  });

  it("eigene Texte: unveraendert bei gleicher Quelle, neu bei geaenderter Quelle", () => {
    const base = product({ productNumber: "a", ...GOOD });
    const marker = { ...GOOD, sourceHash: productSourceHash(base) };
    const same = { ...base, customFields: { [PRODUCT_META_TEXTS_MARKER]: marker } };
    expect(selectMetaCandidates([same]).unchanged).toBe(1);
    const wrongLoad = { ...base, metaTitle: GOOD.metaTitle.replace("230 kg", "1650 kg") };
    const own = { ...wrongLoad, customFields: { [PRODUCT_META_TEXTS_MARKER]: { ...marker, metaTitle: wrongLoad.metaTitle } } };
    const healed = selectMetaCandidates([own]);
    expect(healed.candidates).toHaveLength(1);
    expect(healed.candidates[0].writeTitle).toBe(true);
    // Eigene Beschreibung + zu langer, von Hand gepflegter Titel: kein Dauer-Neuerzeugen
    const manualLongTitle = {
      ...base,
      metaTitle: "x".repeat(77),
      customFields: { [PRODUCT_META_TEXTS_MARKER]: { metaDescription: GOOD.metaDescription, sourceHash: marker.sourceHash } },
    };
    const mixed = selectMetaCandidates([manualLongTitle]);
    expect(mixed.candidates).toHaveLength(0);
    expect(mixed.keptManualTitle).toBe(1);
    const renamed = { ...same, name: "META CLIP | Fachbodenregal | Anbauregal | NEU" };
    const sel = selectMetaCandidates([renamed]);
    expect(sel.candidates).toHaveLength(1);
    expect(sel.candidates[0].writeTitle && sel.candidates[0].writeDescription).toBe(true);
  });
});

describe("pickStyleExamples", () => {
  it("nimmt nur von Hand gepflegte Texte, je Familie einen", () => {
    const ex = pickStyleExamples([
      product({ productNumber: "1", name: "META CLIP | A", ...GOOD }),
      product({ productNumber: "2", name: "META CLIP | B", ...GOOD }),
      product({ productNumber: "3", name: "META MULTIPAL | C", ...GOOD }),
      product({ productNumber: "4", name: "META FIX | D", ...GOOD, customFields: { [PRODUCT_META_TEXTS_MARKER]: GOOD } }),
    ]);
    expect(ex.map((p) => p.productNumber)).toEqual(["1", "3"]);
  });
});

describe("runProductMetaTexts", () => {
  const products = [product({ productNumber: "4026212439502" }), product({ productNumber: "4026212439503" })];
  const client = () => ({
    fetchProductMetaSources: vi.fn().mockResolvedValue(products),
    syncProductMetaTexts: vi.fn().mockResolvedValue(undefined),
  });

  it("schreibt gepruefte Texte mit Markierung; Verworfenes wird einmal neu angefragt", async () => {
    const c = client();
    const generate = vi.fn<MetaGenerator>()
      .mockResolvedValueOnce(
        new Map([
          ["4026212439502", GOOD],
          ["4026212439503", { ...GOOD, metaTitle: "zu kurz" }],
        ]),
      )
      .mockResolvedValueOnce(new Map([["4026212439503", GOOD]]));
    const summary = await runProductMetaTexts(c, generate, { dryRun: false, trigger: "manual", maxProducts: 100 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].map((p) => p.productNumber)).toEqual(["4026212439503"]);
    expect(generate.mock.calls[1][2]?.get("4026212439503")).toBe("title_length_7");
    expect(summary.written).toBe(2);
    expect(summary.rejected).toBe(0);
    const updates = c.syncProductMetaTexts.mock.calls[0][0];
    expect(updates[0]).toMatchObject({ id: "id-4026212439502", metaTitle: GOOD.metaTitle, metaDescription: GOOD.metaDescription });
    expect(updates[0].customFields[PRODUCT_META_TEXTS_MARKER]).toMatchObject({ ...GOOD, sourceHash: productSourceHash(products[0]) });
  });

  it("Testlauf schreibt nichts, Grenze je Lauf greift, Fehlschlag bleibt unveraendert", async () => {
    const c = client();
    const generate = vi.fn<MetaGenerator>().mockResolvedValue(new Map([["4026212439502", { ...GOOD, metaTitle: "x" }]]));
    const summary = await runProductMetaTexts(c, generate, { dryRun: true, trigger: "manual", maxProducts: 1 });
    expect(c.syncProductMetaTexts).not.toHaveBeenCalled();
    expect(summary.processed).toBe(1);
    expect(summary.remaining).toBe(1);
    expect(summary.written).toBe(0);
    expect(summary.rejected).toBe(1);
    expect(summary.rejectedExamples[0].reason).toBe("title_length_1");
  });

  it("Service-Artikel (wdu_service_type) sind von den automatischen Meta-Texten ausgenommen", () => {
    const svc = product({ productNumber: "stapler", name: "Mitnahmestapler", customFields: { wdu_service_type: "forklift" } } as any);
    expect(isServiceArticle(svc)).toBe(true);
    expect(isServiceArticle(product({ productNumber: "1" }))).toBe(false);
    expect(selectMetaCandidates([{ ...svc, metaTitle: null, metaDescription: null } as any]).candidates).toHaveLength(0);
  });
});
