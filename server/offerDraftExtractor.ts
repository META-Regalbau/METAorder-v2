import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AIMode } from "./aiConfig";
import { redactPII, sanitizeDocumentText, truncateText, writeAIDebugSnapshot } from "./aiTextUtils";
import {
  mergeDraftExtractionSources,
  mergeEmailAndSiblingExcerptsOnly,
  type DraftExtractionMailContext,
} from "./draftExtractionContext";
import { extractProductNumberFromLineRest } from "./articleNumberNormalize";
import { extractPlainTextForDraft } from "./documentTextExtraction";
import type { DocumentExtraction } from "@shared/documentExtractionSchema";
import {
  DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
  buildFewShotChatMessages,
  loadDocumentExtractionFewShots,
} from "./documentExtractionPrompt";
import {
  applyExtractionPostValidation,
  normalizeDocumentExtractionInPlace,
  translateDocumentExtractionToLegacy,
} from "./documentExtractionTranslate";

export interface ExtractedOfferData {
  customer?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    company?: string;
  };
  billingAddress?: {
    firstName?: string;
    lastName?: string;
    street?: string;
    zipCode?: string;
    city?: string;
    country?: string;
    company?: string;
    phone?: string;
  };
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    street?: string;
    zipCode?: string;
    city?: string;
    country?: string;
    company?: string;
    phone?: string;
  };
  lineItems?: Array<{
    extractedProductName: string;
    extractedPositionNumber?: string;
    extractedProductNumber?: string;
    quantity: number;
    extractedPrice?: number;
  }>;
  offerNotes?: string;
  orderNotes?: string;
  validUntil?: string;
  /** Snake-case Original aus dem META-aware Extraktor; UI / Klärungs-Mail nutzt diese Felder. */
  documentExtraction?: DocumentExtraction;
}

/** Few-Shots werden einmal beim ersten Aufruf geladen und gecacht. */
let cachedDocumentExtractionFewShots: Awaited<
  ReturnType<typeof loadDocumentExtractionFewShots>
> | null = null;
async function getCachedDocumentExtractionFewShots() {
  if (cachedDocumentExtractionFewShots) return cachedDocumentExtractionFewShots;
  cachedDocumentExtractionFewShots = await loadDocumentExtractionFewShots();
  return cachedDocumentExtractionFewShots;
}

