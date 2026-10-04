import fs from "fs/promises";

/**
 * Commercial-Agent / Intent-Debugging ohne Standard-Logs zu fluten.
 *
 * Aktivierung: COMMERCIAL_AGENT_DEBUG=true (oder 1 / yes)
 * Optional: COMMERCIAL_AGENT_DEBUG_FILE=/app/uploads/commercial-agent-debug.ndjson
 *           COMMERCIAL_AGENT_DEBUG_VERBOSE=true → längere Textausschnitte (PII beachten)
 */
function envTruthy(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function isCommercialAgentDebugEnabled(): boolean {
  return envTruthy("COMMERCIAL_AGENT_DEBUG");
}

const DEBUG_FILE = () => (process.env.COMMERCIAL_AGENT_DEBUG_FILE || "").trim();
const VERBOSE = () => envTruthy("COMMERCIAL_AGENT_DEBUG_VERBOSE");

const maxStringLen = () => (VERBOSE() ? 5000 : 400);
const maxPreviewLen = () => (VERBOSE() ? 1200 : 180);

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const max = maxStringLen();
    if (value.length <= max) return value;
    const prev = maxPreviewLen();
    return `${value.slice(0, prev)}…(+${value.length - prev} chars)`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(o)) {
      if (n++ >= 40) break;
      const kl = k.toLowerCase();
      if (kl.includes("apikey") || kl.includes("password") || kl.includes("secret") || kl.includes("token")) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 200);
}

/**
 * Eine NDJSON-Zeile: stdout + optional Datei (fire-and-forget).
 * @param traceId Optional gleiche ID pro Mail/Lauf (z. B. RFC Message-ID oder `manual-…`) — für `jq` / grep.
 */
export function logCommercialAgentDebug(
  event: string,
  data: Record<string, unknown>,
  traceId?: string | null
): void {
  if (!isCommercialAgentDebugEnabled()) return;
  const tid = traceId?.trim();
  const body = tid ? { traceId: tid, ...data } : data;
  const payload = sanitize({
    ts: new Date().toISOString(),
    event,
    ...body,
  }) as Record<string, unknown>;
  const line = JSON.stringify(payload);
  console.log(`[CommercialAgent:debug] ${line}`);
  const path = DEBUG_FILE();
  if (path) {
    void fs.appendFile(path, `${line}\n`, "utf8").catch((err) =>
      console.warn("[CommercialAgent:debug] append failed:", err)
    );
  }
}
