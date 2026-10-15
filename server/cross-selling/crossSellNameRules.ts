// Feste Cross-Selling-Regeln aus den Artikelnamen (neues Namensschema "SYSTEM | Art | … | Maße | …").
// Exakte Zuordnungen ohne Statistik und KI:
// - Anbauregal ↔ Grundregal (gleicher Name bis auf die Regalart, auch Doppel-…)
// - Regal → Zusatz-Fachboden/Zusatzboden: gleiches System, Breite x Tiefe, Fachlast, Oberfläche, Bodenmaterial
// - Regal → Rückwand (H x B) und Seitenwand (H x T): gleiches System und Oberfläche; Rückwand nicht an Doppelregalen
// Nur innerhalb exakt desselben Systems (User-Entscheidung 15.10.2026); "L+M" gilt für L und M.

export type NameRuleProduct = { productNumber: string; name: string };

export type NameRuleKind = "partner_shelf" | "board" | "back_wall" | "side_wall";

export type NameRulePair = {
  source: string;
  target: string;
  kind: NameRuleKind;
  /** Reihenfolge in der Liste: Partnerregal zuerst */
  rank: number;
};

const RANK: Record<NameRuleKind, number> = { partner_shelf: 0, board: 1, back_wall: 2, side_wall: 3 };

const SHELF_ROLES = ["Doppel-Anbauregal", "Doppel-Grundregal", "Anbauregal", "Grundregal"] as const;
type ShelfRole = (typeof SHELF_ROLES)[number];
const PARTNER_ROLE: Record<ShelfRole, ShelfRole> = {
  Anbauregal: "Grundregal",
  Grundregal: "Anbauregal",
  "Doppel-Anbauregal": "Doppel-Grundregal",
  "Doppel-Grundregal": "Doppel-Anbauregal",
};

export type ParsedName = {
  system: string;
  type: string;
  segments: string[];
  role: ShelfRole | null;
  /** Maße in mm in Namensreihenfolge (H x B x T bzw. B x T / H x B) */
  dims: number[];
  loadKg: number | null;
  surface: string | null;
  /** Bodenmaterial bei Weitspannregalen/Zusatzböden */
  boardMaterial: "spanplatte" | "stahlpaneel" | null;
};

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function toNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

export function parseCatalogName(name: string): ParsedName | null {
  const normalized = normalizeName(name);
  if (!normalized.includes(" | ")) return null;
  const segments = normalized.split(" | ").map((s) => s.trim());
  if (segments.length < 3) return null;
  const role = (SHELF_ROLES.find((r) => segments.includes(r)) ?? null) as ShelfRole | null;
  let dims: number[] = [];
  for (const seg of segments) {
    const m = seg.match(/^(\d[\d.,]*)\s*x\s*(\d[\d.,]*)(?:\s*x\s*(\d[\d.,]*))?\s*mm$/i);
    if (m) {
      dims = [m[1], m[2], m[3]].filter(Boolean).map((v) => toNumber(v as string));
      break;
    }
  }
  let loadKg: number | null = null;
  for (const seg of segments) {
    const m = seg.match(/^(?:Fachlast\s+)?(\d[\d.,]*)\s*kg$/i);
    if (m) {
      loadKg = toNumber(m[1]);
      break;
    }
  }
  const surface = [...segments].reverse().find((s) => /^(verzinkt|RAL \d{4}(?:\/[\w ]+)?|verzinkt\/RAL \d{4})$/i.test(s)) ?? null;
  const lower = normalized.toLowerCase();
  const boardMaterial = lower.includes("spanplatte") ? "spanplatte" : lower.includes("stahlpaneel") ? "stahlpaneel" : null;
  return { system: segments[0], type: segments[1], segments, role, dims, loadKg, surface: surface?.toLowerCase() ?? null, boardMaterial };
}

