/**
 * Beigefügte Dokumente (Lieferschein, AB, Rechnung, Sonstiges) einer eingegangenen Mail
 * am Bestell-/Angebotsentwurf ablegen — statt aus jedem PDF einen Entwurf zu machen.
 *
 * Ablauf (Mail-Upload und Postfach-Abruf identisch):
 *   1. `partitionCommercialParts`: jeden handelsrelevanten Anhang klassifizieren
 *      (commercialAttachmentClassifier.ts). Bestellungen/Unbekanntes → Extraktion,
 *      alles andere → Beilage.
 *   2. Entwürfe wie bisher erzeugen (nur aus den Bestell-Anhängen).
 *   3. `attachSupportingDocumentsToDrafts`: Beilagen als Datei ablegen und an ALLE
 *      Entwürfe dieser Mail hängen (in der Regel genau einer).
 *
 * Die Dateien liegen unter uploads/commercial-agent-incoming — dasselbe Volume wie die
 * Entwurfsdokumente. Lobster holt sie über GET /api/order-drafts/:id/attachments/:aid/file
 * und setzt danach exportStatus = exported (PATCH).
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { IStorage } from "./storage";
import type { DraftAttachment } from "@shared/schema";
import type { InboundCommercialDocPart } from "./commercialInboundPdfContext";
import { extractPlainTextForDraft } from "./documentTextExtraction";
import {
  attachmentKindProducesDraft,
  classifyCommercialAttachment,
  type AttachmentClassification,
} from "./commercialAttachmentClassifier";
import type { CommercialAgentProcessResult } from "./commercialAgentOrchestrator";
import { getUploadsRoot } from "./uploadsRoot";

export type SupportingDocumentPart = {
  part: InboundCommercialDocPart;
  classification: AttachmentClassification;
};

export type PartitionedCommercialParts = {
  /** Anhänge, aus denen ein Entwurf entsteht (Bestellung / nicht bestimmbar) */
  draftParts: InboundCommercialDocPart[];
  /** Anhänge, die nur als Beilage abgelegt werden */
  supportingParts: SupportingDocumentPart[];
  /** Klassifikation je Anhang (auch für die Entwurfs-Anhänge, z. B. für Logs) */
  classifications: Map<InboundCommercialDocPart, AttachmentClassification>;
};

const CLASSIFY_TEXT_CHARS = 12000;

/**
 * Klassifiziert jeden Anhang und trennt Bestell-Anhänge von Beilagen.
 * Bilder ohne Text und Anhänge ohne verwertbaren Text bleiben Bestell-Kandidaten
 * (dort greift ggf. PDF-Vision) — lieber extrahieren als verlieren.
 */
export async function partitionCommercialParts(
  parts: InboundCommercialDocPart[],
  options?: { ocrEnabled?: boolean }
): Promise<PartitionedCommercialParts> {
  const ocrEnabled = options?.ocrEnabled ?? false;
  const draftParts: InboundCommercialDocPart[] = [];
  const supportingParts: SupportingDocumentPart[] = [];
  const classifications = new Map<InboundCommercialDocPart, AttachmentClassification>();

  for (const part of parts) {
    let text = "";
    try {
      // Rohtext MIT Zeilenumbrüchen: die Titelzeilen-Erkennung braucht die Zeilenstruktur.
      const raw = await extractPlainTextForDraft({
        fileBuffer: part.buffer,
        mimeType: part.contentType,
        fileName: part.filename,
        ocrEnabled,
      });
      text = (raw || "").slice(0, CLASSIFY_TEXT_CHARS);
    } catch {
      text = "";
    }
    const classification = classifyCommercialAttachment({ filename: part.filename, text });
    classifications.set(part, classification);
    if (attachmentKindProducesDraft(classification.kind, classification.confidence)) {
      draftParts.push(part);
    } else {
      supportingParts.push({ part, classification });
    }
  }

  return { draftParts, supportingParts, classifications };
}

function safeFilename(name: string): string {
  return (name || "attachment").replace(/[^\w.\-äöüÄÖÜß ]+/g, "_").slice(0, 120);
}

