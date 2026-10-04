import * as XLSX from "xlsx";
import { z } from "zod";
import {
  parsePortalUserType,
  parseSupervisorFlag,
  type B2BPortalUserType,
  type CreateB2BPortalUserInput,
} from "./b2bPortalUserService";

export type ParsedB2BPortalUserImportRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  type?: B2BPortalUserType;
  isSupervisor?: boolean;
};

export type ParsedB2BPortalUserImport = {
  rows: ParsedB2BPortalUserImportRow[];
  parseErrors: Array<{ rowNumber: number; message: string }>;
};

function readCell(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function parseB2BPortalUserRowsFromBuffer(buffer: Buffer): ParsedB2BPortalUserImport {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel-Datei enthält kein Tabellenblatt");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]);
  const rows: ParsedB2BPortalUserImportRow[] = [];
  const parseErrors: Array<{ rowNumber: number; message: string }> = [];
  const seenEmails = new Set<string>();

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const firstName = readCell(row, ["Vorname", "First Name", "firstName", "first_name"]);
    const lastName = readCell(row, ["Nachname", "Last Name", "lastName", "last_name"]);
    const email = readCell(row, ["E-Mail", "Email", "email", "E-Mailadresse"]).toLowerCase();
    const typeRaw = readCell(row, ["Typ", "Type", "type", "Kontotyp"]);
    const supervisorRaw = readCell(row, ["Supervisor", "supervisor", "Ist Supervisor", "isSupervisor"]);

    if (!firstName && !lastName && !email) {
      return;
    }

    if (!firstName || !lastName || !email) {
      parseErrors.push({
        rowNumber,
        message: "Vorname, Nachname und E-Mail sind Pflichtfelder",
      });
      return;
    }

    const emailResult = z.string().email().safeParse(email);
    if (!emailResult.success) {
      parseErrors.push({ rowNumber, message: "Ungültige E-Mail-Adresse" });
      return;
    }

    if (seenEmails.has(email)) {
      parseErrors.push({ rowNumber, message: "E-Mail ist in der Datei doppelt vorhanden" });
      return;
    }
    seenEmails.add(email);

    const parsedType = typeRaw ? parsePortalUserType(typeRaw) : undefined;
    if (typeRaw && !parsedType) {
      parseErrors.push({
        rowNumber,
        message: `Unbekannter Typ "${typeRaw}" (erwartet: Unternehmen, Händler, Vertriebsmitarbeiter)`,
      });
      return;
    }

    rows.push({
      rowNumber,
      firstName,
      lastName,
      email,
      type: parsedType ?? undefined,
      isSupervisor: supervisorRaw ? parseSupervisorFlag(supervisorRaw) : undefined,
    });
  });

  return { rows, parseErrors };
}

export function buildPortalUserInputsFromImport(
  parsed: ParsedB2BPortalUserImport,
  defaults: {
    password: string;
    defaultType: B2BPortalUserType;
    defaultSupervisor: boolean;
    groupIdByType: Record<B2BPortalUserType, string>;
    salesChannelId: string;
    address: CreateB2BPortalUserInput["address"];
    metaCompanyCustomerId?: string;
    supervisorRoleId?: string;
  },
): CreateB2BPortalUserInput[] {
  return parsed.rows.map((row) => {
    const type = row.type ?? defaults.defaultType;
    const isSupervisor = type === "sales_rep" ? (row.isSupervisor ?? defaults.defaultSupervisor) : false;
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      password: defaults.password,
      type,
      isSupervisor,
      groupId: defaults.groupIdByType[type],
      salesChannelId: defaults.salesChannelId,
      address: defaults.address,
      metaCompanyCustomerId: type === "sales_rep" ? defaults.metaCompanyCustomerId : undefined,
      supervisorRoleId: type === "sales_rep" && isSupervisor ? defaults.supervisorRoleId : undefined,
    };
  });
}

export function buildB2BPortalUserTemplateBuffer(): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Vorname", "Nachname", "E-Mail", "Typ", "Supervisor"],
    ["Max", "Mustermann", "max.mustermann@example.com", "Vertriebsmitarbeiter", "Nein"],
    ["Erika", "Musterfrau", "erika.musterfrau@example.com", "Unternehmen", ""],
    ["Hans", "Haendler", "hans.haendler@example.com", "Händler", ""],
  ]);
  worksheet["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 32 }, { wch: 22 }, { wch: 12 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "B2B Nutzer");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
