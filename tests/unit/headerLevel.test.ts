/**
 * Kopfzeile nach verfuegbarer Breite (client/src/hooks/useHeaderLevel.ts). Vorher hing alles an der
 * Fensterbreite (ab 1280 px alles sichtbar): mit linker Leiste und offener Schnellbearbeitung blieben
 * bei 1440 px 824 px fuer die Kopfzeile - Suchfeld 50 px, Nutzermenue ragte ueber den Rand; auch mit
 * geschlossener Leiste bei 1280-1366 px nur 50-110 px Suchfeld.
 * Modell der Kopfzeile mit den gemessenen Breiten (Mandant Testing, langer Nutzername).
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import {
  MAX_HEADER_LEVEL,
  MIN_SEARCH_WIDTH,
  nextHeaderFit,
  type HeaderFit,
  type HeaderMeasure,
} from "../../client/src/hooks/useHeaderLevel";

/** Platz ohne Suchfeld je Stufe (Kopfzeile minus Suchfeld, je 2-3 Messungen): alles, ohne Titel, ohne Beschriftung/Rolle, ohne Name, kompakt */
const FIXED = [952, 832, 657, 514, 214];
const SEARCH_MAX = 576; // max-w-xl
const SEARCH_MIN_CONTENT = 50; // schmaler wird das Suchfeld nicht, der Rest ragt dann ueber

function measure(header: number, level: number): HeaderMeasure {
  const free = header - FIXED[level];
  const search = Math.min(SEARCH_MAX, Math.max(SEARCH_MIN_CONTENT, free));
  return { header, search, overflow: Math.max(0, FIXED[level] + search - header) };
}

/** Wie der Hook: messen, bis sich nichts mehr aendert (hoechstens 20 Runden) */
function settle(state: HeaderFit, header: number): { state: HeaderFit; rounds: number } {
  for (let rounds = 0; rounds < 20; rounds++) {
    const next = nextHeaderFit(state, measure(header, state.level));
    if (next === state) return { state, rounds };
    state = next;
  }
  throw new Error(`kein stabiler Zustand bei ${header} px`);
}

/** Kleinste Stufe, bei der das Suchfeld MIN_SEARCH_WIDTH hat */
const best = (header: number) => {
  const level = FIXED.findIndex((fixed) => Math.min(SEARCH_MAX, header - fixed) >= MIN_SEARCH_WIDTH);
  return level === -1 ? MAX_HEADER_LEVEL : level;
};
const start: HeaderFit = { level: 0, needed: [] };

describe("Stufe der Kopfzeile", () => {
  it("gemessene Faelle: genau so viel ins Menue wie noetig", () => {
    const cases: Array<[number, number]> = [
      [664, 4], // 1280 px, Schnellbearbeitung offen
      [824, 4], // 1440 px, offen (vorher: Suchfeld 50 px, Name ueber dem Rand)
      [920, 3], // 1536 px, offen
      [976, 3], // 1280 px, zu
      [1136, 2], // 1440 px, zu
      [1232, 1], // 1536 px, zu
      [1304, 0], // 1920 px, offen
      [1616, 0], // 1920 px, zu
    ];
    for (const [header, level] of cases) {
      const { state } = settle(start, header);
      expect([header, state.level]).toEqual([header, level]);
      expect(measure(header, state.level).search).toBeGreaterThanOrEqual(level === MAX_HEADER_LEVEL ? 0 : MIN_SEARCH_WIDTH);
      expect(measure(header, state.level).overflow).toBe(0);
    }
  });

  it("jede Breite: kleinste passende Stufe, ohne Ueberstand", () => {
    for (let header = 300; header <= 1800; header += 7) {
      const { state } = settle(start, header);
      expect([header, state.level]).toEqual([header, best(header)]);
    }
  });

  it("breiter (Leiste zu) -> Elemente kommen zurueck; schmaler -> wieder ins Menue", () => {
    let { state } = settle(start, 824);
    expect(state.level).toBe(4);
    ({ state } = settle(state, 1136));
    expect(state.level).toBe(2);
    ({ state } = settle(state, 1616));
    expect(state.level).toBe(0);
    ({ state } = settle(state, 824));
    expect(state.level).toBe(4);
    ({ state } = settle(state, 1304));
    expect(state.level).toBe(0);
  });

  it("beim Vergroessern in kleinen Schritten kein Hin und Her", () => {
    let { state } = settle(start, 664);
    for (let header = 664; header <= 1700; header += 3) {
      const result = settle(state, header);
      state = result.state;
      expect(state.level).toBe(best(header));
      // pro Schritt hoechstens eine Stufe zurueck und kein Zuruecknehmen in derselben Runde
      expect(result.rounds).toBeLessThanOrEqual(2);
    }
  });

  it("unbekannter Bedarf (nie gemessen): bleibt in der Stufe", () => {
    const state: HeaderFit = { level: 2, needed: [] };
    expect(nextHeaderFit(state, { header: 5000, search: 576, overflow: 0 })).toBe(state);
  });
});
