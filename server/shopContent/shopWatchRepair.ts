/**
 * Shop-Wächter, Reparatur per Knopf (Shop-Puls Stufe 3, S3-2; Tests in tests/unit/shopWatchRepair.test.ts).
 *
 * Soll-Stand in der Datenbank statt in verstreuten Protokolldateien: Ist ein Prüfpunkt grün, liest der
 * Wächter die Einträge, die METAorder dafür in den Shop geschrieben hat, über die Admin-API und speichert sie
 * (nur die Felder, die die Schreibskripte setzen). Die Reparatur schreibt diesen Stand zurück; vorher liest
 * sie den jetzigen Stand derselben Einträge als Rückweg (fehlte ein Eintrag, löscht der Rückweg ihn wieder).
 *
 * Je Prüfpunkt steht hier, welche Einträge dazugehören:
 * - Storefront-Bausteine: Eintrag in „Eigenes CSS/JS“, danach Theme neu erstellen
 * - Schnellkonfigurator-Seite: Erlebniswelt und Landingpage (die Artikeltabelle als Medium nicht, sie bleibt beim Skript)
 * - Branchenseiten: Erlebniswelt, Landingpage, FAQ-Gruppe mit Fragen
 * - Abschnitte der Startseite (Schnellkonfigurator, Branchen-Teaser, Rabattstaffel, Mondu): der Abschnitt mit Blöcken
 * - Kategorietexte: die vier Inhaltsfelder der Kategorien aus dem Soll-Stand des Wächters
 * - Exit-Intent-Aktion: Regel und Aktion
 * - Newsletter-Checkbox: Textbaustein und die beiden Plugin-Einstellungen
 * Massendaten (Bildtexte, Meta-Texte, Beschreibungen, Montagekosten, Crossselling) bleiben bei ihren Läufen.
 */
import { createHash } from "crypto";
import { INDUSTRY_PAGES } from "../products/industryPages";
import { HOME_SECTION_IDS } from "../products/homeSections";
import { CATEGORY_CONTENT_FIELDS } from "../products/categoryPageHtml";
import { industryEntityId, quickConfigId, snippetEntryId, STOREFRONT_SNIPPETS } from "./shopEntityIds";
import { EXIT_INTENT_IDS } from "./exitIntentPromotion";
import { CHECKOUT_NEWSLETTER_SETTINGS, CHECKOUT_NEWSLETTER_SNIPPET_KEY, deSnippetSetId } from "./checkoutNewsletter";
import type { ShopApi } from "./shopProducts";

/** Ein gesicherter Eintrag; payload null = gab es nicht (Rückweg: löschen) */
export type SnapshotEntity = { entity: string; id: string; payload: Record<string, unknown> | null };

export type RepairEnv = {
  api: ShopApi;
  channelId: string;
  storefront: string;
  /** Kategorien mit Inhaltsfeldern laut Soll-Stand des Wächters */
  categoryIds: string[];
};

/** Was zu einem Prüfpunkt gesichert und zurückgeschrieben wird */
export type RepairSpec = {
  /** Einträge in Schreib-Reihenfolge (z. B. Erlebniswelt vor Landingpage) */
  read(env: RepairEnv): Promise<SnapshotEntity[]>;
  /** Nach dem Schreiben (Storefront-Bausteine: Theme neu erstellen, sonst liefert der Shop das Skript nicht) */
  compileTheme?: boolean;
};

// ---------------------------------------------------------------------------------------------
// Felder je Entität (wie die Schreibskripte sie setzen)

const tr = (row: any, field: string) => row?.translated?.[field] ?? row?.[field] ?? null;
const ids = (list: any[] | undefined) => (list ?? []).map((x) => ({ id: String(x.id) }));
const byPosition = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0);

export const pickDneEntry = (r: any) => ({ id: r.id, name: r.name, description: r.description ?? null, active: !!r.active, js: r.js ?? null, css: r.css ?? null, salesChannels: ids(r.salesChannels) });

export const pickLandingPage = (r: any) => ({
  id: r.id,
  active: !!r.active,
  name: tr(r, "name"),
  url: tr(r, "url"),
  metaTitle: tr(r, "metaTitle"),
  metaDescription: tr(r, "metaDescription"),
  keywords: tr(r, "keywords"),
  slotConfig: tr(r, "slotConfig"),
  customFields: tr(r, "customFields"),
  cmsPageId: r.cmsPageId ?? null,
  salesChannels: ids(r.salesChannels),
});

