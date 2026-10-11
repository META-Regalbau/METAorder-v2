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
import type { IStorage } from "../storage";
import type { DraftAttachment } from "@shared/schema";
import type { InboundCommercialDocPart } from "./commercialInboundPdfContext";
import { extractPlainTextForDraft } from "../extraction/documentTextExtraction";
import {
  attachmentKindProducesDraft,
  classifyCommercialAttachment,
  type AttachmentClassification,
} from "./commercialAttachmentClassifier";
import type { CommercialAgentProcessResult } from "./commercialAgentOrchestrator";
import { getUploadsRoot } from "../uploadsRoot";
import { logger } from "../lib/logger";
import { isOrderRelevantXml, isXmlAttachment, parseOrderXml } from "../extraction/orderXmlParser";

const moduleLog = logger.child({ component: "commercial/commercialDraftAttachments" });

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

  const orderXmlParts = new Set<InboundCommercialDocPart>();
  for (const part of parts) {
    if (isXmlAttachment(part.filename, part.contentType)) {
      const classification = classifyXmlAttachment(part.buffer);
      classifications.set(part, classification);
      if (classification.signals.some((sig) => sig.startsWith("order_xml_"))) orderXmlParts.add(part);
      if (attachmentKindProducesDraft(classification.kind, classification.confidence)) draftParts.push(part);
      else supportingParts.push({ part, classification });
      continue;
    }
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

  // Bestellung als XML UND als PDF (Mercateo, Beschaffungsportale): die XML ist eindeutig,
  // die PDF wird Beilage – sonst entstünden zwei Entwürfe derselben Bestellung.
  if (orderXmlParts.size > 0) {
    for (const part of [...draftParts]) {
      if (orderXmlParts.has(part)) continue;
      draftParts.splice(draftParts.indexOf(part), 1);
      const base = classifications.get(part) ?? { kind: "purchase_order" as const, confidence: 0, signals: [], references: {} };
      const classification: AttachmentClassification = {
        ...base,
        kind: base.kind === "unknown" ? "purchase_order" : base.kind,
        signals: [...base.signals, "order_xml_preferred"],
      };
      classifications.set(part, classification);
      supportingParts.push({ part, classification });
    }
  }

  // Bestellung + Lieferschein mit derselben Belegnummer: nur die Bestellung wird Entwurf
  demoteSameOrderCompanions(draftParts, supportingParts, classifications);

  return { draftParts, supportingParts, classifications };
}

const DELIVERY_SIGNALS = new Set([
  "filename_delivery_note",
  "title_lieferschein",
  "ls_number_label",
  "receipt_confirmation_text",
  "delivery_note_number_found",
  "packages",
]);

/** Belegnummern eines Anhangs: Bestellnummer aus dem Text und nummernartige Teile des Dateinamens. */
function orderKeysOf(part: InboundCommercialDocPart, classification: AttachmentClassification | undefined): Set<string> {
  const keys = new Set<string>();
  const add = (v: string | null | undefined) => {
    const k = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
    // Datumsangaben („20261011“, „11102026“) sind keine Belegnummern: Scans eines Tages teilen sie
    const dateLike = /^(?:20[1-3]\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])20[1-3]\d)$/.test(k);
    if (k.length >= 5 && /\d{4,}/.test(k) && !dateLike) keys.add(k);
  };
  add(classification?.references.orderNumber);
  for (const token of part.filename.replace(/\.[a-z0-9]{2,4}$/i, "").split(/[^A-Za-z0-9]+/)) add(token);
  return keys;
}

/**
 * Bestellung und Lieferschein derselben Bestellung in einer Mail (Heinrich & Schleyer:
 * „Best_BE730134.pdf“ + „Lief_BE730134.pdf“, Live 11.10.2026): Wurde der Lieferschein nicht als
 * solcher erkannt, entstanden zwei Entwürfe. Teilen sich Anhänge eine Belegnummer, bleibt nur die
 * eigentliche Bestellung Entwurf; die anderen werden Beilage – außer sie tragen selbst den Titel
 * „Bestellung“ und kein Lieferschein-Signal (z. B. zwei Teile einer Bestellung).
 */
