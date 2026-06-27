/**
 * Regression: E-Mail-Signatur ohne expliziten Firmennamen (Mail-Anhang-4.eml).
 * Run: npx tsx scripts/testEmailSignatureEnrichment.ts
 */
import fs from "fs";
import assert from "node:assert/strict";
import { extractPlainTextForDraft } from "../server/documentTextExtraction";
import { pickCompanyFromTextSources } from "../server/companyNameHeuristics";
import { enrichExtractedDataWithCompanyHeuristic } from "../server/companyNameAgent";
import { runCommercialExtractionNormalizeSteps } from "../server/commercialExtractionOrchestrator";

const EML_PATH =
  process.env.TEST_EML_PATH ||
  "/Users/oliversteiling/Library/CloudStorage/OneDrive-JLU365/01 KI Mailtest/Angebotsanfragen/Mail-Anhang-4.eml";

async function main() {
  const buf = fs.readFileSync(EML_PATH);
  const text = await extractPlainTextForDraft({
    fileBuffer: buf,
    mimeType: "message/rfc822",
    fileName: "Mail-Anhang-4.eml",
    ocrEnabled: false,
  });

  const heuristic = pickCompanyFromTextSources({
    sources: [{ source: "primary", text }],
    emailAddresses: ["michael.schmidleithner@ewth.at"],
  });
  assert.ok(heuristic.top, "LinkedIn/Impressum should yield company candidate");
  assert.equal(heuristic.top!.display, "EWTH GmbH");
  assert.equal(heuristic.address.city, "Taiskirchen im Innkreis");
  assert.equal(heuristic.address.country, "AT");
  assert.ok(
    heuristic.address.phone?.includes("01-52"),
    `full phone with extension, got: ${heuristic.address.phone}`
  );

  const extractedData: Record<string, unknown> = {
    customer: { email: "michael.schmidleithner@ewth.at" },
    billingAddress: {},
    lineItems: [
      { quantity: 1, extractedProductName: "4026212259957", extractedProductNumber: "4026212259957" },
      { quantity: 2, extractedProductName: "259964" },
      { quantity: 3, extractedProductName: "264814" },
    ],
  };

  enrichExtractedDataWithCompanyHeuristic({
    extractedData,
    primaryDocumentText: text,
    senderEmailAddress: "michael.schmidleithner@ewth.at",
  });

  const cust = extractedData.customer as Record<string, string>;
  const bill = extractedData.billingAddress as Record<string, string>;
  assert.equal(cust.company, "EWTH GmbH");
  assert.equal(bill.company, "EWTH GmbH");
  assert.equal(bill.city, "Taiskirchen im Innkreis");
  assert.equal(cust.firstName, "Michael");
  assert.equal(cust.lastName, "Schmidleithner");

  runCommercialExtractionNormalizeSteps(extractedData, { kind: "offer", timings: {} });
  const items = extractedData.lineItems as Array<{ extractedProductName: string; extractedProductNumber?: string }>;
  assert.equal(items[1].extractedProductNumber, "4026212259964");
  assert.equal(items[2].extractedProductNumber, "4026212264814");

  console.log("testEmailSignatureEnrichment: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
