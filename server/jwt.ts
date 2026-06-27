import jwt from "jsonwebtoken";
import type { User } from "@shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required. Refusing to start without a secure secret.");
}
const JWT_SECRET_VALUE = JWT_SECRET as string;
const JWT_EXPIRES_IN = "24h";

export interface JWTPayload {
  userId: string;
  username: string;
  roleId: string | null;
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(user: User): string {
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    roleId: user.roleId,
  };

  return jwt.sign(payload, JWT_SECRET_VALUE, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify and decode a JWT token
 * Returns the decoded payload if valid, null if invalid
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE);
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "userId" in decoded &&
      "username" in decoded &&
      "roleId" in decoded
    ) {
      return decoded as JWTPayload;
    }
    return null;
  } catch (error) {
    return null;
  }
}
