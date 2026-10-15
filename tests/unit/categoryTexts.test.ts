import { describe, expect, it } from "vitest";
import { buildCategoryFacts, buildCategoryHtml, factsTableHtml, generateCategoryText, validateCategoryText, type GeneratedCategoryText } from "../../server/products/categoryTexts";

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
    expect(facts).toMatchObject({ heights: [2000, 2500], widths: [1000, 1300], depths: [500, 800], levels: ["4+1", "5+1"] });
    // Katalog S. 14: RAL-RG 614/5 fuer MULTISTRONG LIGHT/MEDIUM – aber nicht „Made in Germany“
    expect(facts.familyClaims).toContain("RAL-RG 614/5");
    expect(facts.familyClaims).not.toMatch(/Made in Germany/);
    expect(facts.loads).toEqual([{ label: "Armlast", values: [175, 250] }]);
    // Katalog: MULTISTRONG-Kragarme sind eingesteckt – die Shop-Eigenschaft "Schraubregal" gilt nicht als Fakt
    expect(facts.features.find((f) => f.label === "Aufbauart")).toBeUndefined();
    expect(buildCategoryFacts({ id: "w", name: "MINI-RACK Grundregale", url: "", breadcrumb: "" }, [{ name: "x", properties: [{ group: "Aufbauart", option: "Schraubregal" }] }]).features.find((f) => f.label === "Aufbauart")?.values).toEqual(["Schraubregal"]);
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
    expect(validateCategoryText(facts, { ...good, faq: [...good.faq.slice(0, 3), { q: "Wie hoch?", a: "Bis 3700 mm." }] })).toContain("3700");
    expect(validateCategoryText(facts, { ...good, intro: `${good.intro} Made in Germany.` })).toContain("nicht belegt");
  });

  it("HTML mit Tabelle als zweitem Abschnitt und FAQ als JSON", () => {
    const html = buildCategoryHtml(facts, good);
    expect(html.introHtml.startsWith("<p>Hier finden Sie")).toBe(true);
    expect(html.seoHtml.indexOf("Maße und Ausführungen im Überblick")).toBeGreaterThan(html.seoHtml.indexOf("Wofür eignen"));
    expect(JSON.parse(html.faqJson)).toHaveLength(4);
  });

  it("Plausibilitaet: Zeilenlaenge ist keine Breite, Wettbewerber und Leerformeln werden abgelehnt", () => {
    const rows = buildCategoryFacts({ id: "a", name: "ATLAS ST Komplettregale", url: "", breadcrumb: "" }, [
      { name: "META ATLAS ST | Kragarmregal | 4 Felder | 2000 x 5400 x 500 mm | Armlast 200 kg | einseitig | 5+1 Ebenen", properties: [] },
      { name: "META ATLAS ST | Kragarmregal | 1 Felder | 2000 x 1330 x 500 mm | Armlast 200 kg | einseitig | 5+1 Ebenen", properties: [] },
    ]);
    expect(rows.widths).toEqual([1330]);
    expect(rows.heights).toEqual([2000]);
    expect(validateCategoryText(facts, { ...good, intro: `${good.intro} Ähnlich wie bei SSI Schäfer.` })).toContain("Wettbewerber");
    expect(validateCategoryText(facts, { ...good, intro: `${good.intro} Vergleichbar mit Kaiser+Kraft.` })).toContain("Wettbewerber");
  });

  it("Zweiter Leser: Zweifel fuehren zum Neuversuch, bleiben sie, wird der Text als Pruefhinweis markiert", async () => {
    const feedbacks: Array<string | undefined> = [];
    const generate = async (_f: unknown, feedback?: string) => {
      feedbacks.push(feedback);
      return good;
    };
    // beanstandeter Satz wird gestrichen, Rest reicht: kein Neuversuch noetig
    const withClaim = { ...good, sections: [...good.sections.slice(0, 2), { heading: "Wie wird erweitert?", paragraphs: ["Ein Anbauregal nutzt den Ständer des Grundregals mit. Die Anlage ist beliebig erweiterbar."] }] };
    const issue = [{ quote: "Die Anlage ist beliebig erweiterbar", reason: "nicht belegt" }];
    const repaired = await generateCategoryText(facts, async () => withClaim, async (_f, t) => (JSON.stringify(t).includes("beliebig") ? issue : []));
    expect(repaired.problem).toBe("");
    expect(JSON.stringify(repaired.text)).not.toContain("beliebig");
    expect(repaired.text!.sections[2].paragraphs[0]).toBe("Ein Anbauregal nutzt den Ständer des Grundregals mit.");
    // Streichen reicht nicht (Einleitung zu kurz): Neuversuch mit Hinweis, am Ende Pruefhinweis
    const introIssue = [{ quote: good.intro.split(". ")[0], reason: "unbelegt" }];
    const stays = await generateCategoryText(facts, generate, async () => introIssue);
    expect(feedbacks[1]).toContain("unbelegt");
    expect(stays.text).not.toBeNull();
    expect(stays.problem).toMatch(/^Plausibilität: /);
  });

  it("Merkmale je System, wenn sie sich unterscheiden", () => {
    const five = <T,>(x: T) => [x, x, x, x, x];
    const f = buildCategoryFacts({ id: "w", name: "Weitspannregale", url: "", breadcrumb: "" }, [
      ...five({ name: "META MINI-RACK | Weitspannregal | Grundregal | 2200 x 2200 x 800 mm | Fachlast 600 kg | 3 Ebenen", properties: [{ group: "Aufbauart", option: "Schraubregal" }, { group: "Nutzung", option: "beidseitig" }] }),
      ...five({ name: "META SPEED-RACK | Weitspannregal | 1970 x 1700 x 600 mm | Fachlast 500 kg | 4 Ebenen", properties: [{ group: "Aufbauart", option: "Steckregal" }, { group: "Nutzung", option: "beidseitig" }] }),
    ]);
    expect(f.systemFeatures).toEqual([
      { system: "META MINI-RACK", values: ["Regalart: Grundregal", "Höhen (mm): 2200", "Breiten (mm): 2200", "Tiefen (mm): 800", "Fachlast (kg): 600", "Aufbauart: Schraubregal"] },
      { system: "META SPEED-RACK", values: ["Regalart: Komplettregal", "Höhen (mm): 1970", "Breiten (mm): 1700", "Tiefen (mm): 600", "Fachlast (kg): 500", "Aufbauart: Steckregal"] },
    ]);
    // ein System: nichts je System
    expect(buildCategoryFacts({ id: "c", name: "x", url: "", breadcrumb: "" }, products.slice(0, 1)).systemFeatures).toEqual([]);
    // M und L unterscheiden sich in Massen und Last – aber erst ab 5 Artikeln je System
    expect(buildCategoryFacts({ id: "c", name: "x", url: "", breadcrumb: "" }, products).systemFeatures).toEqual([]);
    const many = [...products, ...products, ...products, ...products, ...products];
    expect(buildCategoryFacts({ id: "c", name: "x", url: "", breadcrumb: "" }, many).systemFeatures[0].values).toContain("Armlast (kg): 250");
  });
});
