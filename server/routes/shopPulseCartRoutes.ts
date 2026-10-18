// Shop-Puls Stufe 2 (S2-3), B2B-Warenkorb-Alarm:
// - POST /api/public/shop-pulse/cart-signal: Meldungen des Shopware-Plugins MetaCartSignal. Ohne Anmeldung, aber nur
//   mit gültiger Signatur (HMAC-SHA256 mit dem Schlüssel des Mandanten aus X-Meta-Tenant, Zeitstempel höchstens
//   5 Minuten daneben) und begrenzt auf 120 Meldungen je Mandant und Minute. Solange der Schalter
//   „Warenkorb-Alarm“ aus ist, wird nichts gespeichert.
//   Liegt unter /api/public/, damit die Cookie-CSRF-Prüfung (server/index.ts) nicht greift: Es gibt keine
//   Sitzung, die Absicherung ist die Signatur.
// - Einstellungen, Schlüssel erzeugen, Liste der Warenkörbe und „Daten löschen“: nur Administratoren.
import type { Express, Request, Response } from "express";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { publicAppBaseUrl } from "../commercial/emailIntakeTeams";
import { getEmailOutboundSettings } from "../email/emailOutbound";
import { cartSignalSchema, shopPulseCartSettingsSchema, type ShopPulseCartOverview } from "@shared/shopPulseCart";
import { cartSignalRateOk, verifyCartSignature } from "../shopPulse/cartAlarm";
import {
  deleteAllCarts,
  getCartSecret,
  getCartSettings,
  listCarts,
  rotateCartSecret,
  rowToCart,
  storeCartSignal,
  touchLastSignal,
  updateCartSettings,
} from "../shopPulse/cartAlarmRun";

const moduleLog = logger.child({ component: "routes/shopPulseCartRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userName = (req: Request) => String((req as any).user?.username ?? "admin").slice(0, 120);
const MAX_BODY = 64 * 1024;

async function overview(req: Request): Promise<ShopPulseCartOverview> {
  const tenantId = tenantOf(req);
  const s = await getCartSettings(storage, tenantId);
  const { hasSecret, lastSignalAt, ...settings } = s;
  const mailConfigured = await getEmailOutboundSettings(storage)
    .then((r) => !!r.settings.enabled)
    .catch(() => false);
  const carts = (await listCarts(tenantId)).map((r) => rowToCart(r, settings)).sort((a, b) => b.cartUpdatedAt.localeCompare(a.cartUpdatedAt));
  const base = publicAppBaseUrl(process.env.APP_URL?.trim() || `${req.protocol}://${req.get("host") || ""}`);
  return { settings, tenantId, endpointUrl: base, hasSecret, mailConfigured, lastSignalAt, carts };
}

export function registerShopPulseCartRoutes(app: Express): void {
  /** Meldung des Plugins (öffentlich, signiert) */
  app.post("/api/public/shop-pulse/cart-signal", async (req: Request, res: Response) => {
    const tenantHeader = req.get("x-meta-tenant")?.trim() ?? "";
    const raw = req.rawBody instanceof Buffer ? req.rawBody : null;
    if (!tenantHeader || !raw || raw.length > MAX_BODY) return res.status(400).json({ error: "Invalid cart signal" });
    if (!cartSignalRateOk(tenantHeader)) return res.status(429).json({ error: "Too many cart signals" });
    try {
      const tenant = await storage.getTenant(tenantHeader).catch(() => undefined);
      const secret = tenant ? await getCartSecret(storage, tenant.id) : null;
      const check = secret ? verifyCartSignature(secret, req.get("x-meta-timestamp"), req.get("x-meta-signature"), raw, new Date()) : "missing";
      if (!tenant || check !== "ok") {
        moduleLog.warn({ tenant: tenantHeader.slice(0, 40), check: tenant ? check : "unknownTenant", ip: req.ip }, "Warenkorb-Signal abgelehnt");
        return res.status(401).json({ error: "Invalid cart signal signature" });
      }
      const parsed = cartSignalSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid cart signal" });
      const now = new Date();
      await touchLastSignal(storage, tenant.id, now);
      const settings = await getCartSettings(storage, tenant.id);
      if (!settings.enabled) return res.status(202).json({ stored: false, reason: "disabled" });
      const result = await storeCartSignal(tenant.id, parsed.data, now);
      res.status(202).json({ stored: result !== "unknownCart", result });
    } catch (error) {
      moduleLog.error({ err: error }, "Warenkorb-Signal: Speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to store cart signal" });
    }
  });

  app.get("/api/shop-pulse/cart-alarm", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(req));
    } catch (error) {
      moduleLog.error({ err: error }, "Warenkorb-Alarm: Laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load cart alarm" });
    }
  });

  /** Einstellungen; Ausschalten löscht alle gespeicherten Warenkörbe */
  app.put("/api/shop-pulse/cart-alarm/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = shopPulseCartSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid cart alarm settings" });
    const tenantId = tenantOf(req);
    try {
      const before = await getCartSettings(storage, tenantId);
      await updateCartSettings(storage, tenantId, parsed.data);
      if (before.enabled && parsed.data.enabled === false) await deleteAllCarts(tenantId);
      moduleLog.info({ tenantId, by: userName(req), enabled: parsed.data.enabled ?? before.enabled }, "Warenkorb-Alarm: Einstellungen gespeichert");
      res.json(await overview(req));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Warenkorb-Alarm: Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save cart alarm settings" });
    }
  });

  /** Neuen Schlüssel erzeugen; wird nur in dieser Antwort im Klartext gezeigt */
  app.post("/api/shop-pulse/cart-alarm/secret", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      const secret = await rotateCartSecret(storage, tenantId);
      moduleLog.info({ tenantId, by: userName(req) }, "Warenkorb-Alarm: neuer Schlüssel erzeugt");
      res.json({ ...(await overview(req)), secret });
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Warenkorb-Alarm: Schlüssel erzeugen fehlgeschlagen");
      res.status(500).json({ error: "Failed to create cart alarm secret" });
    }
  });

  app.delete("/api/shop-pulse/cart-alarm/carts", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const tenantId = tenantOf(req);
    try {
      await deleteAllCarts(tenantId);
      moduleLog.info({ tenantId, by: userName(req) }, "Warenkorb-Alarm: gespeicherte Warenkörbe gelöscht");
      res.json(await overview(req));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Warenkorb-Alarm: Löschen fehlgeschlagen");
      res.status(500).json({ error: "Failed to delete stored carts" });
    }
  });
}
