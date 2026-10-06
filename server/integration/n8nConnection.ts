import { decrypt, encrypt } from "../lib/encryption";

/**
 * Verbindung METAorder -> n8n (Public API, Header X-N8N-API-KEY). E-Mails kommen nur ueber n8n
 * herein; damit man in METAorder sieht, ob die Mail-Workflows laufen und an METAorder liefern,
 * liest METAorder Workflows und letzte Ausfuehrungen. Adresse und API-Key liegen je Mandant in
 * settings ("n8n_connection"), der Key verschluesselt wie die uebrigen Zugangsdaten; die
 * Oberflaeche bekommt ihn nie zurueck.
 * Aus den Workflows wird nur Unbedenkliches gelesen: Name, Knotentypen, Upload-Ziel ohne Query.
 * Parameter-Werte (dort stehen manchmal Header oder Tokens) und gepinnte Daten bleiben in n8n.
 * Fehler tragen einen Code (n8n_*), die Oberflaeche uebersetzt ihn (apiErrors.codes).
 */

export const N8N_SETTING_KEY = "n8n_connection";

export type StoredN8nConnection = { baseUrl: string; apiKey: string };

/** Hosts, die auch ohne HTTPS erlaubt sind (lokale Entwicklung, Docker-Dienstname) */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "n8n", "host.docker.internal"]);

/**
 * Adresse vereinheitlichen: ohne Schraegstrich am Ende und ohne "/api/v1" (falls mit eingefuegt).
 * HTTPS Pflicht, ausser fuer lokale Hosts; keine Zugangsdaten in der Adresse.
 */
export type N8nUrlErrorCode = "n8n_url_missing" | "n8n_url_invalid" | "n8n_url_https";

export function normalizeN8nBaseUrl(raw: unknown): { ok: true; baseUrl: string } | { ok: false; code: N8nUrlErrorCode } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, code: "n8n_url_missing" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: "n8n_url_invalid" };
  }
  if (url.username || url.password || url.search || url.hash) return { ok: false, code: "n8n_url_invalid" };
  const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { ok: false, code: "n8n_url_https" };
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return { ok: true, baseUrl: `${url.origin}${path}` };
}

export async function loadN8nConnection(
  getSetting: (key: string) => Promise<any>,
): Promise<StoredN8nConnection | null> {
  const stored = await getSetting(N8N_SETTING_KEY);
  if (!stored || typeof stored.baseUrl !== "string" || typeof stored.apiKey !== "string" || !stored.apiKey) return null;
  return { baseUrl: stored.baseUrl, apiKey: decrypt(stored.apiKey) };
}

/** Wert fuer settings: Key verschluesselt */
export function n8nConnectionSettingValue(connection: StoredN8nConnection): StoredN8nConnection {
  return { baseUrl: connection.baseUrl, apiKey: encrypt(connection.apiKey) };
}

export type N8nApiErrorCode = "n8n_unreachable" | "n8n_unauthorized" | "n8n_no_api" | "n8n_failed";

