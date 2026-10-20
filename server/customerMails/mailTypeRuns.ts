/**
 * Kundenmails: Läufe aller Mailarten (B2 Stammkunden-Brief, B2b Überfällig-Erinnerung, B4 Newsletter, B3 After-Sales,
 * B5 Reaktivierung) mit Datenbank und Shop. Inhaltsregeln: ./regularLetter.ts und ./mailContent.ts.
 *
 * Jede Mailart liefert Kandidaten (Empfänger mit Brevo-Feldern, ggf. mit eigenem Ausschlussgrund) und Beispiele für
 * die Vorschau. „preview“ schickt echte Inhalte von Beispielkunden an die Testadressen (kein Kunde bekommt etwas),
 * „customers“ legt einen Entwurf an und geht nur, wenn die Mailart in den Einstellungen für Kunden freigeschaltet ist.
 */
import { and, desc, eq, inArray, isNotNull, isNull, max, sql, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";
import { customerInteractions, customers as crmCustomers, marketingContacts, marketingMailRecipients, shopwareProducts } from "@shared/schema";
import { CUSTOMER_MAIL_TYPE_RULES, type CustomerMailBuildType, type CustomerMailRunDetail } from "@shared/customerMails";
import { normalizeEmail, type PlanCandidate } from "./legalBasis";
import { letterCandidates, letterContent, ordersByEmail, type LetterOrder, type LetterProduct } from "./regularLetter";
import {
  ACCESSORY_MAX_DAYS,
  ACCESSORY_MIN_DAYS,
  accessoryMailAttributes,
  inControlGroup,
  newProductAttributes,
  NEW_PRODUCT_DAYS,
  ordersShippedBetween,
  overdueBlocker,
  REACTIVATION_MAX_DAYS,
  REACTIVATION_MIN_DAYS,
  SERVICE_MAX_DAYS,
  SERVICE_MIN_DAYS,
  serviceMailAttributes,
} from "./mailContent";
import { appliedAccessories, buildRegularLetters, loadLetterOrders, loadLetterProducts, openComplaintEmails } from "./regularLetterRun";
import { MAIL_TEMPLATES } from "./mailTemplates";
import { createRun, CustomerMailError, getBrevoApiKey, getCustomerMailSettings, type CustomerMailDeps } from "./customerMailsRun";

const log = logger.child({ component: "customerMails/mailTypeRuns" });
const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const DAY_MS = 24 * 60 * 60 * 1000;

export type BuiltCandidates = {
  candidates: PlanCandidate[];
  /** Kandidaten mit Inhalt und ohne eigenen Ausschluss (für die Vorschau) */
  samples: PlanCandidate[];
  build: { candidates: number; withContent: number; excluded: number };
};

/** Schon verschickte Empfänger einer Mailart: E-Mail → letzter Versand, Bestellnummern (MO_BESTELLNR) */
export async function sentHistory(tenantId: string | null, mailType: string): Promise<{ byEmail: Map<string, Date>; orders: Set<string> }> {
  const rows = await db
    .select({ email: marketingMailRecipients.email, sentAt: marketingMailRecipients.sentAt, order: sql<string | null>`${marketingMailRecipients.attributes}->>'MO_BESTELLNR'` })
    .from(marketingMailRecipients)
    .where(and(tenantIs(marketingMailRecipients.tenantId, tenantId), eq(marketingMailRecipients.mailType, mailType), eq(marketingMailRecipients.status, "sent")));
  const byEmail = new Map<string, Date>();
  const orders = new Set<string>();
  for (const r of rows) {
    if (r.sentAt && (!byEmail.get(r.email) || r.sentAt > byEmail.get(r.email)!)) byEmail.set(r.email, r.sentAt);
    if (r.order) orders.add(r.order);
  }
  return { byEmail, orders };
}

/** Letzter CRM-Anruf je E-Mail (Interaktion „call“ an der lokalen Kundenzeile) */
export async function lastCallsByEmail(tenantId: string | null): Promise<Map<string, Date>> {
  const rows = await db
    .select({ email: crmCustomers.email, at: max(customerInteractions.createdAt) })
    .from(customerInteractions)
    .innerJoin(crmCustomers, eq(crmCustomers.id, customerInteractions.customerId))
    .where(and(tenantIs(customerInteractions.tenantId, tenantId), eq(customerInteractions.interactionType, "call")))
    .groupBy(crmCustomers.email);
  const out = new Map<string, Date>();
  for (const r of rows) {
    const e = normalizeEmail(r.email);
    if (e && r.at) out.set(e, r.at instanceof Date ? r.at : new Date(r.at as unknown as string));
  }
  return out;
}

const withoutExclusion = (c: PlanCandidate) => !c.skipReason && Object.keys(c.attributes ?? {}).length > 0;

async function regularLetter(deps: CustomerMailDeps, tenantId: string | null): Promise<BuiltCandidates> {
  const builds = await buildRegularLetters(deps, tenantId);
  const candidates = builds
    .filter((b) => b.content || b.exclusion)
    .map((b) => ({ email: b.customer.email, customerNumber: b.customer.customerNumber, salesChannelId: b.customer.salesChannelId, attributes: b.content?.attributes ?? {}, skipReason: b.exclusion }));
  // Beispiele mit Zubehör zuerst, damit die Vorschau alle Abschnitte zeigt
  const samples = builds
    .filter((b) => b.content && !b.exclusion)
    .sort((a, b) => (b.content!.accessories.length ? 1 : 0) - (a.content!.accessories.length ? 1 : 0))
    .map((b) => ({ email: b.customer.email, customerNumber: b.customer.customerNumber, attributes: b.content!.attributes }));
  return { candidates, samples, build: { candidates: builds.length, withContent: builds.filter((b) => b.content).length, excluded: builds.filter((b) => b.exclusion).length } };
}

async function regularOverdue(deps: CustomerMailDeps, tenantId: string | null): Promise<BuiltCandidates> {
  const now = deps.now();
  // Stammkunden-Wache (Shop-Puls S3-4); dynamisch, damit Kundenmails nicht am Shop-Puls-Takt hängt
  const [{ regularDeps }, { loadRegularsContext, toCustomer }] = await Promise.all([import("../shopPulse/shopPulseScheduler"), import("../shopPulse/regularsRun")]);
  const ctx = await loadRegularsContext(regularDeps(deps.storage as any), tenantId, now);
  const watched = ctx.analyses.map((a) => toCustomer(a, ctx)).filter((c) => c.state === "alerted");
  const letters = new Map((await buildRegularLetters(deps, tenantId)).map((b) => [b.customer.customerNumber ?? "", b]));
  const calls = await lastCallsByEmail(tenantId);
  const sent = await sentHistory(tenantId, "regularOverdue");
  const candidates: PlanCandidate[] = [];
  let excluded = 0;
  for (const c of watched) {
    const letter = letters.get(c.customerNumber);
    if (!letter?.content) continue;
    const email = letter.customer.email;
    const blocker = overdueBlocker(
      { state: c.state, alertedAt: c.alertedAt ? new Date(c.alertedAt) : null, causes: c.causes.length, lastCallAt: calls.get(email) ?? null, lastReminderAt: sent.byEmail.get(email) ?? null },
      now,
    );
    if (blocker) {
      excluded += 1;
      continue;
    }
    candidates.push({
      email,
      customerNumber: c.customerNumber,
      salesChannelId: letter.customer.salesChannelId,
      attributes: { ...letter.content.attributes, MO_TAGE_SEIT: c.daysSinceLast },
      skipReason: letter.exclusion,
    });
  }
  // Vorschau: auch ohne fällige Erinnerung echte Inhalte gemeldeter (sonst beliebiger) Stammkunden zeigen
  const sampleSource = watched.map((c) => letters.get(c.customerNumber)).filter((b) => b?.content && !b.exclusion);
  const fallback = Array.from(letters.values()).filter((b) => b.content && !b.exclusion);
  const samples = (sampleSource.length ? sampleSource : fallback).map((b) => ({ email: b!.customer.email, customerNumber: b!.customer.customerNumber, attributes: b!.content!.attributes }));
  return { candidates, samples, build: { candidates: watched.length, withContent: candidates.length, excluded } };
}

/** Neueste aktive Artikel laut Produktspiegel (Shopware-Anlagedatum) */
async function recentProducts(tenantId: string | null, now: Date): Promise<Array<{ productNumber: string; createdAt: Date }>> {
  const since = new Date(now.getTime() - NEW_PRODUCT_DAYS * DAY_MS).toISOString();
  const p = shopwareProducts.payload;
  const rows = await db
    .select({ productNumber: shopwareProducts.productNumber, createdAt: sql<string | null>`${p}->>'createdAt'` })
    .from(shopwareProducts)
    .where(and(tenantIs(shopwareProducts.tenantId, tenantId), eq(shopwareProducts.active, true), sql`(${p}->>'createdAt')::timestamptz >= ${since}::timestamptz`))
    .orderBy(desc(sql`(${p}->>'createdAt')::timestamptz`))
    .limit(40);
  return rows.filter((r) => r.productNumber && r.createdAt).map((r) => ({ productNumber: r.productNumber as string, createdAt: new Date(r.createdAt as string) }));
}

async function newsletter(deps: CustomerMailDeps, tenantId: string | null): Promise<BuiltCandidates> {
  const now = deps.now();
  const fresh = await recentProducts(tenantId, now);
  const products = fresh.length ? await loadLetterProducts(deps, tenantId, fresh.map((f) => f.productNumber)) : new Map<string, LetterProduct>();
  const attributes = newProductAttributes(fresh, products, now);
  const rows = await db
    .select({ email: marketingContacts.email, customerNumber: marketingContacts.customerNumber, salesChannelId: marketingContacts.salesChannelId })
    .from(marketingContacts)
    .where(and(tenantIs(marketingContacts.tenantId, tenantId), isNotNull(marketingContacts.consentAt)));
  const candidates = rows.map((r) => ({ email: r.email, customerNumber: r.customerNumber, salesChannelId: r.salesChannelId, attributes }));
  return { candidates, samples: [{ email: "", attributes }], build: { candidates: rows.length, withContent: rows.length, excluded: 0 } };
}

async function afterSales(deps: CustomerMailDeps, tenantId: string | null, kind: "afterSalesService" | "afterSalesAccessories"): Promise<BuiltCandidates> {
  const now = deps.now();
  const orders = await loadLetterOrders(tenantId);
  const [minDays, maxDays] = kind === "afterSalesService" ? [SERVICE_MIN_DAYS, SERVICE_MAX_DAYS] : [ACCESSORY_MIN_DAYS, ACCESSORY_MAX_DAYS];
  const due = ordersShippedBetween(orders, now, minDays, maxDays);
  const sent = await sentHistory(tenantId, kind);
  const open = due.filter((o) => !sent.orders.has(o.orderNumber));
  // Vorschau auch ohne fällige Bestellungen: die jüngsten versandten Bestellungen als Beispiele
  const sampleOrders = open.length ? open : ordersShippedBetween(orders, now, 0, 120).slice(-20);
  const sources = Array.from(new Set([...open, ...sampleOrders].flatMap((o) => o.items.map((i) => i.productNumber))));
  const accessories = kind === "afterSalesAccessories" ? await appliedAccessories(tenantId, sources) : new Map<string, string[]>();
  const numbers = Array.from(new Set([...sources, ...Array.from(accessories.values()).flat()]));
  const products = numbers.length ? await loadLetterProducts(deps, tenantId, numbers) : new Map<string, LetterProduct>();
  const bought = new Map(Array.from(ordersByEmail(orders).entries()).map(([e, list]) => [e, new Set(list.flatMap((o) => o.items.map((i) => i.productNumber)))]));
  const complaints = await openComplaintEmails(tenantId);
  const content = (o: LetterOrder) => {
    const email = normalizeEmail(o.email) ?? "";
    return kind === "afterSalesService" ? serviceMailAttributes(o, products) : accessoryMailAttributes(o, bought.get(email) ?? new Set(), products, accessories);
  };
  const candidates: PlanCandidate[] = [];
  for (const o of open) {
    const attributes = content(o);
    if (!attributes) continue;
    const email = normalizeEmail(o.email) ?? o.email;
    // Werbung nicht bei offener Reklamation; die Service-Mail geht trotzdem (sie gehört zur Bestellung)
    candidates.push({ email, customerNumber: o.customerNumber || null, salesChannelId: o.salesChannelId, attributes, skipReason: kind === "afterSalesAccessories" && complaints.has(email) ? "complaint" : null });
  }
  const samples = sampleOrders
    .map((o) => ({ o, attributes: content(o) }))
    .filter((x): x is { o: LetterOrder; attributes: Record<string, string | number | null> } => !!x.attributes)
    .reverse()
    .map((x) => ({ email: normalizeEmail(x.o.email) ?? x.o.email, customerNumber: x.o.customerNumber || null, attributes: x.attributes }));
  return { candidates, samples, build: { candidates: open.length, withContent: candidates.length, excluded: candidates.filter((c) => c.skipReason).length } };
}

async function reactivation(deps: CustomerMailDeps, tenantId: string | null): Promise<BuiltCandidates> {
  const now = deps.now();
  const orders = await loadLetterOrders(tenantId);
  const customers = letterCandidates(orders, now, { minDays: 1, maxDays: 1, lookbackDays: 730, lastOrderMinAgeDays: REACTIVATION_MIN_DAYS, lastOrderMaxAgeDays: REACTIVATION_MAX_DAYS });
  const sent = await sentHistory(tenantId, "reactivation");
  const fresh = customers.filter((c) => !sent.byEmail.has(c.email));
  const sources = Array.from(new Set(fresh.flatMap((c) => c.itemNumbers)));
  const accessories = await appliedAccessories(tenantId, sources);
  const numbers = Array.from(new Set([...sources, ...Array.from(accessories.values()).flat()]));
  const products = numbers.length ? await loadLetterProducts(deps, tenantId, numbers) : new Map<string, LetterProduct>();
  const complaints = await openComplaintEmails(tenantId);
  const candidates: PlanCandidate[] = [];
  const samples: PlanCandidate[] = [];
  for (const c of fresh) {
    const content = letterContent(c, products, accessories);
    if (!content) continue;
    const skipReason = complaints.has(c.email) ? "complaint" : c.paymentOverdue ? "paymentOverdue" : inControlGroup(c.email, "reactivation") ? "controlGroup" : null;
    candidates.push({ email: c.email, customerNumber: c.customerNumber, salesChannelId: c.salesChannelId, attributes: content.attributes, skipReason });
    if (!skipReason) samples.push({ email: c.email, customerNumber: c.customerNumber, attributes: content.attributes });
  }
  return { candidates, samples, build: { candidates: fresh.length, withContent: candidates.length, excluded: candidates.filter((c) => c.skipReason).length } };
}

export async function buildCandidates(deps: CustomerMailDeps, tenantId: string | null, type: CustomerMailBuildType): Promise<BuiltCandidates> {
  switch (type) {
    case "regularLetter":
      return regularLetter(deps, tenantId);
    case "regularOverdue":
      return regularOverdue(deps, tenantId);
    case "newsletter":
      return newsletter(deps, tenantId);
    case "afterSalesService":
    case "afterSalesAccessories":
      return afterSales(deps, tenantId, type);
    case "reactivation":
      return reactivation(deps, tenantId);
  }
}

/** Lauf einer Mailart anlegen: Vorschau an die Testadressen oder Entwurf für Kunden */
export async function createTypedRun(
  deps: CustomerMailDeps,
  tenantId: string | null,
  input: { mailType: CustomerMailBuildType; templateId: number; senderId: number; subject: string; mode: "preview" | "customers" },
  by: string,
): Promise<CustomerMailRunDetail> {
  const { settings } = await getCustomerMailSettings(deps.storage, tenantId);
  if (input.mode === "customers" && !settings.liveTypes.includes(input.mailType)) throw new CustomerMailError("customerSendingOff");
  if (input.mode === "preview" && !settings.testRecipients.length) throw new CustomerMailError("noTestRecipients");
  const built = await buildCandidates(deps, tenantId, input.mailType);
  log.info({ tenantId, mailType: input.mailType, mode: input.mode, ...built.build }, "Kundenmails: Lauf gebaut");

  let candidates: PlanCandidate[];
  if (input.mode === "preview") {
    const samples = built.samples.filter(withoutExclusion);
    if (!samples.length) throw new CustomerMailError("noRecipients");
    const emails = samples.slice(0, settings.testRecipients.length).map((s) => s.email).filter(Boolean);
    const rows = emails.length ? await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), inArray(marketingContacts.email, emails))) : [];
    const contacts = new Map(rows.map((r) => [r.email, r]));
    candidates = settings.testRecipients.map((email, i) => {
      const s = samples[i % samples.length];
      const c = contacts.get(s.email);
      return {
        email,
        attributes: {
          ...s.attributes,
          MO_FIRMA: c?.company ?? "",
          MO_NAME: c?.contactName ?? "",
          MO_KUNDENNR: s.customerNumber ?? c?.customerNumber ?? "",
          // abwechselnd beide Fußzeilen zeigen (Newsletter nur mit Einwilligung)
          MO_GRUNDLAGE: input.mailType === "newsletter" || i % 2 === 1 ? "einwilligung" : "bestandskunde",
        },
      };
    });
  } else {
    candidates = built.candidates;
  }
  const run = await createRun(
    deps,
    tenantId,
    {
      mailType: input.mode === "preview" ? "test" : input.mailType,
      previewOf: input.mode === "preview" ? input.mailType : null,
      subject: input.subject,
      templateId: input.templateId,
      senderId: input.senderId,
      candidates,
    },
    by,
  );
  return { ...run, build: built.build };
}

/** Startvorlage einer Mailart in Brevo anlegen; liefert die ID */
export async function createMailTemplate(deps: CustomerMailDeps, tenantId: string | null, type: CustomerMailBuildType, senderId: number): Promise<number> {
  const key = await getBrevoApiKey(deps.storage, tenantId);
  if (!key) throw new CustomerMailError("keyMissing");
  const t = MAIL_TEMPLATES[type];
  const id = await deps.brevo(key).createTemplate({ name: t.name, subject: t.subject, html: t.html(), senderId });
  log.info({ tenantId, templateId: id, mailType: type, transactional: CUSTOMER_MAIL_TYPE_RULES[type].transactional }, "Kundenmails: Brevo-Startvorlage angelegt");
  return id;
}


