import { createHash } from "crypto";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { verifyToken } from "./jwt";
import { storage } from "./storage";
import { runWithTenantContext } from "./tenantContext";

export function isStrictTenantMode(): boolean {
  const v = process.env.METAORDER_STRICT_TENANT?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Routen, die mit JWT-Auth ohne gewählten Mandanten erreichbar sein müssen (Mandantenwahl, Profil). */
export function isTenantOptionalApiPath(req: { method: string; path: string }): boolean {
  const m = req.method.toUpperCase();
  const p = req.path;
  if (m === "GET" && p === "/api/auth/me") return true;
  if (m === "GET" && p === "/api/tenants") return true;
  if (m === "POST" && p === "/api/tenants/select") return true;
  if (m === "GET" && p === "/api/auth/token") return true;
  if (m === "PUT" && p === "/api/profile") return true;
  if (m === "PUT" && p === "/api/profile/password") return true;
  return false;
}

export function setupAuth(storage: IStorage) {
  // Configure passport local strategy
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log('[AUTH] Attempting login for username:', username);
        const user = await storage.getUserByUsername(username);
        console.log('[AUTH] User found in database:', !!user, user ? `ID: ${user.id}` : 'null');
        
        if (!user) {
          console.log('[AUTH] No user found with username:', username);
          return done(null, false, { message: "Incorrect username or password" });
        }

        console.log('[AUTH] Comparing password for user:', user.username);
        const isValidPassword = await bcrypt.compare(password, user.password);
        console.log('[AUTH] Password valid:', isValidPassword);
        
        if (!isValidPassword) {
          console.log('[AUTH] Password mismatch for user:', username);
          return done(null, false, { message: "Incorrect username or password" });
        }

        console.log('[AUTH] Login successful for user:', username);
        return done(null, user);
      } catch (error) {
        console.error('[AUTH] Error during authentication:', error);
        return done(error);
      }
    })
  );

  // Serialize user to session
  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as User).id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      
      // Enrich user with role details including permissions
      const roleId = (user as any).roleId;
      if (roleId) {
        const role = await storage.getRole(roleId);
        if (role) {
          (user as any).roleDetails = role;
        }
      } else {
        // Fallback for legacy users without roleId: find role by name
        const allRoles = await storage.getAllRoles();
        const legacyRoleName = user.role === "admin" ? "Administrator" : "Employee";
        const fallbackRole = allRoles.find(r => r.name === legacyRoleName);
        if (fallbackRole) {
          (user as any).roleDetails = fallbackRole;
          // Update user with roleId for future requests
          await storage.updateUser(user.id, { roleId: fallbackRole.id });
        }
      }
      
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  return passport;
}

// Middleware to validate CSRF token (Double-Submit Cookie Pattern + Origin/Referer validation)
// Must be used after requireAuth for state-changing requests (POST/PUT/DELETE)
export function requireCsrf(req: any, res: any, next: any) {
  // Skip CSRF check for GET/HEAD/OPTIONS requests (they shouldn't modify state)
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  // Validate Origin or Referer header to prevent CSRF
  const origin = req.headers.origin || req.headers.referer;

  // Host, gegen den der Request tatsaechlich gestellt wurde (hinter Proxy:
  // x-forwarded-host). Echte Same-Origin-Requests (Origin-Host == Request-Host)
  // sind per Definition kein CSRF und werden zugelassen – das deckt u. a. den
  // Zugriff ueber die LAN-IP (http://<ip>:<port>) oder beliebige eigene Domains
  // ab. Der Double-Submit-Token (Header == Cookie) bleibt die eigentliche
  // CSRF-Absicherung.
  const requestHost = (
    (req.headers['x-forwarded-host'] as string | undefined) ||
    (req.headers.host as string | undefined) ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  const isOriginAllowed = (value?: string) => {
    if (!value) return true; // No origin header (same-origin)
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      // Same-Origin: Origin/Referer-Host stimmt mit dem Request-Host ueberein.
      if (requestHost && url.host.toLowerCase() === requestHost) return true;
      if (host === "localhost" || host === "127.0.0.1") return true;
      if (host.endsWith(".replit.dev") || host.endsWith(".replit.app")) return true;
      if (process.env.APP_URL) {
        const allowed = new URL(process.env.APP_URL);
        return url.origin === allowed.origin;
      }
      return false;
    } catch {
      return false;
    }
  };
  
  if (!isOriginAllowed(origin as string | undefined)) {
    console.warn(`[CSRF] Rejected request from origin: ${origin}`);
    return res.status(403).json({ error: "Invalid origin" });
  }
  
  // Get CSRF token from header
  const csrfTokenFromHeader = req.headers['x-csrf-token'];
  
  // Get CSRF token from cookie
  const csrfTokenFromCookie = req.cookies?.csrf_token;
  
  // Both must exist and match
  if (!csrfTokenFromHeader || !csrfTokenFromCookie) {
    return res.status(403).json({ error: "CSRF token missing" });
  }
  
  if (csrfTokenFromHeader !== csrfTokenFromCookie) {
    return res.status(403).json({ error: "CSRF token mismatch" });
  }
  
  // CSRF token is valid
  next();
}

