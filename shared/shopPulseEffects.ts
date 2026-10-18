/**
 * Shop-Puls Stufe 2, Baustein S2-6 (Konzept 18.10.2026, Abschnitt 6): Wirkung der Maßnahmen messen.
 * Typen und feste Regeln für Server (server/shopPulse/effects.ts, effectsRun.ts) und Oberfläche
 * (/admin/shop-puls, Reiter Maßnahmen-Protokoll und Wochenbericht).
 *
 * Je Eintrag im Maßnahmen-Protokoll vergleicht METAorder die Tage davor und danach (14 bzw. 28 Tage, der Tag
 * der Maßnahme selbst zählt nicht mit; gleich viele Wochen, also gleiche Wochentage) für den betroffenen
 * Bereich. Grundlage sind die MO-Bestellungen ohne stornierte (Artikelpositionen netto):
 *
 * - Deckungsbeitrag (DB1 netto, nur Positionen mit Herstellpreis) ist der Hauptwert, Umsatz netto und
 *   Bestellungen stehen daneben. Ist der Deckungsbeitrag für weniger als die Hälfte des Umsatzes bekannt,
 *   ist der Umsatz der Hauptwert.
 * - Vergleichsgruppe (Differenz der Differenzen): der übrige Shop im selben Zeitraum. Erwartet wäre
 *   „vorher × (Vergleichsgruppe nachher / vorher)“; die Wirkung ist die Abweichung davon. Betrifft die
 *   Maßnahme den ganzen Shop (oder gibt es keinen übrigen Shop), sind die gleichen Tage 52 Wochen davor die
 *   Vergleichsgruppe; reicht der Spiegel nicht so weit zurück, gibt es keine.
 * - Seiten lassen sich Bestellungen nicht zuordnen: dafür nur frühe Signale (GA4: Sitzungen und Käufe über
 *   diese Einstiegsseiten), als Tendenz.
 *
 * Einstufung (fest, auf der Seite erklärt):
 * - „läuft noch“: die 14 Tage danach sind noch nicht vorbei
 * - „nicht messbar“: Bereich lässt sich Bestellungen nicht zuordnen, keine Daten vorher, oder zusammen weniger
 *   als 6 Bestellungen im Bereich
 * - „sicher“: 28 Tage vorbei, mindestens 10 Bestellungen im Bereich vorher und nachher, eine Vergleichsgruppe,
 *   keine andere Maßnahme im selben Bereich in diesen Tagen, und die Abweichung beim Hauptwert ist mindestens
 *   doppelt so groß wie die übliche Schwankung von Tag zu Tag (|z| ≥ 2, etwa 95 %)
 * - sonst „unsicher“
 * Bei rund 4,7 Shop-Bestellungen am Werktag sind damit nur große Wirkungen sicher; jede Auswertung nennt,
 * ab welcher Größe eine Wirkung sicher erkennbar wäre.
 */
import type { ShopPulseActionKind, ShopPulseActionScope } from "./shopPulseWeekly";

/** Länge der Zeiträume vor und nach der Maßnahme in Tagen (ganze Wochen) */
export const SHOP_PULSE_EFFECT_WINDOWS = [14, 28] as const;
export type ShopPulseEffectWindowDays = (typeof SHOP_PULSE_EFFECT_WINDOWS)[number];

/** Regeln der Einstufung (siehe oben) */
export const SHOP_PULSE_EFFECT_RULES = {
  /** so viele Bestellungen im Bereich braucht es vorher und nachher für „sicher“ */
  minOrdersSure: 10,
  /** weniger Bestellungen im Bereich (vorher + nachher zusammen) = nicht messbar */
  minOrdersMeasurable: 6,
  /** Abweichung in Vielfachen der Schwankung (z-Wert) für „sicher“ */
  zSure: 2,
  /** unter diesem Anteil des Umsatzes mit Herstellpreis ist der Umsatz der Hauptwert */
  minDb1CoveragePercent: 50,
  /** „sicher“ nur über diesen Zeitraum */
  sureWindowDays: 28 as ShopPulseEffectWindowDays,
  /** so weit zurück werden Maßnahmen ausgewertet (ältere behalten ihr letztes Ergebnis) */
  lookbackDays: 180,
} as const;

export const SHOP_PULSE_EFFECT_VERDICTS = ["sure", "unsure", "notMeasurable", "pending"] as const;
export type ShopPulseEffectVerdict = (typeof SHOP_PULSE_EFFECT_VERDICTS)[number];

/**
 * Warum nicht „sicher“ (Texte shopPulse.effects.reasons.<reason>): Seiten bzw. Kanal nicht zuordenbar,
 * Kanal ohne Bestellungen, keine Daten vorher, zu wenige Bestellungen, keine Vergleichsgruppe, andere
 * Maßnahme im selben Bereich, Zeitraum zu kurz (nur 14 Tage), Abweichung zu klein, Deckungsbeitrag zu
 * lückenhaft (Umsatz als Hauptwert)
 */
export const SHOP_PULSE_EFFECT_REASONS = [
  "pagesNotAttributable",
  "channelNoOrders",
  "noHistory",
  "tooFewOrders",
  "fewOrders",
  "noControl",
  "overlap",
  "windowShort",
  "weak",
  "db1Coverage",
] as const;
export type ShopPulseEffectReason = (typeof SHOP_PULSE_EFFECT_REASONS)[number];

