// KI-Entwuerfe: gemeinsamer Upload, Bestell- und Angebotsentwuerfe (Pruefen, Kunde/Produkte zuordnen, Anhaenge, Anlage in Shopware) sowie Commercial Agent.
import multer from "multer";
import { requireAuth, requireManageSettings, requireAuthOrIntegrationKey, requireManageCommercialDraftUpload, requireCsrf, requireManageOrderDrafts, requireManageOffers, requireViewOffers } from "../auth/auth";
import { uploadRateLimiter, sanitizeFilename, getSalesChannelFilter } from "./routeHelpers";
import { restoreTenantContext } from "../lib/tenantContext";
import type { Request, Response, Express } from "express";
import { getCommercialAgentSettings, getAISettings } from "../ai/aiConfig";
import { storage } from "../storage";
import { processCommercialPdfFromEmail } from "../commercial/commercialAgentOrchestrator";
import { z } from "zod";
import path from "path";
import { getUploadsRoot } from "../uploadsRoot";
import fs from "fs/promises";
import crypto from "crypto";
import { isEmailContainerUpload, ingestCommercialEmailUpload } from "../commercial/commercialEmailUploadIngest";
import { extractDocumentTextPreviewForIntent } from "../extraction/documentTextExtraction";
import { classifyCommercialDocumentIntent } from "../commercial/commercialDocumentIntent";
import { runOrderDraftPipeline, runOfferDraftPipeline } from "../commercial/commercialDraftPipeline";
import { emitCommercialDraftWebhooks } from "../commercial/commercialWebhookNotifications";
import { runStrictCommercialAutoCreateIfAllowed } from "../commercial/commercialStrictAutoCreateRunner";
import type { MatchingResult } from "../products/productMatcher";
import { ShopwareClient } from "../shopware/shopware";
import { getCombinedCrossSellingRules, loadCrossSellRankingBundle, crossSellSuggestOptions, dedupeAndLimitSuggestions } from "../cross-selling/crossSellService";
import { recordDraftSuggestionImpressions, recordDraftSuggestionAdd } from "../cross-selling/crossSellDraftSignals";
import { RuleEngine } from "../cross-selling/ruleEngine";
import { buildCommercialClarificationEmail } from "../commercial/customerClarificationEmail";
import { buildCommercialProductFeedbackRowsFromDraftUpdate } from "../commercial/commercialProductLearning";
import { mergeDraftExtractedData, resolveEmailForShopwareCustomerCreate, tryCreateShopwareCustomerFromExtractedData, type DraftExtractedCustomer, type DraftBillingAddressInput } from "../commercial/draftCustomerEmailResolution";
import { ensureDraftShopwareCustomerId, executeCreateOrderFromDraft, executeCreateOfferFromDraft } from "../commercial/commercialDraftShopware";
import { fetchCustomerBoundSalesChannelId, resolveOfferSalesChannelId } from "../offers/offerSalesChannelResolver";
import { hasEnabledSftpServers } from "../sftp/sftpUpload";
import { listDraftAttachmentsForApi, sendDraftAttachmentFile, parseDraftAttachmentExportUpdate, applyDraftAttachmentExportUpdate } from "../commercial/draftAttachmentRoutes";
import { productCache } from "../products/productCache";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/draftRoutes" });


function parseUploadIntentHint(raw: unknown): "offer" | "order" | "unclear" | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  if (s === "offer" || s === "quote" || s === "quote_request") return "offer";
  if (s === "order" || s === "purchase_order" || s === "po") return "order";
  if (s === "unclear") return "unclear";
  return undefined;
}


/**
 * Prüft die tatsächlichen Datei-Bytes gegen die vom Dateinamen behauptete
 * Endung (Magic-Bytes) — sonst wird eine beliebige Datei mit `.pdf`-Endung
 * blind an pdf-parse durchgereicht (Parser-Verwirrung). Gibt bei fehlendem/
 * unbekanntem Muster `null` zurück (kein Fehlschlag — z. B. .txt/.eml haben
 * keine verlässliche Signatur).
 */
function detectFileExtensionMismatch(buffer: Buffer, originalname: string): string | null {
  const ext = (originalname.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  const startsWith = (bytes: number[], offset = 0) =>
    buffer.length >= offset + bytes.length && bytes.every((b, i) => buffer[offset + i] === b);
  const asciiAt = (offset: number, len: number) =>
    buffer.length >= offset + len ? buffer.toString("ascii", offset, offset + len) : "";

  switch (ext) {
    case "pdf":
      return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]) /* %PDF- */ ? null : "Datei beginnt nicht mit einer gültigen PDF-Signatur";
    case "png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : "Datei ist keine gültige PNG-Datei";
    case "jpg":
    case "jpeg":
      return startsWith([0xff, 0xd8, 0xff]) ? null : "Datei ist keine gültige JPEG-Datei";
    case "gif":
      return asciiAt(0, 6) === "GIF87a" || asciiAt(0, 6) === "GIF89a" ? null : "Datei ist keine gültige GIF-Datei";
    case "webp":
      return asciiAt(0, 4) === "RIFF" && asciiAt(8, 4) === "WEBP" ? null : "Datei ist keine gültige WEBP-Datei";
    case "docx":
      // .docx ist ein ZIP-Container ("PK\x03\x04").
      return startsWith([0x50, 0x4b, 0x03, 0x04]) ? null : "Datei ist keine gültige .docx-Datei";
    case "doc":
    case "msg":
      // Legacy .doc/.msg sind OLE2-Compound-Files.
      return startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        ? null
        : `Datei ist keine gültige .${ext}-Datei`;
    default:
      return null;
  }
}