/** Rolle/Tenant an Request hängen (JWT- und Integrations-Login). */
export async function attachAuthenticatedUser(req: any, user: User): Promise<void> {
  const roleId = (user as any).roleId;
  if (roleId) {
    const role = await storage.getRole(roleId);
    if (role) {
      (user as any).roleDetails = role;
    }
  } else {
    const allRoles = await storage.getAllRoles();
    const legacyRoleName = user.role === "admin" ? "Administrator" : "Employee";
    const fallbackRole = allRoles.find((r) => r.name === legacyRoleName);
    if (fallbackRole) {
      (user as any).roleDetails = fallbackRole;
      await storage.updateUser(user.id, { roleId: fallbackRole.id });
    }
  }

  req.user = user;

  let activeTenantId = (user as any).activeTenantId ?? null;
  if (!activeTenantId) {
    const userTenants = await storage.getTenantsForUser(user.id);
    if (userTenants.length === 1) {
      activeTenantId = userTenants[0].id;
      await storage.updateUser(user.id, { activeTenantId });
      (req.user as any).activeTenantId = activeTenantId;
    }
  }

  req.tenantId = activeTenantId;
}

/**
 * Wie requireAuth, oder API-Key-Header für n8n/Automation (ohne JWT).
 * Header: X-METAORDER-Integration-Key
 * - Zuerst Auflösung über Mandanten-Keys (SHA-256 in DB), sonst optional global METAORDER_INTEGRATION_API_KEY.
 */
