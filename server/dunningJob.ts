import path from "path";
import fs from "fs/promises";
import type { IStorage } from "./storage";
import type { DunningSettings, Order } from "@shared/schema";
import { ShopwareClient, getRealInvoiceDocument } from "./shopware";
import { sendEmail } from "./emailOutbound";
import { generateDunningPdf } from "./dunningPdf";
import { getUploadsRoot } from "./uploadsRoot";

/** Speichert das Mahn-PDF im System (uploads/dunning/{orderId}/). */
export async function saveDunningPdfToSystem(
  orderId: string,
  stage: number,
  orderNumber: string,
  pdfBuffer: Buffer
): Promise<string> {
  const dir = path.join(getUploadsRoot(), "dunning", orderId);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `Mahnung-Stufe-${stage}-${orderNumber || orderId}.pdf`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, pdfBuffer);
  return filePath;
}

/** Liefert den absoluten Pfad zur gespeicherten Mahn-PDF, falls vorhanden. */
export function getDunningPdfPath(orderId: string, stage: number, orderNumber?: string): string {
  const fileName = `Mahnung-Stufe-${stage}-${orderNumber || orderId}.pdf`;
  return path.join(getUploadsRoot(), "dunning", orderId, fileName);
}

const DEFAULT_DUNNING_SETTINGS: DunningSettings = {
  enabled: false,
  manualOnly: true,
  dueDateFieldKey: "invoiceDate",
  stageDays: [7, 14, 21],
  documentTypeTechnicalName: "dunning",
  emailSubjectTemplate: "Mahnung Stufe {{stage}} zu Bestellung {{orderNumber}}",
  emailBodyTemplate: "Guten Tag {{customerName}},\n\nunsere Rechnung ist seit {{dueDate}} faellig. Dies ist Mahnstufe {{stage}}.\n\nMit freundlichen Gruessen\nIhr Team",
};

const parseDueDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const resolveDueDateValue = (order: Order, dueDateFieldKey: string) => {
  if (dueDateFieldKey === "invoiceDate") {
    return order.invoiceDate;
  }
  return order.customFields?.[dueDateFieldKey];
};

/**
 * Enriches order with due date from Shopware documents when missing (e.g. when fetchOrderById
 * does not include document dates). Used for both dunning preview and manual send.
 * Always ensures order.invoiceDate is set when missing (for use as due date or fallback).
 * Fallbacks: real invoice createdAt -> earliest document with createdAt -> orderDate.
 */
export async function enrichOrderDueDate(
  client: ShopwareClient,
  order: Order,
  _dueDateFieldKey: string
): Promise<void> {
  if (order.invoiceDate && order.invoiceNumber) return;
  try {
    const docs = await client.fetchOrderDocuments(order.id);
    const invoice = getRealInvoiceDocument(docs);

    if (!order.invoiceNumber && invoice?.number) {
      order.invoiceNumber = invoice.number;
    }

    if (!order.invoiceDate) {
      if (invoice?.createdAt) {
        order.invoiceDate = invoice.createdAt;
      } else {
        const withDate = docs.filter((d) => d.createdAt).sort((a, b) => a.createdAt!.localeCompare(b.createdAt!));
        if (withDate.length > 0) {
          order.invoiceDate = withDate[0].createdAt!;
        } else if (order.orderDate) {
          order.invoiceDate = typeof order.orderDate === "string" ? order.orderDate : new Date(order.orderDate).toISOString();
        }
      }
    }
  } catch (err) {
    console.warn(`[Dunning] Could not fetch documents for order ${order.id}:`, err);
    if (!order.invoiceDate && order.orderDate) {
      order.invoiceDate = typeof order.orderDate === "string" ? order.orderDate : new Date(order.orderDate).toISOString();
    }
  }
}

const resolveTemplate = (template: string, order: Order, stage: number, dueDate: Date) =>
  template
    .replace(/{{orderNumber}}/g, order.orderNumber || "")
    .replace(/{{customerName}}/g, order.customerName || "")
    .replace(/{{stage}}/g, String(stage))
    .replace(/{{dueDate}}/g, dueDate.toISOString().split("T")[0]);

