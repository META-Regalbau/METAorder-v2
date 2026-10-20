// Kundenmails über Brevo, Baustein B1 (Konzept 19./20.10.2026):
// - Übersicht, Einstellungen (Brevo-Schlüssel verschlüsselt), Brevo-Konto/Absender/Vorlagen, Abgleich per Knopf,
//   Webhook einrichten, Kontakte mit Rechtsgrundlage, Einwilligung/Widerspruch erfassen, Testaussendung: nur
//   Administratoren.
// - Status je E-Mail-Adresse für das CRM-Kundendetail: alle mit CRM-Recht.
// - POST /api/public/customer-mails/brevo: Marketing-Webhook von Brevo. Ohne Anmeldung, aber nur mit den
//   Kopfzeilen X-Meta-Tenant und X-Meta-Token, die METAorder beim Einrichten in Brevo hinterlegt.
import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth, requireCsrf, requireViewCrm } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { cartSignalRateOk } from "../shopPulse/cartAlarm";
import { brevoErrorText } from "../customerMails/brevoClient";
import {
  cancelRun,
  contactStatus,
  countContacts,
  createTestRun,
  customerMailDeps,
  CustomerMailError,
  getBrevoApiKey,
  getCustomerMailSettings,
  getCustomerMailState,
  getRun,
  getWebhookToken,
  handleBrevoWebhook,
  knownChannels,
  listRuns,
  loadContactRows,
  recordConsent,
  recordObjection,
  saveCustomerMailSettings,
  sendRun,
  setupBrevoWebhook,
  toContact,
  webhookTokenOk,
} from "../customerMails/customerMailsRun";
import { runCustomerMailSync } from "../customerMails/customerMailsScheduler";
import { createRegularLetterRun, createRegularLetterTemplate } from "../customerMails/regularLetterRun";
import {
  customerMailConsentSchema,
  customerMailObjectionSchema,
  customerMailRegularLetterRunSchema,
  customerMailSettingsSchema,
  customerMailTemplateSchema,
  customerMailTestRunSchema,
  CUSTOMER_MAIL_BASES,
  type CustomerMailBasis,
  type CustomerMailBrevoInfo,
  type CustomerMailOverview,
} from "@shared/customerMails";

