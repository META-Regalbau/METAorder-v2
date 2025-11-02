import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import type { IStorage } from "./storage";
import type { User } from "@shared/schema";
import { verifyToken } from "./jwt";
import { storage } from "./storage";

export function setupAuth(storage: IStorage) {
  // Configure passport local strategy
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        
        if (!user) {
          return done(null, false, { message: "Incorrect username or password" });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        
        if (!isValidPassword) {
          return done(null, false, { message: "Incorrect username or password" });
        }

        return done(null, user);
      } catch (error) {
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
  
  // Extract hostname from origin/referer
  let requestOrigin = origin;
  if (origin) {
    try {
      const url = new URL(origin);
      requestOrigin = `${url.protocol}//${url.host}`;
    } catch (e) {
      // If parsing fails, use as-is
    }
  }
  
  // Check if origin is allowed
  // Allow: localhost, *.replit.dev, *.replit.app, or configured APP_URL
  const isOriginAllowed = 
    !requestOrigin || // No origin header (same-origin)
    requestOrigin.includes('localhost') ||
    requestOrigin.includes('.replit.dev') ||
    requestOrigin.includes('.replit.app') ||
    (process.env.APP_URL && requestOrigin.startsWith(process.env.APP_URL));
  
  if (!isOriginAllowed) {
    console.warn(`[CSRF] Rejected request from origin: ${requestOrigin}`);
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

// Middleware to check if user is authenticated via JWT
export async function requireAuth(req: any, res: any, next: any) {
  try {
    let token: string | null = null;
    
    // Try to get token from cookie first (primary auth method)
    if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }
    // Fallback: Extract token from Authorization header (for SSE)
    else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7); // Remove "Bearer " prefix
    }
    
    if (!token) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    
    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    
    // Load user from database
    const user = await storage.getUser(payload.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
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
    
    // Set user on request object
    req.user = user;
    
    next();
  } catch (error) {
    console.error("[requireAuth] Error:", error);
    res.status(401).json({ error: "Authentication failed" });
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
    
    if (roleDetails.permissions && roleDetails.permissions[permission]) {
      return next();
    }
    
    res.status(403).json({ error: `Forbidden: ${permission} permission required` });
  };
}

// Convenience middleware for common permission checks
export const requireViewDelayedOrders = requirePermission("viewDelayedOrders");
export const requireManageUsers = requirePermission("manageUsers");
export const requireManageRoles = requirePermission("manageRoles");
export const requireManageSettings = requirePermission("manageSettings");
export const requireManageCrossSellingGroups = requirePermission("manageCrossSellingGroups");
export const requireManageCrossSellingRules = requirePermission("manageCrossSellingRules");
export const requireViewTickets = requirePermission("viewTickets");
export const requireManageTickets = requirePermission("manageTickets");

// Legacy middleware - kept for backwards compatibility
// Prefer using permission-based checks (requireManageUsers, requireManageRoles, etc.)
export function requireAdmin(req: any, res: any, next: any) {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden: Admin access required" });
}
