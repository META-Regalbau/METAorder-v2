import i18next from "i18next";

/**
 * Fehler aus Server-Antworten in der Sprache der Oberflaeche. Vorher warf apiRequest
 * `500: {"error":"Failed to fetch tickets"}` - genau so stand es in Hinweisen, und der Server antwortet
 * gemischt englisch/deutsch (rund 460 feste Texte). Jetzt:
 * - ApiError mit Status, Code, Servertext und der rohen Antwort (`raw`, altes Format "Status: Text")
 * - message = Text in der Sprache der Oberflaeche:
 *   1. Code der Antwort (apiErrors.codes.<code>)
 *   2. fester Servertext (apiErrors.messages.<apiErrorKey(text)>, vollstaendig per apiErrorCatalog.test.ts)
 *   3. sonst der Servertext selbst (dynamische/technische Meldungen); bei Serverfehlern (5xx) mit
 *      uebersetztem Rahmen "Serverfehler: ...", lange Texte gekuerzt
 *   4. ohne Text eine Meldung je Status (apiErrors.status.*)
 * Pruefungen auf bestimmte Servertexte ("not configured" usw.) nutzen apiErrorRaw, nicht message.
 */

export type ApiErrorInfo = {
  status: number;
  code?: string;
  /** error- bzw. message-Feld der Antwort, sonst der Antworttext (ohne HTML-Fehlerseiten) */
  serverText: string;
  /** genauere Angabe, wenn die Antwort error UND message hat ("Shopware API error" + Grund) */
  detail?: string;
  body: unknown;
};

export class ApiError extends Error implements ApiErrorInfo {
  readonly status: number;
  readonly code?: string;
  readonly serverText: string;
  readonly detail?: string;
  readonly body: unknown;
  /** Rohform wie frueher: "Status: Antworttext" */
  readonly raw: string;

  constructor(info: ApiErrorInfo, raw: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = info.status;
    this.code = info.code;
    this.serverText = info.serverText;
    this.detail = info.detail;
    this.body = info.body;
    this.raw = raw;
  }
}

type Translator = {
  t: (key: string, options?: Record<string, unknown>) => string;
  exists: (key: string) => boolean;
};

const defaultTranslator: Translator = {
  t: (key, options) => String(i18next.t(key, options)),
  exists: (key) => i18next.exists(key),
};

/** Schluessel eines Servertexts: Kleinbuchstaben, ohne Akzente, Nicht-Buchstaben als "_", hoechstens 80 Zeichen */
export function apiErrorKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

/** Antworttext zerlegen: JSON mit error/message/code, sonst Klartext; HTML-Fehlerseiten (Proxy) ergeben keinen Text */
export function parseApiErrorBody(status: number, text: string): ApiErrorInfo {
  const trimmed = text.trim();
  try {
    const body = JSON.parse(trimmed) as Record<string, unknown> | null;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const pick = (value: unknown) => (typeof value === "string" ? value.trim() : "");
      const error = pick(body.error);
      const message = pick(body.message);
      return {
        status,
        code: pick(body.code) || undefined,
        serverText: error || message,
        detail: error && message && message !== error ? message : undefined,
        body,
      };
    }
  } catch {
    // kein JSON
  }
  const isHtml = /^<(!doctype|html|head|body)\b/i.test(trimmed);
  return { status, serverText: isHtml ? "" : trimmed, body: null };
}

const MAX_DETAIL = 300;
const shorten = (text: string) => (text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text);

/** Meldung in der Sprache der Oberflaeche (Reihenfolge siehe oben) */
export function apiErrorText(
  info: Pick<ApiErrorInfo, "status" | "code" | "serverText" | "detail">,
  translator: Translator = defaultTranslator,
): string {
  if (info.code && translator.exists(`apiErrors.codes.${info.code}`)) {
    return translator.t(`apiErrors.codes.${info.code}`);
  }
  const known = (text: string) => {
    const key = `apiErrors.messages.${apiErrorKey(text)}`;
    return translator.exists(key) ? translator.t(key) : null;
  };
  if (info.detail) {
    // genauere Angabe: bekannt -> nur sie; sonst allgemeiner Text mit Grund ("Shopware-API-Fehler: ...")
    return known(info.detail) ?? `${known(info.serverText) ?? info.serverText}: ${info.detail}`;
  }
  if (info.serverText) {
    const translated = known(info.serverText);
    if (translated) return translated;
    return info.status >= 500
      ? translator.t("apiErrors.status.serverDetail", { detail: shorten(info.serverText) })
      : info.serverText;
  }
  const statusKey = `apiErrors.status.${info.status}`;
  if (translator.exists(statusKey)) return translator.t(statusKey);
  return translator.t(info.status >= 500 ? "apiErrors.status.server" : "apiErrors.status.other", { status: info.status });
}

/** Fehler zu einer Antwort mit Fehlerstatus (apiRequest, Standard-Abfragen) */
export function createApiError(status: number, text: string, translator: Translator = defaultTranslator): ApiError {
  const info = parseApiErrorBody(status, text);
  return new ApiError(info, `${status}: ${text}`, apiErrorText(info, translator));
}

/**
 * Fuer eigene fetch-Aufrufe (statt apiRequest): Fehler aus dem bereits gelesenen Antwortkoerper,
 * gleiche Uebersetzung wie apiRequest. Ohne Text in der Antwort: `fallback` (schon uebersetzt), sonst Meldung je Status.
 */
export function apiErrorFromBody(status: number, body: unknown, fallback?: string, translator: Translator = defaultTranslator): ApiError {
  const text = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const info = parseApiErrorBody(status, text);
  const message = !info.serverText && !info.code && fallback ? fallback : apiErrorText(info, translator);
  return new ApiError(info, `${status}: ${text}`, message);
}

/** Rohform fuer Pruefungen auf bestimmte Servertexte: "Status: Antworttext" (auch bei aelteren Fehlern) */
export function apiErrorRaw(error: unknown): string {
  if (error instanceof ApiError) return error.raw;
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/** Status, Code und Servertext aus ApiError oder einem Fehler im alten Format "Status: Antworttext" */
export function apiErrorInfo(error: unknown): ApiErrorInfo | null {
  if (error instanceof ApiError) return error;
  const match = apiErrorRaw(error).match(/^(\d{3}):\s*([\s\S]*)$/);
  return match ? parseApiErrorBody(Number(match[1]), match[2]) : null;
}

/** Server meldet fehlende Shopware-Einstellungen (Seiten zeigen dann den Hinweis zur Einrichtung) */
export function isNotConfiguredError(error: unknown): boolean {
  return /not configured|nicht konfiguriert/i.test(apiErrorRaw(error));
}
