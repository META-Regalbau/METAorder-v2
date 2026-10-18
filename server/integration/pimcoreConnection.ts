import { decrypt, encrypt } from "../lib/encryption";

/**
 * Verbindung METAorder -> Pimcore ueber die REST-Schnittstelle des Blackbit Data Director
 * (GET <pimcore>/api/rest/export/<Dataport>). Pimcore fuehrt bei Stammdaten und Preisen; METAorder liest
 * darueber direkt statt auf den Pimcore-Export in den Shop zu warten (Konzept Pimcore-Anbindung).
 * Je Mandant in settings ("pimcore_connection"): Adresse, API-Key (verschluesselt, nie in Antworten,
 * nur im Header X-API-Key) und die Namen der Dataports:
 * - Artikel vollstaendig (nachts, Abgleich aller Artikel)
 * - Artikel-Aenderungen (automatischer Export mit "Incremental Export": jeder Abruf liefert nur, was
 *   sich seit dem letzten Abruf geaendert hat, und leert danach den Vorrat) - den ruft der
 *   Verbindungstest deshalb NIE ab, sonst gingen dem Abgleich Aenderungen verloren
 * - Preise (basePrice, Onlineshop-Preis)
 * Exporte muessen JSON liefern. Fehler tragen einen Code (pimcore_*), die Oberflaeche uebersetzt ihn.
 */

export const PIMCORE_SETTING_KEY = "pimcore_connection";
/** REST-Pfad der Data-Director-Exporte; dahinter steht der Name (oder die ID) des Dataports */
export const DATA_DIRECTOR_EXPORT_PATH = "/api/rest/export";

export const PIMCORE_DEFAULTS = {
  articlesFullDataport: "metaorder-artikel",
  articlesChangesDataport: "metaorder-artikel-aenderungen",
  pricesDataport: "metaorder-preise",
  productNumberField: "GTIN",
} as const;

export type PimcoreDataports = {
  /** Alle Artikel (ohne "Incremental Export") */
  articlesFullDataport: string;
  /** Nur Aenderungen ("Incremental Export"); leer = nicht genutzt */
  articlesChangesDataport: string;
  /** Basis- und Onlineshop-Preise; leer = nicht genutzt */
  pricesDataport: string;
};

export type StoredPimcoreConnection = PimcoreDataports & {
  baseUrl: string;
  apiKey: string;
  /** Feld des Exports mit der Artikelnummer (= Shop-Artikelnummer) */
  productNumberField: string;
};

export type PimcoreTarget = Omit<StoredPimcoreConnection, "apiKey">;

/** Hosts, die auch ohne HTTPS erlaubt sind (lokale Entwicklung, Docker) */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

/** Dataport-Name oder -ID wie in Pimcore; geht in die Adresse ein */
const DATAPORT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,99}$/;
/** Feldname im Export (Spaltenname im Dataport) */
const FIELD_PATTERN = /^[^\s{}"'<>][^{}"'<>]{0,99}$/;

export type PimcoreInputErrorCode =
  | "pimcore_url_missing"
  | "pimcore_url_invalid"
  | "pimcore_url_https"
  | "pimcore_dataport_invalid"
  | "pimcore_field_invalid";

/**
 * Eingaben vereinheitlichen. Die Adresse darf auch eine komplette Export-Adresse sein
 * (".../api/rest/export/metaorder-artikel"): dann gilt der Dataport daraus, wenn keiner angegeben ist.
 * HTTPS Pflicht, ausser fuer lokale Hosts; keine Zugangsdaten oder Parameter (apikey!) in der Adresse.
 */
export function normalizePimcoreTarget(input: {
  baseUrl?: unknown;
  articlesFullDataport?: unknown;
  articlesChangesDataport?: unknown;
  pricesDataport?: unknown;
  productNumberField?: unknown;
}): { ok: true; target: PimcoreTarget } | { ok: false; code: PimcoreInputErrorCode } {
  const text = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  if (!text) return { ok: false, code: "pimcore_url_missing" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: "pimcore_url_invalid" };
  }
  if (url.username || url.password || url.search || url.hash) return { ok: false, code: "pimcore_url_invalid" };
  const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { ok: false, code: "pimcore_url_https" };
  }
  let path = url.pathname.replace(/\/+$/, "");
  let dataportFromUrl = "";
  const exportAt = path.indexOf(DATA_DIRECTOR_EXPORT_PATH);
  if (exportAt >= 0) {
    dataportFromUrl = decodeURIComponent(path.slice(exportAt + DATA_DIRECTOR_EXPORT_PATH.length).replace(/^\/+/, "").split("/")[0] ?? "");
    path = path.slice(0, exportAt);
  }
  const text2 = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);
  // undefined = nicht angegeben -> Standard; "" = bewusst leer (Aenderungen/Preise nicht genutzt)
  const full = text2(input.articlesFullDataport) || dataportFromUrl || PIMCORE_DEFAULTS.articlesFullDataport;
  const changes = text2(input.articlesChangesDataport) ?? PIMCORE_DEFAULTS.articlesChangesDataport;
  const prices = text2(input.pricesDataport) ?? PIMCORE_DEFAULTS.pricesDataport;
  for (const name of [full, changes, prices]) {
    if (name && !DATAPORT_PATTERN.test(name)) return { ok: false, code: "pimcore_dataport_invalid" };
  }
  const productNumberField = text2(input.productNumberField) || PIMCORE_DEFAULTS.productNumberField;
  if (!FIELD_PATTERN.test(productNumberField)) return { ok: false, code: "pimcore_field_invalid" };
  return {
    ok: true,
    target: {
      baseUrl: `${url.origin}${path}`,
      articlesFullDataport: full,
      articlesChangesDataport: changes,
      pricesDataport: prices,
      productNumberField,
    },
  };
}

