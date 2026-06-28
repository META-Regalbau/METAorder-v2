/**
 * Einmal-Diagnose: Rechnungsversand fuer eine Bestellnummer.
 * Usage: npx tsx scripts/diagnose-order-invoice.ts MO102512
 */
import { storage } from "../server/storage";
import { ShopwareClient, getRealInvoiceDocument } from "../server/shopware";
import { sendOrderInvoice } from "../server/invoiceSending";

const args = process.argv.slice(2);
const applySend = args.includes("--apply");
const positional = args.filter((a) => a !== "--apply");
const orderNumber = positional[0]?.trim();
const tenantIdArg = positional[1]?.trim() || process.env.METAORDER_TENANT_ID || undefined;
if (!orderNumber) {
  console.error(
    "Usage: npx tsx scripts/diagnose-order-invoice.ts <orderNumber> [tenantId] [--apply]",
  );
  process.exit(1);
}

const settings = await storage.getShopwareSettings(tenantIdArg ?? null);
if (!settings) {
  console.error("Shopware settings not configured");
  process.exit(1);
}

const client = new ShopwareClient(settings);
const found = await client.fetchOrderByNumber(orderNumber, null);
if (!found) {
  console.error(`Order ${orderNumber} not found in Shopware`);
  process.exit(1);
}

const order = await client.fetchOrderById(found.id, null);
const documents = await client.fetchOrderDocuments(found.id);
const invoice = getRealInvoiceDocument(documents);
const mondu = await client.getMonduShipInfo(found.id);

console.log("=== Order ===");
console.log(
  JSON.stringify(
    {
      id: order?.id,
      orderNumber: order?.orderNumber,
      status: order?.status,
      paymentStatus: order?.paymentStatus,
      paymentMethod: order?.paymentMethod,
      customerEmail: order?.customerEmail,
      hasInvoiceDocument: order?.hasInvoiceDocument,
      invoiceSent: order?.invoiceSent,
      invoiceDocumentCount: order?.invoiceDocumentCount,
    },
    null,
    2,
  ),
);

console.log("\n=== Documents ===");
for (const d of documents) {
  console.log(JSON.stringify({ id: d.id, type: d.type, number: d.number, sent: d.sent }));
}

console.log("\n=== Real invoice ===");
console.log(invoice ? JSON.stringify(invoice, null, 2) : "none");

console.log("\n=== Mondu ship info ===");
console.log(JSON.stringify(mondu, null, 2));

if (mondu.hasHistoricalMonduTransaction) {
  console.log(
    "\n>>> Hinweis: Aeltere Mondu-Transaktion, aktive Zahlart ist NICHT Mondu — " +
      "Rechnung sollte per E-Mail verschickt werden (nicht Mondu-Ship-Flow).",
  );
}

if (invoice?.id) {
  const sentStatus = await client.getDocumentSentStatus(invoice.id);
  console.log("\n=== Verified document.sent ===", sentStatus);
}

if (applySend) {
  console.log("\n=== sendOrderInvoice (--apply) ===");
  const result = await sendOrderInvoice(client, { id: found.id, orderNumber }, { log: false });
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    "\n=== sendOrderInvoice ===",
    "uebersprungen (nur Diagnose). Zum echten Versand --apply anhaengen.",
  );
}

process.exit(0);
