/**
 * Pruefregeln der Shop-Inhalte (Konzept 16.10.2026, Abschnitt 2). Eine Quelle fuer Formular (beim Tippen),
 * Server (Speichern/Veroeffentlichen) und Unit-Tests (tests/unit/industryPages.test.ts, homeSections.test.ts).
 * „error“ sperrt das Veroeffentlichen, „warning“ muss bestaetigt werden.
 * Grundregel des Users (15.10.2026): nur belegte META-Inhalte, nichts Erfundenes, keine Wettbewerber.
 */
import { COMPETITOR_NAMES } from "./competitorNames";
import {
  INDUSTRY_NOTE_KEYS,
  isSafeHref,
  resolveIndustryPage,
  type HomeMondu,
  type HomeRabatt,
  type IndustryCommon,
  type IndustryNoteKey,
  type IndustryPage,
  type ShopContentIssue,
  type ShopContentKind,
  type StoredIndustryPage,
} from "./shopContent";

export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 160;
/** Raster der Branchenseite: 3 × 2 Lagerbereiche, Slider mit 8 Produkten */
export const INDUSTRY_AREA_COUNT = 6;
export const INDUSTRY_PRODUCT_COUNT = 8;

/** Systemnamen bzw. Regalarten, die in einer Kennzahl nur stehen duerfen, wenn das Bild dieses System zeigt (#158) */
export const FACT_SYSTEMS = ["CLIP", "COMPACT", "MULTIPAL", "MULTISTRONG", "MINI-RACK", "SPEED-RACK", "Packtisch", "Schrägbod", "Kragarm", "Weitspann", "Kabeltrommel", "Reifen", "Palett"];

/** Aus den alten Startseiten-Fassungen gestrichene, unbelegte Versprechen (#159) */
export const HOME_BANNED_PROMISES: Array<[RegExp, string]> = [
  [/keine Bedingungen/i, "keine Bedingungen"],
  [/100\s*%/i, "100 %"],
  [/versteckt/i, "versteckt"],
  [/Liquidität/i, "Liquidität"],
  [/\bNeu\b/i, "Neu"],
  [/Alle registrierten/i, "Alle registrierten"],
];

/** Mondu-Zahlarten, die im Kanal META Regalbau DE aktiv sind (Stand Shop 16.10.2026) */
export const MONDU_METHODS_DE = ["Rechnungskauf", "SEPA-Lastschrift", "Ratenkauf", "Echtzeitüberweisung"];

/** Bedingung der Rabattstaffel: Aktion „ab 5000 Euro“ nur mit Rechnungsadresse Deutschland */
export const RABATT_CONDITION = "Rechnungsadresse in Deutschland";

const COMPETITOR = new RegExp(`\\b(${COMPETITOR_NAMES.join("|")})\\b`, "i");
const PRICE_REF = /\{p:[0-9A-Z-]+\}/g;
const PRICE_TEXT = /\d\s*€/;
/** Felder, die der Renderer als HTML ausgibt: nur fett und Zeilenumbruch */
const ALLOWED_TAG = /^<\/?b>$|^<br\s*\/?>$/i;

type Ctx = {
  /** Gemeinsame Texte (fuer Branchenseiten Pflicht) */
  common?: IndustryCommon | null;
  /** Alle Branchenseiten des Mandanten (aufgeloest), fuer eindeutige Schluessel und Adressen */
  pages?: IndustryPage[];
};

type Walk = Array<[path: string, value: string]>;

