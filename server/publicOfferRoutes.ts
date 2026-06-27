import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { hashOfferPublicToken } from "./offerToken";
import { buildOfferDetailJson } from "./offerDetailBuilder";
import {
  canPublicAcceptOffer,
  canPublicDeclineOffer,
  isExpirationDatePassed,
  isOfferAlreadyAccepted,
} from "./offerPublicState";
import { B2BSellersClient } from "./b2bSellersClient";
import { rateLimitPublicOfferGet, rateLimitPublicOfferMutation } from "./publicOfferRateLimit";
import { z } from "zod";
import { resolveCpqGlbFromDisk, resolveCpqGlbPresentationPlaceholder } from "./cpqGlbResolve";
import { applyOfferConfigPdfLayoutFromRequest, generateOfferConfigPdf } from "./offerConfigPdf";
import { buildOfferConfigPdfInputWithCpqFallback } from "./offerConfigPdfCpqFallback";
import { enrichOfferConfigPdfInputWithTexts } from "./offerConfigPdfTexts";

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress || "unknown";
}

async function resolveValidLink(token: string) {
  const hash = hashOfferPublicToken(token);
  const link = await storage.getOfferPublicLinkByTokenHash(hash);
  if (!link || link.revokedAt) return null;
  const expires = link.expiresAt instanceof Date ? link.expiresAt : new Date(link.expiresAt as unknown as string);
  if (Number.isNaN(expires.getTime()) || expires <= new Date()) return null;
  return link;
}

