/**
 * Shop-Inhalte, die METAorder pflegt (Konzept 16.10.2026): Branchen-Landingpages, Startseiten-Teaser
 * „Regale für Ihre Branche“, Startseiten-Abschnitte Rabattstaffel und B2B-Zahlung (Mondu) sowie gemeinsame
 * Texte der Branchenseiten. Gespeichert je Mandant mit Versionen (shop_content_items/_versions), Form wie
 * bisher in server/products/industryPages.ts und homeSections.ts.
 *
 * Gemeinsame Texte werden einmal gepflegt: In einer Branchenseite steht dann statt der Liste ein Verweis
 * `{ common: "<Schluessel>" }`. In Listen wird der Verweis an seiner Stelle durch alle Eintraege ersetzt,
 * bei Einzelwerten durch den Wert. Eine Seite kann den Verweis jederzeit durch eigene Eintraege ersetzen.
 */
import { z } from "zod";

export const SHOP_CONTENT_KINDS = ["industry_page", "home_teaser", "home_rabatt", "home_mondu", "common"] as const;
export type ShopContentKind = (typeof SHOP_CONTENT_KINDS)[number];

export const INDUSTRY_ICONS = [
  "tire", "cart", "grid", "drop", "cabinet", "pallet", "drum", "profiles", "pipes", "screws",
  "helmet", "folder", "archive", "lock", "box", "package", "store", "heavy", "warning", "move",
] as const;

export const INDUSTRY_NOTE_KEYS = ["nav", "hero", "facts", "areas", "planning", "products", "duties", "why", "project", "faq", "advice"] as const;

const text = z.string();

export const industryNoteSchema = z.object({ text, src: text.optional(), checks: z.array(text).optional() });
const whySchema = z.object({ title: text, text });
const docSchema = z.object({ label: text, where: text });
const faqSchema = z.object({ q: text, a: text });
export const contactSchema = z.object({ phone: text, tel: text, hours: text, mail: text });

export const industryAreaSchema = z.object({
  icon: z.enum(INDUSTRY_ICONS),
  title: text,
  text,
  solution: text,
  linkLabel: text,
  /** Ziel im Shop: Suchbegriff oder Pfad. Wird beim Bau auf gefilterte Listen gemappt. */
  linkTarget: text,
});

export const industryTableSchema = z.object({
  head: z.array(text),
  rows: z.array(z.array(text)),
  /** Spalten (0-basiert), die rechtsbuendig/zahlig sind */
  numCols: z.array(z.number().int().min(0)).optional(),
  /** Spalten, die am Handy ausgeblendet werden */
  hideMobile: z.array(z.number().int().min(0)).optional(),
  caption: text.optional(),
});

export const industryExampleSchema = z.object({
  title: text,
  sub: text,
  lines: z.array(z.object({ qty: z.number().int().positive(), number: text, label: text })),
  /** Kennzahl nach der Summe: Summe / divisor je unit */
  perLabel: z.object({ divisor: z.number().positive(), unit: text, extra: text.optional() }).optional(),
  /** Klartext nach der Summe, wenn keine Kennzahl sinnvoll ist */
  info: text.optional(),
  warn: text.optional(),
  cta: text,
});

/** Branchenseite, wie sie der Renderer braucht (gemeinsame Texte aufgeloest). */
export const industryPageSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: text,
  short: text,
  /** Unterzeile in „Weitere Branchen“ */
  tagline: text,
  /** Kachel auf der Startseite: typisches Lagergut und eine belegte Kennzahl der Seite */
  teaser: z.object({ goods: text, fact: text }),
  url: text,
  metaTitle: text,
  metaDescription: text,
  eyebrow: text,
  h1: text,
  lead: text,
  proof: z.array(text),
  ctaPrimary: text,
  ctaSecondary: text,
  hero: z.object({ number: text, tag: text, alt: text }),
  /** Kennzahlen unter dem Bild: nur Werte des abgebildeten Systems (siehe Pruefregeln) */
  facts: z.array(z.object({ value: text, label: text })),
  areasTitle: text,
  areasIntro: text,
  areas: z.array(industryAreaSchema),
  /** stacked: Beispielrechnung unter den Tabellen (für breite Tabellen mit 4+ Textspalten) */
  planning: z.object({ title: text, intro: text, tables: z.array(industryTableSchema), example: industryExampleSchema.optional(), stacked: z.boolean().optional() }),
  productsTitle: text,
  products: z.array(z.object({ number: text, use: text, spec: text, title: text })),
  duties: z.object({ meta: z.array(text), operator: z.array(text), hint: text }),
  why: z.array(whySchema),
  project: z.object({ eyebrow: text, title: text, text, cta: text, link: z.object({ label: text, href: text }).optional() }),
  docs: z.array(docSchema),
  faqTitle: text,
  faq: z.array(faqSchema),
  advice: z.object({ title: text, text }),
  notes: z.object(Object.fromEntries(INDUSTRY_NOTE_KEYS.map((k) => [k, industryNoteSchema.optional()])) as Record<(typeof INDUSTRY_NOTE_KEYS)[number], z.ZodOptional<typeof industryNoteSchema>>),
});

