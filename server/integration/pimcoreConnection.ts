import { decrypt, encrypt } from "../lib/encryption";

/**
 * Verbindung METAorder -> Pimcore (Datahub, GraphQL). Pimcore fuehrt bei Stammdaten und Preisen;
 * METAorder liest darueber direkt statt auf den Pimcore-Export in den Shop zu warten
 * (Konzept Pimcore-Anbindung-Konzept-2026-10-17.html). Dieser Teil: Adresse, Endpunkt der
 * Datahub-Konfiguration und API-Key je Mandant in settings ("pimcore_connection"), Key verschluesselt
 * wie die uebrigen Zugangsdaten; die Oberflaeche bekommt ihn nie zurueck.
 * Der Key geht nur im Header X-API-Key mit, nie in der Adresse (sonst stuende er in Zugriffsprotokollen).
 * Der Verbindungstest liest per Introspection, welche Klassen und Felder die Konfiguration freigibt,
 * und holt einen Beispiel-Artikel. Fehler tragen einen Code (pimcore_*), die Oberflaeche uebersetzt ihn.
 */

export const PIMCORE_SETTING_KEY = "pimcore_connection";
/** Pfad der Datahub-GraphQL-Endpunkte; dahinter steht der Name der Konfiguration */
export const PIMCORE_GRAPHQL_PATH = "/pimcore-graphql-webservices";

export const PIMCORE_DEFAULTS = { endpoint: "metaorder", productClass: "Artikel", productNumberField: "GTIN" } as const;

export type StoredPimcoreConnection = {
  baseUrl: string;
  /** Name der Datahub-Konfiguration */
  endpoint: string;
  apiKey: string;
  /** Pimcore-Klasse der Artikel */
  productClass: string;
  /** Feld mit der Artikelnummer (= Shop-Artikelnummer) */
  productNumberField: string;
};

/** Hosts, die auch ohne HTTPS erlaubt sind (lokale Entwicklung, Docker) */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

/** Namen von Konfiguration, Klasse und Feld: wie in Pimcore, ohne Sonderzeichen (gehen in Abfragen ein) */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/;
const GRAPHQL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;

export type PimcoreInputErrorCode =
  | "pimcore_url_missing"
  | "pimcore_url_invalid"
  | "pimcore_url_https"
  | "pimcore_endpoint_invalid"
  | "pimcore_class_invalid"
  | "pimcore_field_invalid";

export type PimcoreTarget = Omit<StoredPimcoreConnection, "apiKey">;

/**
 * Eingaben vereinheitlichen. Die Adresse darf auch der komplette Endpunkt sein
 * (".../pimcore-graphql-webservices/metaorder"): dann gilt der Name daraus, wenn kein eigener angegeben ist.
 * HTTPS Pflicht, ausser fuer lokale Hosts; keine Zugangsdaten oder Parameter in der Adresse.
 */
export function normalizePimcoreTarget(input: {
  baseUrl?: unknown;
  endpoint?: unknown;
  productClass?: unknown;
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
  let endpointFromUrl = "";
  const graphqlAt = path.indexOf(PIMCORE_GRAPHQL_PATH);
  if (graphqlAt >= 0) {
    endpointFromUrl = path.slice(graphqlAt + PIMCORE_GRAPHQL_PATH.length).replace(/^\/+/, "").split("/")[0] ?? "";
    path = path.slice(0, graphqlAt);
  }
  const pick = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim() : fallback);
  const endpoint = pick(input.endpoint, endpointFromUrl || PIMCORE_DEFAULTS.endpoint);
  if (!NAME_PATTERN.test(endpoint)) return { ok: false, code: "pimcore_endpoint_invalid" };
  const productClass = pick(input.productClass, PIMCORE_DEFAULTS.productClass);
  if (!GRAPHQL_NAME_PATTERN.test(productClass)) return { ok: false, code: "pimcore_class_invalid" };
  const productNumberField = pick(input.productNumberField, PIMCORE_DEFAULTS.productNumberField);
  if (!GRAPHQL_NAME_PATTERN.test(productNumberField)) return { ok: false, code: "pimcore_field_invalid" };
  return { ok: true, target: { baseUrl: `${url.origin}${path}`, endpoint, productClass, productNumberField } };
}

export function pimcoreEndpointUrl(connection: Pick<StoredPimcoreConnection, "baseUrl" | "endpoint">): string {
  return `${connection.baseUrl}${PIMCORE_GRAPHQL_PATH}/${encodeURIComponent(connection.endpoint)}`;
}

