/**
 * Versand der Eingangsbestätigung (Seiteneffekte).
 *
 * Getrennt von [`commercialInboundAcknowledgementMail.ts`](./commercialInboundAcknowledgementMail.ts),
 * damit Textaufbau und Sperrlogik ohne Mailversand testbar bleiben.
 */

import type { IStorage } from "./storage";
import type { OfferDraft, OrderDraft } from "@shared/schema";
import type { CommercialAgentSettings } from "./aiConfig";
import { buildOrderAcknowledgement } from "./commercialOrderAcknowledgement";
import {
  buildAcknowledgementMail,
  decideAcknowledgementMail,
} from "./commercialInboundAcknowledgementMail";
import { sendEmail } from "./emailOutbound";

/** Marker im Entwurf — verhindert eine zweite Bestätigung zum selben Vorgang. */
const SENT_MARKER = "inboundAcknowledgementSentAt";

function readRecipient(extractedData: unknown): string | null {
  const data = (extractedData ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  if (typeof customer.email === "string" && customer.email.trim()) return customer.email.trim();
  const doc = (data.documentExtraction ?? {}) as Record<string, unknown>;
  const buyer = (doc.buyer ?? {}) as Record<string, unknown>;
  return typeof buyer.email === "string" && buyer.email.trim() ? buyer.email.trim() : null;
}

function readLanguage(extractedData: unknown): string | null {
  const doc = ((extractedData ?? {}) as Record<string, unknown>).documentExtraction as
    | Record<string, unknown>
    | undefined;
  const document = (doc?.document ?? {}) as Record<string, unknown>;
  return typeof document.language === "string" ? document.language : null;
}

function readCompany(extractedData: unknown): string | null {
  const data = (extractedData ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  if (typeof customer.company === "string" && customer.company.trim()) {
    return customer.company.trim();
  }
  const billing = (data.billingAddress ?? {}) as Record<string, unknown>;
  return typeof billing.company === "string" && billing.company.trim()
    ? billing.company.trim()
    : null;
}

export type SendAcknowledgementResult =
  | { sent: true; recipient: string }
  | { sent: false; reason: string };

export async function maybeSendInboundAcknowledgement(params: {
  storage: IStorage;
  tenantId: string | null;
  draftId: string;
  draftKind: "offer" | "order";
  draft: OrderDraft | OfferDraft;
  agentSettings: CommercialAgentSettings;
}): Promise<SendAcknowledgementResult> {
  const { storage, tenantId, draftId, draftKind, draft, agentSettings } = params;

  const extractedData = (draft.extractedData ?? {}) as Record<string, unknown>;

  const decision = decideAcknowledgementMail({
    enabled: agentSettings.inboundAcknowledgementEnabled === true,
    recipientEmail: readRecipient(extractedData),
    alreadySentAt: extractedData[SENT_MARKER] as string | undefined,
    ownDomains: agentSettings.inboundAcknowledgementOwnDomains ?? [],
    senderCompany: readCompany(extractedData),
  });

  if (!decision.send) {
    return { sent: false, reason: decision.reason };
  }

  // Preise bleiben hier bewusst außen vor: Zum Eingangszeitpunkt existiert noch keine
  // Shopware-Bestellung, also gibt es keinen verbindlichen Preis zu nennen.
  const acknowledgement = buildOrderAcknowledgement({ draft, draftKind, shopwareOrder: null });
  const mail = buildAcknowledgementMail({
    acknowledgement,
    language: readLanguage(extractedData),
    senderName: agentSettings.inboundAcknowledgementSignature || null,
  });

  await sendEmail(storage, {
    to: decision.recipient,
    subject: mail.subject,
    text: mail.text,
  });

  // Marker erst NACH erfolgreichem Versand setzen — schlägt der Versand fehl, darf ein
  // späterer Lauf es erneut versuchen.
  const nextExtracted = { ...extractedData, [SENT_MARKER]: new Date().toISOString() };
  if (draftKind === "order") {
    await storage.updateOrderDraft(
      draftId,
      { extractedData: nextExtracted as OrderDraft["extractedData"] },
      tenantId
    );
  } else {
    await storage.updateOfferDraft(
      draftId,
      { extractedData: nextExtracted as OfferDraft["extractedData"] },
      tenantId
    );
  }

  console.log(
    `[CommercialAgent] Eingangsbestätigung gesendet: ${draftKind} ${draftId} -> ${decision.recipient}`
  );
  return { sent: true, recipient: decision.recipient };
}
