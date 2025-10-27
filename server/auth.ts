import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import type { IStorage } from "./storage";
import type { User } from "@shared/schema";

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

// Middleware to check if user is authenticated
export function requireAuth(req: any, res: any, next: any) {
  console.log("[requireAuth] Checking authentication - isAuth:", req.isAuthenticated(), "sessionID:", req.sessionID, "session:", !!req.session);
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}

// Middleware to check if user has a specific permission
export function requirePermission(permission: string) {
  return (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) {
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
export const requireManageUsers = requirePermission("manageUsers");
export const requireManageRoles = requirePermission("manageRoles");
export const requireManageSettings = requirePermission("manageSettings");
export const requireManageCrossSellingGroups = requirePermission("manageCrossSellingGroups");
export const requireManageCrossSellingRules = requirePermission("manageCrossSellingRules");

// Legacy middleware - kept for backwards compatibility
// Prefer using permission-based checks (requireManageUsers, requireManageRoles, etc.)
export function requireAdmin(req: any, res: any, next: any) {
  if (req.isAuthenticated() && req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden: Admin access required" });
}
