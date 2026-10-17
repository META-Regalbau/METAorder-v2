// Feste Cross-Selling-Regeln aus den Artikelnamen (neues Namensschema "SYSTEM | Art | … | Maße | …").
// Exakte Zuordnungen ohne Statistik und KI, nur innerhalb desselben Systems (User-Entscheidung
// 15.10.2026; "L+M" gilt für L und M). Drei Tabs im Shop (User-Entscheidung 17.10.2026):
// - "Regal erweitern": Partnerregal (Anbau ↔ Grund) und Anbauregale aller Breiten bei gleicher
//   Höhe, Tiefe, Ausführung und Oberfläche (Fachlast darf abweichen, gleiche zuerst)
// - "Das passt dazu": Zusatzböden, Rückwände, Seitenwände, Zubehör mit Maß (Diagonalstab,
//   Fachteiler, Durchschubsicherung, Tiefenauflage, Sockelboden …) und freigegebenes
//   Standardzubehör je System
// - "Einzelteile": Ständer/Ständerrahmen, Fachböden, Holmebenen, Kragarme, Gitterrost/Paneele –
//   alle passenden Varianten, gleiche Oberfläche zuerst
// Vierter Tab "Auch erhältlich in" (User-Wunsch 17.10.2026): dasselbe Regal (gleiche Rolle und
// Breite) in anderer Höhe, Tiefe oder Farbe – je Wert ein Artikel, der sich nur darin unterscheidet
// (Fachlast und Ebenen dürfen abweichen, gleiche Fachlast zuerst). Im Shop zeigt
// shopware/storefront-snippets/product-variants.js den Tab als Auswahl über den Vorteilen an.

export type NameRuleProduct = { productNumber: string; name: string };

export type NameRuleKind =
  | "partner_shelf"
  | "other_width"
  | "board"
  | "back_wall"
  | "side_wall"
  | "accessory"
  | "system_accessory"
  | "frame"
  | "shelf_board"
  | "beam"
  | "arm"
  | "grating"
  | "other_height"
  | "other_depth"
  | "other_surface";

export type NameRuleTab = "extend" | "accessories" | "parts" | "variants";

/** Tab je Regelart. */
export const NAME_RULE_TAB: Record<NameRuleKind, NameRuleTab> = {
  partner_shelf: "extend",
  other_width: "extend",
  board: "accessories",
  system_accessory: "accessories",
  accessory: "accessories",
  back_wall: "accessories",
  side_wall: "accessories",
  frame: "parts",
  shelf_board: "parts",
  beam: "parts",
  arm: "parts",
  grating: "parts",
  other_height: "variants",
  other_depth: "variants",
  other_surface: "variants",
};

export type NameRulePair = {
  source: string;
  target: string;
  kind: NameRuleKind;
  tab: NameRuleTab;
  /** Reihenfolge innerhalb des Tabs (kleiner = weiter vorn) */
  rank: number;
};

const RANK: Record<NameRuleKind, number> = {
  partner_shelf: 0,
  other_width: 1,
  board: 0,
  system_accessory: 1,
  accessory: 2,
  back_wall: 3,
  side_wall: 4,
  frame: 0,
  shelf_board: 1,
  beam: 2,
  arm: 3,
  grating: 4,
  other_height: 0,
  other_depth: 1,
  other_surface: 2,
};

const SHELF_ROLES = ["Doppel-Anbauregal", "Doppel-Grundregal", "Anbauregal", "Grundregal"] as const;
type ShelfRole = (typeof SHELF_ROLES)[number];
const PARTNER_ROLE: Record<ShelfRole, ShelfRole> = {
  Anbauregal: "Grundregal",
  Grundregal: "Anbauregal",
  "Doppel-Anbauregal": "Doppel-Grundregal",
  "Doppel-Grundregal": "Doppel-Anbauregal",
};
/** Erweitert wird mit Anbauregalen (Doppel mit Doppel). */
const EXTEND_ROLE: Record<ShelfRole, ShelfRole> = {
  Anbauregal: "Anbauregal",
  Grundregal: "Anbauregal",
  "Doppel-Anbauregal": "Doppel-Anbauregal",
  "Doppel-Grundregal": "Doppel-Anbauregal",
};

