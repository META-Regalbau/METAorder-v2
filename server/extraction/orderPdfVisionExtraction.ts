import OpenAI from "openai";
import { toFile } from "openai/uploads";
import type { DocumentExtraction } from "@shared/documentExtractionSchema";
import type { DocumentExtractionFewShot } from "./documentExtractionPrompt";

/**
 * Heuristik: gescannte oder stark grafische PDFs liefern oft fast keinen Textlayer.
 * Dann greift {@link extractOrderDataWithPdfVision} (Responses API + PDF als Datei).
 */
export function isOrderPdfTextInsufficient(extractedPdfText: string): boolean {
  const t = extractedPdfText.replace(/\s+/g, " ").trim();
  if (t.length < 320) return true;
  const alnum = (t.match(/[A-Za-zÄÖÜäöüß0-9]/g) ?? []).length;
  if (alnum / Math.max(t.length, 1) < 0.32) return true;
  return false;
}

export type OrderPdfVisionParams = {
  openai: OpenAI;
  fileBuffer: Buffer;
  fileName: string;
  /** META-aware Snake-Case-Prompt (siehe documentExtractionPrompt.ts). */
  systemPrompt: string;
  /** Nur E-Mail- und Neben-Anhang-Kontext (ohne pdf-parse-Müll). */
  mailContextText: string;
  /** Optional: Few-Shot-Text-Beispiele (input + erwartetes JSON). */
  fewShotMessages?: DocumentExtractionFewShot[];
  maxOutputTokens?: number;
};

/**
 * Bestell-Extraktion direkt aus dem PDF über die Responses API (Vision + Textlayer).
 * Liefert das META-aware Snake-Case-Schema; Translator läuft im Aufrufer.
 */
export async function extractOrderDataWithPdfVision(
  params: OrderPdfVisionParams
): Promise<DocumentExtraction> {
  const {
    openai,
    fileBuffer,
    fileName,
    systemPrompt,
    mailContextText,
    fewShotMessages,
    maxOutputTokens = 4096,
  } = params;

  const uploaded = await openai.files.create({
    file: await toFile(fileBuffer, fileName, { type: "application/pdf" }),
    purpose: "user_data",
  });

  const contextBlock = mailContextText.trim() ? `${mailContextText.trim()}\n\n` : "";
  const fewShotBlock =
    fewShotMessages && fewShotMessages.length > 0
      ? fewShotMessages
          .map(
            (ex) =>
              `--- BEISPIEL (${ex.id}) ---\nINPUT:\n${ex.inputDocumentText.trim()}\n\nERWARTETES JSON:\n${ex.expectedJsonOutput.trim()}`
          )
          .join("\n\n") + "\n\n"
      : "";

  const userText = `${contextBlock}${fewShotBlock}Das Hauptdokument ist das angehängte PDF. Liefere AUSSCHLIESSLICH das vereinbarte snake_case JSON-Objekt gemäß Schema.`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: uploaded.id },
            { type: "input_text", text: userText },
          ],
        },
      ],
      temperature: 0,
      max_output_tokens: maxOutputTokens,
      text: {
        format: { type: "json_object" },
      },
    });

    const raw = response.output_text?.trim();
    if (!raw) {
      throw new Error("PDF-Vision: leere Modellantwort");
    }
    return JSON.parse(raw) as DocumentExtraction;
  } finally {
    await openai.files.delete(uploaded.id).catch(() => undefined);
  }
}
