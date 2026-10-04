// Angebote: Liste/Details, PDF und Export, Teilen-Link, Versand, Positionen (Service/Montage), Raumplan, Freigabe sowie Lern-Einstellungen.
import { requireAuth, requireManageOffers, requireCsrf, requireAuthOrIntegrationKey, requireViewOffers } from "../auth/auth";
import { getOfferLearningSettings } from "../offers/offerLearning";
import { storage } from "../storage";
import { z } from "zod";
import type { Request, Response, Express } from "express";
import { B2BSellersClient } from "../b2b/b2bSellersClient";
import { getSalesChannelFilter } from "./routeHelpers";
import { buildOfferConfigPdfInputWithCpqFallback } from "../offers/offerConfigPdfCpqFallback";
import { enrichOfferConfigPdfInputWithTexts } from "../offers/offerConfigPdfTexts";
import { attachRoomPlanToPdfInput, buildPlainOfferPdfInput } from "../offers/offerConfigPdfBuilder";
import { applyOfferConfigPdfLayoutFromRequest, generateOfferConfigPdf } from "../offers/offerConfigPdf";
import { buildOfferErpExportModel, offerErpExportToCsv, offerErpExportToXml } from "../offers/offerErpExport";
import { buildOfferDetailJson } from "../offers/offerDetailBuilder";
import { generateOfferPlainToken, hashOfferPublicToken } from "../offers/offerToken";
import { sendEmail } from "../email/emailOutbound";

