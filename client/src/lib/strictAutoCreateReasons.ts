import type { TFunction } from "i18next";

/** Code der Strikt-Regel (z. B. line_3_price_mismatch) als lesbarer Satz. */
export function describeStrictReason(code: string, t: TFunction): string {
  const line = /^line_([\d, ]+)_(.+)$/.exec(code);
  if (line) {
    return t(`strictAutoCreate.line.${line[2]}`, { line: line[1], defaultValue: code });
  }
  const intent = /^intent_confidence_below_([\d.]+)$/.exec(code);
  if (intent) {
    return t("strictAutoCreate.intentConfidenceBelow", { min: Math.round(Number(intent[1]) * 100) });
  }
  const customer = /^customer_match_confidence_below_([\d.]+)$/.exec(code);
  if (customer) {
    return t("strictAutoCreate.customerMatchBelow", { min: customer[1] });
  }
  return t(`strictAutoCreate.reason.${code}`, { defaultValue: code });
}

/** Gleiche Positionsgründe zusammenfassen: line_1_x, line_2_x → line_1, 2_x (Reihenfolge bleibt). */
export function groupStrictReasons(codes: string[]): string[] {
  const out: string[] = [];
  const linesByReason = new Map<string, string[]>();
  for (const code of codes) {
    const match = /^line_(\d+)_(.+)$/.exec(code);
    if (!match) {
      out.push(code);
      continue;
    }
    const [, line, reason] = match;
    if (!linesByReason.has(reason!)) {
      linesByReason.set(reason!, []);
      out.push(`line_@_${reason}`);
    }
    linesByReason.get(reason!)!.push(line!);
  }
  return out.map((code) => {
    const match = /^line_@_(.+)$/.exec(code);
    return match ? `line_${linesByReason.get(match[1]!)!.join(", ")}_${match[1]}` : code;
  });
}
