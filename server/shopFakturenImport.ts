/**
 * Gemeinsame Kernlogik fuer den Import von SAP-Rechnungsnummern in den Shop.
 *
 * Wird sowohl vom CLI-Skript (scripts/importShopFakturen.ts) als auch vom
 * HTTP-Upload-Endpoint (META Order UI) verwendet.
 *
 * Excel-Spalten:
 *   - "Faktura"         = SAP-Rechnungsnummer (z. B. 2000001071)
 *   - "Kundenreferenz"  = Shopware-Bestellnummer (z. B. MO102574)
 *   - "Fakturadatum"    = SAP-Rechnungsdatum (wird Dokumentdatum)
 *   - "Nettowert"       = 0 -> Nachlieferung (zweite Rechnung zur urspruenglichen)
 *
 * Pro Zeile:
 *   1. Bestellung anhand orderNumber (Kundenreferenz) suchen
 *   2. Rechnung in Shopware anlegen (SAP-Nummer als Dokumentnummer, SAP-Datum als Datum)
 *   3. Custom Field custom_order_numbers_invoice setzen
 * Nachlieferungen (Nettowert 0) werden immer als zweite Rechnung angelegt.
 */
import { createRequire } from "module";
import { storage } from "./storage";
import { ShopwareClient, isProformaOrVorkasse } from "./shopware";
import { sendOrderInvoice } from "./invoiceSending";

// xlsx ist ein CommonJS-Modul; im ESM-Bundle (esbuild) ist der Namespace-Import
// unzuverlaessig (readFile/read undefined). createRequire laedt das echte CJS-Modul.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

export interface FakturaRow {
  rowNumber: number;
  orderNumber: string; // Kundenreferenz (z. B. MO102574)
  invoiceNumber: string; // Faktura / SAP-Rechnungsnummer (z. B. 2000001071)
  invoiceDateIso?: string; // Fakturadatum als ISO
  invoiceDateLabel?: string;
  nettowert?: number; // Nettowert aus SAP
  isNachlieferung: boolean; // Nettowert === 0 -> Nachlieferung (zweite Rechnung)
}

export type RowStatus =
  | "would_create"
  | "would_create_nachlieferung"
  | "would_create_original"
  | "would_field_only"
  | "created"
  | "created_nachlieferung"
  | "created_original"
  | "field_only"
  | "skipped_exists"
  | "skipped_conflict"
  | "not_found"
  | "error";

export interface RowResult {
  rowNumber: number;
  orderNumber: string;
  invoiceNumber: string;
  nettowert?: number;
  isNachlieferung: boolean;
  existingNumbers?: string[];
  status: RowStatus;
  message?: string;
}

export interface FakturaImportOptions {
  apply: boolean;
  fieldOnConflict: boolean;
  skipOriginalBackfill: boolean;
  markUnsent: boolean;
  /**
   * Wenn true: die von uns angelegte bzw. zugeordnete (Primaer-)Rechnung direkt
   * ueber die Shopware-Funktion an den Kunden verschicken (Mail + sent=true).
   * Nachlieferungen (0-EUR) und echte Fremd-Konflikte werden bewusst NICHT
   * automatisch verschickt. Greift nur im Apply-Modus.
   */
  sendInvoice?: boolean;
}

export interface FakturaImportResult {
  mode: "apply" | "dry-run";
  totalRows: number;
  options: FakturaImportOptions;
  summary: Record<string, number>;
  markedUnsentCount: number;
  /** Anzahl tatsaechlich ueber die Shopware-Funktion verschickter Rechnungen. */
  sentCount: number;
  rows: RowResult[];
}

function norm(value: string): string {
  return value.toString().trim().toLowerCase();
}

function parseNettowert(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return value;
  // SAP/Excel kann Strings wie "1.906,96" oder "0" liefern
  const raw = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

function toIsoDate(value: unknown): { iso?: string; label?: string } {
  if (value == null || value === "") return {};
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { iso: value.toISOString(), label: value.toISOString().slice(0, 10) };
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return { iso: parsed.toISOString(), label: parsed.toISOString().slice(0, 10) };
  }
  return { label: String(value) };
}

