import { useSyncExternalStore } from "react";

/**
 * Unter xl (1280 px) kompakte Darstellung (Handy, Tablet, kleine Laptops):
 * - rechte Leiste "Schnellbearbeitung" ueber dem Inhalt statt daneben - daneben blieben am Handy 48 px,
 *   am Tablet 150-400 px fuer den Inhalt (linke Leiste 255 px + rechte 360 px);
 * - Kopfzeile ohne Mandant, Sprache, Design und Rolle (stehen dann im Nutzermenue) - bei 1024 px
 *   ragten sonst noch 6 Elemente ueber den Rand.
 * Passt zu den Tailwind-Klassen xl:.
 */
export const COMPACT_LAYOUT_QUERY = "(max-width: 1279px)";

/** Stimmt schon beim ersten Zeichnen (anders als useIsMobile, das erst nach dem Einhaengen misst). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
