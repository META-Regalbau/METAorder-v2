import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { seedDatabase } from "./seedData";

const app = express();

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
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'"
  );
  next();
});

// Session configuration with configurable timeout
const sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || '86400000', 10); // Default: 24 hours
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      // Replit always uses HTTPS, so cookies must be secure even in development
      secure: true,
      httpOnly: true,
      // Use "lax" for CSRF protection while still allowing same-site navigation
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
  if (req.path === '/api/auth/login') {
    console.log('[CSRF] Skipping CSRF check for login endpoint');
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
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Seed database with initial users
  await seedDatabase(storage);
  
  const server = await registerRoutes(app);

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
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
