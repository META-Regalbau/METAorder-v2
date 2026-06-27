import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import type { IStorage } from "./storage";
import { getCommercialAgentSettings } from "./aiConfig";
import { classifyCommercialDocumentIntent } from "./commercialDocumentIntent";
import { extractDocumentTextPreviewForIntent, extractPlainTextForDraft, normalizeMimeTypeForDraft } from "./documentTextExtraction";
import { maybeRefineIntentWithSubAgents } from "./commercialSubAgents";
import {
  trimExcerpt,
  shouldRecordAutoExemplar,
  deriveQualityScore,
} from "./commercialAgentLearning";
import { runOfferDraftPipeline, runOrderDraftPipeline } from "./commercialDraftPipeline";
import { executeCreateOfferFromDraft, executeCreateOrderFromDraft } from "./commercialDraftShopware";
import { resolveOfferSalesChannelId } from "./offerSalesChannelResolver";
import { runStrictCommercialAutoCreateIfAllowed } from "./commercialStrictAutoCreateRunner";
import type { MatchingResult } from "./productMatcher";
import {
  emitCommercialAutoOfferCreated,
  emitCommercialAutoOrderCreated,
  emitCommercialDraftWebhooks,
} from "./commercialWebhookNotifications";
import { getUploadsRoot } from "./uploadsRoot";
import { logCommercialAgentDebug } from "./commercialAgentDebugLog";
import { isCommercialInboundDocumentAttachment } from "./commercialInboundPdfContext";

const DEDUPE_SETTING_KEY = "commercial_agent_dedupe_hashes";

function safeFilename(name: string) {
  const s = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return s || "document.bin";
}

function isProcessableCommercialAttachment(mimeType: string, filename: string): boolean {
  return isCommercialInboundDocumentAttachment(filename.toLowerCase(), mimeType);
}

/** Heuristik für E-Mail-only-Fallback ohne handelsbezogene Anhänge */
export function isLikelyCommercialInquiry(subject: string, body: string): boolean {
  const t = `${subject}\n${body}`.toLowerCase();
  if (t.trim().length < 14) return false;
  const hints = [
    /\b(angebot|angebotsanfrage|kostenvoranschlag|offerte|quotation|quote|rfq)\b/,
    /\b(bestell|bestellung|purchase order|p\.?\s*o\.?\s*)/,
    /\b(artikel|position|menge|stk|stück|liefertermin|art\.?\s*nr)/,
    /\b(preis|netto|brutto|\beur\b|€)\b/,
  ];
  return hints.some((re) => re.test(t));
}

function attachmentDedupeHash(messageId: string, filename: string, buffer: Buffer): string {
  return crypto
    .createHash("sha256")
    .update(messageId)
    .update("\0")
    .update(filename)
    .update("\0")
    .update(buffer)
    .digest("hex");
}

async function hasDedupeHash(storage: IStorage, hash: string): Promise<boolean> {
  const cur = (await storage.getSetting(DEDUPE_SETTING_KEY)) as { hashes?: string[] } | undefined;
  return Boolean(cur?.hashes?.includes(hash));
}

async function appendDedupeHash(storage: IStorage, hash: string): Promise<void> {
  const cur = ((await storage.getSetting(DEDUPE_SETTING_KEY)) || {}) as { hashes?: string[] };
  const prev = Array.isArray(cur.hashes) ? cur.hashes : [];
  const hashes = [...prev, hash].slice(-300);
  await storage.saveSetting(DEDUPE_SETTING_KEY, { hashes });
}

function logAudit(payload: Record<string, unknown>) {
  console.log(`[CommercialAgent] AUDIT ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}`);
}

