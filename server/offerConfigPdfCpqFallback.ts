import type { ShopwareSettings } from "@shared/schema";
import type { IStorage } from "./storage";
import { buildOfferConfigPdfInput } from "./offerConfigPdfBuilder";
import type { OfferConfigPdfInput } from "./offerConfigPdf";
import { enrichMappedOfferItemsWithCpqPayload, type CpqSourceSnapshot } from "./cpq/cpqMetaCalcPayload";

type MappedOfferForPdf = Parameters<typeof buildOfferConfigPdfInput>[1];

/**
 * Wenn das B2B-Angebot kein MetaCalc-Payload hat, CPQ-Entwurf anhand shopwareOfferId laden und gemappte Zeilen anreichern.
 */
export async function buildOfferConfigPdfInputWithCpqFallback(
  storage: IStorage,
  shopwareOfferId: string,
  tenantId: string | null | undefined,
  rawOfferData: unknown,
  mappedOffer: MappedOfferForPdf,
  settings: ShopwareSettings
): Promise<OfferConfigPdfInput | null> {
  let input = await buildOfferConfigPdfInput(rawOfferData as any, mappedOffer, settings);
  if (input) return input;

  const draft = await storage.getOfferDraftByShopwareOfferId(shopwareOfferId, tenantId ?? null);
  const rawCpq = draft?.extractedData && (draft.extractedData as { cpqSource?: unknown }).cpqSource;
  if (!rawCpq || typeof rawCpq !== "object") return null;
  const cpq = rawCpq as CpqSourceSnapshot;
  if (!cpq.billOfMaterials?.items?.length) return null;

  const enrichedItems = enrichMappedOfferItemsWithCpqPayload(mappedOffer.items, cpq);
  return buildOfferConfigPdfInput(rawOfferData as any, { ...mappedOffer, items: enrichedItems }, settings);
}
