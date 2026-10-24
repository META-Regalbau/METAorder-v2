/** Kleine Bild-Anhänge aus E-Mails, typisch Signatur/Logo (inline/CID). */

import { readImageDimensions } from "../extraction/imageDimensions";
import { isCommercialInboundDocumentAttachment } from "./commercialInboundPdfContext";

export type MailparserLikeImageAttachment = {
  content?: unknown;
  contentType?: string;
  filename?: string;
  contentDisposition?: string;
  cid?: string;
  related?: boolean;
  contentId?: string;
};

export type SignatureImageCandidate = { buffer: Buffer; mimeType: string };

const MAX_BYTES = 450_000;
const MAX_COUNT = 3;

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|gif|webp)$/i;

function normCid(s: string): string {
  return s.replace(/[<>]/g, "").trim().toLowerCase();
}

function cidsReferencedInHtml(html: string): Set<string> {
  const set = new Set<string>();
  const re = /cid:([^"'\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    set.add(normCid(m[1]));
  }
  return set;
}

function scoreAttachment(
  att: MailparserLikeImageAttachment,
  htmlCids: Set<string>
): number {
  let s = 0;
  const cidRaw = att.cid || att.contentId || "";
  const cid = cidRaw ? normCid(String(cidRaw)) : "";
  if (cid && htmlCids.has(cid)) s += 10;

  const disp = (att.contentDisposition || "").toLowerCase();
  if (disp.includes("inline") || att.related) s += 5;

  const fn = (att.filename || "").toLowerCase();
  if (/signature|logo|signatur|firmenlogo|briefkopf/i.test(fn)) s += 4;
  if (/^image\d+|img\d+|picture\d+/i.test(fn)) s += 2;

  return s;
}

/**
 * Wählt bis zu drei kleine Bild-Anhänge, die eher Signatur/Logo sind (CID, inline, Dateiname).
 */
export function collectSignatureImageCandidates(
  attachments: MailparserLikeImageAttachment[] | undefined,
  html?: string | null
): SignatureImageCandidate[] {
  if (!attachments?.length) return [];
  const htmlCids = html?.trim() ? cidsReferencedInHtml(html) : new Set<string>();
  const scored: Array<{ buffer: Buffer; mimeType: string; score: number }> = [];

  for (const att of attachments) {
    if (!Buffer.isBuffer(att.content)) continue;
    const mime = (att.contentType || "application/octet-stream").split(";")[0].trim();
    if (!IMAGE_TYPES.test(mime)) continue;
    if (att.content.length > MAX_BYTES || att.content.length < 80) continue;
    const score = scoreAttachment(att, htmlCids);
    if (score < 2 && htmlCids.size === 0) {
      // Ohne HTML: nur Bilder mit Dateinamen- oder Inline-Hinweis
      const disp = (att.contentDisposition || "").toLowerCase();
      const fn = (att.filename || "").toLowerCase();
      if (!disp.includes("inline") && !att.related && !/signature|logo|image|img|picture/i.test(fn)) {
        continue;
      }
    }
    scored.push({ buffer: att.content, mimeType: mime.toLowerCase(), score });
  }

  scored.sort((a, b) => b.score - a.score || a.buffer.length - b.buffer.length);
  return scored.slice(0, MAX_COUNT).map(({ buffer, mimeType }) => ({ buffer, mimeType }));
}

/**
 * Ist dieses Bild Mail-Dekoration (Signatur-Logo, Telefon-/Web-Icons, Zertifikats-Siegel)?
 *
 * Anders als `collectSignatureImageCandidates` (max. 3 Bilder für die Vision-Firmenerkennung)
 * entscheidet diese Funktion für JEDES Bild, ob daraus ein Entwurf entstehen darf. Eine
 * Signatur mit sechs Icons erzeugte sonst drei Bild-Entwürfe. Fotografierte/gescannte
 * Bestellungen hängen als echte Anhänge an (disposition „attachment") und sind deutlich größer.
 */
export function isMailDecorationImage(att: MailparserLikeImageAttachment, html?: string | null): boolean {
  if (!Buffer.isBuffer(att.content)) return false;
  const mime = (att.contentType || "").split(";")[0].trim();
  if (!/^image\//i.test(mime)) return false;
  const size = att.content.length;
  if (size < 12_000) return true; // Icons, Trennlinien, Tracking-Pixel
  const disp = (att.contentDisposition || "").toLowerCase();
  const cid = att.cid || att.contentId ? normCid(String(att.cid || att.contentId)) : "";
  const referenced = Boolean(cid && html && cidsReferencedInHtml(html).has(cid));
  const inline = disp.includes("inline") || att.related === true || referenced;
  if (inline && size <= MAX_BYTES) return true;
  const fn = (att.filename || "").toLowerCase();
  if (/^(image|img|picture)\d+\.(png|jpe?g|gif)$/i.test(fn) && size <= 150_000) return true; // Outlook „image001.png"
  return /signature|logo|signatur|firmenlogo|briefkopf/i.test(fn) && size <= MAX_BYTES;
}

/**
 * Beginn des zitierten Verlaufs im HTML (Antwort/Weiterleitung) oder -1.
 * Outlook (Desktop, Web, neu), Gmail, Apple Mail, Thunderbird.
 */
const QUOTE_MARKERS: RegExp[] = [
  /<blockquote\b/i,
  /class=["']?gmail_quote/i,
  /class=["']?moz-cite-prefix/i,
  /id=["']?(?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)\b/i,
  /border-top:\s*solid\s+#(?:E1E1E1|B5C4DF)/i,
  /-{3,}\s*(?:Original Message|Ursprüngliche Nachricht|Forwarded message|Weitergeleitete Nachricht)\s*-{3,}/i,
];

function quoteStartIndex(html: string): number {
  let first = -1;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(html);
    if (m && (first < 0 || m.index < first)) first = m.index;
  }
  return first;
}

function attachmentCid(att: MailparserLikeImageAttachment): string {
  const raw = att.cid || att.contentId;
  return raw ? normCid(String(raw)) : "";
}

const FORWARD_SUBJECT_RE = /^(?:\[[^\]]*\]\s*)?(?:WG|FW|FWD|TR|WEITERGELEITET)\s*:/i;

/**
 * Sieht das eingebettete Bild aus wie ein fotografiertes/gescanntes Dokument?
 * Signaturgrafiken sind Banner (sehr breit), Icons oder quadratische Logos — oder, wie bei
 * T-1086, eine 9992×9992-Grafik, die keine Kamera liefert.
 */
function hasDocumentPhotoShape(att: MailparserLikeImageAttachment & { content: Buffer }): boolean {
  const fn = (att.filename || "").toLowerCase();
  if (/signature|logo|signatur|firmenlogo|briefkopf|banner/i.test(fn)) return false;
  const dims = readImageDimensions(att.content);
  if (!dims) return att.content.length >= 100_000; // z. B. HEIC vom iPhone: Maße nicht lesbar
  const short = Math.min(dims.width, dims.height);
  const long = Math.max(dims.width, dims.height);
  if (short < 600) return false; // Banner, Icons, Porträtfotos in Signaturen
  if (long / short > 2.5) return false; // Banner
  if (dims.width * dims.height > 50_000_000) return false; // keine Kamera/kein Scanner
  // Quadratische PNG/GIF sind Logos; Kamerafotos sind 4:3/16:9, Dokumente A4-hochkant
  if ((dims.format === "png" || dims.format === "gif") && long / short < 1.15) return false;
  return true;
}

export type MailDecorationContext = {
  /** Betreff der (ausgepackten) Kundenmail — „WG:/FW:" heißt: der Kunde leitet etwas weiter */
  subject?: string | null;
  /** Interne Weiterleitung: die Kundenmail selbst steht im zitierten Verlauf */
  internalForward?: boolean;
};

/**
 * Alle Bild-Anhänge, aus denen KEIN Entwurf entstehen darf (Buffer-Identität).
 *
 * 1. `isMailDecorationImage`: Icons, kleine Inline-Bilder, Signaturlogos (wie bisher).
 * 2. **Eingebettete Bilder** (Content-ID, im HTML per `cid:` referenziert oder in
 *    multipart/related) gelten grundsätzlich als Teil des Mailtextes, nicht als Dokument —
 *    unabhängig von der Größe. Bei T-1086 (Antwort „Hier kommt die Rechnung") wurden aus
 *    image002–004 sonst drei Bild-Entwürfe, weil Inline-Bilder über 450 KB durchfielen.
 *
 * Ausnahme: fotografierte Bestellungen, die Kunden direkt in den Mailtext setzen (iPhone-Mail
 * bettet Fotos immer ein). Ein eingebettetes Bild bleibt nur dann Entwurfsquelle, wenn
 *   a) die Mail kein anderes Dokument hat (PDF, Word, XML, Mail, echter Bildanhang) — sonst
 *      ist dieses das Dokument und die Bilder sind Beiwerk;
 *   b) es wie ein Foto/Scan aussieht (`hasDocumentPhotoShape`);
 *   c) es im eigenen Teil der Mail steht, nicht nur im zitierten Verlauf einer Antwort.
 *      Bei Weiterleitungen (intern oder „WG:" vom Kunden) steht die eigentliche Nachricht im
 *      Verlauf, dort entfällt c).
 * Der Mailtext allein taugt nicht als Merkmal: Signatur, Rechtshinweise und „Gesendet von
 * meinem iPhone" erzeugen praktisch immer Text, und der reine Mailtext-Entwurf läuft ohne
 * Texterkennung — ein verworfenes Bestellfoto wäre verloren.
 */
export function collectMailDecorationBuffers(
  attachments: MailparserLikeImageAttachment[] | undefined,
  html?: string | null,
  ctx: MailDecorationContext = {}
): Set<Buffer> {
  const decoration = new Set<Buffer>();
  if (!attachments?.length) return decoration;
  const htmlCids = html?.trim() ? cidsReferencedInHtml(html) : new Set<string>();

  const embedded: Array<MailparserLikeImageAttachment & { content: Buffer }> = [];
  let hasOtherDocument = false;
  for (const att of attachments) {
    if (!Buffer.isBuffer(att.content)) continue;
    if (isMailDecorationImage(att, html)) {
      decoration.add(att.content);
      continue;
    }
    const isImage = /^image\//i.test((att.contentType || "").split(";")[0].trim());
    const cid = attachmentCid(att);
    if (isImage && cid && (htmlCids.has(cid) || att.related === true)) {
      embedded.push(att as MailparserLikeImageAttachment & { content: Buffer });
      continue;
    }
    if (isCommercialInboundDocumentAttachment((att.filename || "").toLowerCase(), att.contentType || "")) {
      hasOtherDocument = true;
    }
  }
  if (!embedded.length) return decoration;

  const forwarded = ctx.internalForward === true || FORWARD_SUBJECT_RE.test((ctx.subject || "").trim());
  const quoteAt = html && !forwarded ? quoteStartIndex(html) : -1;
  for (const att of embedded) {
    let pasted = !hasOtherDocument && hasDocumentPhotoShape(att);
    if (pasted && quoteAt >= 0) {
      const cid = attachmentCid(att);
      const at = html!.toLowerCase().indexOf(`cid:${cid}`);
      // Nicht im HTML gefunden (z. B. als data:-URI ersetzt): Position unbekannt → nicht verwerfen
      if (at > quoteAt) pasted = false;
    }
    if (!pasted) decoration.add(att.content);
  }
  return decoration;
}
