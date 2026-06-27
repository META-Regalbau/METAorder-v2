/**
 * Konfigurations-PDF: Einleitung, regalsystem-spezifische Hinweise, Standard-Abschluss.
 * Pflege über Einstellungen (`offer_config_pdf_texts`) oder Defaults im Code.
 */

import { z } from "zod";
import type { OfferConfigPdfInput } from "./offerConfigPdf";
import type { IStorage } from "./storage";

/** DB-Key `settings.key` */
export const OFFER_CONFIG_PDF_TEXTS_SETTING_KEY = "offer_config_pdf_texts";

export type OfferConfigPdfTextPlaceholders = {
  customerName: string;
  offerNumber: string;
  createdAtDisplay: string;
  expirationDisplay: string;
  shelvingSystemLabel: string;
};

/** Gespeichertes JSON (Teilfelder optional — fehlende Werte werden mit Defaults gemerged). */
export type OfferConfigPdfStoredTexts = {
  introTemplate?: string;
  systemInfoTitle?: string;
  systemInfoByKey?: Record<string, string>;
  standardClosingTitle?: string;
  standardClosing?: string;
};

/** Vollständig gemergter Stand (wie im PDF verwendet / Formular). */
export type OfferConfigPdfTextsEffective = {
  introTemplate: string;
  systemInfoTitle: string;
  systemInfoByKey: Record<string, string>;
  standardClosingTitle: string;
  standardClosing: string;
};

