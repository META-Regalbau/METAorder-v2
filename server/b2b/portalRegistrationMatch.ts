/**
 * Portal-Registrierungen: Kunden der Anmeldung im Shop finden.
 *
 * Gesucht wird breit (Kundennummer, E-Mail des Ansprechpartners als Kunde oder als B2B-Mitarbeiter,
 * USt-IdNr., Firmenname, PLZ, Firmen-Domain), bewertet wird lokal. Nur Kunden in einem
 * Händlerportal-Kanal zählen als Treffer; Konten im Onlineshop sind nur ein Hinweis für den
 * Kundenstamm. Sicher (≥ 95) ist ein Treffer nur über Kundennummer, E-Mail oder USt-IdNr. – und
 * nur, wenn kein zweiter Portal-Kunde genauso gut passt und die Kundennummer zur Firma passt.
 */
import { isFreemailDomain } from "../commercial/freemailDomains";
import {
  PORTAL_REGISTRATION_MATCH_NOTES as NOTES,
  type PortalCustomerSnapshot,
  type PortalRegistrationCandidate,
  type PortalRegistrationData,
  type PortalRegistrationMatch,
  type PortalRegistrationMatchMethod,
} from "@shared/portalRegistrations";
import { normalizeCustomerNumber, normalizeVatId } from "./portalRegistrationExtraction";

/** Ab hier gilt ein Treffer als sicher (Ausführen ohne Rückfrage möglich) */
export const SURE_MATCH_SCORE = 95;
/** Darunter wird ein Kandidat nicht mehr angezeigt */
const MIN_CANDIDATE_SCORE = 50;
/** Darunter ist ein Kandidat kein Treffer, nur „ähnlich“ */
const MIN_MATCH_SCORE = 70;

const METHOD_SCORE: Record<Exclude<PortalRegistrationMatchMethod, "manual">, number> = {
  customer_number: 100,
  employee_email: 100,
  customer_email: 100,
  vat_id: 97,
  company_zip: 92,
  company_name: 75,
  email_domain: 60,
};

const LEGAL_FORMS = new Set([
  "gmbh", "mbh", "co", "kg", "ag", "ug", "ohg", "gbr", "ek", "e", "k", "kgaa", "se", "ltd", "inc", "bv", "nv", "sarl", "srl",
  "sro", "spzoo", "as", "ab", "oy", "haftungsbeschrankt", "und", "the", "firma", "fa",
]);

export function normalizeCompanyTokens(raw: string | null | undefined): string[] {
  const s = (raw ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter((t) => t && !LEGAL_FORMS.has(t));
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Ähnlichkeit zweier Firmennamen 0–1 (Rechtsform und Schreibweise egal) */
export function companySimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = normalizeCompanyTokens(a);
  const tb = normalizeCompanyTokens(b);
  if (!ta.length || !tb.length) return 0;
  const sa = ta.join("");
  const sb = tb.join("");
  if (sa === sb) return 1;
  // Ein Name steckt ganz im anderen („Müller“ ↔ „Müller Lagertechnik“)
  const setA = new Set(ta);
  const setB = new Set(tb);
  const shared = [...setA].filter((t) => setB.has(t)).length;
  const tokenScore = (2 * shared) / (setA.size + setB.size);
  const containment = shared / Math.min(setA.size, setB.size);
  const ba = bigrams(sa);
  const bb = bigrams(sb);
  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of bb) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }
  const dice = ba.length + bb.length ? (2 * overlap) / (ba.length + bb.length) : 0;
  return Math.max(tokenScore, dice, containment * 0.9);
}

/** Längstes aussagekräftiges Wort des Firmennamens für die Shop-Suche */
export function companySearchToken(company: string | null | undefined): string | null {
  const tokens = (company ?? "")
    .split(/[^A-Za-zÄÖÜäöüß0-9]+/)
    .filter((t) => t.length >= 4 && !LEGAL_FORMS.has(normalizeCompanyTokens(t)[0] ?? t.toLowerCase()));
  tokens.sort((x, y) => y.length - x.length);
  return tokens[0] ?? null;
}

export function emailDomain(email: string | null | undefined): string | null {
  const d = (email ?? "").split("@")[1]?.trim().toLowerCase();
  return d || null;
}

const sameZip = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.replace(/\s/g, "") === b.replace(/\s/g, ""));

export type ScoredHit = {
  customer: PortalCustomerSnapshot;
  /** Gefunden als Firma des B2B-Mitarbeiters mit dieser E-Mail */
  viaEmployeeEmail?: boolean;
};

