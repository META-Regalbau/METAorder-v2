import { describe, expect, it } from "vitest";
import {
  SHOP_CONTENT_SCHEMAS,
  compressIndustryPage,
  resolveIndustryPage,
  type IndustryPage,
  type StoredIndustryPage,
} from "../../shared/shopContent";
import { checkCommon, checkHomeMondu, checkHomeRabatt, checkIndustryPage, checkNewNumbers, checkShopContent } from "../../shared/shopContentRules";
import { INDUSTRY_COMMON, INDUSTRY_PAGES } from "../../server/products/industryPages";
import { MONDU, RABATT } from "../../server/products/homeSections";
import { shopContentSeed } from "../../server/shopContent/shopContentSeed";

const kfz = INDUSTRY_PAGES.find((p) => p.key === "kfz")!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const rules = (issues: Array<{ rule: string }>) => issues.map((i) => i.rule);

describe("Shop-Inhalte: Schema und gemeinsame Texte", () => {
  it("die Ausgangsdaten passen zum Schema", () => {
    for (const entry of shopContentSeed()) {
      const parsed = SHOP_CONTENT_SCHEMAS[entry.kind].safeParse(entry.data);
      expect(parsed.success, `${entry.kind}:${entry.key} ${parsed.success ? "" : JSON.stringify(parsed.error.issues[0])}`).toBe(true);
    }
  });

  it("speichert unveränderte gemeinsame Texte als Verweis und löst sie unverändert auf", () => {
    for (const page of INDUSTRY_PAGES) {
      const stored = compressIndustryPage(page, INDUSTRY_COMMON);
      expect(resolveIndustryPage(stored, INDUSTRY_COMMON), page.key).toEqual(page);
      // jede Seite nutzt die gemeinsamen Pflichten, den Hinweis und die Regalinspektion
      expect(stored.duties.operator, page.key).toContainEqual({ common: "operator" });
      expect(stored.duties.hint, page.key).toEqual({ common: "dutyHint" });
      expect(stored.faq.at(-1), page.key).toEqual({ common: "faq" });
    }
  });

  it("eigene Fassung einer Seite bleibt eigener Text (Kfz: erster Vorteil ersetzt)", () => {
    const stored = compressIndustryPage(kfz, INDUSTRY_COMMON);
    expect(stored.why).not.toContainEqual({ common: "why" });
    expect(stored.why[0]).toEqual({ title: "Made in Germany", text: "CLIP-Regale aus eigener Produktion in Deutschland" });
    const handwerk = compressIndustryPage(INDUSTRY_PAGES.find((p) => p.key === "handwerk")!, INDUSTRY_COMMON);
    expect(handwerk.why).toEqual([{ common: "why" }]);
  });

  it("eine Änderung der gemeinsamen Texte wirkt auf alle Seiten, die sie übernehmen", () => {
    const common = clone(INDUSTRY_COMMON);
    common.operator = [...common.operator, "Neuer gemeinsamer Punkt"];
    for (const page of INDUSTRY_PAGES) {
      const resolved = resolveIndustryPage(compressIndustryPage(page, INDUSTRY_COMMON), common);
      expect(resolved.duties.operator, page.key).toContain("Neuer gemeinsamer Punkt");
    }
  });

  it("die Ausgangsdaten bestehen alle Prüfregeln", () => {
    const seed = shopContentSeed();
    const common = seed.find((s) => s.kind === "common")!.data as typeof INDUSTRY_COMMON;
    const pages = seed.filter((s) => s.kind === "industry_page").map((s) => resolveIndustryPage(s.data as StoredIndustryPage, common));
    for (const entry of seed) expect(checkShopContent(entry.kind, entry.data, { common, pages }), `${entry.kind}:${entry.key}`).toEqual([]);
  });

  it("ohne gemeinsame Texte keine Prüfung der Branchenseite", () => {
    expect(rules(checkShopContent("industry_page", compressIndustryPage(kfz, INDUSTRY_COMMON), {}))).toEqual(["commonMissing"]);
  });
});

