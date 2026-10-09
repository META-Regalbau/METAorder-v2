import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "..", "docker.env") });
loadEnv({ path: path.resolve(__dirname, "..", ".env") });
loadEnv({ path: path.resolve(__dirname, "..", ".env.local") });

import express, { type Request, Response, NextFunction } from "express";
import http from "http";
import fs from "fs";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth/auth";
import { storage } from "./storage";
import { ensureVectorExtension } from "./db";
import { seedDatabase } from "./seedData";
import { startCrossSellScheduler } from "./cross-selling/crossSellScheduler";
import { runOfferLearning } from "./offers/offerLearning";
import { pollInboundEmails } from "./email/emailInbound";
import { runDunningJob } from "./invoicing/dunningJob";
import { metricsCollectorService } from "./services/metricsCollector";
import { initBackendSentry } from "./observability/sentry";
import { runShopwareMirrorSync } from "./shopware/shopwareMirror";
import { assertSecureSecret } from "./lib/secretGuard";
import { installConsoleBridge } from "./lib/consoleBridge";
import { requestIdMiddleware } from "./lib/requestContext";
import { responseCompression } from "./lib/responseCompression";
import { errorHandler, requestLoggingMiddleware } from "./lib/httpLogging";
import { registerAutomationTriggers, startAutomationScheduler } from "./automation";
import { getLogStoreSink, logStoreEnabled, logStoreRetentionDays } from "./lib/logStore";
import { insertAppLogs, pruneAppLogs } from "./lib/appLogRepository";

// Ab hier landen auch alle console.*-Aufrufe strukturiert im Logger (server/lib/logger.ts).
// Steht nach loadEnv (Imports laufen vorher), damit LOG_LEVEL/LOG_FORMAT aus .env greifen.
installConsoleBridge();

const app = express();
initBackendSentry(app);
// Request-ID fuer jede Anfrage (Header X-Request-Id, in jeder Log-Zeile als requestId)
app.use(requestIdMiddleware);
// gzip fuer Antworten (ohne Server-Sent Events), siehe server/lib/responseCompression.ts
app.use(responseCompression());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Debug log server: only in development, bind to localhost for security
const DEBUG_LOG_PATH = process.env.DEBUG_LOG_PATH || path.join(process.cwd(), ".logs", "debug.log");
if (process.env.NODE_ENV !== "production") {
  const debugLogServer = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 404;
      return res.end();
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const payload = body.trim();
        if (payload.length > 0) {
          fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
          fs.appendFileSync(DEBUG_LOG_PATH, `${payload}\n`);
        }
      } catch {
        // Intentionally ignore logging failures in debug sink
      }
      res.statusCode = 204;
      res.end();
    });
  });
  debugLogServer.listen(7242, "127.0.0.1");
}

// Hinter einem Reverse-Proxy (Mittwald, Docker-Setups), der TLS terminiert: X-Forwarded-* vertrauen
app.set("trust proxy", 1);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  // Default (100kb) is too small for endpoints that carry a base64 image in
  // the JSON body (e.g. POST /api/offer-drafts/from-cpq's composite Regal
  // preview, ~250-300KB) — 5mb gives comfortable headroom without being reckless.
  limit: "5mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Security Headers
app.use((_req, res, next) => {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Enable XSS protection
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http: blob: http://localhost:8090 http://127.0.0.1:8090; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: http://localhost:7242 http://127.0.0.1:7242 https://www.gstatic.com"
  );
  next();
});

// Refuse to run with a known dev-default secret (see server/lib/secretGuard.ts for why a
// plain "is it set" check doesn't work — docker-compose.yml always sets a fallback).
// SESSION_SECRET ist der Ersatz fuer JWT_SECRET/CUSTOMER_JWT_SECRET (server/auth/jwt.ts, authCustomer.ts).
assertSecureSecret("SESSION_SECRET", process.env.SESSION_SECRET);
assertSecureSecret("ENCRYPTION_KEY", process.env.ENCRYPTION_KEY);

// Anmeldung per JWT-Cookie (requireAuth); keine Server-Sitzung. Vorher lief express-session mit dem
// MemoryStore (Warnung "not designed for a production environment"), gespeichert wurde darin nie etwas:
// der Login ruft kein req.logIn, passport.session() fand nie einen Nutzer.
const passport = setupAuth(storage);
app.use(passport.initialize());

