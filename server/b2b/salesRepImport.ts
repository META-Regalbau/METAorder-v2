/**
 * Außendienst-Zuordnung (Kundennummer → META-Außendienst) aus Excel oder CSV lesen.
 * Spalten werden über ihre Überschrift erkannt; Reihenfolge und weitere Spalten sind egal.
 */
import * as XLSX from "xlsx";
import type { SalesRepAssignment } from "@shared/portalRegistrations";

const NUMBER_HEADERS = ["kundennummer", "kundennr", "kdnr", "debitor", "debitorennummer", "debitornr", "customernumber", "customerno", "kunde"];
const EMAIL_HEADERS = ["email", "emailaussendienst", "aussendienstemail", "aussendienstmail", "mail", "vertreteremail", "ademail", "emailadresse"];
const NAME_HEADERS = ["aussendienst", "aussendienstname", "vertreter", "betreuer", "salesrep", "mitarbeiter", "name"];
/** Firmen-/Kundenspalten sind nie der Name des Außendienstes */
const NOT_A_REP_NAME = (key: string) => key.startsWith("kunde") || key.startsWith("firma") || key.startsWith("customer");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function headerKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function pickColumn(headers: string[], wanted: string[], skip: (key: string) => boolean = () => false): number {
  const keys = headers.map((h) => {
    const k = headerKey(h);
    return skip(k) ? "\u0000" : k;
  });
  for (const w of wanted) {
    const idx = keys.indexOf(w);
    if (idx >= 0) return idx;
  }
  // „E-Mail Außendienst (dienstlich)“ o. Ä.
  for (const w of wanted) {
    const idx = keys.findIndex((k) => k.startsWith(w) || k.includes(w));
    if (idx >= 0) return idx;
  }
  return -1;
}

export type SalesRepImportResult = {
  rows: SalesRepAssignment[];
  errors: Array<{ rowNumber: number; message: string }>;
  /** Spaltenüberschriften, wie sie erkannt wurden */
  columns: { customerNumber: string | null; email: string | null; name: string | null };
};

export function parseSalesRepRows(table: unknown[][]): SalesRepImportResult {
  const headerRowIdx = table.findIndex((row) => row.some((c) => String(c ?? "").trim() !== ""));
  if (headerRowIdx < 0) return { rows: [], errors: [{ rowNumber: 1, message: "Datei ist leer" }], columns: { customerNumber: null, email: null, name: null } };
  const headers = table[headerRowIdx].map((c) => String(c ?? "").trim());
  const numberCol = pickColumn(headers, NUMBER_HEADERS);
  const emailCol = pickColumn(headers, EMAIL_HEADERS, NOT_A_REP_NAME);
  // Name-Spalte nicht mit der E-Mail-Spalte verwechseln („Außendienst E-Mail“)
  const nameCol = pickColumn(headers, NAME_HEADERS, (k) => NOT_A_REP_NAME(k) || headerKey(headers[emailCol] ?? "") === k);
  const columns = {
    customerNumber: numberCol >= 0 ? headers[numberCol] : null,
    email: emailCol >= 0 ? headers[emailCol] : null,
    name: nameCol >= 0 ? headers[nameCol] : null,
  };
  const errors: SalesRepImportResult["errors"] = [];
  if (numberCol < 0 || emailCol < 0) {
    errors.push({ rowNumber: headerRowIdx + 1, message: "Spalten „Kundennummer“ und „E-Mail“ nicht gefunden" });
    return { rows: [], errors, columns };
  }
  const byNumber = new Map<string, SalesRepAssignment>();
  for (let i = headerRowIdx + 1; i < table.length; i++) {
    const row = table[i];
    const rowNumber = i + 1;
    const rawNumber = String(row[numberCol] ?? "").trim();
    const email = String(row[emailCol] ?? "").trim().toLowerCase();
    if (!rawNumber && !email) continue;
    // Excel macht aus 20000016175 gern 2.0000016175E10 – Zahlen deshalb ganzzahlig lesen
    const customerNumber = typeof row[numberCol] === "number" ? String(Math.round(row[numberCol] as number)) : rawNumber.replace(/\s+/g, "");
    if (!customerNumber) {
      errors.push({ rowNumber, message: "Kundennummer fehlt" });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({ rowNumber, message: `Ungültige E-Mail „${email}“` });
      continue;
    }
    const repName = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    byNumber.set(customerNumber, { customerNumber, repEmail: email, repName });
  }
  return { rows: [...byNumber.values()], errors, columns };
}

/** xlsx (Zip) bzw. altes xls (OLE) – alles andere ist Text (CSV) */
function isSpreadsheetBinary(buffer: Buffer): boolean {
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  return zip || ole;
}

/** CSV als Text: UTF-8 (mit/ohne BOM), sonst Windows-1252 (Excel „CSV (Trennzeichen-getrennt)“) */
export function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1252").decode(buffer);
}

export function parseSalesRepFile(buffer: Buffer): SalesRepImportResult {
  // SheetJS liest CSV-Puffer nicht als UTF-8 – Umlaute in Überschriften („Außendienst“) gingen verloren
  const workbook = isSpreadsheetBinary(buffer)
    ? XLSX.read(buffer, { type: "buffer", raw: false })
    : XLSX.read(decodeCsv(buffer), { type: "string", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], errors: [{ rowNumber: 1, message: "Kein Tabellenblatt" }], columns: { customerNumber: null, email: null, name: null } };
  const table = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
  return parseSalesRepRows(table);
}
