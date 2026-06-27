/** Kleine Bild-Anhänge aus E-Mails, typisch Signatur/Logo (inline/CID). */

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