export async function loadPimcoreConnection(
  getSetting: (key: string) => Promise<any>,
): Promise<StoredPimcoreConnection | null> {
  const stored = await getSetting(PIMCORE_SETTING_KEY);
  if (!stored || typeof stored.baseUrl !== "string" || typeof stored.apiKey !== "string" || !stored.apiKey) return null;
  return {
    baseUrl: stored.baseUrl,
    endpoint: typeof stored.endpoint === "string" && stored.endpoint ? stored.endpoint : PIMCORE_DEFAULTS.endpoint,
    apiKey: decrypt(stored.apiKey),
    productClass: typeof stored.productClass === "string" && stored.productClass ? stored.productClass : PIMCORE_DEFAULTS.productClass,
    productNumberField:
      typeof stored.productNumberField === "string" && stored.productNumberField
        ? stored.productNumberField
        : PIMCORE_DEFAULTS.productNumberField,
  };
}

/** Wert fuer settings: Key verschluesselt */
export function pimcoreConnectionSettingValue(connection: StoredPimcoreConnection): StoredPimcoreConnection {
  return { ...connection, apiKey: encrypt(connection.apiKey) };
}

/** Antwort fuer die Oberflaeche: alles ausser dem Key */
export function describePimcoreConnection(stored: any) {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    configured: Boolean(stored?.baseUrl && stored?.apiKey),
    baseUrl: text(stored?.baseUrl),
    endpoint: text(stored?.endpoint) || PIMCORE_DEFAULTS.endpoint,
    productClass: text(stored?.productClass) || PIMCORE_DEFAULTS.productClass,
    productNumberField: text(stored?.productNumberField) || PIMCORE_DEFAULTS.productNumberField,
    hasApiKey: Boolean(stored?.apiKey),
  };
}

export type PimcoreApiErrorCode =
  | "pimcore_unreachable"
  | "pimcore_unauthorized"
  | "pimcore_no_datahub"
  | "pimcore_endpoint_unknown"
  | "pimcore_not_graphql"
  | "pimcore_graphql_error"
  | "pimcore_class_missing"
  | "pimcore_failed";

export class PimcoreApiError extends Error {
  constructor(
    readonly code: PimcoreApiErrorCode,
    /** HTTP-Status von Pimcore (null = keine Antwort) */
    readonly status: number | null,
    /** Meldung von Pimcore/GraphQL (gekuerzt), nur fuer Admins in den Einstellungen */
    readonly detail?: string,
  ) {
    super(`${code}${status ? ` (${status})` : ""}${detail ? `: ${detail}` : ""}`);
    this.name = "PimcoreApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 20_000;
const DETAIL_MAX = 300;
/** Klassen, deren Felder der Test zeigt, hoechstens */
const MAX_CLASSES = 40;

const shorten = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text);

function messageOf(body: any): string {
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    return body.errors.map((e: any) => (typeof e?.message === "string" ? e.message : "")).filter(Boolean).join("; ");
  }
  if (typeof body?.message === "string") return body.message;
  if (typeof body?.error === "string") return body.error;
  return "";
}

