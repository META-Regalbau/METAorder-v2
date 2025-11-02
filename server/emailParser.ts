import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import MsgReader from '@kenjiuno/msgreader';
import { fileTypeFromBuffer } from 'file-type';

export interface ParsedEmailResult {
  subject: string;
  from: string;
  body: string;
  attachments: ParsedAttachment[];
  orderNumber?: string;
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

/**
 * Parst .eml Dateien (Standard E-Mail Format)
 */
export async function parseEmlFile(buffer: Buffer): Promise<ParsedEmailResult> {
  const parsed: ParsedMail = await simpleParser(buffer);

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
 * Filtert nur PDF und Foto-Anhänge
 */
async function filterRelevantAttachments(
  attachments: Attachment[]
): Promise<ParsedAttachment[]> {
  const relevant: ParsedAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment.content) continue;

    const buffer = Buffer.from(attachment.content);
    const fileType = await fileTypeFromBuffer(buffer);

    if (fileType) {
      const isPdfOrImage =
        fileType.mime === 'application/pdf' ||
        fileType.mime.startsWith('image/');

      if (isPdfOrImage) {
        relevant.push({
          filename: attachment.filename || 'unknown',
          contentType: fileType.mime,
          size: buffer.length,
          content: buffer,
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
