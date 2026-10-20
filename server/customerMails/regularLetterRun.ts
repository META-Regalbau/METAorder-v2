/**
 * Kundenmails B2 „Stammkunden-Brief“ (mit Datenbank und Shopware): Kandidaten aus dem Bestell-Spiegel, aktuelle
 * Preise/Lieferzeiten/Links live aus dem Shop (DE-Kanal, unter der Shop-Sperre), Zubehör aus den im Shop aktiven
 * Crossselling-Paaren, Ausschlüsse (Reklamation, Zahlung). Regeln: ./regularLetter.ts.
 *
 * Zwei Arten:
 * - preview: Briefe echter Beispielkunden gehen an die Testadressen (Lauf „test“, previewOf = regularLetter).
 *   Kein Kunde bekommt etwas. Je Testadresse ein anderer Beispielkunde, abwechselnd mit beiden Fußzeilen.
 * - customers: Entwurf an Kunden; nur wenn „regularLetter“ in den Einstellungen für Kunden freigeschaltet ist.
 */
import { and, desc, eq, inArray, notInArray, sql, isNull, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";
import { withShopLock } from "../shopContent/shopWatch";
import { findDeChannel, loadIndustryShopProducts, shopApi } from "../shopContent/shopProducts";
import { isPassthroughOrder } from "../shopPulse/regulars";
import { crossSellPairStates, marketingContacts, shopwareOrders, tickets } from "@shared/schema";
import type { CustomerMailRunDetail } from "@shared/customerMails";
import { normalizeEmail, type PlanCandidate } from "./legalBasis";
import {
  letterCandidates,
  letterContent,
  letterExclusion,
  type LetterContent,
  type LetterCustomer,
  type LetterOrder,
  type LetterProduct,
} from "./regularLetter";
import { REGULAR_LETTER_DEFAULT_SUBJECT, REGULAR_LETTER_TEMPLATE_NAME, regularLetterTemplateHtml } from "./regularLetterTemplate";
import { createRun, CustomerMailError, getBrevoApiKey, getCustomerMailSettings, type CustomerMailDeps } from "./customerMailsRun";

const log = logger.child({ component: "customerMails/regularLetterRun" });
const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const PRODUCT_BATCH = 100;

/** Bestellungen mit Positionen und Zahlungsstand aus dem Spiegel (MO, je Nummer die zuletzt geänderte Zeile) */
export async function loadLetterOrders(tenantId: string | null): Promise<LetterOrder[]> {
  const p = shopwareOrders.payload;
  const rows = await db
    .select({
      orderNumber: shopwareOrders.orderNumber,
      salesChannelId: shopwareOrders.salesChannelId,
      swUpdatedAt: shopwareOrders.swUpdatedAt,
      createdAt: sql<string | null>`${p}->>'createdAt'`,
      status: sql<string | null>`${p}->>'status'`,
      paymentStatus: sql<string | null>`${p}->>'paymentStatus'`,
      overdue: sql<string | null>`${p}->>'isPaymentOverdue'`,
      customerNumber: sql<string | null>`${p}->>'customerNumber'`,
      company: sql<string | null>`${p}->'billingAddress'->>'company'`,
      contactName: sql<string | null>`${p}->>'customerName'`,
      customerEmail: sql<string | null>`${p}->>'customerEmail'`,
      items: sql<unknown>`${p}->'items'`,
    })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), sql`${shopwareOrders.orderNumber} ILIKE 'MO%'`));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const n = String(r.orderNumber ?? "").trim();
    if (!n) continue;
    const prev = latest.get(n);
    if (!prev || (r.swUpdatedAt?.getTime() ?? 0) > (prev.swUpdatedAt?.getTime() ?? 0)) latest.set(n, r);
  }
  const out: LetterOrder[] = [];
  for (const [orderNumber, r] of Array.from(latest.entries())) {
    const createdAt = r.createdAt ? new Date(r.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;
    const email = String(r.customerEmail ?? "");
    out.push({
      orderNumber,
      email,
      customerNumber: String(r.customerNumber ?? ""),
      salesChannelId: r.salesChannelId ?? null,
      status: r.status ?? null,
      createdAt,
      // überfällig nur, solange noch offen (isPaymentOverdue ist der Stand beim letzten Abgleich der Bestellung)
      paymentOverdue: r.overdue === "true" && (r.paymentStatus === "open" || r.paymentStatus === "authorized"),
      passthrough: isPassthroughOrder({ contactName: String(r.contactName ?? ""), customerEmail: email, company: String(r.company ?? "") }),
      items: (Array.isArray(r.items) ? r.items : [])
        .map((i: any) => ({ productNumber: String(i?.productNumber ?? "").trim(), name: String(i?.name ?? "").trim(), netTotal: Number(i?.netTotal ?? 0) || 0 }))
        .filter((i) => i.productNumber),
    });
  }
  return out;
}

