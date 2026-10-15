/**
 * Schreibt freigegebene Landingpage-Inhalte (Excel aus exportLandingTexts.ts) in die Layouts der
 * Landingpages. Was je Seite passiert, steht in server/products/landingPageTexts.ts (LANDING_PAGES):
 * Kennzahlen im roten Band, Kopf (H1 + Einleitung), SEO-Abschnitt ersetzen, Textkorrekturen,
 * FAQ-Korrekturen (Plugin hueb SEO FAQ) und neue Abschnitte (Links, Topseller, SEO-Text, FAQ, Beratung).
 * Nur fuer "Headless" freigegebene Agentur-Abschnitte bleiben unangetastet.
 *
 * Ohne --apply nur Testlauf. Mit --apply vorher Protokoll mit allen bisherigen Werten; --revert stellt
 * daraus alles wieder her (geaenderte Slots/FAQ zurueck, neue Abschnitte und FAQ-Gruppen geloescht).
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeLandingContent.ts <tenantId> <landingpages.xlsx> [--only key,key] [--apply]
 *   NODE_ENV=development npx tsx scripts/writeLandingContent.ts <tenantId> --revert <protokoll.json>
 */
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import XLSXmod from "xlsx";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { beratungBoxHtml, linkPillsHtml, styleSeoHtml, type CategoryLink } from "../server/products/categoryPageHtml";
import { LANDING_PAGES, replaceKeyFigure } from "../server/products/landingPageTexts";
import { parseCatalogName } from "../server/cross-selling/crossSellNameRules";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const DE_CHANNEL_NAME = "META Regalbau DE";
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";
const SLIDER_PRODUCTS = 12;
const newId = () => randomBytes(16).toString("hex");
const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const MARGINS = { marginTop: "20px", marginBottom: "20px", marginLeft: "20px", marginRight: "20px" };
// Theme: .h4 ist nur 16 px wie der Fliesstext; fs-4 = 20 px
const HEADING = "fs-4 fw-bold mt-4 mb-2";
// Markierung der von hier geschriebenen SEO-Texte: ein weiterer Lauf ersetzt sie an derselben Stelle
const SEO_MARKER = "metaorder-landing-seo";
const seoHtml = (row: any) => `<div class="${SEO_MARKER}">${styleSeoHtml(String(row["SEO-Text neu (HTML)"]), HEADING)}</div>`;

