/**
 * Hochgeladene E-Mail-Container (.eml/.msg) wie den internen Postfach-Abruf verarbeiten.
 *
 * Hintergrund: Eine hochgeladene Mail ist kein einzelnes Geschäftsdokument — die
 * eigentliche Bestellung steckt fast immer im Anhang. Wird das `.eml` als
 * Primärdokument durch die Pipeline geschickt, gehen drei Dinge verloren:
 *
 *   1. **PDF-Vision** greift nicht (`pdfNeedsVision` prüft `application/pdf`),
 *      d. h. gescannte Bestellungen landen nur über OCR-Text in der Extraktion.
 *   2. **Signaturbilder** werden nicht eingesammelt (Firmenname per Vision).
 *   3. Mail-Text und Anhänge verschmelzen zu einem Textklumpen statt als
 *      `emailContext` + `siblingPdfExcerpts` getrennt in den Prompt zu gehen.
 *
 * Dieses Modul stellt für den Upload-Weg (n8n, manueller UI-Upload) dieselbe
 * Zerlegung her wie `emailInbound.ts` und delegiert an denselben Orchestrator.
 */

import crypto from "crypto";
import type { IStorage } from "./storage";
import { parseEmailBufferAutodetect } from "./emailParser";
import {
  buildCombinedCommercialDocumentTextForIntent,
  filterCommercialDocumentPartsFromMailparserAttachments,
  type InboundCommercialDocPart,
} from "./commercialInboundPdfContext";
import {
  collectSignatureImageCandidates,
  type SignatureImageCandidate,
} from "./commercialSignatureImageCandidates";
import {
  processCommercialDocumentFromEmail,
  type CommercialAgentProcessResult,
} from "./commercialAgentOrchestrator";

/** Erkennt Uploads, die eine ganze Nachricht enthalten (statt eines Einzeldokuments). */
export function isEmailContainerUpload(fileName: string, mimeType: string): boolean {
  const name = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  return (
    name.endsWith(".eml") ||
    name.endsWith(".msg") ||
    mime === "message/rfc822" ||
    mime === "application/vnd.ms-outlook"
  );
}

/**
 * Stabile Kennung der hochgeladenen Nachricht für die Dedupe-Prüfung des Orchestrators.
 *
 * Bevorzugt die echte `Message-ID` aus dem Header — dadurch erzeugt ein n8n-Retry
 * derselben Mail keinen zweiten Entwurf. Fällt auf einen Inhalts-Hash zurück, wenn
 * der Header fehlt (z. B. bei `.msg` ohne Message-ID).
 */
export function deriveUploadMessageId(fileBuffer: Buffer): string {
  const head = fileBuffer.subarray(0, 64 * 1024).toString("latin1");
  const match = head.match(/^message-id:\s*<([^>\r\n]+)>/im);
  if (match?.[1]?.trim()) {
    return `mail:${match[1].trim()}`;
  }
  return `sha256:${crypto.createHash("sha256").update(fileBuffer).digest("hex")}`;
}

export type CommercialEmailParts = {
  /** Anhänge, aus denen je ein Entwurf entsteht */
  commercialParts: InboundCommercialDocPart[];
  /** Signatur-/Logobilder — nur Kontext für die Vision-Firmenerkennung */
  signatureImageBuffers: SignatureImageCandidate[];
};

/**
 * Trennt Geschäftsdokumente von Signaturbildern.
 *
 * Wichtig: `isCommercialInboundDocumentAttachment` akzeptiert **jedes** Bild. Ohne
 * diese Trennung würde das Logo aus der Mailsignatur einen eigenen Entwurf erzeugen —
 * bei Firmenmails also bei praktisch jeder Nachricht. Als Signatur erkannte Bilder
 * fließen deshalb ausschließlich in die Vision-Firmenerkennung ein.
 *
 * Der Abgleich läuft über Buffer-Identität: `collectSignatureImageCandidates` reicht
 * die Original-Buffer der Anhänge durch, ohne sie zu kopieren.
 */
export function splitCommercialEmailParts(parsed: {
  attachments: Array<{ content?: unknown; filename?: string; contentType?: string }>;
  html?: string | null;
}): CommercialEmailParts {
  const signatureImageBuffers = collectSignatureImageCandidates(
    parsed.attachments,
    parsed.html ?? undefined
  );
  const signatureBuffers = new Set(signatureImageBuffers.map((s) => s.buffer));
  const commercialParts = filterCommercialDocumentPartsFromMailparserAttachments(
    parsed.attachments
  ).filter((part) => !signatureBuffers.has(part.buffer));
  return { commercialParts, signatureImageBuffers };
}

