/**
 * META CLIP configurator — adapter layer.
 *
 * One UI state (the six controls + surface/rear) is translated into the two
 * backend engine shapes:
 *   - cpq ConfigContext          → /api/cpq/systems/:id/options + /bill-of-materials
 *                                  (real Shopware-priced BOM, dimension/load/surface match)
 *   - cpq-core CpqConfigurationInput → /api/cpq-core/validate + /price
 *                                  (META CLIP rules, A/B/C classification, Fachlast/Feldlast)
 *
 * Keeping the mapping here (pure functions) means the page component stays a
 * thin view over whichever engine answers.
 */

import { FRAME_POST_WIDTH_MM } from "@shared/metaClipGeometry";

// Weitergereicht, damit Konfigurator-Code nur ein Modul kennen muss.
export { FRAME_POST_WIDTH_MM };

export type Surface = "verzinkt" | "lackiert";
/** Rahmenart: vormontierter Ständerrahmen (clinch) oder Steckrahmen S3 zum Selbstaufbau. */
export type FrameVariant = "clinch" | "s3";

export type MetaClipState = {
  lang: "de" | "en";
  mode: "slider" | "chips";
  felder: number; // bays (field_count)
  hoehe: number; // frame height mm
  breite: number; // bay width mm
  tiefe: number; // frame/bay depth mm
  boeden: number; // shelves per bay (level_count)
  last: number; // shelf load kg (Fachlast)
  surface: Surface;
  rahmen: FrameVariant;
  rear: boolean; // Rückwand
  view: number; // 0 perspective, 1 front, 2 top
  showDims: boolean; // Bemaßung in Zeichnung und 3D-Ansicht einblenden
};

export const DEFAULT_STATE: MetaClipState = {
  lang: "de",
  mode: "slider",
  felder: 2,
  hoehe: 2500,
  breite: 1000,
  tiefe: 500,
  boeden: 5,
  last: 230,
  surface: "verzinkt",
  rahmen: "clinch",
  rear: false,
  view: 0,
  showDims: true,
};

/** Server-provided option lists (from GET /systems/:id/options → availableOptions). */
export type MetaClipOptions = {
  heights: number[];
  depths: number[];
  widths: number[];
  field_counts: number[];
  level_counts: number[];
  loads: number[];
  surfaces: string[];
};

/** Was der Katalog wirklich hergibt (GET /systems/:id/options → combinations, server/cpq/clipCatalogSync.ts). */
export type MetaClipCombinations = {
  frames: Array<{ variant: FrameVariant; height: number; depth: number; surface: string; feldlast: number | null }>;
  shelves: Array<{ width: number; depth: number; load: number; surface: string }>;
  rears: Array<{ height: number; width: number; surface: string }>;
  diagonals: number[];
};

/**
 * cpq-core's GEO-06 requires wall/floor anchoring whenever height:depth > 4:1
 * (tip-over safety). Both the priced BOM (verankerung_*_quantity below) and the
 * cpq-core payload (frame.anchoringIncluded) must agree on this so the rule is
 * satisfiable — otherwise the configuration is permanently blocked even though
 * real, priced anchor kits are included in the BOM whenever required.
 *
 * Real catalogue components (Fußverdübelung, floor-dowel — used more often in
 * practice than the wall-mount "Wandbefestigung" alternative, which isn't
 * wired in as a choice yet): one "Grundregal" kit for the starter bay, plus
 * one "Anbauregal" kit per additional bay (N fields → 1 + (N-1) kits) —
 * mirrors the same starter/add-on split as the frames themselves.
 */
export function needsAnchoring(s: MetaClipState): boolean {
  return s.hoehe / s.tiefe > 4;
}

/** N fields share N+1 frames (starter bay + shared add-on frames) — same formula the BOM itself uses. */
export function frameCount(s: MetaClipState): number {
  return s.felder + 1;
}

