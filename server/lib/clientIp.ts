import type { Request } from "express";

/**
 * Client-IP für Rate-Limits öffentlicher Endpunkte.
 *
 * Nicht den ersten Eintrag aus `X-Forwarded-For` nehmen: den setzt der Aufrufer
 * selbst, jede Anfrage bekäme so eine neue „IP“ und das Limit wäre wirkungslos.
 * `req.ip` wertet den Header gemäß `trust proxy` (server/index.ts) aus, also nur
 * den Eintrag, den unser Reverse-Proxy angehängt hat.
 */
export function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "unknown").toString();
}