const moduleLog = logger.child({ component: "routes/customerMailRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userName = (req: Request) => String((req as any).user?.username ?? "admin").slice(0, 120);
const MAX_WEBHOOK_BODY = 512 * 1024;

const baseUrlOf = (req: Request) => publicAppBaseUrl(process.env.APP_URL?.trim() || `${req.protocol}://${req.get("host") || ""}`);

async function overview(req: Request): Promise<CustomerMailOverview> {
  const tenantId = tenantOf(req);
  const { settings, hasKey, hasWebhookToken } = await getCustomerMailSettings(storage, tenantId);
  const state = await getCustomerMailState(storage, tenantId);
  const rows = await loadContactRows(tenantId);
  const base = baseUrlOf(req);
  return {
    settings,
    hasKey,
    hasWebhook: hasWebhookToken && !!state.webhookId,
    webhookUrl: base ? `${base}/api/public/customer-mails/brevo` : null,
    state,
    counts: countContacts(rows, settings.existingCustomerSince),
    knownChannels: await knownChannels(tenantId),
    runs: await listRuns(tenantId),
  };
}

/** Fachlichen Fehler mit festem Text beantworten; false = kein fachlicher Fehler (Aufrufer antwortet mit 500) */
function sendMailError(res: Response, error: unknown): boolean {
  if (!(error instanceof CustomerMailError)) return false;
  switch (error.reason) {
    case "keyMissing":
      res.status(400).json({ error: "Brevo API key missing" });
      return true;
    case "disabled":
      res.status(409).json({ error: "Customer mails are switched off" });
      return true;
    case "runNotFound":
      res.status(404).json({ error: "Customer mail run not found" });
      return true;
    case "notDraft":
      res.status(409).json({ error: "Customer mail run is not a draft" });
      return true;
    case "noRecipients":
      res.status(400).json({ error: "No recipients with a legal basis" });
      return true;
    case "noTestRecipients":
      res.status(400).json({ error: "No test recipients configured" });
      return true;
    case "invalidEmail":
      res.status(400).json({ error: "Invalid email address" });
      return true;
    case "customerSendingOff":
      res.status(409).json({ error: "Customer sending is switched off for this mail type" });
      return true;
  }
  return false;
}

export function registerCustomerMailRoutes(app: Express): void {
  /** Marketing-Webhook von Brevo (öffentlich, mit Token) */
  app.post("/api/public/customer-mails/brevo", async (req: Request, res: Response) => {
    const tenantHeader = req.get("x-meta-tenant")?.trim() ?? "";
    const raw = req.rawBody instanceof Buffer ? req.rawBody : null;
    if (!tenantHeader || !raw || raw.length > MAX_WEBHOOK_BODY) return res.status(400).json({ error: "Invalid Brevo event" });
    if (!cartSignalRateOk(`customer-mails:${tenantHeader}`)) return res.status(429).json({ error: "Too many Brevo events" });
    try {
      const tenant = await storage.getTenant(tenantHeader).catch(() => undefined);
      const token = tenant ? await getWebhookToken(storage, tenant.id) : null;
      if (!tenant || !webhookTokenOk(token, req.get("x-meta-token"))) {
        moduleLog.warn({ tenant: tenantHeader.slice(0, 40), ip: req.ip }, "Kundenmails: Brevo-Ereignis abgelehnt");
        return res.status(401).json({ error: "Invalid Brevo event token" });
      }
      const result = await handleBrevoWebhook(tenant.id, req.body, new Date());
      res.status(200).json(result);
    } catch (error) {
      moduleLog.error({ err: error }, "Kundenmails: Brevo-Ereignis speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to store Brevo event" });
    }
  });

  app.get("/api/customer-mails", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(req));
    } catch (error) {
      moduleLog.error({ err: error }, "Kundenmails: Übersicht laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load customer mails" });
    }
  });

  app.put("/api/customer-mails/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = customerMailSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid customer mail settings" });
    const tenantId = tenantOf(req);
    try {
      await saveCustomerMailSettings(storage, tenantId, parsed.data);
      const { apiKey, ...rest } = parsed.data;
      moduleLog.info(
        { tenantId, by: userName(req), fields: Object.keys(rest), key: apiKey === undefined ? "unchanged" : apiKey ? "set" : "removed" },
        "Kundenmails: Einstellungen gespeichert",
      );
      res.json(await overview(req));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save customer mail settings" });
    }
  });

  /** Brevo-Konto, Absender und Vorlagen (Verbindungstest) */
  app.get("/api/customer-mails/brevo", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    const empty: CustomerMailBrevoInfo = { account: null, senders: [], templates: [], error: null };
    try {
      const key = await getBrevoApiKey(storage, tenantId);
      if (!key) return res.json(empty);
      const brevo = customerMailDeps(storage).brevo(key);
      try {
        const [account, senders, templates] = await Promise.all([brevo.account(), brevo.senders(), brevo.templates()]);
        res.json({ account, senders, templates, error: null } satisfies CustomerMailBrevoInfo);
      } catch (err) {
        res.json({ ...empty, error: brevoErrorText(err) });
      }
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Brevo-Daten laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load Brevo account" });
    }
  });

  app.post("/api/customer-mails/sync", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      if (!(await getBrevoApiKey(storage, tenantId))) return res.status(400).json({ error: "Brevo API key missing" });
      const state = await runCustomerMailSync(customerMailDeps(storage), tenantId);
      if (!state) return res.status(409).json({ error: "Customer mail sync already running" });
      res.json(await overview(req));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Abgleich per Knopf fehlgeschlagen");
      res.status(502).json({ error: "Customer mail sync failed" });
    }
  });

  app.post("/api/customer-mails/webhook", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    const base = baseUrlOf(req);
    if (!tenantId || !base) return res.status(400).json({ error: "Brevo webhook needs a tenant and public URL" });
    try {
      await setupBrevoWebhook(customerMailDeps(storage), tenantId, base);
      moduleLog.info({ tenantId, by: userName(req) }, "Kundenmails: Brevo-Webhook eingerichtet");
      res.json(await overview(req));
    } catch (error) {
      if (sendMailError(res, error)) return;
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Brevo-Webhook einrichten fehlgeschlagen");
      res.status(502).json({ error: "Failed to set up Brevo webhook" });
    }
  });

  app.get("/api/customer-mails/contacts", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    const q = String(req.query.q ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 100);
    const basis = String(req.query.basis ?? "");
    try {
      const { settings } = await getCustomerMailSettings(storage, tenantId);
      const contacts = (await loadContactRows(tenantId))
        .map((r) => toContact(r, settings))
        .filter((c) => !CUSTOMER_MAIL_BASES.includes(basis as CustomerMailBasis) || c.basis === basis)
        .filter((c) => !q || c.email.includes(q) || (c.company ?? "").toLowerCase().includes(q) || (c.customerNumber ?? "").toLowerCase().includes(q))
        .sort((a, b) => (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? "") || a.email.localeCompare(b.email));
      res.json({ total: contacts.length, contacts: contacts.slice(0, 200) });
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Kontakte laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load customer mail contacts" });
    }
  });

  app.post("/api/customer-mails/contacts/consent", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = customerMailConsentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid consent" });
    const tenantId = tenantOf(req);
    try {
      const row = await recordConsent(tenantId, parsed.data, userName(req), new Date());
      const { settings } = await getCustomerMailSettings(storage, tenantId);
      moduleLog.info({ tenantId, by: userName(req), source: parsed.data.source }, "Kundenmails: Einwilligung erfasst");
      res.json(toContact(row, settings));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Einwilligung erfassen fehlgeschlagen");
      if (!sendMailError(res, error)) res.status(500).json({ error: "Failed to record consent" });
    }
  });

  app.post("/api/customer-mails/contacts/objection", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = customerMailObjectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid objection" });
    const tenantId = tenantOf(req);
    try {
      const key = await getBrevoApiKey(storage, tenantId);
      const row = await recordObjection(
        tenantId,
        { email: parsed.data.email, source: "manual", note: parsed.data.note ? `${parsed.data.note} (${userName(req)})` : userName(req) },
        new Date(),
        key ? customerMailDeps(storage).brevo(key) : null,
      );
      if (!row) return res.status(400).json({ error: "Invalid objection" });
      const { settings } = await getCustomerMailSettings(storage, tenantId);
      moduleLog.info({ tenantId, by: userName(req) }, "Kundenmails: Widerspruch erfasst");
      res.json(toContact(row, settings));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Widerspruch erfassen fehlgeschlagen");
      res.status(500).json({ error: "Failed to record objection" });
    }
  });

  /** Werbe-Status einer Adresse für das CRM-Kundendetail */
  app.get("/api/customer-mails/contact-status", requireAuth, requireViewCrm, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      const { settings } = await getCustomerMailSettings(storage, tenantId);
      const status = await contactStatus(tenantId, String(req.query.email ?? ""), settings);
      if (!status) return res.status(400).json({ error: "Invalid email address" });
      res.json(status);
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Status laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load customer mail status" });
    }
  });

  app.post("/api/customer-mails/runs/test", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = customerMailTestRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid test mail" });
    const tenantId = tenantOf(req);
    try {
      res.json(await createTestRun(customerMailDeps(storage), tenantId, parsed.data, userName(req)));
    } catch (error) {
      if (!(error instanceof CustomerMailError)) moduleLog.error({ err: error, tenantId }, "Kundenmails: Testaussendung anlegen fehlgeschlagen");
      if (!sendMailError(res, error)) res.status(500).json({ error: "Failed to create test mail" });
    }
  });

  /** Stammkunden-Brief (B2): Vorschau an die Testadressen oder Entwurf für Kunden */
  app.post("/api/customer-mails/runs/regular-letter", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = customerMailRegularLetterRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid regular customer letter" });
    const tenantId = tenantOf(req);
    try {
      res.json(await createRegularLetterRun(customerMailDeps(storage), tenantId, parsed.data, userName(req)));
    } catch (error) {
      if (sendMailError(res, error)) return;
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Stammkunden-Brief anlegen fehlgeschlagen");
      res.status(500).json({ error: "Failed to create regular customer letter" });
    }
  });

  /** Startvorlage „Stammkunden-Brief“ in Brevo anlegen */
  app.post("/api/customer-mails/templates/regular-letter", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = customerMailTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Brevo template request" });
    const tenantId = tenantOf(req);
    try {
      const templateId = await createRegularLetterTemplate(customerMailDeps(storage), tenantId, parsed.data.senderId);
      moduleLog.info({ tenantId, by: userName(req), templateId }, "Kundenmails: Vorlage Stammkunden-Brief angelegt");
      res.json({ templateId });
    } catch (error) {
      if (sendMailError(res, error)) return;
      moduleLog.error({ err: error, tenantId }, "Kundenmails: Brevo-Vorlage anlegen fehlgeschlagen");
      res.status(502).json({ error: "Failed to create Brevo template" });
    }
  });

  app.get("/api/customer-mails/runs/:id", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      res.json(await getRun(tenantId, String(req.params.id)));
    } catch (error) {
      if (!(error instanceof CustomerMailError)) moduleLog.error({ err: error, tenantId }, "Kundenmails: Aussendung laden fehlgeschlagen");
      if (!sendMailError(res, error)) res.status(500).json({ error: "Failed to load customer mail run" });
    }
  });

  app.post("/api/customer-mails/runs/:id/send", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      res.json(await sendRun(customerMailDeps(storage), tenantId, String(req.params.id), userName(req)));
    } catch (error) {
      if (!(error instanceof CustomerMailError)) moduleLog.error({ err: error, tenantId }, "Kundenmails: Versand fehlgeschlagen");
      if (!sendMailError(res, error)) res.status(500).json({ error: "Failed to send customer mail run" });
    }
  });

  app.post("/api/customer-mails/runs/:id/cancel", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      res.json(await cancelRun(tenantId, String(req.params.id), new Date()));
    } catch (error) {
      if (!(error instanceof CustomerMailError)) moduleLog.error({ err: error, tenantId }, "Kundenmails: Aussendung verwerfen fehlgeschlagen");
      if (!sendMailError(res, error)) res.status(500).json({ error: "Failed to cancel customer mail run" });
    }
  });
}
