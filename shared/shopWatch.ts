/**
 * Shop-Wächter: prüft, ob die Inhalte, die METAorder in den Shop geschrieben hat, noch da sind und
 * angezeigt werden (z. B. nach einem Deploy der Agentur). Typen für Server
 * (server/shopContent/shopWatch*.ts) und Oberfläche (/admin/shop-waechter).
 * Texte übersetzt der Client: Prüfpunkt-Art shopWatch.kinds.<kind>, Befund shopWatch.findings.<code>.
 */

/** Gruppen nach Reparatur-Regel (Entscheidung 17.10.2026) */
export const SHOP_WATCH_GROUPS = ["own", "agency", "bulk", "platform"] as const;
export type ShopWatchGroup = (typeof SHOP_WATCH_GROUPS)[number];

export const SHOP_WATCH_KINDS = [
  "snippet",
  "quickConfigPage",
  "quickConfigHome",
  "industryPage",
  "industryHome",
  "homeSection",
  "categoryFields",
  "listingDefaults",
  "redirect",
  "imageTexts",
  "metaTexts",
  "descriptions",
  "crossSelling",
  "montageTag",
  "plugins",
] as const;
export type ShopWatchKind = (typeof SHOP_WATCH_KINDS)[number];

export const SHOP_WATCH_STATUSES = ["ok", "warn", "fail", "error"] as const;
export type ShopWatchStatus = (typeof SHOP_WATCH_STATUSES)[number];

export const SHOP_WATCH_FINDING_CODES = [
  "entityMissing",
  "entityInactive",
  "channelMissing",
  "differsFromRepo",
  "assetMarkerMissing",
  "pageStatus",
  "pageMarkerMissing",
  "pageTextMissing",
  "redirectWrong",
  "countDropped",
  "fieldsChanged",
  "fieldsEmpty",
  "overwritten",
  "settingChanged",
  "filterVisible",
  "pluginMissing",
  "pluginInactive",
  "checkFailed",
] as const;
export type ShopWatchFindingCode = (typeof SHOP_WATCH_FINDING_CODES)[number];

export type ShopWatchFinding = {
  code: ShopWatchFindingCode;
  severity: Exclude<ShopWatchStatus, "ok">;
  params?: Record<string, string | number>;
};

/**
 * Wie ein Fehler behoben wird: auto = eigener Inhalt (später automatisch), manual = Schreibskript nach Prüfung
 * (später per Knopf), none = kein Skript, nur Hinweis. command = Aufruf im App-Container, hint = Weg in einer Oberfläche.
 */
export type ShopWatchRepair = { mode: "auto" | "manual" | "none"; command?: string; hint?: string };

export type ShopWatchCheckResult = {
  id: string;
  group: ShopWatchGroup;
  kind: ShopWatchKind;
  label: string;
  status: ShopWatchStatus;
  findings: ShopWatchFinding[];
  /** Kennzahl für den Soll-Stand (z. B. Anzahl Artikel mit Markierung) */
  count?: number;
  url?: string;
  repair: ShopWatchRepair;
  /** Weitere Kennzahlen für den Soll-Stand */
  counts?: Record<string, number>;
  ms: number;
};

/** Merkmale eines Deploys: ändern sie sich, hat jemand Code, Plugins oder Theme ausgerollt */
export type ShopWatchDeployFingerprint = {
  shopwareVersion: string | null;
  plugins: string[];
  themeAsset: string | null;
};

export type ShopWatchDeployChange = { field: "shopwareVersion" | "plugins" | "themeAsset"; before: string; after: string };

export type ShopWatchRun = {
  startedAt: string;
  finishedAt: string;
  trigger: "manual" | "schedule" | "deploy";
  shopUrl: string;
  status: ShopWatchStatus;
  results: ShopWatchCheckResult[];
  fingerprint: ShopWatchDeployFingerprint;
  /** Unterschiede zum Fingerabdruck des vorigen Laufs */
  deployChanges: ShopWatchDeployChange[];
};

/** Soll-Stand: Kennzahlen und Fingerabdrücke, gegen die geprüft wird (erster Lauf oder „Als Soll übernehmen“) */
export type ShopWatchBaseline = {
  takenAt: string;
  counts: Record<string, number>;
  /** Kategorie-ID -> Fingerabdruck der vier Inhaltsfelder */
  categoryFields: Record<string, string>;
};

const RANK: Record<ShopWatchStatus, number> = { ok: 0, warn: 1, error: 2, fail: 3 };

/** Schlimmster Status (fail vor error vor warn vor ok) */
export function worstStatus(statuses: ShopWatchStatus[]): ShopWatchStatus {
  return statuses.reduce<ShopWatchStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "ok");
}