function rowsFromWorkbook(wb: import("xlsx").WorkBook): FakturaRow[] {
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error("Kein Arbeitsblatt in der Excel-Datei gefunden");
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });
  if (matrix.length < 2) {
    throw new Error("Excel enthaelt keine Datenzeilen");
  }

  const header = (matrix[0] as unknown[]).map((c) => (c == null ? "" : norm(String(c))));
  const invoiceIdx = header.findIndex((h) => h === "faktura");
  const orderIdx = header.findIndex((h) => h === "kundenreferenz");
  const dateIdx = header.findIndex((h) => h === "fakturadatum");
  const netIdx = header.findIndex((h) => h === "nettowert");

  if (invoiceIdx === -1 || orderIdx === -1) {
    throw new Error(
      `Erwartete Spalten "Faktura" und "Kundenreferenz" nicht gefunden. Header: ${JSON.stringify(matrix[0])}`,
    );
  }

  const rows: FakturaRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] as unknown[];
    if (!cells || cells.length === 0) continue;

    const orderNumberRaw = cells[orderIdx];
    const invoiceNumberRaw = cells[invoiceIdx];
    const orderNumber = orderNumberRaw == null ? "" : String(orderNumberRaw).trim();
    const invoiceNumber = invoiceNumberRaw == null ? "" : String(invoiceNumberRaw).trim();

    if (!orderNumber && !invoiceNumber) continue;

    const { iso, label } = dateIdx === -1 ? {} : toIsoDate(cells[dateIdx]);
    const nettowert = netIdx === -1 ? undefined : parseNettowert(cells[netIdx]);

    rows.push({
      rowNumber: i + 1, // 1-basiert inkl. Header
      orderNumber,
      invoiceNumber,
      invoiceDateIso: iso,
      invoiceDateLabel: label,
      nettowert,
      // Nachlieferung = 0-EUR-Rechnung zur urspruenglichen Bestellung -> als zweite Rechnung anlegen
      isNachlieferung: nettowert === 0,
    });
  }

  return rows;
}

/** Liest die Faktura-Zeilen aus einem Excel-Buffer (Upload). */
export function parseFakturaRowsFromBuffer(buffer: Buffer): FakturaRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return rowsFromWorkbook(wb);
}

/** Liest die Faktura-Zeilen aus einer Excel-Datei (CLI). */
export function parseFakturaRowsFromFile(file: string): FakturaRow[] {
  const wb = XLSX.readFile(file, { cellDates: true });
  return rowsFromWorkbook(wb);
}

/**
 * Fuehrt den Import (Dry-Run oder Apply) gegen Shopware aus.
 * tenantId wird fuer das Schreiben der erp_automation_runs-Logs benoetigt.
 */
