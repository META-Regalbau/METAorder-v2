import type OpenAI from "openai";

export type SignatureVisionResult = {
  company?: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Liest Firmenname / Ansprechpartner aus Signatur-Grafiken (ein Vision-Call, bis zu 3 Bilder).
 */
export async function extractCompanyFromSignatureImages(
  openai: OpenAI,
  images: Array<{ buffer: Buffer; mimeType: string }>
): Promise<SignatureVisionResult | null> {
  if (images.length === 0) return null;

  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Du siehst Ausschnitte aus E-Mail-Signaturen (Logos/Bilder). Extrahiere nur sichtbaren Text:
- company: Firmenname wie auf dem Bild (ohne Marketing-Slogan), oder null
- firstName, lastName: nur wenn eindeutig als Personenname erkennbar, sonst null
Antwort NUR als JSON: {"company":string|null,"firstName":string|null,"lastName":string|null}`,
    },
  ];

  for (const img of images) {
    const b64 = img.buffer.toString("base64");
    const mime = img.mimeType.includes("jpeg") ? "image/jpeg" : img.mimeType;
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${b64}`,
        detail: "low",
      },
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: parts,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const company = typeof parsed.company === "string" ? parsed.company.trim() : "";
    const firstName = typeof parsed.firstName === "string" ? parsed.firstName.trim() : "";
    const lastName = typeof parsed.lastName === "string" ? parsed.lastName.trim() : "";
    const out: SignatureVisionResult = {};
    if (company) out.company = company.slice(0, 256);
    if (firstName) out.firstName = firstName.slice(0, 120);
    if (lastName) out.lastName = lastName.slice(0, 120);
    return Object.keys(out).length ? out : null;
  } catch (e) {
    console.warn("[SignatureCompanyVision] OpenAI failed:", e);
    return null;
  }
}

/**
 * Ergänzt extractedData nur wenn Firma/Name noch fehlen (konservativ).
 */
export async function maybeEnrichExtractedDataFromSignatureImages(params: {
  openai: OpenAI;
  images: Array<{ buffer: Buffer; mimeType: string }>;
  extractedData: Record<string, unknown>;
}): Promise<void> {
  const { openai, images, extractedData } = params;
  if (images.length === 0) return;

  const cust = (extractedData.customer as Record<string, unknown> | undefined) || {};
  const bill = (extractedData.billingAddress as Record<string, unknown> | undefined) || {};

  const hasCompany =
    (typeof cust.company === "string" && cust.company.trim().length > 1) ||
    (typeof bill.company === "string" && bill.company.trim().length > 1);
  const hasPerson =
    (typeof cust.firstName === "string" && cust.firstName.trim()) ||
    (typeof cust.lastName === "string" && cust.lastName.trim());

  if (hasCompany && hasPerson) return;

  const vision = await extractCompanyFromSignatureImages(openai, images);
  if (!vision) return;

  if (!extractedData.customer || typeof extractedData.customer !== "object") {
    extractedData.customer = {};
  }
  const c = extractedData.customer as Record<string, unknown>;

  if (vision.company && !hasCompany) {
    c.company = vision.company;
    if (!extractedData.billingAddress || typeof extractedData.billingAddress !== "object") {
      extractedData.billingAddress = {};
    }
    const b = extractedData.billingAddress as Record<string, unknown>;
    if (!(typeof b.company === "string" && b.company.trim().length > 1)) {
      b.company = vision.company;
    }
  }
  if (vision.firstName && !(typeof c.firstName === "string" && c.firstName.trim())) {
    c.firstName = vision.firstName;
  }
  if (vision.lastName && !(typeof c.lastName === "string" && c.lastName.trim())) {
    c.lastName = vision.lastName;
  }

  extractedData.companyFromSignatureImage = {
    company: vision.company ?? null,
    firstName: vision.firstName ?? null,
    lastName: vision.lastName ?? null,
  };
}
