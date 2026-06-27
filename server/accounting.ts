import { parse } from "csv-parse/sync";
import OpenAI from "openai";
import type { Order } from "@shared/schema";
import type { AIMode } from "./aiConfig";
import { sanitizeDocumentText, truncateText } from "./aiTextUtils";

export type AccountingEntry = {
  id: string;
  date?: string | null;
  amount?: number | null;
  reference?: string | null;
  description?: string | null;
  rawKeys?: string[];
};

export type AccountingMatch = {
  id: string;
  status: "matched" | "partial" | "unmatched";
  reference?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  date?: string | null;
  description?: string | null;
  reason?: string | null;
  debug?: {
    matchedBy?: "orderNumber" | "invoiceNumber" | "amountDate" | "none";
    normalizedReference?: string;
    entry?: {
      date?: string | null;
      amount?: number | null;
      reference?: string | null;
      description?: string | null;
      rawKeys?: string[];
    };
    aiHints?: {
      orderNumber?: string | null;
      invoiceNumber?: string | null;
      amount?: number | null;
      date?: string | null;
    };
  };
};

const toNumber = (value?: string | number | null): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/[^\d,.\-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    normalized = cleaned.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeReference = (value?: string | null): string => {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
};

const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const deMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (deMatch) {
    const [, day, month, year] = deMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const shortYearMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})/);
  if (shortYearMatch) {
    const [, day, month, year] = shortYearMatch;
    const fullYear = Number(year) + 2000;
    return new Date(fullYear, Number(month) - 1, Number(day));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const pickValue = (row: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  const normalizedMap = Object.keys(row).reduce<Record<string, string>>((acc, key) => {
    acc[normalizeKey(key)] = key;
    return acc;
  }, {});
  for (const key of keys) {
    const normalized = normalizeKey(key);
    const mapped = normalizedMap[normalized];
    if (mapped && row[mapped] !== undefined && row[mapped] !== null && row[mapped] !== "") {
      return row[mapped];
    }
  }
  return null;
};

const detectDelimiter = (text: string) => {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) || "";
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > semicolons && tabs > commas) return "\t";
  if (semicolons > commas) return ";";
  return ",";
};

export function parseCsv(buffer: Buffer): AccountingEntry[] {
  const text = buffer.toString("utf-8");
  const delimiter = detectDelimiter(text);
  const records: any[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
    delimiter,
  });
  return records.map((row, index) => {
    const date = pickValue(row, [
      "date",
      "Date",
      "Buchungsdatum",
      "Buchungstag",
      "Buchung",
      "Valuta",
      "Valutadatum",
      "Datum",
    ]);
    const amount =
      toNumber(pickValue(row, ["amount", "Betrag", "Amount", "Umsatz", "Betrag (EUR)", "Betrag(EUR)"])) ??
      toNumber(pickValue(row, ["Haben"])) ??
      (toNumber(pickValue(row, ["Soll"])) !== null
        ? Math.abs(toNumber(pickValue(row, ["Soll"])) as number)
        : null);
    const reference = pickValue(row, [
      "reference",
      "Referenz",
      "Ref",
      "orderNumber",
      "Bestellnummer",
      "invoiceNumber",
      "Rechnungsnummer",
      "Kundenreferenz",
      "End-to-End-Referenz",
      "EndToEnd",
      "Betreff",
      "Betreff/Referenz",
    ]);
    const description = pickValue(row, [
      "description",
      "Verwendungszweck",
      "Buchungstext",
      "Buchungstext 1",
      "Buchungstext1",
      "Buchungstext 2",
      "Buchungstext2",
      "Beschreibung",
      "Empfänger",
      "Zahlungsempfänger",
      "Beguenstigter",
      "Begünstigter",
      "Betreff",
      "Name",
    ]);

    return {
      id: String(pickValue(row, ["id", "ID"]) || reference || index),
      date: date ?? null,
      amount,
      reference: reference ?? null,
      description: description ?? null,
      rawKeys: Object.keys(row),
    };
  });
}

export async function parsePdf(buffer: Buffer): Promise<AccountingEntry[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const pdfData = await parser.getText();
  await parser.destroy();
  const text = pdfData.text || "";
  return [
    {
      id: `pdf-${Date.now()}`,
      description: text.slice(0, 2000),
      reference: null,
      amount: null,
      date: null,
    },
  ];
}

