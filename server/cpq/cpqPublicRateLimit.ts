/**
 * Anfragegrenzen für den öffentlichen Regalplaner (/api/cpq/public/*, /api/cpq-core/public/*) je IP.
 * Großzügig, weil der Regalplaner beim Ziehen der Regler mehrere Stücklisten pro Sekunde anfragt; Gast-Tokens
 * (guest-token) knapper. Begrenzter Speicher über windowRateLimit.ts.
 */
import type { Request, Response, NextFunction } from "express";
import { clientIp } from "../lib/clientIp";
import { createWindowRateLimiter } from "../lib/windowRateLimit";

const requestLimiter = createWindowRateLimiter({ windowMs: 60_000, max: 240, maxKeys: 20_000 });
const guestTokenLimiter = createWindowRateLimiter({ windowMs: 60_000, max: 30, maxKeys: 20_000 });

export const CPQ_PUBLIC_PATHS = ["/api/cpq/public", "/api/cpq-core/public"];

export function cpqPublicRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
  const ok = req.path === "/guest-token" ? guestTokenLimiter.hit(`t:${ip}`) && requestLimiter.hit(ip) : requestLimiter.hit(ip);
  if (!ok) return res.status(429).json({ error: "Too many requests" });
  next();
}
