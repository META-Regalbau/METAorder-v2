/**
 * Versionsangabe der laufenden App (GET /api/version, Sidebar unten). Ermittlung in
 * server/lib/appVersion.ts.
 */
export type AppVersionInfo = {
  /** fortlaufende Nummer (Anzahl Commits bis zum gebauten Stand) oder "dev" */
  version: string;
  /** kurzer Git-Hash, zugleich Image-Tag im Deploy */
  commit: string | null;
  /** Datum des Commits (ISO 8601) */
  date: string | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Kurzform fuer die Sidebar ("Version 484 · 04.10.2026") und Details fuer den Tooltip */
export function formatAppVersion(info: AppVersionInfo, t: Translate, locale: string): { label: string; details: string } {
  const date = info.date ? new Date(info.date) : null;
  const valid = date && !Number.isNaN(date.getTime()) ? date : null;
  const label = [t("appVersion.label", { version: info.version }), valid?.toLocaleDateString(locale)].filter(Boolean).join(" · ");
  const details = info.commit
    ? t("appVersion.details", {
        commit: info.commit,
        date: valid ? valid.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—",
      })
    : label;
  return { label, details };
}
