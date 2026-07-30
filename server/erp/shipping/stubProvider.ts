import pdfkit from "pdfkit";
import type {
  CreateShippingLabelInput,
  CreateShippingLabelResult,
  ShippingLabelProvider,
  ShippingMethodOption,
} from "./types";

const PDFDocument = (pdfkit as any).default || pdfkit;

function buildStubPdf(input: CreateShippingLabelInput, trackingNumber: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A6", margin: 24 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const r = input.recipient || {};
    doc.fontSize(14).text("META Order — Versandlabel (Stub)", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Tracking: ${trackingNumber}`);
    doc.text(`Carrier: ${(input.carrierCode || "STUB").toUpperCase()}`);
    if (input.orderNumber) doc.text(`Bestellung: ${input.orderNumber}`);
    if (input.packageWeightKg != null) doc.text(`Gewicht: ${input.packageWeightKg} kg`);
    doc.moveDown(0.5);
    doc.fontSize(11).text("Empfänger", { underline: true });
    doc.fontSize(10);
    if (r.company) doc.text(r.company);
    if (r.name) doc.text(r.name);
    const streetLine = [r.street, r.houseNumber].filter(Boolean).join(" ");
    if (streetLine) doc.text(streetLine);
    const cityLine = [r.postalCode, r.city].filter(Boolean).join(" ");
    if (cityLine) doc.text(cityLine);
    if (r.country) doc.text(r.country);
    doc.moveDown(1);
    doc.fontSize(8).fillColor("#666").text(
      "Stub-Label ohne Carrier-API. Sendcloud-Keys in Versand-Ops hinterlegen für echte Labels.",
      { width: 240 },
    );
    doc.end();
  });
}

export class StubShippingLabelProvider implements ShippingLabelProvider {
  readonly name = "stub";

  async createLabel(input: CreateShippingLabelInput): Promise<CreateShippingLabelResult> {
    const carrierCode = (input.carrierCode || "STUB").toUpperCase();
    const trackingNumber = `${carrierCode}${Date.now().toString(36).toUpperCase()}`;
    const labelPdf = await buildStubPdf(input, trackingNumber);
    return {
      provider: this.name,
      carrierCode,
      trackingNumber,
      externalParcelId: trackingNumber,
      labelUrl: undefined,
      labelPdf,
      shippingMethodCode: input.shippingMethodCode || "stub:local",
      rawResponse: {
        provider: "stub",
        note: "Lokales Stub-Label — kein Carrier-Aufruf",
      },
    };
  }

  async voidLabel(_externalParcelId: string): Promise<void> {
    // lokal nichts zu stornieren
  }

  async fetchShippingMethods(): Promise<ShippingMethodOption[]> {
    return [
      { id: "stub-local", code: "stub:local", name: "Lokales Stub-Label", carrier: "STUB" },
    ];
  }

  async downloadLabelPdf(_externalParcelId: string): Promise<Buffer> {
    throw new Error("Stub labels are stored locally; use label file path");
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Stub-Provider aktiv (keine Sendcloud-Keys)" };
  }
}