export class N8nApiError extends Error {
  constructor(
    readonly code: N8nApiErrorCode,
    /** HTTP-Status von n8n (null = keine Antwort) */
    readonly status: number | null,
  ) {
    super(`${code}${status ? ` (${status})` : ""}`);
    this.name = "N8nApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;
/** Workflows hoechstens 4 Seiten a 100 */
const MAX_WORKFLOW_PAGES = 4;

export class N8nClient {
  constructor(
    private readonly connection: StoredN8nConnection,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async get(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<any> {
    const url = new URL(`${this.connection.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { "X-N8N-API-KEY": this.connection.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new N8nApiError("n8n_unreachable", null);
    }
    if (res.status === 401 || res.status === 403) throw new N8nApiError("n8n_unauthorized", res.status);
    if (res.status === 404) throw new N8nApiError("n8n_no_api", res.status);
    if (!res.ok) throw new N8nApiError("n8n_failed", res.status);
    try {
      return await res.json();
    } catch {
      // z. B. HTML-Seite statt JSON: Adresse zeigt nicht auf n8n
      throw new N8nApiError("n8n_no_api", res.status);
    }
  }

  /** Verbindung pruefen: ein Workflow genuegt */
  async test(): Promise<void> {
    await this.get("/workflows", { limit: 1, excludePinnedData: true });
  }

  async listWorkflows(): Promise<any[]> {
    const workflows: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_WORKFLOW_PAGES; page++) {
      const body = await this.get("/workflows", { limit: 100, excludePinnedData: true, cursor });
      workflows.push(...(Array.isArray(body?.data) ? body.data : []));
      cursor = typeof body?.nextCursor === "string" && body.nextCursor ? body.nextCursor : undefined;
      if (!cursor) break;
    }
    return workflows;
  }

  async listExecutions(workflowId: string, limit = 20): Promise<any[]> {
    const body = await this.get("/executions", { workflowId, limit, includeData: false });
    return Array.isArray(body?.data) ? body.data : [];
  }
}

export type MailSource = "m365" | "gmail" | "imap";

export type N8nWorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string | null;
  /** Postfach, aus dem der Workflow liest (Trigger-/Leseknoten) */
  mailSources: MailSource[];
  /** HTTP-Knoten, die an /api/commercial-drafts/upload senden: Ziel ohne Query */
  metaorderUploads: string[];
  /** Upload-Ziel ist ein anderer Server als dieses METAorder (z. B. lokale Adresse in Produktion) */
  uploadsElsewhere: boolean;
  nodes: Array<{ name: string; type: string; disabled: boolean }>;
  executions: {
    total: number;
    success: number;
    error: number;
    running: number;
    lastStartedAt: string | null;
    lastStatus: string | null;
    lastErrorAt: string | null;
  } | null;
};

const MAIL_NODE_TYPES: Record<string, MailSource> = {
  "n8n-nodes-base.microsoftOutlookTrigger": "m365",
  "n8n-nodes-base.microsoftOutlook": "m365",
  "n8n-nodes-base.gmailTrigger": "gmail",
  "n8n-nodes-base.gmail": "gmail",
  "n8n-nodes-base.emailReadImap": "imap",
};

const UPLOAD_PATH = "/api/commercial-drafts/upload";

/** Upload-Ziel eines HTTP-Knotens ohne Query und Ausdrucks-Klammern ("={{ ... }}/api/..." -> "{…}/api/...") */
function uploadTarget(url: unknown): string | null {
  if (typeof url !== "string" || !url.includes(UPLOAD_PATH)) return null;
  const withoutQuery = url.replace(/^=/, "").split("?")[0];
  return withoutQuery.replace(/\{\{[\s\S]*?\}\}/g, "{…}");
}

export function summarizeN8nWorkflow(workflow: any, ownOrigin: string | null): Omit<N8nWorkflowSummary, "executions"> {
  const nodes: any[] = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const mailSources = [...new Set(nodes.map((node) => MAIL_NODE_TYPES[node?.type]).filter(Boolean))] as MailSource[];
  const metaorderUploads = nodes
    .filter((node) => node?.type === "n8n-nodes-base.httpRequest" && !node.disabled)
    .map((node) => uploadTarget(node?.parameters?.url))
    .filter((target): target is string => Boolean(target));
  const uploadsElsewhere = Boolean(ownOrigin) && metaorderUploads.some((target) => {
    try {
      return new URL(target).origin !== ownOrigin;
    } catch {
      return false; // Ausdruck: Ziel steht erst zur Laufzeit fest
    }
  });
  return {
    id: String(workflow?.id ?? ""),
    name: String(workflow?.name ?? ""),
    active: Boolean(workflow?.active),
    updatedAt: typeof workflow?.updatedAt === "string" ? workflow.updatedAt : null,
    mailSources,
    metaorderUploads,
    uploadsElsewhere,
    nodes: nodes.map((node) => ({ name: String(node?.name ?? ""), type: String(node?.type ?? ""), disabled: Boolean(node?.disabled) })),
  };
}

export function summarizeN8nExecutions(executions: any[]): NonNullable<N8nWorkflowSummary["executions"]> {
  const sorted = [...executions].sort((a, b) => String(b?.startedAt ?? "").localeCompare(String(a?.startedAt ?? "")));
  const count = (status: string) => sorted.filter((execution) => execution?.status === status).length;
  const lastError = sorted.find((execution) => execution?.status === "error" || execution?.status === "crashed");
  return {
    total: sorted.length,
    success: count("success"),
    error: count("error") + count("crashed"),
    running: count("running") + count("waiting") + count("new"),
    lastStartedAt: sorted[0]?.startedAt ?? null,
    lastStatus: sorted[0]?.status ?? null,
    lastErrorAt: lastError?.startedAt ?? null,
  };
}

/**
 * Uebersicht fuer die Einstellungen: alle Workflows; Ausfuehrungen nur fuer die, die Mails lesen oder
 * an METAorder hochladen (sonst waeren es bei vielen Workflows viele Abrufe). Mail-Workflows zuerst.
 */
export async function loadN8nOverview(client: N8nClient, ownOrigin: string | null): Promise<N8nWorkflowSummary[]> {
  const workflows = (await client.listWorkflows()).filter((workflow) => !workflow?.isArchived);
  const summaries = workflows.map((workflow) => summarizeN8nWorkflow(workflow, ownOrigin));
  const relevant = (summary: Omit<N8nWorkflowSummary, "executions">) =>
    summary.mailSources.length > 0 || summary.metaorderUploads.length > 0;
  const withExecutions = await Promise.all(
    summaries.map(async (summary) => ({
      ...summary,
      executions: relevant(summary) ? summarizeN8nExecutions(await client.listExecutions(summary.id)) : null,
    })),
  );
  return withExecutions.sort(
    (a, b) =>
      Number(relevant(b)) - Number(relevant(a)) ||
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name),
  );
}
