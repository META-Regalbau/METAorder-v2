import type OpenAI from "openai";
import type { ShopwareClient } from "./shopware";
import { truncateText } from "./aiTextUtils";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const FORWARD_MARKERS = [
  "-----ursprüngliche nachricht-----",
  "-----original message-----",
  "-----weitergeleitete nachricht-----",
  "begin forwarded message",
  "weitergeleitete nachricht",
  "forwarded message",
  "message d'origine",
];

function findLastForwardMarkerIndex(text: string): number {
  const lower = text.toLowerCase();
  let best = -1;
  for (const m of FORWARD_MARKERS) {
    const i = lower.lastIndexOf(m);
    if (i > best) best = i;
  }
  return best;
}

function isNoreplyLike(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const lower = email.toLowerCase();
  if (
    /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|bounces|mailer)$/i.test(
      local
    )
  ) {
    return true;
  }
  if (local.includes("noreply") || local.includes("no-reply")) return true;
  if (lower.includes("donotreply")) return true;
  return false;
}

function bump(scores: Map<string, number>, email: string, delta: number): void {
  const key = email.trim().toLowerCase();
  if (!key || isNoreplyLike(key)) return;
  scores.set(key, (scores.get(key) ?? 0) + delta);
}

/**
 * Heuristische Scores: Weiterleitungs-Blöcke, Von/From/Absender/Reply-To, Vorkommen im Text.
 */
export function scoreCustomerEmailCandidatesFromText(text: string, weight: number, scores: Map<string, number>): void {
  if (!text?.trim()) return;

  const forwardStart = findLastForwardMarkerIndex(text);
  const tail = forwardStart >= 0 ? text.slice(forwardStart) : "";

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (/^(von|from|absender|reply-to)\s*:/i.test(t)) {
      const matches = t.match(EMAIL_RE);
      if (matches) {
        for (const raw of matches) {
          bump(scores, raw, Math.round(24 * weight));
        }
      }
    }
  }

  if (tail.length > 0) {
    const re = new RegExp(EMAIL_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(tail)) !== null) {
      bump(scores, m[0], Math.round(14 * weight));
    }
  }

  const reAll = new RegExp(EMAIL_RE.source, "gi");
  let m2: RegExpExecArray | null;
  while ((m2 = reAll.exec(text)) !== null) {
    bump(scores, m2[0], Math.round(3 * weight));
  }
}

export function buildRankedCustomerEmails(params: {
  emailContext?: string;
  siblingPdfExcerpts?: string;
  extractedEmail?: string;
}): Array<{ email: string; score: number }> {
  const scores = new Map<string, number>();

  if (params.emailContext?.trim()) {
    scoreCustomerEmailCandidatesFromText(params.emailContext, 1, scores);
  }
  if (params.siblingPdfExcerpts?.trim()) {
    scoreCustomerEmailCandidatesFromText(params.siblingPdfExcerpts, 0.55, scores);
  }
  if (params.extractedEmail?.trim()) {
    bump(scores, params.extractedEmail.trim(), 16);
  }

  return [...scores.entries()]
    .map(([email, score]) => ({ email, score }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));
}

async function disambiguateWithLlm(
  openai: OpenAI,
  emailContext: string,
  candidates: string[]
): Promise<string | null> {
  if (candidates.length < 2) return null;
  const snippet = truncateText(emailContext, 7000);
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Du wählst die E-Mail-Adresse der Person oder Firma, die die Anfrage/Bestellung stellt — nicht die des internen Mitarbeiters, der nur weiterleitet.
Antworte nur mit JSON: {"email":"<eine der Kandidaten-Adressen in Kleinbuchstaben>"} oder {"email":null} wenn unklar.
Die gewählte Adresse muss exakt einer der vorgegebenen Kandidaten entsprechen.`,
        },
        {
          role: "user",
          content: `Kandidaten (nur diese wählen): ${candidates.join(", ")}\n\nE-Mail-Kontext:\n${snippet}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string | null };
    const pick = typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : null;
    if (!pick) return null;
    const allowed = new Set(candidates.map((c) => c.toLowerCase()));
    return allowed.has(pick) ? pick : null;
  } catch (e) {
    console.warn("[DraftCustomerEmail] LLM disambiguation failed:", e);
    return null;
  }
}

