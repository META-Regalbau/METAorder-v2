/**
 * Server-seitiger Zugriff auf die lokale Zebra Browser Print HTTP-API.
 *
 * Der Browser (besonders mit Private Network Access / CORS) kann
 * `http://127.0.0.1:9100` oft nicht direkt erreichen. Der App-Container
 * spricht dagegen zuverlässig `host.docker.internal:9100` an (USB-Drucker
 * am Entwickler-Mac / Arbeitsplatz-Host).
 *
 * Env: BROWSER_PRINT_URL (Default http://host.docker.internal:9100)
 */

export type ZebraDeviceDto = {
  name: string;
  deviceType: string;
  connection: string;
  uid: string;
  provider?: string;
  manufacturer?: string;
  version?: number;
};

type AvailableResponse = Record<string, Array<Record<string, unknown>>>;

export class BrowserPrintProxyError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "BrowserPrintProxyError";
    this.code = code;
    this.status = status;
  }
}

function browserPrintBase(): string {
  const raw = (process.env.BROWSER_PRINT_URL || "http://host.docker.internal:9100").trim();
  return raw.replace(/\/+$/, "");
}

async function fetchBrowserPrint(
  path: string,
  init?: RequestInit,
  timeoutMs = 8000,
): Promise<Response> {
  const base = browserPrintBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new BrowserPrintProxyError(
        "browser_print_timeout",
        "Zebra Browser Print timed out",
        504,
      );
    }
    throw new BrowserPrintProxyError(
      "browser_print_unreachable",
      "Zebra Browser Print is not reachable from the server",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

function mapDevice(raw: Record<string, unknown>): ZebraDeviceDto {
  return {
    name: String(raw.name || ""),
    deviceType: String(raw.deviceType || "printer"),
    connection: String(raw.connection || ""),
    uid: String(raw.uid || ""),
    provider: raw.provider != null ? String(raw.provider) : undefined,
    manufacturer: raw.manufacturer != null ? String(raw.manufacturer) : undefined,
    version: typeof raw.version === "number" ? raw.version : Number(raw.version) || 2,
  };
}

export async function proxyListPrinters(): Promise<{
  printers: ZebraDeviceDto[];
  defaultUid: string | null;
}> {
  let defaultPrinter: ZebraDeviceDto | null = null;
  try {
    const defRes = await fetchBrowserPrint("/default?type=printer", undefined, 4000);
    if (defRes.ok) {
      const text = (await defRes.text()).trim();
      if (text && !text.startsWith("Device:")) {
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          if (json.uid) defaultPrinter = mapDevice(json);
        } catch {
          // ignore non-JSON default responses
        }
      }
    }
  } catch {
    // default is optional
  }

  const res = await fetchBrowserPrint("/available", undefined, 5000);
  if (!res.ok) {
    throw new BrowserPrintProxyError(
      "browser_print_unreachable",
      `Browser Print /available failed (HTTP ${res.status})`,
      502,
    );
  }

  const data = (await res.json()) as AvailableResponse;
  const live = (Array.isArray(data.printer) ? data.printer : [])
    .map((p) => mapDevice(p))
    .filter((d) => d.uid);

  // /available ist die Wahrheit: /default liefert einen gecachten Deskriptor, dessen USB-UID
  // nach Aus-/Einstecken des Druckers veraltet ist (z. B. addr_003 statt addr_004). Ein Write
  // auf so eine UID scheitert mit "Unable to establish connection". /default entscheidet
  // deshalb nur noch, WELCHER Drucker vorausgewählt wird — nie, welcher Deskriptor gesendet wird.
  let defaultUid: string | null = null;
  if (defaultPrinter) {
    const match =
      live.find((d) => d.uid === defaultPrinter.uid) ??
      live.find((d) => d.name === defaultPrinter.name);
    defaultUid = match?.uid ?? null;
  }

  const list = live.length > 0 ? live : defaultPrinter ? [defaultPrinter] : [];
  return {
    printers: list,
    defaultUid: defaultUid ?? list[0]?.uid ?? null,
  };
}

/**
 * Aktuellen Deskriptor zu einem Gerät aus /available holen.
 * Zuerst über die UID, sonst über den Namen — der bleibt beim Neuanstecken stabil,
 * die USB-UID nicht.
 */
async function resolveLiveDevice(device: ZebraDeviceDto): Promise<ZebraDeviceDto | null> {
  try {
    const res = await fetchBrowserPrint("/available", undefined, 5000);
    if (!res.ok) return null;
    const data = (await res.json()) as AvailableResponse;
    const live = (Array.isArray(data.printer) ? data.printer : [])
      .map((p) => mapDevice(p))
      .filter((d) => d.uid);
    return (
      live.find((d) => d.uid === device.uid) ??
      live.find((d) => d.name === device.name) ??
      null
    );
  } catch {
    return null;
  }
}

export async function proxySendZpl(device: ZebraDeviceDto, data: string): Promise<void> {
  if (!device?.uid) {
    throw new BrowserPrintProxyError("invalid_device", "Printer uid required", 400);
  }
  if (!data || typeof data !== "string") {
    throw new BrowserPrintProxyError("invalid_zpl", "ZPL data required", 400);
  }

  await writeWithRefresh(device, data);
}

/**
 * PDF an Zebra senden (PDF Direct / Link-OS).
 * Rohbytes als latin1-String im Browser-Print-/write-Payload.
 */
export async function proxySendPdf(device: ZebraDeviceDto, pdf: Buffer): Promise<void> {
  if (!device?.uid) {
    throw new BrowserPrintProxyError("invalid_device", "Printer uid required", 400);
  }
  if (!pdf?.length) {
    throw new BrowserPrintProxyError("invalid_pdf", "PDF data required", 400);
  }
  // PDF Direct erwartet den Dateiinhalt; latin1 erhält Bytewerte 0–255 in einem JS-String.
  await writeWithRefresh(device, pdf.toString("latin1"));
}

/**
 * Schreibt auf den Drucker und wiederholt den Versuch einmal mit dem aktuellen Deskriptor
 * aus /available. Der Client hält das Geräteobjekt ab dem Öffnen des Druckdialogs im State —
 * wird der Drucker zwischendurch neu angesteckt, zeigt die gemerkte USB-UID ins Leere.
 */
async function writeWithRefresh(device: ZebraDeviceDto, data: string): Promise<void> {
  try {
    await writeToPrinter(device, data);
    return;
  } catch (e) {
    if (!(e instanceof BrowserPrintProxyError) || e.code !== "print_failed") throw e;
    const fresh = await resolveLiveDevice(device);
    if (!fresh || fresh.uid === device.uid) throw e;
    console.warn(
      `[zebra] Write fehlgeschlagen, wiederhole mit aktueller Geräte-UID (alt: ${device.uid}, neu: ${fresh.uid})`,
    );
    await writeToPrinter(fresh, data);
  }
}

async function writeToPrinter(device: ZebraDeviceDto, data: string): Promise<void> {
  const res = await fetchBrowserPrint(
    "/write",
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        device: {
          name: device.name,
          uid: device.uid,
          connection: device.connection,
          deviceType: device.deviceType,
          version: device.version ?? 2,
          provider: device.provider,
          manufacturer: device.manufacturer,
        },
        data,
      }),
    },
    30000,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BrowserPrintProxyError(
      "print_failed",
      text.slice(0, 200) || `Print failed (HTTP ${res.status})`,
      502,
    );
  }
}
