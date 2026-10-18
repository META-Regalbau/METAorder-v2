/**
 * Shop-Puls, GA4-Anbindung (PR E): nutzt die Einstellungen unter Einstellungen → Google Analytics
 * (ga4_settings: Property-ID, Dienstkonto-JSON verschlüsselt). Tests simulieren den Client
 * (runReport/runRealtimeReport) in tests/unit/shopPulseGa4.test.ts.
 *
 * Nötig sind die numerische Property-ID (z. B. 123456789, nicht die Mess-ID „G-…“ des Shops) und ein
 * Dienstkonto mit Leserechten (Betrachter) in der GA4-Property. Fehlt etwas, wirft der Zugriff
 * Ga4NotConfiguredError; die GA4-Prüfungen setzen dann aus (keine Funde, Hinweis auf der Seite).
 *
 * Abfragen laufen nacheinander, nie parallel (Kontingent der Property schonen).
 */
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type { Ga4SetupProblem } from "@shared/shopPulse";
import type { IStorage } from "../storage";
import { getGoogleAnalyticsSettings } from "../analytics/googleKpi";

export class Ga4NotConfiguredError extends Error {
  constructor(readonly reason: Ga4SetupProblem) {
    super(`GA4 nicht eingerichtet (${reason})`);
    this.name = "Ga4NotConfiguredError";
  }
}

/** Antwort des Google-Clients, so weit sie hier gelesen wird */
export type Ga4RawResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string | null }> | null;
    metricValues?: Array<{ value?: string | null }> | null;
  }> | null;
};

/** Die beiden Methoden des BetaAnalyticsDataClient, die der Shop-Puls nutzt */
export type Ga4DataClient = {
  runReport(request: Record<string, unknown>): Promise<[Ga4RawResponse, ...unknown[]]>;
  runRealtimeReport(request: Record<string, unknown>): Promise<[Ga4RawResponse, ...unknown[]]>;
};

/** Eine Zeile: Dimensionen und Kennzahlen in Abfrage-Reihenfolge */
export type Ga4Row = { d: string[]; m: number[] };

export type Ga4Filter =
  | { field: string; inList: string[] }
  | { field: string; equals: string }
  | { field: string; contains: string };

export type Ga4ReportRequest = {
  dimensions: string[];
  metrics: string[];
  /** YYYY-MM-DD oder „today“/„yesterday“/„NdaysAgo“ */
  startDate: string;
  endDate: string;
  filter?: Ga4Filter;
  /** absteigend nach der ersten Kennzahl */
  orderByMetric?: boolean;
  limit?: number;
};

export type Ga4RealtimeRequest = { dimensions: string[]; metrics: string[]; filter?: Ga4Filter };

export type Ga4Property = {
  propertyId: string;
  report(req: Ga4ReportRequest): Promise<Ga4Row[]>;
  realtime(req: Ga4RealtimeRequest): Promise<Ga4Row[]>;
};

export type Ga4Access = {
  /** Property mit Client; wirft Ga4NotConfiguredError, wenn GA4 nicht eingerichtet ist */
  property(): Promise<Ga4Property>;
};

const MAX_ROWS = 100_000;

function dimensionFilter(f: Ga4Filter): Record<string, unknown> {
  const filter: Record<string, unknown> = { fieldName: f.field };
  if ("inList" in f) filter.inListFilter = { values: f.inList };
  else if ("equals" in f) filter.stringFilter = { matchType: "EXACT", value: f.equals };
  else filter.stringFilter = { matchType: "CONTAINS", value: f.contains, caseSensitive: false };
  return { filter };
}

function toRows(res: Ga4RawResponse | undefined): Ga4Row[] {
  return (res?.rows ?? []).map((r) => ({
    d: (r.dimensionValues ?? []).map((v) => String(v.value ?? "")),
    m: (r.metricValues ?? []).map((v) => {
      const n = Number(v.value ?? 0);
      return Number.isFinite(n) ? n : 0;
    }),
  }));
}