/** @deprecated Ersetzt durch DOCUMENT_EXTRACTION_SYSTEM_PROMPT (META-aware Schema). Wird derzeit nicht mehr verwendet. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const EXTRACTION_SYSTEM_PROMPT_LEGACY = `Du bist ein Experte für die Extraktion von Angebots-Anfragen aus Dokumenten, spezialisiert auf Regalsysteme und technische Produkte.
Deine Aufgabe ist es, aus hochgeladenen PDFs, E-Mails oder Bildern folgende Informationen zu extrahieren:

Der Nutzer-Text kann markierte Abschnitte enthalten: [Hauptdokument], [E-Mail derselben Anfrage], [Weitere PDF-Auszüge derselben E-Mail]. Nutze ALLE Quellen — Anfragen stehen oft im E-Mail-Text oder in einem weiteren Anhang, während das Haupt-PDF nur eine Zeichnung oder wenig Text hat.

1. Kundendaten (Name, E-Mail, Telefon, Firma)
2. Rechnungsadresse
3. Gewünschte Artikel mit Produktbezeichnung, Menge und ggf. Artikelnummer
4. Gültigkeitsdatum des Angebots (falls erwähnt)
5. Zusätzliche Notizen oder Hinweise zur Anfrage

WICHTIG - Kundendaten:
- Extrahiere IMMER "firstName" und "lastName" aus dem Dokument wenn vorhanden (egal ob Firma oder Privatperson)
- Bei Firmenkunden: Extrahiere auch den Firmennamen in "company"
- E-Mail des KUNDEN (Anfragenden): Bei weitergeleiteten E-Mails ist das oft NICHT die Adresse des Absenders der äußeren Mail. Nutze die E-Mail im weitergeleiteten Block (z. B. Zeilen „Von:“ / „From:“ / „Absender:“ / „Reply-To:“ der Originalnachricht), Signatur des Kunden oder Kontakt im PDF — nicht die des internen Weiterleiters.
- Unterhalb von Grußformeln (z. B. „Mit freundlichen Grüßen“, „Best regards“) steht oft der Signaturblock mit Firma, Ansprechpartner und Adresse — dort gezielt suchen, auch wenn der obere Anfragetext wenig Kundendaten enthält (Firmenname kann auch nur dort stehen).
- BLOCKIERE "META Regalbau" als Kundenname - Das ist der Shop-Name, NICHT der tatsächliche Kunde! Wenn "META Regalbau" als Firma/Name erscheint, ignoriere es und suche nach dem echten Kunden im Dokument.

WICHTIG - Adressen (strikt trennen, niemals „alles in ein Feld“):
- "street": NUR Straßenname und Hausnummer (eine logische Zeile), OHNE Postleitzahl und OHNE Ort am Ende.
- "zipCode": nur die PLZ (typisch 4–5 Ziffern in DE/AT/CH).
- "city": nur der Ortsname (ohne Straße, ohne PLZ).
- Wenn im Quelltext alles in einer Zeile steht (z. B. „Musterweg 12, 12345 Berlin“): zerlege in street / zipCode / city — nicht die komplette Zeile nur in "street".
- Adressen aus der E-Mail-Signatur gehören ausschließlich unter billingAddress, nicht unter lineItems.

WICHTIG - Adressen (Rollen):
- Bei FIRMENKUNDEN: derselbe Firmenname in "customer.company" UND "billingAddress.company" (identischer Text)
- Bei FIRMENKUNDEN: "company" ist PFLICHT für billingAddress
- Bei FIRMENKUNDEN: "firstName" und "lastName" in Adressen NUR wenn sie dort explizit stehen (oft leer bei Firmenbestellungen)
- Bei PRIVATKUNDEN: "firstName" und "lastName" sind Pflicht in Adressen
- "country" in billingAddress: NUR der Staatsname (z. B. „Deutschland“, „Österreich“) — keine PLZ, kein Ort, keine Straße, keine Zusatzsätze
- Telefonnummer, die explizit zur Rechnungsadresse gehört (z. B. „Tel.“ neben der Adresse): in "billingAddress.phone" — getrennt von "customer.phone", wenn beides vorkommt.

WICHTIG - Produkte und SYSTEM-ANFRAGEN:
- "lineItems" NUR echte Produkt- oder Leistungspositionen (bestellbare Artikel, Regal-Komponenten, Systemanfragen). KEINE Anreden, Grußformeln, E-Mail-Signaturen, Postadressen (Straße/PLZ/Ort), reinen Kontaktzeilen, Zahlungs-/AGB-Hinweise, Dateinamen ohne Produktbezug oder andere Fließtext-Zeilen — diese gehören nicht in lineItems (ggf. in offerNotes).
- "lineItems" MUSS ein Array sein: [...], NIEMALS ein Objekt: {...}
- Jedes lineItem muss "extractedProductName" und "quantity" enthalten
- Artikelnummern / EAN / GTIN: In PDFs und E-Mails stehen Barcodes oft mit Leerzeichen oder Bindestrichen gruppiert (z. B. „4032 9812345678“). Bei reinen GTIN/EAN-Feldern liefere extractedProductNumber immer als durchgehende Ziffernfolge ohne Leerzeichen (nur 0–9), alle Ziffern erhalten. Alphanumerische Herstellernummern (z. B. „META-AB-123“) wie im Dokument, ohne künstliche Umformatierung.
- **Mehrzeilige Tabellen:** Eine Anfrage-/Positionszeile kann auf **mehrere Textzeilen** verteilt sein (z. B. erste Zeile: Pos.-Nr., GTIN, Bezeichnung — nächste Zeile: Menge „19 Stück“, Preise). Gehört zusammen → **ein** lineItem; nicht in zwei lineItems splitten. Layouts können abweichen.
- **Positionsnummer ≠ Menge:** Werte wie 00001 oder Staffel 10/20 in der ersten Zeile sind Positionsindex (ggf. als Text im Namen belassen oder weglassen) — die bestellte Menge steht in der Zeile mit „Stück“/Menge, nicht aus der Positions-Spalte raten.
- **Keine Preise in Name/Nummer:** Fortsetzungszeilen mit nur Menge + Einzelpreis + Summe liefern **kein** zweites lineItem und **kein** extractedProductName wie „160,06 3.041,14“. Kein extractedProductNumber aus Preisfragmenten.
- **Deutsche Zahlen:** „1.234,56“ im JSON als 1234.56 (Punkt = Dezimal). Bei Einzel- und Gesamtpreis: \`extractedPrice\` = Stück-/Einzelpreis, wenn erkennbar.
- Bei Mengenangaben: Wandle Texte wie "zwei" → 2 um
- SPEZIAL: HOLME (Beams/Querträger) werden als 2er-Sets verkauft! Wenn ein Kunde nach einzelnen Holmen fragt (z.B. "24 Holme"), extrahiere die URSPRÜNGLICHE Menge (24), die wird später automatisch halbiert.

SPEZIAL-FALL: REGALSYSTEME UND SYSTEM-ANFRAGEN:
- Wenn der Kunde ein KOMPLETT-SYSTEM anfragt (z.B. "7000mm breit", "Kragarmregal 7000mm"), erkenne dies als System-Anfrage
- Extrahiere ALLE technischen Spezifikationen in "extractedProductName":
  * Gesamtabmessungen (Breite, Höhe, Tiefe)
  * Bauart (einseitig, doppelseitig)
  * Tragkraft pro Arm/Ebene
  * Produktkategorie (z.B. "Kragarmregal", "Palettenregal")
- Setze quantity=1 für die System-Anfrage (nicht die Anzahl der Komponenten!)
- Beispiel: "Kragarmregal 7000mm breit, doppelseitig, 2500mm hoch, 500kg Tragkraft pro Arm"

WICHTIG - Gültigkeitsdatum:
- Wenn im Dokument eine Gültigkeitsdauer oder ein "Angebot gültig bis"-Datum erwähnt wird, extrahiere es in "validUntil"
- Format: ISO 8601 (YYYY-MM-DD)
- Falls nur eine Dauer angegeben ist (z.B. "30 Tage gültig"), berechne das Datum ausgehend von heute

WICHTIG - Fehlende Daten:
- Felder die nicht im Dokument vorhanden sind: KOMPLETT WEGLASSEN (nicht als leeren String "")
- Nur tatsächlich vorhandene Informationen extrahieren
- Bei unklaren Informationen: Feld weglassen statt zu raten

Antworte ausschließlich mit einem validen JSON-Objekt im folgenden Format:

Beispiel FIRMENKUNDE:
{
  "customer": {
    "email": "anfrage@firma.de",
    "phone": "+49 123 456789",
    "company": "Musterfirma GmbH",
    "firstName": "Christian",
    "lastName": "Gigl"
  },
  "billingAddress": {
    "company": "Musterfirma GmbH",
    "street": "Musterstraße 123",
    "zipCode": "12345",
    "city": "Musterstadt",
    "country": "Deutschland"
  },
  "lineItems": [
    {
      "extractedProductName": "Produktname XYZ",
      "extractedProductNumber": "ART-12345",
      "quantity": 5,
      "extractedPrice": 49.99
    }
  ],
  "offerNotes": "Bitte prüfen Sie Verfügbarkeit für Lieferung KW 25",
  "validUntil": "2025-12-31"
}

Beispiel PRIVATKUNDE:
{
  "customer": {
    "firstName": "Max",
    "lastName": "Mustermann",
    "email": "max@example.com",
    "phone": "+49 123 456789"
  },
  "billingAddress": {
    "firstName": "Max",
    "lastName": "Mustermann",
    "street": "Musterstraße 123",
    "zipCode": "12345",
    "city": "Musterstadt",
    "country": "Deutschland"
  },
  "lineItems": [
    {
      "extractedProductName": "Artikel ABC",
      "quantity": 3
    }
  ],
  "offerNotes": "Interessiert an Mengenrabatt"
}`;

/**
 * Extract offer request data from a document using OpenAI GPT-4o Vision
 * Supports PDFs, images, and email text
 */