export function registerPublicOfferRoutes(app: Express): void {
  app.get("/api/public/offers/:token", async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      if (!rateLimitPublicOfferGet(ip)) {
        return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
      }
      const { token } = req.params;
      const link = await resolveValidLink(token);
      if (!link) {
        return res.status(404).json({ error: "Angebot nicht gefunden oder Link ungültig." });
      }

      const detail = await buildOfferDetailJson(storage, link.shopwareOfferId, link.tenantId);
      await storage.touchOfferPublicLinkAccess(link.id);
      await storage.createOfferPublicEvent(
        {
          linkId: link.id,
          eventType: "view",
          ip,
          meta: null,
        },
        link.tenantId,
      );

      res.json({
        offer: detail,
        shareExpiresAt: link.expiresAt instanceof Date ? link.expiresAt.toISOString() : String(link.expiresAt),
      });
    } catch (error: any) {
      console.error("[public offers GET]", error);
      res.status(500).json({ error: error.message || "Fehler beim Laden des Angebots." });
    }
  });

  app.post("/api/public/offers/:token/accept", async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      const { token } = req.params;
      if (!rateLimitPublicOfferMutation(ip, token)) {
        return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
      }
      const link = await resolveValidLink(token);
      if (!link) {
        return res.status(404).json({ error: "Angebot nicht gefunden oder Link ungültig." });
      }

      const detail = await buildOfferDetailJson(storage, link.shopwareOfferId, link.tenantId);

      if (isOfferAlreadyAccepted(detail.status)) {
        return res.json({ success: true, alreadyAccepted: true });
      }

      if (isExpirationDatePassed(detail.expirationDate)) {
        return res.status(400).json({ error: "Dieses Angebot ist nicht mehr gültig." });
      }

      if (!canPublicAcceptOffer(detail.status)) {
        return res.status(400).json({ error: "Dieses Angebot kann in diesem Status nicht angenommen werden." });
      }

      const settings = await storage.getShopwareSettings(link.tenantId);
      if (!settings) {
        return res.status(500).json({ error: "Shopware ist nicht konfiguriert." });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping", link.tenantId);
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.approveOffer(link.shopwareOfferId);

      await storage.createOfferPublicEvent(
        {
          linkId: link.id,
          eventType: "accept",
          ip,
          meta: { offerNumber: detail.offerNumber },
        },
        link.tenantId,
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error("[public offers accept]", error);
      res.status(500).json({ error: error.message || "Annahme fehlgeschlagen." });
    }
  });

  app.post("/api/public/offers/:token/decline", async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      const { token } = req.params;
      if (!rateLimitPublicOfferMutation(ip, token)) {
        return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
      }
      const link = await resolveValidLink(token);
      if (!link) {
        return res.status(404).json({ error: "Angebot nicht gefunden oder Link ungültig." });
      }

      const bodySchema = z.object({ reason: z.string().max(2000).optional() });
      const parsed = bodySchema.safeParse(req.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      const detail = await buildOfferDetailJson(storage, link.shopwareOfferId, link.tenantId);

      if (isOfferAlreadyAccepted(detail.status)) {
        return res.status(400).json({ error: "Das Angebot wurde bereits angenommen." });
      }

      if (isExpirationDatePassed(detail.expirationDate)) {
        return res.status(400).json({ error: "Dieses Angebot ist nicht mehr gültig." });
      }

      if (!canPublicDeclineOffer(detail.status)) {
        return res.status(400).json({ error: "Dieses Angebot kann in diesem Status nicht abgelehnt werden." });
      }

      const settings = await storage.getShopwareSettings(link.tenantId);
      if (!settings) {
        return res.status(500).json({ error: "Shopware ist nicht konfiguriert." });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping", link.tenantId);
      const b2b = new B2BSellersClient(settings, { statusMapping });
      await b2b.rejectOffer(link.shopwareOfferId, reason);

      await storage.createOfferPublicEvent(
        {
          linkId: link.id,
          eventType: "decline",
          ip,
          meta: reason ? { reason } : null,
        },
        link.tenantId,
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error("[public offers decline]", error);
      res.status(500).json({ error: error.message || "Ablehnung fehlgeschlagen." });
    }
  });

  // Angebots-PDF (B2B/Shopware), nur mit gültigem Link-Token
  app.get("/api/public/offers/:token/pdf", async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      if (!rateLimitPublicOfferGet(ip)) {
        return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
      }
      const { token } = req.params;
      const link = await resolveValidLink(token);
      if (!link) {
        return res.status(404).json({ error: "Angebot nicht gefunden oder Link ungültig." });
      }

      const settings = await storage.getShopwareSettings(link.tenantId);
      if (!settings) {
        return res.status(500).json({ error: "Shopware ist nicht konfiguriert." });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping", link.tenantId);
      const client = new B2BSellersClient(settings, { statusMapping });
      const pdfBuffer = await client.fetchOfferPdf(link.shopwareOfferId);

      await storage.touchOfferPublicLinkAccess(link.id);
      await storage.createOfferPublicEvent(
        {
          linkId: link.id,
          eventType: "pdf_download",
          ip,
          meta: { kind: "standard" },
        },
        link.tenantId,
      );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="angebot.pdf"');
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("[public offers pdf]", error);
      res.status(400).json({ error: error.message || "PDF nicht verfügbar." });
    }
  });

  // Konfigurations-PDF (METAorder), nur mit gültigem Link-Token
  app.get("/api/public/offers/:token/config-pdf", async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      if (!rateLimitPublicOfferGet(ip)) {
        return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
      }
      const { token } = req.params;
      const link = await resolveValidLink(token);
      if (!link) {
        return res.status(404).json({ error: "Angebot nicht gefunden oder Link ungültig." });
      }

      const settings = await storage.getShopwareSettings(link.tenantId);
      if (!settings) {
        return res.status(500).json({ error: "Shopware ist nicht konfiguriert." });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping", link.tenantId);
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(link.shopwareOfferId);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

      const input = await buildOfferConfigPdfInputWithCpqFallback(
        storage,
        link.shopwareOfferId,
        link.tenantId,
        rawOffer.data,
        mapped,
        settings
      );
      if (!input) {
        return res.status(404).json({
          error: "Kein Konfigurations-PDF verfügbar (kein MetaCalc-Konfigurationsangebot).",
        });
      }

      await enrichOfferConfigPdfInputWithTexts(storage, input, mapped.items || [], link.tenantId);
      const pdfInput = applyOfferConfigPdfLayoutFromRequest(input, req.query as Record<string, unknown>);
      const pdfBuffer = await generateOfferConfigPdf(pdfInput);
      const safeName = `angebot-konfiguration-${mapped.offerNumber || link.shopwareOfferId}`.replace(
        /[^a-zA-Z0-9._-]+/g,
        "_",
      );

      await storage.touchOfferPublicLinkAccess(link.id);
      await storage.createOfferPublicEvent(
        {
          linkId: link.id,
          eventType: "pdf_download",
          ip,
          meta: { kind: "config" },
        },
        link.tenantId,
      );

      const download = req.query.download === "true";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${download ? "attachment" : "inline"}; filename="${safeName}.pdf"`,
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("[public offers config-pdf]", error);
      res.status(500).json({ error: error.message || "Konfigurations-PDF fehlgeschlagen." });
    }
  });

  // GLB-Auflösung für Kunden-Ansicht (nur mit gültigem Angebots-Link-Token)
  app.get("/api/public/offers/:token/glb-resolve", async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      if (!rateLimitPublicOfferGet(ip)) {
        return res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
      }
      const { token } = req.params;
      const link = await resolveValidLink(token);
      if (!link) {
        return res.status(404).json({ error: "Ungültiger Link." });
      }
      const presentationOnly =
        req.query.presentationPlaceholder === "1" || req.query.presentationPlaceholder === "true";
      if (presentationOnly) {
        res.json(resolveCpqGlbPresentationPlaceholder());
        return;
      }
      const productNumber = (req.query.productNumber as string)?.trim();
      const manufacturerNumber = (req.query.manufacturerNumber as string)?.trim();
      const result = resolveCpqGlbFromDisk(productNumber || undefined, manufacturerNumber || undefined);
      res.json(result);
    } catch (error: any) {
      console.error("[public offers glb-resolve]", error);
      res.status(500).json({ error: error.message || "GLB-Auflösung fehlgeschlagen." });
    }
  });
}