// CSRF Protection Middleware (Double-Submit Cookie Pattern)
// Apply to all state-changing requests except login
import { requireCsrf } from "./auth/auth";
import { logger } from "./lib/logger";

const moduleLog = logger.child({ component: "index" });
app.use((req, res, next) => {
  // Skip CSRF for login endpoint (no token exists yet)
  if (req.path === "/api/auth/login") {
    moduleLog.debug("[CSRF] Skipping CSRF check for login endpoint");
    return next();
  }
  // Notfall-Passwort-Reset: vor dem Login existiert kein CSRF-Token; die
  // Autorisierung läuft über den ADMIN_RESET_KEY im Request selbst.
  if (req.path === "/api/auth/emergency-reset") {
    return next();
  }
  // Automation mit Integrations-Key (kein Browser-Cookie für CSRF)
  const intKey = req.headers["x-metaorder-integration-key"];
  if (typeof intKey === "string" && intKey.trim().length > 0) {
    return next();
  }
  // Öffentliche Angebots-Landingpage (Autorisierung über Link-Token)
  if (req.path.startsWith("/api/public/")) {
    return next();
  }
  // Skip CSRF for debug ingest endpoint
  if (req.path.startsWith("/ingest/")) {
    return next();
  }
  // Apply CSRF validation to all other POST/PUT/DELETE requests
  requireCsrf(req, res, next);
});

app.use(requestLoggingMiddleware((metric) => metricsCollectorService.collectHttpMetric(metric)));

app.post("/ingest/:id", (req, res) => {
  try {
    const payload = JSON.stringify(req.body || {});
    if (payload && payload !== "{}") {
      fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
      fs.appendFileSync(DEBUG_LOG_PATH, `${payload}\n`);
    }
  } catch {
    // Intentionally ignore logging failures in debug sink
  }
  res.status(204).end();
});

/**
 * Systemprotokoll (Viewer /admin/logs): gepufferte Log-Zeilen ab jetzt in app_logs schreiben,
 * taeglich Eintraege nach LOG_STORE_DAYS loeschen; beim Beenden (SIGTERM) Rest noch schreiben.
 */