export async function extractOfferDataFromDocument(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  options: {
    mode: AIMode;
    openaiClient?: OpenAI | null;
    redactPromptPII?: boolean;
    debugStore?: boolean;
    maxInputChars?: number;
    ocrEnabled?: boolean;
    /** Wenn gesetzt, ersetzt den aus der Datei extrahierten Hauptdokument-Text */
    primaryDocumentText?: string | null;
  } & DraftExtractionMailContext
): Promise<ExtractedOfferData> {
  const {
    mode,
    openaiClient,
    redactPromptPII,
    debugStore,
    maxInputChars = 20000,
    ocrEnabled = true,
    emailContext,
    siblingPdfExcerpts,
    primaryDocumentText,
  } = options;

  const readPrimaryDocumentText = async () =>
    primaryDocumentText != null
      ? primaryDocumentText
      : await extractPlainTextForDraft({ fileBuffer, mimeType, fileName, ocrEnabled });
  const mailExtras: DraftExtractionMailContext | undefined =
    emailContext?.trim() || siblingPdfExcerpts?.trim()
      ? { emailContext, siblingPdfExcerpts }
      : undefined;

  const shouldUseOpenAI =
    mode === "openai_only" ||
    (mode === "openai_optional" && !!openaiClient);

  if (mode === "openai_only" && !openaiClient) {
    throw new Error("OpenAI is required but not configured");
  }

  if (mode === "openai_optional") {
    const localText = await readPrimaryDocumentText();
    const normalizedText = mergeDraftExtractionSources(
      localText,
      maxInputChars,
      mailExtras,
      Boolean(redactPromptPII)
    );
    const localData = normalizeExtractedData(localExtractOfferData(normalizedText));
    const lowQuality = isLowQualityLocalOffer(localData);

    if (!lowQuality) {
      if (debugStore) {
        await writeAIDebugSnapshot(
          {
            type: "offer_extraction_local_preferred",
            fileName,
            mimeType,
            inputPreview: redactPII(normalizedText).slice(0, 2000),
            response: localData,
          },
          "offer-local-preferred"
        );
      }
      return localData;
    }
  }

  if (shouldUseOpenAI) {
    const openai = openaiClient!;
    const fewShots = await getCachedDocumentExtractionFewShots();
    const fewShotMessages = buildFewShotChatMessages(fewShots) as ChatCompletionMessageParam[];

    let userMessage: ChatCompletionMessageParam;
    if (mimeType.startsWith("image/")) {
      const base64Image = fileBuffer.toString("base64");
      const contextPrefix = mailExtras
        ? `${mergeEmailAndSiblingExcerptsOnly(maxInputChars, mailExtras, Boolean(redactPromptPII))}\n\n`
        : "";
      userMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: `${contextPrefix}Extrahiere strukturierte Angebots-/Anfrage-Daten aus diesem Bild (gesamtes JSON-Schema, snake_case):`,
          },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" },
          },
        ],
      };
    } else {
      const textContent = await readPrimaryDocumentText();
      const safeText = mergeDraftExtractionSources(
        textContent,
        maxInputChars,
        mailExtras,
        Boolean(redactPromptPII)
      );
      userMessage = {
        role: "user",
        content: `Extrahiere strukturierte Angebots-/Anfrage-Daten aus diesem Dokument (gesamtes JSON-Schema, snake_case):\n\nDateiname: ${fileName}\n\nInhalt:\n${safeText}`,
      };
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: DOCUMENT_EXTRACTION_SYSTEM_PROMPT },
      ...fewShotMessages,
      userMessage,
    ];

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 4096,
      });
      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) throw new Error("No response from OpenAI");

      const parsed = JSON.parse(responseText) as DocumentExtraction;
      normalizeDocumentExtractionInPlace(parsed);
      applyExtractionPostValidation(parsed);
      const normalized = translateDocumentExtractionToLegacy(parsed) as ExtractedOfferData;

      if (debugStore) {
        await writeAIDebugSnapshot(
          {
            type: "offer_extraction_openai",
            fileName,
            mimeType,
            response: normalized,
          },
          "offer-openai"
        );
      }

      return normalized;
    } catch (error: any) {
      if (mode === "openai_only") {
        console.error("Offer extraction error:", error);
        throw new Error(`Failed to extract offer data: ${error.message}`);
      }
      console.warn("[Offer Extraction] OpenAI failed, falling back to local extraction:", error);
    }
  }

  const localText = await readPrimaryDocumentText();
  const normalizedText = mergeDraftExtractionSources(
    localText,
    maxInputChars,
    mailExtras,
    Boolean(redactPromptPII)
  );
  const localData = localExtractOfferData(normalizedText);
  const normalized = normalizeExtractedData(localData);

  if (debugStore) {
    await writeAIDebugSnapshot(
      {
        type: "offer_extraction_local",
        fileName,
        mimeType,
        inputPreview: redactPII(normalizedText).slice(0, 2000),
        response: normalized,
      },
      "offer-local"
    );
  }

  return normalized;
}