/** "META MULTISTRONG L+M" passt zu "META MULTISTRONG L" und "… M". */
function systemMatches(accessorySystem: string, shelfSystem: string): boolean {
  if (accessorySystem === shelfSystem) return true;
  const m = accessorySystem.match(/^(.*\S)\s+([A-Z](?:\+[A-Z])+)$/);
  if (!m) return false;
  const [, base, variants] = m;
  return variants.split("+").some((v) => `${base} ${v}` === shelfSystem);
}

function isBoard(p: ParsedName): boolean {
  return /^(Zusatz-Fachboden|Zusatzboden\b)/i.test(p.type);
}
function isBackWall(p: ParsedName): boolean {
  return /Rückwand$/i.test(p.type);
}
function isSideWall(p: ParsedName): boolean {
  return /Seitenwand$/i.test(p.type);
}

export type NameRuleOptions = { maxPerSource?: number };

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
    { maxPerSource: 50 },
  ).some((p) => p.source === "s" && p.target === "t");
}

/** Alle Regel-Paare (Quelle → Ziel), je Quelle nach Rang sortiert und begrenzt. */
export function buildNameRulePairs(products: NameRuleProduct[], options: NameRuleOptions = {}): NameRulePair[] {
  const maxPerSource = options.maxPerSource ?? 10;
  const parsed = products
    .map((p) => ({ p, n: parseCatalogName(p.name) }))
    .filter((x): x is { p: NameRuleProduct; n: ParsedName } => x.n !== null);
  const byName = new Map<string, NameRuleProduct>();
  for (const { p } of parsed) byName.set(normalizeName(p.name), p);

  const shelves = parsed.filter((x) => x.n.role && x.n.dims.length === 3);
  const boards = parsed.filter((x) => isBoard(x.n) && x.n.dims.length === 2);
  const backWalls = parsed.filter((x) => isBackWall(x.n) && x.n.dims.length === 2);
  const sideWalls = parsed.filter((x) => isSideWall(x.n) && x.n.dims.length === 2);

  const out: NameRulePair[] = [];
  for (const { p, n } of shelves) {
    const pairs: NameRulePair[] = [];
    const add = (target: NameRuleProduct, kind: NameRuleKind) => {
      if (target.productNumber !== p.productNumber && !pairs.some((x) => x.target === target.productNumber)) {
        pairs.push({ source: p.productNumber, target: target.productNumber, kind, rank: RANK[kind] });
      }
    };
    const [height, width, depth] = n.dims;
    const role = n.role as ShelfRole;

    // Partnerregal: gleicher Name, nur die Regalart getauscht
    const partnerName = n.segments.map((s) => (s === role ? PARTNER_ROLE[role] : s)).join(" | ");
    const partner = byName.get(partnerName);
    if (partner) add(partner, "partner_shelf");

    const sameSurface = (a: ParsedName) => !a.surface || !n.surface || a.surface === n.surface;
    for (const b of boards) {
      if (!systemMatches(b.n.system, n.system)) continue;
      if (b.n.dims[0] !== width || b.n.dims[1] !== depth) continue;
      if (b.n.loadKg !== null && b.n.loadKg !== n.loadKg) continue;
      if (b.n.boardMaterial && n.boardMaterial && b.n.boardMaterial !== n.boardMaterial) continue;
      if (!sameSurface(b.n)) continue;
      add(b.p, "board");
    }
    if (!role.startsWith("Doppel")) {
      for (const w of backWalls) {
        if (systemMatches(w.n.system, n.system) && w.n.dims[0] === height && w.n.dims[1] === width && sameSurface(w.n)) add(w.p, "back_wall");
      }
    }
    for (const w of sideWalls) {
      if (systemMatches(w.n.system, n.system) && w.n.dims[0] === height && w.n.dims[1] === depth && sameSurface(w.n)) add(w.p, "side_wall");
    }
    pairs.sort((a, b) => a.rank - b.rank || a.target.localeCompare(b.target));
    out.push(...pairs.slice(0, maxPerSource));
  }
  return out;
}
