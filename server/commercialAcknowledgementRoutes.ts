/**
 * Rückmelde-Endpunkt für das ERP des Kunden.
 *
 *   GET /api/public/commercial/orders/:buyerDocumentNumber
 *   GET /api/public/commercial/orders            (zuletzt eingegangene Vorgänge)
 *
 * Authentifizierung über ein kundengebundenes Token (`Authorization: Bearer moc_…`).
 * Der Mandant kommt aus dem Token, nicht aus dem Request — und jede Abfrage wird zusätzlich
 * hart auf die `shopwareCustomerId` des Tokens gefiltert.
 *
 * Bewusst getrennt von den internen Draft-Routen: Die liefern Confidence-Werte,
 * `strictAutoCreateTrace`, Alternativvorschläge und Lernhinweise — nichts davon gehört
 * zum Kunden. Die Antwort baut ausschließlich `commercialOrderAcknowledgement.ts`.
 */

import type { Express, Request, Response } from "express";
import type { IStorage } from "./storage";
import type { OfferDraft, OrderDraft } from "@shared/schema";
import {
  hashCommercialCustomerToken,
  readCustomerTokenFromRequest,
  validateCustomerToken,
} from "./commercialCustomerApiToken";
import {
  buildOrderAcknowledgement,
  type AcknowledgementShopwareOrder,
  type OrderAcknowledgement,
} from "./commercialOrderAcknowledgement";

/** Eigener Zähler statt des Angebots-Limiters: andere Zielgruppe, andere Last. */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimitAcknowledgement(key: string, now: number = Date.now()): boolean {
  const existing = buckets.get(key);
  if (!existing || now > existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= MAX_REQUESTS_PER_WINDOW;
}

/** Nur für Tests — verhindert Übersprechen zwischen Fällen. */
export function resetAcknowledgementRateLimit(): void {
  buckets.clear();
}

function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "unknown").toString();
}

type ResolvedToken = { id: string; tenantId: string; shopwareCustomerId: string };

/**
 * Löst das Token auf und beantwortet den Request bei Problemen selbst.
 * Gibt `null` zurück, wenn bereits geantwortet wurde.
 */
async function resolveToken(
  storage: IStorage,
  req: Request,
  res: Response
): Promise<ResolvedToken | null> {
  const plain = readCustomerTokenFromRequest(req.headers as Record<string, string | string[]>);
  if (!plain) {
    res.status(401).json({ error: "Zugangstoken fehlt." });
    return null;
  }

  // Rate-Limit vor dem DB-Zugriff, damit Rateversuche nichts kosten.
  if (!rateLimitAcknowledgement(`ip:${clientIp(req)}`)) {
    res.status(429).json({ error: "Zu viele Anfragen." });
    return null;
  }

  const record = await storage.findCommercialCustomerApiTokenByHash(
    hashCommercialCustomerToken(plain)
  );
  const validation = validateCustomerToken(record ?? null);
  if (!validation.ok) {
    // Bewusst dieselbe Meldung für unbekannt/widerrufen/abgelaufen: Ein Angreifer soll
    // nicht unterscheiden können, ob ein Token existiert.
    res.status(401).json({ error: "Zugangstoken ungültig." });
    return null;
  }

  const token = validation.token;
  void storage
    .touchCommercialCustomerApiTokenLastUsed(token.id)
    .catch((e) => console.warn("[Acknowledgement] lastUsed update failed:", e));

  return {
    id: token.id,
    tenantId: token.tenantId,
    shopwareCustomerId: token.shopwareCustomerId,
  };
}

/**
 * Lädt die Shopware-Bestellung für die verbindlichen Preise — nur bei bestätigtem Vorgang.
 * Fehlschläge sind nicht fatal: Die Bestätigung wird dann ohne Preise ausgeliefert,
 * statt den ganzen Request scheitern zu lassen.
 */
async function loadShopwareOrderForDraft(
  storage: IStorage,
  tenantId: string,
  draft: OrderDraft
): Promise<AcknowledgementShopwareOrder | null> {
  if (draft.status !== "created" || !draft.shopwareOrderId) return null;
  try {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) return null;
    const { ShopwareClient } = await import("./shopware");
    const client = new ShopwareClient(settings);
    // salesChannelIds = null: Der Zugriffsschutz läuft hier über die Token-Bindung an den
    // Kunden plus die Herkunft der Bestell-ID aus genau dessen Entwurf.
    const order = await client.fetchOrderById(draft.shopwareOrderId, null);
    if (!order) return null;
    return {
      orderNumber: (order as { orderNumber?: string }).orderNumber ?? null,
      amountNet: (order as { amountNet?: number }).amountNet ?? null,
      lineItems: ((order as { lineItems?: unknown[] }).lineItems ?? []).map((li) => {
        const item = li as Record<string, unknown>;
        return {
          productNumber: typeof item.productNumber === "string" ? item.productNumber : null,
          quantity: typeof item.quantity === "number" ? item.quantity : null,
          unitPrice: typeof item.unitPrice === "number" ? item.unitPrice : null,
          totalPrice: typeof item.totalPrice === "number" ? item.totalPrice : null,
        };
      }),
    };
  } catch (e) {
    console.warn("[Acknowledgement] Shopware-Bestellung konnte nicht geladen werden:", e);
    return null;
  }
}

async function acknowledgementFor(
  storage: IStorage,
  tenantId: string,
  entry: { kind: "order"; draft: OrderDraft } | { kind: "offer"; draft: OfferDraft }
): Promise<OrderAcknowledgement> {
  const shopwareOrder =
    entry.kind === "order" ? await loadShopwareOrderForDraft(storage, tenantId, entry.draft) : null;
  return buildOrderAcknowledgement({
    draft: entry.draft,
    draftKind: entry.kind,
    shopwareOrder,
  });
}

export function registerCommercialAcknowledgementRoutes(app: Express, storage: IStorage) {
  /** Status zu einer konkreten Belegnummer des Kunden. */
  app.get(
    "/api/public/commercial/orders/:buyerDocumentNumber",
    async (req: Request, res: Response) => {
      try {
        const token = await resolveToken(storage, req, res);
        if (!token) return;

        const buyerDocumentNumber = (req.params.buyerDocumentNumber || "").trim();
        if (!buyerDocumentNumber || buyerDocumentNumber.length > 120) {
          return res.status(400).json({ error: "Ungültige Belegnummer." });
        }

        const entries = await storage.findDraftsForAcknowledgement({
          tenantId: token.tenantId,
          shopwareCustomerId: token.shopwareCustomerId,
          buyerDocumentNumber,
        });

        if (entries.length === 0) {
          return res.status(404).json({
            error: "Zu dieser Belegnummer liegt kein Vorgang vor.",
            buyer_document_number: buyerDocumentNumber,
          });
        }

        // Mehrere Vorgänge zur selben Nummer sind möglich (Mail mit mehreren Anhängen,
        // Nachsendung). Alle ausliefern, neuester zuerst — das ERP entscheidet.
        const acknowledgements = [];
        for (const entry of entries) {
          acknowledgements.push(await acknowledgementFor(storage, token.tenantId, entry));
        }

        return res.json({
          buyer_document_number: buyerDocumentNumber,
          count: acknowledgements.length,
          documents: acknowledgements,
        });
      } catch (error) {
        console.error("[Acknowledgement] lookup failed:", error);
        return res.status(500).json({ error: "Abfrage fehlgeschlagen." });
      }
    }
  );
}