export type ProcessCommercialDocumentParams = {
  storage: IStorage;
  tenantId?: string | null;
  messageId: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  subject: string;
  emailBody: string;
  /** Leer = kein Ticket-Kommentar (z. B. manueller API-Upload) */
  ticketId?: string | null;
  systemUserId: string;
  /**
   * Optional: zusammengeführter Text aller Dokument-Anhänge derselben Mail für Intent/Sub-Agent.
   * Das aktuelle `buffer` bleibt die Quelle für die Entwurfsextraktion.
   */
  intentDocumentTextPreview?: string;
  /**
   * true: `buffer` enthält bereits den vollständigen E-Mail-Kern (E-Mail-only); kein doppeltes emailContext in der Pipeline.
   */
  primaryContainsEmailBody?: boolean;
  /** Anzeigename aus From (Kopfzeile) — ergänzt den Extraktionskontext für Firma/Name */
  fromDisplayName?: string;
  /** Kleine Bilder derselben Nachricht (Signatur) für optionale Vision-Erkennung */
  signatureImageBuffers?: Array<{ buffer: Buffer; mimeType: string }>;
};

/** @deprecated Typ-Alias */
export type ProcessCommercialPdfParams = ProcessCommercialDocumentParams;

export type CommercialAgentProcessResult = {
  draftId: string;
  draftKind: "offer" | "order";
  intent: string;
  intentConfidence: number;
};

/**
 * Verarbeitet ein Geschäftsdokument aus dem E-Mail-Eingang (PDF, Word, Bild, E-Mail-Datei oder reiner E-Mail-Text im Buffer).
 */
