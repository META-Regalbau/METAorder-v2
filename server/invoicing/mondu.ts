import type { MonduSettings } from "@shared/schema";
import FormData from "form-data";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "invoicing/mondu" });

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

/** Mondu-Bestellung, wie die API sie liefert (nur die Felder, die METAorder nutzt) */
export interface MonduApiOrder {
  uuid: string;
  state: string;
  external_reference_id?: string | null;
  state_description?: string | null;
  cancelation_reason?: string | null;
  decline_reason?: string | null;
  pending_reason_description?: string | null;
  data_required_reason?: string | null;
  real_price_cents?: number | null;
  currency?: string | null;
}

/** Fehlerantwort von Mondu mit Status und lesbarer Meldung aus dem errors-Feld */
export class MonduApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Mondu ${status}: ${detail}`);
    this.name = "MonduApiError";
  }
}

/** Meldung aus einer Mondu-Fehlerantwort ({"errors":[{"name":"buyer.email","details":"is invalid"}]} u. a.) */
export function monduErrorDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { errors?: unknown; message?: unknown; error?: unknown };
    if (Array.isArray(body?.errors)) {
      const parts = body.errors
        .map((e: any) => [e?.name, e?.details ?? e?.message].filter((v) => typeof v === "string" && v).join(": "))
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
    if (typeof body?.message === "string" && body.message) return body.message;
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // kein JSON
  }
  return text.trim().slice(0, 300) || "keine Angabe";
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Api-Token": this.apiKey,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new MonduApiError(response.status, monduErrorDetail(text));
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Verbindungstest: erste Seite der Bestellliste (1 Eintrag) */
  async ping(): Promise<void> {
    await this.request("GET", "/orders?page=1&per_page=1");
  }

  /** Bestellung im Hintergrund prüfen lassen; Mondu schickt dem Käufer den Bestätigungslink */
  async createAsyncOrder(payload: Record<string, unknown>): Promise<MonduApiOrder> {
    const data = await this.request<{ order: MonduApiOrder }>("POST", "/orders/create_async", payload);
    return data.order;
  }

  async getOrderState(orderUuid: string): Promise<MonduApiOrder> {
    const data = await this.request<{ order: MonduApiOrder }>("GET", `/orders/${orderUuid}`);
    return data.order;
  }

  async cancelOrder(orderUuid: string): Promise<MonduApiOrder | null> {
    const data = await this.request<{ order?: MonduApiOrder }>("POST", `/orders/${orderUuid}/cancel`, {
      cancelation_source: "api",
    });
    return data.order ?? null;
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

    // fetch nimmt den form-data-Stream nicht an, darum als fertiger Puffer mit passender Boundary
    const response = await fetch(`${this.baseUrl}/orders/${orderUuid}/invoices`, {
      method: "POST",
      headers: {
        "Api-Token": this.apiKey,
        ...formData.getHeaders(),
      },
      body: new Uint8Array(formData.getBuffer()),
    });

    if (!response.ok) {
      const errorText = await response.text();
      moduleLog.error(`[MonduClient] Invoice submission failed: ${response.status} ${errorText}`);
      throw new MonduApiError(response.status, monduErrorDetail(errorText));
    }

    const data = await response.json();
    moduleLog.info({ data }, "[MonduClient] Invoice submitted successfully:");
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