const pickSlot = (s: any) => ({ id: s.id, type: s.type, slot: s.slot, config: tr(s, "config"), customFields: tr(s, "customFields") });

const pickBlock = (b: any) => ({
  id: b.id,
  position: b.position,
  type: b.type,
  name: b.name ?? null,
  sectionPosition: b.sectionPosition ?? "main",
  marginTop: b.marginTop ?? null,
  marginBottom: b.marginBottom ?? null,
  marginLeft: b.marginLeft ?? null,
  marginRight: b.marginRight ?? null,
  backgroundColor: b.backgroundColor ?? null,
  backgroundMediaId: b.backgroundMediaId ?? null,
  backgroundMediaMode: b.backgroundMediaMode ?? null,
  cssClass: b.cssClass ?? null,
  visibility: b.visibility ?? null,
  customFields: b.customFields ?? null,
  slots: (b.slots ?? []).map(pickSlot),
});

export const pickSection = (s: any) => ({
  id: s.id,
  pageId: s.pageId,
  position: s.position,
  type: s.type,
  name: s.name ?? null,
  sizingMode: s.sizingMode ?? "boxed",
  mobileBehavior: s.mobileBehavior ?? "wrap",
  backgroundColor: s.backgroundColor ?? null,
  backgroundMediaId: s.backgroundMediaId ?? null,
  backgroundMediaMode: s.backgroundMediaMode ?? null,
  cssClass: s.cssClass ?? null,
  visibility: s.visibility ?? null,
  customFields: s.customFields ?? null,
  blocks: [...(s.blocks ?? [])].sort(byPosition).map(pickBlock),
});

export const pickCmsPage = (p: any) => ({
  id: p.id,
  name: tr(p, "name"),
  type: p.type,
  entity: p.entity ?? null,
  cssClass: p.cssClass ?? null,
  config: p.config ?? null,
  previewMediaId: p.previewMediaId ?? null,
  sections: [...(p.sections ?? [])].sort(byPosition).map((s: any) => {
    const { pageId: _pageId, ...rest } = pickSection(s);
    return rest;
  }),
});

const pickFaqGroup = (g: any) => ({ id: g.id, name: tr(g, "name"), active: !!g.active, position: g.position ?? null });
const pickFaqQuestion = (q: any) => ({ id: q.id, group: q.group, name: tr(q, "name") ?? "ID", active: !!q.active, questionPosition: q.questionPosition ?? null, question: tr(q, "question"), answer: tr(q, "answer") });

const pickRule = (r: any) => ({
  id: r.id,
  name: r.name,
  priority: r.priority,
  description: r.description ?? null,
  conditions: (r.conditions ?? []).map((c: any) => ({ id: c.id, type: c.type, parentId: c.parentId ?? null, position: c.position, value: c.value ?? null })),
});

const pickPromotion = (p: any) => ({
  id: p.id,
  name: tr(p, "name"),
  active: !!p.active,
  validFrom: p.validFrom ?? null,
  validUntil: p.validUntil ?? null,
  useCodes: !!p.useCodes,
  useIndividualCodes: !!p.useIndividualCodes,
  code: p.code ?? null,
  useSetGroups: !!p.useSetGroups,
  customerRestriction: !!p.customerRestriction,
  preventCombination: !!p.preventCombination,
  exclusive: !!p.exclusive,
  priority: p.priority,
  maxRedemptionsGlobal: p.maxRedemptionsGlobal ?? null,
  maxRedemptionsPerCustomer: p.maxRedemptionsPerCustomer ?? null,
  salesChannels: (p.salesChannels ?? []).map((s: any) => ({ id: s.id, salesChannelId: s.salesChannelId, priority: s.priority })),
  personaRules: ids(p.personaRules),
  discounts: (p.discounts ?? []).map((d: any) => ({
    id: d.id,
    scope: d.scope,
    type: d.type,
    value: d.value,
    considerAdvancedRules: !!d.considerAdvancedRules,
    applierKey: d.applierKey ?? null,
    usageKey: d.usageKey ?? null,
    sorterKey: d.sorterKey ?? null,
  })),
});