/** ConfigContext for the DB-backed cpq engine (options / configure / bill-of-materials). */
export type CpqConfigContext = Record<string, number | string | boolean | undefined> & {
  field_count: number;
  level_count: number;
  height: number;
  depth: number;
  width: number;
  load: number;
  surface: Surface;
  frame_variant: FrameVariant;
  accessory_quantity: number;
  verankerung_grund_quantity: number;
  verankerung_anbau_quantity: number;
  klemmfuss_quantity: number;
  abdeckkappe_quantity: number;
};

export function toConfigContext(s: MetaClipState): CpqConfigContext {
  const anchoring = needsAnchoring(s);
  // Klemmfuß and Abdeckkappe are sold as 10-piece sets (2 per frame → covers 5
  // frames each); one set per started block of 5 frames.
  const framePartSets = Math.ceil(frameCount(s) / 5);
  return {
    field_count: s.felder,
    level_count: s.boeden,
    height: s.hoehe,
    depth: s.tiefe,
    width: s.breite,
    load: s.last,
    surface: s.surface,
    frame_variant: s.rahmen,
    // One rear panel per bay when selected; 0 → accessory skipped in the BOM.
    accessory_quantity: s.rear ? s.felder : 0,
    klemmfuss_quantity: framePartSets,
    abdeckkappe_quantity: framePartSets,
    // Fußverdübelung, starter bay + one kit per additional bay; 0 → skipped in the BOM.
    verankerung_grund_quantity: anchoring ? 1 : 0,
    verankerung_anbau_quantity: anchoring ? Math.max(0, s.felder - 1) : 0,
  };
}

/** CpqConfigurationInput for the cpq-core rules/classification/load engine. */
export type CpqCoreInput = {
  systemVariant: string;
  connectionType: "clinch" | "s3";
  frame: {
    heightMm: number;
    depthMm: number;
    widthMm: number;
    surface?: string;
    maxFeldlastKg: number;
    anchoringIncluded: boolean;
  };
  shelves: Array<{
    material: string;
    maxFachlastKg: number;
    depthMm: number;
    widthMm: number;
    count: number;
    position: "regular" | "abdeckboden";
  }>;
  accessories: Array<{ accessoryType: string; count: number }>;
  surface: string;
  ralColor: string | null;
  quantity: number;
  deliveryCountry: string;
};

/** Feldlast ohne Katalogangabe (alte Mappings ohne feldlast): bisheriger fester Wert. */
export const FALLBACK_FELDLAST_KG = 2400;

export function toCpqCoreInput(s: MetaClipState, feldlastKg: number = FALLBACK_FELDLAST_KG): CpqCoreInput {
  const coated = s.surface === "lackiert";
  return {
    systemVariant: "clip",
    connectionType: s.rahmen,
    frame: {
      heightMm: s.hoehe,
      depthMm: s.tiefe,
      widthMm: s.breite,
      surface: s.surface,
      // Feldlast des Rahmens laut Grund-/Anbauregalen im Shop (feldlastFor), sonst der alte feste Wert
      maxFeldlastKg: feldlastKg,
      // True exactly when required — the BOM always includes the real anchor
      // kit in that case (see toConfigContext's verankerung_quantity), so this
      // reflects the actual configuration rather than blocking it unsatisfiably.
      anchoringIncluded: needsAnchoring(s),
    },
    shelves: [
      {
        material: "stahl",
        maxFachlastKg: s.last,
        depthMm: s.tiefe,
        widthMm: s.breite,
        count: s.boeden,
        position: "regular",
      },
    ],
    accessories: s.rear ? [{ accessoryType: "rueckwand", count: s.felder }] : [],
    surface: s.surface,
    // Standard RAL for coated (7035) → stays classification A/B; null for galvanised.
    ralColor: coated ? "7035" : null,
    quantity: 1,
    deliveryCountry: "DE",
  };
}

export const CPQ_CORE_CONTEXT = { customerGroup: "b2b_standard" as const };

/** Overall bay length (mm): bays × width + (bays+1) frame posts. */
export function overallLength(s: MetaClipState): number {
  return s.felder * s.breite + (s.felder + 1) * FRAME_POST_WIDTH_MM;
}