export type IndustryIcon = (typeof INDUSTRY_ICONS)[number];
export type IndustryNoteKey = (typeof INDUSTRY_NOTE_KEYS)[number];
export type IndustryNote = z.infer<typeof industryNoteSchema>;
export type IndustryArea = z.infer<typeof industryAreaSchema>;
export type IndustryTable = z.infer<typeof industryTableSchema>;
export type IndustryExample = z.infer<typeof industryExampleSchema>;
export type IndustryPage = z.infer<typeof industryPageSchema>;
export type IndustryContact = z.infer<typeof contactSchema>;

// ───────────── gemeinsame Texte ─────────────

export const industryCommonSchema = z.object({
  contact: contactSchema,
  /** Betreiberpflichten, die auf jeder Seite stehen */
  operator: z.array(text),
  dutyHint: text,
  why: z.array(whySchema),
  docs: z.array(docSchema),
  /** Fragen fuer alle Seiten (Regalinspektion) */
  faq: z.array(faqSchema),
  noteDuties: industryNoteSchema,
  noteWhy: industryNoteSchema,
});
export type IndustryCommon = z.infer<typeof industryCommonSchema>;

const ref = <K extends string>(keys: readonly [K, ...K[]]) => z.object({ common: z.enum(keys) }).strict();
const listOf = <T extends z.ZodTypeAny, K extends string>(item: T, key: K) => z.array(z.union([ref([key]), item]));
const valueOr = <T extends z.ZodTypeAny, K extends string>(item: T, key: K) => z.union([ref([key]), item]);

/** Gespeicherte Branchenseite: an den markierten Stellen Verweise auf gemeinsame Texte erlaubt. */
export const storedIndustryPageSchema = industryPageSchema.extend({
  duties: z.object({ meta: z.array(text), operator: listOf(text, "operator"), hint: valueOr(text, "dutyHint") }),
  why: listOf(whySchema, "why"),
  docs: listOf(docSchema, "docs"),
  faq: listOf(faqSchema, "faq"),
  notes: industryPageSchema.shape.notes.extend({
    duties: valueOr(industryNoteSchema, "noteDuties").optional(),
    why: valueOr(industryNoteSchema, "noteWhy").optional(),
  }),
});
export type StoredIndustryPage = z.infer<typeof storedIndustryPageSchema>;
export type CommonRef = { common: keyof IndustryCommon };

const isRef = (v: unknown): v is CommonRef => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "common" in v;

