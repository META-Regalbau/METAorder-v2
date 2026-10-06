import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";
import { areaForPath } from "./logAreas";

/**
 * Eine Log-Zeile je API-Anfrage: Methode, Pfad, Status, Dauer, requestId, tenantId, userId.
 * Der Antwort-Inhalt wird bewusst NICHT geloggt (konnte personenbezogene Daten enthalten).
 * REQUEST_LOG_SLOW_MS: Anfragen ab dieser Dauer zusaetzlich als Warnung "[slow-request]".
 */
export function requestLoggingMiddleware(onApiRequest?: (m: { route: string; method: string; statusCode: number; durationMs: number }) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;
      const durationMs = Date.now() - start;
      const fields = {
        requestId: req.requestId,
        tenantId: req.tenantId ?? undefined,
        userId: (req.user as { id?: string } | undefined)?.id,
        component: "http",
        area: areaForPath(path) ?? "system",
        method: req.method,
        path,
        status: res.statusCode,
        durationMs,
      };
      const slowMs = Number(process.env.REQUEST_LOG_SLOW_MS || "0");
      if (slowMs > 0 && durationMs >= slowMs) {
        logger.warn({ ...fields, slow: true }, `[slow-request] ${durationMs}ms ${req.method} ${path} ${res.statusCode}`);
      }
      // 5xx = Fehler, 4xx = Warnung (ausser 401 nicht angemeldet und 404), sonst Info
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404 ? "warn" : "info";
      logger[level](fields, `${req.method} ${path} ${res.statusCode} in ${durationMs}ms`);
      onApiRequest?.({ route: path, method: req.method, statusCode: res.statusCode, durationMs });
    });

    next();
  };
}

/**
 * Letzter Fehler-Handler: loggt den Fehler mit Stacktrace und requestId und antwortet wie
 * bisher mit { message }. Kein erneutes Werfen mehr (frueher `throw err`: Express' Standard-
 * Handler hat dann nur den Stack ausgegeben und bei bereits gesendeter Antwort die Verbindung
 * gekappt). Ist die Antwort schon unterwegs, uebernimmt Express wie vorgesehen (next(err)).
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const status = err?.status || err?.statusCode || 500;
  const fields = { err, requestId: req.requestId, area: areaForPath(req.path) ?? "system", method: req.method, path: req.path, status };
  if (status >= 500) logger.error(fields, `Unbehandelter Fehler: ${req.method} ${req.path}`);
  else logger.warn(fields, `Fehler ${status}: ${req.method} ${req.path}`);

  if (res.headersSent) return next(err);
  res.status(status).json({ message: err?.message || "Internal Server Error" });
}
