/**
 * Portal-Registrierungen: Oberfläche (Liste, Prüfen, Ausführen), Einstellungen, Außendienst-Zuordnung
 * und die Endpunkte für den n8n-Workflow (Konfiguration, Mail-Eingang, Postausgang).
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  requireAuth,
  requireAuthOrIntegrationKey,
  requireCsrf,
  requireManageB2B,
  requireViewB2B,
} from "../auth/auth";
import { restoreTenantContext } from "../lib/tenantContext";
import { uploadRateLimiter } from "../routes/routeHelpers";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import type { User } from "@shared/schema";
import {
  PORTAL_REGISTRATION_STATUSES,
  portalRegistrationDataSchema,
  portalRegistrationSettingsSchema,
  type PortalRegistrationStatus,
} from "@shared/portalRegistrations";
import { portalRegistrationRepo } from "./portalRegistrationRepo";
import {
  PortalRegistrationError,
  ackOutboxMail,
  claimOutboxMails,
  discardRegistration,
  executeRegistration,
  getPortalRegistrationSettings,
  ingestRegistrationMail,
  portalRegistrationWorkflowConfig,
  recheckDueRegistrations,
  recheckRegistration,
  requestMasterData,
  resendPasswordReset,
  retryOutboxMail,
  savePortalRegistrationSettings,
  selectRegistrationCustomer,
  setPlanChanges,
  toDetail,
  toListItem,
  updateRegistrationData,
  type ServiceContext,
} from "./portalRegistrationService";
import { parseSalesRepFile } from "./salesRepImport";
import { logger } from "../lib/logger";

const log = logger.child({ component: "b2b/portalRegistrationRoutes" });

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mailUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const listUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function userOf(req: Request): User | undefined {
  return req.user as User | undefined;
}

async function contextFor(req: Request): Promise<ServiceContext> {
  const tenantId = req.tenantId ?? null;
  const user = userOf(req);
  return {
    tenantId,
    settings: await getPortalRegistrationSettings(undefined, tenantId),
    userId: user?.id ?? null,
    userName: user?.username ?? null,
    appBaseUrl: publicAppBaseUrl(`${req.protocol}://${req.get("host") || ""}`),
  };
}

function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof PortalRegistrationError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Ungültige Eingabe", details: error.flatten() });
    return;
  }
  log.error({ err: error }, fallback);
  res.status(500).json({ error: fallback });
}

async function detailResponse(tenantId: string | null, row: Parameters<typeof toDetail>[0]) {
  const mails = await portalRegistrationRepo.mailsForRegistration(tenantId, row.id);
  return {
    registration: toDetail(row),
    mails: mails.map((m) => ({
      id: m.id,
      kind: m.kind,
      to: m.toAddresses,
      cc: m.ccAddresses,
      subject: m.subject,
      status: m.status,
      attempts: m.attempts,
      lastError: m.lastError,
      createdAt: m.createdAt,
      sentAt: m.sentAt,
    })),
  };
}

const statusListSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()) : []))
  .pipe(z.array(z.enum(PORTAL_REGISTRATION_STATUSES)));

const idParam = (req: Request) => String(req.params.id);

export function registerPortalRegistrationRoutes(app: Express): void {
  // ---------- Einstellungen ----------
  app.get("/api/b2b/registration-settings", requireAuth, requireViewB2B, async (req, res) => {
    try {
      res.json({ settings: await getPortalRegistrationSettings(undefined, req.tenantId ?? null) });
    } catch (error) {
      handleError(res, error, "Einstellungen konnten nicht geladen werden");
    }
  });

  app.put("/api/b2b/registration-settings", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const parsed = portalRegistrationSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Ungültige Einstellungen", details: parsed.error.flatten() });
      }
      const settings = parsed.data;
      if (settings.mailbox && !SIMPLE_EMAIL_RE.test(settings.mailbox)) {
        return res.status(400).json({ error: "Ungültige Postfach-Adresse", code: "portal_registration_mailbox_invalid" });
      }
      if (settings.masterDataEmail && !SIMPLE_EMAIL_RE.test(settings.masterDataEmail)) {
        return res.status(400).json({ error: "Ungültige Kundenstamm-Adresse", code: "portal_registration_master_data_invalid" });
      }
      await savePortalRegistrationSettings(settings, req.tenantId ?? null);
      log.info({ event: "portal_registration.settings_saved", userId: userOf(req)?.id, enabled: settings.enabled, autoExecute: settings.autoExecute }, "Einstellungen Portal-Registrierungen gespeichert");
      res.json({ settings });
    } catch (error) {
      handleError(res, error, "Einstellungen konnten nicht gespeichert werden");
    }
  });

  // ---------- Außendienst-Zuordnung ----------
  app.get("/api/b2b/sales-reps", requireAuth, requireViewB2B, async (req, res) => {
    try {
      res.json({ items: await portalRegistrationRepo.listSalesReps(req.tenantId ?? null) });
    } catch (error) {
      handleError(res, error, "Außendienst-Zuordnung konnte nicht geladen werden");
    }
  });

  app.post(
    "/api/b2b/sales-reps/import",
    requireAuth,
    requireManageB2B,
    requireCsrf,
    uploadRateLimiter,
    listUpload.single("file"),
    restoreTenantContext,
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });
        const mode = req.body?.mode === "merge" ? "merge" : "replace";
        const dryRun = req.body?.dryRun === "true" || req.body?.dryRun === true;
        const parsed = parseSalesRepFile(req.file.buffer);
        if (parsed.rows.length === 0) {
          return res.status(400).json({ error: "Keine gültigen Zeilen gefunden", code: "sales_rep_import_empty", errors: parsed.errors, columns: parsed.columns });
        }
        let imported = 0;
        if (!dryRun) {
          imported = await portalRegistrationRepo.importSalesReps(req.tenantId ?? null, parsed.rows, mode);
          log.info({ event: "portal_registration.sales_reps_imported", userId: userOf(req)?.id, rows: imported, mode }, "Außendienst-Zuordnung importiert");
        }
        res.json({ dryRun, mode, rows: parsed.rows.length, imported, errors: parsed.errors, columns: parsed.columns, preview: parsed.rows.slice(0, 20) });
      } catch (error) {
        handleError(res, error, "Außendienst-Zuordnung konnte nicht importiert werden");
      }
    },
  );

  app.put("/api/b2b/sales-reps", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const body = z
        .object({
          customerNumber: z.string().trim().min(1).max(40),
          repName: z.string().trim().max(120).default(""),
          repEmail: z.string().trim().toLowerCase().regex(SIMPLE_EMAIL_RE),
        })
        .parse(req.body);
      await portalRegistrationRepo.importSalesReps(req.tenantId ?? null, [body], "merge");
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, "Zuordnung konnte nicht gespeichert werden");
    }
  });

  app.delete("/api/b2b/sales-reps/:customerNumber", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      await portalRegistrationRepo.deleteSalesRep(req.tenantId ?? null, String(req.params.customerNumber));
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, "Zuordnung konnte nicht gelöscht werden");
    }
  });

  // ---------- n8n ----------
  // Zu Beginn jedes Laufs: an/aus, Postfach, Ordner, $filter. Prüft nebenbei wartende Anmeldungen neu.
  app.get("/api/b2b/registrations/n8n/config", requireAuthOrIntegrationKey, requireManageB2B, async (req, res) => {
    try {
      const ctx = await contextFor(req);
      const config = portalRegistrationWorkflowConfig(ctx.settings, {
        ready: true,
        notReadyReason: null,
      });
      res.json(config);
      if (ctx.settings.enabled) {
        // Nach der Antwort: n8n wartet nicht auf die Neuprüfung
        void recheckDueRegistrations({ ...ctx, userName: "Automatik" }).catch((err) =>
          log.warn({ err }, "[PortalRegistration] Neuprüfung wartender Anmeldungen gescheitert"),
        );
      }
    } catch (error) {
      handleError(res, error, "Konfiguration konnte nicht geladen werden");
    }
  });

  app.post(
    "/api/b2b/registrations/n8n/intake",
    requireAuthOrIntegrationKey,
    requireManageB2B,
    requireCsrf,
    uploadRateLimiter,
    mailUpload.single("file"),
    restoreTenantContext,
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });
        const ctx = await contextFor(req);
        const intake = await ingestRegistrationMail(ctx, {
          buffer: req.file.buffer,
          graphMessageId: typeof req.body?.graph_message_id === "string" ? req.body.graph_message_id.slice(0, 500) : null,
          mailbox: typeof req.body?.mailbox === "string" ? req.body.mailbox.slice(0, 254) : ctx.settings.mailbox || null,
          subjectHint: typeof req.body?.subject === "string" ? req.body.subject.slice(0, 500) : null,
        });
        res.json({ intake });
      } catch (error) {
        handleError(res, error, "Registrierung konnte nicht verarbeitet werden");
      }
    },
  );

  app.get("/api/b2b/registrations/n8n/outbox", requireAuthOrIntegrationKey, requireManageB2B, async (req, res) => {
    try {
      const ctx = await contextFor(req);
      if (!ctx.settings.enabled) return res.json({ mails: [] });
      res.json({ mails: await claimOutboxMails(ctx) });
    } catch (error) {
      handleError(res, error, "Postausgang konnte nicht geladen werden");
    }
  });

  app.post("/api/b2b/registrations/n8n/outbox/:id/ack", requireAuthOrIntegrationKey, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const body = z
        .object({
          ok: z.boolean(),
          statusCode: z.number().int().optional().nullable(),
          error: z.string().max(4000).optional().nullable(),
        })
        .parse(req.body);
      const ctx = await contextFor(req);
      await ackOutboxMail(ctx, idParam(req), { ok: body.ok, error: body.error ?? (body.statusCode ? `HTTP ${body.statusCode}` : null) });
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, "Rückmeldung konnte nicht gespeichert werden");
    }
  });

  // ---------- Oberfläche ----------
  app.get("/api/b2b/registrations", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const statuses = statusListSchema.parse(typeof req.query.status === "string" ? req.query.status : undefined) as PortalRegistrationStatus[];
      const tenantId = req.tenantId ?? null;
      const [rows, counts] = await Promise.all([
        portalRegistrationRepo.list(tenantId, { statuses, limit: Number(req.query.limit) || 200 }),
        portalRegistrationRepo.countByStatus(tenantId),
      ]);
      res.json({ items: rows.map(toListItem), counts });
    } catch (error) {
      handleError(res, error, "Registrierungen konnten nicht geladen werden");
    }
  });

  // Anmelde-Mail von Hand hochladen (.eml/.msg), z. B. wenn sie nicht im Postfach gelandet ist
  app.post(
    "/api/b2b/registrations/upload",
    requireAuth,
    requireManageB2B,
    requireCsrf,
    uploadRateLimiter,
    mailUpload.single("file"),
    restoreTenantContext,
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "Keine Datei hochgeladen" });
        if (!/\.(eml|msg)$/i.test(req.file.originalname || "")) {
          return res.status(400).json({ error: "Nur .eml oder .msg", code: "portal_registration_upload_type" });
        }
        const ctx = await contextFor(req);
        const intake = await ingestRegistrationMail(ctx, { buffer: req.file.buffer, mailbox: null });
        res.json({ intake });
      } catch (error) {
        handleError(res, error, "Registrierung konnte nicht verarbeitet werden");
      }
    },
  );

  app.get("/api/b2b/registrations/:id", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const row = await portalRegistrationRepo.get(tenantId, idParam(req));
      if (!row) return res.status(404).json({ error: "Registrierung nicht gefunden", code: "portal_registration_not_found" });
      res.json(await detailResponse(tenantId, row));
    } catch (error) {
      handleError(res, error, "Registrierung konnte nicht geladen werden");
    }
  });

  app.get("/api/b2b/registrations/:id/original", requireAuth, requireViewB2B, async (req, res) => {
    try {
      const row = await portalRegistrationRepo.get(req.tenantId ?? null, idParam(req));
      if (!row?.rawEmlBase64) return res.status(404).json({ error: "Originalmail nicht vorhanden", code: "portal_registration_no_original" });
      res.setHeader("Content-Type", "message/rfc822");
      res.setHeader("Content-Disposition", `attachment; filename="Registrierung-${row.id.slice(0, 8)}.eml"`);
      res.send(Buffer.from(row.rawEmlBase64, "base64"));
    } catch (error) {
      handleError(res, error, "Originalmail konnte nicht geladen werden");
    }
  });

  /** Aktion auf einer Registrierung: Ergebnis ist immer die aktualisierte Detailansicht */
  const runAction = async (req: Request, res: Response, run: (ctx: ServiceContext) => Promise<Parameters<typeof toDetail>[0]>, fallback: string) => {
    try {
      const ctx = await contextFor(req);
      const row = await run(ctx);
      res.json(await detailResponse(ctx.tenantId, row));
    } catch (error) {
      handleError(res, error, fallback);
    }
  };

  app.post("/api/b2b/registrations/:id/execute", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(req, res, (ctx) => executeRegistration(ctx, idParam(req)), "Registrierung konnte nicht ausgeführt werden"),
  );

  app.post("/api/b2b/registrations/:id/recheck", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(
      req,
      res,
      (ctx) => recheckRegistration(ctx, idParam(req), { reextract: req.body?.reextract === true }),
      "Registrierung konnte nicht neu geprüft werden",
    ),
  );

  app.put("/api/b2b/registrations/:id/data", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(
      req,
      res,
      (ctx) => updateRegistrationData(ctx, idParam(req), portalRegistrationDataSchema.parse(req.body?.data)),
      "Anmeldedaten konnten nicht gespeichert werden",
    ),
  );

  app.post("/api/b2b/registrations/:id/customer", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(
      req,
      res,
      (ctx) => {
        const body = z
          .object({ customerId: z.string().trim().max(64).optional().nullable(), customerNumber: z.string().trim().max(40).optional().nullable() })
          .refine((b) => Boolean(b.customerId || b.customerNumber), "Kunde fehlt")
          .parse(req.body);
        return selectRegistrationCustomer(ctx, idParam(req), body);
      },
      "Kunde konnte nicht zugeordnet werden",
    ),
  );

  app.patch("/api/b2b/registrations/:id/plan", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(
      req,
      res,
      (ctx) => {
        const body = z
          .object({
            changes: z.record(z.enum(["active", "platformAccess", "vatId", "phone"]), z.boolean()).default({}),
            sendPasswordReset: z.boolean().optional(),
          })
          .parse(req.body);
        return setPlanChanges(ctx, idParam(req), body.changes, body.sendPasswordReset);
      },
      "Plan konnte nicht geändert werden",
    ),
  );

  app.post("/api/b2b/registrations/:id/master-data", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(req, res, (ctx) => requestMasterData(ctx, idParam(req)), "Anfrage an den Kundenstamm konnte nicht angelegt werden"),
  );

  app.post("/api/b2b/registrations/:id/discard", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(
      req,
      res,
      (ctx) => discardRegistration(ctx, idParam(req), typeof req.body?.reason === "string" ? req.body.reason : null),
      "Registrierung konnte nicht verworfen werden",
    ),
  );

  app.post("/api/b2b/registrations/:id/password-reset", requireAuth, requireManageB2B, requireCsrf, (req, res) =>
    runAction(req, res, (ctx) => resendPasswordReset(ctx, idParam(req)), "Passwort-Mail konnte nicht ausgelöst werden"),
  );

  app.post("/api/b2b/registrations/mails/:id/retry", requireAuth, requireManageB2B, requireCsrf, async (req, res) => {
    try {
      const ctx = await contextFor(req);
      await retryOutboxMail(ctx, idParam(req));
      res.json({ success: true });
    } catch (error) {
      handleError(res, error, "Mail konnte nicht erneut eingereiht werden");
    }
  });
}
