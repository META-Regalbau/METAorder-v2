/**
 * Erzeugt eine Muster-Mahnung (PDF) mit Dummy-Daten zum Anschauen.
 * Ausführen: npm run muster-mahnung  (aus METAorder-v2)
 * Ergebnis: Muster-Mahnung-Stufe-1.pdf im Projektroot
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Order } from "../shared/schema";
import { generateDunningPdf } from "../server/dunningPdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const mockOrder: Order = {
  id: "muster-order-id",
  orderNumber: "MO102069",
  customerName: "Florian May",
  customerEmail: "florian.may@example.com",
  orderDate: "2026-02-13",
  totalAmount: 865.84,
  netTotalAmount: 727.60,
  status: "completed",
  paymentStatus: "open",
  paymentMethod: "Rechnungskauf - Später per Banküberweisung bezahlen",
  shippingMethod: "DPD",
  salesChannelId: "sc1",
  invoiceNumber: "2026005946",
  invoiceDate: "2026-02-20",
  dueDate: "2026-03-15",
  billingAddress: {
    firstName: "Florian",
    lastName: "May",
    street: "Teussenbergweg 15",
    zipCode: "73457",
    city: "Essingen",
    country: "Deutschland",
    company: "Industrie Service May",
  },
  shippingAddress: {
    firstName: "Florian",
    lastName: "May",
    street: "Obere Bahnstraße 64",
    zipCode: "73431",
    city: "Aalen",
    country: "Deutschland",
    company: "Franke GmbH",
  },
  items: [
    {
      id: "1",
      name: "S3 CLIP Reifenregal GR 2000 x 1150 x 400 vzk",
      quantity: 2,
      price: 174.0,
      netPrice: 174.0,
      total: 348.0,
      netTotal: 348.0,
      taxRate: 19,
      productNumber: "4026212443165",
    },
    {
      id: "2",
      name: "S3 CLIP Reifenregal GR 2000 x 3 Reifenebenen vzk Anbauregal",
      quantity: 4,
      price: 127.0,
      netPrice: 127.0,
      total: 508.0,
      netTotal: 508.0,
      taxRate: 19,
      productNumber: "4026212443200",
    },
    {
      id: "3",
      name: "Reifen-Längsriegeln ( 3 Reifenebenen )",
      quantity: 1,
      price: -128.40,
      netPrice: -128.40,
      total: -128.40,
      netTotal: -128.40,
      taxRate: 19,
      productNumber: "4026212443217",
    },
  ],
};

async function main() {
  const stage = 1;
  const dueDate = new Date("2026-03-15");
  const pdfBuffer = await generateDunningPdf(mockOrder, stage, dueDate);
  const outPath = path.join(rootDir, "Muster-Mahnung-Stufe-1.pdf");
  fs.writeFileSync(outPath, pdfBuffer);
  console.log("Muster-Mahnung erzeugt:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
