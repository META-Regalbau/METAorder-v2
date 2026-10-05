import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Kopfzeile nach verfuegbarer Breite statt nach Fensterbreite. Die Kopfzeile teilt sich das Fenster
 * mit der linken Leiste (256 px) und der rechten Schnellbearbeitung (360 px, standardmaessig offen):
 * bei 1440 px blieben 824 px, Titel, Mandant, Sprache, Design, Rolle und Name brauchen ~950 px -
 * das Suchfeld schrumpfte auf 50 px, das Nutzermenue ragte ueber den Rand.
 * Stufen: je hoeher, desto mehr wandert ins Nutzermenue, bis das Suchfeld MIN_SEARCH_WIDTH hat.
 */
export const HEADER_LEVEL = {
  full: 0,
  /** ohne App-Titel (steht oben in der linken Leiste) */
  noTitle: 1,
  /** ohne Beschriftung "Aktiver Mandant" und ohne Rolle (Rolle im Nutzermenue) */
  noLabels: 2,
  /** Name nur im Nutzermenue */
  noUsername: 3,
  /** Mandant, Sprache und Design im Nutzermenue (wie auf Handy und Tablet) */
  compact: 4,
} as const;
export const MAX_HEADER_LEVEL = HEADER_LEVEL.compact;
export const MIN_SEARCH_WIDTH = 320;

export type HeaderFit = {
  level: number;
  /** needed[L]: Breite der Kopfzeile, ab der Stufe L passt (gemessen beim Wechsel von L nach L+1) */
  needed: number[];
};

export type HeaderMeasure = {
  /** Innenbreite der Kopfzeile */
  header: number;
  /** Breite des Suchfelds */
  search: number;
  /** Ueberstand des Inhalts ueber die Kopfzeile (scrollWidth - clientWidth) */
  overflow: number;
};

/** Naechster Zustand: zu eng -> eine Stufe hoeher (Bedarf merken); wieder breit genug -> eine Stufe zurueck */
export function nextHeaderFit(state: HeaderFit, m: HeaderMeasure, minSearch = MIN_SEARCH_WIDTH): HeaderFit {
  const missing = minSearch - m.search + Math.max(0, m.overflow);
  if (missing > 0 && state.level < MAX_HEADER_LEVEL) {
    const needed = [...state.needed];
    needed[state.level] = m.header + missing;
    return { level: state.level + 1, needed };
  }
  const below = state.level - 1;
  if (state.level > 0 && state.needed[below] !== undefined && m.header >= state.needed[below]) {
    return { ...state, level: below };
  }
  return state;
}

/** Stufe der Kopfzeile; misst vor dem Zeichnen und bei jeder Groessenaenderung von Kopfzeile und Suchfeld */
export function useHeaderLevel(headerRef: RefObject<HTMLElement>, searchRef: RefObject<HTMLElement>): number {
  const [fit, setFit] = useState<HeaderFit>({ level: 0, needed: [] });
  const check = useCallback(() => {
    const header = headerRef.current;
    const search = searchRef.current;
    if (!header || !search) return;
    const measure: HeaderMeasure = {
      header: header.clientWidth,
      search: search.getBoundingClientRect().width,
      overflow: header.scrollWidth - header.clientWidth,
    };
    setFit((prev) => nextHeaderFit(prev, measure));
  }, [headerRef, searchRef]);

  // nach jedem Stufenwechsel erneut messen (vor dem Zeichnen, daher kein Flackern)
  useLayoutEffect(check, [check, fit.level]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => check());
    if (headerRef.current) observer.observe(headerRef.current);
    // Suchfeld: wird auch schmaler, wenn rechts etwas breiter wird (Sprache, Mandantenname)
    if (searchRef.current) observer.observe(searchRef.current);
    return () => observer.disconnect();
  }, [check, headerRef, searchRef]);

  return fit.level;
}
