/**
 * Portal-Registrierungen: Anmeldedaten aus der Mail lesen.
 *
 * Die KI liest Firma, Kundennummer, Adresse, Ansprechpartner und Wünsche (Expertenmodus). Feste
 * Regeln ergänzen, was die KI auslässt (Kundennummer, USt-IdNr., E-Mail, Expertenmodus), und
 * springen ein, wenn keine KI eingerichtet ist. Die Mail wird ganz gelesen – auch der weitergeleitete
 * Teil –, weil Anmeldungen oft aus einem Formular kommen und der Kunde nur im Text steht.
 */
import { z } from "zod";
import type { IStorage } from "../storage";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse } from "../ai/llmChat";
import { isOwnOperatorEmail } from "../commercial/draftCustomerEmailResolution";
import {
  EMPTY_PORTAL_REGISTRATION_DATA,
  type PortalRegistrationData,
  type PortalRegistrationExtraction,
} from "@shared/portalRegistrations";
import { logger } from "../lib/logger";

const log = logger.child({ component: "b2b/portalRegistrationExtraction" });

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** „Kundennummer: 12345“, „Kd.-Nr. 20000016175“, „Debitor 10001“, „Kunden-Nr.: BC-00467“ */
const CUSTOMER_NUMBER_RE =
  /(?:kunden[\s-]*(?:nummer|nr\.?)|kd\.?[\s-]*nr\.?|debitor(?:en)?(?:[\s-]*(?:nummer|nr\.?))?|customer\s*(?:no\.?|number|id))\s*[:#.]?\s*([A-Z]{0,3}-?\d{4,12})\b/i;

/** USt-IdNr. der EU (DE123456789, ATU12345678, NL123456789B01 …) */
const VAT_RE = /\b(DE\s?\d{3}\s?\d{3}\s?\d{3}|ATU\s?\d{8}|NL\s?\d{9}\s?B\d{2}|BE\s?0?\d{9,10}|CH[EF]?-?\d{3}\.?\d{3}\.?\d{3}|CZ\d{8,10}|PL\d{10}|FR[0-9A-Z]{2}\d{9}|IT\d{11}|DK\d{8}|LU\d{8}|SE\d{12}|ES[0-9A-Z]\d{7}[0-9A-Z])\b/i;

const EXPERT_RE = /experten[\s-]*modus|expert[\s-]*mod(?:e|us)|expertenzugang|experten[\s-]*zugang/i;
const ADMIN_MODE_RE = /admin[\s-]*modus|administrator[\s-]*modus/i;
/** „ohne Expertenmodus“, „kein Expertenmodus“, „Expertenmodus: nein“ */
const NEGATION_BEFORE_RE = /\b(?:kein(?:en|e)?|ohne|nicht|no|without)\b[^.\n]{0,25}$/i;
const NEGATION_AFTER_RE = /^\s*[:=-]?\s*(?:nein|no|aus|nicht\s+gew(?:ü|ue)nscht|nicht\s+n(?:ö|oe)tig|\[\s*\])/i;

/**
 * Wird ein Modus gewünscht? true = genannt (und nicht verneint), false = ausdrücklich verneint,
 * null = nicht erwähnt.
 */
export function detectModeRequest(text: string, re: RegExp): boolean | null {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  let result: boolean | null = null;
  for (const m of text.matchAll(global)) {
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 40), idx);
    const after = text.slice(idx + m[0].length, idx + m[0].length + 30);
    if (NEGATION_AFTER_RE.test(after) || NEGATION_BEFORE_RE.test(before)) {
      if (result === null) result = false;
      continue;
    }
    result = true;
  }
  return result;
}

export function normalizeVatId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/[\s.\-]/g, "").toUpperCase();
  return v.length >= 8 ? v : null;
}

export function normalizeCustomerNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, "");
  return v ? v : null;
}

/** Externe E-Mail-Adressen im Text (ohne META-eigene und ohne noreply) in Reihenfolge */
export function externalEmails(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/\.$/, "");
    if (isOwnOperatorEmail(e) || /^(no-?reply|do-?not-?reply|mailer-daemon)@/.test(e)) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out;
}