export async function runFakturaImport(
  client: ShopwareClient,
  tenantId: string | null | undefined,
  rows: FakturaRow[],
  options: FakturaImportOptions,
  log: (msg: string) => void = () => {},
): Promise<FakturaImportResult> {
  const { apply, fieldOnConflict, skipOriginalBackfill, markUnsent } = options;

  // Pro Bestellung alle SAP-Nummern aus der Excel (um zu erkennen, ob ein bereits
  // vorhandenes Rechnungsdokument eine eigene SAP-Einspielung oder eine fremde
  // Shop-Rechnung ist). Wird fuer das Anlegen einer fehlenden Originalrechnung genutzt.
  const excelNumbersByOrder = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.orderNumber || !r.invoiceNumber) continue;
    const set = excelNumbersByOrder.get(r.orderNumber) ?? new Set<string>();
    set.add(r.invoiceNumber);
    excelNumbersByOrder.set(r.orderNumber, set);
  }

  // Schreibt einen erp_automation_runs-Eintrag, damit ein evtl. spaeter aktivierter
  // ErpAutomationService-Poller diese Bestellung nicht erneut verarbeitet (keine Duplikate).
  const logRun = async (
    orderId: string,
    orderNumber: string,
    status: "success" | "skipped",
    metadata: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await storage.createErpAutomationRun(
        {
          orderId,
          orderNumber,
          trigger: "invoice_number",
          action: "create_invoice",
          status,
          metadata,
        },
        tenantId ?? undefined,
      );
    } catch (logError) {
      const message = logError instanceof Error ? logError.message : String(logError);
      log(`  ! Automation-Log fuer ${orderNumber} konnte nicht geschrieben werden: ${message}`);
    }
  };

  const results: RowResult[] = [];
  let markedUnsentCount = 0;
  const sentFlag = markUnsent ? false : true;
  // Bestellungen, deren (Primaer-)Rechnung wir ggf. ueber Shopware verschicken
  // (nur wenn options.sendInvoice && apply). orderId -> orderNumber.
  const ordersToSend = new Map<string, string>();

  for (const row of rows) {
    const base: {
      rowNumber: number;
      orderNumber: string;
      invoiceNumber: string;
      nettowert?: number;
      isNachlieferung: boolean;
      existingNumbers?: string[];
    } = {
      rowNumber: row.rowNumber,
      orderNumber: row.orderNumber,
      invoiceNumber: row.invoiceNumber,
      nettowert: row.nettowert,
      isNachlieferung: row.isNachlieferung,
    };

    if (!row.orderNumber || !row.invoiceNumber) {
      results.push({ ...base, status: "error", message: "Bestellnummer oder Rechnungsnummer fehlt" });
      continue;
    }

    try {
      // SECURITY: null = voller Admin-Zugriff (Backend ohne Sales-Channel-Beschraenkung)
      const order = await client.fetchOrderByNumber(row.orderNumber, null);
      if (!order?.id) {
        results.push({ ...base, status: "not_found", message: "Bestellung nicht gefunden" });
        continue;
      }

      // Tatsaechlich vorhandene "echte" Rechnungen aus Shopware lesen (Wahrheit, nicht Logs)
      const docs = await client.fetchOrderDocuments(order.id);
      const realInvoices = docs.filter(
        (d) =>
          (d.type === "invoice" || d.type === "proforma_invoice" || d.type === "vorkasse_invoice") &&
          !isProformaOrVorkasse(d.number),
      );
      const existingNumbers = realInvoices.map((d) => d.number);
      const matching = existingNumbers.includes(row.invoiceNumber);
      const netLabel = row.nettowert == null ? "?" : String(row.nettowert);
      base.existingNumbers = existingNumbers;

      log(
        `Zeile ${row.rowNumber}: ${row.orderNumber} -> ${row.invoiceNumber} ` +
          `[net=${netLabel}${row.isNachlieferung ? ", NACHLIEFERUNG" : ""}] ` +
          `vorhanden=[${existingNumbers.join(", ") || "-"}]`,
      );

      // 1) Diese SAP-Nummer existiert bereits als Rechnung -> idempotent.
      if (matching) {
        // Nachlieferung laesst das Custom Field unangetastet (Originalreferenz bleibt erhalten).
        if (apply && !row.isNachlieferung) {
          await client.updateOrderDocumentNumbers(order.id, { invoiceNumber: row.invoiceNumber });
          await logRun(order.id, row.orderNumber, "skipped", {
            erpInvoiceNumber: row.invoiceNumber,
            skippedReason: "Invoice with this number already exists",
          });
        }
        // Vorhandene Primaerrechnung (nicht Nachlieferung) ggf. spaeter verschicken.
        if (!row.isNachlieferung) {
          ordersToSend.set(order.id, row.orderNumber);
        }
        // Bereits vorhandene SAP-Rechnung als "nicht verschickt" markieren.
        if (markUnsent) {
          const doc = realInvoices.find((d) => d.number === row.invoiceNumber);
          if (doc?.id) {
            if (apply) {
              await client.setDocumentSent(doc.id, false);
            }
            markedUnsentCount += 1;
          }
        }
        results.push({
          ...base,
          status: apply ? "field_only" : "skipped_exists",
          message: markUnsent
            ? "Rechnung existiert -> als nicht verschickt markiert"
            : "Rechnung existiert bereits",
        });
        continue;
      }

      // 2) Nachlieferung (0 EUR): immer als zweite Rechnung anlegen, Custom Field NICHT ueberschreiben.
      if (row.isNachlieferung) {
        if (!apply) {
          results.push({
            ...base,
            status: "would_create_nachlieferung",
            message: `Nachlieferung ${row.invoiceNumber} (${row.invoiceDateLabel ?? "heute"}) wuerde als 2. Rechnung erstellt`,
          });
          continue;
        }
        const created = await client.createInvoice(
          order.id,
          row.invoiceNumber,
          undefined,
          row.invoiceDateIso,
          sentFlag,
        );
        if (markUnsent) markedUnsentCount += 1;
        await logRun(order.id, row.orderNumber, "success", {
          erpInvoiceNumber: row.invoiceNumber,
          shopwareInvoiceId: created.documentId,
          kind: "nachlieferung",
          sent: sentFlag,
        });
        results.push({
          ...base,
          status: "created_nachlieferung",
          message: `Nachlieferung ${row.invoiceNumber} als 2. Rechnung erstellt`,
        });
        continue;
      }

      // 3) Normale (Original-)Rechnung, diese Nummer fehlt noch.
      const excelSet = excelNumbersByOrder.get(row.orderNumber) ?? new Set<string>();
      const allExistingAreOurs =
        !skipOriginalBackfill &&
        existingNumbers.length > 0 &&
        existingNumbers.every((n) => excelSet.has(n));

      // 3a) Keine Rechnung vorhanden -> normal anlegen.
      // 3b) Vorhandene Rechnung(en) stammen ausschliesslich aus unserer SAP-Einspielung
      //     (z. B. zuvor angelegte Nachlieferung) -> fehlende Originalrechnung anlegen.
      if (existingNumbers.length === 0 || allExistingAreOurs) {
        const kind = existingNumbers.length === 0 ? "create" : "create_original";
        if (!apply) {
          results.push({
            ...base,
            status: kind === "create" ? "would_create" : "would_create_original",
            message: `Rechnung ${row.invoiceNumber} (${row.invoiceDateLabel ?? "heute"}) wuerde erstellt`,
          });
          continue;
        }
        const created = await client.createInvoice(
          order.id,
          row.invoiceNumber,
          undefined,
          row.invoiceDateIso,
          sentFlag,
        );
        if (markUnsent) markedUnsentCount += 1;
        await client.updateOrderDocumentNumbers(order.id, { invoiceNumber: row.invoiceNumber });
        // Neu angelegte Primaerrechnung ggf. spaeter verschicken.
        ordersToSend.set(order.id, row.orderNumber);
        await logRun(order.id, row.orderNumber, "success", {
          erpInvoiceNumber: row.invoiceNumber,
          shopwareInvoiceId: created.documentId,
          kind: kind === "create_original" ? "original_backfill" : "original",
          sent: sentFlag,
        });
        results.push({
          ...base,
          status: kind === "create" ? "created" : "created_original",
          message: `Rechnung ${row.invoiceNumber} erstellt`,
        });
        continue;
      }

      // 4) Echter Konflikt: eine fremde Rechnung existiert bereits (z. B. Shop-Rechnung 2026xxx).
      if (!fieldOnConflict) {
        results.push({
          ...base,
          status: "skipped_conflict",
          message: `Bestellung hat bereits Rechnung ${existingNumbers.join(", ")}`,
        });
        continue;
      }
      if (apply) {
        await client.updateOrderDocumentNumbers(order.id, { invoiceNumber: row.invoiceNumber });
        await logRun(order.id, row.orderNumber, "skipped", {
          erpInvoiceNumber: row.invoiceNumber,
          skippedReason: `Invoice already exists (${existingNumbers.join(", ")}); ERP reference only`,
        });
      }
      results.push({
        ...base,
        status: apply ? "field_only" : "would_field_only",
        message: `Konflikt mit ${existingNumbers.join(", ")} -> nur Custom Field (SAP-Referenz)`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ ...base, status: "error", message });
    }
  }

  // Optional: Primaerrechnungen ueber die Shopware-Funktion verschicken.
  // Nur im Apply-Modus und nur wenn ausdruecklich gewuenscht.
  let sentCount = 0;
  if (apply && options.sendInvoice && ordersToSend.size > 0) {
    log(`Versende ${ordersToSend.size} Rechnung(en) ueber die Shopware-Funktion ...`);
    for (const [orderId, orderNumber] of ordersToSend) {
      const sendResult = await sendOrderInvoice(
        client,
        { id: orderId, orderNumber },
        { trigger: "invoice_number", tenantId },
      );
      if (sendResult.status === "sent") {
        sentCount += 1;
        log(`  ✓ ${orderNumber}: Rechnung verschickt`);
      } else if (sendResult.status === "already_sent") {
        log(`  ⊘ ${orderNumber}: bereits verschickt`);
      } else {
        log(`  ! ${orderNumber}: Versand fehlgeschlagen (${sendResult.message ?? sendResult.status})`);
      }
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    mode: apply ? "apply" : "dry-run",
    totalRows: rows.length,
    options,
    summary,
    markedUnsentCount,
    sentCount,
    rows: results,
  };
}
