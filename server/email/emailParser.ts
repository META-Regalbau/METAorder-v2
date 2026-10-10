import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import MsgReader from '@kenjiuno/msgreader';
import { fileTypeFromBuffer } from 'file-type';

export interface ParsedEmailResult {
  subject: string;
  from: string;
  body: string;
  attachments: ParsedAttachment[];
  orderNumber?: string;
  /** Roh-HTML der Nachricht (CID-Referenzen der Signaturbilder) */
  html?: string | null;
  /** Empfänger aus An/CC (klein geschrieben); nur bei .eml */
  toAddresses?: string[];
  ccAddresses?: string[];
  /** Kopfzeile Auto-Submitted (Abwesenheitsnotizen, Systemmails); nur bei .eml */
  autoSubmitted?: string | null;
}

function addressList(value: ParsedMail["to"]): string[] {
  const objects = Array.isArray(value) ? value : value ? [value] : [];
  return objects
    .flatMap((o) => o.value ?? [])
    .map((a) => (a.address ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  /** „inline" / „attachment" — Signaturbilder sind inline eingebettet */
  contentDisposition?: string;
  cid?: string;
  related?: boolean;
}

/**
 * mailparser liefert bei extrahierten message/rfc822-Teilen mitunter \r\r\n statt \r\n,
 * wodurch der innere Body leer bleibt.
 */
function normalizeEmlBufferForParsing(buffer: Buffer): Buffer {
  const s = buffer.toString("latin1");
  if (!s.includes("\r\r\n")) return buffer;
  return Buffer.from(s.replace(/\r\r\n/g, "\r\n"), "latin1");
}

/**
 * Parst .eml Dateien (Standard E-Mail Format)
 */
export async function parseEmlFile(buffer: Buffer): Promise<ParsedEmailResult> {
  const parsed: ParsedMail = await simpleParser(normalizeEmlBufferForParsing(buffer));

  const attachments = await filterRelevantAttachments(
    parsed.attachments || []
  );

  const bodyText = parsed.text || parsed.html || '';
  const orderNumber = extractOrderNumber(bodyText);

  return {
    subject: parsed.subject || 'Kein Betreff',
    from: parsed.from?.text || 'Unbekannt',
    body: bodyText,
    attachments,
    orderNumber,
    html: typeof parsed.html === "string" ? parsed.html : null,
    toAddresses: addressList(parsed.to),
    ccAddresses: addressList(parsed.cc),
    autoSubmitted: (() => {
      const v = parsed.headers?.get("auto-submitted");
      return typeof v === "string" ? v : null;
    })(),
  };
}

/**
 * Parst .msg Dateien (Outlook Format)
 */
export async function parseMsgFile(buffer: Buffer): Promise<ParsedEmailResult> {
  const msgReader = new MsgReader(buffer);
  const fileData = msgReader.getFileData();

  if (!fileData) {
    throw new Error('Fehler beim Parsen der .msg Datei');
  }

  const attachments: ParsedAttachment[] = [];

  // Anhänge verarbeiten
  if (fileData.attachments && fileData.attachments.length > 0) {
    for (const attachmentMeta of fileData.attachments) {
      // Anhang-Inhalt abrufen mit getAttachment()
      const attachment = msgReader.getAttachment(attachmentMeta);
      
      if (attachment && attachment.content) {
        const buffer = Buffer.from(attachment.content);
        
        // Nur PDFs und Bilder
        const fileType = await fileTypeFromBuffer(buffer);
        if (fileType) {
          const isPdfOrImage =
            fileType.mime === 'application/pdf' ||
            fileType.mime.startsWith('image/');

          if (isPdfOrImage && attachment.fileName) {
            attachments.push({
              filename: attachment.fileName,
              contentType: fileType.mime,
              size: buffer.length,
              content: buffer,
            });
          }
        }
      }
    }
  }

  const bodyText = fileData.body || '';
  const orderNumber = extractOrderNumber(bodyText);

  return {
    subject: fileData.subject || 'Kein Betreff',
    from: fileData.senderEmail || fileData.senderName || 'Unbekannt',
    body: bodyText,
    attachments,
    orderNumber,
  };
}

/**
 * PDF, Bilder und verschachtelte E-Mails (.eml / message/rfc822) für Entwurfsextraktion.
 */
async function filterRelevantAttachments(
  attachments: Attachment[]
): Promise<ParsedAttachment[]> {
  const relevant: ParsedAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment.content) continue;

    const buffer = Buffer.from(attachment.content);
    const fn = (attachment.filename || "").toLowerCase();
    const ct = (attachment.contentType || "").toLowerCase();

    if (ct.includes("message/rfc822") || fn.endsWith(".eml")) {
      relevant.push({
        filename: attachment.filename || "nested.eml",
        contentType: "message/rfc822",
        size: buffer.length,
        content: buffer,
      });
      continue;
    }

    const fileType = await fileTypeFromBuffer(buffer);

    if (fileType) {
      const isPdfOrImage =
        fileType.mime === "application/pdf" || fileType.mime.startsWith("image/");

      if (isPdfOrImage) {
        relevant.push({
          filename: attachment.filename || "unknown",
          contentType: fileType.mime,
          size: buffer.length,
          content: buffer,
          contentDisposition: attachment.contentDisposition,
          cid: attachment.cid,
          related: attachment.related,
        });
      }
    }
  }

  return relevant;
}

/**
 * Extrahiert Bestellnummer aus E-Mail-Text
 * Sucht nach Mustern wie: "Bestellung 12345", "Order #12345", "Bestellnr. 12345-AT"
 */
function extractOrderNumber(text: string): string | undefined {
  const patterns = [
    /Bestellung[:\s]+([A-Z0-9-]+)/i,
    /Bestellnummer[:\s]+([A-Z0-9-]+)/i,
    /Bestellnr\.?[:\s]+([A-Z0-9-]+)/i,
    /Order[:\s#]+([A-Z0-9-]+)/i,
    /Order\s+Number[:\s]+([A-Z0-9-]+)/i,
    /Pedido[:\s]+([A-Z0-9-]+)/i, // Spanisch
    /\b(\d{5}-[A-Z]{2})\b/, // Format: 12345-AT
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Hauptfunktion: Parst E-Mail-Dateien (.eml oder .msg)
 */
export async function parseEmailFile(
  buffer: Buffer,
  filename: string
): Promise<ParsedEmailResult> {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'eml') {
    return parseEmlFile(buffer);
  } else if (ext === 'msg') {
    return parseMsgFile(buffer);
  } else {
    throw new Error(
      'Ungültiges Dateiformat. Nur .eml und .msg werden unterstützt.'
    );
  }
}

/**
 * EML vs. MSG anhand des Inhalts erraten (z. B. falsche Dateiendung / generischer Multer-Name).
 */
/** Outlook-.msg ist eine OLE-Verbunddatei (CFB) mit fester Signatur; alles andere ist RFC822-Text. */
const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export async function parseEmailBufferAutodetect(buffer: Buffer): Promise<ParsedEmailResult> {
  // Früher wurde an der ersten Kopfzeile geraten: Mails, die mit „From:“, „Delivered-To:“ o. Ä.
  // beginnen, liefen als .msg durch und kamen ohne Betreff, Text und Anhänge zurück.
  if (buffer.length >= CFB_SIGNATURE.length && buffer.subarray(0, CFB_SIGNATURE.length).equals(CFB_SIGNATURE)) {
    try {
      return await parseMsgFile(buffer);
    } catch {
      return parseEmlFile(buffer);
    }
  }
  return parseEmlFile(buffer);
}
