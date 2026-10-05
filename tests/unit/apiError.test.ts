/**
 * Server-Fehlermeldungen in der Sprache der Oberflaeche (client/src/lib/apiError.ts).
 * Vorher warf apiRequest `500: {"error":"Failed to fetch tickets"}` - genau so stand es im Hinweis,
 * und der Server antwortet gemischt englisch/deutsch. Jetzt: Katalog aller festen Servertexte
 * (apiErrors.messages, de/en/es), Codes, Meldung je Status; die rohe Antwort bleibt fuer Pruefungen
 * wie "Shopware nicht konfiguriert" erhalten.
 * Ausführung: npm test
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import i18next from "i18next";
import de from "../../client/src/i18n/locales/de.json";
import en from "../../client/src/i18n/locales/en.json";
import es from "../../client/src/i18n/locales/es.json";
import {
  ApiError,
  apiErrorFromBody,
  apiErrorInfo,
  apiErrorKey,
  apiErrorRaw,
  apiErrorText,
  createApiError,
  isNotConfiguredError,
} from "../../client/src/lib/apiError";
import { getApiErrorToastContent } from "../../client/src/lib/orderApiErrors";
import { nlErrorCode } from "../../client/src/lib/nlAnalytics";
import { serverErrorTexts } from "../helpers/serverErrorTexts";

const ROOT = path.resolve(__dirname, "../..");

beforeAll(async () => {
  await i18next.init({
    resources: { de: { translation: de }, en: { translation: en }, es: { translation: es } },
    lng: "de",
    fallbackLng: "de",
    interpolation: { escapeValue: false },
  });
});
afterEach(async () => {
  await i18next.changeLanguage("de");
  vi.unstubAllGlobals();
});

describe("Katalog der Servertexte", () => {
  const texts = serverErrorTexts(ROOT);
  const messages = (de as any).apiErrors.messages as Record<string, string>;

  it("jeder feste Fehlertext des Servers hat einen Eintrag (de; en/es prueft i18nKeys.test)", () => {
    expect(texts.length).toBeGreaterThan(700);
    const missing = texts.filter((e) => typeof messages[apiErrorKey(e.text)] !== "string").map((e) => `${e.file}:${e.line} "${e.text}"`);
    expect(missing).toEqual([]);
  });

  it("keine verwaisten Eintraege (Servertext geaendert oder entfernt -> Eintrag anpassen)", () => {
    const used = new Set(texts.map((e) => apiErrorKey(e.text)));
    expect(Object.keys(messages).filter((key) => !used.has(key))).toEqual([]);
  });

  it("Schluessel: ohne Akzente, Satzzeichen und Gross/klein; leerer Text ergibt keinen Schluessel", () => {
    expect(apiErrorKey("Angebot nicht gefunden oder Link ungültig.")).toBe("angebot_nicht_gefunden_oder_link_ungultig");
    expect(apiErrorKey("Shopware settings not configured")).toBe(apiErrorKey("Shopware settings not configured."));
    expect(apiErrorKey("Größe fehlt")).toBe("grosse_fehlt");
    expect(apiErrorKey("x".repeat(200))).toHaveLength(80);
  });
});

describe("Meldung in der Sprache der Oberflaeche", () => {
  const json = (body: unknown) => JSON.stringify(body);

  it("fester Servertext: Deutsch, Englisch, Spanisch - aus englischem und aus deutschem Original", async () => {
    expect(createApiError(500, json({ error: "Failed to fetch tickets" })).message).toBe("Tickets konnten nicht abgerufen werden");
    await i18next.changeLanguage("en");
    expect(createApiError(404, json({ error: "Angebot nicht gefunden oder Link ungültig." })).message).toMatch(/^Offer not found/);
    await i18next.changeLanguage("es");
    expect(createApiError(500, json({ error: "Failed to fetch tickets" })).message).toMatch(/tickets/i);
    expect(createApiError(500, json({ error: "Failed to fetch tickets" })).message).not.toBe("Failed to fetch tickets");
  });

  it("Code vor Text; unbekannter Text: 4xx unveraendert, 5xx mit Rahmen und gekuerzt; genauere Angabe bleibt", async () => {
    expect(createApiError(429, json({ error: "egal", code: "rate_limited" })).message).toBe("Zu viele Anfragen – bitte kurz warten.");
    expect(createApiError(400, json({ error: "Feld menge muss positiv sein" })).message).toBe("Feld menge muss positiv sein");
    expect(createApiError(500, json({ error: "ECONNRESET bei Shopware" })).message).toBe("Serverfehler: ECONNRESET bei Shopware");
    const long = createApiError(500, json({ error: `Failed to fetch offer: Not Found - ${"x".repeat(400)}` })).message;
    expect(long).toMatch(/^Serverfehler: Failed to fetch offer: Not Found - x+…$/);
    expect(long.length).toBe("Serverfehler: ".length + 300 + 1);
    await i18next.changeLanguage("en");
    expect(createApiError(503, json({ error: "ECONNRESET" })).message).toBe("Server error: ECONNRESET");
    await i18next.changeLanguage("de");
    expect(createApiError(502, json({ error: "Shopware API error", message: "Failed to create invoice: 400" })).message).toBe(
      "Shopware-API-Fehler: Failed to create invoice: 400",
    );
    // genauere Angabe selbst im Katalog -> nur sie
    expect(createApiError(400, json({ error: "Invalid email", message: "Ungültige E-Mail-Adresse." })).message).toBe("Ungültige E-Mail-Adresse.");
  });

  it("ohne Text: Meldung je Status; HTML-Fehlerseite (Proxy) zaehlt nicht als Text; Klartext bleibt", () => {
    expect(createApiError(403, "").message).toBe("Dafür fehlt Ihnen die Berechtigung.");
    expect(createApiError(504, "<html><body>Gateway Timeout</body></html>").message).toMatch(/zu lange nicht geantwortet/);
    expect(createApiError(500, "").message).toBe("Serverfehler (Status 500).");
    expect(createApiError(418, "").message).toBe("Anfrage fehlgeschlagen (Status 418).");
    expect(createApiError(500, "Internal failure").message).toBe("Serverfehler: Internal failure");
    expect(createApiError(400, "Ungültige Menge").message).toBe("Ungültige Menge");
  });

  it("ApiError behaelt Status, Code, Servertext und Rohform", () => {
    const error = createApiError(502, json({ error: "Shopware settings not configured", code: "shopware_missing" }));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "shopware_missing", serverText: "Shopware settings not configured" });
    expect(error.raw).toBe(`502: ${json({ error: "Shopware settings not configured", code: "shopware_missing" })}`);
    expect(apiErrorRaw(error)).toBe(error.raw);
  });

  it("aelteres Format 'Status: Text' wird weiter gelesen", () => {
    const legacy = new Error('404: {"error":"Order not found"}');
    expect(apiErrorInfo(legacy)).toMatchObject({ status: 404, serverText: "Order not found" });
    expect(apiErrorText(apiErrorInfo(legacy)!)).toBe("Bestellung nicht gefunden");
    expect(apiErrorInfo(new Error("Failed to fetch"))).toBeNull();
  });
});

describe("eigene fetch-Aufrufe (apiErrorFromBody)", () => {
  it("gleiche Uebersetzung; ohne Text: mitgegebener Ersatztext, sonst Meldung je Status", () => {
    expect(apiErrorFromBody(404, { error: "Order not found" }).message).toBe("Bestellung nicht gefunden");
    expect(apiErrorFromBody(500, null, "PDF konnte nicht erstellt werden").message).toBe("PDF konnte nicht erstellt werden");
    expect(apiErrorFromBody(403, {}).message).toBe("Dafür fehlt Ihnen die Berechtigung.");
    expect(apiErrorFromBody(404, { error: "Order not found" })).toMatchObject({ status: 404, raw: '404: {"error":"Order not found"}' });
  });

  it("kein selbst gebauter Fehler aus dem Antworttext mehr (ausser oeffentliche Kundenseiten ohne Uebersetzung)", () => {
    const dir = path.join(ROOT, "client/src");
    const files = (function walk(d: string): string[] {
      return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
    })(dir);
    const pattern = /throw new Error\(\s*\(?(data|json|j|body|err|result|payload|errData|errorData|errBody|resp|response)\)?\??\.(error|message)/;
    const allowed = ["pages/PublicOfferPage.tsx", "pages/PublicCpqConfiguratorPage.tsx", "pages/CrossSellingRulesPage.tsx", "pages/B2BBudgetsPage.tsx"];
    const offenders = files
      .filter((f) => pattern.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(dir, f))
      .filter((f) => !allowed.includes(f));
    expect(offenders).toEqual([]);
  });
});

describe("Pruefungen auf Servertexte nutzen die Rohform", () => {
  it("'nicht konfiguriert' auch nach der Uebersetzung erkannt (englischer und deutscher Servertext)", async () => {
    await i18next.changeLanguage("es");
    expect(isNotConfiguredError(createApiError(400, JSON.stringify({ error: "Shopware settings not configured" })))).toBe(true);
    expect(isNotConfiguredError(createApiError(400, JSON.stringify({ error: "Shopware-Einstellungen nicht konfiguriert" })))).toBe(true);
    expect(isNotConfiguredError(new Error("Shopware settings not configured"))).toBe(true);
    expect(isNotConfiguredError(createApiError(500, JSON.stringify({ error: "Failed to fetch orders" })))).toBe(false);
  });

  it("keine Pruefung mehr auf error.message (dort steht jetzt der uebersetzte Text)", () => {
    const files = ["pages/OrdersPage.tsx", "pages/OffersPage.tsx", "pages/DelayedOrdersPage.tsx", "pages/DunningPreviewPage.tsx", "components/OrderDetailModal.tsx", "components/ProductDetailModal.tsx", "pages/ProductsPage.tsx", "lib/zebra/browserPrint.ts"];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, "client/src", file), "utf8");
      expect([file, /\.message\.includes\(|errorMessage\.includes\(/.test(src)]).toEqual([file, false]);
      expect([file, /isNotConfiguredError\(|apiErrorRaw\(/.test(src)]).toEqual([file, true]);
    }
  });

  it("Mondu-Hinweis beim Versand und Fehlercode der Natuerlichen Sprache lesen den Antwortkoerper", () => {
    const t = (key: string) => `T:${key}`;
    const mondu = createApiError(409, JSON.stringify({ error: "Mondu plugin error", code: "mondu_ship_blocked_after_payment_switch" }));
    expect(getApiErrorToastContent(mondu, t)).toEqual({ title: "T:orders.monduPluginError", description: "T:orders.monduPluginErrorPaymentSwitchDescription" });
    expect(getApiErrorToastContent(createApiError(404, JSON.stringify({ error: "Order not found" })), t)).toEqual({
      title: "T:errors.updateFailed",
      description: "Bestellung nicht gefunden",
    });
    expect(nlErrorCode(createApiError(503, JSON.stringify({ error: "No AI chat provider", code: "llm_unavailable" })))).toBe("llm_unavailable");
  });
});

describe("apiRequest und Standard-Abfragen werfen ApiError", () => {
  it("Fehlerstatus -> uebersetzte Meldung; leere oder ungueltige Antwort uebersetzt", async () => {
    const responses: Array<() => Response> = [
      () => new Response(JSON.stringify({ error: "Order not found" }), { status: 404 }),
      () => new Response("", { status: 200 }),
      () => new Response("kein json", { status: 200 }),
    ];
    vi.stubGlobal("fetch", async () => responses.shift()!());
    vi.stubGlobal("document", { cookie: "" });
    const { apiRequest, getQueryFn } = await import("../../client/src/lib/queryClient");
    await i18next.changeLanguage("en");
    await expect(apiRequest("GET", "/api/orders/1")).rejects.toMatchObject({ name: "ApiError", status: 404, message: "Order not found" });
    const query = getQueryFn({ on401: "throw" }) as any;
    await expect(query({ queryKey: ["/api/x"] })).rejects.toThrow("Empty server response");
    await expect(query({ queryKey: ["/api/x"] })).rejects.toThrow("Invalid JSON response: kein json");
  });

  it("Etikettendrucker: Zeitueberschreitung (504) weiter erkannt", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Gateway Timeout</html>", { status: 504 }));
    const { discoverPrinters } = await import("../../client/src/lib/zebra/browserPrint");
    await expect(discoverPrinters()).rejects.toMatchObject({ message: "browser_print_timeout" });
  });
});