describe("Shop-Inhalte: Prüfregeln Branchenseite", () => {
  const check = (change: (p: IndustryPage) => void) => {
    const p = clone(kfz);
    change(p);
    return checkIndustryPage(p);
  };

  it("Wettbewerber und zurückgezogene DGUV-Regel", () => {
    const issues = check((p) => {
      p.lead += " Wie bei Mecalux.";
      p.faq[0].a += " Siehe DGUV Regel 108-007.";
    });
    expect(issues).toContainEqual(expect.objectContaining({ level: "error", rule: "competitor", path: "lead", params: { name: "Mecalux" } }));
    expect(issues).toContainEqual(expect.objectContaining({ level: "error", rule: "dguvWithdrawn", path: "faq.0.a" }));
  });

  it("Belege (notes) werden nicht auf Wettbewerber geprüft – sie gehen nie in den Shop", () => {
    expect(check((p) => (p.notes.hero = { text: "Wettbewerber Mecalux zeigt …" }))).toEqual([]);
  });

  it("Preis als Text, Platzhalter erlaubt", () => {
    expect(rules(check((p) => (p.planning.intro = "Schon ab 199 € je Feld")))).toEqual(["priceAsText"]);
    expect(check((p) => (p.planning.intro = "Schon ab {p:4026212270242} je Feld"))).toEqual([]);
  });

  it("Längen für Suchergebnisse", () => {
    const issues = check((p) => {
      p.metaTitle = "x".repeat(61);
      p.metaDescription = "y".repeat(161);
    });
    expect(issues).toContainEqual(expect.objectContaining({ rule: "metaTitleLength", params: { max: 60, length: 61 } }));
    expect(issues).toContainEqual(expect.objectContaining({ rule: "metaDescriptionLength", params: { max: 160, length: 161 } }));
  });

  it("Adresse unter /branchen/ und eindeutig", () => {
    expect(rules(check((p) => (p.url = "/reifen")))).toEqual(["urlFormat"]);
    const copy = { ...clone(INDUSTRY_PAGES[1]), url: kfz.url };
    expect(rules(checkIndustryPage(kfz, { pages: [kfz, copy] }))).toEqual(["urlDuplicate"]);
  });

  it("Kennzahl unter dem Bild nur zum abgebildeten System (#158)", () => {
    const issues = check((p) => {
      p.facts[3] = { value: "bis 5.500 kg", label: "Feldlast MULTIPAL" };
      p.teaser.fact = "Kragarmregale bis 1.000 kg";
    });
    expect(issues).toContainEqual(expect.objectContaining({ rule: "factSystemNotShown", path: "facts.3", params: expect.objectContaining({ system: "MULTIPAL" }) }));
    expect(issues).toContainEqual(expect.objectContaining({ rule: "factSystemNotShown", path: "teaser.fact", params: expect.objectContaining({ system: "Kragarm" }) }));
  });

  it("Beispielrechnung, Tabellenform, HTML und Links", () => {
    expect(rules(check((p) => (p.planning.example = undefined)))).toEqual(["exampleEmpty"]);
    expect(rules(check((p) => p.planning.tables[0].rows[0].pop()))).toEqual(["tableShape"]);
    expect(rules(check((p) => (p.planning.tables[0].rows[0][0] = '<b>1.000 mm</b><img src=x onerror="alert(1)">')))).toEqual(["htmlNotAllowed"]);
    expect(rules(check((p) => (p.planning.example!.warn = "<b>Pflicht:</b> sichern<br>")))).toEqual([]);
    expect(rules(check((p) => (p.planning.example!.warn = '<a href="x">Pflicht</a>')))).toEqual(["htmlNotAllowed", "htmlNotAllowed"]);
    expect(rules(check((p) => (p.areas[0].linkTarget = "javascript:alert(1)")))).toEqual(["linkTarget"]);
    expect(rules(check((p) => (p.project.link = { label: "Referenz", href: "http://example.org" })))).toEqual(["linkHttps"]);
  });

  it("Raster der Seite als Warnung", () => {
    const issues = check((p) => {
      p.areas.pop();
      p.products.pop();
    });
    expect(issues.map((i) => [i.level, i.rule])).toEqual([
      ["warning", "areaCount"],
      ["warning", "productCount"],
    ]);
  });
});

describe("Shop-Inhalte: neue Zahl ohne Beleg", () => {
  it("warnt, wenn eine neue Zahl ohne geänderten Beleg dazukommt", () => {
    const next = clone(kfz);
    next.areas[1].solution = "CLIP Regalwagen für Reifen · 1.850 × 1.300 × 600 mm";
    expect(checkNewNumbers(kfz, next)).toEqual([{ level: "warning", rule: "newNumberWithoutSource", path: "notes.areas", params: { numbers: "600" } }]);
  });

  it("keine Warnung mit geändertem Beleg oder ohne neue Zahl", () => {
    const withSource = clone(kfz);
    withSource.areas[1].solution = "CLIP Regalwagen für Reifen · 1.850 × 1.300 × 600 mm";
    withSource.notes.areas = { ...withSource.notes.areas!, src: `${withSource.notes.areas!.src}; Katalog S. 63` };
    expect(checkNewNumbers(kfz, withSource)).toEqual([]);
    const reworded = clone(kfz);
    reworded.areas[1].text = "Den Radsatz fahren statt tragen.";
    expect(checkNewNumbers(kfz, reworded)).toEqual([]);
  });

  it("Artikelnummern und Preis-Platzhalter zählen nicht als Zahl", () => {
    const next = clone(kfz);
    next.planning.example!.lines[0].number = "4026212328479";
    next.planning.tables[1].rows[0][1] = "{p:4026212266611} / {p:4026212275636}";
    expect(checkNewNumbers(kfz, next)).toEqual([]);
  });
});

describe("Shop-Inhalte: Prüfregeln Startseite und gemeinsame Texte", () => {
  it("Rabattstaffel: Bedingung Deutschland, gestrichene Versprechen, Euro-Beträge erlaubt", () => {
    expect(checkHomeRabatt(RABATT)).toEqual([]);
    const r = { ...clone(RABATT), note: "Gilt für alle Bestellungen. Keine Bedingungen!" };
    expect(rules(checkHomeRabatt(r))).toEqual(["bannedPromise", "rabattCondition"]);
  });

  it("Mondu: nur im DE-Kanal aktive Zahlarten", () => {
    const m = clone(MONDU);
    m.methods.push({ name: "Kauf auf Raten in 24 Monaten", fact: "Neu" });
    expect(rules(checkHomeMondu(m))).toEqual(["bannedPromise", "monduMethod"]);
  });

  it("gemeinsame Texte: Telefon für tel:-Link und E-Mail-Adresse", () => {
    expect(checkCommon(INDUSTRY_COMMON)).toEqual([]);
    const c = clone(INDUSTRY_COMMON);
    c.contact.tel = "02932 957-0";
    c.contact.mail = "digital-service";
    expect(rules(checkCommon(c))).toEqual(["contactTel", "contactMail"]);
  });
});
