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
import { extractPlainTextForDraft, normalizeMimeTypeForDraft } from "./documentTextExtraction";
import { extractOrderDataWithPdfVision, isOrderPdfTextInsufficient } from "./orderPdfVisionExtraction";
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

export interface ExtractedOrderData {
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
    /** Zeilen-/Positionsindex aus dem Dokument (z. B. 10, 20, 0010) — nicht die bestellte Menge. */
    extractedPositionNumber?: string;
    extractedProductNumber?: string;
    quantity: number;
    extractedPrice?: number;
  }>;
  orderNotes?: string;
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
const EXTRACTION_SYSTEM_PROMPT_LEGACY = `Du bist ein Experte für die Extraktion von Bestellinformationen aus Dokumenten.
Deine Aufgabe ist es, aus hochgeladenen PDFs, E-Mails oder Bildern folgende Informationen zu extrahieren:

Der Nutzer-Text kann markierte Abschnitte enthalten: [Hauptdokument], [E-Mail derselben Anfrage], [Weitere PDF-Auszüge derselben E-Mail]. Nutze ALLE Quellen — Bestelldetails stehen oft im E-Mail-Text oder in einem weiteren Anhang.

1. Kundendaten (Name, E-Mail, Telefon, Firma)
2. Rechnungsadresse
3. Lieferadresse (falls abweichend von Rechnungsadresse)
4. Bestellte Artikel mit Produktbezeichnung, Menge, ggf. Artikelnummer und ggf. Positionsnummer (nicht jede Bestellung hat Positionsnummern)
5. Zusätzliche Notizen oder Hinweise

WICHTIG - Kundendaten:
- Extrahiere IMMER "firstName" und "lastName" aus dem Dokument wenn vorhanden (egal ob Firma oder Privatperson)
- Bei Firmenkunden: Extrahiere auch den Firmennamen in "company"
- E-Mail des KUNDEN (Bestellers): Bei weitergeleiteten E-Mails nicht nur den Absender der äußeren Mail verwenden — bevorzuge die Adresse aus dem weitergeleiteten Teil („Von:“ / „From:“ / „Reply-To:“ der Originalnachricht) oder aus der Kundensignatur bzw. dem Angebot/PDF.
- Signatur unterhalb der Grußformel (Mit freundlichen Grüßen / Best regards …) enthält häufig Firma, Name und Adresse — gezielt auswerten, wenn der Fließtext oben wenig Kundendaten hat.

WICHTIG - Adressen (strikt trennen):
- "street": NUR Straßenname und Hausnummer, OHNE PLZ und OHNE Ort am Ende.
- "zipCode": nur die PLZ (4–5 Ziffern typisch).
- "city": nur der Ortsname.
- Zeilen wie „Musterstraße 1, 12345 Ort“ immer in die drei Felder zerlegen — nicht die komplette Adresse nur in "street" oder in lineItems.
- Postadressen und Signaturen niemals als lineItems ausgeben.

WICHTIG - Adressen (Rollen):
- Bei FIRMENKUNDEN: derselbe Firmenname in "customer.company", "billingAddress.company" und ggf. "shippingAddress.company"
- Bei FIRMENKUNDEN: "company" ist PFLICHT für billingAddress/shippingAddress
- Bei FIRMENKUNDEN: "firstName" und "lastName" in Adressen NUR wenn sie dort explizit stehen (oft leer bei Firmenbestellungen)
- Bei PRIVATKUNDEN: "firstName" und "lastName" sind Pflicht in Adressen
- "country" jeweils NUR Staatsname — keine PLZ, kein Ort, keine Straße in diesem Feld
- Telefonnummer, die explizit bei der Rechnungs- oder Lieferadresse steht (nicht nur in der Signatur): in "billingAddress.phone" bzw. "shippingAddress.phone" übernehmen — getrennt von "customer.phone", wenn beides vorkommt.
- Wenn eine Lieferadresse nicht explizit angegeben ist, kopiere die Rechnungsadresse

WICHTIG - Produkte:
- "lineItems" nur für bestellte Artikel — keine Adresszeilen, keine Signatur, keine reinen Kontaktangaben.
- "lineItems" MUSS ein Array sein: [...], NIEMALS ein Objekt: {...}
- Jedes lineItem muss "extractedProductName" und "quantity" enthalten
- Positionsnummer (Pos., Pos.-Nr., Position, PosNr, Zeilennummer): oft eine kurze Ziffernfolge oder SAP-typische Staffel (10, 20, 30 …). In "extractedPositionNumber" speichern (String, wie im Dokument, z. B. "0010" oder "20"). **Niemals** die Positionsnummer in "quantity" schreiben — "quantity" ist ausschließlich die **bestellte Stückzahl** (oft mit Spalte „Menge“, „Stk“, „Stück“, „x“).
- **Positionsnummer vs. Menge (kritisch):** Werte wie **00001**, **00002** oder **10 / 20 / 30** in der **ersten** Tabellenzeile einer Position sind fast immer **Positionsindex**, nicht bestellte Stückzahl. Die echte Menge steht oft in der **zweiten** Zeile derselben Position (z. B. „19 Stück“). **Nicht** quantity=1 aus „00001“ ableiten, wenn in der Folgezeile „19 Stück“ o. Ä. steht.
- Positionsnummern fehlen bei vielen Bestellungen: Feld "extractedPositionNumber" dann **weglassen** (nicht raten, nicht null).
- Artikelnummern / EAN / GTIN: In PDFs und E-Mails stehen Barcodes oft mit Leerzeichen oder Bindestrichen gruppiert (z. B. „4032 9812345678“). Bei reinen GTIN/EAN-Feldern liefere extractedProductNumber immer als durchgehende Ziffernfolge ohne Leerzeichen (nur 0–9), alle Ziffern erhalten. Alphanumerische Herstellernummern (z. B. „META-AB-123“) wie im Dokument, ohne künstliche Umformatierung. **extractedProductNumber** ist die Artikel-/EAN-Nummer, nicht die Positionsnummer.
- **Mehrzeilige Tabellen / ein Artikel über mehrere Zeilen:** Häufig z. B. **erste Zeile:** Positionsnummer (z. B. 00001), GTIN, Produktbezeichnung — **zweite Zeile darunter:** Menge mit Einheit („19 Stück“), Einzelpreis, Zeilensumme. Spalten können versetzt sein oder ohne klare Gitterlinien. Gehört logisch zusammen → **genau ein** lineItem; Felder aus allen zugehörigen Zeilen zusammenführen. **Nicht** zwei lineItems erzeugen, wenn es dieselbe Position/GTIN fortsetzt. Andere Layouts (drei Zeilen, andere Reihenfolge) analog: eine bestellte Position = ein Array-Eintrag.
- **Streng verboten bei Fortsetzungszeilen:** Eine Zeile, die **nur** Menge + Einzelpreis + Zeilensumme enthält (z. B. „19 Stück … 160,06 … 3.041,14“), ist **kein** zweiter Artikel. **Niemals** Einzel- und Gesamtpreis als \`extractedProductName\` ausgeben. **Niemals** aus Preisen oder Preisfragmenten ein \`extractedProductNumber\` konstruieren (z. B. kein „06 3.041“). Bezeichnung und Artikel-/GTIN-Nummer kommen aus der **Produktzeile**; die Preiszeile liefert höchstens quantity und \`extractedPrice\` (Einzelpreis).
- **Konkretes Muster (META-ähnliche Bestelltabellen):** Zeile A: „00001  4026212260212  Steckregal META CLIP 150 S“ — Zeile B: „19 Stück  160,06  3.041,14“. **Richtig — ein** lineItem: extractedPositionNumber „00001“, extractedProductNumber „4026212260212“, extractedProductName „Steckregal META CLIP 150 S“ (oder mit GTIN vorne, wenn im Dokument so zusammengehört), quantity **19**, extractedPrice **160.06**. Zeilensumme 3041.14 **nicht** in Name/Nummer packen. **Falsch:** zwei lineItems; erstes mit quantity 1 statt Positionsnummer; zweites mit Name „160,06 3.041,14“ oder erfundener extractedProductNumber — so nicht.
- **Deutsche Zahlen:** Schreibweise oft „1.234,56“ (Punkt = Tausender, Komma = Dezimal). In JSON für \`extractedPrice\` und ähnliche Zahlen **Punkt als Dezimal** verwenden (z. B. 160.06 und 3041.14). Wenn Einzel- und Gesamtpreis erkennbar: \`extractedPrice\` = **Stück-/Einzelpreis**; wenn nur ein Betrag pro Position vorliegt, diesen als extractedPrice.
- Bei Mengenangaben: Wandle Texte wie "zwei" → 2 um

WICHTIG - Fehlende Daten:
- Felder die nicht im Dokument vorhanden sind: KOMPLETT WEGLASSEN (nicht als leeren String "")
- Nur tatsächlich vorhandene Informationen extrahieren
- Bei unklaren Informationen: Feld weglassen statt zu raten

Antworte ausschließlich mit einem validen JSON-Objekt im folgenden Format:

Beispiel FIRMENKUNDE:
{
  "customer": {
    "email": "c.gigl@firma.de",
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
  "shippingAddress": {
    "company": "Musterfirma GmbH",
    "street": "Lieferstraße 456",
    "zipCode": "54321",
    "city": "Lieferstadt",
    "country": "Deutschland"
  },
  "lineItems": [
    {
      "extractedPositionNumber": "20",
      "extractedProductName": "Produktname XYZ",
      "extractedProductNumber": "ART-12345",
      "quantity": 2,
      "extractedPrice": 49.99
    }
  ],
  "orderNotes": "Zusätzliche Hinweise"
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
      "quantity": 1
    }
  ]
}`;