function startSystemLog() {
  if (!logStoreEnabled()) return;
  const sink = getLogStoreSink();
  sink.start(insertAppLogs);
  const prune = async () => {
    try {
      const days = logStoreRetentionDays();
      const deleted = await pruneAppLogs(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
      if (deleted > 0) moduleLog.info({ deleted, days }, `Systemprotokoll: ${deleted} Einträge älter als ${days} Tage gelöscht`);
    } catch (error) {
      moduleLog.error({ err: error }, "Systemprotokoll: Aufräumen fehlgeschlagen");
    }
  };
  setTimeout(prune, 2 * 60 * 1000).unref();
  setInterval(prune, 24 * 60 * 60 * 1000).unref();
  process.once("SIGTERM", () => {
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    void Promise.race([sink.stop(), timeout]).finally(() => process.exit(0));
  });
}

(async () => {
  await ensureVectorExtension();
  startSystemLog();
  // Seed database with initial users
  await seedDatabase(storage);
  
  const server = await registerRoutes(app);

  // Automatisierungsregeln: Ticket-Ereignisse und zeitgesteuerte Regeln (server/automation)
  registerAutomationTriggers(storage);
  startAutomationScheduler(storage);

  // Cross-Selling-Lernlauf je Mandant (server/cross-selling/crossSellScheduler.ts)
  startCrossSellScheduler(storage);

  const runOfferLearningJob = async () => {
    try {
      const tenants = await storage.getAllTenants();
      const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
      for (const tenantId of tenantIds) {
        try {
          const settings = await storage.getShopwareSettings(tenantId);
          if (!settings) {
            continue;
          }
          await runOfferLearning(storage, settings, tenantId);
          log(`[OfferLearning] Learning job completed for tenant ${tenantId ?? "default"}.`);
        } catch (error) {
          moduleLog.error({ err: error }, `[OfferLearning] Learning job failed for tenant: ${tenantId}`);
        }
      }
    } catch (error) {
      moduleLog.error({ err: error }, "[OfferLearning] Learning job failed:");
    }
  };

  const offerIntervalHours = Number(process.env.OFFER_LEARNING_INTERVAL_HOURS || 24);
  const offerIntervalMs = offerIntervalHours * 60 * 60 * 1000;
  setTimeout(runOfferLearningJob, 60 * 1000);
  setInterval(runOfferLearningJob, offerIntervalMs);

  const runEmailPolling = async () => {
    try {
      await pollInboundEmails(storage);
    } catch (error) {
      moduleLog.error({ err: error }, "[EmailInbound] Polling failed:");
    }
  };

  setTimeout(runEmailPolling, 15 * 1000);
  setInterval(runEmailPolling, 60 * 1000);

  const runDunning = async () => {
    try {
      await runDunningJob(storage);
    } catch (error) {
      moduleLog.error({ err: error }, "[DunningJob] Run failed:");
    }
  };

  const dunningIntervalMinutes = Number(process.env.DUNNING_INTERVAL_MINUTES || 60);
  const dunningIntervalMs = dunningIntervalMinutes * 60 * 1000;
  setTimeout(runDunning, 45 * 1000);
  setInterval(runDunning, dunningIntervalMs);

  // Suchindex (FAQ, semantische Suche): vorher nie aufgebaut. Kurz nach dem Start, dann regelmaessig;
  // inkrementell, unveraenderte Eintraege werden uebersprungen.
  if (process.env.SEMANTIC_INDEX_ENABLED !== "false") {
    const { runSemanticIndexAllTenants } = await import("./semantic/semanticIndexer");
    const semanticIntervalHours = Math.max(1, Number(process.env.SEMANTIC_INDEX_INTERVAL_HOURS || 6));
    const runSemanticIndexJob = () => runSemanticIndexAllTenants(storage, log).catch((error) => moduleLog.error({ err: error }, "[SemanticIndex] Job failed:"));
    setTimeout(runSemanticIndexJob, 2 * 60 * 1000);
    setInterval(runSemanticIndexJob, semanticIntervalHours * 60 * 60 * 1000);
    log(`[SemanticIndex] Index scheduled every ${semanticIntervalHours} hour(s)`);
  }

  const runMirrorSync = async () => {
    try {
      await runShopwareMirrorSync(storage);
      log("[ShopwareMirror] Background sync completed.");
    } catch (error) {
      moduleLog.error({ err: error }, "[ShopwareMirror] Background sync failed:");
    }
  };

  if (process.env.SHOPWARE_SYNC_ENABLED !== "false") {
    const syncIntervalMinutes = Number(process.env.SHOPWARE_SYNC_INTERVAL_MINUTES || 3);
    const syncIntervalMs = Math.max(1, syncIntervalMinutes) * 60 * 1000;
    setTimeout(runMirrorSync, 20 * 1000);
    setInterval(runMirrorSync, syncIntervalMs);
    log(`[ShopwareMirror] Sync scheduled every ${syncIntervalMinutes} minute(s)`);
  } else {
    log("[ShopwareMirror] Sync disabled via SHOPWARE_SYNC_ENABLED=false");
  }

  // CPQ 3D-Modelle (GLB) – gleicher Pfad wie in cpqGlbResolve (dist/public oder client/public)
  const { getCpqGlbDirectory } = await import("./cpq/cpqGlbResolve");
  const cpqGlbPath = getCpqGlbDirectory();
  if (fs.existsSync(cpqGlbPath)) {
    app.use("/cpq-models", express.static(cpqGlbPath));
    log(`[CPQ] GLB-Modelle unter ${cpqGlbPath} bereitgestellt (/cpq-models)`);
  } else {
    log(`[CPQ] GLB-Pfad nicht gefunden: ${cpqGlbPath} – 3D-Vorschau deaktiviert`);
  }

  // Prevent SPA fallback for unknown API routes
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const listenOpts: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  // Auf manchen Umgebungen (ältere Node-/OS-Kombinationen) kann reusePort Probleme machen — dann LISTEN_REUSE_PORT=false
  if (process.env.LISTEN_REUSE_PORT !== "false") {
    listenOpts.reusePort = true;
  }
  server.listen(listenOpts, () => {
    log(`serving on port ${port}`);
  });
})();