/** E-Mail-Adressen mit offener Reklamation (Ticket-Kategorie complaint, nicht erledigt/geschlossen) */
export async function openComplaintEmails(tenantId: string | null): Promise<Set<string>> {
  const rows = await db
    .select({ email: tickets.customerEmail })
    .from(tickets)
    .where(and(tenantIs(tickets.tenantId, tenantId), eq(tickets.category, "complaint"), notInArray(tickets.status, ["resolved", "closed"])));
  return new Set(rows.map((r) => normalizeEmail(r.email)).filter((e): e is string => !!e));
}

/** Im Shop aktive Crossselling-Paare („Das passt dazu“) je Quellartikel, beste zuerst */
export async function appliedAccessories(tenantId: string | null, sources: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!sources.length) return out;
  const rows = await db
    .select({ source: crossSellPairStates.sourceProductNumber, target: crossSellPairStates.targetProductNumber, score: crossSellPairStates.score })
    .from(crossSellPairStates)
    .where(and(eq(crossSellPairStates.tenantId, tenantId ?? ""), eq(crossSellPairStates.status, "applied"), inArray(crossSellPairStates.sourceProductNumber, sources)))
    .orderBy(desc(crossSellPairStates.score));
  for (const r of rows) out.set(r.source, [...(out.get(r.source) ?? []), r.target]);
  return out;
}

/** Aktuelle Shopdaten (Preis netto, Lieferzeit, Link) der Artikel, in Paketen; unter der Shop-Sperre */
async function loadLetterProducts(deps: CustomerMailDeps, tenantId: string | null, numbers: string[]): Promise<Map<string, LetterProduct>> {
  const settings = await deps.storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error("Shopware not configured");
  const { api, base } = shopApi(settings);
  return withShopLock(tenantId, async () => {
    const de = await findDeChannel(api, base);
    const out = new Map<string, LetterProduct>();
    for (let i = 0; i < numbers.length; i += PRODUCT_BATCH) {
      const chunk = numbers.slice(i, i + PRODUCT_BATCH);
      const { products, problems } = await loadIndustryShopProducts(api, chunk, de);
      const blocked = new Set(problems.filter((p) => p.problem !== "missing").map((p) => p.number));
      for (const [n, p] of Object.entries(products)) {
        out.set(n, { name: p.name, priceNet: typeof p.priceNet === "number" ? p.priceNet : null, deliveryTime: p.deliveryTime ?? null, url: p.url ?? "", sellable: !blocked.has(n) });
      }
    }
    return out;
  });
}

export type LetterBuild = { customer: LetterCustomer; content: LetterContent | null; exclusion: ReturnType<typeof letterExclusion> };

/** Alle Briefe bauen (ohne Rechtsgrundlage; die prüft createRun) */
export async function buildRegularLetters(deps: CustomerMailDeps, tenantId: string | null): Promise<LetterBuild[]> {
  const now = deps.now();
  const customers = letterCandidates(await loadLetterOrders(tenantId), now);
  const sources = Array.from(new Set(customers.flatMap((c) => c.itemNumbers)));
  const accessories = await appliedAccessories(tenantId, sources);
  const numbers = Array.from(new Set([...sources, ...Array.from(accessories.values()).flat()]));
  const products = numbers.length ? await loadLetterProducts(deps, tenantId, numbers) : new Map<string, LetterProduct>();
  const complaints = await openComplaintEmails(tenantId);
  return customers.map((customer) => ({ customer, content: letterContent(customer, products, accessories), exclusion: letterExclusion(customer, complaints) }));
}