/**
 * Extract order data from a document using OpenAI GPT-4o Vision
 * Supports PDFs, images, and email text
 */
export async function extractOrderDataFromDocument(
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
    primaryDocumentText?: string | null;
  } & DraftExtractionMailContext
): Promise<ExtractedOrderData> {
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

  /** Multer/Browser: PDF oft `application/octet-stream` — PDF-Vision prüfte bisher nur exakt `application/pdf`. */
  const effectiveMime = normalizeMimeTypeForDraft(fileName, mimeType);

  let cachedPrimaryDocumentText: string | null = primaryDocumentText ?? null;
  const readPrimaryDocumentText = async () => {
    if (cachedPrimaryDocumentText != null) return cachedPrimaryDocumentText;
    cachedPrimaryDocumentText = await extractPlainTextForDraft({
      fileBuffer,
      mimeType: effectiveMime,
      fileName,
      ocrEnabled,
    });
    return cachedPrimaryDocumentText;
  };
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

  const pdfNeedsVision =
    effectiveMime === "application/pdf" &&
    shouldUseOpenAI &&
    isOrderPdfTextInsufficient(await readPrimaryDocumentText());

  // Local-first for optional mode
  if (mode === "openai_optional" && !pdfNeedsVision) {
    const localText = await readPrimaryDocumentText();
    const normalizedText = mergeDraftExtractionSources(
      localText,
      maxInputChars,
      mailExtras,
      Boolean(redactPromptPII)
    );
    const localData = normalizeExtractedData(localExtractOrderData(normalizedText));
    const lowQuality = isLowQualityLocalOrder(localData);

    if (!lowQuality) {
      if (debugStore) {
        await writeAIDebugSnapshot(
          {
            type: "order_extraction_local_preferred",
            fileName,
            mimeType: effectiveMime,
            inputPreview: redactPII(normalizedText).slice(0, 2000),
            response: localData,
          },
          "order-local-preferred"
        );
      }
      return localData;
    }
  }

  // OpenAI path — META-aware Schema (Snake-Case) → Legacy-Translator
  if (shouldUseOpenAI) {
    const openai = openaiClient!;
    const fewShots = await getCachedDocumentExtractionFewShots();
    const fewShotMessages = buildFewShotChatMessages(fewShots) as ChatCompletionMessageParam[];

    const runChatDocumentExtraction = async (
      userMessage: ChatCompletionMessageParam
    ): Promise<ExtractedOrderData> => {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: DOCUMENT_EXTRACTION_SYSTEM_PROMPT },
        ...fewShotMessages,
        userMessage,
      ];
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
      return translateDocumentExtractionToLegacy(parsed) as ExtractedOrderData;
    };

    if (effectiveMime.startsWith("image/")) {
      const base64Image = fileBuffer.toString("base64");
      const contextPrefix = mailExtras
        ? `${mergeEmailAndSiblingExcerptsOnly(maxInputChars, mailExtras, Boolean(redactPromptPII))}\n\n`
        : "";
      const userMessage: ChatCompletionMessageParam = {
        role: "user",
        content: [
          {
            type: "text",
            text: `${contextPrefix}Extrahiere strukturierte Bestelldaten aus diesem Bild (gesamtes JSON-Schema, snake_case):`,
          },
          {
            type: "image_url",
            image_url: { url: `data:${effectiveMime};base64,${base64Image}`, detail: "high" },
          },
        ],
      };
      try {
        const normalized = await runChatDocumentExtraction(userMessage);
        if (debugStore) {
          await writeAIDebugSnapshot(
            {
              type: "order_extraction_openai",
              fileName,
              mimeType: effectiveMime,
              response: normalized,
            },
            "order-openai"
          );
        }
        return normalized;
      } catch (error: any) {
        if (mode === "openai_only") {
          console.error("Order extraction error:", error);
          throw new Error(`Failed to extract order data: ${error.message}`);
        }
        console.warn("[Order Extraction] OpenAI failed, falling back to local extraction:", error);
      }
    } else if (pdfNeedsVision) {
      try {
        const mailOnly = mergeEmailAndSiblingExcerptsOnly(
          maxInputChars,
          mailExtras,
          Boolean(redactPromptPII)
        );
        const extraction = await extractOrderDataWithPdfVision({
          openai,
          fileBuffer,
          fileName,
          systemPrompt: DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
          mailContextText: mailOnly,
          fewShotMessages: fewShots,
        });
        normalizeDocumentExtractionInPlace(extraction);
        applyExtractionPostValidation(extraction);
        const normalized = translateDocumentExtractionToLegacy(extraction) as ExtractedOrderData;
        if (debugStore) {
          await writeAIDebugSnapshot(
            {
              type: "order_extraction_pdf_vision",
              fileName,
              mimeType: effectiveMime,
              response: normalized,
            },
            "order-pdf-vision"
          );
        }
        return normalized;
      } catch (error: any) {
        if (mode === "openai_only") {
          console.error("Order PDF-Vision extraction error:", error);
          throw new Error(`Failed to extract order data from PDF: ${error.message}`);
        }
        console.warn(
          "[Order Extraction] PDF-Vision fehlgeschlagen, nutze Text-Chat als Fallback:",
          error
        );
      }
    }

    const textContent = await readPrimaryDocumentText();
    const safeText = mergeDraftExtractionSources(
      textContent,
      maxInputChars,
      mailExtras,
      Boolean(redactPromptPII)
    );
    const userMessage: ChatCompletionMessageParam = {
      role: "user",
      content: `Extrahiere strukturierte Bestelldaten aus diesem Dokument (gesamtes JSON-Schema, snake_case):\n\nDateiname: ${fileName}\n\nInhalt:\n${safeText}`,
    };

    try {
      const normalized = await runChatDocumentExtraction(userMessage);
      if (debugStore) {
        await writeAIDebugSnapshot(
          {
            type: "order_extraction_openai",
            fileName,
            mimeType: effectiveMime,
            response: normalized,
          },
          "order-openai"
        );
      }
      return normalized;
    } catch (error: any) {
      if (mode === "openai_only") {
        console.error("Order extraction error:", error);
        throw new Error(`Failed to extract order data: ${error.message}`);
      }
      console.warn("[Order Extraction] OpenAI failed, falling back to local extraction:", error);
    }
  }

  // Local fallback
  const localText = await readPrimaryDocumentText();
  const normalizedText = mergeDraftExtractionSources(
    localText,
    maxInputChars,
    mailExtras,
    Boolean(redactPromptPII)
  );
  const localData = localExtractOrderData(normalizedText);
  const normalized = normalizeExtractedData(localData);

  if (debugStore) {
    await writeAIDebugSnapshot(
      {
        type: "order_extraction_local",
        fileName,
        mimeType: effectiveMime,
        inputPreview: redactPII(normalizedText).slice(0, 2000),
        response: normalized,
      },
      "order-local"
    );
  }

  return normalized;
}

