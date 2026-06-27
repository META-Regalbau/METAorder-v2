import { extractDocumentTextPreviewForIntent } from "./documentTextExtraction";

export type InboundPdfPart = {
  filename: string;
  buffer: Buffer;
  contentType: string;
};

/** @deprecated Alias — gleiche Form wie InboundPdfPart */
export type InboundCommercialDocPart = InboundPdfPart;

const MAX_EXTRACT_PER_FILE = 4500;
const MAX_COMBINED_CHARS = 14000;

const TRADE_FILENAME_TOKENS = new Set([
  "bestellung",
  "bestellen",
  "bestell",
  "anfrage",
  "angebotsanfrage",
  "angebot",
  "offerte",
  "offer",
  "order",
  "auftrag",
  "purchase",
  "kauf",
  "rfq",
  "inquiry",
]);

function tokenizeFilenameStem(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9äöüß]+/gi, " ")
    .split(" ")
    .filter(Boolean);
}

/** Dateiname deutet auf Bestellung / Angebot / Anfrage hin (mehrere PDFs: Filter). */
export function tradeKeywordsInFilename(name: string): boolean {
  const tokens = tokenizeFilenameStem(name);
  if (tokens.some((t) => TRADE_FILENAME_TOKENS.has(t))) return true;
  const joined = ` ${tokens.join(" ")} `;
  if (/\spo\b/.test(joined)) return true;
  if (tokens.includes("purchase") && tokens.includes("order")) return true;
  return false;
}

/** Extrahierter Dokumenttext enthält handelsrelevante Begriffe. */
export function tradeKeywordsInDocumentText(text: string): boolean {
  const t = text.slice(0, 12000).toLowerCase();
  return (
    /\bbestell(ung|en)?\b/.test(t) ||
    /\banfrage\b/.test(t) ||
    /\bangebot(sanfrage)?\b/.test(t) ||
    /\bofferte\b/.test(t) ||
    /\boffer\b/.test(t) ||
    /\bp\.?\s*o\.?\b/.test(t) ||
    /\bpurchase\s+order\b/.test(t) ||
    /\border\b/.test(t) ||
    /\bauftrag\b/.test(t)
  );
}

function isPdfPart(p: InboundCommercialDocPart): boolean {
  const fn = p.filename.toLowerCase();
  const ct = p.contentType.toLowerCase();
  return ct === "application/pdf" || fn.endsWith(".pdf");
}

const MIN_EXTRACT_LEN_FOR_STRICT_CONTENT = 120;

/**
 * Wenn **mehrere PDFs** in einer Mail: nur solche, deren **Dateiname** und (falls genug Text)
 * **Inhalt** handelsrelevant wirken (Bestellung, Order, Offer, Anfrage, …).
 * Bei wenig extrahierbarem Text: strenger Inhaltsabgleich entfällt → Dateiname reicht, sonst Fallback alle PDFs.
 */
export async function filterToTradeRelevantPdfPartsForMailIntent(
  parts: InboundCommercialDocPart[],
  options?: { ocrEnabled?: boolean }
): Promise<InboundCommercialDocPart[]> {
  const pdfParts = parts.filter(isPdfPart);
  if (pdfParts.length <= 1) return parts;

  const ocrEnabled = options?.ocrEnabled ?? false;
  type Row = { part: InboundCommercialDocPart; fnOk: boolean; contentOk: boolean };
  const rows: Row[] = [];
  for (const p of pdfParts) {
    const preview = (
      await extractDocumentTextPreviewForIntent(p.buffer, p.contentType, p.filename, {
        maxChars: MAX_EXTRACT_PER_FILE,
        ocrEnabled,
      })
    ).trim();
    const fnOk = tradeKeywordsInFilename(p.filename);
    const contentOk =
      preview.length >= MIN_EXTRACT_LEN_FOR_STRICT_CONTENT && tradeKeywordsInDocumentText(preview);
    rows.push({ part: p, fnOk, contentOk });
  }

  const strictParts = rows.filter((r) => r.fnOk && r.contentOk).map((r) => r.part);
  let keepPdf: InboundCommercialDocPart[];
  if (strictParts.length > 0) {
    keepPdf = strictParts;
  } else {
    const looseParts = rows.filter((r) => r.fnOk).map((r) => r.part);
    keepPdf = looseParts.length > 0 ? looseParts : pdfParts;
  }

  const keep = new Set(keepPdf);
  return parts.filter((p) => !isPdfPart(p) || keep.has(p));
}