export class PimcoreClient {
  constructor(
    private readonly connection: StoredPimcoreConnection,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** GraphQL-Abfrage; Fehler der Abfrage (errors) werfen pimcore_graphql_error */
  async query<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(pimcoreEndpointUrl(this.connection), {
        method: "POST",
        headers: { "X-API-Key": this.connection.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(variables ? { query, variables } : { query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PimcoreApiError("pimcore_unreachable", null);
    }
    const text = await res.text().catch(() => "");
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (res.status === 401 || res.status === 403) {
      // Datahub antwortet auch bei unbekannter Konfiguration mit 403 – an der Meldung unterscheiden
      const message = messageOf(body);
      if (/configuration|not found|nicht gefunden/i.test(message)) {
        throw new PimcoreApiError("pimcore_endpoint_unknown", res.status, shorten(message));
      }
      throw new PimcoreApiError("pimcore_unauthorized", res.status, message ? shorten(message) : undefined);
    }
    if (!body || typeof body !== "object") {
      // HTML statt JSON: auf 404 ist der Datahub-Pfad gar nicht vorhanden (Datahub fehlt oder ist aus)
      throw new PimcoreApiError(res.status === 404 ? "pimcore_no_datahub" : "pimcore_not_graphql", res.status);
    }
    if (res.status === 404) throw new PimcoreApiError("pimcore_endpoint_unknown", res.status, shorten(messageOf(body)) || undefined);
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      throw new PimcoreApiError("pimcore_graphql_error", res.status, shorten(messageOf(body)));
    }
    if (!res.ok) throw new PimcoreApiError("pimcore_failed", res.status, shorten(messageOf(body)) || undefined);
    if (!("data" in body)) throw new PimcoreApiError("pimcore_not_graphql", res.status);
    return body.data as T;
  }
}

export type PimcoreFieldInfo = { name: string; type: string };
export type PimcoreClassInfo = { name: string; listingField: string; fields: PimcoreFieldInfo[] };
export type PimcoreTestResult = {
  endpointUrl: string;
  /** false = Introspection in der Datahub-Konfiguration abgeschaltet */
  introspection: boolean;
  classes: PimcoreClassInfo[];
  product: {
    className: string;
    numberField: string;
    /** Feld gibt es in der Klasse (bzw. unbekannt ohne Introspection) */
    numberFieldFound: boolean | null;
    totalCount: number | null;
    sample: { id: string; number: string | null } | null;
  };
};

/** Typname aus der Introspection lesbar machen: [String]!, object_Artikel … */
function typeLabel(type: any): string {
  if (!type) return "";
  if (type.kind === "NON_NULL") return `${typeLabel(type.ofType)}!`;
  if (type.kind === "LIST") return `[${typeLabel(type.ofType)}]`;
  return String(type.name ?? "");
}

const SCHEMA_QUERY = `query MetaorderSchema { __schema { queryType { fields { name type { name kind } } } } }`;
const TYPE_QUERY = `query MetaorderType($name: String!) {
  __type(name: $name) { name fields { name type { name kind ofType { name kind ofType { name kind ofType { name kind } } } } } }
}`;

/** Klassen aus den Listen-Abfragen der Konfiguration: getArtikelListing -> Artikel */
export function classesFromQueryFields(fields: Array<{ name?: unknown; type?: any }>): Array<{ name: string; listingField: string; typeName: string | null }> {
  const classes: Array<{ name: string; listingField: string; typeName: string | null }> = [];
  for (const field of fields) {
    const match = typeof field?.name === "string" ? /^get(.+)Listing$/.exec(field.name) : null;
    if (!match) continue;
    // Listen-Typ heisst "<Klasse>Connection" bzw. "object_<Klasse>Connection"; Objekt-Typ "object_<Klasse>"
    classes.push({ name: match[1], listingField: field.name as string, typeName: `object_${match[1]}` });
  }
  return classes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Verbindungstest: Schema per Introspection (welche Klassen/Felder freigegeben sind) und ein
 * Beispiel-Artikel der eingestellten Klasse. Ohne Introspection nur der Beispiel-Artikel.
 */
export async function testPimcoreConnection(client: PimcoreClient, connection: StoredPimcoreConnection): Promise<PimcoreTestResult> {
  let introspection = true;
  let classes: PimcoreClassInfo[] = [];
  try {
    const schema = await client.query<any>(SCHEMA_QUERY);
    const found = classesFromQueryFields(schema?.__schema?.queryType?.fields ?? []).slice(0, MAX_CLASSES);
    classes = [];
    for (const cls of found) {
      // nacheinander, nicht parallel: Pimcore nicht mit vielen Abfragen auf einmal belasten
      const type = await client.query<any>(TYPE_QUERY, { name: cls.typeName });
      const fields: PimcoreFieldInfo[] = Array.isArray(type?.__type?.fields)
        ? type.__type.fields
            .map((f: any) => ({ name: String(f?.name ?? ""), type: typeLabel(f?.type) }))
            .filter((f: PimcoreFieldInfo) => f.name)
        : [];
      classes.push({ name: cls.name, listingField: cls.listingField, fields });
    }
  } catch (error) {
    // abgeschaltete Introspection meldet GraphQL als Fehler der Abfrage; alles andere weiterreichen
    if (!(error instanceof PimcoreApiError) || error.code !== "pimcore_graphql_error") throw error;
    introspection = false;
  }

  const className = connection.productClass;
  const numberField = connection.productNumberField;
  const productClass = classes.find((cls) => cls.name === className);
  if (introspection && !productClass) {
    throw new PimcoreApiError("pimcore_class_missing", null, className);
  }
  // ohne Felder (Typ unter anderem Namen) bleibt offen, ob es das Feld gibt: dann einfach abfragen
  const numberFieldFound =
    productClass && productClass.fields.length > 0 ? productClass.fields.some((f) => f.name === numberField) : null;
  // Namen sind geprueft (normalizePimcoreTarget), duerfen also in die Abfrage
  const sampleSelection = numberFieldFound === false ? "id" : `id ${numberField}`;
  const listing = await client.query<any>(
    `query MetaorderSample { get${className}Listing(first: 1) { totalCount edges { node { ${sampleSelection} } } } }`,
  );
  const result = listing?.[`get${className}Listing`];
  const node = Array.isArray(result?.edges) ? result.edges[0]?.node : null;
  const rawNumber = node && numberFieldFound !== false ? node[numberField] : null;
  return {
    endpointUrl: pimcoreEndpointUrl(connection),
    introspection,
    classes,
    product: {
      className,
      numberField,
      numberFieldFound: numberFieldFound ?? (node && rawNumber !== undefined ? true : null),
      totalCount: typeof result?.totalCount === "number" ? result.totalCount : null,
      sample: node ? { id: String(node.id ?? ""), number: rawNumber == null ? null : String(rawNumber) } : null,
    },
  };
}