type Protocol = {
  tenantId: string;
  at: string;
  slots: Array<{ id: string; config: unknown }>;
  faqQuestions: Array<{ id: string; question: string; answer: string }>;
  createdSections: string[];
  createdFaqGroups: string[];
  /** Fragen eigener FAQ-Gruppen, die beim Aktualisieren ersetzt wurden (zum Wiederherstellen) */
  replacedFaqQuestions?: any[];
  createdFaqQuestions?: string[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const textBlock = (position: number, html: string) => ({
  id: newId(),
  type: "text",
  position,
  sectionPosition: "main",
  ...MARGINS,
  visibility: ALL_DEVICES,
  slots: [{ id: newId(), type: "text", slot: "content", config: { content: { source: "static", value: html }, verticalAlign: { source: "static", value: null } } }],
});

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/writeLandingContent.ts <tenantId> <landingpages.xlsx> [--only key,key] [--apply] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const client = new ShopwareClient(settings);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await client.makeAuthenticatedRequest(`${base}/api/${path}`, { method, headers: { "Content-Type": "application/json", "sw-language-id": DE_LANG }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : null;
  };

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    for (const s of log.slots) await api("PATCH", `cms-slot/${s.id}`, { config: s.config });
    for (const q of log.faqQuestions) await api("PATCH", `hueb-seo-faq-questions/${q.id}`, { question: q.question, answer: q.answer });
    for (const id of log.createdSections) await api("DELETE", `cms-section/${id}`).catch((e) => console.log("Abschnitt", e.message));
    for (const id of log.createdFaqQuestions ?? []) await api("DELETE", `hueb-seo-faq-questions/${id}`).catch((e) => console.log("FAQ-Frage", e.message));
    for (const q of log.replacedFaqQuestions ?? []) await api("POST", "hueb-seo-faq-questions", q);
    for (const id of log.createdFaqGroups) await api("DELETE", `hueb-seo-faq-group/${id}`).catch((e) => console.log("FAQ-Gruppe", e.message));
    console.log(`Zurückgebaut: ${log.slots.length} Slots, ${log.faqQuestions.length} FAQ, ${log.createdSections.length} Abschnitte, ${log.createdFaqGroups.length} FAQ-Gruppen`);
    return;
  }

  const xlsx = process.argv[3];
  if (!xlsx?.endsWith(".xlsx")) throw new Error("Excel fehlt");
  const apply = process.argv.includes("--apply");
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  // Zeilen mit Prüfhinweis haben keinen geprüften Text: dann nur Kennzahlen und Korrekturen
  const rows = (XLSX.utils.sheet_to_json(XLSX.readFile(xlsx).Sheets["Landingpages"]) as any[]).filter((r) => !only.size || only.has(r.Landingpage));

  const channels = await api("POST", "search/sales-channel", { limit: 50, associations: { domains: {} }, includes: { sales_channel: ["id", "name", "accessKey", "domains", "navigationCategoryId"], sales_channel_domain: ["url"] } });
  const de = channels.data.find((c: any) => c.name === DE_CHANNEL_NAME);
  const domain = ((de.domains ?? []).map((d: any) => d.url).find((u: string) => /shop\.meta-online\.com|test\./.test(u)) ?? base).replace(/\/$/, "");
  const cats = await api("POST", "search/category", {
    limit: 500,
    filter: [{ type: "contains", field: "path", value: de.navigationCategoryId }, { type: "equals", field: "active", value: true }, { type: "equals", field: "type", value: "page" }],
    associations: { seoUrls: {} },
    includes: { category: ["id", "name", "seoUrls"], seo_url: ["seoPathInfo", "isCanonical", "isDeleted", "salesChannelId", "languageId"] },
  });
  const urlOf = (c: any) => {
    const u = (c.seoUrls ?? []).find((x: any) => x.salesChannelId === de.id && x.languageId === DE_LANG && x.isCanonical && !x.isDeleted);
    return u ? `/${u.seoPathInfo}` : null;
  };
  const listing = async (categoryId: string, limit: number) => {
    const r = await fetch(`${domain}/store-api/product-listing/${categoryId}`, {
      method: "POST",
      headers: { "sw-access-key": de.accessKey, "sw-language-id": DE_LANG, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ limit, order: "topseller" }),
    });
    if (!r.ok) return { total: 0, ids: [] as string[] };
    const d = (await r.json()) as any;
    // Fuer den Slider nur Regale (Name mit Regalart), kein Zubehoer aus derselben Kategorie
    const shelves = (d.elements ?? []).filter((p: any) => parseCatalogName(String(p.translated?.name ?? p.name ?? ""))?.role);
    return { total: Number(d.total ?? 0), ids: shelves.map((p: any) => String(p.id)) };
  };

  const log: Protocol = { tenantId, at: new Date().toISOString(), slots: [], faqQuestions: [], createdSections: [], createdFaqGroups: [], replacedFaqQuestions: [], createdFaqQuestions: [] };
  // FAQ eigener Gruppen neu: alte Fragen loeschen (im Protokoll gesichert), neue anlegen
  const faqReplacements: Array<{ groupId: string; old: any[]; questions: Array<{ q: string; a: string }>; what: string }> = [];
  const slotUpdates: Array<{ id: string; config: any; what: string }> = [];
  const faqUpdates: Array<{ id: string; question: string; answer: string; old: { question: string; answer: string } }> = [];
  const sectionCreates: Array<{ section: any; faqGroup?: any; what: string }> = [];

  for (const row of rows) {
    const cfg = LANDING_PAGES.find((c) => c.key === row.Landingpage);
    if (!cfg) {
      console.log(`UNBEKANNT ${row.Landingpage}`);
      continue;
    }
    const lp = (
      await api("POST", "search/landing-page", {
        ids: [cfg.landingPageId],
        associations: { cmsPage: { associations: { sections: { associations: { blocks: { associations: { slots: {} } } } } } } },
      })
    ).data?.[0];
    if (!lp?.cmsPage) {
      console.log(`FEHLT Landingpage ${cfg.key}`);
      continue;
    }
    const sections = [...lp.cmsPage.sections].sort((a: any, b: any) => a.position - b.position);
    const slotsOf = (sec: any) => [...(sec?.blocks ?? [])].sort((a: any, b: any) => a.position - b.position).flatMap((b: any) => b.slots ?? []);
    const textSlots = sections.flatMap((sec: any) => slotsOf(sec).filter((s: any) => s.type === "text").map((s: any) => ({ sec, slot: s })));
    const html = (s: any) => String(s.config?.content?.value ?? "");
    const setHtml = (slot: any, value: string, what: string) => {
      if (value === (slotUpdates.find((u) => u.id === slot.id)?.config.content.value ?? html(slot))) return; // schon so
      const existing = slotUpdates.find((u) => u.id === slot.id);
      const config = existing?.config ?? structuredClone(slot.config ?? {});
      config.content = { ...(config.content ?? {}), source: "static", value };
      if (existing) existing.what += `; ${what}`;
      else slotUpdates.push({ id: slot.id, config, what: `${cfg.key}: ${what}` });
      if (!log.slots.some((s) => s.id === slot.id)) log.slots.push({ id: slot.id, config: slot.config });
    };
    const currentHtml = (slot: any) => slotUpdates.find((u) => u.id === slot.id)?.config.content.value ?? html(slot);

    // 1. Kennzahlen im roten Band
    const hasText = Boolean(row["H1 neu"] && row["SEO-Text neu (HTML)"] && !row["Prüfhinweis"]);
    if (!hasText && (cfg.replaceHero || cfg.replaceSeoText || cfg.addSections)) console.log(`  ${cfg.key}: kein geprüfter Text – nur Kennzahlen und Korrekturen`);
    const figures = String(row["Kennzahlen neu (aus Shopdaten)"] ?? "").split("\n");
    slotsOf(sections[1])
      .filter((s: any) => s.type === "text")
      .forEach((slot: any, i: number) => {
        const f = (figures[i] ?? "").trim();
        if (!f || f.endsWith("(bleibt)")) return;
        const next = replaceKeyFigure(html(slot), f);
        if (next !== html(slot)) setHtml(slot, next, `Kennzahl ${i + 1} → ${f}`);
      });

    // 2. Kopf
    if (cfg.replaceHero && hasText) {
      const hero = slotsOf(sections[0]).find((s: any) => s.type === "text");
      if (hero && row["H1 neu"]) setHtml(hero, `<h1>${String(row["H1 neu"]).replace(/</g, "&lt;")}</h1>\n${row["Einleitung neu (HTML)"]}`, "Kopf (H1 + Einleitung)");
    }

    // 3. SEO-Abschnitt ersetzen (erster passender Block bekommt den Text, weitere werden geleert)
    if ((cfg.replaceSeoText || cfg.addSections) && hasText) {
      const matches = textSlots.filter((x: any) => cfg.replaceSeoText?.test(html(x.slot)) || html(x.slot).includes(SEO_MARKER));
      // bei Seiten mit eigenen Abschnitten gibt es den SEO-Block erst nach dem ersten Lauf
      if (cfg.addSections && !cfg.replaceSeoText && matches.length === 0) {
        /* wird unten mit den neuen Abschnitten angelegt */
      } else
      {
        if (matches.length === 0) console.log(`  ${cfg.key}: SEO-Abschnitt nicht gefunden`);
        matches.forEach((x: any, i: number) => setHtml(x.slot, i === 0 ? seoHtml(row) : "", i === 0 ? "SEO-Text" : "alter Textblock geleert"));
      }
    }

    // 4. Textkorrekturen
    for (const fix of cfg.textFixes ?? []) {
      for (const x of textSlots) {
        const cur = currentHtml(x.slot);
        if (fix.find.test(cur)) setHtml(x.slot, cur.replace(fix.find, fix.replace), fix.note);
      }
    }

    // 5. FAQ-Korrekturen
    if (cfg.faqFixes?.length) {
      const faqSlot = sections.flatMap(slotsOf).find((s: any) => /hueb-faq/.test(s.type));
      const groupId = faqSlot?.config?.group?.value;
      const questions = groupId ? (await api("POST", "search/hueb-seo-faq-questions", { limit: 50, filter: [{ type: "equals", field: "group", value: groupId }] })).data ?? [] : [];
      for (const fix of cfg.faqFixes) {
        const q = questions.find((x: any) => fix.question.test(String(x.translated?.question ?? x.question ?? "").trim()));
        if (!q) {
          console.log(`  ${cfg.key}: FAQ „${fix.question.source}“ nicht gefunden (schon korrigiert?)`);
          continue;
        }
        const old = { question: String(q.translated?.question ?? q.question ?? ""), answer: String(q.translated?.answer ?? q.answer ?? "") };
        const next = { question: fix.newQuestion ?? old.question, answer: fix.newAnswer ?? old.answer };
        if (next.question === old.question && next.answer === old.answer) continue; // schon korrigiert
        faqUpdates.push({ id: q.id, ...next, old });
      }
    }

    // 6. Neue Abschnitte am Ende
    if (cfg.addSections && hasText) {
      const marker = `metaorder-landing-${cfg.key}`;
      if (textSlots.some((x: any) => html(x.slot).includes(marker))) {
        // Abschnitte gibt es schon: SEO-Text wurde oben aktualisiert, hier die Fragen der eigenen FAQ-Gruppe
        const faqSlot = sections.flatMap(slotsOf).find((x: any) => /hueb-faq/.test(x.type) && sections.some((sec: any) => slotsOf(sec).includes(x) && slotsOf(sec).some((y: any) => html(y).includes(SEO_MARKER))));
        const groupId = faqSlot?.config?.group?.value;
        const faq = JSON.parse(String(row["FAQ neu (JSON)"] ?? "[]")) as Array<{ q: string; a: string }>;
        if (groupId) {
          const old = (await api("POST", "search/hueb-seo-faq-questions", { limit: 50, filter: [{ type: "equals", field: "group", value: groupId }], sort: [{ field: "questionPosition", order: "ASC" }] })).data ?? [];
          const same = old.length === faq.length && old.every((q: any, i: number) => (q.translated?.question ?? q.question) === faq[i].q && (q.translated?.answer ?? q.answer) === faq[i].a);
          if (!same) faqReplacements.push({ groupId, old, questions: faq, what: `${cfg.key}: FAQ ersetzt (${old.length} → ${faq.length} Fragen)` });
        }
      } else {
        const links: CategoryLink[] = [];
        const sliderIds: string[][] = [];
        for (const c of cats.data.filter((c: any) => cfg.linkCategories.test(c.name))) {
          const url = urlOf(c);
          const l = await listing(c.id, 12);
          if (url && l.total > 0) links.push({ label: c.name, url });
          if (cfg.shelfCategories.test(c.name)) sliderIds.push(l.ids);
        }
        // Topseller je Regal-Kategorie abwechselnd, damit alle Systeme vorkommen
        const top: string[] = [];
        for (let i = 0; top.length < SLIDER_PRODUCTS && i < SLIDER_PRODUCTS; i++) for (const ids of sliderIds) if (ids[i] && top.length < SLIDER_PRODUCTS) top.push(ids[i]);
        const faq = JSON.parse(String(row["FAQ neu (JSON)"] ?? "[]")) as Array<{ q: string; a: string }>;
        const groupId = newId();
        const faqGroup = {
          id: groupId,
          name: `Landingpage ${cfg.factsName}`,
          active: true,
          position: 50,
          questions: faq.map((x, i) => ({ id: newId(), name: "ID", active: true, questionPosition: i + 1, question: x.q, answer: x.a })),
        };
        let pos = Math.max(...sections.map((s: any) => s.position)) + 1;
        const section = (blocks: any[]) => ({ id: newId(), pageId: lp.cmsPage.id, type: "default", position: pos++, sizingMode: "boxed", mobileBehavior: "wrap", visibility: ALL_DEVICES, blocks });
        const linkSection = section([textBlock(0, `<div class="${marker}">${linkPillsHtml("Direkt zu den Regalen", links, "fs-4 fw-bold mb-3")}</div>`)]);
        const sliderSection = section([
          {
            id: newId(),
            type: "product-slider",
            position: 0,
            sectionPosition: "main",
            ...MARGINS,
            visibility: ALL_DEVICES,
            slots: [
              {
                id: newId(),
                type: "product-slider",
                slot: "productSlider",
                config: {
                  products: { source: "static", value: top },
                  title: { source: "static", value: `Beliebte ${String(row["H1 neu"] ?? "").split(/\s[–-]\s/)[0] || "Regale"}` },
                  displayMode: { source: "static", value: "standard" },
                  boxLayout: { source: "static", value: "standard" },
                  navigation: { source: "static", value: true },
                  navigationArrows: { source: "static", value: "outside" },
                  rotate: { source: "static", value: false },
                  border: { source: "static", value: false },
                  elMinWidth: { source: "static", value: "300px" },
                  speed: { source: "static", value: 300 },
                  autoplayTimeout: { source: "static", value: 5000 },
                  verticalAlign: { source: "static", value: null },
                },
              },
            ],
          },
        ]);
        const textSection = section([
          textBlock(0, seoHtml(row)),
          textBlock(1, `<h2 class="fs-4 fw-bold mt-2 mb-0">Häufige Fragen</h2>`),
          { ...textBlock(2, ""), slots: [{ id: newId(), type: "hueb-faq-element", slot: "content", config: { group: { source: "static", value: groupId } } }] },
          textBlock(3, beratungBoxHtml(true)),
        ]);
        sectionCreates.push({ section: linkSection, faqGroup, what: `${cfg.key}: Links (${links.map((l) => l.label).join(", ")})` });
        sectionCreates.push({ section: sliderSection, what: `${cfg.key}: Topseller-Slider (${top.length} Artikel)` });
        sectionCreates.push({ section: textSection, what: `${cfg.key}: SEO-Text, FAQ (${faq.length} Fragen), Beratung` });
      }
    }
  }

  for (const u of slotUpdates) console.log(`${apply ? "SCHREIBE" : "würde schreiben"} Slot ${u.id.slice(0, 8)} – ${u.what}`);
  for (const f of faqUpdates) console.log(`${apply ? "SCHREIBE" : "würde schreiben"} FAQ „${f.old.question}“${f.question !== f.old.question ? ` → „${f.question}“` : ""}${f.answer !== f.old.answer ? " (neue Antwort)" : ""}`);
  for (const c of sectionCreates) console.log(`${apply ? "LEGE AN" : "würde anlegen"} Abschnitt – ${c.what}`);
  for (const r of faqReplacements) console.log(`${apply ? "SCHREIBE" : "würde schreiben"} ${r.what}`);
  if (!apply || (slotUpdates.length + faqUpdates.length + sectionCreates.length + faqReplacements.length === 0)) return;

  log.faqQuestions = faqUpdates.map((f) => ({ id: f.id, ...f.old }));
  const file = `${xlsx}.protokoll-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(log, null, 1));
  console.log(`Protokoll: ${file}`);
  for (const u of slotUpdates) await api("PATCH", `cms-slot/${u.id}`, { config: u.config });
  for (const f of faqUpdates) await api("PATCH", `hueb-seo-faq-questions/${f.id}`, { question: f.question, answer: f.answer });
  for (const c of sectionCreates) {
    if (c.faqGroup) {
      // Das Plugin nimmt die Fragen nicht verschachtelt mit der Gruppe an (Fremdschluessel): erst Gruppe, dann Fragen
      const { questions, ...group } = c.faqGroup;
      await api("POST", "hueb-seo-faq-group", group);
      log.createdFaqGroups.push(group.id);
      writeFileSync(file, JSON.stringify(log, null, 1));
      for (const q of questions) await api("POST", "hueb-seo-faq-questions", { ...q, group: group.id });
    }
    await api("POST", "cms-section", c.section);
    log.createdSections.push(c.section.id);
    writeFileSync(file, JSON.stringify(log, null, 1));
  }
  for (const r of faqReplacements) {
    log.replacedFaqQuestions!.push(
      ...r.old.map((q: any) => ({ id: q.id, group: r.groupId, name: q.name ?? "ID", active: q.active ?? true, questionPosition: q.questionPosition, question: q.translated?.question ?? q.question, answer: q.translated?.answer ?? q.answer })),
    );
    writeFileSync(file, JSON.stringify(log, null, 1));
    for (const q of r.old) await api("DELETE", `hueb-seo-faq-questions/${q.id}`);
    for (const [i, x] of r.questions.entries()) {
      const id = newId();
      await api("POST", "hueb-seo-faq-questions", { id, group: r.groupId, name: "ID", active: true, questionPosition: i + 1, question: x.q, answer: x.a });
      log.createdFaqQuestions!.push(id);
      writeFileSync(file, JSON.stringify(log, null, 1));
    }
  }
  console.log(`FERTIG: ${slotUpdates.length} Slots, ${faqUpdates.length} FAQ, ${sectionCreates.length} neue Abschnitte, ${faqReplacements.length} FAQ-Gruppen aktualisiert`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
