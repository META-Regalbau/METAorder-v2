import type {
  CreateShippingLabelInput,
  CreateShippingLabelResult,
  ShippingLabelProvider,
  ShippingMethodOption,
} from "./types";

const SENDCLOUD_API = "https://panel.sendcloud.sc/api/v2";

/** Sendcloud Test-Methode (Unstamped Letter) — keine echten Versandkosten. */
export const SENDCLOUD_TEST_METHOD_CODE = "sendcloud:letter";

type SendcloudCredentials = {
  publicKey: string;
  secretKey: string;
  sandboxMode?: boolean;
  defaultShippingMethodId?: string | null;
  defaultShippingMethodCode?: string | null;
  senderAddressId?: string | null;
};

function splitStreet(street?: string): { street: string; houseNumber: string } {
  const raw = String(street || "").trim();
  if (!raw) return { street: "", houseNumber: "1" };
  const m = raw.match(/^(.*?)[\s,]+(\d+[a-zA-Z\-\/]*)$/);
  if (m) return { street: m[1].trim(), houseNumber: m[2].trim() };
  return { street: raw, houseNumber: "1" };
}

function countryIso(country?: string): string {
  const c = String(country || "DE").trim().toUpperCase();
  if (c.length === 2) return c;
  if (c.includes("DEUTSCH") || c === "GERMANY") return "DE";
  if (c.includes("ÖSTER") || c.includes("AUSTRIA")) return "AT";
  if (c.includes("SCHWEIZ") || c.includes("SWITZERLAND")) return "CH";
  return c.slice(0, 2) || "DE";
}

export class SendcloudShippingLabelProvider implements ShippingLabelProvider {
  readonly name = "sendcloud";

  constructor(private readonly creds: SendcloudCredentials) {}