/** Stable configuration code, e.g. CLIP-2500-1000-500-2F5-230-V-NR. */
export function buildConfigCode(s: MetaClipState): string {
  return [
    s.rahmen === "s3" ? "CLIP-S3" : "CLIP",
    s.hoehe,
    s.breite,
    s.tiefe,
    `${s.felder}F${s.boeden}`,
    s.last,
    s.surface === "lackiert" ? "L" : "V",
    s.rear ? "RW" : "NR",
  ].join("-");
}

const LOCALE: Record<MetaClipState["lang"], string> = { de: "de-DE", en: "en-GB" };

export function formatNumber(n: number, lang: MetaClipState["lang"], digits = 0): string {
  return n.toLocaleString(LOCALE[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatMoney(n: number, lang: MetaClipState["lang"]): string {
  return `${formatNumber(n, lang, 2)} €`;
}

/** Clamp a chosen value to the nearest available option (keeps state valid when options load). */
export function nearest(value: number, options: number[]): number {
  if (!options.length) return value;
  if (options.includes(value)) return value;
  return options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), options[0]);
}

/**
 * True when the current dimensions match the one real, hand-measured GLB
 * assembly (width 1000mm, depth 500mm, height 2000/2500mm) — see
 * pages/metaClip/regalAssembly.ts. Kept dependency-free (no three.js import)
 * so checking it doesn't pull 3D libs into the eagerly-loaded page bundle.
 */
export function isRegalAssemblySupported(s: MetaClipState): boolean {
  return s.breite === 1000 && s.tiefe === 500 && (s.hoehe === 2000 || s.hoehe === 2500);
}

/** Reconcile state against freshly loaded server options (snap each dimension into range). */
export function reconcileWithOptions(s: MetaClipState, o: MetaClipOptions): MetaClipState {
  const surfaces = o.surfaces?.length ? o.surfaces : ["verzinkt"];
  const surface: Surface = surfaces.includes(s.surface) ? s.surface : (surfaces[0] as Surface) ?? "verzinkt";
  return {
    ...s,
    hoehe: nearest(s.hoehe, o.heights),
    tiefe: nearest(s.tiefe, o.depths),
    breite: nearest(s.breite, o.widths),
    last: nearest(s.last, o.loads),
    surface,
  };
}

// ---- Kombinationen aus dem Katalog ----

/** Eine baubare Regalzeile: Rahmen + Boden + Diagonalstab gibt es in dieser Kombination. */
export type MetaClipTuple = Pick<MetaClipState, "rahmen" | "hoehe" | "tiefe" | "breite" | "last" | "surface"> & { feldlast: number | null };
export type TupleKey = "rahmen" | "hoehe" | "tiefe" | "breite" | "last" | "surface";
const TUPLE_KEYS: TupleKey[] = ["rahmen", "hoehe", "tiefe", "breite", "last", "surface"];

export function buildTuples(c: MetaClipCombinations | null | undefined): MetaClipTuple[] {
  if (!c?.frames?.length || !c.shelves?.length) return [];
  const out: MetaClipTuple[] = [];
  for (const f of c.frames) {
    for (const sh of c.shelves) {
      if (sh.depth !== f.depth || sh.surface !== f.surface) continue;
      if (c.diagonals.length && !c.diagonals.includes(sh.width)) continue;
      out.push({ rahmen: f.variant, hoehe: f.height, tiefe: f.depth, breite: sh.width, last: sh.load, surface: f.surface as Surface, feldlast: f.feldlast });
    }
  }
  return out;
}

const matches = (t: MetaClipTuple, s: Partial<MetaClipState>, keys: TupleKey[]) => keys.every((k) => s[k] === undefined || t[k] === s[k]);

/** Ist der Wert für dieses Bedienelement mit den übrigen aktuellen Einstellungen baubar? */
export function isChoiceAvailable(s: MetaClipState, key: TupleKey, value: number | string, tuples: MetaClipTuple[]): boolean {
  if (!tuples.length) return true;
  const others = TUPLE_KEYS.filter((k) => k !== key);
  return tuples.some((t) => t[key] === value && matches(t, s, others));
}

/** Auswahlwerte je Bedienelement (alle, die es in irgendeiner Kombination gibt). */
export function choicesFor(key: TupleKey, tuples: MetaClipTuple[]): Array<number | string> {
  const values = [...new Set(tuples.map((t) => t[key]))];
  return typeof values[0] === "number" ? (values as number[]).sort((a, b) => a - b) : values;
}

// Was bei einem Sprung möglichst erhalten bleiben soll (höher = wichtiger)
const KEEP_WEIGHT: Record<TupleKey, number> = { rahmen: 50, surface: 40, hoehe: 30, tiefe: 30, breite: 20, last: 10 };

/**
 * Übernimmt die Änderung und rückt die übrigen Werte auf die nächste baubare Kombination
 * (z. B. 1500 mm Breite → Last 200 kg, weil es 1500er Böden nur mit 200 kg gibt).
 */
export function snapToCatalog(s: MetaClipState, change: Partial<MetaClipState>, tuples: MetaClipTuple[]): MetaClipState {
  const next = { ...s, ...change };
  if (!tuples.length) return next;
  const fixed = TUPLE_KEYS.filter((k) => change[k] !== undefined);
  const pool = tuples.filter((t) => matches(t, change, fixed));
  const candidates = pool.length ? pool : tuples;
  let best = candidates[0];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const t of candidates) {
    let cost = 0;
    for (const k of TUPLE_KEYS) {
      if (t[k] === next[k]) continue;
      const a = t[k], b = next[k];
      cost += KEEP_WEIGHT[k] + (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) / 100 : 0);
    }
    if (cost < bestCost) { bestCost = cost; best = t; }
  }
  return { ...next, rahmen: best.rahmen, hoehe: best.hoehe, tiefe: best.tiefe, breite: best.breite, last: best.last, surface: best.surface };
}

