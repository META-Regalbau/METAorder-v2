/**
 * Anfragegrenzen der öffentlichen Angebotsseite (/api/public/offers/:token/…): je IP für Abrufe, je IP und
 * Token-Anfang für Annahme/Ablehnung. Begrenzter Speicher (windowRateLimit.ts): zufällige Tokens oder IPs
 * füllen ihn nicht mehr dauerhaft.
 */
import { createWindowRateLimiter } from "../lib/windowRateLimit";

const WINDOW_MS = 60_000;
const MAX_GET = 120;
const MAX_POST = 30;
const MAX_KEYS = 20_000;

const getLimiter = createWindowRateLimiter({ windowMs: WINDOW_MS, max: MAX_GET, maxKeys: MAX_KEYS });
const mutationLimiter = createWindowRateLimiter({ windowMs: WINDOW_MS, max: MAX_POST, maxKeys: MAX_KEYS });

export function rateLimitPublicOfferGet(ip: string): boolean {
  return getLimiter.hit(`g:${ip}`);
}

export function rateLimitPublicOfferMutation(ip: string, tokenPrefix: string): boolean {
  return mutationLimiter.hit(`m:${ip}:${tokenPrefix.slice(0, 12)}`);
}