// ---------------------------------------------------------------------------------------------
// Lesen

const CMS_DEEP = { sections: { associations: { blocks: { associations: { slots: {} } } } } };
const SECTION_DEEP = { blocks: { associations: { slots: {} } } };

/** Einträge nach ID lesen; fehlende als payload null */
async function readEntities(api: ShopApi, entity: string, entityIds: string[], pick: (row: any) => Record<string, unknown>, associations?: Record<string, unknown>): Promise<SnapshotEntity[]> {
  if (!entityIds.length) return [];
  const res = await api("POST", `search/${entity.replace(/_/g, "-")}`, { ids: entityIds, limit: entityIds.length, ...(associations ? { associations } : {}) });
  const rows = new Map<string, any>((res?.data ?? []).map((r: any) => [String(r.id), r]));
  return entityIds.map((id) => ({ entity, id, payload: rows.has(id) ? pick(rows.get(id)) : null }));
}

async function landingWithPage(api: ShopApi, lpId: string): Promise<SnapshotEntity[]> {
  const [lp] = await readEntities(api, "landing_page", [lpId], pickLandingPage, { salesChannels: {} });
  const cmsId = (lp.payload?.cmsPageId as string | null) ?? null;
  const cms = cmsId ? await readEntities(api, "cms_page", [cmsId], pickCmsPage, CMS_DEEP) : [];
  return [...cms, lp];
}

async function faqGroupWithQuestions(api: ShopApi, groupId: string): Promise<SnapshotEntity[]> {
  const group = await readEntities(api, "hueb_seo_faq_group", [groupId], pickFaqGroup);
  const res = await api("POST", "search/hueb-seo-faq-questions", { limit: 100, filter: [{ type: "equals", field: "group", value: groupId }] });
  const questions = (res?.data ?? []).map((q: any) => ({ entity: "hueb_seo_faq_questions", id: String(q.id), payload: pickFaqQuestion(q) }));
  return [...group, ...questions];
}

const sectionSpec = (sectionId: string): RepairSpec => ({ read: (env) => readEntities(env.api, "cms_section", [sectionId], pickSection, SECTION_DEEP) });

/** Pseudo-Entität für Plugin-Einstellungen (system_config über _action/system-config) */
export const CONFIG_ENTITY = "system_config";

export const REPAIR_SPECS: Record<string, RepairSpec> = {
  ...Object.fromEntries(
    STOREFRONT_SNIPPETS.map((def) => [
      `snippet:${def.key}`,
      { compileTheme: true, read: (env: RepairEnv) => readEntities(env.api, "dne_custom_js_css", [snippetEntryId(def.key)], pickDneEntry, { salesChannels: {} }) } satisfies RepairSpec,
    ]),
  ),
  "quick-config:page": { read: (env) => landingWithPage(env.api, quickConfigId("lp")) },
  "quick-config:home": sectionSpec(quickConfigId("home-section")),
  ...Object.fromEntries(
    INDUSTRY_PAGES.map((page) => [
      `industry:${page.key}`,
      {
        read: async (env: RepairEnv) => [
          ...(await faqGroupWithQuestions(env.api, industryEntityId(page.key, "faq"))),
          ...(await landingWithPage(env.api, industryEntityId(page.key, "lp"))),
        ],
      } satisfies RepairSpec,
    ]),
  ),
  "industry:home": sectionSpec(industryEntityId("home", "section")),
  "home-section:rabatt": sectionSpec(HOME_SECTION_IDS.rabatt),
  "home-section:mondu": sectionSpec(HOME_SECTION_IDS.mondu),
  "category:fields": {
    read: (env) =>
      readEntities(env.api, "category", env.categoryIds, (r) => {
        const cf = r.translated?.customFields ?? r.customFields ?? {};
        return { id: r.id, customFields: Object.fromEntries(Object.values(CATEGORY_CONTENT_FIELDS).map((f) => [f, cf[f] ?? null])) };
      }),
  },
  "exit-intent:promotion": {
    read: async (env) => [
      ...(await readEntities(env.api, "rule", [EXIT_INTENT_IDS.rule], pickRule, { conditions: {} })),
      ...(await readEntities(env.api, "promotion", [EXIT_INTENT_IDS.promotion], pickPromotion, { salesChannels: {}, personaRules: {}, discounts: {} })),
    ],
  },
  "checkout-newsletter:opt-in": {
    read: async (env) => {
      const setId = await deSnippetSetId(env.api, env.channelId, env.storefront);
      const res = await env.api("POST", "search/snippet", {
        filter: [{ type: "equals", field: "setId", value: setId }, { type: "equals", field: "translationKey", value: CHECKOUT_NEWSLETTER_SNIPPET_KEY }],
      });
      const s = res?.data?.[0];
      const config = await env.api("GET", "_action/system-config?domain=Sendinblue.config");
      const keys = Object.values(CHECKOUT_NEWSLETTER_SETTINGS);
      return [
        ...(s ? [{ entity: "snippet", id: String(s.id), payload: { id: s.id, setId: s.setId, translationKey: s.translationKey, value: s.value, author: s.author } }] : []),
        { entity: CONFIG_ENTITY, id: "Sendinblue.config", payload: Object.fromEntries(keys.map((k) => [k, config?.[k] ?? null])) },
      ];
    },
  },
};