/** Feldlast der gewählten Rahmen (kg) laut Katalog, sonst null. */
export function feldlastFor(s: MetaClipState, tuples: MetaClipTuple[]): number | null {
  const t = tuples.find((x) => matches(x, s, TUPLE_KEYS));
  return t?.feldlast ?? null;
}

/** Gibt es eine Rückwand in Höhe × Feldbreite × Oberfläche? Ohne Katalogdaten (null) offen lassen. */
export function rearAvailable(s: MetaClipState, c: MetaClipCombinations | null): boolean {
  if (!c) return true;
  return c.rears.some((r) => r.height === s.hoehe && r.width === s.breite && r.surface === s.surface);
}

// ---- Konfigurations-Code lesen (AR-Seite, QR-Code) ----

const CONFIG_CODE_RE = /^CLIP(-S3)?-(\d{3,4})-(\d{3,4})-(\d{3})-(\d{1,2})F(\d{1,2})-(\d{2,4})-([LV])-(RW|NR)$/;

/** Gegenstück zu buildConfigCode; null bei unbekanntem oder unplausiblem Code. */
export function parseConfigCode(code: string | null | undefined): Pick<MetaClipState, "rahmen" | "hoehe" | "breite" | "tiefe" | "felder" | "boeden" | "last" | "surface" | "rear"> | null {
  const m = CONFIG_CODE_RE.exec((code ?? "").trim().toUpperCase());
  if (!m) return null;
  const s = {
    rahmen: (m[1] ? "s3" : "clinch") as FrameVariant,
    hoehe: Number(m[2]),
    breite: Number(m[3]),
    tiefe: Number(m[4]),
    felder: Number(m[5]),
    boeden: Number(m[6]),
    last: Number(m[7]),
    surface: (m[8] === "L" ? "lackiert" : "verzinkt") as Surface,
    rear: m[9] === "RW",
  };
  const ok = s.hoehe >= 1000 && s.hoehe <= 4000 && s.breite >= 500 && s.breite <= 2000 && s.tiefe >= 200
    && s.felder >= 1 && s.felder <= 20 && s.boeden >= 1 && s.boeden <= 20;
  return ok ? s : null;
}

/** Adresse der AR-Seite für eine Konfiguration (Knopf am Handy, QR-Code am Desktop). */
export function arPageUrl(origin: string, s: MetaClipState): string {
  return `${origin}/regalplaner/ar?rp=${encodeURIComponent(buildConfigCode(s))}&lang=${s.lang}`;
}