/** PDF-Anhänge aus mailparser/simpleParser-Struktur. */
export function filterPdfPartsFromMailparserAttachments(
  attachments: Array<{ content?: unknown; filename?: string; contentType?: string }> | undefined
): InboundPdfPart[] {
  return filterCommercialDocumentPartsFromMailparserAttachments(attachments).filter((p) =>
    p.contentType.toLowerCase() === "application/pdf" || p.filename.toLowerCase().endsWith(".pdf")
  );
}

export function isCommercialInboundDocumentAttachment(filename: string, contentType: string): boolean {
  const fn = filename.toLowerCase();
  const ct = contentType.toLowerCase();
  const ext = fn.includes(".") ? fn.split(".").pop() || "" : "";

  if (ct === "application/pdf" || fn.endsWith(".pdf")) return true;
  if (fn.endsWith(".docx") || ct.includes("wordprocessingml")) return true;
  if (fn.endsWith(".doc") || ct === "application/msword") return true;
  if (fn.endsWith(".eml") || fn.endsWith(".msg")) return true;
  if (ct === "message/rfc822" || ct === "application/vnd.ms-outlook") return true;
  if (ct.startsWith("image/")) return true;
  if (["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp"].includes(ext)) return true;
  return false;
}

/**
 * PDF, Word, Bilder, E-Mail-Dateien — für Commercial-Agent-Intent und Kontext.
 */
export function filterCommercialDocumentPartsFromMailparserAttachments(
  attachments: Array<{ content?: unknown; filename?: string; contentType?: string }> | undefined
): InboundCommercialDocPart[] {
  const out: InboundCommercialDocPart[] = [];
  if (!attachments?.length) return out;
  for (const a of attachments) {
    const buf = a.content;
    if (!Buffer.isBuffer(buf)) continue;
    const name = a.filename || "attachment";
    const ct = a.contentType || "application/octet-stream";
    if (!isCommercialInboundDocumentAttachment(name.toLowerCase(), ct)) continue;
    out.push({
      filename: name,
      buffer: buf,
      contentType: ct,
    });
  }
  return out;
}

/**
 * Alle unterstützten Dokument-Anhänge einer Mail zu einem Kontext-String für Intent/Sub-Agent.
 */
export async function buildCombinedCommercialDocumentTextForIntent(
  parts: InboundCommercialDocPart[],
  options?: { ocrEnabled?: boolean }
): Promise<string> {
  if (parts.length === 0) return "";
  const ocrEnabled = options?.ocrEnabled ?? false;
  const filteredParts = await filterToTradeRelevantPdfPartsForMailIntent(parts, { ocrEnabled });
  const chunks: string[] = [];
  for (const p of filteredParts) {
    const text = await extractDocumentTextPreviewForIntent(p.buffer, p.contentType, p.filename, {
      maxChars: MAX_EXTRACT_PER_FILE,
      ocrEnabled,
    });
    if (text.trim()) {
      chunks.push(`--- ${p.filename} ---\n${text}`);
    }
  }
  const joined = chunks.join("\n\n");
  return joined.length > MAX_COMBINED_CHARS ? joined.slice(0, MAX_COMBINED_CHARS) : joined;
}

/**
 * @deprecated Nutze buildCombinedCommercialDocumentTextForIntent; bleibt für ältere Aufrufer (nur PDF-Teile übergeben).
 */
export async function buildCombinedPdfTextForIntent(parts: InboundPdfPart[]): Promise<string> {
  return buildCombinedCommercialDocumentTextForIntent(parts, { ocrEnabled: false });
}
