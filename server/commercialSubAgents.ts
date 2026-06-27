import type { IStorage } from "./storage";
import { logCommercialAgentDebug } from "./commercialAgentDebugLog";
import { chatCompletion, parseLlmJsonResponse } from "./llmChat";
import { commercialIntentSchema, type CommercialDocumentIntent, type ClassifyCommercialIntentInput } from "./commercialDocumentIntent";

const PDF_SPECIALIST_SYSTEM = `Du bist Sub-Agent „Dokument-Einkauf“. Du siehst NUR einen PDF-/Dokumentauszug (kein vollständiger E-Mail-Thread).
Ordne ein, ob es primär um eine ANGEBOTSANFRAGE (quote_request), eine BESTELLUNG (purchase_order) oder UNKLARES (unclear) geht.
Achte auf: Bestellnummern, „hiermit bestellen“, Liefertermine, Mengenzeilen, „bitte Angebot“, „unverbindliche Preisanfrage“.

Antworte NUR mit JSON:
{"intent":"quote_request"|"purchase_order"|"unclear","confidence":0.0-1.0,"rationale":"kurz","signals":["..."]}`;

const EMAIL_SPECIALIST_SYSTEM = `Du bist Sub-Agent „E-Mail-Einkauf“. Du siehst nur Betreff und E-Mail-Text (kein PDF).
Ordne ein: ANGEBOTSANFRAGE (quote_request), verbindliche BESTELLUNG (purchase_order) oder UNKLARES (unclear).
Achte auf: „bitte Angebot“, Preisanfrage, Stücklisten vs. „hiermit bestellen“, PO, Beauftragung.

Antworte NUR mit JSON:
{"intent":"quote_request"|"purchase_order"|"unclear","confidence":0.0-1.0,"rationale":"kurz","signals":["..."]}`;

export function mergeCommercialIntents(
  primary: CommercialDocumentIntent,
  specialist: CommercialDocumentIntent
): CommercialDocumentIntent {
  if (primary.intent === specialist.intent) {
    const confidence = Math.max(primary.confidence, specialist.confidence);
    const sig = new Set([...(primary.signals || []), ...(specialist.signals || [])]);
    return {
      intent: primary.intent,
      confidence,
      rationale:
        specialist.confidence > primary.confidence + 0.03
          ? specialist.rationale ?? primary.rationale
          : primary.rationale ?? specialist.rationale,
      signals: [...sig].slice(0, 20),
    };
  }
  if (specialist.confidence > primary.confidence + 0.06) {
    return { ...specialist, signals: specialist.signals?.slice(0, 20) };
  }
  return primary;
}

async function runPdfSpecialistIntent(
  storage: IStorage,
  pdfPreview: string,
  subject: string
): Promise<CommercialDocumentIntent | null> {
  const excerpt = pdfPreview.slice(0, 7000);
  if (!excerpt.trim()) return null;
  try {
    const raw = await chatCompletion(storage.getSetting.bind(storage), {
      messages: [
        { role: "system", content: PDF_SPECIALIST_SYSTEM },
        {
          role: "user",
          content: `Betreff (Kontext): ${subject.slice(0, 500)}\n\n--- Dokumentauszug ---\n${excerpt}`,
        },
      ],
      temperature: 0.08,
      response_json: true,
      max_tokens: 400,
    });
    const parsed = parseLlmJsonResponse(raw);
    const safe = commercialIntentSchema.safeParse(parsed);
    if (!safe.success) return null;
    return safe.data;
  } catch (e) {
    console.warn("[CommercialSubAgent] pdf specialist failed:", e);
    return null;
  }
}

async function runEmailSpecialistIntent(
  storage: IStorage,
  input: ClassifyCommercialIntentInput
): Promise<CommercialDocumentIntent | null> {
  const body = (input.emailBody || "").slice(0, 8000);
  const subj = (input.subject || "").slice(0, 500);
  if (!body.trim() && !subj.trim()) return null;
  try {
    const raw = await chatCompletion(storage.getSetting.bind(storage), {
      messages: [
        { role: "system", content: EMAIL_SPECIALIST_SYSTEM },
        {
          role: "user",
          content: `Betreff: ${subj}\n\nE-Mail-Text:\n${body || "(leer)"}`,
        },
      ],
      temperature: 0.08,
      response_json: true,
      max_tokens: 400,
    });
    const parsed = parseLlmJsonResponse(raw);
    const safe = commercialIntentSchema.safeParse(parsed);
    if (!safe.success) return null;
    return safe.data;
  } catch (e) {
    console.warn("[CommercialSubAgent] email specialist failed:", e);
    return null;
  }
}

/**
 * Zweite Meinung (Sub-Agent) nur bei mittlerer Unsicherheit — PDF-Spezialist wenn Text vorhanden, sonst E-Mail-Spezialist.
 */
export async function maybeRefineIntentWithSubAgents(
  storage: IStorage,
  input: ClassifyCommercialIntentInput,
  primary: CommercialDocumentIntent
): Promise<CommercialDocumentIntent> {
  const low = primary.confidence < 0.8;
  const notExtreme = primary.confidence >= 0.22;
  if (!low || !notExtreme) return primary;

  const pdf = (input.documentTextPreview || "").trim();
  const branch = pdf.length > 80 ? "pdf" : "email";
  logCommercialAgentDebug(
    "subagent_start",
    {
      branch,
      pdfTextLen: pdf.length,
      primaryIntent: primary.intent,
      primaryConfidence: primary.confidence,
      tenantId: input.tenantId ?? null,
    },
    input.traceId
  );
  const t0 = Date.now();
  const specialist =
    branch === "pdf"
      ? await runPdfSpecialistIntent(storage, pdf, input.subject || "")
      : await runEmailSpecialistIntent(storage, input);
  const ms = Date.now() - t0;
  if (!specialist) {
    logCommercialAgentDebug("subagent_empty", { branch, ms }, input.traceId);
    return primary;
  }
  const merged = mergeCommercialIntents(primary, specialist);
  logCommercialAgentDebug(
    "subagent_merged",
    {
      branch,
      ms,
      specialistIntent: specialist.intent,
      specialistConfidence: specialist.confidence,
      mergedIntent: merged.intent,
      mergedConfidence: merged.confidence,
    },
    input.traceId
  );
  return merged;
}

/** @deprecated Nutze maybeRefineIntentWithSubAgents */
export const maybeRefineIntentWithPdfSubAgent = maybeRefineIntentWithSubAgents;
