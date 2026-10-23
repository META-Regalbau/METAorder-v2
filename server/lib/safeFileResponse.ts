import type { Response } from "express";

/**
 * Sichere Auslieferung hochgeladener/empfangener Dateien (Mail-Anhänge, Uploads).
 *
 * Der MIME-Typ eines Anhangs kommt vom Absender. Würden wir ihn ungeprüft und
 * `inline` von der App-Domain ausliefern, liefe z. B. ein SVG oder HTML mit
 * Skript in der angemeldeten Sitzung des Mitarbeiters (Stored XSS). Deshalb:
 * - inline nur für eine feste Liste harmloser Typen (PDF, Rasterbilder, Text),
 * - alles andere als `application/octet-stream` zum Herunterladen,
 * - zusätzlich `CSP: sandbox` (eigener, skriptloser Ursprung). PDF bleibt ohne
 *   Sandbox, weil Chrome PDFs in einer Sandbox nicht anzeigt; der PDF-Viewer
 *   führt kein Seiten-JavaScript im App-Ursprung aus.
 */
const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "text/plain",
]);

const SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

export function normalizeMimeType(mimeType: string | null | undefined): string {
  return (mimeType || "").split(";")[0].trim().toLowerCase();
}

export function isInlineSafeMimeType(mimeType: string | null | undefined): boolean {
  return INLINE_SAFE_TYPES.has(normalizeMimeType(mimeType));
}

export type SafeFileHeaders = {
  "Content-Type": string;
  "Content-Disposition": string;
  "Content-Security-Policy"?: string;
  "X-Content-Type-Options": "nosniff";
};

/**
 * Header für eine Datei-Antwort. `wanted` ist, was die Route möchte (Vorschau
 * oder Download); unsichere Typen werden immer zum Download mit neutralem Typ.
 */
export function safeFileHeaders(params: {
  mimeType: string | null | undefined;
  fileName: string;
  wanted: "inline" | "attachment";
}): SafeFileHeaders {
  const mime = normalizeMimeType(params.mimeType);
  const safe = INLINE_SAFE_TYPES.has(mime);
  const disposition = params.wanted === "inline" && safe ? "inline" : "attachment";
  const contentType = !safe ? "application/octet-stream" : mime === "text/plain" ? "text/plain; charset=utf-8" : mime;
  const headers: SafeFileHeaders = {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${encodeURIComponent(params.fileName)}"`,
    "X-Content-Type-Options": "nosniff",
  };
  if (mime !== "application/pdf") headers["Content-Security-Policy"] = SANDBOX_CSP;
  return headers;
}

export function setSafeFileHeaders(res: Response, params: Parameters<typeof safeFileHeaders>[0]): SafeFileHeaders {
  const headers = safeFileHeaders(params);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  return headers;
}