export function dataportExportUrl(baseUrl: string, dataport: string, params: Record<string, string> = {}): string {
  const url = new URL(`${baseUrl}${DATA_DIRECTOR_EXPORT_PATH}/${encodeURIComponent(dataport)}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const textOr = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

export async function loadPimcoreConnection(
  getSetting: (key: string) => Promise<any>,
): Promise<StoredPimcoreConnection | null> {
  const stored = await getSetting(PIMCORE_SETTING_KEY);
  if (!stored || typeof stored.baseUrl !== "string" || typeof stored.apiKey !== "string" || !stored.apiKey) return null;
  return {
    baseUrl: stored.baseUrl,
    apiKey: decrypt(stored.apiKey),
    articlesFullDataport: textOr(stored.articlesFullDataport, "") || PIMCORE_DEFAULTS.articlesFullDataport,
    articlesChangesDataport: textOr(stored.articlesChangesDataport, PIMCORE_DEFAULTS.articlesChangesDataport),
    pricesDataport: textOr(stored.pricesDataport, PIMCORE_DEFAULTS.pricesDataport),
    productNumberField: textOr(stored.productNumberField, "") || PIMCORE_DEFAULTS.productNumberField,
  };
}

/** Wert fuer settings: Key verschluesselt */
export function pimcoreConnectionSettingValue(connection: StoredPimcoreConnection): StoredPimcoreConnection {
  return { ...connection, apiKey: encrypt(connection.apiKey) };
}

/** Antwort fuer die Oberflaeche: alles ausser dem Key */
export function describePimcoreConnection(stored: any) {
  return {
    configured: Boolean(stored?.baseUrl && stored?.apiKey),
    baseUrl: textOr(stored?.baseUrl, ""),
    articlesFullDataport: textOr(stored?.articlesFullDataport, "") || PIMCORE_DEFAULTS.articlesFullDataport,
    articlesChangesDataport: textOr(stored?.articlesChangesDataport, PIMCORE_DEFAULTS.articlesChangesDataport),
    pricesDataport: textOr(stored?.pricesDataport, PIMCORE_DEFAULTS.pricesDataport),
    productNumberField: textOr(stored?.productNumberField, "") || PIMCORE_DEFAULTS.productNumberField,
    hasApiKey: Boolean(stored?.apiKey),
  };
}

export type PimcoreApiErrorCode =
  | "pimcore_unreachable"
  | "pimcore_unauthorized"
  | "pimcore_no_rest"
  | "pimcore_dataport_unknown"
  | "pimcore_not_json"
  | "pimcore_failed";

export class PimcoreApiError extends Error {
  constructor(
    readonly code: PimcoreApiErrorCode,
    /** HTTP-Status von Pimcore (null = keine Antwort) */
    readonly status: number | null,
    /** Meldung von Pimcore (gekuerzt) bzw. betroffener Dataport, nur fuer Admins in den Einstellungen */
    readonly detail?: string,
  ) {
    super(`${code}${status ? ` (${status})` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "PimcoreApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Ein Vollexport aller Artikel kann dauern */
const TIMEOUT_MS = 180_000;
const DETAIL_MAX = 300;

const shorten = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text);

/** Meldung aus JSON ({message}/{error}) oder Titel einer HTML-Fehlerseite ("Access Denied.") */
function messageOf(body: any, text: string): string {
  if (typeof body?.message === "string") return body.message;
  if (typeof body?.error === "string") return body.error;
  const title = /<title>([^<]{1,200})<\/title>/i.exec(text)?.[1]?.trim();
  return title ?? "";
}

export class PimcoreClient {
  constructor(
    private readonly connection: Pick<StoredPimcoreConnection, "baseUrl" | "apiKey">,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** Export eines Dataports als JSON abrufen (Achtung: bei "Incremental Export" leert der Abruf den Vorrat) */
  async exportDataport(dataport: string, params: Record<string, string> = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(dataportExportUrl(this.connection.baseUrl, dataport, params), {
        headers: { "X-API-Key": this.connection.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PimcoreApiError("pimcore_unreachable", null);
    }
    const text = await res.text().catch(() => "");
    let body: any;
    let isJson = false;
    try {
      body = text.trim() ? JSON.parse(text) : null;
      isJson = body !== null;
    } catch {
      body = null;
    }
    const message = shorten(messageOf(body, text));
    if (res.status === 401 || res.status === 403) throw new PimcoreApiError("pimcore_unauthorized", res.status, message || undefined);
    if (res.status === 404) {
      // Symfony "No route found": REST-Schnittstelle des Data Director fehlt; sonst unbekannter Dataport
      if (/no route found/i.test(text)) throw new PimcoreApiError("pimcore_no_rest", res.status);
      throw new PimcoreApiError("pimcore_dataport_unknown", res.status, dataport);
    }
    if (!res.ok) throw new PimcoreApiError("pimcore_failed", res.status, message || undefined);
    if (!isJson) throw new PimcoreApiError("pimcore_not_json", res.status, dataport);
    return body;
  }
}

/**
 * Datensaetze aus einer JSON-Antwort des Data Director: Liste, Objekt mit einer Liste (data/items/…)
 * oder Objekt von Objekten (Schluessel = ID). Alles andere: keine Datensaetze.
 */
export function exportRecords(body: unknown): Array<Record<string, unknown>> {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  const lists = Object.values(body).filter(Array.isArray) as unknown[][];
  if (lists.length === 1) return lists[0].filter(isRecord);
  const values = Object.values(body);
  if (values.length > 0 && values.every(isRecord)) return values as Array<Record<string, unknown>>;
  return [body];
}

/** Felder der ersten Datensaetze (Reihenfolge wie geliefert) */
export function exportFields(records: Array<Record<string, unknown>>, sample = 50): string[] {
  const fields = new Set<string>();
  for (const record of records.slice(0, sample)) for (const key of Object.keys(record)) fields.add(key);
  return [...fields];
}

export type PimcoreDataportCheck = {
  dataport: string;
  count: number;
  fields: string[];
  /** Nummernfeld vorhanden (nur Artikel) */
  numberFieldFound?: boolean;
  /** erste Artikelnummer bzw. erster Datensatz gekuerzt */
  sample: string | null;
};

export type PimcoreTestResult = {
  baseUrl: string;
  articles: PimcoreDataportCheck;
  prices: PimcoreDataportCheck | null;
  /** Aenderungs-Dataport wird nicht abgerufen (wuerde den Vorrat leeren) */
  changesDataport: string | null;
};

function sampleText(record: Record<string, unknown> | undefined): string | null {
  if (!record) return null;
  const text = JSON.stringify(record);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * Verbindungstest: Vollexport der Artikel und (falls eingestellt) Preise abrufen, Anzahl, Felder und
 * Beispiel zeigen. Nacheinander, nicht parallel. Den Aenderungs-Dataport nie (siehe oben).
 */
export async function testPimcoreConnection(client: PimcoreClient, connection: StoredPimcoreConnection): Promise<PimcoreTestResult> {
  const check = async (dataport: string, numberField?: string): Promise<PimcoreDataportCheck> => {
    let records: Array<Record<string, unknown>>;
    try {
      records = exportRecords(await client.exportDataport(dataport));
    } catch (error) {
      // welcher Dataport betroffen ist, steht bei unbekannt/kein JSON schon im Detail
      if (error instanceof PimcoreApiError && error.code !== "pimcore_dataport_unknown" && error.code !== "pimcore_not_json") {
        throw new PimcoreApiError(error.code, error.status, error.detail ? `${dataport}: ${error.detail}` : dataport);
      }
      throw error;
    }
    const fields = exportFields(records);
    if (!numberField) return { dataport, count: records.length, fields, sample: sampleText(records[0]) };
    const withNumber = records.find((record) => record[numberField] != null && record[numberField] !== "");
    return {
      dataport,
      count: records.length,
      fields,
      numberFieldFound: fields.includes(numberField),
      sample: withNumber ? String(withNumber[numberField]) : sampleText(records[0]),
    };
  };
  const articles = await check(connection.articlesFullDataport, connection.productNumberField);
  const prices = connection.pricesDataport ? await check(connection.pricesDataport) : null;
  return {
    baseUrl: connection.baseUrl,
    articles,
    prices,
    changesDataport: connection.articlesChangesDataport || null,
  };
}
