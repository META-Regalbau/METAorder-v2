import { describe, expect, it } from "vitest";
import { buildCategoryFacts, buildCategoryHtml, factsTableHtml, validateCategoryText, type GeneratedCategoryText } from "../../server/products/categoryTexts";

const products = [
  { name: "META MULTISTRONG M | Kragarmregal | Grundregal | 2000 x 1000 x 800 mm | Armlast 250 kg | einseitig | 4+1 Ebenen", properties: [{ group: "Aufbauart", option: "Schraubregal" }, { group: "Verstellraster (Höhe)", option: "100 mm" }] },
  { name: "META MULTISTRONG L | Kragarmregal | Grundregal | 2500 x 1300 x 500 mm | Armlast 175 kg | einseitig | 5+1 Ebenen", properties: [{ group: "Aufbauart", option: "Schraubregal" }] },
];
const facts = buildCategoryFacts({ id: "c1", name: "MULTISTRONG Grundregale", url: "/multistrong-grundregale", breadcrumb: "Kragarmregale › MULTISTRONG Grundregale" }, products);

const good: GeneratedCategoryText = {
  h1: "MULTISTRONG Grundregale – Kragarmregale von META",
  intro:
    "Hier finden Sie Grundregale der Systeme MULTISTRONG M und L für lange Güter wie Rohre und Profile. Verfügbar in Höhen von 2000 und 2500 mm mit Armlasten von 175 bis 250 kg. Wählen Sie nach Höhe, Tiefe und Armlast.",
  sections: [
    { heading: "Wofür eignen sich Kragarmregale?", paragraphs: ["Für Langgut wie Rohre, Stangen und Profile."] },
    { heading: "Welche Maße gibt es?", paragraphs: ["Höhen von 2000 und 2500 mm, Tiefen von 500 bis 800 mm."] },
    { heading: "Wie wird erweitert?", paragraphs: ["Ein Anbauregal nutzt den Ständer des Grundregals mit."] },
  ],
  faq: [
    { q: "Kann ich ein Grundregal allein aufbauen?", a: "Ja, ein Grundregal steht für sich." },
    { q: "Wie hoch ist die Armlast?", a: "Je nach Ausführung 175 bis 250 kg pro Arm." },
    { q: "Wie wird das Regal montiert?", a: "Als Schraubregal vor Ort im Raster von 100 mm." },
    { q: "Gibt es verschiedene Höhen?", a: "Ja, 2000 und 2500 mm." },
  ],
};

describe("Kategorietexte", () => {
  it("Fakten aus Namen und Eigenschaften", () => {
    expect(facts).toMatchObject({ heights: [2000, 2500], widths: [1000, 1300], depths: [500, 800], levels: ["4+1", "5+1"], familyClaims: null });
    expect(facts.loads).toEqual([{ label: "Armlast", values: [175, 250] }]);
    expect(facts.features.find((f) => f.label === "Aufbauart")?.values).toEqual(["Schraubregal"]);
  });

  it("Herstellerangaben nur bei Familien-Kategorie mit überwiegend Familienartikeln", () => {
    const mixed = [
      { name: "META MULTIPAL/MINI-RACK | Zusatzboden | 1000 x 500 mm | verzinkt", properties: [] },
      { name: "META MINI-RACK | Zusatzboden Stahlpaneele | 1400 x 1050 mm | verzinkt", properties: [] },
      { name: "META SPEED-RACK | Zusatzboden | 2000 x 600 mm | verzinkt", properties: [] },
    ];
    expect(buildCategoryFacts({ id: "x", name: "Weitspannregal Zubehör", url: "", breadcrumb: "" }, mixed).familyClaims).toBeNull();
    const clip = [{ name: "META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 400 mm | Fachlast 230 kg | 5 Ebenen | verzinkt", properties: [] }];
    expect(buildCategoryFacts({ id: "y", name: "CLIP Grundregale", url: "", breadcrumb: "" }, clip).familyClaims).toContain("Made in Germany");
    expect(buildCategoryFacts({ id: "z", name: "Zubehör", url: "", breadcrumb: "" }, clip).familyClaims).toBeNull();
    const junk = [{ name: "Etikettenschiene | 1000 mm | grau", properties: [] }, ...clip];
    expect(buildCategoryFacts({ id: "y", name: "CLIP Zubehör", url: "", breadcrumb: "" }, junk).systems).toEqual(["META CLIP"]);
  });

  it("Maßtabelle aus den Fakten", () => {
    const table = factsTableHtml(facts);
    expect(table).toContain("<th>Höhen</th><td>2.000, 2.500 mm</td>");
    expect(table).toContain("<th>Armlast</th><td>175, 250 kg</td>");
  });

  it("akzeptiert belegte Texte, verwirft erfundene Zahlen und unbelegte Herstellerangaben", () => {
    expect(validateCategoryText(facts, good)).toBeNull();
    expect(validateCategoryText(facts, { ...good, faq: [...good.faq.slice(0, 3), { q: "Wie hoch?", a: "Bis 3000 mm." }] })).toContain("3000");
    expect(validateCategoryText(facts, { ...good, intro: `${good.intro} Made in Germany.` })).toContain("nicht belegt");
  });

  it("HTML mit Tabelle als zweitem Abschnitt und FAQ als JSON", () => {
    const html = buildCategoryHtml(facts, good);
    expect(html.introHtml.startsWith("<p>Hier finden Sie")).toBe(true);
    expect(html.seoHtml.indexOf("Maße und Ausführungen im Überblick")).toBeGreaterThan(html.seoHtml.indexOf("Wofür eignen"));
    expect(JSON.parse(html.faqJson)).toHaveLength(4);
  });
});
