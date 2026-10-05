import { useSyncExternalStore } from "react";

/**
 * Helles/dunkles Design: Quelle ist die Klasse "dark" am <html>, gemerkt in localStorage "theme".
 * Gemeinsamer Zustand fuer alle Schalter (Kopfzeile am Desktop, Nutzermenue am Handy) - frueher
 * hielt ThemeToggle ihn allein und setzte ihn erst beim Einhaengen.
 */
export type ThemeMode = "light" | "dark";

const EVENT = "metaorder-theme-change";

function readMode(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function setThemeMode(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem("theme", mode);
  } catch {
    // privater Modus o. ae.: Design gilt dann nur fuer diese Sitzung
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Beim Start einmal: gemerktes Design setzen, bevor die App zeichnet. */
export function applyStoredThemeMode() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    stored = null;
  }
  document.documentElement.classList.toggle("dark", stored === "dark");
}

export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "light" as ThemeMode);
  return { mode, toggle: () => setThemeMode(mode === "dark" ? "light" : "dark") };
}
