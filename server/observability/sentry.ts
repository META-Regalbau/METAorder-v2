import type { Express } from "express";
import { createRequire } from "module";

type SentryNodeSdk = {
  init: (options: Record<string, unknown>) => void;
  setupExpressErrorHandler?: (app: Express) => void;
};

const require = createRequire(import.meta.url);

function getSentryNodeSdk(): SentryNodeSdk | null {
  try {
    return require("@sentry/node") as SentryNodeSdk;
  } catch {
    return null;
  }
}

export function initBackendSentry(app: Express): void {
  const dsn = process.env.SENTRY_DSN_BACKEND?.trim();
  if (!dsn) return;

  const sentry = getSentryNodeSdk();
  if (!sentry) {
    console.warn("[monitoring] Sentry SDK fehlt. TODO verify: `npm i @sentry/node` ausführen.");
    return;
  }

  sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version || "unknown",
  });

  if (typeof sentry.setupExpressErrorHandler === "function") {
    sentry.setupExpressErrorHandler(app);
  }
}