async function persistSupportingFile(part: InboundCommercialDocPart): Promise<{ filePath: string; size: number }> {
  const dir = path.join(getUploadsRoot(), "commercial-agent-incoming");
  await fs.mkdir(dir, { recursive: true });
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const filePath = path.join(dir, `${unique}-beilage-${safeFilename(part.filename)}`);
  await fs.writeFile(filePath, part.buffer);
  return { filePath, size: part.buffer.length };
}

export function buildDraftAttachment(params: {
  part: InboundCommercialDocPart;
  classification: AttachmentClassification;
  filePath: string;
  size: number;
  sourceMessageId?: string | null;
}): DraftAttachment {
  const { part, classification } = params;
  return {
    id: crypto.randomUUID(),
    documentKind: classification.kind === "unknown" ? "other" : classification.kind,
    fileName: part.filename,
    filePath: params.filePath,
    mimeType: part.contentType,
    size: params.size,
    sourceMessageId: params.sourceMessageId ?? null,
    classification: {
      confidence: Math.round(classification.confidence * 100) / 100,
      signals: classification.signals.slice(0, 12),
    },
    references: {
      deliveryNoteNumber: classification.references.deliveryNoteNumber ?? null,
      orderNumber: classification.references.orderNumber ?? null,
      invoiceNumber: classification.references.invoiceNumber ?? null,
      commission: classification.references.commission ?? null,
      documentDate: classification.references.documentDate ?? null,
    },
    exportStatus: "pending",
    exportedAt: null,
    exportReference: null,
    createdAt: new Date().toISOString(),
  };
}

function mergeAttachments(existing: DraftAttachment[] | null | undefined, incoming: DraftAttachment[]): DraftAttachment[] {
  const out = [...(existing ?? [])];
  for (const att of incoming) {
    const dup = out.some(
      (e) => e.fileName === att.fileName && e.size === att.size && (e.sourceMessageId ?? null) === (att.sourceMessageId ?? null)
    );
    if (!dup) out.push(att);
  }
  return out;
}

/**
 * Legt die Beilagen als Datei ab und hängt sie an jeden erzeugten Entwurf.
 * Liefert die angelegten Anhänge (leer, wenn es keine Beilagen oder keine Entwürfe gab).
 */
export async function attachSupportingDocumentsToDrafts(params: {
  storage: IStorage;
  tenantId?: string | null;
  results: CommercialAgentProcessResult[];
  supportingParts: SupportingDocumentPart[];
  sourceMessageId?: string | null;
}): Promise<DraftAttachment[]> {
  const { storage, tenantId, results, supportingParts, sourceMessageId } = params;
  if (supportingParts.length === 0 || results.length === 0) return [];

  const attachments: DraftAttachment[] = [];
  for (const sp of supportingParts) {
    try {
      const { filePath, size } = await persistSupportingFile(sp.part);
      attachments.push(
        buildDraftAttachment({ part: sp.part, classification: sp.classification, filePath, size, sourceMessageId })
      );
    } catch (error) {
      console.error(`[CommercialAttachments] Beilage ${sp.part.filename} konnte nicht abgelegt werden:`, error);
    }
  }
  if (attachments.length === 0) return [];

  for (const result of results) {
    try {
      if (result.draftKind === "order") {
        const draft = await storage.getOrderDraft(result.draftId, tenantId ?? null);
        if (!draft) continue;
        await storage.updateOrderDraft(
          result.draftId,
          { attachments: mergeAttachments(draft.attachments, attachments) },
          tenantId ?? null
        );
      } else {
        const draft = await storage.getOfferDraft(result.draftId, tenantId ?? null);
        if (!draft) continue;
        await storage.updateOfferDraft(
          result.draftId,
          { attachments: mergeAttachments(draft.attachments, attachments) },
          tenantId ?? null
        );
      }
      console.log(
        `[CommercialAttachments] ${attachments.length} Beilage(n) an ${result.draftKind}-Entwurf ${result.draftId} gehängt: ` +
          attachments.map((a) => `${a.fileName} (${a.documentKind})`).join(", ")
      );
    } catch (error) {
      console.error(`[CommercialAttachments] Anhänge an Entwurf ${result.draftId} fehlgeschlagen:`, error);
    }
  }
  return attachments;
}
