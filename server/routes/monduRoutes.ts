// Mondu an Bestellungen: Übersicht für den Mondu-Kasten, Mondu-Zahlung erneut senden (Shop-Bestellungen mit
// abgebrochener Mondu-Zahlung), MonduSell anlegen, Status nachlesen, stornieren, Rechnung erneut übergeben.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { MONDU_LEGAL_FORMS } from "@shared/mondu";
import { requireAuth, requireCsrf, requireEditOrders } from "../auth/auth";
import { logger } from "../lib/logger";
import { checkOrderChannelAccess, getSalesChannelFilter } from "./routeHelpers";
import {
  MonduSellError,
  cancelMonduSellOrder,
  createMonduSellOrder,
  getMonduOverview,
  refreshMonduSellOrder,
  resendMonduPaymentLink,
  submitMonduSellInvoice,
} from "../invoicing/monduSell";

const moduleLog = logger.child({ component: "routes/monduRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userOf = (req: Request) => {
  const user = (req as any).user as { id?: string; username?: string } | undefined;
  return { id: user?.id ?? null, name: user?.username ?? null };
};

const resendSchema = z.object({ email: z.string().trim().max(254).optional() });

const sellSchema = z.object({
  buyerEmail: z.string().trim().max(254).optional(),
  netTerm: z.number().int().min(1).max(180).nullable().optional(),
  legalForm: z.enum(MONDU_LEGAL_FORMS).nullable().optional(),
  owner: z
    .object({
      firstName: z.string().trim().max(100),
      lastName: z.string().trim().max(100),
      birthDate: z.string().trim().max(10),
    })
    .nullable()
    .optional(),
});

/** Darf der Nutzer die Bestellung sehen (Verkaufskanal)? Sonst Antwort schon gesendet */
async function orderAccess(req: Request, res: Response): Promise<boolean> {
  const denied = await checkOrderChannelAccess(req.params.orderId, await getSalesChannelFilter(req), tenantOf(req));
  if (denied) {
    res.status(denied.status).json({ error: denied.error });
    return false;
  }
  return true;
}

function sendError(res: Response, error: unknown, code: string, fallback: string) {
  if (error instanceof MonduSellError) {
    return res.status(error.httpStatus).json({ error: error.message, code: error.code, message: error.detail });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Ungültige Eingabe", code: "mondu_sell_invalid_input", message: error.errors[0]?.message });
  }
  moduleLog.error({ err: error }, fallback);
  return res.status(500).json({ error: fallback, code, message: error instanceof Error ? error.message : undefined });
}

export function registerMonduRoutes(app: Express) {
  app.get("/api/orders/:orderId/mondu", requireAuth, async (req, res) => {
    try {
      if (!(await orderAccess(req, res))) return;
      res.json(await getMonduOverview(tenantOf(req), req.params.orderId));
    } catch (error) {
      sendError(res, error, "mondu_overview_failed", "Mondu-Angaben konnten nicht geladen werden");
    }
  });

  app.post("/api/orders/:orderId/mondu/resend-payment", requireAuth, requireEditOrders, requireCsrf, async (req, res) => {
    try {
      if (!(await orderAccess(req, res))) return;
      const body = resendSchema.parse(req.body ?? {});
      res.json(await resendMonduPaymentLink(tenantOf(req), req.params.orderId, { email: body.email, userName: userOf(req).name }));
    } catch (error) {
      sendError(res, error, "mondu_resend_failed", "Mondu-Zahlung konnte nicht erneut gesendet werden");
    }
  });

  app.post("/api/orders/:orderId/mondu/sell", requireAuth, requireEditOrders, requireCsrf, async (req, res) => {
    try {
      if (!(await orderAccess(req, res))) return;
      const input = sellSchema.parse(req.body ?? {});
      await createMonduSellOrder(tenantOf(req), req.params.orderId, input, userOf(req));
      res.json(await getMonduOverview(tenantOf(req), req.params.orderId));
    } catch (error) {
      sendError(res, error, "mondu_sell_create_failed", "Mondu-Sell-Bestellung konnte nicht angelegt werden");
    }
  });

  app.post("/api/orders/:orderId/mondu/sell/refresh", requireAuth, requireEditOrders, requireCsrf, async (req, res) => {
    try {
      if (!(await orderAccess(req, res))) return;
      await refreshMonduSellOrder(tenantOf(req), req.params.orderId, { by: userOf(req).name });
      res.json(await getMonduOverview(tenantOf(req), req.params.orderId));
    } catch (error) {
      sendError(res, error, "mondu_sell_refresh_failed", "Mondu-Status konnte nicht aktualisiert werden");
    }
  });

  app.post("/api/orders/:orderId/mondu/sell/cancel", requireAuth, requireEditOrders, requireCsrf, async (req, res) => {
    try {
      if (!(await orderAccess(req, res))) return;
      await cancelMonduSellOrder(tenantOf(req), req.params.orderId, userOf(req));
      res.json(await getMonduOverview(tenantOf(req), req.params.orderId));
    } catch (error) {
      sendError(res, error, "mondu_sell_cancel_failed", "Mondu-Sell-Bestellung konnte nicht storniert werden");
    }
  });

  app.post("/api/orders/:orderId/mondu/sell/invoice", requireAuth, requireEditOrders, requireCsrf, async (req, res) => {
    try {
      if (!(await orderAccess(req, res))) return;
      const result = await submitMonduSellInvoice(tenantOf(req), req.params.orderId, { by: userOf(req).name });
      res.json({ result, overview: await getMonduOverview(tenantOf(req), req.params.orderId) });
    } catch (error) {
      sendError(res, error, "mondu_sell_invoice_failed", "Rechnung konnte nicht an Mondu übergeben werden");
    }
  });
}