/** Alle Texte eines Objekts mit Pfad, ohne die Belege (`notes`) – die gehen nie in den Shop */
function strings(value: unknown, path = "", out: Walk = []): Walk {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, path ? `${path}.${i}` : String(i), out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (!(path === "" && k === "notes")) strings(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

function textRules(walk: Walk, issues: ShopContentIssue[], opts: { prices: boolean }) {
  for (const [path, value] of walk) {
    const competitor = value.match(COMPETITOR);
    if (competitor) issues.push({ level: "error", rule: "competitor", path, params: { name: competitor[0] } });
    if (/108-007/.test(value)) issues.push({ level: "error", rule: "dguvWithdrawn", path });
    if (opts.prices && PRICE_TEXT.test(value.replace(PRICE_REF, ""))) issues.push({ level: "error", rule: "priceAsText", path });
  }
}

function htmlRule(path: string, value: string | undefined, issues: ShopContentIssue[]) {
  for (const tag of value?.match(/<[^>]*>/g) ?? []) {
    if (!ALLOWED_TAG.test(tag)) issues.push({ level: "error", rule: "htmlNotAllowed", path, params: { tag } });
  }
}

/** Branchenseite (aufgeloest) pruefen */
export function checkIndustryPage(page: IndustryPage, ctx: Ctx = {}): ShopContentIssue[] {
  const issues: ShopContentIssue[] = [];
  textRules(strings(page), issues, { prices: true });

  if (page.metaTitle.length > META_TITLE_MAX) issues.push({ level: "error", rule: "metaTitleLength", path: "metaTitle", params: { max: META_TITLE_MAX, length: page.metaTitle.length } });
  if (page.metaDescription.length > META_DESCRIPTION_MAX)
    issues.push({ level: "error", rule: "metaDescriptionLength", path: "metaDescription", params: { max: META_DESCRIPTION_MAX, length: page.metaDescription.length } });
  if (!/^\/branchen\/[a-z0-9-]+$/.test(page.url)) issues.push({ level: "error", rule: "urlFormat", path: "url" });
  for (const other of ctx.pages ?? []) {
    if (other === page || other.key === page.key) continue;
    if (other.url === page.url) issues.push({ level: "error", rule: "urlDuplicate", path: "url", params: { other: other.name } });
  }
  if ((ctx.pages ?? []).filter((p) => p.key === page.key).length > 1) issues.push({ level: "error", rule: "keyDuplicate", path: "key" });

  // Kennzahlen unter dem Bild und die Startseiten-Kachel zeigen dasselbe Bild: nur das abgebildete System
  const shown = `${page.hero.tag} ${page.hero.alt}`.toLowerCase();
  const foreign = (s: string) => FACT_SYSTEMS.find((sys) => s.toLowerCase().includes(sys.toLowerCase()) && !shown.includes(sys.toLowerCase()));
  page.facts.forEach((f, i) => {
    const sys = foreign(`${f.value} ${f.label}`);
    if (sys) issues.push({ level: "error", rule: "factSystemNotShown", path: `facts.${i}`, params: { system: sys, shown: page.hero.tag } });
  });
  const teaserSys = foreign(page.teaser.fact);
  if (teaserSys) issues.push({ level: "error", rule: "factSystemNotShown", path: "teaser.fact", params: { system: teaserSys, shown: page.hero.tag } });

  if (!page.planning.example?.lines.length) issues.push({ level: "error", rule: "exampleEmpty", path: "planning.example" });
  page.planning.tables.forEach((t, ti) => {
    t.rows.forEach((r, ri) => {
      if (r.length !== t.head.length) issues.push({ level: "error", rule: "tableShape", path: `planning.tables.${ti}.rows.${ri}`, params: { cells: r.length, columns: t.head.length } });
      r.forEach((c, ci) => htmlRule(`planning.tables.${ti}.rows.${ri}.${ci}`, c, issues));
    });
    for (const col of [...(t.numCols ?? []), ...(t.hideMobile ?? [])])
      if (col >= t.head.length) issues.push({ level: "warning", rule: "tableColumnMissing", path: `planning.tables.${ti}`, params: { column: col + 1 } });
  });
  htmlRule("planning.example.warn", page.planning.example?.warn, issues);

  page.areas.forEach((a, i) => {
    // Suchbegriff oder Pfad/Sprungmarke; kein Schema (javascript:) und kein //fremder-host
    if (/^[a-z][a-z0-9+.-]*:/i.test(a.linkTarget) || (/^[/#]/.test(a.linkTarget) && !isSafeHref(a.linkTarget))) issues.push({ level: "error", rule: "linkTarget", path: `areas.${i}.linkTarget` });
  });
  if (page.project.link && !/^https:\/\//.test(page.project.link.href)) issues.push({ level: "error", rule: "linkHttps", path: "project.link.href" });

  if (page.areas.length !== INDUSTRY_AREA_COUNT) issues.push({ level: "warning", rule: "areaCount", path: "areas", params: { count: page.areas.length, expected: INDUSTRY_AREA_COUNT } });
  if (page.products.length !== INDUSTRY_PRODUCT_COUNT)
    issues.push({ level: "warning", rule: "productCount", path: "products", params: { count: page.products.length, expected: INDUSTRY_PRODUCT_COUNT } });
  return issues;
}

function homeRules(data: unknown, issues: ShopContentIssue[], opts: { prices: boolean }) {
  const walk = strings(data);
  textRules(walk, issues, opts);
  for (const [path, value] of walk) for (const [re, phrase] of HOME_BANNED_PROMISES) if (re.test(value)) issues.push({ level: "error", rule: "bannedPromise", path, params: { phrase } });
}

export function checkHomeRabatt(data: HomeRabatt): ShopContentIssue[] {
  const issues: ShopContentIssue[] = [];
  // Die Rabattstaffel nennt Warenwerte in Euro – Preis-Regel gilt hier nicht
  homeRules(data, issues, { prices: false });
  if (!data.note.includes(RABATT_CONDITION)) issues.push({ level: "error", rule: "rabattCondition", path: "note", params: { text: RABATT_CONDITION } });
  if (data.tiers.length === 0) issues.push({ level: "error", rule: "rabattTiersEmpty", path: "tiers" });
  return issues;
}

export function checkHomeMondu(data: HomeMondu): ShopContentIssue[] {
  const issues: ShopContentIssue[] = [];
  homeRules(data, issues, { prices: true });
  data.methods.forEach((m, i) => {
    if (!MONDU_METHODS_DE.includes(m.name)) issues.push({ level: "error", rule: "monduMethod", path: `methods.${i}.name`, params: { name: m.name, allowed: MONDU_METHODS_DE.join(", ") } });
  });
  return issues;
}

export function checkCommon(data: IndustryCommon): ShopContentIssue[] {
  const issues: ShopContentIssue[] = [];
  // Belege (noteDuties, noteWhy) gehen nie in den Shop
  const { noteDuties: _d, noteWhy: _w, ...shown } = data;
  textRules(strings(shown), issues, { prices: true });
  if (!/^\+\d{6,}$/.test(data.contact.tel)) issues.push({ level: "error", rule: "contactTel", path: "contact.tel" });
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(data.contact.mail)) issues.push({ level: "error", rule: "contactMail", path: "contact.mail" });
  return issues;
}

/** Ein Eintrag beliebiger Art (gespeicherte Form). */
export function checkShopContent(kind: ShopContentKind, data: unknown, ctx: Ctx = {}): ShopContentIssue[] {
  switch (kind) {
    case "industry_page": {
      if (!ctx.common) return [{ level: "error", rule: "commonMissing", path: "" }];
      return checkIndustryPage(resolveIndustryPage(data as StoredIndustryPage, ctx.common), ctx);
    }
    case "home_teaser": {
      const issues: ShopContentIssue[] = [];
      homeRules(data, issues, { prices: true });
      return issues;
    }
    case "home_rabatt":
      return checkHomeRabatt(data as HomeRabatt);
    case "home_mondu":
      return checkHomeMondu(data as HomeMondu);
    case "common":
      return checkCommon(data as IndustryCommon);
  }
}

// ───────────── neue Zahl ohne neuen Beleg ─────────────

/** Abschnitt (Beleg-Schluessel) → Felder der Seite */
const SECTION_FIELDS: Record<IndustryNoteKey, Array<keyof IndustryPage>> = {
  nav: ["metaTitle", "metaDescription"],
  hero: ["eyebrow", "h1", "lead", "proof", "ctaPrimary", "ctaSecondary", "hero"],
  facts: ["facts", "teaser"],
  areas: ["areasTitle", "areasIntro", "areas"],
  planning: ["planning"],
  products: ["productsTitle", "products"],
  duties: ["duties"],
  why: ["why"],
  project: ["project", "docs"],
  faq: ["faqTitle", "faq"],
  advice: ["advice"],
};

/** Zahlen in Texten; Artikelnummern (Feld `number`, Platzhalter {p:…}) und Mengen zaehlen nicht */
function numbersOf(page: IndustryPage, fields: Array<keyof IndustryPage>): Set<string> {
  const out = new Set<string>();
  for (const field of fields) {
    for (const [path, value] of strings(page[field], field)) {
      if (/\.number$/.test(path)) continue;
      for (const m of value.replace(PRICE_REF, "").matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0]);
    }
  }
  return out;
}

/**
 * Warnung, wenn ein Abschnitt eine Zahl enthaelt, die in der Vorversion nicht stand, der Beleg
 * (Quelle/Pruefpunkte) des Abschnitts aber gleich geblieben ist.
 */
export function checkNewNumbers(prev: IndustryPage, next: IndustryPage): ShopContentIssue[] {
  const issues: ShopContentIssue[] = [];
  for (const key of INDUSTRY_NOTE_KEYS) {
    const before = numbersOf(prev, SECTION_FIELDS[key]);
    const added = [...numbersOf(next, SECTION_FIELDS[key])].filter((n) => !before.has(n));
    if (added.length === 0) continue;
    if (JSON.stringify(prev.notes[key] ?? null) !== JSON.stringify(next.notes[key] ?? null)) continue;
    issues.push({ level: "warning", rule: "newNumberWithoutSource", path: `notes.${key}`, params: { numbers: added.join(", ") } });
  }
  return issues;
}

export const countIssues = (issues: ShopContentIssue[]) => ({
  errors: issues.filter((i) => i.level === "error").length,
  warnings: issues.filter((i) => i.level === "warning").length,
});