export async function requireAuthOrIntegrationKey(req: any, res: any, next: any) {
  try {
    const rawHeader = req.headers["x-metaorder-integration-key"];
    const headerKey = typeof rawHeader === "string" ? rawHeader.trim() : "";

    async function loadIntegrationUser() {
      const explicitUserId = process.env.METAORDER_INTEGRATION_USER_ID?.trim();
      return explicitUserId
        ? await storage.getUser(explicitUserId)
        : await storage.getUserByUsername("n8n-service");
    }

    if (headerKey) {
      const keyHash = createHash("sha256").update(headerKey, "utf8").digest("hex");
      const tenantFromKey = await storage.findTenantIdByIntegrationKeyHash(keyHash);

      if (tenantFromKey) {
        const user = await loadIntegrationUser();
        if (!user) {
          return res.status(500).json({
            error:
              "Kein Integrations-Benutzer gefunden (n8n-service oder METAORDER_INTEGRATION_USER_ID).",
          });
        }
        const tenants = await storage.getTenantsForUser(user.id);
        if (!tenants.some((t) => t.id === tenantFromKey)) {
          return res.status(403).json({
            error: "Integrations-Benutzer ist diesem Mandanten nicht zugeordnet.",
          });
        }
        await attachAuthenticatedUser(req, user);
        req.tenantId = tenantFromKey;
        (req.user as any).activeTenantId = tenantFromKey;
        return runWithTenantContext(tenantFromKey, () => next());
      }

      const configured = process.env.METAORDER_INTEGRATION_API_KEY?.trim();
      if (configured && headerKey === configured) {
        const user = await loadIntegrationUser();
        if (!user) {
          return res.status(500).json({
            error:
              "METAORDER_INTEGRATION_API_KEY ist gesetzt, aber kein Integrations-Benutzer gefunden (n8n-service oder METAORDER_INTEGRATION_USER_ID).",
          });
        }
        await attachAuthenticatedUser(req, user);
        if (isStrictTenantMode()) {
          const forced = process.env.METAORDER_INTEGRATION_TENANT_ID?.trim();
          if (!forced) {
            return res.status(500).json({
              error:
                "METAORDER_STRICT_TENANT: für den globalen Integrations-Key METAORDER_INTEGRATION_TENANT_ID setzen oder einen mandantenspezifischen Key anlegen.",
            });
          }
          const tenants = await storage.getTenantsForUser(user.id);
          if (!tenants.some((t) => t.id === forced)) {
            return res.status(403).json({
              error: "Integrations-Benutzer ist nicht dem in METAORDER_INTEGRATION_TENANT_ID gesetzten Mandanten zugeordnet.",
            });
          }
          req.tenantId = forced;
          (req.user as any).activeTenantId = forced;
        }
        return runWithTenantContext(req.tenantId, () => next());
      }
    }

    return requireAuth(req, res, next);
  } catch (error) {
    console.error("[requireAuthOrIntegrationKey] Error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
}

// Middleware to check if user is authenticated via JWT
export async function requireAuth(req: any, res: any, next: any) {
  try {
    let token: string | null = null;

    if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7);
    }

    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const user = await storage.getUser(payload.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    await attachAuthenticatedUser(req, user);
    if (isStrictTenantMode() && !isTenantOptionalApiPath(req)) {
      return requireTenant(req, res, next);
    }
    runWithTenantContext(req.tenantId, () => next());
  } catch (error) {
    console.error("[requireAuth] Error:", error);
    res.status(401).json({ error: "Authentication failed" });
  }
}

// Middleware to require an active tenant selection for tenant-scoped routes
export async function requireTenant(req: any, res: any, next: any) {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userTenants = await storage.getTenantsForUser(user.id);
    if (userTenants.length === 0) {
      return res.status(403).json({ error: "No tenants assigned" });
    }

    const activeTenantId = user.activeTenantId;
    const hasActiveTenant = activeTenantId && userTenants.some((t) => t.id === activeTenantId);
    let resolvedTenantId = hasActiveTenant ? activeTenantId : null;

    if (!resolvedTenantId) {
      if (userTenants.length === 1) {
        resolvedTenantId = userTenants[0].id;
        await storage.updateUser(user.id, { activeTenantId: resolvedTenantId });
        (req.user as any).activeTenantId = resolvedTenantId;
      } else {
        return res.status(400).json({ error: "Tenant not selected" });
      }
    }

    req.tenantId = resolvedTenantId;
    runWithTenantContext(resolvedTenantId, () => next());
  } catch (error) {
    console.error("[requireTenant] Error:", error);
    return res.status(500).json({ error: "Tenant selection failed" });
  }
}

// Middleware to check if user has a specific permission
// Must be used after requireAuth middleware
export function requirePermission(permission: string) {
  return async (req: any, res: any, next: any) => {
    // First check authentication (requireAuth should have already run)
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized: Please login" });
    }
    
    const user = req.user as any;
    const roleDetails = user.roleDetails;
    
    if (!roleDetails) {
      return res.status(403).json({ error: "Forbidden: No role assigned" });
    }
    
    // Support both Array (from database) and Object (legacy) permission formats
    const permissions = roleDetails.permissions;
    
    if (permissions) {
      // Check if permissions is an array (new format from database)
      if (Array.isArray(permissions)) {
        if (permissions.includes(permission)) {
          return next();
        }
      }
      // Check if permissions is an object (current format with boolean values)
      else if (permissions[permission]) {
        return next();
      }
    }
    
    res.status(403).json({ error: `Forbidden: ${permission} permission required` });
  };
}

