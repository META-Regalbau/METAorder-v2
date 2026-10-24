/**
 * Schreibt freigegebene ALT-Texte (Blatt "Medien") und Linktexte von Bildkacheln (Blatt "Linktexte")
 * aus der Excel von exportCmsImageTexts.ts in den Shop. Nur Systemsprache (Deutsch).
 * Geschrieben wird nur, was vom Shop-Stand abweicht: ein zweiter Lauf aendert nichts.
 *
 * Ohne --apply nur Testlauf. Mit --apply vorher Protokoll mit allen bisherigen Werten; --revert stellt
 * daraus alles wieder her. Schreibt nur in Shops mit "test." in der URL, ausser mit --live.
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeCmsImageTexts.ts <tenantId> <cms-bildtexte.xlsx> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeCmsImageTexts.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { readFileSync, writeFileSync } from "fs";
import XLSXmod from "xlsx";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware/shopware";
import { planCmsImageTexts, revertCmsImageTexts, type CmsImageTextsProtocol, type MediaTextRow, type SlotLabelRow } from "../server/products/cmsImageTexts";
import type { MediaTexts } from "../server/shopware/client/media";

const XLSX: any = (XLSXmod as any).readFile ? XLSXmod : (XLSXmod as any).default;
const DE_LANG = "2fbb5fe2e29a4d70aa5854ce7ce3e20b";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/writeCmsImageTexts.ts <tenantId> <cms-bildtexte.xlsx> [--apply] [--live] | --revert <protokoll.json>");
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
  const isTest = /\/\/test\./.test(base);
  const guard = () => {
    if (!isTest && !process.argv.includes("--live")) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  };

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as CmsImageTextsProtocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    guard();
    const back = revertCmsImageTexts(log);
    for (const m of back.mediaUpdates) await api("PATCH", `media/${m.id}`, { alt: m.alt, title: m.title, customFields: m.customFields });
    for (const s of back.slotUpdates) await api("PATCH", `cms-slot/${s.id}`, { config: s.config });
    console.log(`Zurückgebaut: ${back.mediaUpdates.length} Bilder, ${back.slotUpdates.length} Linktexte`);
    return;
  }

  const xlsx = process.argv[3];
  if (!xlsx?.endsWith(".xlsx")) throw new Error("Excel fehlt");
  const apply = process.argv.includes("--apply");
  const book = XLSX.readFile(xlsx);
  const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const mediaRows: MediaTextRow[] = (XLSX.utils.sheet_to_json(book.Sheets["Medien"]) as any[])
    .filter((r) => text(r["ALT neu"]).trim())
    .map((r) => ({ mediaId: text(r["Medien-ID"]).trim(), alt: text(r["ALT neu"]), title: text(r["TITLE neu"]) || null }));
  const slotRows: SlotLabelRow[] = (XLSX.utils.sheet_to_json(book.Sheets["Linktexte"]) as any[])
    .filter((r) => text(r["Linktext neu"]).trim())
    .map((r) => ({ slotId: text(r["Slot-ID"]).trim(), ariaLabel: text(r["Linktext neu"]) }));

  const media: MediaTexts[] = mediaRows.length
    ? (await api("POST", "search/media", { ids: mediaRows.map((r) => r.mediaId), limit: mediaRows.length, includes: { media: ["id", "fileName", "alt", "title", "customFields"] } })).data.map((m: any) => ({
        id: m.id,
        fileName: String(m.fileName ?? ""),
        alt: m.alt ?? null,
        title: m.title ?? null,
        customFields: m.customFields && typeof m.customFields === "object" ? m.customFields : null,
      }))
    : [];
  const slots = slotRows.length ? (await api("POST", "search/cms-slot", { ids: slotRows.map((r) => r.slotId), limit: slotRows.length, includes: { cms_slot: ["id", "config"] } })).data : [];
  const plan = planCmsImageTexts(mediaRows, slotRows, media, slots);

  const before = new Map(media.map((m) => [m.id, m]));
  for (const u of plan.mediaUpdates) console.log(`${apply ? "SCHREIBE" : "würde schreiben"} Bild ${u.id.slice(0, 8)} ${before.get(u.id)?.fileName}: „${before.get(u.id)?.alt ?? ""}“ → „${u.alt}“${u.title ? " (+ TITLE)" : ""}`);
  for (const u of plan.slotUpdates) console.log(`${apply ? "SCHREIBE" : "würde schreiben"} Linktext ${u.id.slice(0, 8)}: „${u.config.ariaLabel.value}“`);
  for (const m of plan.missing) console.log(`FEHLT im Shop: ${m}`);
  console.log(`${plan.mediaUpdates.length} Bilder, ${plan.slotUpdates.length} Linktexte zu ändern, ${plan.unchanged} schon aktuell`);
  if (!apply || plan.mediaUpdates.length + plan.slotUpdates.length === 0) return;
  guard();

  const log: CmsImageTextsProtocol = { tenantId, at: new Date().toISOString(), ...plan.previous };
  const file = `${xlsx}.protokoll-${tenantId.slice(0, 8)}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(log, null, 1));
  console.log(`Protokoll: ${file}`);
  for (const u of plan.mediaUpdates) await api("PATCH", `media/${u.id}`, u);
  for (const u of plan.slotUpdates) await api("PATCH", `cms-slot/${u.id}`, { config: u.config });
  console.log(`FERTIG: ${plan.mediaUpdates.length} Bilder, ${plan.slotUpdates.length} Linktexte`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