/** Fehler des Google-Clients in einen verständlichen Text (Code 7 = keine Berechtigung, 5 = Property unbekannt) */
function explain(err: unknown, propertyId: string): Error {
  const code = (err as { code?: number })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 7 || /PERMISSION_DENIED/i.test(msg)) return new Error(`GA4: Das Dienstkonto hat keine Leserechte in der Property ${propertyId}`);
  if (code === 5 || /NOT_FOUND/i.test(msg)) return new Error(`GA4: Property ${propertyId} nicht gefunden`);
  if (code === 16 || /UNAUTHENTICATED|invalid_grant|Getting metadata from plugin failed/i.test(msg)) {
    return new Error("GA4: Anmeldung mit dem Dienstkonto gescheitert (Schlüssel ungültig oder gesperrt)");
  }
  return new Error(`GA4: ${msg.slice(0, 200)}`);
}

export function ga4Property(client: Ga4DataClient, propertyId: string): Ga4Property {
  const property = `properties/${propertyId}`;
  const base = (req: { dimensions: string[]; metrics: string[]; filter?: Ga4Filter }) => ({
    property,
    dimensions: req.dimensions.map((name) => ({ name })),
    metrics: req.metrics.map((name) => ({ name })),
    ...(req.filter ? { dimensionFilter: dimensionFilter(req.filter) } : {}),
  });
  return {
    propertyId,
    async report(req) {
      const [res] = await client
        .runReport({
          ...base(req),
          dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
          limit: req.limit ?? MAX_ROWS,
          ...(req.orderByMetric ? { orderBys: [{ metric: { metricName: req.metrics[0] }, desc: true }] } : {}),
        })
        .catch((err) => Promise.reject(explain(err, propertyId)));
      return toRows(res);
    },
    async realtime(req) {
      // Standard-Properties: die letzten 30 Minuten
      const [res] = await client.runRealtimeReport({ ...base(req), limit: MAX_ROWS }).catch((err) => Promise.reject(explain(err, propertyId)));
      return toRows(res);
    },
  };
}

export type Ga4Setup = { ok: true; propertyId: string; credentials: Record<string, unknown> } | { ok: false; reason: Ga4SetupProblem };

/** Einstellungen prüfen: eingeschaltet, numerische Property-ID, Dienstkonto-JSON mit Schlüssel */
export function checkGa4Setup(settings: { enabled?: boolean; propertyIds?: string[]; serviceAccountJson?: string }): Ga4Setup {
  if (!settings.enabled) return { ok: false, reason: "disabled" };
  const raw = (settings.propertyIds ?? []).map((p) => p.trim()).find(Boolean);
  if (!raw) return { ok: false, reason: "noProperty" };
  if (/^G-/i.test(raw)) return { ok: false, reason: "measurementId" };
  const id = raw.replace(/^properties\//, "");
  if (!/^\d{5,}$/.test(id)) return { ok: false, reason: "invalidProperty" };
  if (!settings.serviceAccountJson?.trim()) return { ok: false, reason: "noServiceAccount" };
  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(settings.serviceAccountJson);
  } catch {
    return { ok: false, reason: "invalidServiceAccount" };
  }
  if (!credentials || typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") return { ok: false, reason: "invalidServiceAccount" };
  return { ok: true, propertyId: id, credentials };
}

/** GA4 des Mandanten; Client und Einstellungen werden je Lauf einmal geladen */
export function ga4Access(
  storage: Pick<IStorage, "getSetting">,
  tenantId: string | null,
  makeClient: (credentials: Record<string, unknown>) => Ga4DataClient = (credentials) =>
    new BetaAnalyticsDataClient({ credentials }) as unknown as Ga4DataClient,
): Ga4Access {
  let p: Promise<Ga4Property> | null = null;
  return {
    property: () =>
      (p ??= (async () => {
        const setup = checkGa4Setup(await getGoogleAnalyticsSettings(storage, tenantId));
        if (!setup.ok) throw new Ga4NotConfiguredError(setup.reason);
        return ga4Property(makeClient(setup.credentials), setup.propertyId);
      })()),
  };
}