function formatDeDate(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export const DEFAULT_OFFER_CONFIG_PDF_TEXTS: OfferConfigPdfTextsEffective = {
  introTemplate:
    "Sehr geehrte Damen und Herren,\n\n" +
    "vielen Dank für Ihr Interesse. Gerne unterbreiten wir Ihnen unser Angebot {{offerNumber}} für {{customerName}}.\n\n" +
    "Im folgenden Abschnitt „Schnellübersicht“ finden Sie eine komprimierte Darstellung aller Positionen inklusive Versand und Montage. " +
    "Ausführliche Konfigurationsbeschreibungen, Abbildungen und Stücklisten sind auf den nachfolgenden Seiten aufgeführt.\n\n" +
    "Bei Rückfragen stehen wir Ihnen selbstverständlich zur Verfügung.",
  systemInfoTitle: "Hinweise zu Ihrem Regalsystem",
  systemInfoByKey: {
    meta:
      "[Dummy] META-Regalsystem\n\n" +
      "Dieses System ist für den Einsatz in trockenen, überdachten Innenräumen vorgesehen. " +
      "Tragfähigkeit und Standsicherheit sind an die im Projekt zugrunde gelegten Lastannahmen gebunden. " +
      "Lieferung erfolgt in der Regel zerlegt; ein fachgerechter Aufbau durch geschultes Personal wird empfohlen.",
    steck:
      "[Dummy] Steckregal\n\n" +
      "Die Steckverbindungen sind werkzeuglos montierbar. " +
      "Höhenänderungen sind nur in Rasterabständen möglich; nachträgliche Erweiterungen sollten mit uns abgestimmt werden.",
    schraub:
      "[Dummy] Schraubregal\n\n" +
      "Alle tragenden Verbindungen sind verschraubt. Änderungen der Feldhöhen erfordern eine erneute statische Prüfung bzw. Planungsanpassung.",
    _default:
      "[Dummy] Allgemeine Regalhinweise\n\n" +
      "Bitte beachten Sie bei Aufstellung und Nutzung die einschlägigen Unfallverhütungsvorschriften sowie die beiliegenden bzw. vereinbarten statischen Nachweise.",
  },
  standardClosingTitle: "Allgemeine rechtliche Hinweise",
  standardClosing:
    "[Dummy] Dieses Angebot ist freibleibend und unverbindlich, sofern nicht ausdrücklich etwas anderes vereinbart wurde. " +
    "Zwischenverkauf, Druck- und Übermittlungsfehler bleiben vorbehalten. " +
    "Es gelten unsere Allgemeinen Geschäftsbedingungen in der zum Angebotszeitpunkt gültigen Fassung. " +
    "Maße, Abbildungen und technische Daten können aus Gründen der Lesbarkeit vereinfacht dargestellt sein; maßgeblich sind die vertraglich vereinbarten Spezifikationen.",
};

export const OFFER_CONFIG_PDF_TEXT_PLACEHOLDER_HELP =
  "{{customerName}}, {{offerNumber}}, {{createdAtDisplay}}, {{expirationDisplay}}, {{shelvingSystemLabel}}";

export function mergeOfferConfigPdfStoredTexts(
  stored: OfferConfigPdfStoredTexts | null | undefined,
): OfferConfigPdfTextsEffective {
  const d = DEFAULT_OFFER_CONFIG_PDF_TEXTS;
  return {
    introTemplate: stored?.introTemplate ?? d.introTemplate,
    systemInfoTitle: stored?.systemInfoTitle ?? d.systemInfoTitle,
    systemInfoByKey: { ...d.systemInfoByKey, ...(stored?.systemInfoByKey || {}) },
    standardClosingTitle: stored?.standardClosingTitle ?? d.standardClosingTitle,
    standardClosing: stored?.standardClosing ?? d.standardClosing,
  };
}

export const offerConfigPdfTextsPayloadSchema = z.object({
  introTemplate: z.string().max(120_000),
  systemInfoTitle: z.string().max(500),
  systemInfoByKey: z
    .record(z.string().max(128), z.string().max(120_000))
    .refine((o) => Object.keys(o).length <= 80, { message: "Zu viele Einträge in systemInfoByKey" }),
  standardClosingTitle: z.string().max(500),
  standardClosing: z.string().max(120_000),
});

export type OfferConfigPdfTextsPayload = z.infer<typeof offerConfigPdfTextsPayloadSchema>;

export function substituteOfferPdfPlaceholders(
  template: string,
  p: OfferConfigPdfTextPlaceholders,
): string {
  return template
    .replace(/\{\{customerName\}\}/g, p.customerName)
    .replace(/\{\{offerNumber\}\}/g, p.offerNumber)
    .replace(/\{\{createdAtDisplay\}\}/g, p.createdAtDisplay)
    .replace(/\{\{expirationDisplay\}\}/g, p.expirationDisplay)
    .replace(/\{\{shelvingSystemLabel\}\}/g, p.shelvingSystemLabel);
}

/** Bekannte Regalsystem-Schlüssel (Heuristik im PDF + Formular). */
export const OFFER_CONFIG_PDF_SYSTEM_KEYS = ["meta", "steck", "schraub", "_default"] as const;
export type OfferConfigPdfSystemKey = (typeof OFFER_CONFIG_PDF_SYSTEM_KEYS)[number];

/**
 * Heuristik aus MetaCalc-Payload und Bezeichnungen (später ggf. durch explizites Produktfeld ersetzen).
 */
export function deriveShelvingSystemKey(rawItems: any[]): { key: string; label: string } {
  const parts: string[] = [];
  for (const it of rawItems || []) {
    const m = it?.payload?.metaCalcConfigurationPayload;
    if (m && typeof m === "object") {
      for (const k of ["systemType", "rackSystem", "shelvingSystem", "regalTyp", "configurationFamily"]) {
        const v = (m as any)[k];
        if (v != null && String(v).trim()) parts.push(String(v));
      }
    }
    if (it?.payload?.metaCalcConfigurationName) parts.push(String(it.payload.metaCalcConfigurationName));
    if (it?.label) parts.push(String(it.label));
  }
  const blob = parts.join(" ").toLowerCase();
  if (/steckregal|\bsteck\b/.test(blob)) return { key: "steck", label: "Steckregal" };
  if (/schraubregal|schraub/.test(blob)) return { key: "schraub", label: "Schraubregal" };
  if (/\bmeta\b|meta-?rack|meta-?regal/.test(blob)) return { key: "meta", label: "META-Regalsystem" };
  return { key: "_default", label: "Regalsystem" };
}

export async function enrichOfferConfigPdfInputWithTexts(
  storage: IStorage,
  input: OfferConfigPdfInput,
  rawOfferLineItems: any[],
  tenantId?: string | null,
): Promise<void> {
  const stored = (await storage.getSetting(OFFER_CONFIG_PDF_TEXTS_SETTING_KEY, tenantId)) as
    | OfferConfigPdfStoredTexts
    | undefined;
  const merged = mergeOfferConfigPdfStoredTexts(stored);
  const { key, label } = deriveShelvingSystemKey(rawOfferLineItems);

  const placeholders: OfferConfigPdfTextPlaceholders = {
    customerName: input.customerName || "—",
    offerNumber: input.offerNumber || "—",
    createdAtDisplay: formatDeDate(input.createdAt),
    expirationDisplay: formatDeDate(input.expirationDate ?? null),
    shelvingSystemLabel: label,
  };

  const systemBodyRaw =
    merged.systemInfoByKey[key] ?? merged.systemInfoByKey._default ?? DEFAULT_OFFER_CONFIG_PDF_TEXTS.systemInfoByKey._default;

  input.offerIntroText = substituteOfferPdfPlaceholders(merged.introTemplate, placeholders);
  input.offerSystemInfoTitle = merged.systemInfoTitle;
  input.offerSystemInfoText = substituteOfferPdfPlaceholders(systemBodyRaw, placeholders);
  input.offerStandardClosingTitle = merged.standardClosingTitle;
  input.offerStandardClosingText = substituteOfferPdfPlaceholders(merged.standardClosing, placeholders);
  input.shelvingSystemKey = key;
}
