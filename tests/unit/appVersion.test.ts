/**
 * Versionsangabe (Sidebar unten, GET /api/version): Werte aus dem Build (CI, docker:build), sonst
 * aus Git, sonst "dev"; Anzeige "Version 484 · 4.10.2026" mit Commit im Tooltip.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import i18next from "i18next";
import de from "../../client/src/i18n/locales/de.json";
import en from "../../client/src/i18n/locales/en.json";
import { resolveAppVersion } from "../../server/lib/appVersion";
import { formatAppVersion } from "../../shared/appVersion";

const noGit = () => {
  throw new Error("kein Git");
};

describe("Version ermitteln", () => {
  it("aus den Build-Argumenten (Image ohne .git)", () => {
    const env = { APP_VERSION: "484", APP_COMMIT: "8d8eff4", APP_COMMIT_DATE: "2026-10-04T21:39:00+02:00" };
    expect(resolveAppVersion(env, noGit)).toEqual({ version: "484", commit: "8d8eff4", date: "2026-10-04T21:39:00+02:00" });
  });

  it("leere Build-Argumente zaehlen nicht (docker compose ohne docker:build): dann Git", () => {
    const git = (args: string[]) => ({ "rev-list": "485", "rev-parse": "abc1234", log: "2026-10-05T08:00:00+02:00" })[args[0]] as string;
    expect(resolveAppVersion({ APP_VERSION: " ", APP_COMMIT: "" }, git)).toEqual({ version: "485", commit: "abc1234", date: "2026-10-05T08:00:00+02:00" });
  });

  it("weder Build-Argumente noch Git: dev", () => {
    expect(resolveAppVersion({}, noGit)).toEqual({ version: "dev", commit: null, date: null });
  });

  it("im Repository: fortlaufende Nummer und kurzer Hash aus Git", () => {
    const info = resolveAppVersion({});
    expect(info.version).toMatch(/^\d+$/);
    expect(info.commit).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe("Anzeige", () => {
  const i18n = i18next.createInstance();
  i18n.init({ lng: "de", fallbackLng: "de", resources: { de: { translation: de }, en: { translation: en } }, initImmediate: false });

  it("Nummer und Datum, Commit im Tooltip", () => {
    const { label, details } = formatAppVersion({ version: "484", commit: "8d8eff4", date: "2026-10-04T12:00:00Z" }, i18n.getFixedT("de"), "de");
    expect(label).toBe("Version 484 · 4.10.2026");
    expect(details).toMatch(/^Commit 8d8eff4 vom 04\.10\.26, \d{2}:\d{2}$/);
    expect(formatAppVersion({ version: "484", commit: "8d8eff4", date: "2026-10-04T12:00:00Z" }, i18n.getFixedT("en"), "en").details).toMatch(/^Commit 8d8eff4 from /);
  });

  it("dev ohne Datum und Commit", () => {
    expect(formatAppVersion({ version: "dev", commit: null, date: null }, i18n.getFixedT("de"), "de")).toEqual({ label: "Version dev", details: "Version dev" });
  });
});
