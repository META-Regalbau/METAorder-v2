/**
 * Prüfung der Adressen, die METAorder mit den Zugangsdaten der Integration an die Shopware-Admin-API schickt.
 *
 * Viele Aufrufe setzen IDs aus der Anfrage direkt in den Pfad ein (`${baseUrl}/api/order/${id}`). Express
 * dekodiert Pfad-Parameter, eine ID wie `..%2F..%2Fuser` würde also zu `../../user` und nach der
 * URL-Normalisierung einen ganz anderen Endpunkt treffen. assertSafeShopwareUrl lehnt solche Pfade zentral ab
 * (in jedem makeAuthenticatedRequest); isShopwareId prüft IDs dort, wo sie aus der Anfrage kommen.
 */

export class UnsafeShopwareUrlError extends Error {
  constructor() {
    super("Ungültige Kennung in der Shopware-Anfrage");
    this.name = "UnsafeShopwareUrlError";
  }
}

/** Shopware-IDs: 32 Hex-Zeichen (UUID ohne Bindestriche). */
export const SHOPWARE_ID_RE = /^[0-9a-f]{32}$/i;

export function isShopwareId(value: unknown): value is string {
  return typeof value === "string" && SHOPWARE_ID_RE.test(value);
}

/** Pfad-Teil der Adresse (ohne Schema/Host, ohne Query) – ohne URL-Normalisierung, also so, wie er gebaut wurde. */
function rawPath(url: string): string {
  const cut = url.search(/[?#]/);
  const beforeQuery = cut >= 0 ? url.slice(0, cut) : url;
  return beforeQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
}

/**
 * Wirft UnsafeShopwareUrlError, wenn der Pfad Punkt-Segmente (`.`/`..`), kodierte Schräg- oder Rückstriche,
 * kodierte Punkte, Rückstriche oder ein Fragment enthält. Normale API-Pfade enthalten nichts davon.
 */
export function assertSafeShopwareUrl(url: string): void {
  const path = rawPath(url);
  if (/(^|\/)\.{1,2}(\/|$)/.test(path) || /%2e|%2f|%5c|\\/i.test(path) || url.includes("#")) {
    throw new UnsafeShopwareUrlError();
  }
}
