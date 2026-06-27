import { buildRankedCustomerEmails } from "./draftCustomerEmailResolution";
import { buildSafeHttpsUrl, validateHttpsUrlForOutboundFetch } from "./safeOutboundUrl";

const USER_AGENT = "METAorder-CommercialAgent/1.0 (+https://metaorder; domain verification)";
const MAX_RESPONSE_BYTES = 600_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_URLS_TO_TRY = 3;

const FREEMAIL_DOMAINS = new Set(
  [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "gmx.de",
    "gmx.net",
    "gmx.at",
    "web.de",
    "t-online.de",
    "yahoo.com",
    "yahoo.de",
    "icloud.com",
    "me.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "mailbox.org",
    "posteo.de",
    "mail.de",
    "yandex.com",
    "yandex.ru",
    "zoho.com",
  ].map((d) => d.toLowerCase())
);

export type WebDomainVerificationChecks = {
  zipMatch: boolean;
  cityMatch: boolean;
  companyMatch: boolean;
  streetPartialMatch: boolean;
};

export type WebDomainVerificationResult = {
  domain: string;
  urlsTried: string[];
  ok: boolean;
  checks: WebDomainVerificationChecks;
  excerpt?: string;
  error?: string;
  fetchedAt: string;
  skippedReason?: "freemail" | "no_domain" | "no_email_context";
};

function extractRegistrableDomainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.length > 200) return null;
  if (FREEMAIL_DOMAINS.has(domain)) return null;
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  return domain;
}

function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function normToken(s: string | undefined): string {
  if (!s?.trim()) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normZip(z: string | undefined): string {
  if (!z) return "";
  const m = z.replace(/\D/g, "").match(/(\d{4,5})/);
  return m ? m[1] : "";
}

async function fetchTextLimited(url: string): Promise<{ ok: boolean; text?: string; status?: number; error?: string }> {
  const v = validateHttpsUrlForOutboundFetch(url);
  if (!v.ok) return { ok: false, error: v.error };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(v.url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    const buf = await res.arrayBuffer();
    clearTimeout(t);
    const slice = buf.byteLength > MAX_RESPONSE_BYTES ? buf.slice(0, MAX_RESPONSE_BYTES) : buf;
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    const text = htmlToPlainText(raw);
    return { ok: res.ok, text, status: res.status };
  } catch (e: any) {
    clearTimeout(t);
    return { ok: false, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e) };
  }
}

function scoreCompanyInText(company: string | undefined, haystackNorm: string): boolean {
  if (!company?.trim()) return false;
  const n = normToken(company);
  if (n.length < 3) return false;
  if (haystackNorm.includes(n)) return true;
  const parts = n.split(" ").filter((w) => w.length > 2);
  if (parts.length >= 2) {
    const hits = parts.filter((w) => haystackNorm.includes(w));
    return hits.length >= Math.min(2, parts.length);
  }
  return false;
}

function streetPartialInText(street: string | undefined, haystackNorm: string): boolean {
  if (!street?.trim()) return false;
  const n = normToken(street);
  if (n.length < 6) return haystackNorm.includes(n);
  const head = n.slice(0, 14);
  return haystackNorm.includes(head);
}

function runChecks(
  billing: {
    zipCode?: string;
    city?: string;
    street?: string;
    company?: string;
  },
  customerCompany: string | undefined,
  pageNorm: string
): WebDomainVerificationChecks {
  const zip = normZip(billing.zipCode);
  const zipMatch = zip.length >= 4 && pageNorm.includes(zip);
  const city = normToken(billing.city);
  const cityMatch = city.length >= 3 && pageNorm.includes(city);
  const companyMatch =
    scoreCompanyInText(billing.company, pageNorm) || scoreCompanyInText(customerCompany, pageNorm);
  const streetPartialMatch = streetPartialInText(billing.street, pageNorm);
  return { zipMatch, cityMatch, companyMatch, streetPartialMatch };
}

/**
 * Reichert extractedData um webDomainVerification an (kein Überschreiben der Extraktion).
 */
export async function enrichExtractedDataWithWebDomainVerification(
  extractedData: Record<string, unknown>,
  ctx: {
    emailContext?: string;
    siblingPdfExcerpts?: string;
    enabled: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();
  if (!ctx.enabled) return;

  const cust = extractedData.customer as
    | { email?: string; company?: string }
    | undefined;
  const billing = (extractedData.billingAddress || {}) as {
    zipCode?: string;
    city?: string;
    street?: string;
    company?: string;
  };

  const ranked = buildRankedCustomerEmails({
    emailContext: ctx.emailContext,
    siblingPdfExcerpts: ctx.siblingPdfExcerpts,
    extractedEmail: cust?.email,
  });
  const bestEmail = ranked[0]?.email;
  if (!bestEmail) {
    (extractedData as { webDomainVerification?: WebDomainVerificationResult }).webDomainVerification = {
      domain: "",
      urlsTried: [],
      ok: false,
      checks: {
        zipMatch: false,
        cityMatch: false,
        companyMatch: false,
        streetPartialMatch: false,
      },
      skippedReason: "no_email_context",
      fetchedAt: now,
    };
    return;
  }

  const domain = extractRegistrableDomainFromEmail(bestEmail);
  if (!domain) {
    (extractedData as { webDomainVerification?: WebDomainVerificationResult }).webDomainVerification = {
      domain: "",
      urlsTried: [],
      ok: false,
      checks: {
        zipMatch: false,
        cityMatch: false,
        companyMatch: false,
        streetPartialMatch: false,
      },
      skippedReason: "freemail",
      fetchedAt: now,
    };
    return;
  }

  const pathList = ["/impressum", "/de/impressum", "/kontakt", "/"];
  const urlsTried: string[] = [];
  const chunks: string[] = [];
  let lastError: string | undefined;

  for (const p of pathList) {
    if (urlsTried.length >= MAX_URLS_TO_TRY) break;
    const u = buildSafeHttpsUrl(domain, p);
    if (!u) continue;
    urlsTried.push(u);
    const r = await fetchTextLimited(u);
    if (!r.ok) {
      if (r.error) lastError = r.error;
      else if (r.status) lastError = `http_${r.status}`;
      continue;
    }
    if (r.text && r.text.length > 80) {
      chunks.push(r.text);
    }
  }

  const combinedNorm = normToken(chunks.join("\n\n"));

  if (!combinedNorm || combinedNorm.length < 80) {
    (extractedData as { webDomainVerification?: WebDomainVerificationResult }).webDomainVerification = {
      domain,
      urlsTried,
      ok: false,
      checks: {
        zipMatch: false,
        cityMatch: false,
        companyMatch: false,
        streetPartialMatch: false,
      },
      error: lastError || "no_text",
      fetchedAt: now,
    };
    return;
  }

  const checks = runChecks(billing, cust?.company, combinedNorm);
  const excerpt = combinedNorm.slice(0, 400);
  const ok = checks.zipMatch || checks.cityMatch || checks.companyMatch || checks.streetPartialMatch;

  (extractedData as { webDomainVerification?: WebDomainVerificationResult }).webDomainVerification = {
    domain,
    urlsTried,
    ok,
    checks,
    excerpt,
    fetchedAt: now,
    error: ok ? undefined : lastError || "no_matching_fields",
  };
}
