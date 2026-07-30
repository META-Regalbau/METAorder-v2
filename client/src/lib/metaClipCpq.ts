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

export type Surface = "verzinkt" | "lackiert";

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
  rear: boolean; // Rückwand
  view: number; // 0 perspective, 1 front, 2 top
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
  rear: false,
  view: 0,
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

export function toCpqCoreInput(s: MetaClipState): CpqCoreInput {
  const coated = s.surface === "lackiert";
  return {
    systemVariant: "clip",
    connectionType: "clinch",
    frame: {
      heightMm: s.hoehe,
      depthMm: s.tiefe,
      widthMm: s.breite,
      surface: s.surface,
      maxFeldlastKg: 2400,
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

/** Overall bay length (mm): bays × width + (bays+1) frame posts (≈40mm each). */
export function overallLength(s: MetaClipState): number {
  return s.felder * s.breite + (s.felder + 1) * 40;
}

/** Stable configuration code, e.g. CLIP-2500-1000-500-2F5-230-V-NR. */
export function buildConfigCode(s: MetaClipState): string {
  return [
    "CLIP",
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