function localExtractOfferData(text: string): ExtractedOfferData {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/\+?\d[\d\s()./-]{6,}\d/);

  const address = extractAddress(lines);
  const lineItems = extractLineItems(lines) || [];
  const validUntil = extractValidUntil(text);

  return {
    customer: {
      email: emailMatch?.[0],
      phone: phoneMatch?.[0],
    },
    billingAddress: address,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
    validUntil,
  };
}

function extractAddress(lines: string[]): ExtractedOfferData["billingAddress"] | undefined {
  const streetLine = lines.find((line) => /straße|str\.|street|weg|allee|platz|ring/i.test(line));
  const zipCityLine = lines.find((line) => /\b\d{4,5}\b\s+[A-Za-zÄÖÜäöüß-]/.test(line));
  if (!streetLine && !zipCityLine) return undefined;

  let zipCode: string | undefined;
  let city: string | undefined;
  if (zipCityLine) {
    const match = zipCityLine.match(/(\d{4,5})\s+(.+)/);
    if (match) {
      zipCode = match[1];
      city = match[2];
    }
  }

  return {
    street: streetLine,
    zipCode,
    city,
    country: lines.find((line) => /deutschland|germany|österreich|austria|schweiz|switzerland/i.test(line)),
  };
}

function extractLineItems(lines: string[]): ExtractedOfferData["lineItems"] {
  const items: ExtractedOfferData["lineItems"] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\s*(x|stk|stück|pcs|pc|st\.)?\s+(.+)/i);
    if (!match) continue;
    const quantity = Number(match[1]);
    const rest = match[3].trim();
    const priceMatch = rest.match(/(\d+[.,]\d{2})/);
    const price = priceMatch ? Number(priceMatch[1].replace(",", ".")) : undefined;
    items.push({
      extractedProductName: rest,
      extractedProductNumber: extractProductNumberFromLineRest(rest),
      quantity,
      extractedPrice: price,
    });
  }
  return items;
}

