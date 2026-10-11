/**
 * Doppelt kodierte Umlaute reparieren („RudolphstraÃŸe“ → „Rudolphstraße“, Mercateo-Mail 11.10.2026).
 *
 * Entsteht, wenn UTF-8-Text als Windows-1252/Latin-1 gelesen und wieder als UTF-8 gespeichert wird
 * (Weiterleitungen, Plattform-Mails mit falscher charset-Angabe). Repariert wird nur, wenn der Text
 * typische Folgen enthält und die Rückumwandlung sauberes UTF-8 ergibt – echter Text mit „Ã“ bleibt.
 */

// Windows-1252 0x80–0x9F → Unicode (für die Rückumwandlung in Bytes)
const CP1252_SPECIALS: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
  "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

// Ã/Â (bzw. â bei €, Gedankenstrich, Anführungszeichen) gefolgt von Zeichen, die als
// Folgebytes einer UTF-8-Sequenz vorkommen
const CONT = "\\u0080-\\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const MOJIBAKE_RE = new RegExp(`[ÃÂ][${CONT}]|â[${CONT}]{2}`);
const MOJIBAKE_RUN_RE = new RegExp(`(?:[ÃÂÅâ][${CONT}]{1,2})+`, "g");

function toCp1252Bytes(s: string): number[] | null {
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code <= 0xff) out.push(code);
    else if (CP1252_SPECIALS[ch] !== undefined) out.push(CP1252_SPECIALS[ch]);
    else return null;
  }
  return out;
}

export function repairUtf8Mojibake(text: string): string {
  if (!text || !MOJIBAKE_RE.test(text)) return text;
  return text.replace(MOJIBAKE_RUN_RE, (run) => {
    const bytes = toCp1252Bytes(run);
    if (!bytes) return run;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return run;
    }
  });
}
