import type { MonduSettings } from "@shared/schema";
import FormData from "form-data";

export interface MonduInvoiceSubmission {
  orderUuid: string;
  externalReferenceId: string;
  grossAmountCents: number;
  invoicePdf: Buffer;
  invoiceFileName?: string;
}

export interface MonduInvoiceResponse {
  invoice: {
    uuid: string;
    state: string;
    external_reference_id: string;
  };
}

export class MonduClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(settings: MonduSettings) {
    this.apiKey = settings.apiKey;
    this.baseUrl = settings.sandboxMode
      ? "https://api.demo.mondu.ai/api/v1"
      : "https://api.mondu.ai/api/v1";
  }

  async submitInvoice(submission: MonduInvoiceSubmission): Promise<MonduInvoiceResponse> {
    const { orderUuid, externalReferenceId, grossAmountCents, invoicePdf, invoiceFileName } = submission;

    const formData = new FormData();
    formData.append("external_reference_id", externalReferenceId);
    formData.append("gross_amount_cents", grossAmountCents.toString());
    formData.append("source", "api");
    formData.append("file", invoicePdf, {
      filename: invoiceFileName || "invoice.pdf",
      contentType: "application/pdf",
    });

    const response = await fetch(`${this.baseUrl}/orders/${orderUuid}/invoices`, {
      method: "POST",
      headers: {
        "Api-Token": this.apiKey,
        ...formData.getHeaders(),
      },
      body: formData as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[MonduClient] Invoice submission failed:", response.status, errorText);
      throw new Error(`Mondu invoice submission failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("[MonduClient] Invoice submitted successfully:", data);
    return data;
  }

  async getOrder(orderUuid: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/orders/${orderUuid}`, {
      method: "GET",
      headers: {
        "Api-Token": this.apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mondu get order failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async cancelInvoice(orderUuid: string, invoiceUuid: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/orders/${orderUuid}/invoices/${invoiceUuid}/cancel`, {
      method: "POST",
      headers: {
        "Api-Token": this.apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mondu cancel invoice failed: ${response.status} - ${errorText}`);
    }
  }
}