export function registerOfferRoutes(app: Express): void {
  app.get("/api/offers/learning-settings", requireAuth, requireManageOffers, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const settings = await getOfferLearningSettings(storage, tenantId);
      res.json(settings);
    } catch (error: any) {
      console.error("Error fetching offer learning settings:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer learning settings" });
    }
  });

  app.put("/api/offers/learning-settings", requireAuth, requireManageOffers, async (req, res) => {
    try {
      const tenantId = req.tenantId ?? null;
      const schema = z.object({
        lookbackDays: z.number().min(1).max(3650),
        minOfferValue: z.number().min(0),
      });
      const validated = schema.parse(req.body);
      await storage.saveSetting("offer_learning_settings", validated, tenantId);
      res.json(validated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Error saving offer learning settings:", error);
      res.status(500).json({ error: error.message || "Failed to save offer learning settings" });
    }
  });

  // POST /api/offers/:id/cpq-configuration - eine weitere CPQ-Konfiguration zu einem bestehenden Angebot hinzufügen
  app.post("/api/offers/:id/cpq-configuration", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { systemId, systemName, config, billOfMaterials, cpqConfigurationId, previewImageBase64 } = req.body;
      if (!billOfMaterials || !Array.isArray(billOfMaterials.items) || billOfMaterials.items.length === 0) {
        return res.status(400).json({ error: "Stückliste ist leer. Bitte zuerst die Konfiguration im CPQ-Konfigurator vervollständigen." });
      }
      const previewImage =
        typeof previewImageBase64 === "string" && /^data:image\/\w+;base64,/.test(previewImageBase64)
          ? previewImageBase64
          : null;

      const { addCpqConfigurationToOffer } = await import("../cpq/cpqOfferAppend");
      await addCpqConfigurationToOffer(storage, req.tenantId ?? null, id, {
        systemId: systemId ?? null,
        systemName: systemName ?? null,
        config: config && typeof config === "object" ? config : null,
        cpqConfigurationId: typeof cpqConfigurationId === "string" ? cpqConfigurationId : null,
        previewImageBase64: previewImage,
        billOfMaterials: {
          items: billOfMaterials.items,
          totalPrice: billOfMaterials.totalPrice,
        },
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error adding CPQ configuration to offer:", error);
      res.status(500).json({ error: error.message || "Konfiguration konnte nicht zum Angebot hinzugefügt werden" });
    }
  });

  // GET /api/offers - Get all offers from B2B Sellers Suite
  app.get("/api/offers", requireAuthOrIntegrationKey, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const {
        search,
        status,
        customer,
        dateFrom,
        dateTo,
        page,
        limit,
      } = req.query as Record<string, string | undefined>;

      const allowedChannelIds = await getSalesChannelFilter(req);
      const { offers, total } = await client.fetchOffers({
        search,
        status,
        customer,
        dateFrom,
        dateTo,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        salesChannelIds: allowedChannelIds,
      });
      res.json({ offers, total });
    } catch (error: any) {
      console.error("Error fetching offers:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offers" });
    }
  });

  // GET /api/offers/:id/config-pdf - METAorder PDF with MetaCalc image, description, BOM, overview (Versand, Montage, MwSt.)
  app.get("/api/offers/:id/config-pdf", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { download } = req.query;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

      const input = await buildOfferConfigPdfInputWithCpqFallback(
        storage,
        id,
        (req as any).tenantId,
        rawOffer.data,
        mapped,
        settings
      );
      if (!input) {
        return res.status(404).json({ error: "Kein MetaCalc-Konfigurationsangebot (kein Konfigurations-Payload)." });
      }

      await enrichOfferConfigPdfInputWithTexts(
        storage,
        input,
        mapped.items || [],
        (req as any).tenantId ?? null,
      );
      await attachRoomPlanToPdfInput(storage, input, id, (req as any).tenantId ?? null);

      const pdfInput = applyOfferConfigPdfLayoutFromRequest(input, req.query as Record<string, unknown>);
      const pdfBuffer = await generateOfferConfigPdf(pdfInput);
      const safeName = `angebot-konfiguration-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

      res.setHeader("Content-Type", "application/pdf");
      if (download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      }
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating offer config PDF:", error);
      res.status(500).json({ error: error.message || "Failed to generate configuration PDF" });
    }
  });

  // GET /api/offers/:id/pdf - Download or preview offer PDF (optional, if configured)
  app.get("/api/offers/:id/pdf", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { download } = req.query;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

      // METAorder-Angebots-PDF: MetaCalc-Konfiguration falls vorhanden, sonst Standard-Angebot.
      const configInput = await buildOfferConfigPdfInputWithCpqFallback(
        storage,
        id,
        (req as any).tenantId,
        rawOffer.data,
        mapped,
        settings
      );
      const input =
        configInput ?? (await buildPlainOfferPdfInput(rawOffer.data, mapped, settings, (req as any).tenantId));

      await enrichOfferConfigPdfInputWithTexts(
        storage,
        input,
        mapped.items || [],
        (req as any).tenantId ?? null,
      );
      await attachRoomPlanToPdfInput(storage, input, id, (req as any).tenantId ?? null);

      const pdfInput = applyOfferConfigPdfLayoutFromRequest(input, req.query as Record<string, unknown>);
      const pdfBuffer = await generateOfferConfigPdf(pdfInput);
      const safeName = `angebot-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

      res.setHeader("Content-Type", "application/pdf");
      if (download === "true") {
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
      }
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating offer PDF:", error);
      res.status(500).json({ error: error.message || "PDF not available" });
    }
  });

  // GET /api/offers/:id/export.csv — ERP-Import (CSV, UTF-8 mit BOM, Semikolon)
  app.get("/api/offers/:id/export.csv", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);
      const model = await buildOfferErpExportModel(settings, mapped);
      const csv = offerErpExportToCsv(model);
      const safeName = `angebot-erp-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
      res.send(Buffer.from(csv, "utf8"));
    } catch (error: any) {
      console.error("Error generating offer ERP CSV:", error);
      res.status(500).json({ error: error.message || "Failed to export offer CSV" });
    }
  });

  // GET /api/offers/:id/export.xml — ERP-Import (XML)
  app.get("/api/offers/:id/export.xml", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      const rawOffer = await client.fetchOfferById(id);
      const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);
      const model = await buildOfferErpExportModel(settings, mapped);
      const xml = offerErpExportToXml(model);
      const safeName = `angebot-erp-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xml"`);
      res.send(Buffer.from(xml, "utf8"));
    } catch (error: any) {
      console.error("Error generating offer ERP XML:", error);
      res.status(500).json({ error: error.message || "Failed to export offer XML" });
    }
  });

  // GET /api/offers/:id - Get single offer with full details
  app.get("/api/offers/:id", requireAuthOrIntegrationKey, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const detail = await buildOfferDetailJson(storage, id, (req as any).tenantId);
      res.json(detail);
    } catch (error: any) {
      console.error("Error fetching offer details:", error);
      res.status(500).json({ error: error.message || "Failed to fetch offer details" });
    }
  });

  // GET /api/offers/:id/share-link — aktiver öffentlicher Link (ohne Klartext-Token)
  app.get("/api/offers/:id/share-link", requireAuth, requireViewOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const active = await storage.getActiveOfferPublicLinkForOffer(id, (req as any).tenantId);
      if (!active) {
        return res.json({ active: false });
      }
      res.json({
        active: true,
        linkId: active.id,
        expiresAt: active.expiresAt instanceof Date ? active.expiresAt.toISOString() : active.expiresAt,
        createdAt: active.createdAt instanceof Date ? active.createdAt.toISOString() : active.createdAt,
        lastAccessAt: active.lastAccessAt
          ? active.lastAccessAt instanceof Date
            ? active.lastAccessAt.toISOString()
            : active.lastAccessAt
          : null,
      });
    } catch (error: any) {
      console.error("Error fetching offer share link:", error);
      res.status(500).json({ error: error.message || "Failed to fetch share link" });
    }
  });

  // Erzeugt einen frischen öffentlichen Angebots-Link (widerruft frühere aktive Links für
  // dasselbe Angebot, siehe storage.createOfferPublicLink) — geteilt zwischen dem manuellen
  // "Link erzeugen"-Button und dem "Angebot per E-Mail senden"-Flow, die beide denselben
  // öffentlichen Klartext-Token nur einmalig bei der Erzeugung zurückbekommen.
  async function createFreshOfferPublicLink(
    req: Request,
    offerId: string,
    expiresInDays: number
  ): Promise<{ linkId: string; token: string; publicUrl: string; expiresAt: Date }> {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id as string | undefined;
    const plain = generateOfferPlainToken();
    const tokenHash = hashOfferPublicToken(plain);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const link = await storage.createOfferPublicLink(
      {
        tenantId: tenantId ?? null,
        shopwareOfferId: offerId,
        tokenHash,
        expiresAt,
        revokedAt: null,
        createdByUserId: userId ?? null,
        lastAccessAt: null,
      },
      tenantId
    );

    const base =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host") || ""}`.replace(/\/$/, "");
    const publicUrl = `${base}/angebot/${encodeURIComponent(plain)}`;

    return { linkId: link.id, token: plain, publicUrl, expiresAt };
  }

  // POST /api/offers/:id/share-link — neuen Link erzeugen (ersetzt frühere aktive Links)
  app.post(
    "/api/offers/:id/share-link",
    requireAuth,
    requireManageOffers,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const tenantId = (req as any).tenantId;
        const bodySchema = z.object({
          expiresInDays: z.number().int().min(1).max(365).optional(),
        });
        const parsed = bodySchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültige Parameter" });
        }
        const days = parsed.data.expiresInDays ?? 30;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
        const client = new B2BSellersClient(settings, { statusMapping });
        await client.fetchOfferById(id);

        const { token, publicUrl, expiresAt } = await createFreshOfferPublicLink(req, id, days);

        res.json({
          token,
          publicUrl,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error: any) {
        console.error("Error creating offer share link:", error);
        res.status(500).json({ error: error.message || "Failed to create share link" });
      }
    }
  );

  // DELETE /api/offers/:id/share-link — alle öffentlichen Links zu diesem Angebot widerrufen
  app.delete(
    "/api/offers/:id/share-link",
    requireAuth,
    requireManageOffers,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        await storage.revokeOfferPublicLinksForOffer(id, (req as any).tenantId);
        res.json({ success: true });
      } catch (error: any) {
        console.error("Error revoking offer share link:", error);
        res.status(500).json({ error: error.message || "Failed to revoke share link" });
      }
    }
  );

  // POST /api/offers/:id/send-email — Angebot per E-Mail an den Kunden senden: PDF im Anhang
  // (dieselbe Erzeugung wie "PDF herunterladen") + Link auf die öffentliche Angebotsseite
  // (erzeugt dabei einen frischen Link, der frühere aktive Links für dieses Angebot ersetzt).
  app.post(
    "/api/offers/:id/send-email",
    // requireAuthOrIntegrationKey setzt bei verifiziertem Integration-Key req.integrationKeyAuth,
    // wodurch requireCsrf fuer diesen Server-zu-Server-Pfad uebersprungen wird — Browser-Session-
    // Aufrufe bleiben voll CSRF-geschuetzt (Double-Submit-Token wie ueberall).
    requireAuthOrIntegrationKey,
    requireManageOffers,
    requireCsrf,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const tenantId = (req as any).tenantId;
        const bodySchema = z.object({
          to: z.string().email().optional(),
          message: z.string().max(2000).optional(),
        });
        const parsed = bodySchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ error: "Ungültige Parameter (E-Mail-Adresse prüfen)" });
        }

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }
        const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
        const client = new B2BSellersClient(settings, { statusMapping });
        const rawOffer = await client.fetchOfferById(id);
        const mapped = client.mapOffer(rawOffer.data, undefined, rawOffer.included);

        const to = parsed.data.to?.trim() || mapped.customerEmail?.trim();
        if (!to) {
          return res.status(400).json({
            error: "Keine E-Mail-Adresse verfügbar — bitte manuell angeben.",
          });
        }

        // Frischer öffentlicher Link (widerruft ggf. zuvor an den Kunden verschickte Links).
        const { linkId, publicUrl } = await createFreshOfferPublicLink(req, id, 30);

        // Dasselbe Angebots-PDF wie beim manuellen "PDF herunterladen".
        const configInput = await buildOfferConfigPdfInputWithCpqFallback(
          storage,
          id,
          tenantId,
          rawOffer.data,
          mapped,
          settings
        );
        const pdfBuilderInput =
          configInput ?? (await buildPlainOfferPdfInput(rawOffer.data, mapped, settings, tenantId));
        await enrichOfferConfigPdfInputWithTexts(storage, pdfBuilderInput, mapped.items || [], tenantId ?? null);
        await attachRoomPlanToPdfInput(storage, pdfBuilderInput, id, tenantId ?? null);
        const pdfInput = applyOfferConfigPdfLayoutFromRequest(pdfBuilderInput, {});
        const pdfBuffer = await generateOfferConfigPdf(pdfInput);
        const safeName = `angebot-${mapped.offerNumber || id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

        const personalMessage = parsed.data.message?.trim();
        const greeting = mapped.customerName ? `Sehr geehrte Damen und Herren von ${mapped.customerName},` : "Sehr geehrte Damen und Herren,";
        const textLines = [
          greeting,
          "",
          `anbei erhalten Sie unser Angebot ${mapped.offerNumber} als PDF.`,
          "",
          "Sie können das Angebot auch online ansehen und direkt annehmen oder ablehnen:",
          publicUrl,
        ];
        if (personalMessage) textLines.push("", personalMessage);
        textLines.push("", "Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.", "", "Mit freundlichen Grüßen", "Ihr META-Team");
        const text = textLines.join("\n");

        const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const html = `
          <p>${escapeHtml(greeting)}</p>
          <p>anbei erhalten Sie unser Angebot <strong>${escapeHtml(mapped.offerNumber)}</strong> als PDF.</p>
          <p>Sie können das Angebot auch online ansehen und direkt annehmen oder ablehnen:<br/>
          <a href="${publicUrl}">${publicUrl}</a></p>
          ${personalMessage ? `<p>${escapeHtml(personalMessage).replace(/\n/g, "<br/>")}</p>` : ""}
          <p>Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.</p>
          <p>Mit freundlichen Grüßen<br/>Ihr META-Team</p>
        `;

        await sendEmail(storage, {
          to,
          subject: `Ihr Angebot ${mapped.offerNumber}`,
          text,
          html,
          attachments: [{ filename: `${safeName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
        });

        try {
          await storage.createOfferPublicEvent(
            { linkId, eventType: "email_sent", ip: null, meta: { to } },
            tenantId ?? null
          );
        } catch {
          /* Audit-Log ist optional, darf den Versand nicht rückwirkend als fehlgeschlagen melden */
        }

        res.json({ success: true, sentTo: to, publicUrl });
      } catch (error: any) {
        console.error("Error sending offer email:", error);
        res.status(500).json({ error: error.message || "Angebot konnte nicht per E-Mail versendet werden" });
      }
    }
  );

  // PATCH /api/offers/:id - Update offer details
  app.patch("/api/offers/:id", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updateSchema = z.object({
        status: z.string().optional(),
        customerName: z.string().optional(),
        customerEmail: z.string().email().optional(),
        offerNumber: z.string().optional(),
        expirationDate: z.string().nullable().optional(),
        totalPrice: z.number().optional(),
        netPrice: z.number().optional(),
      });

      const validated = updateSchema.parse(req.body);
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.updateOffer(id, validated);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating offer:", error);
      res.status(500).json({ error: error.message || "Failed to update offer" });
    }
  });

  // GET /api/offers/:id/service-catalog - alle Zusatzleistungs-Artikel (Montage, Mitnahmestapler, Ladebordwand, Fixtermin, ...) liefern
  app.get("/api/offers/:id/service-catalog", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { listOfferServiceProducts } = await import("../offers/montageLineItem");
      const services = await listOfferServiceProducts(storage, req.tenantId ?? null);
      res.json({ services });
    } catch (error: any) {
      console.error("Error listing offer service products:", error);
      res.status(500).json({ error: error.message || "Zusatzleistungen konnten nicht geladen werden" });
    }
  });

  // POST /api/offers/:id/service-line-item - einen Zusatzleistungs-Artikel als echte Position hinzufügen
  app.post("/api/offers/:id/service-line-item", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        productNumber: z.string().min(1),
        unitPriceNet: z.number().min(0),
        quantity: z.number().int().min(1).max(20).optional(),
      });
      const { productNumber, unitPriceNet, quantity } = bodySchema.parse(req.body);
      const { addServiceLineItemToOffer } = await import("../offers/montageLineItem");
      await addServiceLineItemToOffer(storage, req.tenantId ?? null, id, productNumber, unitPriceNet, quantity ?? 1);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error adding service line item:", error);
      res.status(500).json({ error: error.message || "Position konnte nicht hinzugefügt werden" });
    }
  });

  // GET /api/offers/:id/montage-suggestion - berechneten Montagepreis-Vorschlag für ein Angebot liefern
  app.get("/api/offers/:id/montage-suggestion", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { computeOfferMontageSuggestion } = await import("../offers/montageLineItem");
      const suggestion = await computeOfferMontageSuggestion(storage, req.tenantId ?? null, id);
      res.json(suggestion);
    } catch (error: any) {
      console.error("Error computing montage suggestion:", error);
      res.status(500).json({ error: error.message || "Montage-Berechnung fehlgeschlagen" });
    }
  });

  // POST /api/offers/:id/montage-line-item - Montagekosten als echte Position zum Angebot hinzufügen
  app.post("/api/offers/:id/montage-line-item", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        unitPriceNet: z.number().min(0),
        quantity: z.number().int().min(1).max(20).optional(),
      });
      const { unitPriceNet, quantity } = bodySchema.parse(req.body);
      const { addMontageLineItemToOffer } = await import("../offers/montageLineItem");
      await addMontageLineItemToOffer(storage, req.tenantId ?? null, id, unitPriceNet, quantity ?? 1);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error adding montage line item:", error);
      res.status(500).json({ error: error.message || "Montageposition konnte nicht hinzugefügt werden" });
    }
  });

  // DELETE /api/offers/:id/line-items/:itemId - eine einzelne Position aus einem Angebot entfernen
  app.delete("/api/offers/:id/line-items/:itemId", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id, itemId } = req.params;
      const settings = await storage.getShopwareSettings(req.tenantId ?? null);
      if (!settings) {
        return res.status(400).json({ error: "Shopware-Einstellungen nicht konfiguriert" });
      }
      const statusMapping = await storage.getSetting("b2b.offerStatusMapping", req.tenantId ?? null);
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.removeOfferLineItem(id, itemId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing offer line item:", error);
      res.status(500).json({ error: error.message || "Position konnte nicht entfernt werden" });
    }
  });

  // GET /api/offers/:id/room-layout - Raum-Layout (falls vorhanden) + Grundrisse aller
  // Konfigurationen des Angebots liefern, damit der Raumplaner sie platzieren kann
  app.get("/api/offers/:id/room-layout", requireAuth, requireManageOffers, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { buildOfferDetailJson } = await import("../offers/offerDetailBuilder");
      const { computeFootprintFromCpqConfig } = await import("../cpq/cpqRoomPlanner");
      const { loadRoomPlannerSettings } = await import("../cpq/roomPlannerSettings");

      const [detail, layout, plannerSettings] = await Promise.all([
        buildOfferDetailJson(storage, id, req.tenantId ?? null),
        storage.getCpqRoomLayoutByOfferId(id, req.tenantId ?? null),
        loadRoomPlannerSettings(storage, req.tenantId ?? null),
      ]);

      const configurations: Array<{ configKey: string; name: string; footprint: NonNullable<ReturnType<typeof computeFootprintFromCpqConfig>> }> = [];
      for (const li of detail.lineItems) {
        if (!li.isConfigurationGroup || !li.cpqConfig) continue;
        const footprint = computeFootprintFromCpqConfig(li.cpqConfig);
        if (footprint) configurations.push({ configKey: li.id, name: li.label, footprint });
      }

      res.json({
        layout: layout ?? null,
        defaultMinSpacingMm: plannerSettings.defaultMinSpacingMm,
        configurations,
      });
    } catch (error: any) {
      console.error("Error loading room layout:", error);
      res.status(500).json({ error: error.message || "Raum-Layout konnte nicht geladen werden" });
    }
  });

  // PUT /api/offers/:id/room-layout - Raum-Layout speichern (mit Server-seitiger Kollisionsprüfung)
  app.put("/api/offers/:id/room-layout", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const bodySchema = z.object({
        name: z.string().max(200).optional().nullable(),
        lengthMm: z.number().int().min(100).max(200000),
        widthMm: z.number().int().min(100).max(200000),
        heightMm: z.number().int().min(100).max(50000),
        minSpacingMm: z.number().int().min(0).max(10000).optional().nullable(),
        /** Bediengang vor der Regal-Vorderseite; null = Mindestabstand gilt ringsum. */
        frontClearanceMm: z.number().int().min(0).max(10000).optional().nullable(),
        placements: z.array(
          z.object({
            configKey: z.string().min(1),
            xMm: z.number().int(),
            yMm: z.number().int(),
            rotationDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
          }),
        ),
        wallFeatures: z
          .array(
            z.object({
              id: z.string().min(1),
              wall: z.enum(["north", "south", "east", "west"]),
              type: z.enum(["door", "window", "gate"]),
              offsetMm: z.number().int().min(0),
              widthMm: z.number().int().min(1).max(20000),
            }),
          )
          .optional(),
        previewImageBase64: z
          .string()
          .max(4_000_000)
          .regex(/^data:image\/\w+;base64,/)
          .optional()
          .nullable(),
      });
      const data = bodySchema.parse(req.body);

      // Stilisierte Wandelemente dürfen nicht über die Wandlänge hinausragen — sonst keine
      // Prüfung (keine Kollision mit Regalen, nur zur Visualisierung der Raumöffnungen).
      const wallLengthFor = (wall: "north" | "south" | "east" | "west") =>
        wall === "north" || wall === "south" ? data.lengthMm : data.widthMm;
      const wallFeatureErrors: string[] = [];
      for (const f of data.wallFeatures ?? []) {
        if (f.offsetMm + f.widthMm > wallLengthFor(f.wall)) {
          wallFeatureErrors.push(`Element ragt über die Wand hinaus (${f.wall}).`);
        }
      }
      if (wallFeatureErrors.length > 0) {
        return res.status(400).json({ error: "Ungültige Wandelemente", wallFeatureErrors });
      }

      const { buildOfferDetailJson } = await import("../offers/offerDetailBuilder");
      const { computeFootprintFromCpqConfig, validateRoomPlacements } = await import("../cpq/cpqRoomPlanner");
      const { loadRoomPlannerSettings } = await import("../cpq/roomPlannerSettings");

      const [detail, plannerSettings] = await Promise.all([
        buildOfferDetailJson(storage, id, req.tenantId ?? null),
        loadRoomPlannerSettings(storage, req.tenantId ?? null),
      ]);

      const footprintsByConfigKey = new Map<string, ReturnType<typeof computeFootprintFromCpqConfig>>();
      for (const li of detail.lineItems) {
        if (!li.isConfigurationGroup || !li.cpqConfig) continue;
        const footprint = computeFootprintFromCpqConfig(li.cpqConfig);
        if (footprint) footprintsByConfigKey.set(li.id, footprint);
      }

      const minSpacingMm = data.minSpacingMm ?? plannerSettings.defaultMinSpacingMm;
      const violations = validateRoomPlacements(
        { lengthMm: data.lengthMm, widthMm: data.widthMm },
        data.placements,
        footprintsByConfigKey as Map<string, NonNullable<ReturnType<typeof computeFootprintFromCpqConfig>>>,
        minSpacingMm,
      );
      if (violations.length > 0) {
        return res.status(400).json({ error: "Ungültige Platzierung", violations });
      }

      const saved = await storage.upsertCpqRoomLayout(
        {
          shopwareOfferId: id,
          name: data.name ?? null,
          lengthMm: data.lengthMm,
          widthMm: data.widthMm,
          heightMm: data.heightMm,
          minSpacingMm: data.minSpacingMm ?? null,
          frontClearanceMm: data.frontClearanceMm ?? null,
          placements: data.placements,
          wallFeatures: data.wallFeatures,
          previewImageBase64: data.previewImageBase64,
        },
        req.tenantId ?? null,
      );
      res.json({ layout: saved });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ error: "Ungültige Eingabe", details: error.errors });
      }
      console.error("Error saving room layout:", error);
      res.status(500).json({ error: error.message || "Raum-Layout konnte nicht gespeichert werden" });
    }
  });

  // POST /api/offers/:id/approve
  app.post("/api/offers/:id/approve", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.approveOffer(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error approving offer:", error);
      res.status(500).json({ error: error.message || "Failed to approve offer" });
    }
  });

  // POST /api/offers/:id/reject
  app.post("/api/offers/:id/reject", requireAuth, requireManageOffers, requireCsrf, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
      const client = new B2BSellersClient(settings, { statusMapping });
      await client.rejectOffer(id, reason);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error rejecting offer:", error);
      res.status(500).json({ error: error.message || "Failed to reject offer" });
    }
  });
}
