import { describe, expect, it, vi } from "vitest";
import {
  buildDescriptionHtml,
  CLOSING_SENTENCES,
  generateDescriptions,
  productFamily,
  reasonHint,
  validateGeneratedDescription,
  type DescriptionGenerator,
  type GeneratedDescription,
} from "../../server/products/productDescriptionTexts";
import type { ProductMetaSource } from "../../server/shopware/client/productMeta";

function product(partial: Partial<ProductMetaSource> & { productNumber: string }): ProductMetaSource {
  return {
    id: `id-${partial.productNumber}`,
    active: true,
    visible: true,
    name: "META CLIP S3 | Schrägbodenregal | Anbauregal | 2000 x 1300 x 1228 mm | Fachlast 80 kg | 4 Ebenen | verzinkt",
    description: "<p>Schrägbodenregal mit 18° geneigten Fachebenen für FIFO, 12 Fachböden, 25 mm Raster.</p>",
    properties: [
      { group: "Regal-System", option: "CLIP S3" },
      { group: "max. Fachlast", option: "200 kg" },
    ],
    metaTitle: null,
    metaDescription: null,
    customFields: { custom_product_main_category_ptype: "Regal", wdu_ifs_productnumber: "9900001" },
    ...partial,
  };
}

const GOOD: GeneratedDescription = {
  intro:
    "Das META CLIP S3 Schrägbodenregal ist ein verzinktes Anbauregal mit 18° geneigten Fachböden für die FIFO-Lagerung. Die Ware gleitet selbstständig zur Entnahmekante.",
  bullets: [
    "Maße (H x B x T): 2000 x 1300 x 1228 mm",
    "Fachlast: 80 kg je Boden",
    "Ebenen: 4 (insgesamt 12 Fachböden)",
    "Verstellraster: 25 mm",
    "Oberfläche: verzinkt",
  ],
  suitableFor: "Geeignet für Kartons und Kunststoffbehälter in Lager und Kommissionierung.",
};

describe("productFamily", () => {
  it("Familiensatz nur fuer komplette Regale, Fremdware ohne", () => {
    expect(productFamily(product({ productNumber: "4026212238204" }))).toBe("clip");
    expect(productFamily(product({ productNumber: "4026212000054", customFields: { custom_product_main_category_ptype: "Ständer/Rahmen" } }))).toBe("other");
    expect(productFamily(product({ productNumber: "4006209948774" }))).toBe("third_party");
    expect(
      productFamily(product({ productNumber: "4026212348187", name: "META MULTIPAL | Palettenregal", properties: [{ group: "Regal-System", option: "MULTIPAL" }] })),
    ).toBe("multipal");
  });
});

describe("validateGeneratedDescription", () => {
  const p = product({ productNumber: "4026212238204" });
  it("akzeptiert passende Texte", () => {
    expect(validateGeneratedDescription(p, GOOD)).toBeNull();
  });
  it("Fachlast aus dem Namen hat Vorrang", () => {
    expect(validateGeneratedDescription(p, { ...GOOD, bullets: GOOD.bullets.map((b) => b.replace("80 kg", "200 kg")) })).toBe("name_kg_200");
  });
  it("Feldlast aus den Eigenschaften ist erlaubt, Fachlast nur wie im Namen", () => {
    const shelf = product({ productNumber: "4026212011036", properties: [{ group: "max. Feldlast", option: "1650 kg" }] });
    const bullets = [...GOOD.bullets.slice(0, 4), "Feldlast: max. 1.650 kg"];
    expect(validateGeneratedDescription(shelf, { ...GOOD, bullets })).toBeNull();
    expect(validateGeneratedDescription(shelf, { ...GOOD, bullets: [...bullets.slice(0, 4), "Traglast 1650 kg je Feld"] })).toBe("name_kg_1650");
  });

  it("Hinweise fuer den Neuversuch sind verstaendlich", () => {
    expect(reasonHint("claim_certificate")).toContain("keine Zertifikate");
    expect(reasonHint("number_20")).toBe("die Zahl 20 steht nicht im Artikel – weglassen");
  });

  it("keine Firmenangaben im KI-Teil", () => {
    expect(validateGeneratedDescription(p, { ...GOOD, suitableFor: "Geeignet für Lager – Made in Germany." })).toBe("company_claim");
  });
  it("Zahlen muessen im Artikel stehen", () => {
    expect(validateGeneratedDescription(p, { ...GOOD, bullets: [...GOOD.bullets.slice(0, 4), "Neigung: 20°"] })).toBe("number_20");
  });
  it("Stichpunkte und Laengen", () => {
    expect(validateGeneratedDescription(p, { ...GOOD, bullets: GOOD.bullets.slice(0, 2) })).toBe("bullets_count_2");
    expect(validateGeneratedDescription(p, { ...GOOD, intro: "Kurz." })).toBe("intro_length_5");
  });
  it("Fremdware nicht als META-Produkt", () => {
    const anchor = product({ productNumber: "4006209948774", name: "Bolzenanker FAZ II 8/30 vzk", description: "", properties: [{ group: "Höhe", option: "95 mm" }] });
    const gen: GeneratedDescription = {
      intro: "Der META Bolzenanker FAZ II 8/30 ist ein verzinktes Befestigungselement zur Verankerung von Regalen im Untergrund und sorgt für Standsicherheit.",
      bullets: ["Typ: FAZ II 8/30", "Höhe: 95 mm", "Oberfläche: verzinkt"],
      suitableFor: "Geeignet für die Bodenverankerung von Regalen in Lager und Werkstatt.",
    };
    expect(validateGeneratedDescription(anchor, gen)).toBe("third_party_as_meta");
    expect(validateGeneratedDescription(anchor, { ...gen, intro: gen.intro.replace("Der META Bolzenanker", "Der Bolzenanker") })).toBeNull();
  });
});

describe("HTML und Lauf", () => {
  it("baut HTML mit festem Schlusssatz und maskiert Sonderzeichen", () => {
    const html = buildDescriptionHtml({ ...GOOD, suitableFor: "Geeignet für Lager & <Werkstatt>." }, "clip");
    expect(html.startsWith("<p>Das META CLIP S3")).toBe(true);
    expect(html).toContain("<ul><li>Maße (H x B x T): 2000 x 1300 x 1228 mm</li>");
    expect(html).toContain("Lager &amp; &lt;Werkstatt&gt;.");
    expect(html.endsWith(`<p>${CLOSING_SENTENCES.clip.replace(/"/g, "&quot;")}</p>`)).toBe(true);
    expect(buildDescriptionHtml(GOOD, "third_party")).not.toContain("META ist zertifiziert");
  });

  it("verworfene Texte werden einmal neu angefragt, sonst Pruefhinweis", async () => {
    const p1 = product({ productNumber: "4026212238204" });
    const p2 = product({ productNumber: "4026212238205" });
    const generate = vi.fn<DescriptionGenerator>()
      .mockResolvedValueOnce(new Map([["4026212238204", GOOD], ["4026212238205", { ...GOOD, intro: "x" }]]))
      .mockResolvedValueOnce(new Map([["4026212238205", { ...GOOD, intro: "y" }]]));
    const onRows = vi.fn();
    const rows = await generateDescriptions([p1, p2], generate, { onRows });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({ productNumber: "4026212238204", family: "clip", ifsNumber: "9900001", problem: "" });
    expect(rows[0].textLength).toBeGreaterThan(300);
    expect(rows[1]).toMatchObject({ html: "", problem: "intro_length_1" });
    expect(onRows).toHaveBeenCalledTimes(1);
  });
});
