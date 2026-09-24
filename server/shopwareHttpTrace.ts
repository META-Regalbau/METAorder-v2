/**
 * Gemeinsame Hilfen für Admin-API-Aufrufe an Shopware:
 *
 * 1. Protokolliert fehlgeschlagene Aufrufe (Status >= 400) mit Methode, Host, Pfad und gesendetem
 *    Content-Type. Viele Aufrufer fangen Fehler still ab („liefert null") — ohne diese Zeile ist im
 *    Shop-Log nicht zuzuordnen, ob ein Fehler von META Order kommt.
 * 2. Merkt sich Entitäten, die es in einer Shopware-Installation nicht gibt („No route found", z. B.
 *    B2Bsellers-Entitäten in einem Shop ohne Plugin, oder geratene Namensvarianten). Weitere Aufrufe
 *    gehen dann nicht mehr raus, sondern bekommen lokal dieselbe 404 — sonst erzeugt jeder Abgleich
 *    alle 3 Minuten eine Exception-Zeile pro Namensvariante im Shop-Log.
 */

const MISSING_ENTITY_TTL_MS = 6 * 60 * 60 * 1000;
const missingEntities = new Map<string, number>();

/** Nicht-Entitäts-Routen unter /api/ (Aktionen, Infos, Auth). */
const NON_ENTITY_SEGMENTS = new Set(["_action", "_info", "oauth", "_proxy", "_admin", "notification"]);

function entityKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match =
      parsed.pathname.match(/\/api\/(?:search|search-ids|aggregate)\/([^/?#]+)/) ??
      parsed.pathname.match(/\/api\/([a-z0-9_-]+)(?:\/|$)/i);
    const entity = match?.[1];
    if (!entity || NON_ENTITY_SEGMENTS.has(entity)) return null;
    return `${parsed.host}|${entity}`;
  } catch {
    return null;
  }
}

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Liefert eine lokale 404-Antwort, wenn die Entität in dieser Installation bekanntermaßen fehlt;
 * sonst null (Aufruf normal ausführen).
 */
export function cachedMissingEntityResponse(url: string): Response | null {
  const key = entityKeyFromUrl(url);
  if (!key) return null;
  const markedAt = missingEntities.get(key);
  if (markedAt === undefined) return null;
  if (Date.now() - markedAt > MISSING_ENTITY_TTL_MS) {
    missingEntities.delete(key);
    return null;
  }
  const entity = key.split("|")[1];
  return new Response(
    JSON.stringify({
      errors: [
        {
          code: "0",
          status: "404",
          title: "Not Found",
          detail: `No route found for entity "${entity}" (von META Order zwischengespeichert, kein Aufruf an Shopware)`,
        },
      ],
    }),
    { status: 404, statusText: "Not Found", headers: { "Content-Type": "application/json" } }
  );
}

export async function traceShopwareResponse(url: string, options: RequestInit, response: Response): Promise<Response> {
  if (response.status < 400) return response;

  if (response.status === 404) {
    const key = entityKeyFromUrl(url);
    if (key) {
      // Nur echte „Route/Entität existiert nicht" merken — ein 404 auf einen einzelnen Datensatz
      // (z. B. GET /api/order/<unbekannte-id>) bedeutet nicht, dass die Entität fehlt.
      const body = await response.clone().text().catch(() => "");
      if (body.includes("No route found")) missingEntities.set(key, Date.now());
    }
  }

  const headers = (options.headers ?? {}) as Record<string, string>;
  const contentType = headers["Content-Type"] ?? headers["content-type"];
  console.warn(
    `[ShopwareHTTP] ${(options.method || "GET").toUpperCase()} ${describeTarget(url)} → ${response.status} ${response.statusText}` +
      (contentType ? ` (Content-Type: ${contentType})` : "")
  );
  return response;
}
