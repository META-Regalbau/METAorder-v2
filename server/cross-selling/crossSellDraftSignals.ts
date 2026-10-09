// Reaktionen auf Cross-Selling-Vorschlaege in Bestell- und Angebotsentwuerfen erfassen:
// angezeigt (einmal je Entwurf und Paar) und per Vorschlags-Button hinzugefuegt. Die
// Ereignisse fliessen in den Hybrid-Ranker und die Qualitaetspruefung der KI-Regeln.
import { z } from "zod";
import type { IStorage } from "../storage";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellDraftSignals" });

export type DraftKind = "order_draft" | "offer_draft";

/** Ereignistypen wie in getCrossSellEventStats gezaehlt. */
export const DRAFT_IMPRESSION_EVENT = "draft_suggestions_impression";
export const DRAFT_ADD_EVENT = "draft_suggestion_add";
/** Per Vorschlag hinzugefuegtes Ziel ist in der angelegten Bestellung bzw. im Angebot geblieben. */
export const DRAFT_CONVERTED_EVENT = "draft_suggestion_converted";

type SuggestionGroup = {
  forProduct?: { productNumber?: string | null } | null;
  suggestions?: Array<{ productNumber?: string | null }> | null;
};

/** Paare (Quelle -> Ziel) mit Rang aus den Vorschlagsgruppen eines Entwurfs. */
export function draftImpressionRows(
  groups: SuggestionGroup[],
): Array<{ sourceProductNumber: string; targetProductNumber: string; metadata: { rank: number } }> {
  const rows: Array<{ sourceProductNumber: string; targetProductNumber: string; metadata: { rank: number } }> = [];
  for (const group of groups) {
    const source = group.forProduct?.productNumber?.trim();
    if (!source) continue;
    (group.suggestions ?? []).forEach((s, index) => {
      const target = s.productNumber?.trim();
      if (target && target !== source) {
        rows.push({ sourceProductNumber: source, targetProductNumber: target, metadata: { rank: index + 1 } });
      }
    });
  }
  return rows;
}

/**
 * Impressionen im Hintergrund speichern (blockiert die Antwort nicht; Fehler nur im Log).
 * Nur fuer angemeldete Nutzer – Abrufe per Integrationsschluessel (n8n) sieht niemand.
 */
export function recordDraftSuggestionImpressions(
  storage: Pick<IStorage, "recordCrossSellEventsOncePerDraft">,
  args: { tenantId: string | null; userId: string | null; draftId: string; kind: DraftKind; groups: SuggestionGroup[] },
): void {
  if (!args.userId) return;
  const rows = draftImpressionRows(args.groups);
  if (rows.length === 0) return;
  void storage
    .recordCrossSellEventsOncePerDraft(
      rows,
      { eventType: DRAFT_IMPRESSION_EVENT, draftId: args.draftId, context: args.kind, userId: args.userId },
      args.tenantId,
    )
    .catch((err) => moduleLog.warn({ err, draftId: args.draftId }, "Cross-Selling-Impressionen nicht gespeichert"));
}

/** Optionaler Body-Teil von add-product, wenn der Klick von einem Cross-Selling-Vorschlag kommt. */
export const draftCrossSellAddSchema = z
  .object({
    sourceProductNumber: z.string().trim().min(1).max(120),
    rank: z.number().int().min(1).max(100).optional(),
  })
  .optional();

export async function recordDraftSuggestionAdd(
  storage: Pick<IStorage, "recordCrossSellEventsOncePerDraft">,
  args: {
    tenantId: string | null;
    userId: string | null;
    draftId: string;
    kind: DraftKind;
    crossSell: unknown;
    targetProductNumber: string | null | undefined;
  },
): Promise<void> {
  const parsed = draftCrossSellAddSchema.safeParse(args.crossSell);
  const target = args.targetProductNumber?.trim();
  if (!parsed.success || !parsed.data || !target) return;
  try {
    await storage.recordCrossSellEventsOncePerDraft(
      [
        {
          sourceProductNumber: parsed.data.sourceProductNumber,
          targetProductNumber: target,
          metadata: parsed.data.rank ? { rank: parsed.data.rank } : null,
        },
      ],
      { eventType: DRAFT_ADD_EVENT, draftId: args.draftId, context: args.kind, userId: args.userId },
      args.tenantId,
    );
  } catch (err) {
    moduleLog.warn({ err, draftId: args.draftId }, "Cross-Selling-Hinzufuegen nicht gespeichert");
  }
}

/**
 * Nach dem Anlegen der Bestellung bzw. des Angebots: per Vorschlag hinzugefuegte Ziele, die
 * noch im Entwurf stehen, als "uebernommen" erfassen. Fehler nur im Log.
 */
export async function recordDraftSuggestionConversions(
  storage: Pick<IStorage, "recordCrossSellEventsOncePerDraft" | "getCrossSellDraftEventPairs">,
  args: {
    tenantId: string | null;
    draftId: string;
    kind: DraftKind;
    items: Array<{ matchedProduct?: { productNumber?: string | null } | null }> | null | undefined;
  },
): Promise<number> {
  try {
    const inDraft = new Set(
      (args.items ?? [])
        .map((item) => item.matchedProduct?.productNumber?.trim())
        .filter((pn): pn is string => !!pn),
    );
    if (inDraft.size === 0) return 0;
    const added = await storage.getCrossSellDraftEventPairs(args.draftId, DRAFT_ADD_EVENT, args.tenantId);
    const kept = added.filter((pair) => inDraft.has(pair.targetProductNumber));
    if (kept.length === 0) return 0;
    return await storage.recordCrossSellEventsOncePerDraft(
      kept,
      { eventType: DRAFT_CONVERTED_EVENT, draftId: args.draftId, context: args.kind },
      args.tenantId,
    );
  } catch (err) {
    moduleLog.warn({ err, draftId: args.draftId }, "Cross-Selling-Uebernahme nicht gespeichert");
    return 0;
  }
}