/** Was feste Regeln sicher finden (ohne KI) */
export function extractByRules(input: { subject: string; body: string }): PortalRegistrationData {
  const text = `${input.subject}\n${input.body}`;
  const data: PortalRegistrationData = structuredClone(EMPTY_PORTAL_REGISTRATION_DATA);
  data.customerNumber = normalizeCustomerNumber(text.match(CUSTOMER_NUMBER_RE)?.[1]);
  data.vatId = normalizeVatId(text.match(VAT_RE)?.[1]);
  data.contact.email = externalEmails(text)[0] ?? null;
  data.expertMode = detectModeRequest(text, EXPERT_RE);
  data.adminMode = detectModeRequest(text, ADMIN_MODE_RE);
  return data;
}

const optText = (max: number) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s && !/^(null|n\/a|unbekannt|-)$/i.test(s) ? s.slice(0, max) : null;
  }, z.string().nullable());

const optBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "ja", "yes"].includes(s)) return true;
    if (["false", "nein", "no"].includes(s)) return false;
  }
  return null;
}, z.boolean().nullable());

const llmSchema = z.object({
  isRegistration: z.preprocess((v) => v === true || v === "true", z.boolean()),
  confidence: z.preprocess((v) => {
    const n = typeof v === "string" ? Number(v.replace(",", ".").replace("%", "")) : v;
    if (typeof n !== "number" || Number.isNaN(n)) return 0;
    return n > 1 && n <= 100 ? n / 100 : Math.min(1, Math.max(0, n));
  }, z.number()),
  reason: optText(400),
  company: optText(255),
  customerNumber: optText(40),
  vatId: optText(40),
  street: optText(255),
  zipCode: optText(20),
  city: optText(120),
  country: optText(60),
  phone: optText(60),
  contact: z
    .object({
      salutation: z.preprocess((v) => {
        const s = typeof v === "string" ? v.trim().toLowerCase() : "";
        if (["mr", "herr", "hr.", "hr"].includes(s)) return "mr";
        if (["mrs", "frau", "fr.", "fr", "ms"].includes(s)) return "mrs";
        return null;
      }, z.enum(["mr", "mrs"]).nullable()),
      firstName: optText(120),
      lastName: optText(120),
      email: optText(254),
      phone: optText(60),
    })
    .default({}),
  expertMode: optBool,
  adminMode: optBool,
  notes: optText(2000),
});

const SYSTEM_PROMPT = `Du liest Anmeldungen für das B2B-Händlerportal von META (Regalhersteller). Die Mails kommen meist weitergeleitet von META-Kollegen (Adressen @meta-online.com, @meta-regalbau.de) – diese Kollegen sind NICHT der Kunde. Gesucht sind die Daten des Händlers/Kunden, der den Portalzugang bekommen soll, und die Person, die der Administrator des Zugangs wird.

Regeln:
- Nur Angaben übernehmen, die in der Mail stehen. Nichts erfinden, nichts ergänzen.
- customerNumber: die META-Kundennummer (Debitor), falls genannt; sonst null.
- contact: die Person, die den Zugang bekommt (Administrator). E-Mail-Adressen von META-Kollegen nie als contact.email.
- expertMode: true, wenn der Expertenmodus (Regalplaner/Konfigurator) gewünscht ist; false, wenn er ausdrücklich nicht gewünscht ist; sonst null. adminMode genauso für einen „Adminmodus“.
- country als ISO-Code (DE, AT, CH, NL …), wenn erkennbar.
- isRegistration: true, wenn es um einen neuen oder freizuschaltenden Zugang zum Händlerportal geht. Bestellungen, Anfragen, Rechnungen, Newsletter: false.
- notes: Wünsche oder Rückfragen aus der Mail in einem Satz, sonst null.

Antworte NUR mit JSON:
{"isRegistration":true|false,"confidence":0.0-1.0,"reason":"kurz, deutsch","company":"…","customerNumber":"…","vatId":"…","street":"…","zipCode":"…","city":"…","country":"DE","phone":"…","contact":{"salutation":"mr"|"mrs"|null,"firstName":"…","lastName":"…","email":"…","phone":"…"},"expertMode":true|false|null,"adminMode":true|false|null,"notes":"…"}`;

export type RegistrationLlm = (system: string, user: string) => Promise<string>;