export const isRepairable = (checkId: string) => checkId in REPAIR_SPECS;

/** Fingerabdruck eines Soll-Stands (gleich = nichts neu zu speichern) */
export function snapshotHash(entities: SnapshotEntity[]): string {
  return createHash("sha256").update(JSON.stringify(entities)).digest("hex").slice(0, 16);
}

/** Ein Soll-Stand taugt nur, wenn alle Einträge da sind (sonst würde die Reparatur Lücken festschreiben) */
export const isCompleteSnapshot = (entities: SnapshotEntity[]) => entities.length > 0 && entities.every((e) => e.payload !== null);

// ---------------------------------------------------------------------------------------------
// Schreiben

/**
 * Einträge zurückschreiben, in der gespeicherten Reihenfolge. Je Entität ein Upsert über _action/sync
 * (vorhandene Einträge werden aktualisiert, fehlende angelegt, fremde Blöcke bleiben). payload null heißt:
 * den Eintrag gab es vorher nicht → löschen (nur beim Rückweg).
 */
export async function writeSnapshot(api: ShopApi, entities: SnapshotEntity[]): Promise<{ upserted: number; deleted: number }> {
  let upserted = 0;
  let deleted = 0;
  // Löschen in umgekehrter Reihenfolge (Landingpage vor Erlebniswelt, Fragen vor Gruppe)
  for (const e of [...entities].reverse()) {
    if (e.payload !== null || e.entity === CONFIG_ENTITY) continue;
    await api("DELETE", `${e.entity.replace(/_/g, "-")}/${e.id}`).catch((err: Error) => {
      if (!/\b404\b/.test(err.message)) throw err;
    });
    deleted++;
  }
  for (const e of entities) {
    if (e.payload === null) continue;
    if (e.entity === CONFIG_ENTITY) {
      await api("POST", "_action/system-config", e.payload);
    } else {
      await api("POST", "_action/sync", [{ action: "upsert", entity: e.entity, payload: [e.payload] }]);
    }
    upserted++;
  }
  return { upserted, deleted };
}

/** Theme des Kanals neu erstellen (wie scripts/lib/storefrontSnippetEntry.ts), erst dann liefert der Shop die Bausteine aus */
export async function compileChannelTheme(api: ShopApi, channelId: string): Promise<void> {
  const res = await api("POST", "search/theme", { filter: [{ type: "equals", field: "salesChannels.id", value: channelId }], includes: { theme: ["id", "name"] } });
  const theme = res?.data?.[0];
  if (!theme) throw new Error(`Kein Theme für Kanal ${channelId}`);
  await api("PATCH", `_action/theme/${theme.id}`, { config: {} });
}

/** Rückweg auf den Stand von vorher: dieselben Einträge, fehlende gelten als „gab es nicht“ */
export function revertEntities(before: SnapshotEntity[], target: SnapshotEntity[]): SnapshotEntity[] {
  const known = new Set(before.map((e) => `${e.entity}:${e.id}`));
  // Einträge, die nur der Soll-Stand hat (z. B. neue FAQ-Frage), gab es vorher nicht
  const added = target.filter((e) => !known.has(`${e.entity}:${e.id}`) && e.entity !== CONFIG_ENTITY).map((e) => ({ entity: e.entity, id: e.id, payload: null }));
  return [...before, ...added];
}
