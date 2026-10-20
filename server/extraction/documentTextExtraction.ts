import { createRequire } from "node:module";
import mammoth from "mammoth";
import {
  parseEmailBufferAutodetect,
  parseEmailFile,
  type ParsedEmailResult,
} from "../email/emailParser";
import { logger } from "../lib/logger";
import { repairUtf8Mojibake } from "../email/mojibake";
import { orderXmlToReadableText, parseOrderXml, xmlToPlainText } from "./orderXmlParser";
import { readImageDimensions } from "./imageDimensions";

const log = logger.child({ component: "extraction/documentTextExtraction" });

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

const MAX_EML_NEST_DEPTH = 3;

/** Trennt Haupttext und Signatur für klarere Kunden-/Kontakterkennung (heuristisch). */
export function splitEmailBodyMainAndSignature(body: string): { main: string; signature?: string } {
  if (!body?.trim()) return { main: body || "" };
  const markers = [
    "\n-- \n",
    "\n--\n",
    "\r\n-- \r\n",
    "\r\n--\r\n",
    "\nMit freundlichen Grüßen",
    "\nMit freundlichem Gruß",
    "\nViele Grüße",
    "\nHerzliche Grüße",
    "\nBest regards,",
    "\nKind regards,",
    "\nRegards,",
  ];
  let cut = -1;
  for (const m of markers) {
    const idx = body.lastIndexOf(m);
    if (idx >= 0 && idx > cut) cut = idx;
  }
  if (cut < 0) return { main: body };
  const main = body.slice(0, cut).trimEnd();
  const signature = body.slice(cut).trim();
  if (signature.length < 12 || main.length < 20) return { main: body };
  return { main, signature };
}

function formatBodyWithSignatureLabel(body: string): string {
  const { main, signature } = splitEmailBodyMainAndSignature(body);
  if (!signature) return body;
  return `${main}\n\n[Signatur]\n${signature}`;
}

/** Flacher Header+Body inkl. Signatur-Label (ohne Anhangstexte). */
export function formatParsedEmailForDraft(parsed: ParsedEmailResult): string {
  const body = formatBodyWithSignatureLabel(parsed.body || "");
  return [`Betreff: ${parsed.subject}`, `Von: ${parsed.from}`, "", body].join("\n");
}

/**
 * Voller Entwurfstext: Betreff, Von, Body mit [Signatur], verschachtelte .eml,
 * OCR/PDF-Text aus Bild- und PDF-Anhängen.
 */
export async function formatParsedEmailForDraftExpanded(
  parsed: ParsedEmailResult,
  options: { ocrEnabled: boolean; nestDepth?: number }
): Promise<string> {
  const nestDepth = options.nestDepth ?? 0;
  const bodyFormatted = formatBodyWithSignatureLabel(parsed.body || "");
  let out = [`Betreff: ${parsed.subject}`, `Von: ${parsed.from}`, "", bodyFormatted].join("\n");

  for (const att of parsed.attachments) {
    const fn = att.filename.toLowerCase();
    const ct = att.contentType.toLowerCase();
    const isNestedEml =
      nestDepth < MAX_EML_NEST_DEPTH &&
      (ct.includes("message/rfc822") || fn.endsWith(".eml"));

    if (isNestedEml) {
      try {
        const inner = await parseEmailBufferAutodetect(att.content);
        const innerText = await formatParsedEmailForDraftExpanded(inner, {
          ocrEnabled: options.ocrEnabled,
          nestDepth: nestDepth + 1,
        });
        out += `\n\n[Eingebettete Nachricht: ${att.filename}]\n${innerText}`;
      } catch (e) {
        log.warn({ err: e }, `[documentTextExtraction] Nested EML parse failed: ${att.filename}`);
      }
      continue;
    }

    try {
      const chunk = await extractPlainTextForDraft({
        fileBuffer: att.content,
        mimeType: att.contentType,
        fileName: att.filename,
        ocrEnabled: options.ocrEnabled,
      });
      if (chunk.trim()) {
        out += `\n\n[Auszug aus Anhang ${att.filename} (${att.contentType})]\n${chunk.trim()}`;
      }
    } catch (e) {
      log.warn({ err: e }, `[documentTextExtraction] Attachment extraction failed: ${att.filename}`);
    }
  }

  return out;
}

function extensionOf(fileName: string): string {
  const base = fileName.toLowerCase().split(/[/\\]/).pop() || "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1) : "";
}

/**
 * Browser/Multer liefern PDFs oft als `application/octet-stream`.
 * Gleiche Heuristik wie bei der Textextraktion — u. a. damit PDF-Vision im Order-Extractor greift.
 */
export function normalizeMimeTypeForDraft(fileName: string, mimeType: string): string {
  let m = mimeType.toLowerCase();
  const ext = extensionOf(fileName);
  if (ext === "pdf" && m !== "application/pdf") {
    m = "application/pdf";
  }
  if (ext === "xml" || m === "text/xml" || m.endsWith("+xml")) {
    m = "application/xml";
  }
  if (ext === "docx") {
    m = isDocxMime(m)
      ? m
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return m;
}

function isDocxMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m.includes("wordprocessingml")
  );
}