  private authHeader(): string {
    const token = Buffer.from(`${this.creds.publicKey}:${this.creds.secretKey}`).toString("base64");
    return `Basic ${token}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${SENDCLOUD_API}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });
    return res;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.request("/user");
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, message: `Sendcloud ${res.status}: ${text.slice(0, 200)}` };
      }
      const data = (await res.json()) as { user?: { username?: string; email?: string } };
      const who = data?.user?.username || data?.user?.email || "ok";
      return { ok: true, message: `Verbunden als ${who}` };
    } catch (e: any) {
      return { ok: false, message: e?.message || "Sendcloud-Verbindung fehlgeschlagen" };
    }
  }

  async fetchShippingMethods(): Promise<ShippingMethodOption[]> {
    const res = await this.request("/shipping_methods");
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sendcloud shipping methods failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      shipping_methods?: Array<{ id: number; name: string; carrier?: string; code?: string }>;
    };
    return (data.shipping_methods || []).map((m) => ({
      id: String(m.id),
      code: m.code,
      name: m.name,
      carrier: m.carrier,
    }));
  }

  private async resolveShipment(
    input: CreateShippingLabelInput,
  ): Promise<{ id?: number; name?: string }> {
    if (input.shippingMethodId != null && String(input.shippingMethodId).trim()) {
      return { id: Number(input.shippingMethodId) };
    }
    if (this.creds.defaultShippingMethodId) {
      return { id: Number(this.creds.defaultShippingMethodId) };
    }
    if (input.shippingMethodCode || this.creds.defaultShippingMethodCode || this.creds.sandboxMode) {
      const code =
        input.shippingMethodCode ||
        this.creds.defaultShippingMethodCode ||
        (this.creds.sandboxMode ? SENDCLOUD_TEST_METHOD_CODE : undefined);
      if (code) {
        const methods = await this.fetchShippingMethods();
        const match = methods.find(
          (m) =>
            m.code === code ||
            m.name.toLowerCase().includes("unstamped") ||
            m.name.toLowerCase().includes("letter"),
        );
        if (match) return { id: Number(match.id), name: match.name };
        return { name: code };
      }
    }
    throw new Error("Sendcloud shipping method required (configure default or pass shippingMethodId)");
  }

  async createLabel(input: CreateShippingLabelInput): Promise<CreateShippingLabelResult> {
    const r = input.recipient || {};
    const split = r.houseNumber
      ? { street: r.street || "", houseNumber: r.houseNumber }
      : splitStreet(r.street);
    const shipment = await this.resolveShipment(input);
    const weightKg = Number(input.packageWeightKg ?? 1);
    const weightGrams = Math.max(1, Math.round(weightKg * 1000));

    const parcelBody: Record<string, unknown> = {
      name: r.name || r.company || "Empfänger",
      company_name: r.company || "",
      address: split.street || r.street || "Street",
      house_number: split.houseNumber || "1",
      city: r.city || "",
      postal_code: r.postalCode || "",
      country: countryIso(r.country),
      email: r.email || "",
      telephone: r.phone || "",
      order_number: input.orderNumber || "",
      weight: String(weightGrams / 1000),
      request_label: true,
      shipment,
    };
    if (this.creds.senderAddressId || input.senderAddressId) {
      parcelBody.sender_address = Number(input.senderAddressId || this.creds.senderAddressId);
    }

    const res = await this.request("/parcels", {
      method: "POST",
      body: JSON.stringify({ parcel: parcelBody }),
    });
    const raw = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg =
        raw?.error?.message ||
        raw?.message ||
        (typeof raw === "string" ? raw : JSON.stringify(raw).slice(0, 300));
      throw new Error(`Sendcloud create parcel failed: ${res.status} ${msg}`);
    }

    const parcel = raw?.parcel || raw;
    const parcelId = String(parcel?.id ?? "");
    if (!parcelId) throw new Error("Sendcloud response missing parcel id");

    const trackingNumber =
      parcel?.tracking_number || parcel?.tracking_number_str || `SC${parcelId}`;
    const carrierCode = String(
      parcel?.carrier?.code || parcel?.shipment?.name || input.carrierCode || "SENDCLOUD",
    ).toUpperCase();

    let labelPdf: Buffer;
    let labelFormat: "label_printer" | "normal_printer" = "label_printer";
    try {
      // Thermodrucker-Format (z. B. 10×15 cm) bevorzugen
      labelPdf = await this.downloadLabelPdf(parcelId, "label_printer");
    } catch {
      try {
        labelPdf = await this.downloadLabelPdf(parcelId, "normal_printer");
        labelFormat = "normal_printer";
      } catch {
        const labelUrl =
          parcel?.label?.label_printer ||
          parcel?.label?.normal_printer ||
          (Array.isArray(parcel?.label) ? parcel.label[0] : undefined);
        if (!labelUrl) throw new Error("Sendcloud label PDF not available");
        const pdfRes = await fetch(labelUrl, {
          headers: { Authorization: this.authHeader() },
        });
        if (!pdfRes.ok) throw new Error(`Sendcloud label download failed: ${pdfRes.status}`);
        labelPdf = Buffer.from(await pdfRes.arrayBuffer());
        labelFormat = String(labelUrl).includes("normal") ? "normal_printer" : "label_printer";
      }
    }

    return {
      provider: this.name,
      carrierCode,
      trackingNumber: String(trackingNumber),
      externalParcelId: parcelId,
      labelUrl: `/api/erp/shipping-labels/pdf-by-parcel/${parcelId}`,
      labelPdf,
      labelFormat,
      shippingMethodCode:
        input.shippingMethodCode ||
        this.creds.defaultShippingMethodCode ||
        shipment.name ||
        undefined,
      rawResponse: { parcel, labelFormat },
    };
  }

  async downloadLabelPdf(
    externalParcelId: string,
    format: "label_printer" | "normal_printer" = "label_printer",
  ): Promise<Buffer> {
    const res = await this.request(`/labels/${format}/${externalParcelId}`, {
      headers: { Accept: "application/pdf" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sendcloud PDF (${format}) failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async voidLabel(externalParcelId: string): Promise<void> {
    const res = await this.request(`/parcels/${externalParcelId}/cancel`, { method: "POST" });
    if (res.ok || res.status === 404) return;
    // Fallback: some accounts use DELETE
    if (res.status === 405 || res.status === 400) {
      const del = await this.request(`/parcels/${externalParcelId}`, { method: "DELETE" });
      if (del.ok || del.status === 404) return;
      const text = await del.text();
      throw new Error(`Sendcloud void failed: ${del.status} ${text.slice(0, 200)}`);
    }
    const text = await res.text();
    throw new Error(`Sendcloud cancel failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