/** Einen Kunden gegen die Anmeldung bewerten (rein) */
export function scoreCustomer(data: PortalRegistrationData, hit: ScoredHit): PortalRegistrationCandidate {
  const c = hit.customer;
  const methods: PortalRegistrationMatchMethod[] = [];
  const reasons: string[] = [];
  const wantedNumber = normalizeCustomerNumber(data.customerNumber)?.toLowerCase();
  if (wantedNumber && normalizeCustomerNumber(c.customerNumber)?.toLowerCase() === wantedNumber) {
    methods.push("customer_number");
    reasons.push(`Kundennummer ${c.customerNumber}`);
  }
  const contactEmail = data.contact.email?.trim().toLowerCase() ?? null;
  if (hit.viaEmployeeEmail) {
    methods.push("employee_email");
    reasons.push(`${contactEmail} ist schon Mitarbeiter dieses Kunden`);
  }
  if (contactEmail && c.email?.trim().toLowerCase() === contactEmail) {
    methods.push("customer_email");
    reasons.push(`E-Mail des Kunden = ${contactEmail}`);
  }
  const vat = normalizeVatId(data.vatId);
  if (vat && c.vatIds.some((v) => normalizeVatId(v) === vat)) {
    methods.push("vat_id");
    reasons.push(`USt-IdNr. ${vat}`);
  }
  const similarity = companySimilarity(data.company, c.company);
  const zipMatches = sameZip(data.zipCode, c.address.zipCode);
  if (similarity >= 0.85 && zipMatches) {
    methods.push("company_zip");
    reasons.push(`Firma und PLZ ${c.address.zipCode} passen`);
  } else if (similarity >= 0.85) {
    methods.push("company_name");
    reasons.push("Firmenname passt");
  }
  const domain = emailDomain(contactEmail);
  if (domain && !isFreemailDomain(domain) && emailDomain(c.email) === domain) {
    methods.push("email_domain");
    reasons.push(`gleiche Firmen-Domain @${domain}`);
  }

  let score = methods.reduce((max, m) => Math.max(max, METHOD_SCORE[m as keyof typeof METHOD_SCORE] ?? 0), 0);
  // Schwache Hinweise zusammen ergeben einen ordentlichen Kandidaten
  if (score < 85 && methods.includes("email_domain") && (zipMatches || similarity >= 0.6)) score = 85;
  if (score < 80 && similarity >= 0.6 && zipMatches) {
    score = 80;
    reasons.push(`Firma ähnlich, PLZ ${c.address.zipCode} gleich`);
  }
  if (score < MIN_CANDIDATE_SCORE && similarity >= 0.6) {
    score = Math.round(similarity * 70);
    reasons.push("Firmenname ähnlich");
  }
  return { customer: c, score, methods, reasons };
}

/** Kandidaten zu einem Ergebnis zusammenfassen (rein, testbar) */
export function decidePortalMatch(
  data: PortalRegistrationData,
  hits: ScoredHit[],
  now: Date = new Date(),
): PortalRegistrationMatch {
  const byId = new Map<string, PortalRegistrationCandidate>();
  for (const hit of hits) {
    const scored = scoreCustomer(data, hit);
    const prev = byId.get(hit.customer.id);
    if (!prev) {
      byId.set(hit.customer.id, scored);
      continue;
    }
    // Derselbe Kunde über mehrere Suchen: Hinweise vereinen
    const methods = [...new Set([...prev.methods, ...scored.methods])];
    const reasons = [...new Set([...prev.reasons, ...scored.reasons])];
    byId.set(hit.customer.id, { customer: prev.customer, score: Math.max(prev.score, scored.score), methods, reasons });
  }
  const all = [...byId.values()].sort((a, b) => b.score - a.score);
  const notes: string[] = [];

  // Interne META-Konten (Außendienst/Supervisor) sind nie der Händler
  const internal = all.filter((c) => c.customer.salesRepresentative && c.score >= MIN_MATCH_SCORE);
  if (internal.length) notes.push(NOTES.salesRepAccount);
  const relevant = all.filter((c) => !c.customer.salesRepresentative);

  const portal = relevant.filter((c) => c.customer.isPortal && c.score >= MIN_CANDIDATE_SCORE).slice(0, 8);
  const shopAccounts = relevant
    .filter((c) => !c.customer.isPortal && c.score >= MIN_MATCH_SCORE)
    .slice(0, 5)
    .map((c) => ({
      id: c.customer.id,
      customerNumber: c.customer.customerNumber,
      company: c.customer.company,
      salesChannelName: c.customer.salesChannelName,
    }));

  const wantedNumber = normalizeCustomerNumber(data.customerNumber);
  if (wantedNumber && !portal.some((c) => c.methods.includes("customer_number"))) notes.push(NOTES.numberNotFound);

  const base = { candidates: portal, shopAccounts, checkedAt: now.toISOString() };
  const best = portal[0];
  if (!best || best.score < MIN_MATCH_SCORE) {
    return { ...base, status: "not_found", customerId: null, method: null, confidence: best?.score ?? 0, notes };
  }

  const method = (best.methods[0] ?? null) as PortalRegistrationMatchMethod | null;
  if (best.score >= SURE_MATCH_SCORE) {
    const rival = portal.find((c) => c.customer.id !== best.customer.id && c.score >= SURE_MATCH_SCORE);
    if (rival) notes.push(NOTES.severalPortalAccounts);
    // Nur über die Kundennummer gefunden, aber die Firma heißt ganz anders: Tippfehler in der Nummer?
    const onlyNumber = best.methods.every((m) => m === "customer_number");
    const numberMismatch =
      onlyNumber && Boolean(data.company?.trim()) && Boolean(best.customer.company?.trim()) && companySimilarity(data.company, best.customer.company) < 0.35;
    if (numberMismatch) notes.push(NOTES.numberCompanyMismatch);
    if (!rival && !numberMismatch) {
      return { ...base, status: "matched", customerId: best.customer.id, method, confidence: best.score, notes };
    }
    return { ...base, status: "ambiguous", customerId: null, method, confidence: Math.min(best.score, 90), notes };
  }
  notes.push(NOTES.closeCandidates);
  return { ...base, status: "ambiguous", customerId: null, method, confidence: best.score, notes };
}