type DunningCandidate = {
  order: Order;
  dueDate: Date;
  daysOverdue: number;
  lastStage: number;
  nextStage: number;
};

const computeNextStage = (daysOverdue: number, stageDays: [number, number, number]) => {
  let targetStage = 0;
  for (let index = stageDays.length - 1; index >= 0; index -= 1) {
    if (daysOverdue >= stageDays[index]) {
      targetStage = index + 1;
      break;
    }
  }
  return targetStage;
};

export type DunningCandidateResult = {
  candidate: Omit<DunningCandidate, "order"> | null;
  ineligibleReason?: string;
};

export const getDunningCandidateForOrder = (
  order: Order,
  dunningSettings: DunningSettings,
  lastStage: number
): DunningCandidateResult => {
  if (!order.customerEmail) {
    return { candidate: null, ineligibleReason: "Bestellung hat keine Kunden-E-Mail." };
  }
  if (order.paymentStatus !== "open" && order.paymentStatus !== "authorized") {
    return { candidate: null, ineligibleReason: "Zahlungsstatus erlaubt keine Mahnung (nur „offen“ oder „autorisiert“)." };
  }

  let dueDateValue = resolveDueDateValue(order, dunningSettings.dueDateFieldKey);
  if (!dueDateValue && order.orderDate) {
    dueDateValue = order.orderDate;
  }
  const dueDate = parseDueDate(dueDateValue);
  if (!dueDate) {
    return { candidate: null, ineligibleReason: "Kein Fälligkeitsdatum für die Bestellung vorhanden." };
  }

  const now = new Date();
  const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysOverdue < dunningSettings.stageDays[0]) {
    return { candidate: null, ineligibleReason: "Noch nicht mahnfähig (Mindestanzahl Tage Überfälligkeit nicht erreicht)." };
  }

  const targetStage = computeNextStage(daysOverdue, dunningSettings.stageDays);
  if (targetStage === 0) {
    return { candidate: null, ineligibleReason: "Keine Mahnstufe erreicht." };
  }

  if (lastStage >= targetStage) {
    return { candidate: null, ineligibleReason: "Diese Mahnstufe wurde bereits versendet." };
  }

  const nextStage = Math.min(lastStage + 1, 3);
  if (daysOverdue < dunningSettings.stageDays[nextStage - 1]) {
    return { candidate: null, ineligibleReason: "Noch nicht mahnfähig (Mindestanzahl Tage Überfälligkeit nicht erreicht)." };
  }

  return { candidate: { dueDate, daysOverdue, lastStage, nextStage } };
};

export async function getDunningCandidates(
  storage: IStorage,
  client: ShopwareClient,
  dunningSettings: DunningSettings,
  allowedChannelIds: string[] | null,
  tenantId?: string | null
): Promise<DunningCandidate[]> {
  const orders = await client.fetchOrders(allowedChannelIds);

  // Fallback: enrich due date from fetchOrderDocuments when missing (e.g. documents via relationships not resolved)
  const needsDueDate = orders.filter(
    (o) =>
      !resolveDueDateValue(o, dunningSettings.dueDateFieldKey) &&
      (o.paymentStatus === "open" || o.paymentStatus === "authorized") &&
      o.customerEmail &&
      (o.invoiceNumber ?? o.customFields?.custom_order_numbers_invoice)
  );
  for (const order of needsDueDate) {
    await enrichOrderDueDate(client, order, dunningSettings.dueDateFieldKey);
  }

  const orderIds = orders.map((order) => order.id);
  const statuses = await storage.getOrderDunningStatuses(orderIds, tenantId);
  const statusMap = new Map(statuses.map((status) => [status.orderId, status]));

  return orders.reduce<DunningCandidate[]>((acc, order) => {
    const lastStage = statusMap.get(order.id)?.stage ?? 0;
    const { candidate } = getDunningCandidateForOrder(order, dunningSettings, lastStage);
    if (candidate) {
      acc.push({ order, ...candidate });
    }
    return acc;
  }, []);
}