export type ParsedName = {
  system: string;
  type: string;
  segments: string[];
  role: ShelfRole | null;
  /** Maße in mm in Namensreihenfolge (H x B x T bzw. B x T / H x B) */
  dims: number[];
  /** Einzelmaß "1825 mm" bzw. "für Regalbreite 1000 mm" */
  length: number | null;
  loadKg: number | null;
  surface: string | null;
  /** Bodenmaterial bei Weitspannregalen/Zusatzböden */
  boardMaterial: "spanplatte" | "stahlpaneel" | null;
  /** einseitig/doppelseitig (Kragarm) */
  sides: "einseitig" | "doppelseitig" | null;
};

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function toNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

const DIM_RE = /^(\d[\d.,]*)\s*x\s*(\d[\d.,]*)(?:\s*x\s*(\d[\d.,]*))?\s*mm$/i;
const LOAD_RE = /^(?:Fachlast|Armlast|Feldlast)?\s*(\d[\d.,]*)\s*kg$/i;

export function parseCatalogName(name: string): ParsedName | null {
  const normalized = normalizeName(name);
  if (!normalized.includes(" | ")) return null;
  // Trenner " | " wie bisher (Landingpages verlassen sich darauf, dass kaputte Angaben wie
  // "2800 kg| 3 Ebenen" als ein Segment herausfallen)
  const segments = normalized.split(" | ").map((s) => s.trim());
  if (segments.length < 3) return null;
  const role = (SHELF_ROLES.find((r) => segments.includes(r)) ?? null) as ShelfRole | null;
  let dims: number[] = [];
  for (const seg of segments) {
    const m = seg.match(DIM_RE);
    if (m) {
      dims = [m[1], m[2], m[3]].filter(Boolean).map((v) => toNumber(v as string));
      break;
    }
  }
  let length: number | null = null;
  for (const seg of segments.slice(1)) {
    // tolerant fuer fehlende Leerstelle vor dem Trenner ("750 mm| verzinkt")
    const m = seg.match(/^(?:für Regalbreite\s+)?(\d[\d.,]*)\s*mm(?:\s*\|.*)?$/i);
    if (m) {
      length = toNumber(m[1]);
      break;
    }
  }
  let loadKg: number | null = null;
  for (const seg of segments) {
    const m = seg.match(LOAD_RE);
    if (m) {
      loadKg = toNumber(m[1]);
      break;
    }
  }
  const surface =
    [...segments].reverse().find((s) => /^(verzinkt|feuerverzinkt|RAL \d{4}(?:\/[\w ]+)?|verzinkt\/RAL \d{4})$/i.test(s)) ?? null;
  const lower = normalized.toLowerCase();
  const boardMaterial = lower.includes("spanplatte") ? "spanplatte" : lower.includes("stahlpaneel") ? "stahlpaneel" : null;
  const sides = segments.includes("doppelseitig") ? "doppelseitig" : segments.includes("einseitig") ? "einseitig" : null;
  return {
    system: segments[0],
    type: segments[1],
    segments,
    role,
    dims,
    length,
    loadKg,
    surface: surface?.toLowerCase() ?? null,
    boardMaterial,
    sides,
  };
}

/** "META MULTISTRONG L+M" passt zu "META MULTISTRONG L" und "… M". */
function systemMatches(accessorySystem: string, shelfSystem: string): boolean {
  if (accessorySystem === shelfSystem) return true;
  const m = accessorySystem.match(/^(.*\S)\s+([A-Z](?:\+[A-Z])+)$/);
  if (!m) return false;
  const [, base, variants] = m;
  return variants.split("+").some((v) => `${base} ${v}` === shelfSystem);
}