export function buildExtractionPrompt(input: { from: string; subject: string; body: string }): string {
  return [`Absender: ${input.from.slice(0, 200)}`, `Betreff: ${input.subject.slice(0, 300)}`, "", "E-Mail-Text:", input.body.slice(0, 12000) || "(leer)"].join(
    "\n",
  );
}

/** KI-Antwort lesen (rein, testbar); null = unbrauchbar */
export function interpretExtractionResponse(raw: string): Omit<PortalRegistrationExtraction, "source"> | null {
  const json = parseLlmJsonResponse(raw);
  // Ohne Einordnung ist die Antwort unbrauchbar (sonst wäre jede kaputte Antwort „keine Anmeldung“)
  if (!json || typeof json !== "object" || !("isRegistration" in json)) return null;
  const parsed = llmSchema.safeParse(json);
  if (!parsed.success) return null;
  const p = parsed.data;
  const email = p.contact.email?.toLowerCase() ?? null;
  return {
    isRegistration: p.isRegistration,
    confidence: p.confidence,
    reason: p.reason,
    data: {
      company: p.company,
      customerNumber: normalizeCustomerNumber(p.customerNumber),
      vatId: normalizeVatId(p.vatId),
      street: p.street,
      zipCode: p.zipCode,
      city: p.city,
      country: p.country,
      phone: p.phone,
      contact: {
        salutation: p.contact.salutation,
        firstName: p.contact.firstName,
        lastName: p.contact.lastName,
        // META-Adresse ist nie der Händler-Admin (Kollege, der weitergeleitet hat)
        email: email && !isOwnOperatorEmail(email) ? email : null,
        phone: p.contact.phone,
      },
      expertMode: p.expertMode,
      adminMode: p.adminMode,
      notes: p.notes,
    },
  };
}

/** KI-Ergebnis mit den Regeln auffüllen: Regeln ergänzen nur, was fehlt. */
export function mergeWithRules(ai: PortalRegistrationData, rules: PortalRegistrationData): PortalRegistrationData {
  return {
    ...ai,
    customerNumber: ai.customerNumber ?? rules.customerNumber,
    vatId: ai.vatId ?? rules.vatId,
    contact: { ...ai.contact, email: ai.contact.email ?? rules.contact.email },
    // Ausdrücklich verneint schlägt „nicht erwähnt“; genannt schlägt beides
    expertMode: ai.expertMode ?? rules.expertMode,
    adminMode: ai.adminMode ?? rules.adminMode,
  };
}

const REGISTRATION_HINT_RE = /registrier|anmeld|freischalt|zugang|portal|zugangsdaten|login|account|händlerportal|haendlerportal/i;

export async function extractPortalRegistration(
  storage: Pick<IStorage, "getSetting">,
  input: { from: string; subject: string; body: string },
  llm?: RegistrationLlm,
): Promise<PortalRegistrationExtraction> {
  const rules = extractByRules(input);
  const getSetting = storage.getSetting.bind(storage);
  const ask: RegistrationLlm | null =
    llm ??
    ((await isChatLlmConfigured(getSetting))
      ? (system, user) =>
          chatCompletion(getSetting, {
            tier: "smart",
            temperature: 0,
            response_json: true,
            max_tokens: 1200,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          })
      : null);

  if (ask) {
    try {
      const ai = interpretExtractionResponse(await ask(SYSTEM_PROMPT, buildExtractionPrompt(input)));
      if (ai) {
        return { ...ai, data: mergeWithRules(ai.data, rules), source: "ai" };
      }
      log.warn({ subject: input.subject }, "[PortalRegistration] KI-Antwort unbrauchbar, nur Regeln");
    } catch (err) {
      log.warn({ err, subject: input.subject }, "[PortalRegistration] KI-Auslesung fehlgeschlagen, nur Regeln");
    }
  }

  // Ohne KI: Registrierung, wenn der Text danach klingt; Bearbeiter prüft ohnehin (geringe Sicherheit)
  const looksLikeRegistration = REGISTRATION_HINT_RE.test(`${input.subject}\n${input.body}`);
  return {
    data: rules,
    isRegistration: looksLikeRegistration,
    confidence: looksLikeRegistration ? 0.5 : 0.2,
    source: "rules",
    reason: ask ? "KI-Auslesung nicht möglich – nur feste Regeln" : "KI nicht eingerichtet – nur feste Regeln",
  };
}