export const requireViewAnalytics = requirePermission("viewAnalytics");

// Convenience middleware for common permission checks
export const requireViewDelayedOrders = requirePermission("viewDelayedOrders");
export const requireManageUsers = requirePermission("manageUsers");
export const requireManageRoles = requirePermission("manageRoles");
export const requireManageSettings = requirePermission("manageSettings");
export const requireManageCrossSellingGroups = requirePermission("manageCrossSellingGroups");
export const requireManageCrossSellingRules = requirePermission("manageCrossSellingRules");
export const requireViewTickets = requirePermission("viewTickets");
export const requireManageTickets = requirePermission("manageTickets");
export const requireViewShipping = requirePermission("viewShipping");
export const requireEditOrders = requirePermission("editOrders");
export const requireManageAutomations = requirePermission("manageAutomations");
export const requireManageOrderDrafts = requirePermission("manageOrderDrafts");
/** Mindestens eines: Angebots- oder Bestellentwürfe hochladen (KI-Commercial-Upload). */
export async function requireManageCommercialDraftUpload(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized: Please login" });
  }
  const user = req.user as any;
  const roleDetails = user.roleDetails;
  if (!roleDetails) {
    return res.status(403).json({ error: "Forbidden: No role assigned" });
  }
  const permissions = roleDetails.permissions;
  let hasOrder = false;
  let hasOffer = false;
  if (permissions) {
    if (Array.isArray(permissions)) {
      hasOrder = permissions.includes("manageOrderDrafts");
      hasOffer = permissions.includes("manageOffers");
    } else {
      hasOrder = Boolean(permissions.manageOrderDrafts);
      hasOffer = Boolean(permissions.manageOffers);
    }
  }
  if (hasOrder || hasOffer) {
    return next();
  }
  return res.status(403).json({
    error: "Forbidden: manageOffers oder manageOrderDrafts erforderlich",
  });
}
export const requireViewOffers = requirePermission("viewOffers");
export const requireManageOffers = requirePermission("manageOffers");
export const requireViewNaturalLanguageAnalytics = requirePermission("viewNaturalLanguageAnalytics");
export const requireViewDocuments = requirePermission("viewDocuments");
export const requireManageDocuments = requirePermission("manageDocuments");
export const requireViewCrm = requirePermission("viewCrm");
export const requireManageCrm = requirePermission("manageCrm");
export const requireApproveCrm = requirePermission("approveCrm");
export const requireViewCPQ = requirePermission("viewCPQ");
export const requireManageCPQ = requirePermission("manageCPQ");
export const requireManageCPQDiscountLevels = requirePermission("manageCPQDiscountLevels");
export const requireApproveCPQQuotes = requirePermission("approveCPQQuotes");
export const requireViewAccounting = (req: any, res: any, next: any) => {
  const user = req.user as any;
  const isAdmin =
    user?.roleDetails?.name === "Administrator" ||
    user?.role === "admin";
  if (isAdmin) {
    return next();
  }
  return requirePermission("viewAccounting")(req, res, next);
};
export const requireManageProducts = (req: any, res: any, next: any) => {
  const user = req.user as any;
  const isAdmin =
    user?.roleDetails?.name === "Administrator" ||
    user?.role === "admin";
  if (isAdmin) {
    return next();
  }
  return requirePermission("manageProducts")(req, res, next);
};

// Legacy middleware - kept for backwards compatibility
// Prefer using permission-based checks (requireManageUsers, requireManageRoles, etc.)
export function requireAdmin(req: any, res: any, next: any) {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden: Admin access required" });
}
