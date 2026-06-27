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
import session from "express-session";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { ensureVectorExtension } from "./db";
import { seedDatabase } from "./seedData";
import { runCrossSellLearning } from "./crossSellLearning";
import { runOfferLearning } from "./offerLearning";
import { pollInboundEmails } from "./emailInbound";
import { runDunningJob } from "./dunningJob";
import { metricsCollectorService } from "./services/metricsCollector";
import { initBackendSentry } from "./observability/sentry";

const app = express();
initBackendSentry(app);

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

// Trust proxy for Replit (Replit terminates TLS at reverse proxy in all environments)
app.set("trust proxy", 1);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
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
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http: blob: http://localhost:8090 http://127.0.0.1:8090; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' http://localhost:7242 http://127.0.0.1:7242 https://www.gstatic.com"
  );
  next();
});

// Session configuration with configurable timeout
const sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || '86400000', 10); // Default: 24 hours

// Check for required secrets in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET) {
    console.error('[SECURITY WARNING] SESSION_SECRET not set! Using insecure default. Set SESSION_SECRET environment variable!');
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error('[SECURITY WARNING] ENCRYPTION_KEY not set! Shopware credentials will be encrypted with default key. Set ENCRYPTION_KEY environment variable!');
  }
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    proxy: true, // Trust proxy for correct cookie behavior
    cookie: {
      // Replit always uses HTTPS, so cookies must be secure even in development
      secure: 'auto', // Auto-detect based on proxy headers
      httpOnly: true,
      // Use "lax" for CSRF protection while allowing same-site navigation
      sameSite: "lax",
      maxAge: sessionTimeout, // Configurable via SESSION_TIMEOUT env var
    },
  })
);

// Initialize passport
const passport = setupAuth(storage);
app.use(passport.initialize());
app.use(passport.session());

// CSRF Protection Middleware (Double-Submit Cookie Pattern)
// Apply to all state-changing requests except login
import { requireCsrf } from "./auth";
app.use((req, res, next) => {
  // Skip CSRF for login endpoint (no token exists yet)
  if (req.path === "/api/auth/login") {
    console.log('[CSRF] Skipping CSRF check for login endpoint');
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

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const slowMs = Number(process.env.REQUEST_LOG_SLOW_MS || "0");
    if (slowMs > 0 && duration >= slowMs && path.startsWith("/api")) {
      console.warn(`[slow-request] ${duration}ms ${req.method} ${path} ${res.statusCode}`);
    }
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
      metricsCollectorService.collectHttpMetric({
        route: path,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: duration,
      });
    }
  });

  next();
});

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

(async () => {
  await ensureVectorExtension();
  // Seed database with initial users
  await seedDatabase(storage);
  
  const server = await registerRoutes(app);

  const runLearningJob = async () => {
    try {
      const tenants = await storage.getAllTenants();
      const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
      for (const tenantId of tenantIds) {
        try {
          const settings = await storage.getShopwareSettings(tenantId);
          if (!settings) {
            continue;
          }
          await runCrossSellLearning(storage, settings, tenantId);
          log(`[CrossSellLearning] Learning job completed for tenant ${tenantId ?? "default"}.`);
        } catch (error) {
          console.error("[CrossSellLearning] Learning job failed for tenant:", tenantId, error);
        }
      }
    } catch (error) {
      console.error("[CrossSellLearning] Learning job failed:", error);
    }
  };

  const intervalHours = Number(process.env.CROSS_SELL_LEARNING_INTERVAL_HOURS || 24);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  setTimeout(runLearningJob, 30 * 1000);
  setInterval(runLearningJob, intervalMs);

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
          console.error("[OfferLearning] Learning job failed for tenant:", tenantId, error);
        }
      }
    } catch (error) {
      console.error("[OfferLearning] Learning job failed:", error);
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
      console.error("[EmailInbound] Polling failed:", error);
    }
  };

  setTimeout(runEmailPolling, 15 * 1000);
  setInterval(runEmailPolling, 60 * 1000);

  const runDunning = async () => {
    try {
      await runDunningJob(storage);
    } catch (error) {
      console.error("[DunningJob] Run failed:", error);
    }
  };

  const dunningIntervalMinutes = Number(process.env.DUNNING_INTERVAL_MINUTES || 60);
  const dunningIntervalMs = dunningIntervalMinutes * 60 * 1000;
  setTimeout(runDunning, 45 * 1000);
  setInterval(runDunning, dunningIntervalMs);

  // CPQ 3D-Modelle (GLB) – gleicher Pfad wie in cpqGlbResolve (dist/public oder client/public)
  const { getCpqGlbDirectory } = await import("./cpqGlbResolve");
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

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