export function matchEntries(
  entries: AccountingEntry[],
  orders: Order[],
  options?: {
    debug?: boolean;
    aiHintsById?: Record<string, {
      orderNumber?: string | null;
      invoiceNumber?: string | null;
      amount?: number | null;
      date?: string | null;
    }>;
  }
) {
  return entries.map((entry) => {
    const haystack = normalizeReference(`${entry.reference || ""} ${entry.description || ""}`);
    const orderByNumber: Order | undefined = entry.reference || entry.description
      ? orders.find((order) => haystack.includes(normalizeReference(order.orderNumber)))
      : undefined;
    const orderByInvoice: Order | undefined = entry.reference || entry.description
      ? orders.find((order) => order.invoiceNumber && haystack.includes(normalizeReference(order.invoiceNumber)))
      : undefined;

    const orderByAmountDate = orders.find((order) => {
      if (!entry.amount || !entry.date) return false;
      const amountMatch = Math.abs(order.totalAmount - entry.amount) <= 1;
      const entryDate = parseDate(entry.date);
      const orderDate = parseDate(order.orderDate);
      const dateMatch = entryDate && orderDate
        ? Math.abs(orderDate.getTime() - entryDate.getTime()) <= 3 * 24 * 60 * 60 * 1000
        : false;
      return amountMatch && dateMatch;
    });

    const matchedOrder = orderByNumber || orderByInvoice || orderByAmountDate;
    const matchedBy: NonNullable<AccountingMatch["debug"]>["matchedBy"] = orderByNumber
      ? "orderNumber"
      : orderByInvoice
        ? "invoiceNumber"
        : orderByAmountDate
          ? "amountDate"
          : "none";
    const debug = options?.debug ? {
      matchedBy,
      normalizedReference: haystack || undefined,
      entry: {
        date: entry.date ?? null,
        amount: entry.amount ?? null,
        reference: entry.reference ?? null,
        description: entry.description ?? null,
        rawKeys: entry.rawKeys,
      },
      aiHints: options?.aiHintsById?.[entry.id],
    } : undefined;
    if (matchedOrder) {
      return {
        id: entry.id,
        status: "matched",
        reference: entry.reference,
        orderId: matchedOrder.id,
        orderNumber: matchedOrder.orderNumber,
        invoiceNumber: matchedOrder.invoiceNumber,
        amount: entry.amount,
        date: entry.date,
        description: entry.description,
        debug,
      } satisfies AccountingMatch;
    }

    return {
      id: entry.id,
      status: entry.reference ? "partial" : "unmatched",
      reference: entry.reference,
      orderNumber: (orderByNumber as Order | undefined)?.orderNumber || null,
      invoiceNumber: (orderByInvoice as Order | undefined)?.invoiceNumber || null,
      amount: entry.amount,
      date: entry.date,
      description: entry.description,
      reason: entry.reference ? "no_order_match" : "no_reference",
      debug,
    } satisfies AccountingMatch;
  });
}

export async function enrichEntriesWithAI(
  entries: AccountingEntry[],
  options: {
    mode: AIMode;
    openaiClient?: OpenAI | null;
    maxInputChars: number;
  }
): Promise<{
  entries: AccountingEntry[];
  aiHintsById: Record<string, {
    orderNumber?: string | null;
    invoiceNumber?: string | null;
    amount?: number | null;
    date?: string | null;
  }>;
}> {
  const { mode, openaiClient, maxInputChars } = options;
  if (mode === "local_only" || !openaiClient) {
    return { entries, aiHintsById: {} };
  }

  const enriched: AccountingEntry[] = [];
  const aiHintsById: Record<string, {
    orderNumber?: string | null;
    invoiceNumber?: string | null;
    amount?: number | null;
    date?: string | null;
  }> = {};
  for (const entry of entries) {
    if (entry.reference || !entry.description) {
      enriched.push(entry);
      continue;
    }

    const hints = await extractAccountingHintsFromText(entry.description, {
      openaiClient,
      maxInputChars,
    });
    aiHintsById[entry.id] = hints;
    enriched.push({
      ...entry,
      reference: entry.reference || hints.orderNumber || hints.invoiceNumber || null,
      amount: entry.amount ?? hints.amount ?? null,
      date: entry.date ?? hints.date ?? null,
    });
  }

  return { entries: enriched, aiHintsById };
}

async function extractAccountingHintsFromText(
  text: string,
  options: {
    openaiClient: OpenAI;
    maxInputChars: number;
  }
): Promise<{
  orderNumber?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  date?: string | null;
}> {
  const safeText = truncateText(sanitizeDocumentText(text), options.maxInputChars);
  const systemPrompt = `Du extrahierst Zahlungsinformationen aus Buchungstexten.
Gib NUR JSON zurück mit:
{
  "orderNumber": "...",
  "invoiceNumber": "...",
  "amount": 123.45,
  "date": "YYYY-MM-DD"
}
Wenn etwas fehlt, Feld weglassen.`;

  const completion = await options.openaiClient.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Text:\n${safeText}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 300,
  });

  const responseText = completion.choices[0]?.message?.content;
  if (!responseText) return {};
  try {
    const parsed = JSON.parse(responseText);
    return {
      orderNumber: parsed.orderNumber ?? null,
      invoiceNumber: parsed.invoiceNumber ?? null,
      amount: typeof parsed.amount === "number" ? parsed.amount : toNumber(parsed.amount ?? null),
      date: parsed.date ?? null,
    };
  } catch {
    return {};
  }
}
