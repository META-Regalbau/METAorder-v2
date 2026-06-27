/**
 * Liest .eml-Dateien, parst Betreff/Text, optional PDF-Anhang → Commercial Intent (wie in der App).
 * Nutzung (aus METAorder-v2):
 *   Optional `.env.local` mit ANTHROPIC_API_KEY + ENCRYPTION_KEY (nicht committen).
 *   Oder: ENCRYPTION_KEY=… OPENAI_API_KEY=… npx tsx scripts/classifyEmlIntent.ts …
 */
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();
import fs from "fs/promises";
import { simpleParser } from "mailparser";
import { encrypt } from "../server/encryption";
import { classifyCommercialDocumentIntent } from "../server/commercialDocumentIntent";
import {
  filterPdfPartsFromMailparserAttachments,
  buildCombinedPdfTextForIntent,
} from "../server/commercialInboundPdfContext";
import { maybeRefineIntentWithSubAgents } from "../server/commercialSubAgents";
import type { IStorage } from "../server/storage";

function makeStorage(): IStorage {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const provider =
    process.env.LLM_TEST_PROVIDER === "anthropic" && anthropicKey ? "anthropic" : "openai";

  const openai_settings =
    provider === "openai" && openaiKey
      ? {
          enabled: true,
          apiKey: encrypt(openaiKey),
          chatProvider: "openai" as const,
        }
      : provider === "anthropic" && anthropicKey
        ? {
            enabled: true,
            anthropicApiKey: encrypt(anthropicKey),
            chatProvider: "anthropic" as const,
          }
        : undefined;

  return {
    async getSetting(key: string) {
      if (key === "openai_settings") return openai_settings;
      if (key === "commercial_agent_settings") return {};
      if (key === "ai_settings") return {};
      return undefined;
    },
  } as unknown as IStorage;
}

async function main() {
  const files = process.argv.slice(2).filter((a) => a.endsWith(".eml"));
  if (!files.length) {
    console.error("Usage: npx tsx scripts/classifyEmlIntent.ts <file.eml> …");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error(
      "ENCRYPTION_KEY fehlt. In .env.local setzen (Vorlage: cp .env.local.example .env.local).",
    );
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error(
      "Kein API-Key: In .env.local ANTHROPIC_API_KEY + LLM_TEST_PROVIDER=anthropic eintragen\n" +
        "(oder OPENAI_API_KEY). Vorlage: METAorder-v2/.env.local.example — dann: npm run classify-eml -- mail1.eml …",
    );
    process.exit(1);
  }

  const storage = makeStorage();

  for (const filePath of files) {
    const base = path.basename(filePath);
    const raw = await fs.readFile(filePath);
    const parsed = await simpleParser(raw);
    const subject = parsed.subject || "(ohne Betreff)";
    const traceId =
      (typeof parsed.messageId === "string" && parsed.messageId.trim()) ||
      `eml:${base}`;
    const emailBody =
      typeof parsed.text === "string"
        ? parsed.text
        : Buffer.isBuffer(parsed.text)
          ? parsed.text.toString("utf8")
          : "";

    const attachments = parsed.attachments || [];
    const pdfParts = filterPdfPartsFromMailparserAttachments(attachments);
    const combinedPdfText =
      pdfParts.length > 0 ? (await buildCombinedPdfTextForIntent(pdfParts)).trim() : "";

    let intent = await classifyCommercialDocumentIntent(storage, {
      subject,
      emailBody,
      documentTextPreview: combinedPdfText || undefined,
      traceId,
    });
    intent = await maybeRefineIntentWithSubAgents(
      storage,
      { subject, emailBody, documentTextPreview: combinedPdfText || undefined, traceId },
      intent
    );

    console.log("\n---", base, "---");
    console.log("Betreff:", subject.slice(0, 200));
    console.log(
      "PDF-Kontext (alle Anhänge, für Intent):",
      combinedPdfText
        ? `${combinedPdfText.slice(0, 200)}… (${combinedPdfText.length} Zeichen, ${pdfParts.length} PDF(s))`
        : "(kein PDF extrahiert)"
    );
    console.log("Intent:", JSON.stringify(intent, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