export type DraftExtractedCustomer = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  emailResolution?: {
    candidatesTried?: string[];
    chosenEmail?: string;
    method?: "heuristic" | "llm" | "extracted_only";
  };
  customerMatchConfidence?: number;
  /** true wenn der Shopware-Kunde in dieser Pipeline neu angelegt wurde (Strikt-Regel blockiert dann Auto-Create). */
  shopwareCustomerAutoCreated?: boolean;
};

export function computeCustomerMatchConfidence(params: {
  ranked: Array<{ email: string; score: number }>;
  shopwareCustomerId: string | null;
  usedLlm: boolean;
  addressSecondaryMatch?: boolean;
}): number {
  const top = params.ranked[0];
  if (!params.shopwareCustomerId) {
    if (!top && !params.addressSecondaryMatch) return 0;
    let c = top ? Math.min(58, Math.round(16 + top.score * 1.35)) : 28;
    if (params.usedLlm) c = Math.min(58, c + 7);
    if (params.addressSecondaryMatch) c = Math.min(58, c + 10);
    return Math.max(0, c);
  }
  let c = 78;
  if (top) c += Math.min(20, Math.round(top.score / 2.2));
  if (params.usedLlm) c = Math.min(100, c + 3);
  if (params.addressSecondaryMatch) c = Math.min(100, c + 5);
  return Math.max(0, Math.min(100, c));
}

/**
 * Score nur für automatische Shopware-Kundenanlage (ohne 58er-Deckel bei fehlendem Match).
 * Anzeige-Confidence bleibt über computeCustomerMatchConfidence niedrig, bis ein Treffer/Anlage erfolgt.
 */
