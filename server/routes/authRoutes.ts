// Anmeldung: Login/Logout, Notfall-Passwort-Reset, Sitzung (me/token) und eigenes Profil.
import passport from "passport";
import { generateToken } from "../auth/jwt";
import crypto from "crypto";
import { storage } from "../storage";
import bcrypt from "bcryptjs";
import { requireAuth, requireCsrf } from "../auth/auth";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import type { Express } from "express";
import { getAppVersion } from "../lib/appVersion";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/authRoutes" });


// Rate limiter for login endpoint - prevents brute force attacks
const loginRateLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
  skip: () => process.env.DISABLE_LOGIN_RATE_LIMIT === "true",
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});


// Rate limiter for the hidden emergency password reset - stricter than login,
// failed attempts count (skipSuccessfulRequests would let an attacker probe the key)
const emergencyResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Zu viele Versuche. Bitte später erneut versuchen." },
  standardHeaders: true,
  legacyHeaders: false,
});

export function registerAuthRoutes(app: Express): void {
  // Versionsangabe (Sidebar unten); ohne Anmeldung - enthaelt nur Nummer, Commit und Datum
  app.get("/api/version", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(getAppVersion());
  });

  // Authentication routes
  app.post("/api/auth/login", loginRateLimiter, (req, res, next) => {
    moduleLog.info({ username: req.body?.username }, "[LOGIN] Login request received");
    passport.authenticate("local", (err: any, user: any, info: any) => {
      moduleLog.info({ details: { err: !!err, user: !!user, info } }, "[LOGIN] Passport authenticate callback");
      if (err) {
        moduleLog.error({ err }, "[LOGIN] Authentication error:");
        return res.status(500).json({ error: "Internal server error" });
      }
      
      if (!user) {
        moduleLog.info("[LOGIN] No user found, invalid credentials");
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      
      moduleLog.info("[LOGIN] User authenticated successfully, generating tokens");
      // Generate JWT token
      const token = generateToken(user);
      
      // Generate CSRF token for Double-Submit Cookie Pattern
      const csrfToken = crypto.randomBytes(32).toString('hex');
      
      // Set JWT token in httpOnly cookie (XSS-safe)
      // Safari 16.4+ Bug: SameSite=Lax cookies are not sent with fetch requests (WebKit #255524).
      // Workaround: Use SameSite=None with Secure for HTTPS - Safari sends these correctly.
      const isSecureRequest =
        req.secure || req.headers["x-forwarded-proto"] === "https";
      const cookieSameSite = isSecureRequest ? ("none" as const) : ("lax" as const);
      res.cookie('auth_token', token, {
        httpOnly: true,  // Cannot be accessed by JavaScript
        secure: isSecureRequest,
        sameSite: cookieSameSite,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/' // Explicitly set path
      });
      
      // Set CSRF token in non-httpOnly cookie (frontend can read it)
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false, // Frontend must read and send in X-CSRF-Token header
        secure: isSecureRequest,
        sameSite: cookieSameSite,
        maxAge: 24 * 60 * 60 * 1000,
        path: '/' // Explicitly set path
      });
      
      // Don't send password to client
      const { password, ...userWithoutPassword } = user;
      
      return res.json({ 
        user: userWithoutPassword
        // Token is now in cookie, not in response body
      });
    })(req, res, next);
  });
  
  app.post("/api/auth/logout", (req, res) => {
    // Must match cookie options used at login for clearCookie to work
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";
    const sameSite = isSecure ? ("none" as const) : ("lax" as const);
    res.clearCookie('auth_token', {
      httpOnly: true,
      secure: isSecure,
      sameSite,
      path: '/'
    });
    res.clearCookie('csrf_token', {
      httpOnly: false,
      secure: isSecure,
      sameSite,
      path: '/'
    });
    res.json({ message: "Logged out successfully" });
  });

  // Versteckter Notfall-Passwort-Reset (Login-Seite: Ctrl+Shift+Alt+R).
  // Nur aktiv, wenn ADMIN_RESET_KEY in der Umgebung gesetzt ist — ohne Key
  // antwortet der Endpoint identisch zu "falscher Schlüssel", damit seine
  // Existenz von außen nicht erkennbar ist.
  app.post("/api/auth/emergency-reset", emergencyResetRateLimiter, async (req, res) => {
    const denied = () => res.status(403).json({ error: "Reset nicht möglich" });
    try {
      const configuredKey = process.env.ADMIN_RESET_KEY?.trim();
      const { username, resetKey, newPassword } = req.body ?? {};
      if (
        typeof username !== "string" ||
        typeof resetKey !== "string" ||
        typeof newPassword !== "string"
      ) {
        return denied();
      }
      if (!configuredKey) {
        moduleLog.warn("[EMERGENCY-RESET] Versuch, aber ADMIN_RESET_KEY ist nicht gesetzt");
        return denied();
      }
      // Timing-sicherer Vergleich über SHA-256 (gleiche Länge unabhängig von der Eingabe)
      const providedHash = crypto.createHash("sha256").update(resetKey, "utf8").digest();
      const configuredHash = crypto.createHash("sha256").update(configuredKey, "utf8").digest();
      if (!crypto.timingSafeEqual(providedHash, configuredHash)) {
        moduleLog.warn(`[EMERGENCY-RESET] Ungültiger Reset-Schlüssel (username=${username})`);
        return denied();
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Neues Passwort muss mindestens 8 Zeichen haben" });
      }
      const user = await storage.getUserByUsername(username.trim());
      if (!user) {
        // Schlüssel war korrekt — hier darf die Meldung konkret sein
        return res.status(404).json({ error: "Benutzer nicht gefunden" });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashedPassword });
      moduleLog.info(`[EMERGENCY-RESET] Passwort für "${user.username}" wurde zurückgesetzt`);
      return res.json({ message: "Passwort zurückgesetzt" });
    } catch (error) {
      moduleLog.error({ err: error }, "[EMERGENCY-RESET] Error:");
      return res.status(500).json({ error: "Reset fehlgeschlagen" });
    }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    // req.user is set by requireAuth middleware
    const { password, roleDetails, ...userWithoutPassword } = req.user as any;
    res.json({ 
      user: {
        ...userWithoutPassword,
        permissions: roleDetails?.permissions || {}
      }
    });
  });

  // Get JWT token from cookie (for SSE initialization)
  app.get("/api/auth/token", requireAuth, (req, res) => {
    // Read token from cookie and return it for SSE usage
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.status(401).json({ error: "No token found" });
    }
    res.json({ token });
  });

  // Profile management routes
  app.put("/api/profile", requireAuth, requireCsrf, async (req, res) => {
    try {
      const user = req.user as any;
      const updateSchema = z.object({
        email: z.string().email("Invalid email format").optional(),
        username: z.string().min(3, "Username must be at least 3 characters").optional(),
      });
      
      const validated = updateSchema.parse(req.body);
      
      // Check if username is already taken by another user
      if (validated.username && validated.username !== user.username) {
        const existingUser = await storage.getUserByUsername(validated.username);
        if (existingUser && existingUser.id !== user.id) {
          return res.status(400).json({ error: "Username already taken" });
        }
      }
      
      const updatedUser = await storage.updateUser(user.id, validated);
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const { password, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      moduleLog.error({ err: error }, "Error updating profile:");
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.put("/api/profile/password", requireAuth, requireCsrf, async (req, res) => {
    try {
      const user = req.user as any;
      const passwordSchema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(6, "New password must be at least 6 characters"),
        confirmPassword: z.string().min(1, "Password confirmation is required"),
      }).refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      });
      
      const validated = passwordSchema.parse(req.body);
      
      // Verify current password
      const currentUser = await storage.getUser(user.id);
      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const isValidPassword = await bcrypt.compare(validated.currentPassword, currentUser.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(validated.newPassword, 10);
      
      // Update password
      await storage.updateUser(user.id, { password: hashedPassword });
      
      res.json({ message: "Password updated successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      moduleLog.error({ err: error }, "Error updating password:");
      res.status(500).json({ error: "Failed to update password" });
    }
  });
}
