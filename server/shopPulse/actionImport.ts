/**
 * Shop-Puls Stufe 2 (S2-1): einmaliger Import der Live-Protokolle der Schreibskripte (scripts/write*.ts,
 * Dateien `<Lauf>-Protokoll-Live-<Zeitpunkt>[-<Zusatz>].json` im Arbeitsverzeichnis) ins Maßnahmen-Protokoll.
 * Die Dateien liegen nur lokal; sie kommen per Upload auf der Seite (POST /api/shop-pulse/actions/import).
 * Rein, ohne Datenbank; Tests in tests/unit/shopPulseActions.test.ts.
 *
 * - Zeitpunkt: `at` aus dem Inhalt, sonst aus dem Dateinamen (UTC wie in den Skripten); ohne beides kein Import
 * - nur Live-Protokolle, nur vom eigenen Mandanten (tenantId bzw. tenant im Inhalt)
 * - Schlüssel import:<Dateiname ohne .json>: ein zweiter Upload derselben Datei legt nichts doppelt an
 * - Titel und Bereich je Lauf aus der festen Liste unten, was der Inhalt hergibt (Anzahl, neu/aktualisiert,
 *   Kanal, betroffene Branchenseiten); unbekannte Läufe mit ihrem Namen und „ganzer Shop“
 */
import { normalizeActionScope, type ShopPulseActionScope, type ShopPulseImportSkip } from "@shared/shopPulseWeekly";
import { INDUSTRY_PAGES } from "../products/industryPages";
import { industryEntityId } from "../shopContent/shopEntityIds";
import type { ActionCandidate } from "./actionLog";

const FILE_RE = /^(.+?)-Protokoll-(Live|Testing)-(\d{4}-\d{2}-\d{2})(?:T(\d{2})-(\d{2}))?(?:-(.+))?\.json$/i;

type Protocol = Record<string, unknown>;
type Entry = { title: string; description: (p: Protocol) => string; scope: (p: Protocol) => ShopPulseActionScope };

const SHOP: ShopPulseActionScope = { type: "shop", values: [] };
const pages = (...values: string[]) => () => normalizeActionScope({ type: "pages", values });
const list = (v: unknown) => (Array.isArray(v) ? v : []);
const count = (v: unknown) => list(v).length;
/** Storefront-Baustein (DneCustomCssJs): before null = neu angelegt */
const snippetState = (p: Protocol) => (p.before == null ? "Eintrag neu angelegt" : "Eintrag aktualisiert");

/** Adressen der Branchenseiten, deren Landingpage im Protokoll steht (feste IDs je Branche) */
function industryUrls(p: Protocol): string[] {
  const ids = new Set(list(p.landingPages).map(String));
  return INDUSTRY_PAGES.filter((page) => ids.has(industryEntityId(page.key, "lp"))).map((page) => page.url);
}
const ALL_INDUSTRY_URLS = INDUSTRY_PAGES.map((p) => p.url);

