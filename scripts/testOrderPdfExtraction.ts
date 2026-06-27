/**
 * Einmaliger Test: Bestell-PDF → extractOrderDataFromDocument (inkl. PDF-Vision bei dünnem Textlayer).
 *
 * Nutzung:
 *   npx tsx scripts/testOrderPdfExtraction.ts "/absoluter/pfad/Bestellung_BL2601477.pdf"
 *
 * Optional zweites Argument: .eml für E-Mail-Kontext (Betreff + Body-Auszug).
 * API: OPENAI_API_KEY in .env / .env.local oder Replit-Variablen wie im Rest der App.
 */
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs/promises";
import OpenAI from "openai";
import { extractPlainTextForDraft } from "../server/documentTextExtraction";
import { extractOrderDataFromDocument } from "../server/orderDraftExtractor";
import { isOrderPdfTextInsufficient } from "../server/orderPdfVisionExtraction";
import { isReplitOpenAIAvailable } from "../server/openaiClient";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "docker.env") });
dotenv.config();

function buildOpenAI(): OpenAI {
  if (isReplitOpenAIAvailable()) {
    return new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY (oder Replit AI_INTEGRATIONS_*) setzen — siehe scripts/testOrderPdfExtraction.ts"
    );
  }
  return new OpenAI({ apiKey: key });
}

async function roughEmailContextFromEml(emlPath: string): Promise<string> {
  const raw = await fs.readFile(emlPath);
  const { simpleParser } = await import("mailparser");
  const parsed = await simpleParser(raw);
  const sub = (parsed.subject || "").trim();
  const text = (parsed.text || "").trim().slice(0, 4000);
  return [`Betreff: ${sub}`, "", text || "(kein Text)"].join("\n");
}

async function main() {
  const pdfPath =
    process.argv[2]?.trim() ||
    process.env.ORDER_TEST_PDF?.trim() ||
    "";
  if (!pdfPath) {
    console.error(
      "Bitte PDF-Pfad angeben:\n  npx tsx scripts/testOrderPdfExtraction.ts \"/pfad/Bestellung_BL2601477.pdf\"\n" +
        "oder ORDER_TEST_PDF setzen."
    );
    process.exit(1);
  }

  await fs.access(pdfPath);
  const fileName = path.basename(pdfPath);
  const fileBuffer = await fs.readFile(pdfPath);

  let emailContext: string | undefined;
  const emlArg = process.argv[3]?.trim();
  if (emlArg) {
    emailContext = await roughEmailContextFromEml(emlArg);
  }

  const mimeType = "application/pdf";
  const plain = await extractPlainTextForDraft({
    fileBuffer,
    mimeType,
    fileName,
    ocrEnabled: false,
  });
  const insufficient = isOrderPdfTextInsufficient(plain);

  console.log("--- pdf-parse Textlayer (erste 800 Zeichen) ---\n");
  console.log(plain.slice(0, 800) + (plain.length > 800 ? "…" : ""));
  console.log("\n--- Heuristik ---");
  console.log(`Zeichen gesamt: ${plain.length}, isOrderPdfTextInsufficient: ${insufficient}`);

  const openai = buildOpenAI();
  const t0 = Date.now();
  const data = await extractOrderDataFromDocument(fileBuffer, fileName, mimeType, {
    mode: "openai_only",
    openaiClient: openai,
    redactPromptPII: false,
    debugStore: false,
    maxInputChars: 20000,
    ocrEnabled: false,
    emailContext,
  });
  console.log(`\n--- Extraktion (${Date.now() - t0} ms) ---\n`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