export async function processCommercialDocumentFromEmail(
  params: ProcessCommercialDocumentParams
): Promise<CommercialAgentProcessResult | null> {
  const {
    storage,
    tenantId,
    messageId,
    filename,
    buffer,
    mimeType,
    subject,
    emailBody,
    ticketId = null,
    systemUserId,
    intentDocumentTextPreview,
    primaryContainsEmailBody = false,
    fromDisplayName,
    signatureImageBuffers,
  } = params;

  const agentSettings = await getCommercialAgentSettings(storage);
  if (!agentSettings.enabled) {
    return null;
  }

  if (!primaryContainsEmailBody && !isProcessableCommercialAttachment(mimeType, filename)) {
    return null;
  }

  const dedupeHash = attachmentDedupeHash(messageId, filename, buffer);
  if (await hasDedupeHash(storage, dedupeHash)) {
    logAudit({ event: "skip_duplicate", messageId, filename });
    return null;
  }

  let docPreview = "";
  try {
    docPreview = await extractDocumentTextPreviewForIntent(buffer, mimeType, filename, {
      ocrEnabled: false,
    });
  } catch {
    docPreview = "";
  }

  const intentDocumentText =
    (intentDocumentTextPreview?.trim() && intentDocumentTextPreview.trim()) || docPreview || undefined;

  logCommercialAgentDebug(
    "pipeline_start",
    {
      filename,
      tenantId: tenantId ?? null,
      docTextLen: docPreview.length,
      intentDocTextLen: intentDocumentText?.length ?? 0,
      usedCombinedIntentDocs: Boolean(intentDocumentTextPreview?.trim()),
      emailBodyLen: (emailBody || "").length,
      subjectLen: (subject || "").length,
      primaryContainsEmailBody,
      subAgentsEnabled: agentSettings.subAgentsEnabled !== false,
    },
    messageId
  );

  let intent = await classifyCommercialDocumentIntent(storage, {
    subject,
    emailBody,
    documentTextPreview: intentDocumentText,
    tenantId: tenantId ?? null,
    traceId: messageId,
  });

  if (agentSettings.subAgentsEnabled !== false) {
    intent = await maybeRefineIntentWithSubAgents(
      storage,
      {
        subject,
        emailBody,
        documentTextPreview: intentDocumentText,
        tenantId: tenantId ?? null,
        traceId: messageId,
      },
      intent
    );
  }

  const useOrderPipeline = intent.intent === "purchase_order" && intent.confidence >= 0.5;

  logCommercialAgentDebug(
    "pipeline_intent",
    {
      tenantId: tenantId ?? null,
      intent: intent.intent,
      confidence: intent.confidence,
      useOrderPipeline,
      signals: intent.signals,
    },
    messageId
  );

  const uploadDir = path.join(getUploadsRoot(), "commercial-agent-incoming");
  await fs.mkdir(uploadDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const diskName = `${uniqueSuffix}-${safeFilename(filename)}`;
  const filePath = path.join(uploadDir, diskName);
  await fs.writeFile(filePath, buffer);

  const fromLine = fromDisplayName?.trim() ? `Absender (Kopfzeile): ${fromDisplayName.trim()}` : "";
  const emailCtxMerged = primaryContainsEmailBody
    ? fromLine.slice(0, 12000)
    : [fromLine, subject.trim() && `Betreff: ${subject.trim()}`, emailBody.trim() && `E-Mail-Text:\n${emailBody.trim()}`]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 12000);
  const draftExtractionMail = {
    emailContext: emailCtxMerged || undefined,
    siblingPdfExcerpts:
      !primaryContainsEmailBody && intentDocumentTextPreview?.trim()
        ? intentDocumentTextPreview.trim()
        : undefined,
  };

  let primaryDocumentText: string | undefined;
  if (primaryContainsEmailBody) {
    const normMime = normalizeMimeTypeForDraft(filename, mimeType);
    if (normMime === "message/rfc822" || filename.toLowerCase().endsWith(".eml")) {
      try {
        primaryDocumentText =
          (await extractPlainTextForDraft({
            fileBuffer: buffer,
            mimeType: normMime,
            fileName: filename,
            ocrEnabled: false,
          })) || undefined;
      } catch {
        primaryDocumentText = buffer.toString("utf8");
      }
    } else {
      primaryDocumentText = buffer.toString("utf8");
    }
  }

  let draftKind: "offer" | "order" = "offer";
  let draftId = "";
  let overallConfidence: number | null = null;

  try {
    if (useOrderPipeline) {
      draftKind = "order";
      const commercialIntentMetadata = {
        intent: intent.intent,
        confidence: intent.confidence,
        rationale: intent.rationale,
      };
      const { draft, timings } = await runOrderDraftPipeline({
        storage,
        tenantId,
        filePath,
        originalFileName: filename,
        mimeType,
        createdByUserId: systemUserId,
        ...draftExtractionMail,
        primaryDocumentText,
        commercialIntentMetadata,
      });
      draftId = draft.id;
      overallConfidence = draft.matchingResults?.overallConfidence ?? null;
      logAudit({
        event: "draft_created",
        kind: "order",
        draftId,
        intent: intent.intent,
        intentConfidence: intent.confidence,
        overallConfidence,
        timings,
        messageId,
      });
    } else {
      draftKind = "offer";
      const commercialIntentMetadataOffer = {
        intent: intent.intent,
        confidence: intent.confidence,
        rationale: intent.rationale,
      };
      const { draft, timings } = await runOfferDraftPipeline({
        storage,
        tenantId,
        filePath,
        originalFileName: filename,
        mimeType,
        createdByUserId: systemUserId,
        ...draftExtractionMail,
        primaryDocumentText,
        commercialIntentMetadata: commercialIntentMetadataOffer,
        signatureImageBuffers,
      });
      draftId = draft.id;
      overallConfidence = draft.matchingResults?.overallConfidence ?? null;
      logAudit({
        event: "draft_created",
        kind: "offer",
        draftId,
        intent: intent.intent,
        intentConfidence: intent.confidence,
        overallConfidence,
        timings,
        messageId,
      });
    }

    if (
      agentSettings.documentLearningEnabled !== false &&
      tenantId &&
      draftId &&
      shouldRecordAutoExemplar(intent.confidence, overallConfidence)
    ) {
      void storage
        .createCommercialAgentExemplar(
          {
            tenantId,
            sourceKind: "auto_success",
            intentLabel: intent.intent,
            subjectExcerpt: trimExcerpt(subject, 400),
            emailExcerpt: trimExcerpt(emailBody, 1800),
            pdfExcerpt: trimExcerpt(docPreview, 2200),
            signalsJson: {
              signals: intent.signals ?? [],
              rationale: intent.rationale,
            },
            qualityScore: deriveQualityScore(intent.confidence, overallConfidence),
            draftKind,
            referenceDraftId: draftId,
          },
          tenantId
        )
        .catch((err) => console.warn("[CommercialAgent] exemplar save failed:", err));
    }
  } catch (err) {
    logAudit({
      event: "draft_failed",
      messageId,
      filename,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore */
    }
    return null;
  }

  await appendDedupeHash(storage, dedupeHash);

  const savedDraftForWebhook =
    draftKind === "order"
      ? await storage.getOrderDraft(draftId, tenantId ?? null)
      : await storage.getOfferDraft(draftId, tenantId ?? null);
  if (savedDraftForWebhook) {
    emitCommercialDraftWebhooks({
      draft: savedDraftForWebhook,
      draftKind,
      intent: intent.intent,
      intentConfidence: intent.confidence,
      messageId,
      source: "email_inbound",
    });
  }

  const savedDraftForAuto =
    draftKind === "order"
      ? await storage.getOrderDraft(draftId, tenantId ?? null)
      : await storage.getOfferDraft(draftId, tenantId ?? null);
  const extractedForStrict = (savedDraftForAuto?.extractedData ?? {}) as Record<string, unknown>;

  if (agentSettings.strictAutoCreateOnly !== false) {
    const strictResult = await runStrictCommercialAutoCreateIfAllowed({
      storage,
      tenantId,
      draftId,
      draftKind,
      agentSettings,
      extractedData: extractedForStrict,
      matchingResults: (savedDraftForAuto?.matchingResults ?? null) as MatchingResult | null,
      shopwareCustomerId: savedDraftForAuto?.shopwareCustomerId ?? null,
      intent: { intent: intent.intent, confidence: intent.confidence },
      messageId,
    });
    logAudit({
      event: strictResult.strictAllowed
        ? strictResult.shopwareCreated
          ? "strict_auto_create_success"
          : "strict_auto_create_allowed_shopware_failed"
        : "strict_auto_create_review",
      draftId,
      draftKind,
      strictReasons: strictResult.strictReasons,
      shopwareCreated: strictResult.shopwareCreated,
      shopwareEntityId: strictResult.shopwareEntityId,
      shopwareError: strictResult.shopwareError,
      messageId,
    });
    if (ticketId) {
      const note = strictResult.shopwareCreated
        ? `[Commercial Agent] Strikt-Auto-Create: ${draftKind === "offer" ? "Angebot" : "Bestellung"} in Shopware (${strictResult.shopwareEntityId}). Entwurf ${draftId}.`
        : strictResult.strictAllowed
          ? `[Commercial Agent] Strikt-Regel erfüllt, Shopware-Anlage fehlgeschlagen: ${strictResult.shopwareError ?? "unbekannt"}. Entwurf ${draftId}.`
          : `[Commercial Agent] Entwurf ${draftId} zur manuellen Bearbeitung (Strikt-Regel: ${strictResult.strictReasons.join(", ")}).`;
      await addTicketNote(storage, ticketId, systemUserId, note);
    }
    return {
      draftId,
      draftKind,
      intent: intent.intent,
      intentConfidence: intent.confidence,
    };
  }

  const minI = agentSettings.autoCreateMinIntentConfidence;
  const minM = agentSettings.autoCreateMinMatchConfidence;
  const intentOk = intent.confidence >= minI;
  const matchOk = overallConfidence !== null && overallConfidence >= minM;

  if (!intentOk || !matchOk) {
    if (ticketId) {
      await addTicketNote(
        storage,
        ticketId,
        systemUserId,
        `[Commercial Agent] Entwurf ${draftKind === "offer" ? "Angebot" : "Bestellung"} ${draftId} angelegt (Intent: ${intent.intent}, Review empfohlen).`
      );
    }
    return {
      draftId,
      draftKind,
      intent: intent.intent,
      intentConfidence: intent.confidence,
    };
  }

  if (draftKind === "offer" && agentSettings.autoCreateOffersEnabled) {
    const draft = await storage.getOfferDraft(draftId, tenantId ?? null);
    const minCust = agentSettings.customerMatchAutoMinConfidence ?? 72;
    const custConf = draft?.extractedData?.customer?.customerMatchConfidence;
    const customerMatchOk = typeof custConf !== "number" || custConf >= minCust;
    if (!customerMatchOk) {
      logAudit({
        event: "auto_offer_skipped",
        draftId,
        reason: "low_customer_match_confidence",
        customerMatchConfidence: custConf,
        minCust,
        messageId,
      });
    } else if (draft?.shopwareCustomerId) {
      const channelResult = await resolveOfferSalesChannelId(storage, {
        tenantId: tenantId ?? null,
        allowedChannelIds: null,
      });
      if (!channelResult.ok) {
        logAudit({
          event: "auto_offer_skipped",
          draftId,
          reason: "missing_sales_channel_id",
          error: channelResult.error,
          messageId,
        });
      } else {
        const result = await executeCreateOfferFromDraft(storage, draftId, {
          salesChannelId: channelResult.salesChannelId,
          tenantId: tenantId ?? null,
        });
        if (result.ok) {
          logAudit({
            event: "auto_offer_created",
            draftId,
            offerId: result.offerId,
            messageId,
          });
          emitCommercialAutoOfferCreated({
            draftId,
            offerId: result.offerId,
            messageId,
          });
          if (ticketId) {
            await addTicketNote(
              storage,
              ticketId,
              systemUserId,
              `[Commercial Agent] Angebot automatisch erstellt (B2B): ${result.offerId}. Entwurf ${draftId}.`
            );
          }
        } else {
          logAudit({
            event: "auto_offer_failed",
            draftId,
            error: result.error,
            messageId,
          });
        }
      }
    } else {
      logAudit({
        event: "auto_offer_skipped",
        draftId,
        reason: "missing_customer",
        messageId,
      });
    }
  } else if (draftKind === "order" && agentSettings.autoCreateOrdersEnabled) {
    const draftOrder = await storage.getOrderDraft(draftId, tenantId ?? null);
    const minCustOrder = agentSettings.customerMatchAutoMinConfidence ?? 72;
    const custConfOrder = draftOrder?.extractedData?.customer?.customerMatchConfidence;
    const customerMatchOkOrder = typeof custConfOrder !== "number" || custConfOrder >= minCustOrder;
    if (!customerMatchOkOrder) {
      logAudit({
        event: "auto_order_skipped",
        draftId,
        reason: "low_customer_match_confidence",
        customerMatchConfidence: custConfOrder,
        minCust: minCustOrder,
        messageId,
      });
    } else {
    const result = await executeCreateOrderFromDraft(storage, draftId, { tenantId: tenantId ?? null });
    if (result.ok) {
      logAudit({
        event: "auto_order_created",
        draftId,
        orderId: result.orderId,
        messageId,
      });
      emitCommercialAutoOrderCreated({
        draftId,
        orderId: result.orderId,
        messageId,
      });
      if (ticketId) {
        await addTicketNote(
          storage,
          ticketId,
          systemUserId,
          `[Commercial Agent] Bestellung automatisch in Shopware ausgelöst: ${result.orderId}. Entwurf ${draftId}.`
        );
      }
    } else {
      logAudit({
        event: "auto_order_failed",
        draftId,
        error: result.error,
        messageId,
      });
    }
    }
  }

  return {
    draftId,
    draftKind,
    intent: intent.intent,
    intentConfidence: intent.confidence,
  };
}

/** @deprecated Nutze processCommercialDocumentFromEmail */
export const processCommercialPdfFromEmail = processCommercialDocumentFromEmail;

async function addTicketNote(storage: IStorage, ticketId: string, userId: string, text: string) {
  try {
    await storage.createTicketComment({
      ticketId,
      userId,
      authorType: "user",
      comment: text,
      isInternal: 1,
    });
  } catch (e) {
    console.warn("[CommercialAgent] ticket note failed:", e);
  }
}