export function registerDraftRoutes(app: Express): void {
  const commercialAgentMemUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === "application/pdf" || file.originalname?.toLowerCase().endsWith(".pdf")) {
        cb(null, true);
      } else {
        cb(new Error("Nur PDF-Dateien sind erlaubt."));
      }
    },
  });

  app.post(
    "/api/commercial-agent/process",
    requireAuth,
    requireManageSettings,
    uploadRateLimiter,
    commercialAgentMemUpload.single("file"), restoreTenantContext,
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file?.buffer) {
          return res.status(400).json({ error: "PDF-Datei (field: file) erforderlich" });
        }
        const agent = await getCommercialAgentSettings(storage);
        if (!agent.enabled) {
          return res.status(400).json({ error: "Commercial Agent ist deaktiviert. Bitte unter Einstellungen aktivieren." });
        }
        const userId = (req.user as any).id;
        const subject = typeof req.body?.subject === "string" ? req.body.subject : "(manueller Upload)";
        const emailBody = typeof req.body?.body === "string" ? req.body.body : "";
        const result = await processCommercialPdfFromEmail({
          storage,
          tenantId: req.tenantId ?? null,
          messageId: `manual-${userId}-${Date.now()}`,
          filename: file.originalname || "upload.pdf",
          buffer: file.buffer,
          mimeType: file.mimetype || "application/pdf",
          subject,
          emailBody,
          ticketId: null,
          systemUserId: userId,
        });
        res.json({ success: true, result });
      } catch (error: any) {
        moduleLog.error({ err: error }, "Commercial agent process error:");
        res.status(500).json({ error: error.message || "Commercial Agent Verarbeitung fehlgeschlagen" });
      }
    }
  );

  app.get(
    "/api/commercial-agent/learning-stats",
    requireAuth,
    requireManageSettings,
    async (req: Request, res: Response) => {
      try {
        const tenantId = req.tenantId ?? null;
        if (!tenantId) {
          return res.status(400).json({ error: "Kein Mandant gewählt" });
        }
        const total = await storage.countCommercialAgentExemplars(tenantId);
        res.json({ total });
      } catch (error: any) {
        moduleLog.error({ err: error }, "Commercial agent learning stats error:");
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  app.post(
    "/api/commercial-agent/learning-feedback",
    requireAuth,
    requireManageSettings,
    async (req: Request, res: Response) => {
      try {
        const tenantId = req.tenantId ?? null;
        if (!tenantId) {
          return res.status(400).json({ error: "Kein Mandant gewählt" });
        }
        const bodySchema = z.object({
          draftKind: z.enum(["offer", "order"]),
          draftId: z.string().min(1),
          feedback: z.enum(["confirm", "correct"]),
          correctedIntent: z.enum(["quote_request", "purchase_order", "unclear"]).optional(),
        });
        const data = bodySchema.parse(req.body);
        const agent = await getCommercialAgentSettings(storage);
        if (agent.documentLearningEnabled === false) {
          return res.status(400).json({ error: "Dokumenten-Lernen ist deaktiviert" });
        }

        const draft =
          data.draftKind === "offer"
            ? await storage.getOfferDraft(data.draftId, tenantId)
            : await storage.getOrderDraft(data.draftId, tenantId);
        if (!draft) {
          return res.status(404).json({ error: "Entwurf nicht gefunden" });
        }

        const heuristicIntent =
          data.draftKind === "order" ? "purchase_order" : "quote_request";
        const intentLabel =
          data.feedback === "correct" && data.correctedIntent
            ? data.correctedIntent
            : heuristicIntent;
        const qualityScore = data.feedback === "confirm" ? 18 : 14;
        const extracted = draft.extractedData;
        const lines = extracted?.lineItems?.length
          ? `${extracted.lineItems.length} Positionen`
          : "ohne Positionen";
        const pdfExcerpt = `${draft.originalFileName}: ${lines}. ${JSON.stringify(extracted?.customer ?? {}).slice(0, 600)}`;

        await storage.createCommercialAgentExemplar(
          {
            tenantId,
            sourceKind: data.feedback === "confirm" ? "user_confirmed" : "user_corrected",
            intentLabel,
            subjectExcerpt: draft.originalFileName?.slice(0, 400) || null,
            emailExcerpt: null,
            pdfExcerpt: pdfExcerpt.slice(0, 2200),
            signalsJson: { feedback: data.feedback, draftKind: data.draftKind },
            qualityScore,
            draftKind: data.draftKind,
            referenceDraftId: data.draftId,
          },
          tenantId
        );

        res.json({ success: true });
      } catch (error: any) {
        moduleLog.error({ err: error }, "Commercial agent learning feedback error:");
        if (error.name === "ZodError") {
          return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message || "Fehler" });
      }
    }
  );

  // ============================================
  // COMMERCIAL DRAFTS — einheitlicher KI-Upload (Intent → Angebot oder Bestellung)
  // ============================================

  function commercialManualDraftFileFilter(
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
  ) {
    const allowedMimeTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
      "application/vnd.ms-outlook",
      "message/rfc822",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (
      allowedMimeTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(pdf|png|jpg|jpeg|gif|webp|msg|eml|txt|docx|doc)$/i)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Ungültiger Dateityp. Erlaubt: PDF, Bilder, Word (.docx/.doc), .msg, .eml, .txt"
        )
      );
    }
  }

  const commercialUnifiedDraftStorage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), "commercial-drafts");
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, path.join(getUploadsRoot(), "commercial-drafts"));
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
      const sanitizedFilename = sanitizeFilename(file.originalname);
      cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
    },
  });

  const commercialUnifiedDraftUpload = multer({
    storage: commercialUnifiedDraftStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: commercialManualDraftFileFilter,
  });

  app.post(
    "/api/commercial-drafts/upload",
    requireAuthOrIntegrationKey,
    requireManageCommercialDraftUpload,
    requireCsrf,
    uploadRateLimiter,
    commercialUnifiedDraftUpload.single("file"), restoreTenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "Keine Datei hochgeladen" });
        }

        const userId = (req.user as any).id;
        const file = req.file;
        const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
        const bodyNote = typeof req.body?.body === "string" ? req.body.body : "";
        const uploadIntentHint = parseUploadIntentHint(req.body?.intentHint);

        const aiSettings = await getAISettings(storage);
        if (aiSettings.mode === "openai_only") {
          try {
            const openaiSettings = await storage.getSetting("openai_settings");
            const { getOpenAIClient } = await import("../ai/openaiClient");
            getOpenAIClient(openaiSettings?.apiKey);
          } catch {
            await fs.unlink(file.path);
            return res.status(400).json({
              error:
                "OpenAI nicht konfiguriert. Bitte API-Schlüssel in den Einstellungen hinterlegen.",
            });
          }
        }

        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          await fs.unlink(file.path);
          return res.status(400).json({
            error: "Shopware nicht konfiguriert.",
          });
        }

        const user = req.user as any;
        const roleDetails = user?.roleDetails;
        const permissions = roleDetails?.permissions;
        let canOrder = false;
        let canOffer = false;
        if (permissions) {
          if (Array.isArray(permissions)) {
            canOrder = permissions.includes("manageOrderDrafts");
            canOffer = permissions.includes("manageOffers");
          } else {
            canOrder = Boolean(permissions.manageOrderDrafts);
            canOffer = Boolean(permissions.manageOffers);
          }
        }

        const fileBuffer = await fs.readFile(file.path);

        const extensionMismatch = detectFileExtensionMismatch(fileBuffer, file.originalname);
        if (extensionMismatch) {
          await fs.unlink(file.path);
          return res.status(400).json({ error: extensionMismatch });
        }

        // ── Hochgeladene E-Mail (.eml/.msg): auspacken statt als Einzeldokument behandeln ──
        // Ein Entwurf je handelsrelevantem Anhang, wie beim internen Postfach-Abruf.
        // Nur wenn der Aufrufer BEIDE Rechte hat: der Orchestrator kennt das
        // Permission-Downgrade (Bestellung → Angebot) des Einzeldokument-Pfads unten nicht,
        // und welcher Anhang welche Art hat, steht erst nach der Klassifikation fest.
        const agentSettingsForUpload = await getCommercialAgentSettings(storage);
        if (
          isEmailContainerUpload(file.originalname, file.mimetype) &&
          agentSettingsForUpload.enabled &&
          canOrder &&
          canOffer
        ) {
          const ingestParams = {
            storage,
            tenantId: req.tenantId ?? null,
            fileBuffer,
            fileName: file.originalname,
            formSubject: subject,
            formBody: bodyNote,
            createdByUserId: userId,
            ocrEnabled: aiSettings.ocrEnabled,
            uploadHint: uploadIntentHint ?? null,
          };
          let ingest = await ingestCommercialEmailUpload(ingestParams);

          // Bereits verarbeitete Mail: vorhandenen Entwurf zurückgeben statt „kein Entwurf".
          // Wurde der Entwurf inzwischen gelöscht, bei manuellem Upload neu verarbeiten —
          // sonst bliebe die Mail für immer gesperrt (n8n-Retries bleiben dedupliziert).
          let existingForDedupe: { draft: unknown; draftKind: "order" | "offer" } | null = null;
          if (ingest.results.length === 0) {
            const tenantForLookup = req.tenantId ?? null;
            const fromThisMail = (d: { tenantId?: string | null; extractedData?: unknown }) =>
              (d.tenantId ?? null) === tenantForLookup &&
              (d.extractedData as { sourceMessageId?: string } | null)?.sourceMessageId === ingest.messageId;
            const [allOrders, allOffers] = await Promise.all([storage.getAllOrderDrafts(), storage.getAllOfferDrafts()]);
            const candidates = [
              ...allOrders
                .filter(fromThisMail)
                .map((d) => ({ draft: d, draftKind: "order" as const, at: new Date(d.createdAt).getTime() })),
              ...allOffers
                .filter(fromThisMail)
                .map((d) => ({ draft: d, draftKind: "offer" as const, at: new Date(d.createdAt).getTime() })),
            ].sort((a, b) => b.at - a.at);
            if (candidates.length > 0) {
              existingForDedupe = { draft: candidates[0].draft, draftKind: candidates[0].draftKind };
            } else if ((req as { integrationKeyAuth?: boolean }).integrationKeyAuth !== true) {
              ingest = await ingestCommercialEmailUpload({ ...ingestParams, forceReprocess: true });
            }
          }

          // Der Orchestrator legt eigene Kopien je Anhang ab; das hochgeladene
          // Container-File wird von keinem Entwurf referenziert.
          try {
            await fs.unlink(file.path);
          } catch {
            /* ignore */
          }

          const ingestedDrafts = [];
          for (const result of ingest.results) {
            const draft =
              result.draftKind === "order"
                ? await storage.getOrderDraft(result.draftId, req.tenantId ?? null)
                : await storage.getOfferDraft(result.draftId, req.tenantId ?? null);
            ingestedDrafts.push({
              draft: draft ?? null,
              draftKind: result.draftKind,
              commercialIntent: result.intent,
              commercialIntentConfidence: result.intentConfidence,
              // Strikt-Auto-Create lief bereits im Orchestrator — Ergebnis steckt im Entwurf.
              strictAutoCreateTrace:
                (draft?.extractedData as Record<string, unknown> | undefined)
                  ?.strictAutoCreateTrace ?? null,
            });
          }

          const first = ingestedDrafts[0];
          return res.json({
            // Rückwärtskompatible Felder für UI und bestehende Clients (erster Entwurf).
            // Bei Dedupe: der bereits vorhandene Entwurf — nie ein erfundenes „offer".
            draft: first?.draft ?? existingForDedupe?.draft ?? null,
            draftKind: first?.draftKind ?? existingForDedupe?.draftKind ?? null,
            existingDraftReturned: Boolean(!first && existingForDedupe),
            commercialIntent: first?.commercialIntent ?? "unclear",
            commercialIntentConfidence: first?.commercialIntentConfidence ?? 0,
            commercialIntentRationale: null,
            intentRoutedAsOfferDueToPermission: false,
            uploadIntentHint: uploadIntentHint ?? null,
            strictAutoCreate: first?.strictAutoCreateTrace ?? null,
            // Neu: vollständiges Ergebnis der Mail-Zerlegung
            source: "email_container" as const,
            drafts: ingestedDrafts,
            draftCount: ingestedDrafts.length,
            attachmentsProcessed: ingest.attachmentsProcessed,
            usedEmailOnlyFallback: ingest.usedEmailOnlyFallback,
            // 0 Entwürfe bei vorhandenen Anhängen = bereits verarbeitete Nachricht
            deduplicated: ingestedDrafts.length === 0,
          });
        }

        const docPreview = await extractDocumentTextPreviewForIntent(
          fileBuffer,
          file.mimetype,
          file.originalname,
          { ocrEnabled: aiSettings.ocrEnabled }
        );

        const intent = await classifyCommercialDocumentIntent(storage, {
          subject,
          emailBody: bodyNote,
          documentTextPreview: docPreview || undefined,
          tenantId: req.tenantId ?? null,
          traceId: `manual-upload-${Date.now()}`,
          uploadHint: uploadIntentHint ?? null,
        });

        let useOrderPipeline = intent.intent === "purchase_order" && intent.confidence >= 0.5;
        let intentRoutedAsOfferDueToPermission = false;

        if (useOrderPipeline && !canOrder) {
          if (canOffer) {
            useOrderPipeline = false;
            intentRoutedAsOfferDueToPermission = true;
          } else {
            await fs.unlink(file.path);
            return res.status(403).json({
              error: "Keine Berechtigung für Bestellentwürfe; Intent war „Bestellung“.",
            });
          }
        }

        if (!useOrderPipeline && !canOffer) {
          await fs.unlink(file.path);
          return res.status(403).json({
            error: "Keine Berechtigung für Angebotsentwürfe.",
          });
        }

        const emailContext =
          subject.trim() || bodyNote.trim()
            ? [
                subject.trim() && `Betreff (Formular): ${subject.trim()}`,
                bodyNote.trim() && `Zusatztext (Formular):\n${bodyNote.trim()}`,
              ]
                .filter(Boolean)
                .join("\n\n")
                .slice(0, 12000)
            : undefined;

        const commercialIntentMetadata = {
          intent: intent.intent,
          confidence: intent.confidence,
          rationale: intent.rationale,
          intentRoutedAsOfferDueToPermission,
          uploadExpectedPipeline: useOrderPipeline ? ("order" as const) : ("offer" as const),
          uploadHint: uploadIntentHint,
        };

        const agentComm = await getCommercialAgentSettings(storage);

        const pipelineOpts = {
          storage,
          tenantId: req.tenantId ?? null,
          filePath: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          createdByUserId: userId,
          emailContext,
          commercialIntentMetadata,
        };

        if (useOrderPipeline) {
          const { draft, timings } = await runOrderDraftPipeline(pipelineOpts);
          emitCommercialDraftWebhooks({
            draft,
            draftKind: "order",
            intent: intent.intent,
            intentConfidence: intent.confidence,
            messageId: null,
            source: "manual_upload",
          });
          let strictAutoCreate: Awaited<ReturnType<typeof runStrictCommercialAutoCreateIfAllowed>> | null =
            null;
          if (agentComm.enabled && agentComm.strictAutoCreateOnly !== false) {
            const extracted = (draft.extractedData ?? {}) as Record<string, unknown>;
            strictAutoCreate = await runStrictCommercialAutoCreateIfAllowed({
              storage,
              tenantId: req.tenantId ?? null,
              draftId: draft.id,
              draftKind: "order",
              agentSettings: agentComm,
              extractedData: extracted,
              matchingResults: (draft.matchingResults ?? null) as MatchingResult | null,
              shopwareCustomerId: draft.shopwareCustomerId ?? null,
              intent: { intent: intent.intent, confidence: intent.confidence },
              messageId: null,
            });
          }
          return res.json({
            draft,
            draftKind: "order" as const,
            timings,
            commercialIntent: intent.intent,
            commercialIntentConfidence: intent.confidence,
            commercialIntentRationale: intent.rationale ?? null,
            intentRoutedAsOfferDueToPermission,
            uploadIntentHint: uploadIntentHint ?? null,
            strictAutoCreate,
          });
        }

        const { draft, timings } = await runOfferDraftPipeline(pipelineOpts);
        emitCommercialDraftWebhooks({
          draft,
          draftKind: "offer",
          intent: intent.intent,
          intentConfidence: intent.confidence,
          messageId: null,
          source: "manual_upload",
        });
        let strictAutoCreateOffer: Awaited<ReturnType<typeof runStrictCommercialAutoCreateIfAllowed>> | null =
          null;
        if (agentComm.enabled && agentComm.strictAutoCreateOnly !== false) {
          const extractedOffer = (draft.extractedData ?? {}) as Record<string, unknown>;
          strictAutoCreateOffer = await runStrictCommercialAutoCreateIfAllowed({
            storage,
            tenantId: req.tenantId ?? null,
            draftId: draft.id,
            draftKind: "offer",
            agentSettings: agentComm,
            extractedData: extractedOffer,
            matchingResults: (draft.matchingResults ?? null) as MatchingResult | null,
            shopwareCustomerId: draft.shopwareCustomerId ?? null,
            intent: { intent: intent.intent, confidence: intent.confidence },
            messageId: null,
          });
        }
        return res.json({
          draft,
          draftKind: "offer" as const,
          timings,
          commercialIntent: intent.intent,
          commercialIntentConfidence: intent.confidence,
          commercialIntentRationale: intent.rationale ?? null,
          intentRoutedAsOfferDueToPermission,
          uploadIntentHint: uploadIntentHint ?? null,
          strictAutoCreate: strictAutoCreateOffer,
        });
      } catch (error: any) {
        moduleLog.error({ err: error }, "[Commercial draft upload]");
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch {
            /* ignore */
          }
        }
        res.status(500).json({
          error: error.message || "Commercial-Draft-Upload fehlgeschlagen",
        });
      }
    }
  );

  // ============================================
  // ORDER DRAFTS ROUTES (AI-powered order creation)
  // ============================================

  // Configure multer for order draft uploads
  const orderDraftStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), 'order-drafts');
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, uploadPath);
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const sanitizedFilename = sanitizeFilename(file.originalname);
      cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
    },
  });

  const orderDraftUpload = multer({
    storage: orderDraftStorage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: commercialManualDraftFileFilter,
  });

  // POST /api/order-drafts/upload - Upload file and extract order data
  app.post(
    "/api/order-drafts/upload",
    requireAuth,
    requireManageOrderDrafts,
    uploadRateLimiter,
    orderDraftUpload.single('file'), restoreTenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = (req.user as any).id;
        const file = req.file;

        const aiSettings = await getAISettings(storage);
        if (aiSettings.mode === "openai_only") {
          try {
            const openaiSettings = await storage.getSetting("openai_settings");
            const { getOpenAIClient } = await import("../ai/openaiClient");
            getOpenAIClient(openaiSettings?.apiKey);
          } catch {
            await fs.unlink(file.path);
            return res.status(400).json({
              error:
                "OpenAI integration not available. Please configure the OpenAI API key in the settings.",
            });
          }
        }

        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          await fs.unlink(file.path);
          return res.status(400).json({
            error: "Shopware settings not configured. Please configure Shopware connection first.",
          });
        }

        const orderFileBuffer = await fs.readFile(file.path);
        const orderDocPreview = await extractDocumentTextPreviewForIntent(
          orderFileBuffer,
          file.mimetype,
          file.originalname,
          { ocrEnabled: aiSettings.ocrEnabled }
        );
        const orderIntent = await classifyCommercialDocumentIntent(storage, {
          subject: file.originalname,
          emailBody: "",
          documentTextPreview: orderDocPreview || undefined,
          tenantId: req.tenantId ?? null,
          traceId: `order-draft-upload-${Date.now()}`,
        });

        moduleLog.info(`[Order Draft] Pipeline for ${file.originalname} (${aiSettings.mode})...`);
        const { draft: orderDraft, timings } = await runOrderDraftPipeline({
          storage,
          tenantId: req.tenantId ?? null,
          filePath: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          createdByUserId: userId,
          commercialIntentMetadata: {
            intent: orderIntent.intent,
            confidence: orderIntent.confidence,
            rationale: orderIntent.rationale,
            uploadExpectedPipeline: "order",
          },
        });

        moduleLog.info(`[Order Draft] Created draft ${orderDraft.id} with status: ${orderDraft.status}`);
        moduleLog.info({ timings }, "[Order Draft] Timings (ms):");
        res.json(orderDraft);
      } catch (error: any) {
        moduleLog.error({ err: error }, "Error uploading order draft:");
        
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            moduleLog.error({ err: unlinkError }, "Error deleting file:");
          }
        }
        
        res.status(500).json({ 
          error: error.message || "Failed to process order draft upload" 
        });
      }
    }
  );

  // GET /api/order-drafts - Get all order drafts
  app.get("/api/order-drafts", requireAuthOrIntegrationKey, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const orderDrafts = await storage.getAllOrderDrafts();
      res.json(orderDrafts);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching order drafts:");
      res.status(500).json({ error: "Failed to fetch order drafts" });
    }
  });

  // GET /api/order-drafts/customer-search?q=... - Search Shopware customers for draft assignment
  app.get("/api/order-drafts/customer-search", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string)?.trim() ?? "";
      const limit = Math.min(50, Math.max(5, parseInt(String(req.query.limit || 20), 10) || 20));
      if (q.length < 2) {
        return res.json({ customers: [] });
      }
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware-Einstellungen nicht konfiguriert" });
      }
      const client = new ShopwareClient(settings);
      const customers = await client.searchCustomers(q, limit);
      res.json({ customers });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error searching customers for order draft:");
      res.status(500).json({ error: error.message ?? "Kundensuche fehlgeschlagen" });
    }
  });

  // GET /api/order-drafts/:id - Get single order draft with cross-selling suggestions
  app.get("/api/order-drafts/:id", requireAuthOrIntegrationKey, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const orderDraft = await storage.getOrderDraft(id);
      
      if (!orderDraft) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      // Generate cross-selling suggestions for matched products
      let crossSellingSuggestions: any[] = [];
      
      if (orderDraft.matchingResults?.items) {
        try {
          // Get Shopware client and cross-selling rules
          const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
          if (shopwareSettings) {
            const shopwareClient = new ShopwareClient(shopwareSettings);
            
            // Get all active cross-selling rules (manual + AI)
            const crossSellingRules = await getCombinedCrossSellingRules(req.tenantId ?? null);
            const ruleEngine = new RuleEngine();
            const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
            const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
            
            // For each matched product, find cross-selling suggestions
            for (const item of orderDraft.matchingResults.items) {
              if (item.matchedProduct && item.status === "matched") {
                try {
                  const productNumber = item.matchedProduct.productNumber;
                  if (!productNumber) {
                    continue;
                  }
                  const { products } = await shopwareClient.fetchProducts(
                    25,
                    1,
                    productNumber,
                    undefined,
                    false,
                    undefined,
                    undefined,
                    undefined,
                    true
                  );
                  const fullProduct = products.find((p) => p.productNumber === productNumber) || products[0];
                  if (fullProduct) {
                    // Get cross-selling suggestions using rule engine
                    const suggestions = await ruleEngine.suggestCrossSelling(
                      fullProduct,
                      crossSellingRules,
                      shopwareClient,
                      suggestOpts,
                    );
                    const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);
                    
                    // Add suggestions for this product (limit to top 10)
                    crossSellingSuggestions.push({
                      forProduct: {
                        id: item.matchedProduct.id,
                        name: item.matchedProduct.name,
                        productNumber: item.matchedProduct.productNumber,
                      },
                      suggestions: limitedSuggestions.map(s => ({
                        id: s.id,
                        productNumber: s.productNumber,
                        name: s.name,
                        price: s.price,
                        netPrice: s.netPrice,
                        imageUrl: s.imageUrl,
                        stock: s.stock,
                        available: s.available,
                        crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
                        hybridScore: (s as { hybridScore?: number }).hybridScore,
                      })),
                    });
                  }
                } catch (productError) {
                  moduleLog.warn({ err: productError }, `[Cross-Selling] Failed to fetch suggestions for product ${item.matchedProduct.id}:`);
                }
              }
            }
          }
        } catch (crossSellingError) {
          moduleLog.warn({ err: crossSellingError }, "[Cross-Selling] Failed to generate suggestions:");
        }
      }
      
      recordDraftSuggestionImpressions(storage, {
        tenantId: req.tenantId ?? null,
        userId: (req.user as { id?: string } | undefined)?.id ?? null,
        draftId: id,
        kind: "order_draft",
        groups: crossSellingSuggestions,
      });

      // Return draft with cross-selling suggestions
      res.json({
        ...orderDraft,
        crossSellingSuggestions,
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching order draft:");
      res.status(500).json({ error: "Failed to fetch order draft" });
    }
  });

  // GET /api/order-drafts/:id/clarification-email — Vorschau Rückfrage-Mail (kein Versand)
  app.get(
    "/api/order-drafts/:id/clarification-email",
    requireAuth,
    requireManageOrderDrafts,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const draft = await storage.getOrderDraft(id);
        if (!draft) return res.status(404).json({ error: "Order draft not found" });
        const payload = buildCommercialClarificationEmail({
          kind: "order",
          originalFileName: draft.originalFileName,
          extractedData: draft.extractedData as Record<string, unknown> | null,
          matchingResults: draft.matchingResults as any,
        });
        res.json(payload);
      } catch (error: any) {
        moduleLog.error({ err: error }, "Error building order draft clarification email:");
        res.status(500).json({ error: error.message ?? "Failed to build clarification email" });
      }
    }
  );

  // PATCH /api/order-drafts/:id - Update order draft
  app.patch("/api/order-drafts/:id", requireAuthOrIntegrationKey, requireManageOrderDrafts, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Validate that draft exists
      const existingDraft = await storage.getOrderDraft(id);
      if (!existingDraft) {
        return res.status(404).json({ error: "Order draft not found" });
      }

      // Validate update data
      const updateSchema = z.object({
        status: z.enum(["pending", "review_required", "approved", "rejected", "created"]).optional(),
        extractedData: z.any().optional(),
        matchingResults: z.any().optional(),
        shopwareCustomerId: z.string().nullable().optional(),
      });

      const validated = updateSchema.parse(req.body);

      // Status "created" heißt "es existiert eine echte Shopware-Bestellung" —
      // das darf nur POST .../create-order setzen (das dabei auch shopwareOrderId
      // schreibt), nicht dieses generische PATCH. Sonst könnten Dashboards/Reports,
      // die sich auf status==="created" verlassen, Fantasie-Bestellungen zählen.
      if (validated.status === "created" && !existingDraft.shopwareOrderId) {
        return res.status(400).json({
          error: "Status kann nicht direkt auf 'created' gesetzt werden — dafür POST /api/order-drafts/:id/create-order verwenden.",
        });
      }

      const updatedDraftPayload: Record<string, unknown> = {
        extractedData: validated.extractedData ?? existingDraft.extractedData,
        matchingResults: validated.matchingResults ?? existingDraft.matchingResults,
      };
      if (validated.shopwareCustomerId !== undefined) {
        updatedDraftPayload.shopwareCustomerId = validated.shopwareCustomerId;
      }

      // Update order draft
      const updatedDraft = await storage.updateOrderDraft(id, validated);
      
      if (!updatedDraft) {
        return res.status(404).json({ error: "Order draft not found" });
      }

      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          existingDraft,
          updatedDraft: updatedDraftPayload,
          tenantId: req.tenantId ?? null,
          draftKind: "order",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        moduleLog.warn({ err: learningError }, "[Commercial product learning] order patch feedback failed:");
      }
      
      res.json(updatedDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating order draft:");
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update order draft" });
    }
  });

  app.post(
    "/api/order-drafts/:id/create-shopware-customer",
    requireAuth,
    requireManageOrderDrafts,
    async (req: Request, res: Response) => {
      try {
        if (!(await getCommercialAgentSettings(storage)).customerManualCreateEnabled) {
          return res.status(403).json({
            error:
              "Kundenanlage ist deaktiviert. Bitte einen bestehenden Shopware-Kunden zuordnen (COMMERCIAL_AGENT_CUSTOMER_MANUAL_CREATE=true schaltet die Anlage frei).",
          });
        }
        const { id } = req.params;
        const bodySchema = z.object({ extractedData: z.any().optional() });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültiger Request", details: parsed.error.errors });
        }
        const draft = await storage.getOrderDraft(id);
        if (!draft) {
          return res.status(404).json({ error: "Order draft not found" });
        }
        const mergedRaw = mergeDraftExtractedData(
          draft.extractedData as Record<string, unknown> | null | undefined,
          parsed.data.extractedData as Record<string, unknown> | null | undefined,
        );
        const resolvedEmail = resolveEmailForShopwareCustomerCreate(mergedRaw);
        if ("error" in resolvedEmail) {
          return res.status(400).json({ error: resolvedEmail.error });
        }
        const { email, merged } = resolvedEmail;
        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          return res.status(400).json({ error: "Shopware nicht konfiguriert" });
        }
        const shopwareClient = new ShopwareClient(shopwareSettings);
        const created = await tryCreateShopwareCustomerFromExtractedData(shopwareClient, merged as {
          customer?: DraftExtractedCustomer;
          billingAddress?: DraftBillingAddressInput;
          shippingAddress?: DraftBillingAddressInput;
        }, email);
        if ("error" in created) {
          return res.status(400).json({ error: created.error });
        }
        const agentComm = await getCommercialAgentSettings(storage);
        const minCust = agentComm.customerMatchAutoMinConfidence ?? 72;
        const prevCust =
          typeof merged.customer === "object" && merged.customer ? { ...merged.customer } : {};
        const cust = { ...prevCust, customerMatchConfidence: Math.min(100, minCust + 8) };
        const updatedDraft = await storage.updateOrderDraft(id, {
          shopwareCustomerId: created.id,
          extractedData: { ...merged, customer: cust },
        });
        if (!updatedDraft) {
          return res.status(404).json({ error: "Order draft not found" });
        }
        res.json(updatedDraft);
      } catch (error: any) {
        moduleLog.error({ err: error }, "Error creating Shopware customer from order draft:");
        res.status(500).json({ error: error.message || "Anlage fehlgeschlagen" });
      }
    }
  );

  // POST /api/order-drafts/:id/add-product - Add a cross-selling product to draft
  app.post("/api/order-drafts/:id/add-product", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      // crossSell (optional): { sourceProductNumber, rank } wenn der Klick von einem Vorschlag kommt
      const { productId, quantity = 1 } = req.body;
      
      if (!productId) {
        return res.status(400).json({ error: "Product ID is required" });
      }
      
      // Get order draft
      const draft = await storage.getOrderDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      // Get Shopware product details
      const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!shopwareSettings) {
        return res.status(400).json({ error: "Shopware integration not configured" });
      }
      const shopwareClient = new ShopwareClient(shopwareSettings);
      const productMeta = await shopwareClient.fetchProductDataQuality(productId);
      const searchTerm = productMeta?.productNumber || productId;
      const { products } = await shopwareClient.fetchProducts(25, 1, searchTerm);
      const product = products.find((p) => p.id === productId) || products[0];
      if (!product) {
        return res.status(404).json({ error: "Product not found in Shopware" });
      }
      
      // Add product to matching results
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: product.name,
        extractedProductNumber: product.productNumber,
        quantity: quantity,
        matchedProduct: {
          id: product.id,
          productNumber: product.productNumber,
          name: product.name,
          price: product.price,
        },
        confidence: 100, // Manually added = 100% confidence
        status: "matched",
      });
      
      // Calculate new overall confidence
      const totalConfidence = updatedItems.reduce((sum, item) => sum + (item.confidence || 0), 0);
      const overallConfidence = updatedItems.length > 0 ? Math.round(totalConfidence / updatedItems.length) : 0;
      
      // Update draft
      const updatedDraft = await storage.updateOrderDraft(id, {
        matchingResults: {
          items: updatedItems,
          overallConfidence,
        },
      });
      
      await recordDraftSuggestionAdd(storage, {
        tenantId: req.tenantId ?? null,
        userId: (req.user as { id?: string } | undefined)?.id ?? null,
        draftId: id,
        kind: "order_draft",
        crossSell: req.body?.crossSell,
        targetProductNumber: product.productNumber,
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error adding product to draft:");
      res.status(500).json({ error: "Failed to add product to draft" });
    }
  });

  // POST /api/order-drafts/:id/add-bundle - Add a bundle to draft
  app.post("/api/order-drafts/:id/add-bundle", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { bundleId, quantity = 1 } = req.body;
      
      if (!bundleId) {
        return res.status(400).json({ error: "Bundle ID is required" });
      }
      
      // Get order draft
      const draft = await storage.getOrderDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      
      if (bundle.active !== 1) {
        return res.status(400).json({ error: "Bundle is inactive" });
      }
      
      const { productCache } = await import("../products/productCache");
      const invalidProducts: string[] = [];
      const components = bundle.items.map((item) => {
        const product = productCache.getProductByNumber(item.productNumber);
        if (!product) {
          invalidProducts.push(item.productNumber);
        }
        return {
          productNumber: item.productNumber,
          productId: item.productId || product?.id,
          productName: product?.name,
          quantity: item.quantity,
        };
      });
      
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Some bundle products could not be resolved",
          invalidProducts,
        });
      }
      
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: bundle.name,
        extractedProductNumber: bundle.mockProductNumber,
        quantity,
        bundle: {
          id: bundle.id,
          name: bundle.name,
          mockProductNumber: bundle.mockProductNumber,
          components,
        },
        confidence: 100,
        status: "matched",
      });
      
      const totalConfidence = updatedItems.reduce((sum, item) => sum + (item.confidence || 0), 0);
      const overallConfidence = updatedItems.length > 0 ? Math.round(totalConfidence / updatedItems.length) : 0;
      
      const updatedDraft = await storage.updateOrderDraft(id, {
        matchingResults: {
          items: updatedItems,
          overallConfidence,
        },
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error adding bundle to order draft:");
      res.status(500).json({ error: "Failed to add bundle to draft" });
    }
  });

  // POST /api/order-drafts/:id/recheck - Produktabgleich + Kundenzuordnung erneut ausführen (ohne Neu-Upload).
  // Body: { autoCreate?: boolean } — true (Automation) bewertet danach Strikt-Auto-Create und legt ggf. an.
  app.post("/api/order-drafts/:id/recheck", requireAuthOrIntegrationKey, requireManageOrderDrafts, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { recheckOrderDraft } = await import("../commercial/commercialDraftRecheck");
      const result = await recheckOrderDraft(storage, req.params.id, {
        tenantId: req.tenantId ?? null,
        autoCreate: req.body?.autoCreate === true,
      });
      if (!result.ok) {
        return res.status(result.statusCode).json({ error: result.error });
      }
      res.json({ draft: result.draft, summary: result.summary });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error rechecking order draft:");
      res.status(500).json({ error: error?.message || "Erneute Prüfung fehlgeschlagen" });
    }
  });

  // POST /api/order-drafts/:id/create-order - Create Shopware order from draft
  app.post("/api/order-drafts/:id/create-order", requireAuthOrIntegrationKey, requireManageOrderDrafts, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const allowedChannelIds = await getSalesChannelFilter(req);
      // Wie beim Angebot: an den Kunden gebundener Verkaufskanal hat Vorrang vor Env/Settings/Default.
      const ensuredCustomer = await ensureDraftShopwareCustomerId(storage, {
        kind: "order",
        draftId: id,
        tenantId: req.tenantId ?? null,
      });
      if (!ensuredCustomer.ok) {
        return res.status(ensuredCustomer.statusCode).json({ error: ensuredCustomer.error });
      }
      const customerChannelId = await fetchCustomerBoundSalesChannelId(
        storage,
        req.tenantId ?? null,
        ensuredCustomer.customerId
      );
      const channelResult = await resolveOfferSalesChannelId(storage, {
        tenantId: req.tenantId ?? null,
        requestedChannelId: req.body?.sales_channel_id,
        customerChannelId,
        allowedChannelIds,
      });
      if (!channelResult.ok) {
        return res.status(channelResult.statusCode).json({ error: channelResult.error });
      }
      const result = await executeCreateOrderFromDraft(storage, id, {
        salesChannelId: channelResult.salesChannelId,
        tenantId: req.tenantId ?? null,
      });
      if (!result.ok) {
        return res.status(result.statusCode).json({ error: result.error });
      }
      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          updatedDraft: {
            extractedData: result.draft.extractedData as any,
            matchingResults: result.draft.matchingResults as any,
          },
          tenantId: req.tenantId ?? null,
          draftKind: "order",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        moduleLog.warn({ err: learningError }, "[Commercial product learning] order create feedback failed:");
      }
      res.json({
        message: "Order created successfully",
        draft: result.draft,
        order: { id: result.orderId },
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating order from draft:");
      res.status(500).json({
        error: error.message || "Failed to create order from draft",
      });
    }
  });

  // ============================================
  // ENTWURFS-ANHÄNGE (Beilagen: Lieferschein, AB, Rechnung) — Anzeige + DMS-Übergabe (Lobster → d.3)
  // ============================================

  // Was das Review-Modal anbieten darf (ohne Settings-Recht lesbar)
  app.get("/api/commercial-drafts/capabilities", requireAuth, async (_req: Request, res: Response) => {
    const agent = await getCommercialAgentSettings(storage);
    res.json({ customerCreateEnabled: agent.customerManualCreateEnabled === true });
  });

  app.get("/api/order-drafts/:id/attachments", requireAuthOrIntegrationKey, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOrderDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Order draft not found" });
      res.json({
        draftId: draft.id,
        draftKind: "order",
        buyerDocumentNumber: draft.buyerDocumentNumber ?? null,
        shopwareOrderId: draft.shopwareOrderId ?? null,
        // Review-Modal: Button „Per SFTP übergeben" nur anzeigen, wenn ein Server aktiv ist
        sftpAvailable: await hasEnabledSftpServers(storage, req.tenantId ?? null),
        attachments: listDraftAttachmentsForApi(draft.attachments),
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error listing order draft attachments:");
      res.status(500).json({ error: "Failed to list attachments" });
    }
  });

  app.get("/api/order-drafts/:id/attachments/:attachmentId/file", requireAuthOrIntegrationKey, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOrderDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Order draft not found" });
      await sendDraftAttachmentFile(res, draft.attachments, req.params.attachmentId);
    } catch (error) {
      moduleLog.error({ err: error }, "Error sending order draft attachment:");
      if (!res.headersSent) res.status(500).json({ error: "Failed to send attachment" });
    }
  });

  // Export-Status setzen (Lobster nach Ablage im d.3): { exportStatus: "exported"|"skipped"|"pending", exportReference?: string }
  app.patch("/api/order-drafts/:id/attachments/:attachmentId", requireAuthOrIntegrationKey, requireManageOrderDrafts, requireCsrf, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOrderDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Order draft not found" });
      const update = parseDraftAttachmentExportUpdate(req.body);
      if ("error" in update) return res.status(400).json({ error: update.error });
      const next = applyDraftAttachmentExportUpdate(draft.attachments, req.params.attachmentId, update);
      if (!next) return res.status(404).json({ error: "Attachment not found" });
      const saved = await storage.updateOrderDraft(draft.id, { attachments: next }, req.tenantId ?? null);
      res.json({ attachments: listDraftAttachmentsForApi(saved?.attachments ?? next) });
    } catch (error) {
      moduleLog.error({ err: error }, "Error updating order draft attachment:");
      res.status(500).json({ error: "Failed to update attachment" });
    }
  });

  // DELETE /api/order-drafts/:id - Delete order draft
  app.delete("/api/order-drafts/:id", requireAuth, requireManageOrderDrafts, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get draft to delete file
      const draft = await storage.getOrderDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Order draft not found" });
      }

      // Delete uploaded file if it exists
      if (draft.originalFilePath) {
        try {
          await fs.unlink(draft.originalFilePath);
        } catch (error) {
          moduleLog.error({ err: error }, "Error deleting file:");
          // Continue with draft deletion even if file deletion fails
        }
      }

      // Delete draft from database
      const deleted = await storage.deleteOrderDraft(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Order draft not found" });
      }
      
      res.json({ message: "Order draft deleted successfully" });
    } catch (error) {
      moduleLog.error({ err: error }, "Error deleting order draft:");
      res.status(500).json({ error: "Failed to delete order draft" });
    }
  });

  // ============================================
  // OFFER DRAFTS ROUTES (AI-powered quote/offer creation)
  // ============================================

  // Configure multer for offer draft uploads
  const offerDraftStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadPath = path.join(getUploadsRoot(), 'offer-drafts');
      try {
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (error) {
        cb(error as Error, uploadPath);
      }
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
      const sanitizedFilename = sanitizeFilename(file.originalname);
      cb(null, `${uniqueSuffix}-${sanitizedFilename}`);
    },
  });

  const offerDraftUpload = multer({
    storage: offerDraftStorage,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: commercialManualDraftFileFilter,
  });

  // POST /api/offer-drafts/upload - Upload file and extract offer data
  app.post(
    "/api/offer-drafts/upload",
    requireAuth,
    requireManageOffers,
    uploadRateLimiter,
    offerDraftUpload.single('file'), restoreTenantContext,
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const userId = (req.user as any).id;
        const file = req.file;

        const aiSettings = await getAISettings(storage);
        if (aiSettings.mode === "openai_only") {
          try {
            const openaiSettings = await storage.getSetting("openai_settings");
            const { getOpenAIClient } = await import("../ai/openaiClient");
            getOpenAIClient(openaiSettings?.apiKey);
          } catch {
            await fs.unlink(file.path);
            return res.status(400).json({
              error:
                "OpenAI integration not available. Please configure the OpenAI API key in the settings.",
            });
          }
        }

        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          await fs.unlink(file.path);
          return res.status(400).json({
            error: "Shopware settings not configured. Please configure Shopware connection first.",
          });
        }

        const offerFileBuffer = await fs.readFile(file.path);
        const offerDocPreview = await extractDocumentTextPreviewForIntent(
          offerFileBuffer,
          file.mimetype,
          file.originalname,
          { ocrEnabled: aiSettings.ocrEnabled }
        );
        const offerIntent = await classifyCommercialDocumentIntent(storage, {
          subject: file.originalname,
          emailBody: "",
          documentTextPreview: offerDocPreview || undefined,
          tenantId: req.tenantId ?? null,
          traceId: `offer-draft-upload-${Date.now()}`,
        });

        moduleLog.info(`[Offer Draft] Pipeline for ${file.originalname} (${aiSettings.mode})...`);
        const { draft: offerDraft, timings } = await runOfferDraftPipeline({
          storage,
          tenantId: req.tenantId ?? null,
          filePath: file.path,
          originalFileName: file.originalname,
          mimeType: file.mimetype,
          createdByUserId: userId,
          commercialIntentMetadata: {
            intent: offerIntent.intent,
            confidence: offerIntent.confidence,
            rationale: offerIntent.rationale,
            uploadExpectedPipeline: "offer",
          },
        });

        moduleLog.info(`[Offer Draft] Created draft ${offerDraft.id} with status: ${offerDraft.status}`);
        moduleLog.info({ timings }, "[Offer Draft] Timings (ms):");
        res.json(offerDraft);
      } catch (error: any) {
        moduleLog.error({ err: error }, "Error uploading offer draft:");
        
        // Clean up uploaded file on error
        if (req.file) {
          try {
            await fs.unlink(req.file.path);
          } catch (unlinkError) {
            moduleLog.error({ err: unlinkError }, "Error deleting file:");
          }
        }
        
        res.status(500).json({ 
          error: error.message || "Failed to process offer draft upload" 
        });
      }
    }
  );

  // POST /api/offer-drafts/from-cpq - Create offer draft from CPQ Konfigurator
  app.post("/api/offer-drafts/from-cpq", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { systemId, systemName, config, billOfMaterials, cpqConfigurationId, previewImageBase64, customerId } = req.body;
      const user = req.user as { id?: string; username?: string };
      const userId = user?.id ?? user?.username ?? "unknown";

      if (!billOfMaterials || !billOfMaterials.items || billOfMaterials.items.length === 0) {
        return res.status(400).json({ error: "Stückliste ist leer. Bitte zuerst die Konfiguration im CPQ-Konfigurator vervollständigen." });
      }
      // Nur ein echtes data:image/...;base64,... durchlassen — alles andere (leerer
      // String, fehlgeschlagene Client-Erfassung) wird als "kein Bild" behandelt.
      const previewImage =
        typeof previewImageBase64 === "string" && /^data:image\/\w+;base64,/.test(previewImageBase64)
          ? previewImageBase64
          : null;

      type BomItemIn = {
        productId: string;
        productNumber: string;
        name: string;
        quantity: number;
        unitPrice: number;
        lineTotal?: number;
        componentType?: string;
        /** Katalogpreis (netto) vor kundenspezifischem Rabatt — von der CPQ-Preisberechnung gesetzt. */
        catalogUnitPrice?: number;
        /** Rabatt in % ggü. Katalogpreis. */
        discountPercent?: number;
      };

      const bomItems: BomItemIn[] = billOfMaterials.items;
      const totalCatalogValue: number =
        typeof billOfMaterials.totalCatalogPrice === "number" ? billOfMaterials.totalCatalogPrice : billOfMaterials.totalPrice;
      const totalSuggestedValue: number = billOfMaterials.totalPrice;
      const totalDiscountPercentage =
        totalCatalogValue > 0 ? Math.round((1 - totalSuggestedValue / totalCatalogValue) * 1000) / 10 : 0;

      const matchingResults = {
        items: bomItems.map((item) => ({
          extractedProductName: item.name,
          extractedProductNumber: item.productNumber,
          quantity: item.quantity,
          matchedProduct: {
            id: item.productId,
            productNumber: item.productNumber,
            name: item.name,
            catalogPrice: item.catalogUnitPrice ?? item.unitPrice,
            suggestedPrice: item.unitPrice,
            suggestedDiscount: item.discountPercent ?? 0,
          },
          confidence: 100,
          status: "matched",
          productScreen: { likelihood: "likely_product" as const, reasons: ["CPQ-Stückliste"] },
        })),
        overallConfidence: 100,
        pricingRecommendations: {
          totalCatalogValue,
          totalSuggestedValue,
          totalDiscountPercentage,
          reasoning: "CPQ-Konfigurator",
        },
      };

      const offerDraft = await storage.createOfferDraft(
        {
          // "review_required", nicht "approved": der Draft muss in der
          // "Angebotsentwürfe"-Sektion auf /offers auftauchen (pending/review_required),
          // damit ein Sachbearbeiter ihn einem Kunden zuordnen kann. NICHT "pending" —
          // das ist in commercialDraftPipeline.ts nur ein Platzhalter-Defaultwert, der
          // vor dem Speichern immer durch approved/review_required ersetzt wird; als
          // gespeicherter Endzustand hat "pending" nirgendwo im System einen
          // "Freigeben"-Übergang, wodurch executeCreateOfferFromDraft() jeden Versuch,
          // daraus ein Angebot zu erstellen, mit 400 "Draft is still pending" ablehnt.
          status: "review_required",
          originalFileName: `CPQ-${systemName ?? systemId ?? "Konfiguration"}-${new Date().toISOString().slice(0, 10)}.json`,
          originalFilePath: null,
        extractedData: {
          offerNotes: `CPQ-Konfigurator: ${systemName ?? systemId ?? "Regalsystem"}`,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          cpqSource: {
            systemId: systemId ?? null,
            systemName: systemName ?? null,
            config: config && typeof config === "object" ? config : null,
            cpqConfigurationId: typeof cpqConfigurationId === "string" ? cpqConfigurationId : null,
            previewImageBase64: previewImage,
            billOfMaterials: {
              items: bomItems.map((item) => ({
                productId: item.productId,
                productNumber: item.productNumber,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
                componentType: item.componentType,
                catalogPrice: item.catalogUnitPrice,
                discountPercent: item.discountPercent,
              })),
              totalPrice: billOfMaterials.totalPrice,
              totalCatalogPrice: totalCatalogValue,
            },
          },
        },
        matchingResults,
        shopwareCustomerId: typeof customerId === "string" && customerId ? customerId : null,
        shopwareOfferId: null,
        createdByUserId: userId,
        },
        req.tenantId ?? null
      );

      res.json(offerDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating offer draft from CPQ:");
      res.status(500).json({ error: error.message ?? "Fehler beim Erstellen des Angebotsentwurfs" });
    }
  });

  // GET /api/offer-drafts - Get all offer drafts
  app.get("/api/offer-drafts", requireAuthOrIntegrationKey, requireViewOffers, async (req: Request, res: Response) => {
    try {
      // Optionaler ?status=a,b-Filter — die einzige Liste, die diese Route heute konsumiert
      // (OffersPage "Ausstehende Entwürfe"), braucht ausschließlich pending/review_required
      // und muss nicht die komplette Historie inkl. großer JSONB-Spalten laden.
      const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
      const statuses = statusParam
        ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const offerDrafts = await storage.getAllOfferDrafts(req.tenantId ?? null, statuses);
      res.json(offerDrafts);
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching offer drafts:");
      res.status(500).json({ error: "Failed to fetch offer drafts" });
    }
  });

  // GET /api/offer-drafts/customer-search?q=... - Search Shopware customers for draft assignment
  app.get("/api/offer-drafts/customer-search", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string)?.trim() ?? "";
      const limit = Math.min(50, Math.max(5, parseInt(String(req.query.limit || 20), 10) || 20));
      if (q.length < 2) {
        return res.json({ customers: [] });
      }
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware-Einstellungen nicht konfiguriert" });
      }
      const client = new ShopwareClient(settings);
      const customers = await client.searchCustomers(q, limit);
      res.json({ customers });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error searching customers for offer draft:");
      res.status(500).json({ error: error.message ?? "Kundensuche fehlgeschlagen" });
    }
  });

  // GET /api/offer-drafts/:id - Get single offer draft with cross-selling suggestions
  app.get("/api/offer-drafts/:id", requireAuthOrIntegrationKey, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const offerDraft = await storage.getOfferDraft(id);
      
      if (!offerDraft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      // Generate cross-selling suggestions for matched products
      let crossSellingSuggestions: any[] = [];
      
      if (offerDraft.matchingResults?.items) {
        try {
          // Get Shopware client and cross-selling rules
          const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
          if (shopwareSettings) {
            const shopwareClient = new ShopwareClient(shopwareSettings);
            
            // Get all active cross-selling rules
            const crossSellingRules = await getCombinedCrossSellingRules(req.tenantId ?? null);
            const ruleEngine = new RuleEngine();
            const rankingBundle = await loadCrossSellRankingBundle(req.tenantId ?? null);
            const suggestOpts = crossSellSuggestOptions(req.tenantId ?? null, rankingBundle, "full");
            
            // Für jedes gematchte Produkt Cross-Selling-Vorschläge ermitteln — die
            // "vollständiges Produkt"-Auflösung läuft primär über den lokalen Produktcache
            // (O(1), kein Shopware-Roundtrip); nur bei Cache-Miss wird gezielt nachgesucht.
            // Die restlichen, unabhängigen Items laufen parallel statt sequenziell.
            const matchedItems = offerDraft.matchingResults.items.filter(
              (item) => item.matchedProduct && item.status === "matched" && item.matchedProduct.productNumber,
            );
            const suggestionResults = await Promise.all(
              matchedItems.map(async (item) => {
                try {
                  const productNumber = item.matchedProduct!.productNumber;
                  let fullProduct = productCache.getProductByNumber(productNumber);
                  if (!fullProduct) {
                    const { products } = await shopwareClient.fetchProducts(
                      25,
                      1,
                      productNumber,
                      undefined,
                      false,
                      undefined,
                      undefined,
                      undefined,
                      true
                    );
                    fullProduct = products.find((p) => p.productNumber === productNumber) || products[0];
                  }
                  if (!fullProduct) return null;

                  const suggestions = await ruleEngine.suggestCrossSelling(
                    fullProduct,
                    crossSellingRules,
                    shopwareClient,
                    suggestOpts,
                  );
                  const limitedSuggestions = dedupeAndLimitSuggestions(suggestions, 10);

                  return {
                    forProduct: {
                      id: item.matchedProduct!.id,
                      name: item.matchedProduct!.name,
                      productNumber: item.matchedProduct!.productNumber,
                    },
                    suggestions: limitedSuggestions.map(s => ({
                      id: s.id,
                      productNumber: s.productNumber,
                      name: s.name,
                      price: s.price,
                      netPrice: s.netPrice,
                      imageUrl: s.imageUrl,
                      stock: s.stock,
                      available: s.available,
                      crossSellReason: (s as { crossSellReason?: string }).crossSellReason,
                      hybridScore: (s as { hybridScore?: number }).hybridScore,
                    })),
                  };
                } catch (productError) {
                  moduleLog.warn({ err: productError }, `[Cross-Selling] Failed to fetch suggestions for product ${item.matchedProduct!.id}:`);
                  return null;
                }
              }),
            );
            crossSellingSuggestions = suggestionResults.filter((s): s is NonNullable<typeof s> => s !== null);
          }
        } catch (crossSellingError) {
          moduleLog.warn({ err: crossSellingError }, "[Cross-Selling] Failed to generate suggestions:");
        }
      }
      
      recordDraftSuggestionImpressions(storage, {
        tenantId: req.tenantId ?? null,
        userId: (req.user as { id?: string } | undefined)?.id ?? null,
        draftId: id,
        kind: "offer_draft",
        groups: crossSellingSuggestions,
      });

      // Return draft with cross-selling suggestions
      res.json({
        ...offerDraft,
        crossSellingSuggestions,
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error fetching offer draft:");
      res.status(500).json({ error: "Failed to fetch offer draft" });
    }
  });

  // GET /api/offer-drafts/:id/clarification-email — Vorschau Rückfrage-Mail (kein Versand)
  app.get("/api/offer-drafts/:id/clarification-email", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const draft = await storage.getOfferDraft(id);
      if (!draft) return res.status(404).json({ error: "Offer draft not found" });
      const payload = buildCommercialClarificationEmail({
        kind: "offer",
        originalFileName: draft.originalFileName,
        extractedData: draft.extractedData as Record<string, unknown> | null,
        matchingResults: draft.matchingResults as any,
      });
      res.json(payload);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error building offer draft clarification email:");
      res.status(500).json({ error: error.message ?? "Failed to build clarification email" });
    }
  });

  // PATCH /api/offer-drafts/:id - Update offer draft
  app.patch("/api/offer-drafts/:id", requireAuthOrIntegrationKey, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Validate that draft exists
      const existingDraft = await storage.getOfferDraft(id);
      if (!existingDraft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      // Validate update data
      const updateSchema = z.object({
        status: z.enum(["pending", "review_required", "approved", "rejected", "created"]).optional(),
        extractedData: z.any().optional(),
        matchingResults: z.any().optional(),
        shopwareCustomerId: z.string().nullable().optional(),
      });

      const validated = updateSchema.parse(req.body);

      // Status "created" heißt "es existiert ein echtes Shopware-Angebot" — das darf
      // nur POST .../create-offer setzen (das dabei auch shopwareOfferId schreibt),
      // nicht dieses generische PATCH.
      if (validated.status === "created" && !existingDraft.shopwareOfferId) {
        return res.status(400).json({
          error: "Status kann nicht direkt auf 'created' gesetzt werden — dafür POST /api/offer-drafts/:id/create-offer verwenden.",
        });
      }

      const updatedDraftPayload = {
        extractedData: validated.extractedData ?? existingDraft.extractedData,
        matchingResults: validated.matchingResults ?? existingDraft.matchingResults,
      };

      // Update offer draft
      const updatedDraft = await storage.updateOfferDraft(id, validated);
      
      if (!updatedDraft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          existingDraft,
          updatedDraft: updatedDraftPayload,
          tenantId: req.tenantId ?? null,
          draftKind: "offer",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        moduleLog.warn({ err: learningError }, "[Commercial product learning] offer patch feedback failed:");
      }
      
      res.json(updatedDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error updating offer draft:");
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid update data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update offer draft" });
    }
  });

  app.post(
    "/api/offer-drafts/:id/create-shopware-customer",
    requireAuth,
    requireManageOffers,
    async (req: Request, res: Response) => {
      try {
        if (!(await getCommercialAgentSettings(storage)).customerManualCreateEnabled) {
          return res.status(403).json({
            error:
              "Kundenanlage ist deaktiviert. Bitte einen bestehenden Shopware-Kunden zuordnen (COMMERCIAL_AGENT_CUSTOMER_MANUAL_CREATE=true schaltet die Anlage frei).",
          });
        }
        const { id } = req.params;
        const bodySchema = z.object({ extractedData: z.any().optional() });
        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültiger Request", details: parsed.error.errors });
        }
        const draft = await storage.getOfferDraft(id);
        if (!draft) {
          return res.status(404).json({ error: "Offer draft not found" });
        }
        const mergedRaw = mergeDraftExtractedData(
          draft.extractedData as Record<string, unknown> | null | undefined,
          parsed.data.extractedData as Record<string, unknown> | null | undefined,
        );
        const resolvedEmail = resolveEmailForShopwareCustomerCreate(mergedRaw);
        if ("error" in resolvedEmail) {
          return res.status(400).json({ error: resolvedEmail.error });
        }
        const { email, merged } = resolvedEmail;
        const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
        if (!shopwareSettings) {
          return res.status(400).json({ error: "Shopware nicht konfiguriert" });
        }
        const shopwareClient = new ShopwareClient(shopwareSettings);
        const created = await tryCreateShopwareCustomerFromExtractedData(shopwareClient, merged as {
          customer?: DraftExtractedCustomer;
          billingAddress?: DraftBillingAddressInput;
          shippingAddress?: DraftBillingAddressInput;
        }, email);
        if ("error" in created) {
          return res.status(400).json({ error: created.error });
        }
        const agentComm = await getCommercialAgentSettings(storage);
        const minCust = agentComm.customerMatchAutoMinConfidence ?? 72;
        const prevCust =
          typeof merged.customer === "object" && merged.customer ? { ...merged.customer } : {};
        const cust = { ...prevCust, customerMatchConfidence: Math.min(100, minCust + 8) };
        const updatedDraft = await storage.updateOfferDraft(id, {
          shopwareCustomerId: created.id,
          extractedData: { ...merged, customer: cust },
        });
        if (!updatedDraft) {
          return res.status(404).json({ error: "Offer draft not found" });
        }
        res.json(updatedDraft);
      } catch (error: any) {
        moduleLog.error({ err: error }, "Error creating Shopware customer from offer draft:");
        res.status(500).json({ error: error.message || "Anlage fehlgeschlagen" });
      }
    }
  );

  // GET /api/offer-drafts/:id/pdf - Generate PDF from offer draft (Phase 6)
  app.get("/api/offer-drafts/:id/pdf", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { download } = req.query;

      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      if (!draft.matchingResults?.items?.length && !draft.extractedData) {
        return res.status(400).json({ error: "Draft has no data to generate PDF" });
      }

      const { generateOfferDraftPdf } = await import("../offers/offerDraftPdf");
      const pdfBuffer = await generateOfferDraftPdf({
        ...draft,
        extractedData: draft.extractedData ?? undefined,
        matchingResults: draft.matchingResults ?? undefined,
      });

      res.setHeader("Content-Type", "application/pdf");
      if (download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="Angebotsentwurf-${draft.originalFileName || id}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="Angebotsentwurf-${id}.pdf"`);
      }
      res.send(pdfBuffer);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error generating offer draft PDF:");
      res.status(500).json({ error: error.message || "Failed to generate PDF" });
    }
  });

  // POST /api/offer-drafts/:id/add-product - Add a cross-selling product to draft
  app.post("/api/offer-drafts/:id/add-product", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      // crossSell (optional): { sourceProductNumber, rank } wenn der Klick von einem Vorschlag kommt
      const { productId, quantity = 1 } = req.body;
      
      if (!productId) {
        return res.status(400).json({ error: "Product ID is required" });
      }
      
      // Get offer draft
      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      // Get Shopware product details
      const shopwareSettings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!shopwareSettings) {
        return res.status(400).json({ error: "Shopware integration not configured" });
      }
      const shopwareClient = new ShopwareClient(shopwareSettings);
      const productMeta = await shopwareClient.fetchProductDataQuality(productId);
      const searchTerm = productMeta?.productNumber || productId;
      const { products } = await shopwareClient.fetchProducts(25, 1, searchTerm);
      const product = products.find((p) => p.id === productId) || products[0];
      if (!product) {
        return res.status(404).json({ error: "Product not found in Shopware" });
      }
      
      // Add product to matching results
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: product.name,
        extractedProductNumber: product.productNumber,
        quantity: quantity,
        matchedProduct: {
          id: product.id,
          productNumber: product.productNumber,
          name: product.name,
          catalogPrice: product.price,
        },
        confidence: 100, // Manually added = 100% confidence
        status: "matched",
        productScreen: {
          likelihood: "likely_product" as const,
          reasons: ["Manuell zum Entwurf hinzugefügt"],
        },
      });
      
      const { recomputeOfferOverallConfidence } = await import("../extraction/lineItemProductScreening");
      const overallConfidence = recomputeOfferOverallConfidence(updatedItems);
      
      // Update draft
      const updatedDraft = await storage.updateOfferDraft(id, {
        matchingResults: {
          ...draft.matchingResults,
          items: updatedItems,
          overallConfidence,
        },
      });
      
      await recordDraftSuggestionAdd(storage, {
        tenantId: req.tenantId ?? null,
        userId: (req.user as { id?: string } | undefined)?.id ?? null,
        draftId: id,
        kind: "offer_draft",
        crossSell: req.body?.crossSell,
        targetProductNumber: product.productNumber,
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error adding product to offer draft:");
      res.status(500).json({ error: "Failed to add product to draft" });
    }
  });

  // POST /api/offer-drafts/:id/add-bundle - Add a bundle to draft
  app.post("/api/offer-drafts/:id/add-bundle", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { bundleId, quantity = 1 } = req.body;
      
      if (!bundleId) {
        return res.status(400).json({ error: "Bundle ID is required" });
      }
      
      // Get offer draft
      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      const bundle = await storage.getBundle(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: "Bundle not found" });
      }
      
      if (bundle.active !== 1) {
        return res.status(400).json({ error: "Bundle is inactive" });
      }
      
      const { productCache } = await import("../products/productCache");
      const invalidProducts: string[] = [];
      const components = bundle.items.map((item) => {
        const product = productCache.getProductByNumber(item.productNumber);
        if (!product) {
          invalidProducts.push(item.productNumber);
        }
        return {
          productNumber: item.productNumber,
          productId: item.productId || product?.id,
          productName: product?.name,
          quantity: item.quantity,
        };
      });
      
      if (invalidProducts.length > 0) {
        return res.status(400).json({
          error: "Some bundle products could not be resolved",
          invalidProducts,
        });
      }
      
      const updatedItems = [...(draft.matchingResults?.items || [])];
      updatedItems.push({
        extractedProductName: bundle.name,
        extractedProductNumber: bundle.mockProductNumber,
        quantity,
        bundle: {
          id: bundle.id,
          name: bundle.name,
          mockProductNumber: bundle.mockProductNumber,
          components,
        },
        confidence: 100,
        status: "matched",
        productScreen: {
          likelihood: "likely_product" as const,
          reasons: ["Bundle manuell hinzugefügt"],
        },
      });
      
      const { recomputeOfferOverallConfidence } = await import("../extraction/lineItemProductScreening");
      const overallConfidence = recomputeOfferOverallConfidence(updatedItems);
      
      const updatedDraft = await storage.updateOfferDraft(id, {
        matchingResults: {
          ...draft.matchingResults,
          items: updatedItems,
          overallConfidence,
        },
      });
      
      res.json(updatedDraft);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error adding bundle to offer draft:");
      res.status(500).json({ error: "Failed to add bundle to draft" });
    }
  });

  // DELETE /api/offer-drafts/:id - Delete offer draft and file
  app.get("/api/offer-drafts/:id/attachments", requireAuthOrIntegrationKey, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOfferDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Offer draft not found" });
      res.json({
        draftId: draft.id,
        draftKind: "offer",
        buyerDocumentNumber: draft.buyerDocumentNumber ?? null,
        attachments: listDraftAttachmentsForApi(draft.attachments),
      });
    } catch (error) {
      moduleLog.error({ err: error }, "Error listing offer draft attachments:");
      res.status(500).json({ error: "Failed to list attachments" });
    }
  });

  app.get("/api/offer-drafts/:id/attachments/:attachmentId/file", requireAuthOrIntegrationKey, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOfferDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Offer draft not found" });
      await sendDraftAttachmentFile(res, draft.attachments, req.params.attachmentId);
    } catch (error) {
      moduleLog.error({ err: error }, "Error sending offer draft attachment:");
      if (!res.headersSent) res.status(500).json({ error: "Failed to send attachment" });
    }
  });

  app.patch("/api/offer-drafts/:id/attachments/:attachmentId", requireAuthOrIntegrationKey, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOfferDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Offer draft not found" });
      const update = parseDraftAttachmentExportUpdate(req.body);
      if ("error" in update) return res.status(400).json({ error: update.error });
      const next = applyDraftAttachmentExportUpdate(draft.attachments, req.params.attachmentId, update);
      if (!next) return res.status(404).json({ error: "Attachment not found" });
      const saved = await storage.updateOfferDraft(draft.id, { attachments: next }, req.tenantId ?? null);
      res.json({ attachments: listDraftAttachmentsForApi(saved?.attachments ?? next) });
    } catch (error) {
      moduleLog.error({ err: error }, "Error updating offer draft attachment:");
      res.status(500).json({ error: "Failed to update attachment" });
    }
  });

  app.delete("/api/offer-drafts/:id", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get draft to delete file
      const draft = await storage.getOfferDraft(id);
      if (!draft) {
        return res.status(404).json({ error: "Offer draft not found" });
      }

      // Delete uploaded file if it exists
      if (draft.originalFilePath) {
        try {
          await fs.unlink(draft.originalFilePath);
        } catch (error) {
          moduleLog.error({ err: error }, "Error deleting file:");
          // Continue with draft deletion even if file deletion fails
        }
      }

      // Delete draft from database
      const deleted = await storage.deleteOfferDraft(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Offer draft not found" });
      }
      
      res.json({ message: "Offer draft deleted successfully" });
    } catch (error) {
      moduleLog.error({ err: error }, "Error deleting offer draft:");
      res.status(500).json({ error: "Failed to delete offer draft" });
    }
  });

  // POST /api/offer-drafts/:id/create-offer - Create Shopware offer from draft
  app.post("/api/offer-drafts/:id/create-offer", requireAuthOrIntegrationKey, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const allowedChannelIds = await getSalesChannelFilter(req);

      const ensuredCustomer = await ensureDraftShopwareCustomerId(storage, {
        kind: "offer",
        draftId: id,
        tenantId: req.tenantId ?? null,
      });
      if (!ensuredCustomer.ok) {
        return res.status(ensuredCustomer.statusCode).json({ error: ensuredCustomer.error });
      }
      const customerChannelId = await fetchCustomerBoundSalesChannelId(
        storage,
        req.tenantId ?? null,
        ensuredCustomer.customerId
      );

      const channelResult = await resolveOfferSalesChannelId(storage, {
        tenantId: req.tenantId ?? null,
        requestedChannelId: req.body?.sales_channel_id,
        customerChannelId,
        allowedChannelIds,
      });
      if (!channelResult.ok) {
        return res.status(channelResult.statusCode).json({ error: channelResult.error });
      }
      const result = await executeCreateOfferFromDraft(storage, id, {
        salesChannelId: channelResult.salesChannelId,
        tenantId: req.tenantId ?? null,
      });
      if (!result.ok) {
        return res.status(result.statusCode).json({ error: result.error });
      }
      try {
        const learningRows = buildCommercialProductFeedbackRowsFromDraftUpdate({
          updatedDraft: {
            extractedData: result.draft.extractedData as any,
            matchingResults: result.draft.matchingResults as any,
          },
          tenantId: req.tenantId ?? null,
          draftKind: "offer",
          createdByUserId: (req.user as { id?: string } | undefined)?.id ?? null,
        });
        if (learningRows.length > 0) {
          await storage.createCommercialProductMatchFeedback(learningRows, req.tenantId ?? null);
        }
      } catch (learningError) {
        moduleLog.warn({ err: learningError }, "[Commercial product learning] offer create feedback failed:");
      }
      res.json({
        message: "Angebot in B2B-Sellers-Suite erstellt.",
        id: result.offerId,
        draft: result.draft,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error creating offer from draft:");
      res.status(500).json({
        error: error.message || "Failed to create offer from draft",
      });
    }
  });
}