function localExtractOrderData(text: string): ExtractedOrderData {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/\+?\d[\d\s()./-]{6,}\d/);

  const address = extractAddress(lines);
  const lineItems = extractLineItems(lines) || [];

  return {
    customer: {
      email: emailMatch?.[0],
      phone: phoneMatch?.[0],
    },
    billingAddress: address,
    shippingAddress: undefined,
    lineItems: lineItems.length > 0 ? lineItems : undefined,
  };
}

function extractAddress(lines: string[]): ExtractedOrderData["billingAddress"] | undefined {
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

function extractLineItems(lines: string[]): ExtractedOrderData["lineItems"] {
  const items: ExtractedOrderData["lineItems"] = [];
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

function isLowQualityLocalOrder(data: ExtractedOrderData): boolean {
  if (!data.lineItems || data.lineItems.length === 0) return true;
  const hasAnyEmail = !!data.customer?.email;
  const hasAnyAddress = !!data.billingAddress?.street;
  return !hasAnyEmail && !hasAnyAddress;
}

/** Minimales Parse nach LLM/lokaler Extraktion — Post-Processing läuft in commercialExtractionOrchestrator. */
function normalizeExtractedData(data: ExtractedOrderData): ExtractedOrderData {
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
  return trimStrings(data) as ExtractedOrderData;
}