export function computeCustomerAutoCreateScore(params: {
  ranked: Array<{ email: string; score: number }>;
  usedLlm: boolean;
}): number {
  const top = params.ranked[0];
  if (!top) return 0;
  let c = Math.round(16 + top.score * 1.35);
  if (params.usedLlm) c += 7;
  return Math.max(0, Math.min(100, c));
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type DraftBillingAddressInput = {
  firstName?: string;
  lastName?: string;
  street?: string;
  zipCode?: string;
  city?: string;
  country?: string;
  company?: string;
  email?: string;
};

const SHOPWARE_CUSTOMER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Vereinigt gespeicherten Entwurf mit Formular-Patch (flaches Spread würde verschachtelte Objekte zerstören).
 */
export function mergeDraftExtractedData(
  draftData: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base =
    draftData && typeof draftData === "object" ? { ...draftData } : ({} as Record<string, unknown>);
  if (!patch || typeof patch !== "object") {
    return base;
  }
  const out: Record<string, unknown> = { ...base, ...patch };
  if (base.customer && typeof base.customer === "object" && patch.customer && typeof patch.customer === "object") {
    out.customer = { ...(base.customer as object), ...(patch.customer as object) };
  } else if (patch.customer && typeof patch.customer === "object") {
    out.customer = { ...(patch.customer as object) };
  }
  if (
    base.billingAddress &&
    typeof base.billingAddress === "object" &&
    patch.billingAddress &&
    typeof patch.billingAddress === "object"
  ) {
    out.billingAddress = { ...(base.billingAddress as object), ...(patch.billingAddress as object) };
  } else if (patch.billingAddress && typeof patch.billingAddress === "object") {
    out.billingAddress = { ...(patch.billingAddress as object) };
  }
  if (
    base.shippingAddress &&
    typeof base.shippingAddress === "object" &&
    patch.shippingAddress &&
    typeof patch.shippingAddress === "object"
  ) {
    out.shippingAddress = { ...(base.shippingAddress as object), ...(patch.shippingAddress as object) };
  } else if (patch.shippingAddress && typeof patch.shippingAddress === "object") {
    out.shippingAddress = { ...(patch.shippingAddress as object) };
  }
  return out;
}

/**
 * E-Mail für Kundenanlage: zuerst customer.email, sonst billingAddress.email; schreibt fehlende customer.email nach.
 */
export function resolveEmailForShopwareCustomerCreate(merged: Record<string, unknown>):
  | { email: string; merged: Record<string, unknown> }
  | { error: string } {
  if (!merged || typeof merged !== "object") {
    return { error: "Keine Entwurfsdaten" };
  }
  const cust = merged.customer;
  const fromCustomer =
    cust && typeof cust === "object" ? String((cust as { email?: string }).email || "").trim() : "";
  const bill = merged.billingAddress;
  const fromBilling =
    bill && typeof bill === "object" ? String((bill as { email?: string }).email || "").trim() : "";

  let email = "";
  if (fromCustomer && SHOPWARE_CUSTOMER_EMAIL_RE.test(fromCustomer)) email = fromCustomer;
  else if (fromBilling && SHOPWARE_CUSTOMER_EMAIL_RE.test(fromBilling)) email = fromBilling;

  if (!email) {
    return { error: "E-Mail im Entwurf erforderlich" };
  }

  if (fromCustomer !== email) {
    const nextCustomer =
      cust && typeof cust === "object"
        ? { ...(cust as Record<string, unknown>) }
        : ({} as Record<string, unknown>);
    nextCustomer.email = email;
    return { email, merged: { ...merged, customer: nextCustomer } };
  }
  return { email, merged };
}

/**
 * Legt einen Shopware-Kunden aus Entwurfsdaten an (manuell oder aus Pipeline).
 */
export async function tryCreateShopwareCustomerFromExtractedData(
  shopwareClient: ShopwareClient,
  extractedData: {
    customer?: DraftExtractedCustomer;
    billingAddress?: DraftBillingAddressInput;
    shippingAddress?: DraftBillingAddressInput;
  },
  email: string
): Promise<{ id: string } | { error: string }> {
  const bill = extractedData.billingAddress;
  if (!bill?.street?.trim() || !bill.zipCode?.trim() || !bill.city?.trim() || !bill.country?.trim()) {
    return {
      error: "Rechnungsadresse unvollständig (Straße, PLZ, Ort, Land erforderlich).",
    };
  }
  const em = email.trim();
  if (!SHOPWARE_CUSTOMER_EMAIL_RE.test(em)) {
    return { error: "Gültige E-Mail-Adresse erforderlich." };
  }
  const cust = extractedData.customer ?? {};
  try {
    const created = await shopwareClient.createCustomer({
      email: em,
      firstName: cust.firstName,
      lastName: cust.lastName,
      company: cust.company,
      billingAddress: {
        firstName: bill.firstName,
        lastName: bill.lastName,
        street: bill.street!,
        zipCode: bill.zipCode!,
        city: bill.city!,
        country: bill.country!,
        company: bill.company,
      },
      shippingAddress:
        extractedData.shippingAddress?.street &&
        extractedData.shippingAddress?.zipCode &&
        extractedData.shippingAddress?.city &&
        extractedData.shippingAddress?.country
          ? {
              firstName: extractedData.shippingAddress.firstName,
              lastName: extractedData.shippingAddress.lastName,
              street: extractedData.shippingAddress.street,
              zipCode: extractedData.shippingAddress.zipCode,
              city: extractedData.shippingAddress.city,
              country: extractedData.shippingAddress.country,
              company: extractedData.shippingAddress.company,
            }
          : undefined,
    });
    if (created?.id) {
      return { id: String(created.id) };
    }
    return { error: "Shopware hat keine Kunden-ID zurückgegeben." };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

async function tryResolveCustomerByBillingAddress(
  shopwareClient: ShopwareClient,
  billing: { company?: string; zipCode?: string; street?: string }
): Promise<{ id: string; email?: string } | null> {
  const company = billing.company?.trim();
  const zip = billing.zipCode?.trim();
  if (!company && !zip) return null;
  const terms = [...new Set([company, zip].filter(Boolean))] as string[];
  for (const term of terms) {
    if (term.length < 2) continue;
    const hits = await shopwareClient.searchCustomers(term, 15);
    const needle = company ? norm(company) : "";
    for (const h of hits) {
      if (needle && h.company && norm(h.company).includes(needle.slice(0, Math.min(needle.length, 48)))) {
        return { id: h.id, email: h.email };
      }
      if (zip && h.company && needle && norm(h.company).includes(needle.slice(0, 24))) {
        return { id: h.id, email: h.email };
      }
    }
  }
  return null;
}

/**
 * Mehrere E-Mails gegen Shopware prüfen (Weiterleitungen); optional KI bei knappem Ranking.
 * Mutiert extractedData.customer (E-Mail + kurze Resolution-Metadaten).
 */
/** Ob die Shopware-Kundensuche/-anlage überhaupt anlaufen soll (E-Mail aus Kunde, Rechnungsadresse oder Mail-Kontext). */
export function shouldRunShopwareCustomerResolutionForDraft(
  extractedData: {
    customer?: { email?: string };
    billingAddress?: DraftBillingAddressInput & { email?: string };
  },
  emailContext?: string,
  siblingPdfExcerpts?: string
): boolean {
  if (emailContext?.trim() || siblingPdfExcerpts?.trim()) return true;
  if (extractedData.customer?.email?.trim()) return true;
  const be =
    typeof extractedData.billingAddress?.email === "string"
      ? extractedData.billingAddress.email.trim()
      : "";
  return be.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(be);
}

export async function resolveShopwareCustomerForDraft(
  shopwareClient: ShopwareClient,
  extractedData: {
    customer?: DraftExtractedCustomer;
    billingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
    };
    shippingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
    };
  },
  options: {
    emailContext?: string;
    siblingPdfExcerpts?: string;
    openaiClient?: OpenAI | null;
    allowLlmDisambiguation?: boolean;
    /** Mindest-Confidence für Auto-Angebot/-Bestellung nach Zuordnung (Anzeige nach Anlage) */
    customerMatchAutoMinConfidence?: number;
    /** Mindest-Score für automatische Kundenanlage (getrennt von Anzeige-Match ohne Shopware) */
    customerAutoCreateMinConfidence?: number;
    /** Mindest-Ranking-Score der gewählten E-Mail für Auto-Anlage (Heuristik) */
    minRankedEmailScoreForAutoCreate?: number;
  }
): Promise<string | null> {
  const billingEmailRaw =
    typeof (extractedData.billingAddress as { email?: string } | undefined)?.email === "string"
      ? String((extractedData.billingAddress as { email: string }).email).trim()
      : "";
  const billingEmailOk =
    billingEmailRaw.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmailRaw);

  let extractedEmail = extractedData.customer?.email?.trim() ?? "";
  if (!extractedEmail && billingEmailOk) {
    if (!extractedData.customer) extractedData.customer = {};
    extractedData.customer.email = billingEmailRaw;
    extractedEmail = billingEmailRaw;
  }

  let ranked = buildRankedCustomerEmails({
    emailContext: options.emailContext,
    siblingPdfExcerpts: options.siblingPdfExcerpts,
    extractedEmail,
  });

  if (ranked.length === 0) {
    if (!extractedData.customer) extractedData.customer = {};
    extractedData.customer.customerMatchConfidence = 0;
    return null;
  }

  if (!extractedData.customer) extractedData.customer = {};

  let usedLlm = false;
  let ordered = ranked.map((r) => r.email);

  const top = ranked[0];
  const second = ranked[1];
  if (
    options.allowLlmDisambiguation &&
    options.openaiClient &&
    options.emailContext?.trim() &&
    second &&
    top.score - second.score <= 5 &&
    top.score >= 10 &&
    second.score >= 8
  ) {
    const pool = ranked.slice(0, 5).map((r) => r.email);
    const picked = await disambiguateWithLlm(options.openaiClient, options.emailContext, pool);
    if (picked) {
      ordered = [picked, ...ordered.filter((e) => e !== picked)];
      usedLlm = true;
    }
  }

  let shopwareCustomerId: string | null = null;
  let chosenEmail: string | null = null;

  for (const tryEmail of ordered) {
    try {
      const customer = await shopwareClient.findCustomerByEmail(tryEmail);
      if (customer?.id) {
        shopwareCustomerId = customer.id;
        chosenEmail = (customer.email as string)?.trim() || tryEmail;
        break;
      }
    } catch (e) {
      console.warn(`[DraftCustomerEmail] findCustomerByEmail failed for ${tryEmail}:`, e);
    }
  }

  let addressSecondaryMatch = false;
  if (!shopwareCustomerId && extractedData.billingAddress) {
    const addrHit = await tryResolveCustomerByBillingAddress(shopwareClient, extractedData.billingAddress);
    if (addrHit) {
      shopwareCustomerId = addrHit.id;
      chosenEmail = addrHit.email?.trim() || chosenEmail;
      addressSecondaryMatch = true;
    }
  }

  const minForAutoOffer = options.customerMatchAutoMinConfidence ?? 72;
  const minForAutoCreate = options.customerAutoCreateMinConfidence ?? 50;
  const minRankedScore = options.minRankedEmailScoreForAutoCreate ?? 12;
  const matchConfidence = computeCustomerMatchConfidence({
    ranked,
    shopwareCustomerId,
    usedLlm,
    addressSecondaryMatch,
  });
  extractedData.customer.customerMatchConfidence = matchConfidence;

  const createEmailRaw = (chosenEmail ?? ordered[0] ?? "").trim();
  const createEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createEmailRaw);
  const topRanked = ranked[0];
  const autoCreateScore = computeCustomerAutoCreateScore({ ranked, usedLlm });

  const fullBillingForCreate = Boolean(
    extractedData.billingAddress?.street?.trim() &&
      extractedData.billingAddress?.zipCode?.trim() &&
      extractedData.billingAddress?.city?.trim() &&
      extractedData.billingAddress?.country?.trim()
  );

  /** Eindeutige E-Mail-Wahl: nur ein Kandidat oder klarer Abstand zum Zweitplatzierten. */
  const singleDominantEmailCandidate =
    ranked.length === 1 ||
    Boolean(
      topRanked &&
        ranked[1] &&
        topRanked.score - ranked[1].score >= 12
    );

  /**
   * Shopware-Kunde anlegen, wenn noch keiner gefunden wurde, Adresse vollständig ist und
   * die E-Mail plausibel gewählt wurde. Bei einem dominanten Kandidaten reicht der
   * Ranking-Score (z. B. nur extrahierte E-Mail aus PDF); bei mehreren Kandidaten
   * zusätzlich autoCreateScore-Schwelle, um Fehlzuordnungen zu begrenzen.
   */
  const canAutoCreate =
    !shopwareCustomerId &&
    createEmailValid &&
    fullBillingForCreate &&
    topRanked &&
    topRanked.score >= minRankedScore &&
    (singleDominantEmailCandidate || autoCreateScore >= minForAutoCreate);

  const createEmail = createEmailRaw;

  if (canAutoCreate && extractedData.billingAddress && createEmail) {
    const created = await tryCreateShopwareCustomerFromExtractedData(
      shopwareClient,
      extractedData,
      createEmail
    );
    if ("id" in created) {
      shopwareCustomerId = created.id;
      chosenEmail = createEmail;
      extractedData.customer.shopwareCustomerAutoCreated = true;
      extractedData.customer.customerMatchConfidence = Math.max(
        matchConfidence,
        Math.min(100, minForAutoOffer + 8)
      );
    } else {
      console.error("[DraftCustomerEmail] createCustomer failed:", created.error);
    }
  }

  if (chosenEmail) {
    extractedData.customer.email = chosenEmail;
  } else if (ordered[0]) {
    extractedData.customer.email = ordered[0];
  }

  let method: "heuristic" | "llm" | "extracted_only" = "heuristic";
  if (usedLlm) method = "llm";
  else if (
    ranked.length === 1 &&
    extractedEmail &&
    ranked[0].email === extractedEmail.toLowerCase()
  ) {
    method = "extracted_only";
  }

  extractedData.customer.emailResolution = {
    candidatesTried: ordered.slice(0, 12),
    chosenEmail: extractedData.customer.email,
    method,
  };

  return shopwareCustomerId;
}