export async function sendDunningForOrder(
  storage: IStorage,
  client: ShopwareClient,
  dunningSettings: DunningSettings,
  order: Order,
  dueDate: Date,
  nextStage: number,
  shopwareUrl: string,
  tenantId?: string | null
) {
  const { documentId, documentNumber } = await client.createDunningDocument(
    order.id,
    dunningSettings.documentTypeTechnicalName,
    nextStage
  );

  let pdfUrl: string | undefined;
  let deepLinkCode: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 500 : 1000));
    const docs = await client.fetchOrderDocuments(order.id);
    const match = docs.find((doc) => doc.id === documentId || doc.number === documentNumber);
    if (match?.deepLinkCode) {
      deepLinkCode = match.deepLinkCode;
      pdfUrl = `${shopwareUrl}/api/_action/document/${match.id}/${match.deepLinkCode}?download=1`;
      break;
    }
  }

  if (!deepLinkCode) {
    return;
  }

  const pdfBuffer = await client.downloadDocumentPdfBuffer(documentId, deepLinkCode);
  const subject = resolveTemplate(dunningSettings.emailSubjectTemplate, order, nextStage, dueDate);
  const body = resolveTemplate(dunningSettings.emailBodyTemplate, order, nextStage, dueDate);

  await sendEmail(storage, {
    to: order.customerEmail!,
    subject,
    text: body,
    html: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
    attachments: [
      {
        filename: `Mahnung-Stufe-${nextStage}-${order.orderNumber || order.id}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  await storage.upsertOrderDunningStatus(
    {
      orderId: order.id,
      stage: nextStage,
      lastSentAt: new Date(),
      lastDocumentId: documentId,
      lastPdfUrl: pdfUrl,
    },
    tenantId
  );
}

export type SendDunningInternalOptions = {
  client?: ShopwareClient;
};

/**
 * Create dunning PDF in METAorder (no Shopware document type required).
 * Lädt das PDF immer in den Shop (wenn options.client gesetzt). Mailversand kommt später.
 */
export async function sendDunningForOrderInternal(
  storage: IStorage,
  dunningSettings: DunningSettings,
  order: Order,
  dueDate: Date,
  nextStage: number,
  tenantId: string | null | undefined,
  options?: SendDunningInternalOptions
): Promise<void> {
  const pdfBuffer = await generateDunningPdf(order, nextStage, dueDate);
  const fileName = `Mahnung-Stufe-${nextStage}-${order.orderNumber || order.id}.pdf`;

  await saveDunningPdfToSystem(order.id, nextStage, order.orderNumber || order.id, pdfBuffer);

  if (options?.client) {
    try {
      const result = await options.client.uploadOrderDocumentPdf(order.id, pdfBuffer, fileName);
      if (result.documentId) {
        console.log("[Dunning] PDF uploaded to Shopware for order", order.orderNumber || order.id);
      }
    } catch (err) {
      console.error("[Dunning] Save PDF to Shopware failed for order", order.orderNumber || order.id, err);
    }
  }

  // Mailversand und Status-Update kommen später
  // const subject = resolveTemplate(dunningSettings.emailSubjectTemplate, order, nextStage, dueDate);
  // const body = resolveTemplate(dunningSettings.emailBodyTemplate, order, nextStage, dueDate);
  // await sendEmail(storage, { ... });
  // await storage.upsertOrderDunningStatus({ ... }, tenantId);
}

export async function runDunningJob(storage: IStorage) {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((tenant) => tenant.id) : [null];

  for (const tenantId of tenantIds) {
    try {
      const shopwareSettings = await storage.getShopwareSettings(tenantId);
      if (!shopwareSettings) {
        continue;
      }

      const dunningSettings = { ...DEFAULT_DUNNING_SETTINGS, ...(await storage.getDunningSettings(tenantId)) };
      if (!dunningSettings.enabled || dunningSettings.manualOnly) {
        continue;
      }

      const client = new ShopwareClient(shopwareSettings);
      const candidates = await getDunningCandidates(storage, client, dunningSettings, null, tenantId);

      for (const candidate of candidates) {
        const { order, dueDate, nextStage } = candidate;
        await sendDunningForOrder(storage, client, dunningSettings, order, dueDate, nextStage, shopwareSettings.shopwareUrl, tenantId);
      }
    } catch (error) {
      console.error("[DunningJob] Error processing tenant:", tenantId, error);
    }
  }
}