const isBoard = (p: ParsedName) => /^(Zusatz-Fachboden|Zusatzboden\b|Zusatz-Drahtboden|Sockelboden)/i.test(p.type);
const isBackWall = (p: ParsedName) => /Rückwand$/i.test(p.type);
const isSideWall = (p: ParsedName) => /Seitenwand$/i.test(p.type);
const isFrame = (p: ParsedName) => /^(Ständerrahmen|Ständer$)/i.test(p.type);
const isShelfBoard = (p: ParsedName) => /^Fachboden\b/i.test(p.type) && !/ausziehbar/i.test(p.type);
const isGrating = (p: ParsedName) => /^(Gitterrostboden|Stahlpaneele$|Drahtboden$)/i.test(p.type);
const isBeam = (p: ParsedName) => /^Holmebene\b/i.test(p.type);
const isArm = (p: ParsedName) => /^Kragarm$/i.test(p.type);
const isDiagonal = (p: ParsedName) => /^Diagonalstab$/i.test(p.type);
const isDivider = (p: ParsedName) => /^Fachteiler\b/i.test(p.type);
const isPushThrough = (p: ParsedName) => /^Durchschubsicherung\b/i.test(p.type);
const isDepthSupport = (p: ParsedName) => /^Tiefenauflage\b/i.test(p.type);
const isMeshBackWall = (p: ParsedName) => /^Rückwandgitter$/i.test(p.type);
const isCrossBar = (p: ParsedName) => /^Längsriegel$/i.test(p.type);

/** Merkmale der Ausführung ohne Rolle, Maße, Last, Ebenen, Paletten, Felder – für "andere Breite". */
function shapeKey(n: ParsedName): string {
  return n.segments
    .slice(2)
    .filter((s) => !SHELF_ROLES.includes(s as ShelfRole))
    .filter((s) => !DIM_RE.test(s) && !LOAD_RE.test(s))
    .filter((s) => !/^\d+(\+\d+)?\s+(Ebenen|Paletten)$/i.test(s) && !/^\d+\s+Felder$/i.test(s))
    .join(" | ");
}

/** Wie shapeKey, aber ohne Oberfläche – für "Auch erhältlich in". */
function variantKey(n: ParsedName): string {
  const rest = shapeKey(n)
    .split(" | ")
    .filter((s) => !n.surface || s.toLowerCase() !== n.surface);
  return [n.system, n.type, n.role, n.dims[1], ...rest].join("||");
}

const levelsOf = (n: ParsedName) => n.segments.find((s) => /^\d+(\+\d+)?\s+Ebenen$/i.test(s)) ?? null;

/** Holmebene "Holmebene 2700 mm" → 2700 */
function beamWidth(n: ParsedName): number | null {
  const m = n.type.match(/(\d[\d.,]*)\s*mm/i);
  return m ? toNumber(m[1]) : null;
}