function extractValidUntil(text: string): string | undefined {
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) return isoMatch[0];

  const deMatch = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (deMatch) {
    const day = deMatch[1].padStart(2, "0");
    const month = deMatch[2].padStart(2, "0");
    const year = deMatch[3].length === 2 ? `20${deMatch[3]}` : deMatch[3];
    return `${year}-${month}-${day}`;
  }

  const durationMatch = text.match(/(\d+)\s*(tage|tag)\s*gültig/i);
  if (durationMatch) {
    const days = Number(durationMatch[1]);
    if (!Number.isNaN(days)) {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
    }
  }

  return undefined;
}

function isLowQualityLocalOffer(data: ExtractedOfferData): boolean {
  if (!data.lineItems || data.lineItems.length === 0) return true;
  const hasAnyEmail = !!data.customer?.email;
  const hasAnyAddress = !!data.billingAddress?.street;
  return !hasAnyEmail && !hasAnyAddress;
}

/** Minimales Parse nach LLM/lokaler Extraktion — Post-Processing läuft in commercialExtractionOrchestrator. */
function normalizeExtractedData(data: ExtractedOfferData): ExtractedOfferData {
  if (data.lineItems && !Array.isArray(data.lineItems)) {
    data.lineItems = Object.values(data.lineItems as any);
  }
  const trimStrings = (obj: any): any => {
    if (typeof obj === "string") return obj.trim();
    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, trimStrings(v)]));
    }
    if (Array.isArray(obj)) return obj.map(trimStrings);
    return obj;
  };
  return trimStrings(data) as ExtractedOfferData;
}
