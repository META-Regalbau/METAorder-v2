import type OpenAI from "openai";
import type { AIMode } from "./aiConfig";
import { truncateText } from "./aiTextUtils";

/**
 * Optional: kleine LLM-Runde nur für leere Adressfelder (kein Überschreiben bestehender Werte).
 * Aktiv nur bei extractionRefinementSubAgentsEnabled und OpenAI-Modus ≠ local_only.
 */
export async function maybeRunCommercialExtractionRefinement(opts: {
  extractedData: Record<string, unknown>;
  openai: OpenAI | null;
  enabled: boolean;
  aiMode: AIMode;
  emailContext?: string;
  siblingPdfExcerpts?: string;
  timings: Record<string, number>;
}): Promise<void> {
  const { extractedData, openai, enabled, aiMode, emailContext, siblingPdfExcerpts, timings } = opts;
  if (!enabled || !openai || aiMode === "local_only") return;

  const hints = (extractedData.addressReviewHints as string[]) || [];
  const refinable = hints.some((h) =>
    [
      "billing_street_missing_zip_city_present",
      "billing_country_missing",
      "billing_zip_missing",
    ].includes(h)
  );
  if (!refinable) return;

  const billing = (extractedData.billingAddress || {}) as Record<string, string | undefined>;
  const needsStreet = !billing.street?.trim();
  const needsCountry = !billing.country?.trim();
  const needsZip = !billing.zipCode?.trim();
  if (!needsStreet && !needsCountry && !needsZip) return;

  const ctx = [emailContext, siblingPdfExcerpts].filter(Boolean).join("\n\n");
  const snippet = truncateText(ctx, 4000);
  if (snippet.length < 40) return;

  const t0 = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Du hilfst bei fehlenden Rechnungsadressfeldern. Nutze nur den gegebenen Kontext (E-Mail/Anhänge). " +
            "Achte auf Signaturblöcke unterhalb von Grußformeln (Mit freundlichen Grüßen, Best regards, …) — dort stehen oft Straße, PLZ und Ort. " +
            "Antworte mit JSON: { \"street\"?: string, \"zipCode\"?: string, \"city\"?: string, \"country\"?: string }. " +
            "Fülle nur Felder, die im aktuellen Stand leer sind; lasse Keys weg, wenn unsicher.",
        },
        {
          role: "user",
          content:
            `Aktuelle Rechnungsadresse (JSON): ${JSON.stringify({
              street: billing.street || "",
              zipCode: billing.zipCode || "",
              city: billing.city || "",
              country: billing.country || "",
            })}\n\nKontext:\n${snippet}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return;
    const patch = JSON.parse(raw) as Record<string, string>;
    const next = { ...billing };
    for (const key of ["street", "zipCode", "city", "country"] as const) {
      const v = typeof patch[key] === "string" ? patch[key].trim() : "";
      if (!v) continue;
      const cur = (next[key] || "").trim();
      if (!cur) next[key] = v;
    }
    extractedData.billingAddress = next;
    (extractedData as { extractionRefinementApplied?: boolean }).extractionRefinementApplied = true;
  } catch (e) {
    console.warn("[CommercialExtraction] refinement sub-agent failed:", e);
  }
  timings.extractionRefinementMs = Date.now() - t0;
}
