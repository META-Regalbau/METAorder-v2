/**
 * Portal-Registrierungen: Ablauf je Anmeldung.
 *
 * Eingang (n8n) → Auslesen (KI + Regeln) → Abgleich mit dem Portal →
 *  - sicherer Treffer: Plan; mit „Automatisch ausführen“ sofort Mitarbeiter anlegen/aktualisieren,
 *    Passwort-Mail, Info an den Außendienst; sonst wartet die Anmeldung auf „Ausführen“
 *  - unsicher / Konflikt: Prüfung durch einen Bearbeiter
 *  - nicht im Portal: Mail an den Kundenstamm, Anmeldung wartet und wird regelmäßig neu geprüft
 * Mails verschickt n8n aus dem Postausgang (claimOutboxMails/ackOutboxMail).
 */
import type { IStorage } from "../storage";
import { storage as defaultStorage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";
import { createB2BAdminClient } from "./b2bSellersAdmin";
import { parseEmailBufferAutodetect } from "../email/emailParser";
import { unwrapInternalForward } from "../email/emailForwardUnwrap";
import { deriveUploadMessageId } from "../commercial/commercialEmailUploadIngest";
import { isOwnOperatorEmail } from "../commercial/draftCustomerEmailResolution";
import { acquireIntakeLock, releaseIntakeLock } from "../commercial/emailIntakeUpload";
import { graphBaseForMailbox, receivedAfterFor } from "@shared/emailIntake";
import {
  PORTAL_REGISTRATION_CATEGORIES,
  PORTAL_REGISTRATION_SETTING_KEY,
  normalizePortalRegistrationSettings,
  portalRegistrationMessageFilter,
  type PortalCustomerChange,
  type PortalRegistrationData,
  type PortalRegistrationEvent,
  type PortalRegistrationExtraction,
  type PortalRegistrationIntakeResponse,
  type PortalRegistrationListItem,
  type PortalRegistrationMatch,
  type PortalRegistrationOutboxMail,
  type PortalRegistrationPlan,
  type PortalRegistrationSettings,
  type PortalRegistrationStatus,
  type PortalRegistrationWorkflowConfig,
} from "@shared/portalRegistrations";
import type { PortalRegistrationRow } from "@shared/schema";
import { portalRegistrationRepo as repo } from "./portalRegistrationRepo";
import { extractPortalRegistration, type RegistrationLlm } from "./portalRegistrationExtraction";
import { decidePortalMatch } from "./portalRegistrationMatch";
import { buildRegistrationPlan, executeRegistrationPlan } from "./portalRegistrationPlan";
import { createPortalRegistrationShopApi, type PortalRegistrationShopApi } from "./portalRegistrationShop";
import { buildGraphMessage, buildMasterDataRequestMail, buildSalesRepInfoMail } from "./portalRegistrationMails";
import { portalLoginUrl } from "./portalPasswordRequest";
import { logger } from "../lib/logger";

const log = logger.child({ component: "b2b/portalRegistrationService" });

/** Graph sendMail nimmt höchstens 4 MB je Anfrage; base64 macht die Mail um ein Drittel größer */
const MAX_ATTACHED_EML_BYTES = 2_800_000;
/** Darunter entscheidet bei „nicht im Portal“ ein Mensch, ob es überhaupt eine Anmeldung ist */
const SURE_REGISTRATION_CONFIDENCE = 0.7;

export class PortalRegistrationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ---------- Einstellungen ----------

export async function getPortalRegistrationSettings(
  storage: Pick<IStorage, "getSetting"> = defaultStorage,
  tenantId?: string | null,
): Promise<PortalRegistrationSettings> {
  return normalizePortalRegistrationSettings(await storage.getSetting(PORTAL_REGISTRATION_SETTING_KEY, tenantId));
}

export async function savePortalRegistrationSettings(
  settings: PortalRegistrationSettings,
  tenantId: string | null,
  storage: Pick<IStorage, "saveSetting"> = defaultStorage,
): Promise<void> {
  await storage.saveSetting(PORTAL_REGISTRATION_SETTING_KEY, settings, tenantId);
}

export function portalRegistrationWorkflowConfig(
  settings: PortalRegistrationSettings,
  readiness: { ready: boolean; notReadyReason: string | null },
  now = new Date(),
): PortalRegistrationWorkflowConfig {
  const receivedAfter = receivedAfterFor(settings.processSince, now);
  return {
    enabled: settings.enabled,
    ...readiness,
    graphBase: graphBaseForMailbox(settings.mailbox),
    mailbox: settings.mailbox.trim() || null,
    processedFolderName: settings.processedFolderName,
    maxPerRun: settings.maxPerRun,
    receivedAfter,
    messageFilter: portalRegistrationMessageFilter(receivedAfter),
    categories: PORTAL_REGISTRATION_CATEGORIES,
  };
}

export function storefrontUrlFor(settings: PortalRegistrationSettings): string {
  return (settings.storefrontUrl || portalLoginUrl()).replace(/\/$/, "");
}

// ---------- Shop ----------

export type ShopApiFactory = (tenantId: string | null) => Promise<PortalRegistrationShopApi>;

export const defaultShopApiFactory: ShopApiFactory = async (tenantId) => {
  const shopSettings = await defaultStorage.getShopwareSettings(tenantId);
  if (!shopSettings) throw new PortalRegistrationError("Shopware ist für diesen Mandanten nicht eingerichtet", "shopware_not_configured", 503);
  return createPortalRegistrationShopApi(new ShopwareClient(shopSettings), await createB2BAdminClient(shopSettings));
};

export type ServiceContext = {
  tenantId: string | null;
  settings: PortalRegistrationSettings;
  userName?: string | null;
  userId?: string | null;
  /** Basisadresse für Links in Mails */
  appBaseUrl?: string | null;
  shopApi?: ShopApiFactory;
  storage?: Pick<IStorage, "getSetting">;
  llm?: RegistrationLlm;
};

const event = (type: PortalRegistrationEvent["type"], message: string, userName?: string | null): PortalRegistrationEvent => ({
  at: new Date().toISOString(),
  type,
  message,
  userName: userName ?? null,
});

// ---------- Darstellung ----------

export function categoriesForStatus(status: PortalRegistrationStatus, notRegistration = false): string[] {
  switch (status) {
    case "completed":
      return [PORTAL_REGISTRATION_CATEGORIES.done];
    case "waiting_master_data":
      return [PORTAL_REGISTRATION_CATEGORIES.masterData];
    case "failed":
      return [PORTAL_REGISTRATION_CATEGORIES.failed];
    case "discarded":
      return [notRegistration ? PORTAL_REGISTRATION_CATEGORIES.notRegistration : PORTAL_REGISTRATION_CATEGORIES.done];
    default:
      return [PORTAL_REGISTRATION_CATEGORIES.review];
  }
}

const asData = (row: PortalRegistrationRow) => (row.data ?? null) as PortalRegistrationData | null;
const asMatch = (row: PortalRegistrationRow) => (row.match ?? null) as PortalRegistrationMatch | null;
const asPlan = (row: PortalRegistrationRow) => (row.plan ?? null) as PortalRegistrationPlan | null;
const asExtraction = (row: PortalRegistrationRow) => (row.extraction ?? null) as PortalRegistrationExtraction | null;

export function toListItem(row: PortalRegistrationRow): PortalRegistrationListItem {
  const data = asData(row);
  const match = asMatch(row);
  const plan = asPlan(row);
  const matched = match?.customerId ? match.candidates.find((c) => c.customer.id === match.customerId) : null;
  return {
    id: row.id,
    status: row.status as PortalRegistrationStatus,
    receivedAt: row.receivedAt.toISOString(),
    subject: row.subject,
    fromEmail: row.fromEmail,
    forwardedBy: row.forwardedBy,
    company: data?.company ?? null,
    customerNumber: data?.customerNumber ?? null,
    contactName: [data?.contact.firstName, data?.contact.lastName].filter(Boolean).join(" ") || null,
    contactEmail: data?.contact.email ?? null,
    expertMode: data?.expertMode ?? null,
    matchStatus: match?.status ?? null,
    matchedCustomerNumber: plan?.customerNumber ?? matched?.customer.customerNumber ?? null,
    confidence: match?.confidence ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDetail(row: PortalRegistrationRow) {
  const { rawEmlBase64, ...rest } = row;
  return {
    ...rest,
    hasOriginal: Boolean(rawEmlBase64),
    extraction: asExtraction(row),
    data: asData(row),
    match: asMatch(row),
    plan: asPlan(row),
    events: (row.events ?? []) as PortalRegistrationEvent[],
  };
}

// ---------- Eingang ----------

export async function ingestRegistrationMail(
  ctx: ServiceContext,
  input: { buffer: Buffer; graphMessageId?: string | null; mailbox?: string | null; subjectHint?: string | null },
): Promise<PortalRegistrationIntakeResponse> {
  const messageId = deriveUploadMessageId(input.buffer);
  const existing = await repo.findByMessageId(ctx.tenantId, messageId);
  if (existing) {
    return {
      outcome: "duplicate",
      registrationId: existing.id,
      categories: categoriesForStatus(existing.status as PortalRegistrationStatus),
      move: true,
    };
  }
  const lockKey = `portal-registration:${ctx.tenantId}:${messageId}`;
  if (!acquireIntakeLock(lockKey)) {
    throw new PortalRegistrationError("Diese Mail wird gerade schon verarbeitet", "portal_registration_in_progress", 409);
  }
  try {
    const parsed = await parseEmailBufferAutodetect(input.buffer);
    const subject = (parsed.subject || input.subjectHint || "").trim();
    const body = (parsed.body || "").trim();
    const headerFrom = (parsed.from || "").trim();
    const headerEmail = headerFrom.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]?.toLowerCase() ?? null;
    const unwrapped = unwrapInternalForward({ from: headerFrom, subject, body });
    const forwardedBy = headerEmail && isOwnOperatorEmail(headerEmail) ? headerEmail : null;

    const row = await repo.insert({
      tenantId: ctx.tenantId,
      messageId,
      graphMessageId: input.graphMessageId ?? null,
      mailbox: input.mailbox ?? null,
      subject: subject.slice(0, 500),
      fromEmail: unwrapped.fromEmail ?? headerEmail,
      fromName: unwrapped.from.slice(0, 300) || null,
      forwardedBy,
      bodyText: body.slice(0, 100_000),
      rawEmlBase64: input.buffer.length <= MAX_ATTACHED_EML_BYTES ? input.buffer.toString("base64") : null,
      status: "processing",
      events: [event("received", `Mail „${subject.slice(0, 120)}“ eingegangen${forwardedBy ? ` (weitergeleitet von ${forwardedBy})` : ""}`)],
    });
    if (!row) {
      const again = await repo.findByMessageId(ctx.tenantId, messageId);
      return { outcome: "duplicate", registrationId: again?.id ?? null, categories: categoriesForStatus((again?.status ?? "review") as PortalRegistrationStatus), move: true };
    }

    try {
      const evaluated = await evaluateRegistration(ctx, row, { extract: true });
      const status = evaluated.status as PortalRegistrationStatus;
      const notRegistration = status === "discarded";
      log.info(
        { event: "portal_registration.received", registrationId: row.id, status, tenantId: ctx.tenantId },
        `[PortalRegistration] ${status}: ${subject}`,
      );
      return {
        outcome: notRegistration ? "not_registration" : (status as PortalRegistrationIntakeResponse["outcome"]),
        registrationId: row.id,
        categories: categoriesForStatus(status, notRegistration),
        move: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repo.update(ctx.tenantId, row.id, { status: "failed", lastError: message.slice(0, 2000) }, [
        event("failed", `Verarbeitung gescheitert: ${message.slice(0, 300)}`),
      ]);
      log.error({ err, event: "portal_registration.failed", registrationId: row.id }, "[PortalRegistration] Verarbeitung gescheitert");
      return { outcome: "failed", registrationId: row.id, categories: [PORTAL_REGISTRATION_CATEGORIES.failed], move: true };
    }
  } finally {
    releaseIntakeLock(lockKey);
  }
}

// ---------- Auswerten ----------

async function shopFor(ctx: ServiceContext): Promise<PortalRegistrationShopApi> {
  return (ctx.shopApi ?? defaultShopApiFactory)(ctx.tenantId);
}

/**
 * Anmeldung (neu) bewerten: optional auslesen, Kunden suchen, Plan bauen und je nach Ergebnis
 * ausführen, an den Kundenstamm geben oder zur Prüfung stellen.
 */
export async function evaluateRegistration(
  ctx: ServiceContext,
  row: PortalRegistrationRow,
  options: { extract?: boolean; recheck?: boolean } = {},
): Promise<PortalRegistrationRow> {
  const events: PortalRegistrationEvent[] = [];
  let extraction = asExtraction(row);
  let data = asData(row);
  if (options.extract || !extraction || !data) {
    extraction = await extractPortalRegistration(ctx.storage ?? defaultStorage, { from: row.fromName ?? row.fromEmail ?? "", subject: row.subject, body: row.bodyText }, ctx.llm);
    data = extraction.data;
    const who = [data.company, [data.contact.firstName, data.contact.lastName].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    events.push(
      event(
        "extracted",
        `Ausgelesen (${extraction.source === "ai" ? "KI" : "Regeln"}, ${Math.round(extraction.confidence * 100)} %): ${who || "keine Firma erkannt"}` +
          (data.expertMode ? " – Expertenmodus gewünscht" : ""),
      ),
    );
    if (!extraction.isRegistration && extraction.confidence >= SURE_REGISTRATION_CONFIDENCE) {
      events.push(event("discarded", `Keine Portal-Anmeldung: ${extraction.reason ?? "laut KI"}`));
      return (await repo.update(ctx.tenantId, row.id, { status: "discarded", extraction, data, lastCheckedAt: new Date() }, events)) ?? row;
    }
  }

  const api = await shopFor(ctx);
  const hits = await api.findCandidates({
    customerNumber: data.customerNumber,
    email: data.contact.email,
    vatId: data.vatId,
    company: data.company,
    zipCode: data.zipCode,
  });
  const match = decidePortalMatch(data, hits);
  const wasWaiting = row.status === "waiting_master_data";

  if (match.status === "matched" && match.customerId) {
    const customer = match.candidates.find((c) => c.customer.id === match.customerId)!.customer;
    events.push(event("matched", `Portal-Kunde ${customer.customerNumber ?? ""} ${customer.company ?? ""} gefunden (${match.confidence} %)`.replace(/\s+/g, " ")));
    return planAndMaybeExecute(ctx, row, { extraction, data, match, customer: customer.id }, events, { allowAuto: (extraction?.confidence ?? 0) >= SURE_REGISTRATION_CONFIDENCE });
  }

  if (match.status === "ambiguous" || (extraction && extraction.confidence < SURE_REGISTRATION_CONFIDENCE)) {
    events.push(
      event(
        "review_needed",
        match.status === "ambiguous"
          ? `Kein eindeutiger Portal-Kunde (${match.candidates.length} Kandidaten) – bitte prüfen`
          : "Unsicher, ob das eine Portal-Anmeldung ist – bitte prüfen",
      ),
    );
    return (
      (await repo.update(
        ctx.tenantId,
        row.id,
        { status: wasWaiting && match.status === "not_found" ? "waiting_master_data" : "review", extraction, data, match, plan: null, lastCheckedAt: new Date() },
        events,
      )) ?? row
    );
  }

  // Nicht im Portal
  if (wasWaiting) {
    if (options.recheck) events.push(event("rechecked", "Neu geprüft: Kunde noch nicht im Portal"));
    return (await repo.update(ctx.tenantId, row.id, { extraction, data, match, lastCheckedAt: new Date() }, events)) ?? row;
  }
  const updated = (await repo.update(ctx.tenantId, row.id, { extraction, data, match, plan: null, lastCheckedAt: new Date() }, events)) ?? row;
  if (ctx.settings.masterDataEmail.trim()) {
    return requestMasterData(ctx, updated);
  }
  return (
    (await repo.update(ctx.tenantId, row.id, { status: "review" }, [
      event("review_needed", "Kunde nicht im Portal – keine Kundenstamm-Adresse eingestellt, bitte von Hand weitergeben"),
    ])) ?? updated
  );
}

async function planAndMaybeExecute(
  ctx: ServiceContext,
  row: PortalRegistrationRow,
  input: { extraction: PortalRegistrationExtraction | null; data: PortalRegistrationData; match: PortalRegistrationMatch; customer: string },
  events: PortalRegistrationEvent[],
  options: { allowAuto: boolean },
): Promise<PortalRegistrationRow> {
  const api = await shopFor(ctx);
  const customer = input.match.candidates.find((c) => c.customer.id === input.customer)?.customer ?? (await api.getCustomer(input.customer));
  if (!customer) throw new PortalRegistrationError("Kunde nicht im Shop gefunden", "portal_registration_customer_missing", 404);
  const employee = input.data.contact.email ? await api.findEmployee(input.data.contact.email) : null;
  const plan = buildRegistrationPlan(input.data, customer, employee, ctx.settings, asPlan(row));
  const status: PortalRegistrationStatus = plan.blockers.length ? "review" : "ready";
  if (plan.blockers.length) events.push(event("review_needed", `Bitte prüfen: ${plan.blockers.map(blockerText).join("; ")}`));
  const updated =
    (await repo.update(
      ctx.tenantId,
      row.id,
      { status, extraction: input.extraction, data: input.data, match: input.match, plan, customerId: customer.id, lastCheckedAt: new Date(), lastError: null },
      events,
    )) ?? row;
  if (status === "ready" && options.allowAuto && ctx.settings.autoExecute) {
    return executeRegistration({ ...ctx, userName: ctx.userName ?? "Automatik" }, updated.id);
  }
  return updated;
}

export function blockerText(blocker: PortalRegistrationPlan["blockers"][number]): string {
  switch (blocker) {
    case "missing_email":
      return "E-Mail des Ansprechpartners fehlt";
    case "missing_name":
      return "Vor- oder Nachname fehlt";
    case "internal_email":
      return "E-Mail ist eine META-Adresse";
    case "employee_other_customer":
      return "E-Mail gehört schon einem Mitarbeiter eines anderen Kunden";
    case "no_customer":
      return "kein Kunde gewählt";
    case "no_sales_channel":
      return "Kunde hat keinen Verkaufskanal";
  }
}

// ---------- Aktionen ----------

async function loadRow(ctx: ServiceContext, id: string): Promise<PortalRegistrationRow> {
  const row = await repo.get(ctx.tenantId, id);
  if (!row) throw new PortalRegistrationError("Registrierung nicht gefunden", "portal_registration_not_found", 404);
  return row;
}

export async function executeRegistration(ctx: ServiceContext, id: string): Promise<PortalRegistrationRow> {
  const lockKey = `portal-registration:execute:${id}`;
  if (!acquireIntakeLock(lockKey)) {
    throw new PortalRegistrationError("Diese Registrierung wird gerade schon ausgeführt", "portal_registration_in_progress", 409);
  }
  try {
    const row = await loadRow(ctx, id);
    const plan = asPlan(row);
    if (!plan) throw new PortalRegistrationError("Noch kein Kunde zugeordnet", "portal_registration_no_plan", 409);
    if (row.status === "completed") throw new PortalRegistrationError("Registrierung ist schon erledigt", "portal_registration_done", 409);
    const api = await shopFor(ctx);
    const result = await executeRegistrationPlan(api, plan, { storefrontUrl: storefrontUrlFor(ctx.settings), userName: ctx.userName });
    const base = { employeeId: result.employeeId ?? row.employeeId, handledByUserId: ctx.userId ?? row.handledByUserId };
    if (result.needsReview) {
      log.warn({ event: "portal_registration.review", registrationId: id, error: result.error }, "[PortalRegistration] Plan passt nicht mehr");
      return (
        (await repo.update(ctx.tenantId, id, { ...base, status: "review", lastError: result.error }, [
          ...result.events,
          event("review_needed", result.error ?? "Bitte prüfen", ctx.userName),
        ])) ?? row
      );
    }
    if (!result.ok) {
      log.error({ event: "portal_registration.execute_failed", registrationId: id, error: result.error }, "[PortalRegistration] Ausführung gescheitert");
      return (
        (await repo.update(ctx.tenantId, id, { ...base, status: "failed", lastError: result.error }, [...result.events, event("failed", result.error ?? "Fehler", ctx.userName)])) ??
        row
      );
    }
    log.info(
      { event: "portal_registration.completed", registrationId: id, customerNumber: plan.customerNumber, employeeAction: plan.employee.action, userId: ctx.userId },
      `[PortalRegistration] erledigt: ${plan.company ?? ""} ${plan.employee.email}`,
    );
    const events = [...result.events, event("executed", "Registrierung erledigt", ctx.userName)];
    const done =
      (await repo.update(
        ctx.tenantId,
        id,
        { ...base, status: "completed", lastError: null, passwordResetAt: result.passwordResetSent ? new Date() : row.passwordResetAt },
        events,
      )) ?? row;
    return notifySalesRep(ctx, done, plan, result.passwordResetSent);
  } catch (err) {
    if (err instanceof PortalRegistrationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, event: "portal_registration.execute_failed", registrationId: id }, "[PortalRegistration] Ausführung gescheitert");
    return (
      (await repo.update(ctx.tenantId, id, { status: "failed", lastError: message.slice(0, 2000) }, [event("failed", `Shop-Fehler: ${message.slice(0, 300)}`, ctx.userName)])) ??
      (await loadRow(ctx, id))
    );
  } finally {
    releaseIntakeLock(lockKey);
  }
}

async function notifySalesRep(
  ctx: ServiceContext,
  row: PortalRegistrationRow,
  plan: PortalRegistrationPlan,
  passwordResetSent: boolean,
): Promise<PortalRegistrationRow> {
  if (!ctx.settings.notifySalesRep || row.salesRepNotifiedAt) return row;
  const rep = plan.customerNumber ? await repo.findSalesRep(ctx.tenantId, plan.customerNumber) : null;
  if (!rep) {
    return (
      (await repo.update(ctx.tenantId, row.id, {}, [
        event("sales_rep_missing", `Kein Außendienst zu Kd. ${plan.customerNumber ?? "–"} in der Zuordnungsliste – keine Info verschickt`),
      ])) ?? row
    );
  }
  const data = asData(row)!;
  const mail = buildSalesRepInfoMail({ repName: rep.repName, plan, data, passwordResetSent, portalUrl: storefrontUrlFor(ctx.settings) });
  const cc = ctx.settings.ccForwarder && row.forwardedBy && row.forwardedBy !== rep.repEmail ? [row.forwardedBy] : [];
  await repo.enqueueMail({ tenantId: ctx.tenantId, registrationId: row.id, kind: "sales_rep_info", to: [rep.repEmail], cc, subject: mail.subject, html: mail.html, attachOriginal: false });
  return (
    (await repo.update(ctx.tenantId, row.id, { salesRepNotifiedAt: new Date() }, [
      event("sales_rep_notified", `Info an Außendienst ${rep.repName || rep.repEmail} <${rep.repEmail}> im Postausgang`),
    ])) ?? row
  );
}

function registrationUrl(ctx: ServiceContext, id: string): string | null {
  return ctx.appBaseUrl ? `${ctx.appBaseUrl.replace(/\/$/, "")}/b2b/registrations?id=${encodeURIComponent(id)}` : null;
}

export async function requestMasterData(ctx: ServiceContext, rowOrId: PortalRegistrationRow | string): Promise<PortalRegistrationRow> {
  const row = typeof rowOrId === "string" ? await loadRow(ctx, rowOrId) : rowOrId;
  const to = ctx.settings.masterDataEmail.trim();
  if (!to) throw new PortalRegistrationError("Keine Kundenstamm-Adresse eingestellt", "portal_registration_no_master_data_email", 409);
  const data = asData(row);
  if (!data) throw new PortalRegistrationError("Anmeldung noch nicht ausgelesen", "portal_registration_no_data", 409);
  const mail = buildMasterDataRequestMail({
    data,
    match: asMatch(row),
    forwardedBy: row.forwardedBy,
    registrationUrl: registrationUrl(ctx, row.id),
    autoExecute: ctx.settings.autoExecute,
  });
  const cc = ctx.settings.ccForwarder && row.forwardedBy ? [row.forwardedBy] : [];
  await repo.enqueueMail({
    tenantId: ctx.tenantId,
    registrationId: row.id,
    kind: "master_data_request",
    to: [to],
    cc,
    subject: mail.subject,
    html: mail.html,
    attachOriginal: Boolean(row.rawEmlBase64),
  });
  log.info({ event: "portal_registration.master_data_requested", registrationId: row.id }, "[PortalRegistration] an Kundenstamm");
  return (
    (await repo.update(ctx.tenantId, row.id, { status: "waiting_master_data", masterDataRequestedAt: new Date(), plan: null }, [
      event("master_data_requested", `Kunde nicht im Portal – Bitte um Prüfung an ${to} im Postausgang`, ctx.userName),
    ])) ?? row
  );
}

export async function recheckRegistration(ctx: ServiceContext, id: string, options: { reextract?: boolean } = {}): Promise<PortalRegistrationRow> {
  const row = await loadRow(ctx, id);
  if (row.status === "completed") throw new PortalRegistrationError("Registrierung ist schon erledigt", "portal_registration_done", 409);
  if (row.status === "discarded" && !options.reextract) {
    // Verworfene Anmeldung wieder aufnehmen: von vorn bewerten
    return evaluateRegistration(ctx, { ...row, status: "review" }, { extract: false, recheck: true });
  }
  return evaluateRegistration(ctx, row, { extract: options.reextract, recheck: true });
}

/** Bearbeiter korrigiert die ausgelesenen Daten → neu abgleichen */
export async function updateRegistrationData(ctx: ServiceContext, id: string, data: PortalRegistrationData): Promise<PortalRegistrationRow> {
  const row = await loadRow(ctx, id);
  if (row.status === "completed") throw new PortalRegistrationError("Registrierung ist schon erledigt", "portal_registration_done", 409);
  const saved = (await repo.update(ctx.tenantId, id, { data }, [event("edited", "Anmeldedaten geändert", ctx.userName)])) ?? row;
  return evaluateRegistration(ctx, { ...saved, status: saved.status === "discarded" ? "review" : saved.status }, { recheck: true });
}

/** Bearbeiter wählt den Kunden (Kandidat oder Kundennummer) */
export async function selectRegistrationCustomer(
  ctx: ServiceContext,
  id: string,
  pick: { customerId?: string | null; customerNumber?: string | null },
): Promise<PortalRegistrationRow> {
  const row = await loadRow(ctx, id);
  if (row.status === "completed") throw new PortalRegistrationError("Registrierung ist schon erledigt", "portal_registration_done", 409);
  const data = asData(row);
  if (!data) throw new PortalRegistrationError("Anmeldung noch nicht ausgelesen", "portal_registration_no_data", 409);
  const api = await shopFor(ctx);
  let customer = pick.customerId ? await api.getCustomer(pick.customerId) : null;
  if (!customer && pick.customerNumber) {
    const found = await api.findCustomersByNumber(pick.customerNumber);
    const portal = found.filter((c) => c.isPortal);
    if (portal.length > 1) throw new PortalRegistrationError("Mehrere Portal-Kunden mit dieser Nummer", "portal_registration_customer_ambiguous", 409);
    customer = portal[0] ?? null;
    if (!customer && found.length) throw new PortalRegistrationError("Kunde ist nicht im Händlerportal", "portal_registration_not_portal", 409);
  }
  if (!customer) throw new PortalRegistrationError("Kunde nicht im Shop gefunden", "portal_registration_customer_missing", 404);
  if (!customer.isPortal) throw new PortalRegistrationError("Kunde ist nicht im Händlerportal", "portal_registration_not_portal", 409);
  const previous = asMatch(row);
  const match: PortalRegistrationMatch = {
    status: "matched",
    customerId: customer.id,
    method: "manual",
    confidence: 100,
    candidates: [
      { customer, score: 100, methods: ["manual"], reasons: [`von ${ctx.userName ?? "Bearbeiter"} gewählt`] },
      ...(previous?.candidates ?? []).filter((c) => c.customer.id !== customer!.id),
    ],
    shopAccounts: previous?.shopAccounts ?? [],
    notes: [],
    checkedAt: new Date().toISOString(),
  };
  const events = [event("matched", `Kunde ${customer.customerNumber ?? ""} ${customer.company ?? ""} von Hand gewählt`.replace(/\s+/g, " "), ctx.userName)];
  // Von Hand gewählt: nicht automatisch ausführen, der Bearbeiter klickt selbst
  return planAndMaybeExecute(ctx, row, { extraction: asExtraction(row), data, match, customer: customer.id }, events, { allowAuto: false });
}

/** Einzelne geplante Kundenänderungen an-/abwählen */
export async function setPlanChanges(
  ctx: ServiceContext,
  id: string,
  apply: Partial<Record<PortalCustomerChange["field"], boolean>>,
  sendPasswordReset?: boolean,
): Promise<PortalRegistrationRow> {
  const row = await loadRow(ctx, id);
  const plan = asPlan(row);
  if (!plan) throw new PortalRegistrationError("Noch kein Kunde zugeordnet", "portal_registration_no_plan", 409);
  const next: PortalRegistrationPlan = {
    ...plan,
    customerChanges: plan.customerChanges.map((c) => (apply[c.field] === undefined ? c : { ...c, apply: Boolean(apply[c.field]) })),
    sendPasswordReset: sendPasswordReset ?? plan.sendPasswordReset,
  };
  return (await repo.update(ctx.tenantId, id, { plan: next })) ?? row;
}

export async function discardRegistration(ctx: ServiceContext, id: string, reason: string | null): Promise<PortalRegistrationRow> {
  const row = await loadRow(ctx, id);
  if (row.status === "completed") throw new PortalRegistrationError("Registrierung ist schon erledigt", "portal_registration_done", 409);
  return (
    (await repo.update(ctx.tenantId, id, { status: "discarded", handledByUserId: ctx.userId ?? null }, [
      event("discarded", `Verworfen${reason?.trim() ? `: ${reason.trim().slice(0, 300)}` : ""}`, ctx.userName),
    ])) ?? row
  );
}

/** Passwort-Mail erneut auslösen (Link abgelaufen oder erster Versuch gescheitert) */
export async function resendPasswordReset(ctx: ServiceContext, id: string): Promise<PortalRegistrationRow> {
  const row = await loadRow(ctx, id);
  const plan = asPlan(row);
  if (!plan || !row.employeeId) throw new PortalRegistrationError("Noch kein Mitarbeiter angelegt", "portal_registration_no_employee", 409);
  if (!plan.salesChannelId) throw new PortalRegistrationError("Kunde hat keinen Verkaufskanal", "portal_registration_no_channel", 409);
  const api = await shopFor(ctx);
  try {
    await api.requestPasswordReset({ salesChannelId: plan.salesChannelId, email: plan.employee.email, storefrontUrl: storefrontUrlFor(ctx.settings) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repo.update(ctx.tenantId, id, { lastError: message.slice(0, 2000) }, [event("password_reset_failed", `Passwort-Mail nicht ausgelöst: ${message.slice(0, 300)}`, ctx.userName)]);
    throw new PortalRegistrationError("Passwort-Mail konnte nicht ausgelöst werden", "portal_registration_reset_failed", 502);
  }
  const wasFailed = row.status === "failed";
  const updated =
    (await repo.update(
      ctx.tenantId,
      id,
      { passwordResetAt: new Date(), lastError: null, ...(wasFailed ? { status: "completed" } : {}) },
      [event("password_reset_sent", `Passwort-Mail an ${plan.employee.email} erneut ausgelöst`, ctx.userName)],
    )) ?? row;
  return wasFailed ? notifySalesRep(ctx, updated, plan, true) : updated;
}

/** Wartende Anmeldungen regelmäßig neu prüfen (aufgerufen beim Konfigurationsabruf durch n8n) */
export async function recheckDueRegistrations(ctx: ServiceContext, now = new Date(), limit = 5): Promise<number> {
  if (!ctx.settings.recheckHours) return 0;
  const due = await repo.dueForRecheck(ctx.tenantId, new Date(now.getTime() - ctx.settings.recheckHours * 3600_000), limit);
  let changed = 0;
  for (const row of due) {
    try {
      const after = await evaluateRegistration(ctx, row, { recheck: true });
      if (after.status !== "waiting_master_data") changed++;
    } catch (err) {
      log.warn({ err, registrationId: row.id }, "[PortalRegistration] Neuprüfung gescheitert");
      await repo.update(ctx.tenantId, row.id, { lastCheckedAt: now });
    }
  }
  return changed;
}

// ---------- Postausgang ----------

export async function claimOutboxMails(ctx: ServiceContext, limit = 10): Promise<PortalRegistrationOutboxMail[]> {
  const rows = await repo.claimPendingMails(ctx.tenantId, limit);
  const graphBase = graphBaseForMailbox(ctx.settings.mailbox);
  const out: PortalRegistrationOutboxMail[] = [];
  for (const mail of rows) {
    let attachment: { name: string; base64: string } | null = null;
    if (mail.attachOriginal) {
      const reg = await repo.get(ctx.tenantId, mail.registrationId);
      if (reg?.rawEmlBase64) attachment = { name: "Registrierung.eml", base64: reg.rawEmlBase64 };
    }
    out.push({
      id: mail.id,
      kind: mail.kind as PortalRegistrationOutboxMail["kind"],
      graphBase,
      message: buildGraphMessage({ subject: mail.subject, html: mail.html, to: mail.toAddresses, cc: mail.ccAddresses, attachment }),
    });
  }
  return out;
}

const MAX_SEND_ATTEMPTS = 3;

export async function ackOutboxMail(ctx: ServiceContext, id: string, result: { ok: boolean; error?: string | null }): Promise<void> {
  const mail = await repo.getMail(ctx.tenantId, id);
  if (!mail) throw new PortalRegistrationError("Mail nicht gefunden", "portal_registration_mail_not_found", 404);
  if (mail.status === "sent") return;
  const label = mail.kind === "master_data_request" ? "Kundenstamm" : "Außendienst";
  if (result.ok) {
    await repo.markMail(ctx.tenantId, id, { status: "sent", sentAt: new Date(), lastError: null });
    await repo.update(ctx.tenantId, mail.registrationId, {}, [event("mail_sent", `Mail an ${label} (${mail.toAddresses.join(", ")}) verschickt`)]);
    return;
  }
  const error = (result.error ?? "unbekannter Fehler").slice(0, 1000);
  const giveUp = mail.attempts >= MAX_SEND_ATTEMPTS;
  await repo.markMail(ctx.tenantId, id, { status: giveUp ? "failed" : "pending", lastError: error, claimedAt: null });
  if (giveUp) {
    log.error({ event: "portal_registration.mail_failed", mailId: id, registrationId: mail.registrationId, error }, "[PortalRegistration] Mail nicht verschickt");
    await repo.update(ctx.tenantId, mail.registrationId, { lastError: `Mail an ${label}: ${error}` }, [
      event("mail_failed", `Mail an ${label} nach ${mail.attempts} Versuchen nicht verschickt: ${error.slice(0, 200)}`),
    ]);
  }
}

/** Gescheiterte Mail erneut in den Postausgang legen */
export async function retryOutboxMail(ctx: ServiceContext, mailId: string): Promise<void> {
  const mail = await repo.getMail(ctx.tenantId, mailId);
  if (!mail) throw new PortalRegistrationError("Mail nicht gefunden", "portal_registration_mail_not_found", 404);
  if (mail.status !== "failed") return;
  await repo.markMail(ctx.tenantId, mailId, { status: "pending", claimedAt: null, attempts: 0 });
}