export function demoteSameOrderCompanions(
  draftParts: InboundCommercialDocPart[],
  supportingParts: SupportingDocumentPart[],
  classifications: Map<InboundCommercialDocPart, AttachmentClassification>
): void {
  if (draftParts.length < 2) return;
  const keys = new Map(draftParts.map((p) => [p, orderKeysOf(p, classifications.get(p))]));
  const sharesKey = (a: InboundCommercialDocPart, b: InboundCommercialDocPart) => [...keys.get(a)!].some((k) => keys.get(b)!.has(k));
  const hasDelivery = (c: AttachmentClassification | undefined) => Boolean(c?.signals.some((sig) => DELIVERY_SIGNALS.has(sig)));
  const hasOrderTitle = (c: AttachmentClassification | undefined) => Boolean(c?.signals.includes("title_bestellung"));
  const rank = (p: InboundCommercialDocPart) => {
    const c = classifications.get(p);
    return (
      (c?.kind === "purchase_order" ? 2 : c?.kind === "unknown" ? 1 : 0) +
      (hasOrderTitle(c) ? 2 : 0) +
      (c?.signals.includes("filename_purchase_order") ? 1 : 0) -
      (hasDelivery(c) ? 3 : 0)
    );
  };

  const handled = new Set<InboundCommercialDocPart>();
  for (const part of [...draftParts]) {
    if (handled.has(part)) continue;
    const group = draftParts.filter((p) => p === part || sharesKey(part, p));
    group.forEach((p) => handled.add(p));
    if (group.length < 2) continue;
    const keeper = [...group].sort((a, b) => rank(b) - rank(a))[0];
    const keeperIsOrder = classifications.get(keeper)?.kind === "purchase_order";
    for (const other of group) {
      if (other === keeper) continue;
      const c = classifications.get(other);
      if (hasOrderTitle(c) && !hasDelivery(c)) continue;
      // Ohne erkannte Bestellung (z. B. zwei Scans ohne Text) nur mit Lieferschein-Signal zurückstufen
      if (!keeperIsOrder && !hasDelivery(c)) continue;
      const base = c ?? { kind: "unknown" as const, confidence: 0, signals: [], references: {} };
      const classification: AttachmentClassification = {
        ...base,
        // Bestellkopie bleibt „Bestellung“ (Beilage), Unbestimmtes wird „Sonstiges“
        kind: hasDelivery(base) ? "delivery_note" : base.kind === "unknown" ? "other" : base.kind,
        confidence: Math.max(0.6, base.confidence),
        signals: [...base.signals, "same_order_number_as_draft"],
      };
      classifications.set(other, classification);
      draftParts.splice(draftParts.indexOf(other), 1);
      supportingParts.push({ part: other, classification });
      moduleLog.info(
        { event: "attachment_same_order_demoted", file: other.filename, keeper: keeper.filename, kind: classification.kind },
        `[CommercialAttachments] ${other.filename} gehört zur selben Bestellung wie ${keeper.filename} – Beilage statt eigener Entwurf`
      );
    }
  }
}

/** XML-Anhang: bekannte Bestellformate sicher als Bestellung, anderes Bestell-XML offen, Rest Beilage. */
export function classifyXmlAttachment(buffer: Buffer): AttachmentClassification {
  const parsed = parseOrderXml(buffer);
  if (parsed) {
    return {
      kind: "purchase_order",
      confidence: 0.99,
      signals: [`order_xml_${parsed.format}`],
      references: { orderNumber: parsed.extraction.document.number, documentDate: parsed.extraction.document.date },
    };
  }
  if (isOrderRelevantXml(buffer)) return { kind: "unknown", confidence: 0, signals: ["xml_unknown_order_format"], references: {} };
  return { kind: "other", confidence: 0.9, signals: ["xml_not_order"], references: {} };
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
      moduleLog.error({ err: error }, `[CommercialAttachments] Beilage ${sp.part.filename} konnte nicht abgelegt werden:`);
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
      moduleLog.info(`${`[CommercialAttachments] ${attachments.length} Beilage(n) an ${result.draftKind}-Entwurf ${result.draftId} gehängt: ` +
          attachments.map((a) => `${a.fileName} (${a.documentKind})`).join(", ")}`);
    } catch (error) {
      moduleLog.error({ err: error }, `[CommercialAttachments] Anhänge an Entwurf ${result.draftId} fehlgeschlagen:`);
    }
  }
  return attachments;
}
