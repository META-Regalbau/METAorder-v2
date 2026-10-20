/**
 * Kundenmails B2 „Stammkunden-Brief“ (mit Datenbank und Shopware): Kandidaten aus dem Bestell-Spiegel, aktuelle
 * Preise/Lieferzeiten/Links live aus dem Shop (DE-Kanal, unter der Shop-Sperre), Zubehör aus den im Shop aktiven
 * Crossselling-Paaren, Ausschlüsse (Reklamation, Zahlung). Regeln: ./regularLetter.ts.
 *
 * Lauf (Vorschau/Kunden) und Startvorlage: ./mailTypeRuns.ts (gemeinsam für alle Mailarten).
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
import type { CustomerMailDeps } from "./customerMailsRun";

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
      net: sql<string | null>`${p}->>'netTotalAmount'`,
      shippedDate: sql<string | null>`${p}->'shippingInfo'->>'shippedDate'`,
      trackingUrl: sql<string | null>`${p}->'shippingInfo'->'trackingLinks'->0->>'url'`,
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
      net: Number(r.net ?? 0) || 0,
      shippedAt: r.shippedDate && !Number.isNaN(Date.parse(r.shippedDate)) ? new Date(r.shippedDate) : null,
      trackingUrl: r.trackingUrl && /^https?:\/\//i.test(r.trackingUrl) ? r.trackingUrl : null,
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
export async function loadLetterProducts(deps: CustomerMailDeps, tenantId: string | null, numbers: string[]): Promise<Map<string, LetterProduct>> {
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
        out.set(n, { name: p.name, priceNet: typeof p.priceNet === "number" ? p.priceNet : null, deliveryTime: p.deliveryTime ?? null, url: p.url ?? "", sellable: !blocked.has(n), image: p.image ?? null });
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