/**
 * Größtes Bild (Pixel), das in die Texterkennung geht. Tesseract hält das Bild dekodiert im
 * WASM-Speicher: 9992×9992 (T-1086) kostete +640 MB bis +1 GB und brachte den 1-GB-Container
 * zum Absturz; 5000×5000 kostet gemessen +363 MB (~15 Byte je Pixel). 20 Mpx (~+290 MB) deckt
 * A4 mit 400 dpi (15,5 Mpx) und 12-Mpx-Handyfotos ab.
 * Größere Bilder gehen ohne OCR-Text weiter (Vision bekommt sie trotzdem).
 */
export const MAX_OCR_IMAGE_PIXELS = 20_000_000;

/** Grund, warum das Bild nicht in die Texterkennung darf; null = erkennen. */
export function ocrImageSkipReason(fileBuffer: Buffer): string | null {
  const dims = readImageDimensions(fileBuffer);
  if (!dims) return "Bildformat/Bildmaße nicht lesbar";
  if (dims.width * dims.height > MAX_OCR_IMAGE_PIXELS) {
    return `${dims.width}×${dims.height} px (${Math.round((dims.width * dims.height) / 1e6)} Mpx, Grenze ${MAX_OCR_IMAGE_PIXELS / 1e6} Mpx)`;
  }
  return null;
}

// Eine Texterkennung zur Zeit je Prozess: zwei parallele Mails dürfen den Speicher nicht verdoppeln.
let ocrQueue: Promise<unknown> = Promise.resolve();

async function extractTextFromImage(fileBuffer: Buffer, fileName: string): Promise<string> {
  const skipReason = ocrImageSkipReason(fileBuffer);
  if (skipReason) {
    log.warn(
      { event: "ocr.skipped", fileName, reason: skipReason },
      `[documentTextExtraction] Texterkennung für ${fileName} übersprungen: ${skipReason}`,
    );
    return "";
  }
  const run = ocrQueue.then(async () => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("deu+eng");
    try {
      const { data } = await worker.recognize(fileBuffer);
      return data.text || "";
    } finally {
      // Auch bei Fehlern beenden – sonst bleibt der Worker-Thread mit dem dekodierten Bild liegen.
      await worker.terminate();
    }
  });
  ocrQueue = run.catch(() => undefined);
  return run;
}

/**
 * Einheitliche Rohtext-Gewinnung für Angebots-/Bestell-Entwürfe (Upload + Commercial Agent).
 */
export async function extractPlainTextForDraft(options: {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
  ocrEnabled: boolean;
}): Promise<string> {
  const { fileBuffer, fileName, ocrEnabled } = options;
  let mimeType = normalizeMimeTypeForDraft(fileName, options.mimeType);

  const ext = extensionOf(fileName);

  if (ext === "eml" || ext === "msg") {
    const parsed = await parseEmailFile(fileBuffer, fileName);
    return formatParsedEmailForDraftExpanded(parsed, { ocrEnabled, nestDepth: 0 });
  }

  if (mimeType === "message/rfc822" || mimeType === "application/vnd.ms-outlook") {
    const parsed = await parseEmailBufferAutodetect(fileBuffer);
    return formatParsedEmailForDraftExpanded(parsed, { ocrEnabled, nestDepth: 0 });
  }

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: fileBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();
    // iText-PDFs (Mercateo-Lieferschein) liefern teils doppelt kodierte Umlaute („RudolphstraÃŸe“)
    return repairUtf8Mojibake(pdfData.text || "");
  }

  if (mimeType === "application/xml") {
    // Bestell-XML (openTRANS/cXML) als lesbare Bestellung, anderes XML als „Pfad: Wert“-Zeilen
    const order = parseOrderXml(fileBuffer);
    return order ? orderXmlToReadableText(order) : xmlToPlainText(fileBuffer);
  }

  if (mimeType.startsWith("image/")) {
    if (!ocrEnabled) return "";
    return extractTextFromImage(fileBuffer, fileName);
  }

  if (isDocxMime(mimeType) || ext === "docx") {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return (result.value || "").trim();
  }

  if (mimeType === "application/msword" || ext === "doc") {
    log.warn("[documentTextExtraction] Altes Word .doc wird nicht unterstützt — bitte .docx oder PDF verwenden.");
    return "";
  }

  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return fileBuffer.toString("utf-8");
  }

  if (mimeType.includes("message/")) {
    return fileBuffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${options.mimeType} (${fileName})`);
}

/** Kurzer Plaintext für Intent-Klassifikation (ohne schwere OCR, außer ocrEnabled). */
export async function extractDocumentTextPreviewForIntent(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  options?: { maxChars?: number; ocrEnabled?: boolean }
): Promise<string> {
  const maxChars = options?.maxChars ?? 6000;
  const ocrEnabled = options?.ocrEnabled ?? false;
  try {
    const raw = await extractPlainTextForDraft({ fileBuffer, mimeType, fileName, ocrEnabled });
    const text = raw.replace(/\s+/g, " ").trim();
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return "";
  }
}