export const SHOP_PULSE_EFFECT_METRICS = ["db1", "revenue", "orders"] as const;
export type ShopPulseEffectMetricId = (typeof SHOP_PULSE_EFFECT_METRICS)[number];

/** Vergleichsgruppe: übriger Shop, gleiche Tage 52 Wochen davor, keine */
export const SHOP_PULSE_EFFECT_CONTROLS = ["rest", "yearAgo", "none"] as const;
export type ShopPulseEffectControl = (typeof SHOP_PULSE_EFFECT_CONTROLS)[number];

/** Eine Kennzahl im Vergleich */
export type ShopPulseEffectMetric = {
  /** Summe im Bereich vorher bzw. nachher */
  pre: number;
  post: number;
  /** erwartet ohne Maßnahme (vorher × Entwicklung der Vergleichsgruppe) */
  expected: number;
  /** Entwicklung der Vergleichsgruppe in Prozent; null ohne Vergleichsgruppe */
  controlChangePercent: number | null;
  /** nachher − erwartet */
  effect: number;
  /** Wirkung in Prozent von erwartet; null ohne Erwartung */
  effectPercent: number | null;
  /** Wirkung geteilt durch die Schwankung; null ohne Schwankung */
  z: number | null;
  /** ab dieser Größe (± in Prozent von erwartet) wäre eine Wirkung sicher erkennbar; null unbekannt */
  detectablePercent: number | null;
};

export type ShopPulseEffectWindow = {
  days: ShopPulseEffectWindowDays;
  /** Kalendertage (Berlin), jeweils einschließlich */
  pre: { from: string; to: string };
  post: { from: string; to: string };
  /** Tage danach vollständig vorbei (bis gestern) */
  complete: boolean;
  control: ShopPulseEffectControl;
  /** Hauptwert: Deckungsbeitrag, sonst Umsatz */
  main: Exclude<ShopPulseEffectMetricId, "orders">;
  /** null = nicht berechnet (läuft noch bzw. nicht messbar) */
  metrics: Record<ShopPulseEffectMetricId, ShopPulseEffectMetric | null>;
  /** Anteil des Umsatzes im Bereich mit Herstellpreis (0–100) */
  db1CoveragePercent: number | null;
  verdict: ShopPulseEffectVerdict;
  reasons: ShopPulseEffectReason[];
};

/** Frühes Signal (GA4, später Search Console): nur Tendenz, nie „sicher“ */
export const SHOP_PULSE_EARLY_METRICS = ["itemsViewed", "itemsAddedToCart", "sessions", "ecommercePurchases", "conversionPercent"] as const;
export type ShopPulseEarlyMetric = (typeof SHOP_PULSE_EARLY_METRICS)[number];

export type ShopPulseEarlySignal = {
  source: "ga4";
  metric: ShopPulseEarlyMetric;
  days: ShopPulseEffectWindowDays;
  pre: number;
  post: number;
  changePercent: number | null;
  /** Entwicklung im übrigen Shop; null ohne Vergleich (ganzer Shop) */
  controlChangePercent: number | null;
  /** Abweichung gegenüber dem übrigen Shop in Prozentpunkten der Entwicklung; null ohne Vergleich */
  relativePercent: number | null;
};

/** Stand der frühen Signale: gelesen, GA4 nicht eingerichtet, Fehler, noch nicht (wartet auf 14 Tage) */
export const SHOP_PULSE_EARLY_STATES = ["ok", "notConfigured", "error", "pending"] as const;
export type ShopPulseEarlyState = (typeof SHOP_PULSE_EARLY_STATES)[number];

export type ShopPulseEffectOverlap = { id: string; occurredAt: string; title: string; kind: ShopPulseActionKind };

/** Wirkung einer Maßnahme (gespeichert in shop_pulse_action_effects, Migration 0058) */
export type ShopPulseActionEffect = {
  actionId: string;
  computedAt: string;
  /** Tag der Maßnahme (Berlin) */
  day: string;
  scope: ShopPulseActionScope;
  /** Einstufung: 28 Tage, wenn vorbei, sonst 14 Tage (dann höchstens „unsicher“) */
  verdict: ShopPulseEffectVerdict;
  /** Zeitraum, aus dem die Einstufung stammt; null = noch keiner vorbei */
  headlineDays: ShopPulseEffectWindowDays | null;
  windows: ShopPulseEffectWindow[];
  /** andere Maßnahmen im selben Bereich innerhalb der 28 Tage davor und danach */
  overlaps: ShopPulseEffectOverlap[];
  early: { state: ShopPulseEarlyState; signals: ShopPulseEarlySignal[]; error?: string } | null;
};

/** Antwort von GET /api/shop-pulse/effects */
export type ShopPulseEffectsOverview = { effects: ShopPulseActionEffect[]; computedAt: string | null };

/** Gesicherte Wirkung im Wochenbericht (28 Tage, die in der Berichtswoche zu Ende gingen) */
export type ShopPulseWeeklyEffect = {
  actionId: string;
  title: string;
  occurredAt: string;
  scope: ShopPulseActionScope;
  main: Exclude<ShopPulseEffectMetricId, "orders">;
  effect: number;
  effectPercent: number | null;
  /** Umsatz netto im selben Vergleich */
  revenueEffect: number | null;
  positive: boolean;
  postTo: string;
};
