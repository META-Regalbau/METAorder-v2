/**
 * Shop-Wächter, Reparatur per Knopf (Shop-Puls Stufe 3, S3-2): Soll-Stand je Prüfpunkt lesen (nur geschriebene
 * Felder), vollständig/Fingerabdruck, Zurückschreiben in Reihenfolge, Rückweg (fehlende wieder löschen),
 * Deploy-Schlüssel und „einmal je Deploy“, welche Soll-Stände nach einem Lauf gesichert werden.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  CONFIG_ENTITY,
  isCompleteSnapshot,
  isRepairable,
  pickCmsPage,
  pickSection,
  REPAIR_SPECS,
  revertEntities,
  snapshotHash,
  writeSnapshot,
  type RepairEnv,
  type SnapshotEntity,
} from "../../server/shopContent/shopWatchRepair";
import { alreadyRepaired, currentDeployKey, targetsToCapture } from "../../server/shopContent/shopWatchRepairRun";
import { SHOP_WATCH_CHECKS } from "../../server/shopContent/shopWatchChecks";
import { snippetEntryId, STOREFRONT_SNIPPETS } from "../../server/shopContent/shopEntityIds";
import { HOME_SECTION_IDS } from "../../server/products/homeSections";

type Call = { method: string; path: string; body?: any };

function fakeApi(rows: Record<string, any[]>, calls: Call[] = []) {
  return async (method: string, path: string, body?: any) => {
    calls.push({ method, path, body });
    if (method === "POST" && path.startsWith("search/")) {
      const entity = path.slice(7);
      const list = rows[entity] ?? [];
      return { data: body?.ids ? list.filter((r) => body.ids.includes(r.id)) : list };
    }
    if (method === "GET" && path.startsWith("_action/system-config")) return rows.config?.[0] ?? {};
    return null;
  };
}

const env = (api: any, over: Partial<RepairEnv> = {}): RepairEnv => ({ api, channelId: "ch", storefront: "https://shop.example", categoryIds: [], ...over });

describe("Katalog", () => {
  it("jeder reparierbare Prüfpunkt existiert im Wächter; Massendaten und Hinweise bleiben ohne Knopf", () => {
    const ids = SHOP_WATCH_CHECKS.map((c) => c.id);
    for (const id of Object.keys(REPAIR_SPECS)) expect(ids).toContain(id);
    expect(isRepairable("bulk:descriptions")).toBe(false);
    expect(isRepairable("platform:plugins")).toBe(false);
    expect(isRepairable("category:listing")).toBe(false);
    expect(isRepairable(`snippet:${STOREFRONT_SNIPPETS[0].key}`)).toBe(true);
  });
});

describe("Soll-Stand lesen", () => {
  it("Storefront-Baustein: nur die geschriebenen Felder, Kanäle als IDs, Theme danach neu", async () => {
    const def = STOREFRONT_SNIPPETS[0];
    const id = snippetEntryId(def.key);
    const api = fakeApi({ "dne-custom-js-css": [{ id, name: "N", description: null, active: true, js: "a", css: "b", createdAt: "x", salesChannels: [{ id: "ch", name: "DE" }] }] });
    const spec = REPAIR_SPECS[`snippet:${def.key}`];
    expect(spec.compileTheme).toBe(true);
    expect(await spec.read(env(api))).toEqual([{ entity: "dne_custom_js_css", id, payload: { id, name: "N", description: null, active: true, js: "a", css: "b", salesChannels: [{ id: "ch" }] } }]);
  });

  it("fehlender Eintrag → payload null, Soll-Stand unvollständig", async () => {
    const def = STOREFRONT_SNIPPETS[1];
    const read = await REPAIR_SPECS[`snippet:${def.key}`].read(env(fakeApi({})));
    expect(read).toEqual([{ entity: "dne_custom_js_css", id: snippetEntryId(def.key), payload: null }]);
    expect(isCompleteSnapshot(read)).toBe(false);
    expect(isCompleteSnapshot([])).toBe(false);
  });

  it("Abschnitt mit Blöcken und Slots (Konfiguration in der Sprache Deutsch), sortiert nach Position", () => {
    const s = pickSection({
      id: "s",
      pageId: "p",
      position: 3,
      type: "default",
      blocks: [
        { id: "b2", position: 1, type: "text", slots: [{ id: "x", type: "text", slot: "content", config: { a: 1 }, translated: { config: { a: 2 } } }] },
        { id: "b1", position: 0, type: "text", slots: [] },
      ],
    });
    expect(s.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(s.blocks[1].slots[0].config).toEqual({ a: 2 });
    expect(pickCmsPage({ id: "p", type: "landingpage", sections: [s] }).sections[0]).not.toHaveProperty("pageId");
  });

  it("Startseiten-Abschnitt Rabattstaffel liest den Abschnitt mit tiefen Verknüpfungen", async () => {
    const calls: Call[] = [];
    await REPAIR_SPECS["home-section:rabatt"].read(env(fakeApi({ "cms-section": [{ id: HOME_SECTION_IDS.rabatt, pageId: "home", position: 2, blocks: [] }] }, calls)));
    expect(calls[0]).toMatchObject({ path: "search/cms-section", body: { ids: [HOME_SECTION_IDS.rabatt], associations: { blocks: { associations: { slots: {} } } } } });
  });

  it("Kategorietexte: nur die vier Inhaltsfelder der Kategorien aus dem Soll-Stand", async () => {
    const api = fakeApi({ category: [{ id: "c1", name: "X", translated: { customFields: { meta_category_intro: "<p>a</p>", other: 1 } } }] });
    const read = await REPAIR_SPECS["category:fields"].read(env(api, { categoryIds: ["c1"] }));
    expect(Object.keys((read[0].payload as any).customFields)).not.toContain("other");
    expect((read[0].payload as any).customFields).toMatchObject({ meta_category_intro: "<p>a</p>" });
  });

  it("Newsletter-Checkbox: Textbaustein und die beiden Plugin-Einstellungen", async () => {
    const api = fakeApi({
      "sales-channel-domain": [{ url: "https://shop.example/", snippetSetId: "set" }],
      snippet: [{ id: "sn", setId: "set", translationKey: "k", value: "Text", author: "METAorder" }],
      config: [{ "Sendinblue.config.isDisplayOptInEnabled": true, "Sendinblue.config.isDisplayOptInChecked": false, fremd: 1 }],
    });
    const read = await REPAIR_SPECS["checkout-newsletter:opt-in"].read(env(api));
    expect(read).toEqual([
      { entity: "snippet", id: "sn", payload: { id: "sn", setId: "set", translationKey: "k", value: "Text", author: "METAorder" } },
      { entity: CONFIG_ENTITY, id: "Sendinblue.config", payload: { "Sendinblue.config.isDisplayOptInEnabled": true, "Sendinblue.config.isDisplayOptInChecked": false } },
    ]);
  });
});

describe("Zurückschreiben und Rückweg", () => {
  const target: SnapshotEntity[] = [
    { entity: "cms_page", id: "cms", payload: { id: "cms" } },
    { entity: "landing_page", id: "lp", payload: { id: "lp", cmsPageId: "cms" } },
    { entity: CONFIG_ENTITY, id: "Sendinblue.config", payload: { k: true } },
  ];

  it("Upsert je Eintrag in Reihenfolge, Einstellungen über system-config", async () => {
    const calls: Call[] = [];
    expect(await writeSnapshot(fakeApi({}, calls), target)).toEqual({ upserted: 3, deleted: 0 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST _action/sync", "POST _action/sync", "POST _action/system-config"]);
    expect(calls[0].body).toEqual([{ action: "upsert", entity: "cms_page", payload: [{ id: "cms" }] }]);
  });

  it("Rückweg: was vorher fehlte, wird wieder gelöscht (Landingpage vor Erlebniswelt), Rest zurückgeschrieben", async () => {
    const before: SnapshotEntity[] = [
      { entity: "cms_page", id: "cms", payload: null },
      { entity: "landing_page", id: "lp", payload: null },
      { entity: CONFIG_ENTITY, id: "Sendinblue.config", payload: { k: false } },
    ];
    const calls: Call[] = [];
    expect(await writeSnapshot(fakeApi({}, calls), revertEntities(before, [...target, { entity: "hueb_seo_faq_questions", id: "q9", payload: { id: "q9" } }]))).toEqual({ upserted: 1, deleted: 3 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE hueb-seo-faq-questions/q9", "DELETE landing-page/lp", "DELETE cms-page/cms", "POST _action/system-config"]);
  });

  it("Löschen eines schon fehlenden Eintrags (404) ist kein Fehler", async () => {
    const api = async (method: string) => {
      if (method === "DELETE") throw new Error("DELETE landing-page/lp: 404 not found");
      return null;
    };
    await expect(writeSnapshot(api, [{ entity: "landing_page", id: "lp", payload: null }])).resolves.toEqual({ upserted: 0, deleted: 1 });
  });

  it("Fingerabdruck ändert sich mit dem Inhalt", () => {
    expect(snapshotHash(target)).toBe(snapshotHash(structuredClone(target)));
    expect(snapshotHash(target)).not.toBe(snapshotHash([{ ...target[0], payload: { id: "cms", name: "x" } }]));
  });
});

describe("Regeln", () => {
  it("Deploy-Schlüssel: letzter echter Deploy (Version/Plugins), Theme-Neubau zählt nicht", () => {
    expect(currentDeployKey({ history: [] })).toBe("none");
    expect(
      currentDeployKey({
        history: [
          { startedAt: "3", trigger: "schedule", status: "ok", deployChanges: [{ field: "themeAsset", before: "a", after: "b" }], failed: 0, warned: 0 },
          { startedAt: "2", trigger: "deploy", status: "ok", deployChanges: [{ field: "plugins", before: "a", after: "b" }], failed: 0, warned: 0 },
          { startedAt: "1", trigger: "deploy", status: "ok", deployChanges: [{ field: "shopwareVersion", before: "a", after: "b" }], failed: 0, warned: 0 },
        ],
      }),
    ).toBe("2");
  });

  it("höchstens einmal je Deploy und Prüfpunkt; zurückgenommene und gescheiterte zählen nicht", () => {
    const r = (over: object) => ({ checkId: "c", deployKey: "d1", status: "ok" as const, revertedAt: null, ...over });
    expect(alreadyRepaired([r({})], "c", "d1")).toBe(true);
    expect(alreadyRepaired([r({})], "c", "d2")).toBe(false);
    expect(alreadyRepaired([r({ revertedAt: "x" })], "c", "d1")).toBe(false);
    expect(alreadyRepaired([r({ status: "failed" })], "c", "d1")).toBe(false);
    expect(alreadyRepaired([r({ checkId: "x" })], "c", "d1")).toBe(false);
  });

  it("Soll-Stand sichern: grüne reparierbare Prüfpunkte; stündlich nur die ohne Soll-Stand", () => {
    const results = [
      { id: "quick-config:home", status: "ok" as const },
      { id: "industry:home", status: "fail" as const },
      { id: "bulk:descriptions", status: "ok" as const },
      { id: "home-section:mondu", status: "ok" as const },
    ];
    expect(targetsToCapture(results, new Set(), "all")).toEqual(["quick-config:home", "home-section:mondu"]);
    expect(targetsToCapture(results, new Set(["quick-config:home"]), "hourly")).toEqual(["home-section:mondu"]);
  });
});
