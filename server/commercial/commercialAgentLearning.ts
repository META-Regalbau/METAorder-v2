import type { CommercialAgentExemplar } from "@shared/schema";

export function trimExcerpt(text: string | undefined, max: number): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Textblock für Few-Shot im Intent-Systemprompt */
export function formatExemplarsForIntentPrompt(rows: CommercialAgentExemplar[]): string {
  if (!rows.length) return "";
  const lines = rows.map((r, i) => {
    const sub = (r.subjectExcerpt || "").slice(0, 200);
    const pdf = (r.pdfExcerpt || "").slice(0, 350);
    const mail = (r.emailExcerpt || "").slice(0, 520);
    return `Beispiel ${i + 1}: intent=${r.intentLabel} (Qualität ${r.qualityScore})\nBetreff-Auszug: ${sub || "—"}\nMail-Auszug: ${mail || "—"}\nPDF-Auszug: ${pdf || "—"}`;
  });
  return [
    "",
    "## Interne Referenzbeispiele aus früheren, als gut markierten Läufen (nur zur Einordnung, keine personenbezogenen Daten erfinden):",
    ...lines,
    "Nutze diese Muster nur als stilistische Orientierung; klassifiziere immer den aktuellen Inhalt.",
  ].join("\n");
}

export type RecordAutoExemplarParams = {
  tenantId: string | null | undefined;
  intentLabel: string;
  subject: string;
  emailBody: string;
  pdfPreview: string;
  signals?: string[];
  rationale?: string;
  draftKind: "offer" | "order";
  referenceDraftId: string;
  intentConfidence: number;
  overallMatchConfidence: number | null;
};

/** Qualitätsscore aus Intent- und Match-Konfidenz ableiten (1–20). */
export function deriveQualityScore(intentConfidence: number, overallMatchConfidence: number | null): number {
  const m = overallMatchConfidence ?? 55;
  const raw = Math.round(10 * intentConfidence + m / 20);
  return Math.min(20, Math.max(1, raw));
}

export function shouldRecordAutoExemplar(
  intentConfidence: number,
  overallMatchConfidence: number | null,
  minIntent = 0.62,
  minMatch = 52
): boolean {
  if (intentConfidence < minIntent) return false;
  if (overallMatchConfidence === null) return true;
  return overallMatchConfidence >= minMatch;
}