/** Fachlast aus dem Bodentyp "Fachboden MS230" → 230 */
function boardTypeLoad(n: ParsedName): number | null {
  const m = n.type.match(/MS\s?(\d+)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Rolle eines Artikels fuer die festen Regeln: Regal, Teil mit Mass-Regel (wird ueber Masse
 * zugeordnet) oder null (Zubehoer ohne Mass-Regel, z. B. Wandbefestigung, Abdeckkappe).
 */
export function nameRuleCategory(name: string): "shelf" | "dimensioned" | null {
  const n = parseCatalogName(name);
  if (!n) return null;
  if (n.role) return "shelf";
  const dimensioned = [isBoard, isBackWall, isSideWall, isFrame, isShelfBoard, isGrating, isBeam, isArm, isDiagonal, isCrossBar, isDivider, isPushThrough, isDepthSupport, isMeshBackWall];
  return dimensioned.some((f) => f(n)) ? "dimensioned" : null;
}

/** System eines Artikels nach Namensschema ("META CLIP S3"), sonst null. */
export function nameRuleSystem(name: string): string | null {
  return parseCatalogName(name)?.system ?? null;
}

/**
 * Teile eines Grundsystems, die auch an einem Untersystem passen (User-Entscheidung 17.10.2026):
 * CLIP-Böden, -Wände und -Zubehör gleicher Maße auch für CLIP S3 (S3 hat nur eigene Rahmen).
 */
const SHARED_PARTS_SYSTEMS: Record<string, string[]> = { "META CLIP S3": ["META CLIP"] };

export type NameRuleOptions = {
  /** Obergrenze je Quelle und Tab */
  maxPerTab?: Partial<Record<NameRuleTab, number>>;
  /** Freigegebenes Standardzubehör je System ("META CLIP" → Artikelnummern, in Reihenfolge) */
  systemAccessories?: Record<string, string[]>;
  /** Alt: Obergrenze je Quelle und Tab, wenn maxPerTab fehlt */
  maxPerSource?: number;
};

/**
 * Ist (Quelle → Ziel) ein Paar der festen Namensregeln? Fuer die Monatspruefung: Paare, die ein
 * anderes METAorder (oder ein Import) ohne Herkunft "heuristic" kennt, bleiben so ebenfalls geschuetzt.
 */
export function isNameRulePair(sourceName: string | null | undefined, targetName: string | null | undefined): boolean {
  if (!sourceName || !targetName) return false;
  return buildNameRulePairs(
    [
      { productNumber: "s", name: sourceName },
      { productNumber: "t", name: targetName },
    ],
    { maxPerTab: { extend: 100, accessories: 100, parts: 100, variants: 100 } },
  ).some((p) => p.source === "s" && p.target === "t");
}

/** Alle Regel-Paare (Quelle → Ziel), je Quelle und Tab nach Rang sortiert und begrenzt. */
export function buildNameRulePairs(products: NameRuleProduct[], options: NameRuleOptions = {}): NameRulePair[] {
  const fallback = options.maxPerSource ?? 10;
  const maxPerTab: Record<NameRuleTab, number> = {
    extend: options.maxPerTab?.extend ?? fallback,
    accessories: options.maxPerTab?.accessories ?? fallback,
    parts: options.maxPerTab?.parts ?? fallback,
    variants: options.maxPerTab?.variants ?? fallback,
  };
  const parsed = products
    .map((p) => ({ p, n: parseCatalogName(p.name) }))
    .filter((x): x is { p: NameRuleProduct; n: ParsedName } => x.n !== null);
  const byName = new Map<string, NameRuleProduct>();
  for (const { p } of parsed) byName.set(normalizeName(p.name), p);
  const byNumber = new Map(products.map((p) => [p.productNumber, p]));

  const shelves = parsed.filter((x) => x.n.role && x.n.dims.length === 3);
  const of = (pred: (n: ParsedName) => boolean) => parsed.filter((x) => pred(x.n));
  const boards = of((n) => isBoard(n) && n.dims.length === 2);
  const backWalls = of((n) => isBackWall(n) && n.dims.length === 2);
  const sideWalls = of((n) => isSideWall(n) && n.dims.length === 2);
  const frames = of((n) => isFrame(n) && n.dims.length === 2);
  const shelfBoards = of((n) => isShelfBoard(n) && n.dims.length === 2);
  const gratings = of((n) => isGrating(n) && n.dims.length === 2);
  const beams = of(isBeam);
  const arms = of((n) => isArm(n) && n.length !== null);
  const diagonals = of((n) => isDiagonal(n) && n.length !== null);
  const dividers = of((n) => isDivider(n) && n.dims.length === 2);
  const pushThrough = of((n) => isPushThrough(n) && n.length !== null);
  const depthSupports = of((n) => isDepthSupport(n) && n.length !== null);
  const meshBackWalls = of((n) => isMeshBackWall(n) && n.dims.length === 2);
  const crossBars = of((n) => isCrossBar(n) && n.length !== null);
  const shelvesByShape = new Map<string, typeof shelves>();
  for (const s of shelves) {
    const key = `${s.n.system}||${s.n.type}||${shapeKey(s.n)}`;
    shelvesByShape.set(key, [...(shelvesByShape.get(key) ?? []), s]);
  }
  const shelvesByVariant = new Map<string, typeof shelves>();
  for (const s of shelves) {
    const key = variantKey(s.n);
    shelvesByVariant.set(key, [...(shelvesByVariant.get(key) ?? []), s]);
  }

  const out: NameRulePair[] = [];
  for (const { p, n } of shelves) {
    const pairs: Array<NameRulePair & { order: number }> = [];
    const add = (target: NameRuleProduct, kind: NameRuleKind, order = 0) => {
      if (target.productNumber === p.productNumber || pairs.some((x) => x.target === target.productNumber)) return;
      pairs.push({ source: p.productNumber, target: target.productNumber, kind, tab: NAME_RULE_TAB[kind], rank: RANK[kind], order });
    };
    const [height, width, depth] = n.dims;
    const role = n.role as ShelfRole;
    // Rahmen nur im eigenen System; Böden, Wände und Zubehör auch aus dem Grundsystem (CLIP → CLIP S3)
    const ownSys = (x: ParsedName) => systemMatches(x.system, n.system);
    const sharedSystems = SHARED_PARTS_SYSTEMS[n.system] ?? [];
    const sys = (x: ParsedName) => ownSys(x) || sharedSystems.some((s) => systemMatches(x.system, s));
    const sameSurface = (a: ParsedName) => !a.surface || !n.surface || a.surface === n.surface;
    // Varianten mit anderer Oberflaeche nach hinten
    const surfaceOrder = (a: ParsedName) => (a.surface && n.surface && a.surface !== n.surface ? 1 : 0);

    // --- Regal erweitern ---
    const partnerName = n.segments.map((s) => (s === role ? PARTNER_ROLE[role] : s)).join(" | ");
    const partner = byName.get(partnerName);
    if (partner) add(partner, "partner_shelf");
    const extendRole = EXTEND_ROLE[role];
    for (const s of shelvesByShape.get(`${n.system}||${n.type}||${shapeKey(n)}`) ?? []) {
      if (s.n.role !== extendRole) continue;
      const [h, w, d] = s.n.dims;
      if (h !== height || d !== depth || w === width) continue;
      // gleiche Fachlast zuerst, dann nach Breite
      add(s.p, "other_width", (s.n.loadKg === n.loadKg ? 0 : 100000) + w);
    }

    // --- Das passt dazu ---
    for (const b of boards) {
      if (!sys(b.n) || b.n.dims[0] !== width || b.n.dims[1] !== depth) continue;
      const isSockel = /^Sockelboden/i.test(b.n.type);
      if (!isSockel && b.n.loadKg !== null && b.n.loadKg !== n.loadKg) continue;
      if (b.n.boardMaterial && n.boardMaterial && b.n.boardMaterial !== n.boardMaterial) continue;
      if (!sameSurface(b.n)) continue;
      add(b.p, "board", isSockel ? 1 : 0);
    }
    [...(options.systemAccessories?.[n.system] ?? []), ...sharedSystems.flatMap((s) => options.systemAccessories?.[s] ?? [])].forEach((pn, i) => {
      const target = byNumber.get(pn);
      if (!target) return;
      // Teile fuer Doppel- bzw. Einfachregale nur an die passende Bauart
      if (/doppelregal/i.test(target.name) && !role.startsWith("Doppel")) return;
      if (/einfachregal/i.test(target.name) && role.startsWith("Doppel")) return;
      add(target, "system_accessory", i);
    });
    for (const a of diagonals) if (sys(a.n) && a.n.length === width && sameSurface(a.n)) add(a.p, "accessory", 0);
    for (const a of crossBars) if (sys(a.n) && a.n.length === width && sameSurface(a.n)) add(a.p, "accessory", 0.5);
    for (const a of dividers) {
      if (sys(a.n) && a.n.dims[1] === depth && a.n.dims[0] <= height && sameSurface(a.n)) add(a.p, "accessory", 1 + a.n.dims[0] / 10000);
    }
    // Palettenregal-Zubehoer (nicht fuer Kabeltrommel- oder Grossfachregale)
    if (/^Palettenregal$/i.test(n.type)) {
      for (const a of pushThrough) if (sys(a.n) && a.n.length === width) add(a.p, "accessory", 2 + surfaceOrder(a.n));
      for (const a of depthSupports) if (sys(a.n) && a.n.length === depth) add(a.p, "accessory", 3 + surfaceOrder(a.n));
      for (const a of meshBackWalls) if (sys(a.n) && a.n.dims[1] === width && a.n.dims[0] <= height) add(a.p, "accessory", 4 + surfaceOrder(a.n));
    }
    if (!role.startsWith("Doppel")) {
      for (const w of backWalls) if (sys(w.n) && w.n.dims[0] === height && w.n.dims[1] === width && sameSurface(w.n)) add(w.p, "back_wall");
    }
    for (const w of sideWalls) if (sys(w.n) && w.n.dims[0] === height && w.n.dims[1] === depth && sameSurface(w.n)) add(w.p, "side_wall");

    // --- Einzelteile (alle Varianten, gleiche Oberflaeche zuerst) ---
    for (const f of frames) {
      if (!ownSys(f.n) || f.n.dims[0] !== height || f.n.dims[1] !== depth) continue;
      if (f.n.sides && n.sides && f.n.sides !== n.sides) continue;
      add(f.p, "frame", surfaceOrder(f.n));
    }
    for (const b of shelfBoards) {
      if (!sys(b.n) || b.n.dims[0] !== width || b.n.dims[1] !== depth) continue;
      const load = boardTypeLoad(b.n);
      add(b.p, "shelf_board", surfaceOrder(b.n) * 10 + (load !== null && load === n.loadKg ? 0 : 1));
    }
    for (const g of gratings) if (sys(g.n) && g.n.dims[0] === width && g.n.dims[1] === depth) add(g.p, "grating", surfaceOrder(g.n));
    for (const b of beams) if (sys(b.n) && beamWidth(b.n) === width) add(b.p, "beam", surfaceOrder(b.n));
    for (const a of arms) if (sys(a.n) && a.n.length === depth) add(a.p, "arm", surfaceOrder(a.n));

    // --- Auch erhältlich in: je Höhe, Tiefe bzw. Farbe der Artikel, der sonst gleich ist ---
    const siblings = shelvesByVariant.get(variantKey(n)) ?? [];
    const variantAttrs = [
      { kind: "other_height" as const, value: (x: ParsedName) => x.dims[0] },
      { kind: "other_depth" as const, value: (x: ParsedName) => x.dims[2] },
      { kind: "other_surface" as const, value: (x: ParsedName) => x.surface },
    ];
    for (const attr of variantAttrs) {
      const own = attr.value(n);
      if (own === null) continue;
      const best = new Map<string | number, { s: (typeof shelves)[number]; score: number }>();
      for (const s of siblings) {
        const v = attr.value(s.n);
        if (v === null || v === own) continue;
        // die anderen beiden Merkmale muessen gleich sein
        if (variantAttrs.some((o) => o !== attr && o.value(s.n) !== o.value(n))) continue;
        const loadGap = s.n.loadKg !== null && n.loadKg !== null ? Math.abs(s.n.loadKg - n.loadKg) : 1e6;
        const score = loadGap * 10 + (levelsOf(s.n) === levelsOf(n) ? 0 : 1);
        const prev = best.get(v);
        if (!prev || score < prev.score || (score === prev.score && s.p.productNumber < prev.s.p.productNumber)) best.set(v, { s, score });
      }
      for (const [v, { s }] of best) add(s.p, attr.kind, typeof v === "number" ? v : 0);
    }

    for (const tab of ["extend", "accessories", "parts", "variants"] as const) {
      const list = pairs
        .filter((x) => x.tab === tab)
        .sort((a, b) => a.rank - b.rank || a.order - b.order || a.target.localeCompare(b.target))
        .slice(0, maxPerTab[tab]);
      out.push(...list.map(({ order: _o, ...rest }) => rest));
    }
  }
  return out;
}
