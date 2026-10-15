/**
 * Raeumt die Landingpages der Hauptkategorien auf (User-Freigabe 15.10.2026, A/B/C):
 * A  loescht Agentur-Platzhalter, die nur fuer den Kanal "Headless" freigegeben sind (Lorem ipsum,
 *    CLIP-Kopien auf fremden Seiten, "noch kein Video verfuegbar") und Kacheln in Rasterzellen, die es
 *    in der Raster-Konfiguration nicht gibt (werden nie angezeigt)
 * B  repariert sichtbare Reste (verwaiste Ueberschrift, geleerte Textbloecke, Kachel-Links, FAQ-Ueberschrift) und
 *    unplausible Altinhalte (Zubehoer, das es nicht gibt; Verweis auf fehlende Tabellen; CLIP-Hinweise auf fremden Seiten)
 * C  blendet echten Inhalt ein (Kragarm: Montagevideo, Planmasse/Sicherheit;
 *    Weitspann: Planmasse/Sicherheit) und ordnet die Abschnitte: Links + Topseller nach oben,
 *    SEO-Text/FAQ/Beratung ans Ende
 * Abschnitte werden ueber ihren Inhalt erkannt, nicht ueber Positionen. Geloeschtes wird vollstaendig
 * im Protokoll gesichert; --revert legt es mit denselben IDs wieder an.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/cleanLandingPages.ts <tenantId> [--only key,key] [--apply]
 *   NODE_ENV=development npx tsx scripts/cleanLandingPages.ts <tenantId> --revert <protokoll.json>
 */
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { LANDING_PAGES } from "../server/products/landingPageTexts";

const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";
const SEO_MARKER = "metaorder-landing-seo";

type Rules = {
  /** Nur-Headless-Abschnitte, deren Text hierauf passt, werden geloescht */
  deleteHidden?: RegExp[];
  /** Sichtbare Abschnitte, die geloescht werden (nur wenn der ganze Text passt) */
  deleteVisibleExact?: RegExp[];
  /** Nur-Headless-Abschnitte, die eingeblendet werden */
  unhide?: RegExp[];
  /** Kachel-Links setzen: Kacheltext -> URL */
  tileLinks?: Record<string, string>;
  /** In Kachel-Links entfernen */
  tileUrlStrip?: RegExp;
  /** Textblock, dessen ganzer Text passt, bekommt neues HTML */
  replaceText?: Array<{ match: RegExp; html: string }>;
  /** Plausibilitaet (User 15.10.2026): Ersetzungen im HTML sichtbarer Textbloecke */
  htmlReplace?: Array<{ find: RegExp; replace: string; note: string }>;
  /** Plausibilitaet: sichtbare Textbloecke loeschen, deren ganzer Text passt */
  deleteBlockText?: Array<{ match: RegExp; note: string }>;
  /** Abschnitte neu ordnen (Links + Topseller nach den Kacheln, SEO-Text/FAQ ans Ende) */
  reorder?: boolean;
};