export type IngestCommercialEmailUploadParams = {
  storage: IStorage;
  tenantId?: string | null;
  fileBuffer: Buffer;
  fileName: string;
  /** Fallback-Betreff aus dem Formular, falls die Mail keinen trägt */
  formSubject?: string;
  /** Fallback-Text aus dem Formular (n8n kürzt den Body auf 500 Zeichen) */
  formBody?: string;
  createdByUserId: string;
  ocrEnabled: boolean;
  uploadHint?: "offer" | "order" | "unclear" | null;
};

export type IngestCommercialEmailUploadResult = {
  results: CommercialAgentProcessResult[];
  /** Anzahl handelsrelevanter Anhänge, die verarbeitet wurden */
  attachmentsProcessed: number;
  /** true: kein passender Anhang — die Mail selbst wurde als Anfrage ausgewertet */
  usedEmailOnlyFallback: boolean;
  messageId: string;
  subject: string;
};

/**
 * Zerlegt die Mail und erzeugt **einen Entwurf pro handelsrelevantem Anhang**
 * (gleiches Verhalten wie der interne Postfach-Abruf). Ohne solchen Anhang wird
 * die Nachricht selbst als Anfrage ausgewertet.
 *
 * Die Anhänge werden bewusst **sequenziell** verarbeitet: Die Dedupe-Liste des
 * Orchestrators ist ein Read-Modify-Write auf einem Settings-Key, parallele
 * Läufe würden Einträge verlieren.
 */
export async function ingestCommercialEmailUpload(
  params: IngestCommercialEmailUploadParams
): Promise<IngestCommercialEmailUploadResult> {
  const {
    storage,
    tenantId,
    fileBuffer,
    fileName,
    formSubject = "",
    formBody = "",
    createdByUserId,
    ocrEnabled,
    uploadHint = null,
  } = params;

  const parsed = await parseEmailBufferAutodetect(fileBuffer);
  const messageId = deriveUploadMessageId(fileBuffer);

  // Die geparste Nachricht ist die verlässlichere Quelle: n8n überträgt den Body
  // nur gekürzt, das Formular ist beim UI-Upload oft leer.
  const subject = parsed.subject?.trim() || formSubject.trim();
  const emailBody = parsed.body?.trim() || formBody.trim();
  const fromDisplayName = parsed.from?.trim() || undefined;

  const { commercialParts, signatureImageBuffers } = splitCommercialEmailParts(parsed);

  const intentDocumentTextPreview =
    commercialParts.length > 0
      ? (
          await buildCombinedCommercialDocumentTextForIntent(commercialParts, { ocrEnabled })
        ).trim() || undefined
      : undefined;

  const results: CommercialAgentProcessResult[] = [];

  for (const part of commercialParts) {
    const result = await processCommercialDocumentFromEmail({
      storage,
      tenantId,
      messageId,
      filename: part.filename,
      buffer: part.buffer,
      mimeType: part.contentType,
      subject,
      emailBody,
      ticketId: null,
      systemUserId: createdByUserId,
      intentDocumentTextPreview,
      primaryContainsEmailBody: false,
      fromDisplayName,
      signatureImageBuffers: signatureImageBuffers.length ? signatureImageBuffers : undefined,
      uploadHint,
    });
    if (result) results.push(result);
  }

  if (commercialParts.length > 0) {
    return {
      results,
      attachmentsProcessed: commercialParts.length,
      usedEmailOnlyFallback: false,
      messageId,
      subject,
    };
  }

  // Kein handelsrelevanter Anhang: die Nachricht selbst auswerten. Der Orchestrator
  // extrahiert aus dem rfc822-Buffer Betreff, Body, Signatur und Anhangstexte.
  const emailOnly = await processCommercialDocumentFromEmail({
    storage,
    tenantId,
    messageId,
    filename: fileName,
    // Ungekürzt: der Orchestrator parst den rfc822-Buffer: ein Abschneiden würde
    // die MIME-Struktur zerstören. Die Obergrenze setzt bereits das Upload-Limit.
    buffer: fileBuffer,
    mimeType: "message/rfc822",
    subject,
    emailBody,
    ticketId: null,
    systemUserId: createdByUserId,
    primaryContainsEmailBody: true,
    fromDisplayName,
    signatureImageBuffers: signatureImageBuffers.length ? signatureImageBuffers : undefined,
    uploadHint,
  });
  if (emailOnly) results.push(emailOnly);

  return {
    results,
    attachmentsProcessed: 0,
    usedEmailOnlyFallback: true,
    messageId,
    subject,
  };
}
