/**
 * Antworten komprimiert senden (gzip/deflate/br nach Accept-Encoding). Grosse JSON-Listen
 * schrumpfen stark, z. B. der Lager-Abgleich in Testing von 7,7 MB auf ~0,7 MB.
 * Ausgenommen: Server-Sent Events - compression puffert, Benachrichtigungen kaemen sonst
 * erst verspaetet oder gar nicht an. Kleine Antworten (< 1 KB) bleiben unkomprimiert.
 */
import compression from "compression";
import type { Request, Response } from "express";

export function isEventStream(res: Response): boolean {
  return String(res.getHeader("Content-Type") ?? "").toLowerCase().startsWith("text/event-stream");
}

export function responseCompression() {
  return compression({
    threshold: 1024,
    filter: (req: Request, res: Response) => !isEventStream(res) && compression.filter(req, res),
  });
}
