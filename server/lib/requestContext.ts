import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Request-ID je HTTP-Anfrage (AsyncLocalStorage). Der Logger haengt sie an jede Log-Zeile,
 * die waehrend der Anfrage entsteht; die Antwort traegt sie im Header `X-Request-Id`, damit
 * sich Fehlermeldungen von Nutzern den Logs zuordnen lassen.
 */
type RequestContext = { requestId: string };

const requestContext = new AsyncLocalStorage<RequestContext>();

/** Uebernimmt eine mitgeschickte ID (z. B. vom Proxy), wenn sie harmlos aussieht. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function getRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null;
}

export function runWithRequestId<T>(requestId: string | null | undefined, fn: () => T): T {
  if (!requestId) return fn();
  return requestContext.run({ requestId }, fn);
}

/** Erste Middleware: Request-ID vergeben, im Header zurueckgeben, Kontext fuer den Rest der Anfrage setzen. */
export function requestIdMiddleware(
  req: { headers: Record<string, unknown>; requestId?: string },
  res: { setHeader(name: string, value: string): unknown },
  next: () => void,
): void {
  const requestId = resolveRequestId(req.headers["x-request-id"]);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  requestContext.run({ requestId }, next);
}
