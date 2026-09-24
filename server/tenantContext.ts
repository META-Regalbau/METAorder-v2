import { AsyncLocalStorage } from "node:async_hooks";

type TenantContext = {
  tenantId: string | null;
};

const tenantContext = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext(tenantId: string | null, fn: () => void) {
  tenantContext.run({ tenantId }, fn);
}

export function getTenantIdFromContext(): string | null {
  return tenantContext.getStore()?.tenantId ?? null;
}

/**
 * Express-Middleware: Mandanten-Kontext NACH multer wiederherstellen.
 *
 * multer (Multipart-Parsing) bricht die AsyncLocalStorage-Weitergabe: nach dem Upload
 * liefert `getTenantIdFromContext()` null. Alle Aufrufe wie `storage.getSetting("…")`
 * ohne explizite tenantId fanden dann KEINE Mandanten-Einstellungen — der Commercial
 * Agent lief bei Datei-Uploads ohne KI-Konfiguration (Intent „unclear", nur lokale
 * Extraktion). Diese Middleware gehört direkt hinter jedes `upload.single/array(...)`.
 */
export function restoreTenantContext(
  req: { tenantId?: string | null },
  _res: unknown,
  next: () => void
): void {
  runWithTenantContext(req.tenantId ?? null, () => next());
}