/** Stammkunden-Brief anlegen: Vorschau an die Testadressen oder Entwurf für Kunden */
export async function createRegularLetterRun(
  deps: CustomerMailDeps,
  tenantId: string | null,
  input: { templateId: number; senderId: number; subject: string; mode: "preview" | "customers" },
  by: string,
): Promise<CustomerMailRunDetail> {
  const { settings } = await getCustomerMailSettings(deps.storage, tenantId);
  if (input.mode === "customers" && !settings.liveTypes.includes("regularLetter")) throw new CustomerMailError("customerSendingOff");
  if (input.mode === "preview" && !settings.testRecipients.length) throw new CustomerMailError("noTestRecipients");
  const builds = await buildRegularLetters(deps, tenantId);
  const withContent = builds.filter((b) => b.content);
  const build = { candidates: builds.length, withContent: withContent.length, excluded: builds.filter((b) => b.exclusion).length };
  log.info({ tenantId, mode: input.mode, ...build }, "Kundenmails: Stammkunden-Briefe gebaut");

  let candidates: PlanCandidate[];
  if (input.mode === "preview") {
    // Beispielkunden mit Zubehör zuerst, damit die Vorschau alle Abschnitte zeigt
    const samples = [...withContent].sort((a, b) => (b.content!.accessories.length > 0 ? 1 : 0) - (a.content!.accessories.length > 0 ? 1 : 0));
    if (!samples.length) throw new CustomerMailError("noRecipients");
    const emails = samples.slice(0, settings.testRecipients.length).map((s) => s.customer.email);
    const rows = emails.length ? await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), inArray(marketingContacts.email, emails))) : [];
    const contacts = new Map(rows.map((r) => [r.email, r]));
    candidates = settings.testRecipients.map((email, i) => {
      const s = samples[i % samples.length];
      const c = contacts.get(s.customer.email);
      return {
        email,
        attributes: {
          ...s.content!.attributes,
          MO_FIRMA: c?.company ?? "",
          MO_NAME: c?.contactName ?? "",
          MO_KUNDENNR: s.customer.customerNumber ?? "",
          // abwechselnd beide Fußzeilen zeigen
          MO_GRUNDLAGE: i % 2 === 0 ? "bestandskunde" : "einwilligung",
        },
      };
    });
  } else {
    candidates = builds
      .filter((b) => b.content || b.exclusion)
      .map((b) => ({
        email: b.customer.email,
        customerNumber: b.customer.customerNumber,
        salesChannelId: b.customer.salesChannelId,
        attributes: b.content?.attributes ?? {},
        skipReason: b.exclusion,
      }));
  }
  const run = await createRun(
    deps,
    tenantId,
    { mailType: input.mode === "preview" ? "test" : "regularLetter", previewOf: input.mode === "preview" ? "regularLetter" : null, subject: input.subject, templateId: input.templateId, senderId: input.senderId, candidates },
    by,
  );
  return { ...run, build };
}

/** Startvorlage in Brevo anlegen; liefert die ID */
export async function createRegularLetterTemplate(deps: CustomerMailDeps, tenantId: string | null, senderId: number): Promise<number> {
  const key = await getBrevoApiKey(deps.storage, tenantId);
  if (!key) throw new CustomerMailError("keyMissing");
  const id = await deps.brevo(key).createTemplate({ name: REGULAR_LETTER_TEMPLATE_NAME, subject: REGULAR_LETTER_DEFAULT_SUBJECT, html: regularLetterTemplateHtml(), senderId });
  log.info({ tenantId, templateId: id }, "Kundenmails: Brevo-Vorlage Stammkunden-Brief angelegt");
  return id;
}
