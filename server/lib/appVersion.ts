import { execFileSync } from "node:child_process";
import type { AppVersionInfo } from "@shared/appVersion";

/**
 * Versionsangabe der laufenden App (Sidebar unten, GET /api/version).
 *
 * version: fortlaufende Nummer = Anzahl der Commits bis zum gebauten Stand. main ist linear, jede
 * Uebernahme erhoeht sie; niemand muss sie von Hand pflegen.
 * commit/date: kurzer Git-Hash und Datum dieses Commits (der Hash ist auch der Image-Tag im Deploy).
 *
 * Im Docker-Image gibt es kein .git: die CI (deploy-mittwald.yml) und `npm run docker:build`
 * setzen APP_VERSION, APP_COMMIT und APP_COMMIT_DATE als Build-Argumente. Ohne sie (npm run dev)
 * wird Git gefragt; geht auch das nicht, steht "dev" da.
 */
type Env = Record<string, string | undefined>;
type Git = (args: string[]) => string;

const runGit: Git = (args) =>
  execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();

export function resolveAppVersion(env: Env = process.env, git: Git = runGit): AppVersionInfo {
  const fromEnv = env.APP_VERSION?.trim();
  if (fromEnv) {
    return { version: fromEnv, commit: env.APP_COMMIT?.trim() || null, date: env.APP_COMMIT_DATE?.trim() || null };
  }
  try {
    return {
      version: git(["rev-list", "--count", "HEAD"]),
      commit: git(["rev-parse", "--short=7", "HEAD"]),
      date: git(["log", "-1", "--format=%cI"]),
    };
  } catch {
    return { version: "dev", commit: null, date: null };
  }
}

let cached: AppVersionInfo | null = null;

/** Einmal beim ersten Aufruf ermittelt; die Version aendert sich nur mit einem neuen Build. */
export function getAppVersion(): AppVersionInfo {
  cached ??= resolveAppVersion();
  return cached;
}