/** Verweise durch die gemeinsamen Texte ersetzen (Ergebnis = Eingabe des Renderers). */
export function resolveIndustryPage(page: StoredIndustryPage, common: IndustryCommon): IndustryPage {
  const list = <T>(items: Array<T | CommonRef>): T[] => items.flatMap((x) => (isRef(x) ? (common[x.common] as unknown as T[]) : [x]));
  const value = <T>(v: T | CommonRef | undefined): T | undefined => (isRef(v) ? (common[v.common] as unknown as T) : v);
  return {
    ...page,
    duties: { ...page.duties, operator: list<string>(page.duties.operator), hint: value<string>(page.duties.hint)! },
    why: list<IndustryPage["why"][number]>(page.why),
    docs: list<IndustryPage["docs"][number]>(page.docs),
    faq: list<IndustryPage["faq"][number]>(page.faq),
    notes: { ...page.notes, duties: value<IndustryNote>(page.notes.duties), why: value<IndustryNote>(page.notes.why) },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Zusammenhaengende Folge `part` in `items` (nur einmal) durch einen Verweis ersetzen. */
function compressList<T>(items: T[], part: T[], key: keyof IndustryCommon): Array<T | CommonRef> {
  if (part.length === 0) return items;
  for (let i = 0; i + part.length <= items.length; i++) {
    if (same(items.slice(i, i + part.length), part)) return [...items.slice(0, i), { common: key }, ...items.slice(i + part.length)];
  }
  return items;
}

/** Umkehrung von resolveIndustryPage: gemeinsame Texte, die eine Seite unveraendert nutzt, als Verweis speichern. */
export function compressIndustryPage(page: IndustryPage, common: IndustryCommon): StoredIndustryPage {
  const value = <T>(v: T | undefined, key: keyof IndustryCommon): T | CommonRef | undefined => (v !== undefined && same(v, common[key]) ? { common: key } : v);
  return {
    ...page,
    duties: { ...page.duties, operator: compressList(page.duties.operator, common.operator, "operator"), hint: value(page.duties.hint, "dutyHint")! },
    why: compressList(page.why, common.why, "why"),
    docs: compressList(page.docs, common.docs, "docs"),
    faq: compressList(page.faq, common.faq, "faq"),
    notes: { ...page.notes, duties: value(page.notes.duties, "noteDuties"), why: value(page.notes.why, "noteWhy") },
  } as StoredIndustryPage;
}

// ───────────── Startseite ─────────────

export const homeTeaserSchema = z.object({
  eyebrow: text,
  title: text,
  intro: text,
  more: text,
  advice: z.object({ title: text, text }),
});
export type HomeTeaser = z.infer<typeof homeTeaserSchema>;

export const homeRabattSchema = z.object({
  eyebrow: text,
  title: text,
  intro: text,
  tiers: z.array(z.object({ pct: text, from: text, range: text })),
  note: text,
});
export type HomeRabatt = z.infer<typeof homeRabattSchema>;

export const homeMonduSchema = z.object({
  eyebrow: text,
  title: text,
  intro: text,
  methods: z.array(z.object({ name: text, fact: text })),
  faq: z.array(faqSchema),
  footer: z.array(text),
});
export type HomeMondu = z.infer<typeof homeMonduSchema>;

export const SHOP_CONTENT_SCHEMAS = {
  industry_page: storedIndustryPageSchema,
  home_teaser: homeTeaserSchema,
  home_rabatt: homeRabattSchema,
  home_mondu: homeMonduSchema,
  common: industryCommonSchema,
} as const satisfies Record<ShopContentKind, z.ZodTypeAny>;

export type ShopContentData = {
  industry_page: StoredIndustryPage;
  home_teaser: HomeTeaser;
  home_rabatt: HomeRabatt;
  home_mondu: HomeMondu;
  common: IndustryCommon;
};

/** Reihenfolge in der Uebersicht */
export const SHOP_CONTENT_KIND_ORDER: Record<ShopContentKind, number> = { industry_page: 0, home_teaser: 1, home_rabatt: 2, home_mondu: 3, common: 4 };

// ───────────── API-Antworten (Uebersicht/Detail) ─────────────

export type ShopContentIssue = {
  level: "error" | "warning";
  /** fester Code, Text im Client unter shopContent.rules.<rule> */
  rule: string;
  /** Feld, z. B. "facts.2.label" */
  path: string;
  params?: Record<string, string | number>;
};

export type ShopContentPublicationSummary = { versionNo: number | null; publishedAt: string; publishedBy: string | null; status: string };

export type ShopContentListEntry = {
  id: string;
  kind: ShopContentKind;
  key: string;
  name: string;
  /** Adresse im Shop (Branchenseiten) */
  url: string | null;
  versionNo: number;
  versionAt: string;
  versionBy: string | null;
  errors: number;
  warnings: number;
  test: ShopContentPublicationSummary | null;
  live: ShopContentPublicationSummary | null;
};

export type ShopContentVersionSummary = { id: string; versionNo: number; comment: string | null; createdAt: string; createdBy: string | null };

export type ShopContentDetail = {
  item: ShopContentListEntry;
  data: unknown;
  issues: ShopContentIssue[];
  versions: ShopContentVersionSummary[];
};