/** Bekannte Läufe (Dateiname bis „-Protokoll“), Texte aus den Köpfen der Schreibskripte */
const CATALOG: Record<string, Entry> = {
  "auch-erhaeltlich": {
    title: "„Auch erhältlich in“ auf den Produktseiten",
    description: (p) => `Storefront-Baustein: dasselbe Regal in anderer Höhe, Tiefe oder Farbe als Auswahl über den Vorteilen (${snippetState(p)}).`,
    scope: () => SHOP,
  },
  "branchen-startseite": {
    title: "Startseiten-Teaser „Regale für Ihre Branche“",
    description: () => "Eigener Abschnitt auf der Startseite (nur Kanal META Regalbau DE).",
    scope: pages("/"),
  },
  branchenseiten: {
    title: "Branchen-Landingpages",
    description: (p) => {
      const urls = industryUrls(p);
      const faq = p.commonFaq ? " Gemeinsame FAQ-Gruppe „Sicherheit und Regalprüfung“." : "";
      return `${urls.length || count(p.landingPages)} Branchenseite(n) angelegt bzw. ersetzt${urls.length ? `: ${urls.join(", ")}` : ""}.${faq}`;
    },
    scope: (p) => {
      const urls = industryUrls(p);
      return normalizeActionScope({ type: "pages", values: [...(urls.length ? urls : ALL_INDUSTRY_URLS), ...(p.commonFaq ? ["/faq"] : [])] });
    },
  },
  "cms-bildtexte": {
    title: "ALT-Texte der CMS-Bilder und Linktexte der Kacheln",
    description: (p) => `${count(p.media)} Bild(er) mit ALT/TITLE, ${count(p.slots)} Kachel(n) mit Linktext.`,
    scope: () => SHOP,
  },
  "checkout-newsletter": {
    title: "Text der Newsletter-Checkbox im Checkout",
    description: (p) => `Textbaustein im deutschen Set (Brevo-Plugin), ${p.before == null ? "neu angelegt" : "geändert"}.`,
    scope: pages("/checkout/confirm"),
  },
  "exit-intent-aktion": {
    title: "Aktion „Newsletter-Willkommensrabatt“ (Code WILLKOMMEN10)",
    description: () => "Aktion mit 10 % auf die erste Bestellung und Regel „Noch keine Bestellung“ angelegt.",
    scope: () => SHOP,
  },
  "exit-intent": {
    title: "Exit-Intent-Newsletter-Modal",
    description: (p) => `Storefront-Baustein: Newsletter-Modal mit Willkommensrabatt beim Verlassen der Seite (${snippetState(p)}).`,
    scope: () => SHOP,
  },
  kartenzahlung: {
    title: "Kartenzahlung umgestellt",
    description: (p) => (typeof p.purpose === "string" && p.purpose.trim() ? p.purpose.trim() : "Zahlarten des Kanals geändert."),
    scope: (p) => {
      const channel = (p.before as Protocol | undefined)?.channel ?? (p.after as Protocol | undefined)?.channel;
      return typeof channel === "string" && channel ? normalizeActionScope({ type: "channel", values: [channel] }) : SHOP;
    },
  },
  "kategorie-layout": {
    title: "Layout der Kategorieseiten",
    description: (p) => `${count(p.blocks)} Block/Blöcke im Kategorie-Layout, Position von Produktliste und Filter geändert.`,
    scope: () => SHOP,
  },
  "regal-lexikon-faq": {
    title: "FAQ-Korrekturen auf /faq",
    description: (p) => `${count(p.faq)} Frage(n) der Agentur-FAQ korrigiert.`,
    scope: pages("/faq"),
  },
  "regal-lexikon-menue": {
    title: "Menüpunkt „Regal-Lexikon“ in der Hauptnavigation",
    description: () => "Link auf /regal-lexikon in der Hauptnavigation (geteilt von mehreren Kanälen).",
    scope: () => SHOP,
  },
  "regal-lexikon-seite": {
    title: "Seite /regal-lexikon",
    description: (p) => ((p.page as Protocol | undefined)?.replaced ? "Erlebniswelt ersetzt." : "Erlebniswelt angelegt."),
    scope: pages("/regal-lexikon"),
  },
  schnellkonfigurator: {
    title: "Regal-Schnellkonfigurator (Storefront-Baustein)",
    description: (p) => `Formular auf /regal-schnellkonfigurator, Startseite, Regalarten und Produktseiten (${snippetState(p)}).`,
    scope: () => SHOP,
  },
  "schnellkonfigurator-seite": {
    title: "Seite /regal-schnellkonfigurator",
    description: () => "Erlebniswelt und Artikeltabelle des Schnellkonfigurators geschrieben.",
    scope: pages("/regal-schnellkonfigurator"),
  },
  "schnellkonfigurator-startseite": {
    title: "Schnellkonfigurator auf der Startseite",
    description: (p) => ((p.home as Protocol | undefined)?.replaced ? "Startseiten-Abschnitt ersetzt." : "Startseiten-Abschnitt angelegt."),
    scope: pages("/"),
  },
  "startseite-rabatt-mondu": {
    title: "Startseiten-Abschnitte „Rabattstaffel“ und „B2B-Zahlung (Mondu)“",
    description: (p) => `${count(p.homeSlots)} Abschnitt(e) der Startseite im Design der Branchenseiten.`,
    scope: pages("/"),
  },
  suchseite: {
    title: "Suchergebnisseite",
    description: (p) => `Storefront-Baustein: Themen-Hinweis, gekürzte Filter, Hilfe bei 0 Treffern (${snippetState(p)}).`,
    scope: pages("/search"),
  },
  "warenkorb-crossselling": {
    title: "„Das passt dazu“ im Warenkorb",
    description: (p) => `Storefront-Baustein für Mini-Warenkorb und Warenkorbseite (${snippetState(p)}).`,
    scope: pages("/checkout/cart"),
  },
};

export type ImportFile = { name: string; content: string };
export type ImportParse = { candidate: ActionCandidate } | { skip: ShopPulseImportSkip };

/** Eine Protokoll-Datei → Eintrag fürs Maßnahmen-Protokoll; tenantId = Mandant, in den importiert wird */
export function parseLiveProtocol(file: ImportFile, tenantId: string | null): ImportParse {
  const name = file.name.split(/[\\/]/).pop()!.trim();
  const m = FILE_RE.exec(name);
  if (!m || m[2].toLowerCase() !== "live") return { skip: "notLive" };
  let p: Protocol;
  try {
    const parsed = JSON.parse(file.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { skip: "invalidJson" };
    p = parsed as Protocol;
  } catch {
    return { skip: "invalidJson" };
  }
  const fileTenant = typeof p.tenantId === "string" ? p.tenantId : typeof p.tenant === "string" ? p.tenant : null;
  if (fileTenant && tenantId && fileTenant !== tenantId) return { skip: "otherTenant" };

  const [, run, , day, hh, mm, extra] = m;
  const fromContent = typeof p.at === "string" && !Number.isNaN(Date.parse(p.at)) ? new Date(p.at) : null;
  const fromName = hh ? new Date(`${day}T${hh}:${mm}:00Z`) : new Date(`${day}T12:00:00Z`);
  const at = fromContent ?? (Number.isNaN(fromName.getTime()) ? null : fromName);
  if (!at) return { skip: "noTime" };

  const entry = CATALOG[run.toLowerCase()];
  const label = extra && !/^original$/i.test(extra) ? ` (${extra.replace(/-/g, " ")})` : "";
  const base = name.replace(/\.json$/i, "");
  const timeNote = fromContent || hh ? "" : " Uhrzeit unbekannt.";
  return {
    candidate: {
      occurredAt: at.toISOString(),
      kind: "liveRun",
      title: `${entry?.title ?? `Live-Schreiblauf ${run.replace(/-/g, " ")}`}${label}`,
      description: `${entry ? entry.description(p) : "Live-Schreiblauf aus METAorder."}${timeNote}\nProtokoll: ${name}`,
      scope: entry ? entry.scope(p) : SHOP,
      source: "import",
      sourceKey: `import:${base}`,
      actor: null,
    },
  };
}