const RULES: Record<string, Rules> = {
  fachboden: {
    tileUrlStrip: /(order=name-asc&|p=1&)/g,
    htmlReplace: [
      { find: /Rückwandgitter/g, replace: "Rückwände", note: "kein Rückwandgitter im Sortiment, nur Rückwände" },
      {
        find: /Das <font color="#ff0002"><b>CLIP-Fachbodenregal<\/b><\/font>-System zeichnet sich durch seine besondere Flexibilität aus\. Alle Regale mit gleicher Fachtiefe sind kombinierbar und durch Zubehör wie Schüttgutmulden, Rückwände, Seitenwände,/,
        replace: 'Das <font color="#ff0002"><b>META CLIP</b></font> Fachbodenregalsystem besteht aus nur zwei Systembausteinen – Rahmen und Fachböden – und wird ohne Werkzeug gesteckt. Mit Zubehör wie Schüttgutmulden, Rückwänden, Seitenwänden,',
        note: "Kopf: „alle Regale kombinierbar“ unbelegt, Katalog S. 19",
      },
      { find: /mit ihren Anforderungen/g, replace: "mit Ihren Anforderungen", note: "Tippfehler" },
    ],
    replaceText: [
      { match: /^FAQ$/, html: `<h2 class="fs-4 fw-bold mt-2 mb-0">Häufige Fragen</h2>` },
      {
        match: /^Informationen Regale mit dem Höhen-\/Tiefenverhältnis/,
        html: `<h3>Informationen</h3><ul><li>Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 mit Wand- oder Fußverankerung gegen Kippen sichern.</li><li>Fach-/Feldlasten gelten bei gleichmäßig verteilter Last.</li><li>Feldlastangaben gelten für Regalzeilen mit 3 und mehr Feldern.</li><li>Reifenregale und Regale mit Schubladen müssen immer mittels Fußverankerung gegen Kippen gesichert werden.</li><li>Nur für Handbedienung. Die Regale sind für eine reine Innenaufstellung konzipiert.</li></ul>`,
      },
    ],
  },
  paletten: {
    deleteHidden: [/Lorem ipsum/, /Längsriegeln/, /Diagonalverstrebung/, /Standard-Rahmenhöhe/, /Rahmeninnenmaß/],
    deleteVisibleExact: [/^Einseitig oder beidseitig bedienen$/],
    replaceText: [
      {
        // bisher CLIP-Regeln (3 Felder, 4 : 1); MULTIPAL laut Katalog S. 125/135
        match: /^Informationen Regale mit dem Höhen-\/Tiefenverhältnis/,
        html: `<h3>Informationen</h3><ul><li>Die Fach- und Feldlasten gelten bei gleichmäßig verteilter Last für Regalzeilen mit mindestens 4 Regalfeldern und mindestens 2 Holmpaaren; bei weniger als 4 Feldern werden die Belastungswerte abgemindert.</li><li>Palettenregale werden auf Beton der Mindestgüte C20/25 (ca. 200 mm stark) aufgestellt und zur Lage- und Kippsicherung mit Ankern fixiert.</li><li>Äußere Ständer im Eckbereich und an Durchfahrten sind mit Rammschutzecken gegen Anprall zu schützen.</li><li>Nicht zur Be- und Entladung vorgesehene Seiten müssen gegen Herabfallen von Lagergut gesichert sein.</li><li>Lastangaben dienen der Orientierung und ersetzen keine statische Auslegung im Einzelfall. Die Regale sind für eine reine Innenaufstellung konzipiert.</li></ul>`,
      },
    ],
  },
  kragarm: {
    deleteHidden: [/Lorem ipsum/],
    // Systemvergleich LIGHT/MEDIUM bleibt aus: weisse Schrift auf hellgrau, ATLAS/MULTISTRONG doppelt (Agentur)
    unhide: [/Montage META MULTISTRONG/, /Kragarmregale – Planmaße/, /Höhen-\/Tiefenverhältnis/],
    deleteBlockText: [{ match: /^Reifenregale und Regale mit Schubladen müssen immer mittels Fußverankerung gegen Kippen gesichert werden!$/, note: "CLIP-Hinweis, solche Regale gibt es hier nicht" }],
    reorder: true,
    htmlReplace: [{ find: /ideal zur (<b>)?liegenden Lagerung(<\/b>)? schwerer und langer Ware/g, replace: "für <b>liegende Langgutlagerung</b> sowie Tafel- und Plattenware", note: "Video-Text: ATLAS-Formulierung bei MULTISTRONG, Katalog S. 162" }],
    replaceText: [
      {
        // Kopf: „perfekte“, „für schweres Material“ (LIGHT/MEDIUM = leicht/mittel), Handbedienung ist eine Einschränkung
        match: /^META ATLAS ST und MULTISTRONG Kragarmregale Der perfekte Lagerplatz/,
        html: `<h1>META ATLAS ST und MULTISTRONG Kragarmregale</h1>\n<p>Für die liegende Lagerung von Langgut wie Rohren, Stangen und Profilen sowie von Tafel- und Plattenware. <b><font color="#ff0002">META MULTISTRONG</font></b> gibt es als LIGHT für leichte und als MEDIUM für mittlere Belastungen, mit eingesteckten, im 100-mm-Raster verstellbaren Kragarmen. <b><font color="#ff0002">META ATLAS ST</font></b> mit geschweißten Kragarmständern ist für leichte Belastungen ausgelegt.</p>`,
      },
      {
        match: /^Regale mit dem Höhen-\/Tiefenverhältnis ≥ 4 : 1 gegen Kippen sichern\. Kragarmbelastung/,
        html: `<ul><li>Wenn das Höhen-/Tiefenverhältnis über 4 : 1 liegt oder die betrieblichen Bedingungen es erfordern, sind Fußverankerungen zu verwenden.</li><li>Kragarmbelastung gilt bei gleichmäßig verteilter Last; die Fußlagerebene ist wie ein Kragarm belastbar.</li><li>Nur für Handbedienung. Die Regale sind für eine reine Innenaufstellung konzipiert.</li></ul>`,
      },
    ],
  },
  weitspann: {
    deleteHidden: [/Lorem ipsum/, /noch kein Video/, /^Grundregale Anbauregale Einzeilige Regale Doppelzeilige Regale$/],
    // "Einseitig oder beidseitig bedienen" bleibt aus: Abschnitt "grey-l" zeigt den Absatz weiss auf hellgrau
    unhide: [/SPEED-RACK und MINI-RACK – Planmaße/, /Höhen-\/Tiefenverhältnis/],
    deleteBlockText: [{ match: /^Reifenregale und Regale mit Schubladen müssen immer mittels Fußverankerung gegen Kippen gesichert werden!$/, note: "CLIP-Hinweis, solche Regale gibt es hier nicht" }],
    reorder: true,
    htmlReplace: [{ find: /an ihre Lageranforderungen/g, replace: "an Ihre Lageranforderungen", note: "Tippfehler" }],
    replaceText: [
      {
        match: /^Regale mit dem Höhen-\/Tiefenverhältnis ≥ 4 : 1 gegen Kippen sichern Fach-\/Feldlasten/,
        html: `<ul><li>Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 gegen Kippen sichern; beim META MINI-RACK werden pro Rahmen 2 Bodenanker benötigt.</li><li>Fach-/Feldlasten gelten bei gleichmäßig verteilter Last, beim META MINI-RACK ab Regalzeilen mit 4 und mehr Feldern.</li><li>Nur für Handbedienung. Die Regale sind für eine reine Innenaufstellung konzipiert.</li></ul>`,
      },
    ],
  },
  buero: {
    deleteHidden: [/COMPACT verzinkt Fest verschweißte/],
    tileLinks: { Grundregale: "/compact-grundregale", Anbauregale: "/compact-anbauregale" },
    htmlReplace: [
      { find: /<li>Feldlast: siehe Tabellen<\/li>/g, replace: "", note: "„siehe Tabellen“ – auf der Seite gibt es keine Tabellen" },
      { find: />Einzeilige Regale</g, replace: ">Einseitige Regale<", note: "COMPACT kennt ein-/doppelseitig, nicht ein-/doppelzeilig (Katalog S. 101)" },
      { find: />Doppelzeilige Regale</g, replace: ">Doppelseitige Regale<", note: "COMPACT kennt ein-/doppelseitig, nicht ein-/doppelzeilig (Katalog S. 101)" },
    ],
    deleteBlockText: [{ match: /^Reifenregale und Regale mit Schubladen müssen immer mittels Fußverankerung gegen Kippen gesichert werden!$/, note: "CLIP-Hinweis, solche Regale gibt es hier nicht" }],
    replaceText: [
      {
        match: /^META COMPACT Büroregale Das META COMPACT Regal ist das ideale Aktenregal/,
        html: `<h1>META COMPACT Büroregale</h1>\n<p>Das <font color="#ff0002"><b>META COMPACT</b></font> Büro-Steckregal für Büro, Meisterbüro und Archiv wird ohne Werkzeug gesteckt. Je nach Höhe und Länge fasst ein Regal mit 300 mm Tiefe 45 bis 105 Ordner – doppelseitig mit 600 mm Tiefe doppelt so viele.</p>`,
      },
      {
        // von CLIP kopiert („durchlagern … Langgut“, Spannschlösser) – COMPACT laut Katalog S. 100/101
        match: /^Regale mit Längsriegeln/,
        html: `<h2>Regale mit Längsriegeln – doppelseitig bedienbar</h2><ul><li>doppelseitige Regale werden durch Längsriegel ausgesteift</li><li>Fachböden mit End- und Mittelanschlag, im 25-mm-Raster höhenverstellbar</li><li>Steckmontage ohne Werkzeug</li></ul>`,
      },
      {
        match: /^Regale mit Diagonalverstrebung/,
        html: `<h2>Regale mit Diagonalverstrebung – einseitig bedienbar</h2><ul><li>einseitige Regale werden durch Diagonalstreben an der Rückseite ausgesteift</li><li>zur Aufstellung an Wänden – das einseitige Regal muss gegen Kippen gesichert werden</li><li>Fachböden im 25-mm-Raster höhenverstellbar</li></ul>`,
      },
      {
        match: /^Regale mit dem Höhen-\/Tiefenverhältnis ≥ 4 : 1 gegen Kippen sichern Fach-\/Feldlasten gelten bei gleichmäßig verteilter Last\. Feldlastangaben/,
        html: `<ul><li>Das einseitige Regal muss gegen Kippen gesichert werden, da die Regalhöhe mehr als das 4-Fache der Regaltiefe beträgt – zum Beispiel mit Wandbefestigung oder Fußverdübelung.</li><li>Fach-/Feldlasten gelten bei gleichmäßig verteilter Last und mindestens 3 Feldern.</li><li>Nur für Handbedienung. Die Regale sind für eine reine Innenaufstellung konzipiert.</li></ul>`,
      },
    ],
  },
};

