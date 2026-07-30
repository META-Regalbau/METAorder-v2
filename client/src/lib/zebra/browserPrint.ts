/**
 * Zebra-Drucker über META Order API (Server-Proxy zu Browser Print).
 *
 * Der Browser spricht denselben Origin an (`/api/erp/zebra/*`); der Server
 * leitet an Zebra Browser Print auf dem Host weiter
 * (`BROWSER_PRINT_URL`, Default http://host.docker.internal:9100).
 *
 * So entfallen CORS / Private Network Access, die den direkten Aufruf
 * von `http://127.0.0.1:9100` aus der SPA oft blockieren.
 */

import { apiRequest } from "@/lib/queryClient";

export type ZebraDevice = {
  name: string;
  deviceType: string;
  connection: string;
  uid: string;
  provider?: string;
  manufacturer?: string;
  version?: number;
};

export class BrowserPrintUnavailableError extends Error {
  constructor(message = "Zebra Browser Print is not available") {
    super(message);
    this.name = "BrowserPrintUnavailableError";
  }
}

type PrintersResponse = {
  printers: ZebraDevice[];
  defaultUid: string | null;
};

export async function ensureBrowserPrintLoaded(): Promise<void> {
  // no-op: server proxy needs no client SDK
}

export async function discoverPrinters(): Promise<{
  printers: ZebraDevice[];
  defaultUid: string | null;
}> {
  try {
    const res = await apiRequest("GET", "/api/erp/zebra/printers");
    const data = (await res.json()) as PrintersResponse;
    return {
      printers: Array.isArray(data.printers) ? data.printers : [],
      defaultUid: data.defaultUid ?? null,
    };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (/502|504|unreachable|timeout|Browser Print/i.test(msg)) {
      throw new BrowserPrintUnavailableError(
        /timeout|504/i.test(msg) ? "browser_print_timeout" : "browser_print_unreachable",
      );
    }
    // apiRequest wirft oft "401: ..." / "502: {json}"
    try {
      const jsonStart = msg.indexOf("{");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(msg.slice(jsonStart)) as { code?: string };
        if (parsed.code === "browser_print_timeout") {
          throw new BrowserPrintUnavailableError("browser_print_timeout");
        }
        if (parsed.code) {
          throw new BrowserPrintUnavailableError("browser_print_unreachable");
        }
      }
    } catch (inner) {
      if (inner instanceof BrowserPrintUnavailableError) throw inner;
    }
    throw new BrowserPrintUnavailableError("browser_print_unreachable");
  }
}

export async function sendZpl(device: ZebraDevice, zpl: string): Promise<void> {
  await apiRequest("POST", "/api/erp/zebra/print", {
    device: {
      name: device.name,
      uid: device.uid,
      connection: device.connection,
      deviceType: device.deviceType,
      version: device.version ?? 2,
      provider: device.provider,
      manufacturer: device.manufacturer,
    },
    data: zpl,
  });
}

/** Versandlabel-PDF an Standard-Zebra (Browser Print / PDF Direct) senden. */
export async function printShippingLabelPdf(
  labelId: string,
  device?: ZebraDevice | null,
): Promise<{ printerName?: string }> {
  const body = device
    ? {
        device: {
          name: device.name,
          uid: device.uid,
          connection: device.connection,
          deviceType: device.deviceType,
          version: device.version ?? 2,
          provider: device.provider,
          manufacturer: device.manufacturer,
        },
      }
    : {};
  try {
    const res = await apiRequest("POST", `/api/erp/shipping-labels/${labelId}/print`, body);
    const data = (await res.json()) as { ok?: boolean; printerName?: string };
    return { printerName: data.printerName };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (/502|504|unreachable|timeout|Browser Print|No Zebra/i.test(msg)) {
      throw new BrowserPrintUnavailableError(
        /timeout|504/i.test(msg) ? "browser_print_timeout" : "browser_print_unreachable",
      );
    }
    throw e;
  }
}