type Protocol = {
  tenantId: string;
  at: string;
  deletedSections: any[];
  deletedBlocks: any[];
  slots: Array<{ id: string; config: unknown }>;
  sections: Array<{ id: string; position: number; customFields: unknown }>;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const isHeadlessOnly = (sec: any) => (sec.customFields?.moorl_section_config?.salesChannel ?? []).length > 0;
const blocksOf = (sec: any) => [...(sec.blocks ?? [])].sort((a: any, b: any) => a.position - b.position);
const sectionText = (sec: any) =>
  blocksOf(sec)
    .flatMap((b: any) => b.slots ?? [])
    .filter((s: any) => s.type === "text")
    .map((s: any) => plain(String(s.config?.content?.value ?? "")))
    .filter(Boolean)
    .join(" ");

// Nur schreibbare Felder (fuer die Wiederherstellung mit denselben IDs)
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
const SLOT_KEYS = ["id", "type", "slot", "config", "locked"];
const BLOCK_KEYS = ["id", "sectionId", "type", "position", "sectionPosition", "name", "marginTop", "marginBottom", "marginLeft", "marginRight", "backgroundColor", "backgroundMediaId", "backgroundMediaMode", "cssClass", "visibility", "customFields", "locked"];
const SECTION_KEYS = ["id", "pageId", "type", "position", "name", "sizingMode", "mobileBehavior", "backgroundColor", "backgroundMediaId", "backgroundMediaMode", "cssClass", "visibility", "customFields", "locked"];
const blockData = (b: any) => ({ ...pick(b, BLOCK_KEYS), slots: (b.slots ?? []).map((s: any) => pick(s, SLOT_KEYS)) });
const sectionData = (s: any) => ({ ...pick(s, SECTION_KEYS), blocks: blocksOf(s).map((b: any) => { const { sectionId: _drop, ...rest } = blockData(b); return rest; }) });

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/cleanLandingPages.ts <tenantId> [--only key,key] [--apply] | --revert <protokoll.json>");
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
    for (const s of log.deletedSections) await api("POST", "cms-section", s);
    for (const b of log.deletedBlocks) await api("POST", "cms-block", b);
    for (const s of log.slots) await api("PATCH", `cms-slot/${s.id}`, { config: s.config });
    for (const s of log.sections) await api("PATCH", `cms-section/${s.id}`, { position: s.position, customFields: s.customFields });
    console.log(`Zurückgebaut: ${log.deletedSections.length} Abschnitte, ${log.deletedBlocks.length} Blöcke, ${log.slots.length} Slots, ${log.sections.length} Abschnitts-Einstellungen`);
    return;
  }

  const apply = process.argv.includes("--apply");
  const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const log: Protocol = { tenantId, at: new Date().toISOString(), deletedSections: [], deletedBlocks: [], slots: [], sections: [] };
  const ops: Array<{ what: string; run: () => Promise<void> }> = [];

  for (const cfg of LANDING_PAGES) {
    const rules = RULES[cfg.key];
    if (!rules || (only.size && !only.has(cfg.key))) continue;
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
    const deleted = new Set<string>();
    const sectionChanges = new Map<string, { position?: number; customFields?: any }>();
    const setSlotConfig = (slot: any, config: any, what: string) => {
      log.slots.push({ id: slot.id, config: slot.config });
      ops.push({ what: `${cfg.key}: ${what}`, run: () => api("PATCH", `cms-slot/${slot.id}`, { config }) });
    };

    // A: Platzhalter loeschen
    for (const sec of sections) {
      const text = sectionText(sec);
      const hiddenHit = isHeadlessOnly(sec) && rules.deleteHidden?.some((re) => re.test(text));
      const visibleHit = !isHeadlessOnly(sec) && rules.deleteVisibleExact?.some((re) => re.test(text)) && blocksOf(sec).every((b: any) => b.slots.every((s: any) => s.type === "text"));
      if (!hiddenHit && !visibleHit) continue;
      deleted.add(sec.id);
      log.deletedSections.push(sectionData(sec));
      ops.push({ what: `${cfg.key}: Abschnitt ${sec.position} löschen (${hiddenHit ? "nur Headless" : "sichtbar, verwaist"}): „${text.slice(0, 60)}“`, run: () => api("DELETE", `cms-section/${sec.id}`) });
    }
    for (const sec of sections.filter((s: any) => !deleted.has(s.id))) {
      const cells = (sec.customFields?.moorl_section_grid_config ?? []).length;
      for (const b of blocksOf(sec)) {
        const cell = String(b.sectionPosition ?? "").match(/^moorl_grid_(\d+)$/);
        const orphanCell = sec.type === "moorl-grid" && cell && Number(cell[1]) >= cells;
        const emptyText = sectionText(sec).length > 0 && b.slots.length === 1 && b.slots[0].type === "text" && !plain(String(b.slots[0].config?.content?.value ?? "")) && blocksOf(sec).some((x: any) => x.slots.some((s: any) => String(s.config?.content?.value ?? "").includes(SEO_MARKER)));
        if (!orphanCell && !emptyText) continue;
        log.deletedBlocks.push({ ...blockData(b), sectionId: sec.id });
        const label = b.slots.map((s: any) => (s.type === "text" ? plain(String(s.config?.content?.value ?? "")) || "leer" : s.type)).join("/");
        ops.push({ what: `${cfg.key}: Block löschen (${orphanCell ? `Rasterzelle ${cell![1]} gibt es nicht` : "geleerter Textblock"}): ${label}`, run: () => api("DELETE", `cms-block/${b.id}`) });
      }
    }

    // B: sichtbare Reste reparieren
    for (const sec of sections.filter((s: any) => !deleted.has(s.id))) {
      const blocks = blocksOf(sec);
      blocks.forEach((b: any, i: number) => {
        for (const slot of b.slots ?? []) {
          if (slot.type === "image") {
            const tileText = plain(String(blocks[i + 1]?.slots?.[0]?.config?.content?.value ?? ""));
            const url = String(slot.config?.url?.value ?? "");
            const target = rules.tileLinks?.[tileText];
            if (target && url !== target) setSlotConfig(slot, { ...slot.config, url: { source: "static", value: target }, newTab: { source: "static", value: false } }, `Kachel „${tileText}“ → ${target}`);
            if (rules.tileUrlStrip && url && rules.tileUrlStrip.test(url)) {
              rules.tileUrlStrip.lastIndex = 0;
              const next = url.replace(rules.tileUrlStrip, "");
              setSlotConfig(slot, { ...slot.config, url: { ...slot.config.url, value: next } }, `Kachel „${tileText}“: ${url} → ${next}`);
            }
          }
          if (slot.type === "text") {
            const t = plain(String(slot.config?.content?.value ?? ""));
            const r = rules.replaceText?.find((x) => x.match.test(t));
            if (r && String(slot.config?.content?.value ?? "") !== r.html) setSlotConfig(slot, { ...slot.config, content: { source: "static", value: r.html } }, `Text „${t.slice(0, 50)}“ ersetzt`);
          }
        }
      });
    }

    // B (Plausibilitaet): HTML-Ersetzungen und unpassende Textbloecke – sichtbar oder gleich eingeblendet
    const willShow = (sec: any) => !isHeadlessOnly(sec) || rules.unhide?.some((re) => re.test(sectionText(sec)));
    for (const sec of sections.filter((x: any) => !deleted.has(x.id) && willShow(x))) {
      for (const b of blocksOf(sec)) {
        // Block loeschen nur bei reinen Textbloecken; Ersetzungen in jedem Text-Slot (auch Kopf mit Bild + Text)
        const only = b.slots?.length === 1 && b.slots[0].type === "text" ? b.slots[0] : null;
        const del = only ? rules.deleteBlockText?.find((r) => r.match.test(plain(String(only.config?.content?.value ?? "")))) : undefined;
        if (del && only) {
          const raw = String(only.config?.content?.value ?? "");
          log.deletedBlocks.push({ ...blockData(b), sectionId: sec.id });
          ops.push({ what: `${cfg.key}: Block löschen (${del.note}): „${plain(raw).slice(0, 50)}“`, run: () => api("DELETE", `cms-block/${b.id}`) });
          continue;
        }
        for (const slot of (b.slots ?? []).filter((x: any) => x.type === "text")) {
          const raw = String(slot.config?.content?.value ?? "");
          let next = raw;
          const notes: string[] = [];
          for (const r of rules.htmlReplace ?? []) {
            const replaced = next.replace(r.find, r.replace);
            if (replaced !== next) notes.push(r.note);
            next = replaced;
          }
          if (next !== raw && !log.slots.some((x) => x.id === slot.id)) setSlotConfig(slot, { ...slot.config, content: { ...slot.config.content, value: next } }, `Text korrigiert (${notes.join("; ")})`);
        }
      }
    }

    // C: einblenden
    for (const sec of sections.filter((s: any) => !deleted.has(s.id) && isHeadlessOnly(s))) {
      const text = sectionText(sec);
      if (!rules.unhide?.some((re) => re.test(text))) continue;
      const cf = sec.customFields ?? {};
      sectionChanges.set(sec.id, { customFields: { ...cf, moorl_section_config: { ...(cf.moorl_section_config ?? {}), salesChannel: [] } } });
      ops.push({ what: `${cfg.key}: Abschnitt ${sec.position} einblenden: „${text.slice(0, 60)}“`, run: async () => {} });
    }

    // C: ordnen – Kopf, Kennzahlen, Kacheln, Links, Topseller, Inhalte, SEO-Text/FAQ/Beratung, ausgeblendete
    if (rules.reorder) {
      const visible = (s: any) => !deleted.has(s.id) && (!isHeadlessOnly(s) || sectionChanges.has(s.id));
      const marker = `metaorder-landing-${cfg.key}`;
      const html = (s: any) => blocksOf(s).flatMap((b: any) => b.slots).map((x: any) => String(x.config?.content?.value ?? "")).join(" ");
      const links = sections.find((s: any) => html(s).includes(marker));
      const seo = sections.find((s: any) => html(s).includes(SEO_MARKER));
      const slider = sections.find((s: any) => links && seo && s.position > links.position && s.position < seo.position && blocksOf(s).every((b: any) => b.type === "product-slider"));
      if (links && seo && slider) {
        const ours = new Set([links.id, slider.id, seo.id]);
        const old = sections.filter((s: any) => visible(s) && !ours.has(s.id));
        const head = old.filter((s: any) => s.position <= 1 || /Regaltypen und Varianten|^Grundregale Anbauregale/.test(sectionText(s)));
        const rest = old.filter((s: any) => !head.includes(s));
        const hidden = sections.filter((s: any) => !deleted.has(s.id) && !visible(s));
        const order = [...head, links, slider, ...rest, seo, ...hidden];
        let moved = false;
        order.forEach((s: any, i: number) => {
          if (s.position === i) return;
          moved = true;
          sectionChanges.set(s.id, { ...(sectionChanges.get(s.id) ?? {}), position: i });
        });
        if (moved) ops.push({ what: `${cfg.key}: Reihenfolge ${order.map((s: any) => `„${sectionText(s).slice(0, 18) || blocksOf(s)[0]?.type}“`).join(" → ")}`, run: async () => {} });
      } else console.log(`  ${cfg.key}: eigene Abschnitte nicht gefunden – Reihenfolge bleibt`);
    }
    for (const [id, change] of sectionChanges) {
      const sec = sections.find((s: any) => s.id === id);
      log.sections.push({ id, position: sec.position, customFields: sec.customFields ?? null });
      ops.push({ what: "", run: () => api("PATCH", `cms-section/${id}`, change) });
    }
  }

  for (const o of ops.filter((x) => x.what)) console.log(`${apply ? "AUSFÜHREN" : "würde"} ${o.what}`);
  if (!apply || ops.length === 0) return;
  const file = `/app/tmp-claude/landing-aufraeumen-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(log, null, 1));
  console.log(`Protokoll: ${file}`);
  for (const o of ops) await o.run();
  console.log(`FERTIG: ${log.deletedSections.length} Abschnitte und ${log.deletedBlocks.length} Blöcke gelöscht, ${log.slots.length} Slots, ${log.sections.length} Abschnitte geändert`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
