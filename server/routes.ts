import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { requireAuth, requireAuthOrIntegrationKey, requireViewCPQ, requireManageCPQ, requireManageCPQDiscountLevels, requireApproveCPQQuotes } from "./auth/auth";
import { objectStorageService } from "./lib/objectStorage";
import { registerCpqRoutes } from "./cpq/cpqRoutes";
import { registerCpqCoreRoutes } from "./cpq-core/cpqCoreRoutes";
import { registerOpenApi } from "./openapi/registerOpenApi";
import { registerPublicOfferRoutes } from "./offers/publicOfferRoutes";
import { registerCommercialAcknowledgementRoutes } from "./commercial/commercialAcknowledgementRoutes";
import { registerPortalPasswordRequestRoutes } from "./b2b/portalPasswordRequestRoutes";
import { registerB2BAdminRoutes } from "./b2b/b2bAdminRoutes";
import { registerPortalRegistrationRoutes } from "./b2b/portalRegistrationRoutes";
import { registerSftpRoutes } from "./sftp/sftpRoutes";
import { registerErpRoutes } from "./erp/erpRoutes";
import { registerErpProductLabelRoutes } from "./erp/erpProductLabels";
import { registerTicketRoutes } from "./routes/ticketRoutes";
import { getSalesChannelFilter } from "./routes/routeHelpers";
import { registerCrmRoutes } from "./routes/crmRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerLogRoutes } from "./routes/logRoutes";
import { registerShopContentRoutes } from "./routes/shopContentRoutes";
import { registerShopWatchRoutes } from "./routes/shopWatchRoutes";
import { registerShopPulseRoutes } from "./routes/shopPulseRoutes";
import { registerShopPulseWeeklyRoutes } from "./routes/shopPulseWeeklyRoutes";
import { registerShopPulseCartRoutes } from "./routes/shopPulseCartRoutes";
import { registerShopPulseGscRoutes } from "./routes/shopPulseGscRoutes";
import { registerShopPulseHandoffRoutes } from "./routes/shopPulseHandoffRoutes";
import { registerShopPulseRegularRoutes } from "./routes/shopPulseRegularRoutes";
import { registerShopPulseSpeedRoutes } from "./routes/shopPulseSpeedRoutes";
import { registerShopPulseMerchantRoutes } from "./routes/shopPulseMerchantRoutes";
import { registerOrderRoutes } from "./routes/orderRoutes";
import { registerMonduRoutes } from "./routes/monduRoutes";
import { registerCrossSellingRoutes } from "./routes/crossSellingRoutes";
import { registerCrossSellAutomationRoutes } from "./routes/crossSellAutomationRoutes";
import { registerProductRoutes } from "./routes/productRoutes";
import { registerProductImageTextRoutes } from "./routes/productImageTextRoutes";
import { registerProductMetaTextRoutes } from "./routes/productMetaTextRoutes";
import { registerDraftRoutes } from "./routes/draftRoutes";
import { registerEmailIntakeRoutes } from "./routes/emailIntakeRoutes";
import { registerPricingDiagnosticsRoutes } from "./routes/pricingDiagnosticsRoutes";
import { registerOrderFieldMappingRoutes } from "./routes/orderFieldMappingRoutes";
import { registerOfferRoutes } from "./routes/offerRoutes";
import { registerAiRoutes } from "./routes/aiRoutes";
import { registerAnalyticsRoutes } from "./routes/analyticsRoutes";
import { registerNotificationRoutes } from "./routes/notificationRoutes";
import { registerAuthRoutes } from "./routes/authRoutes";
import { registerUserRoutes } from "./routes/userRoutes";
import { registerMasterDataRoutes } from "./routes/masterDataRoutes";
import { registerIntegrationRoutes } from "./routes/integrationRoutes";
import { registerInvoicingRoutes } from "./routes/invoicingRoutes";
import { registerOperationsRoutes } from "./routes/operationsRoutes";
import { logger } from "./lib/logger";

const moduleLog = logger.child({ component: "routes" });

/**
 * Registriert alle API-Routen. Die Routen selbst liegen je Bereich in server/routes/*Routes.ts
 * (bzw. in erp/, cpq/, cpq-core/, b2b/, offers/, sftp/, commercial/).
 *
 * Reihenfolge: Express prueft Routen in Registrierungsreihenfolge. Relevant ist das nur innerhalb
 * desselben Pfad-Praefixes (z. B. /api/orders/badge-flags vor /api/orders/:orderId). Mehrere
 * Module teilen sich nur diese Praefixe: /api/settings (settings, sftp, b2bAdmin), /api/auth
 * (auth, integration: M365), /api/b2b (masterData, b2bAdmin), /api/cpq (cpq, integration),
 * /api/order-drafts (draft, sftp), /api/erp (erp, erpProductLabels) und /api/public
 * (publicOffer, commercialAcknowledgement, portalPasswordRequest, shopPulseCart). Beim Umstellen der Aufrufe hier darauf achten.
 */
export async function registerRoutes(app: Express): Promise<Server> {
  registerOpenApi(app, requireAuth);

  // Anmeldung, Sitzung und eigenes Profil
  registerAuthRoutes(app);

  // Benutzer, Rollen und Mandanten
  registerUserRoutes(app);
  
  // CPQ (Configure, Price, Quote) routes
  // requireAuthOrIntegrationKey statt requireAuth: requireAuthOrIntegrationKey faellt ohne
  // Integration-Key-Header transparent auf requireAuth zurueck (kein Verhaltensunterschied fuer
  // bestehende Session-Aufrufe) und erlaubt zusaetzlich Automatisierungs-Clients (z. B. META
  // Agents metaorder-Connector) den Zugriff — die eigentliche Rechteprüfung (requireViewCPQ/
  // requireManageCPQ) greift unveraendert danach.
  registerCpqRoutes(app, { requireAuth: requireAuthOrIntegrationKey, requireViewCPQ, requireManageCPQ, requireManageCPQDiscountLevels, requireApproveCPQQuotes });
  registerCpqCoreRoutes(app, { requireAuth: requireAuthOrIntegrationKey, requireViewCPQ, requireManageCPQ });

  // ERP-Kernmodule (Warenwirtschaft, Einkauf, Retouren, Fibu, Produktion, Versand)
  registerErpRoutes(app);
  registerErpProductLabelRoutes(app);

  // Einstellungen (Shopware, Mondu, E-Mail, KI, Nummernkreise, Mahnwesen, ...)
  registerSettingsRoutes(app);

  // Systemprotokoll (nur Administratoren)
  registerLogRoutes(app);

  // Shop-Inhalte: Shop-Wächter (vor /api/shop-content/:id), Branchenseiten und Startseiten-Abschnitte (nur Administratoren)
  registerShopWatchRoutes(app);
  registerShopContentRoutes(app);
  // Shop-Puls: Meldungen zu Umsatz, Kaufbarkeit, GA4 (nur Administratoren)
  registerShopPulseRoutes(app);
  registerShopPulseWeeklyRoutes(app);
  // Warenkorb-Alarm: Meldungen des Shopware-Plugins (öffentlich, signiert) und Einstellungen
  registerShopPulseCartRoutes(app);
  // Search Console: Einstellungen und KI-Vorschlag für Meta-Texte (nur Administratoren)
  registerShopPulseGscRoutes(app);
  registerShopPulseHandoffRoutes(app);
  registerShopPulseRegularRoutes(app);
  registerShopPulseSpeedRoutes(app);
  registerShopPulseMerchantRoutes(app);

  // Mahnwesen und Buchhaltungs-Import
  registerInvoicingRoutes(app);
  // Mondu an Bestellungen: Zahlung erneut senden, MonduSell anlegen und abgleichen
  registerMonduRoutes(app);

  // Integrationen: E-Mail, M365, Webhooks, oeffentliche CPQ-Anfrage
  registerIntegrationRoutes(app);

  // Auswertungen und Dashboard
  registerAnalyticsRoutes(app);

  // Stammdaten: Verkaufskanaele, Kategorien, globale Suche, B2B-Nachschlagewerte
  registerMasterDataRoutes(app);

  // Bestellungen inkl. Dokumente, Rechnungen, Versand, Mondu und Teilzahlungsplaene
  registerOrderRoutes(app);

  // Betrieb: Versand, Carrier, Prozess-Updates, ERP-Automatisierung, Debug
  registerOperationsRoutes(app);

  // KI-Funktionen und semantische Suche
  registerAiRoutes(app);

  // KI-Entwuerfe: Upload, Bestell-/Angebotsentwuerfe, Commercial Agent
  registerDraftRoutes(app);
  // E-Mail-Eingang über n8n: Einstellungen, Workflow-Konfiguration, Problem-Meldungen
  registerEmailIntakeRoutes(app);
  // Preis-Diagnose je Händler (nur lesend, Admin)
  registerPricingDiagnosticsRoutes(app);
  registerOrderFieldMappingRoutes(app);

  // Produkte inkl. Imports, Shopware-Cross-Selling, Produktcache und Bundles
  registerProductRoutes(app);
  registerProductImageTextRoutes(app);
  registerProductMetaTextRoutes(app);

  // Cross-Selling: Vorschlaege, Staging, Analytics, Regeln
  registerCrossSellingRoutes(app);
  registerCrossSellAutomationRoutes(app);

  // Angebote: Details, PDF/Export, Teilen-Link, Versand, Positionen, Raumplan, Freigabe
  registerOfferRoutes(app);

  // Ticket-Anhaenge: Object Storage (persistent), sonst lokale Platte
  const useObjectStorage = objectStorageService.isConfigured();

  // Tickets, Kundenportal, Vorlagen, Zuweisungs-/Automatisierungsregeln, Anhaenge
  registerTicketRoutes(app, { useObjectStorage });
  
  moduleLog.info(`[Attachments] Storage mode: ${useObjectStorage ? 'Object Storage (persistent)' : 'Local Disk (non-persistent)'}`);

  // CRM: Kunden, individuelle Preise, Zuweisungen, Rabattanfragen
  registerCrmRoutes(app);

  // Benachrichtigungen inkl. Push und SSE-Stream
  registerNotificationRoutes(app);

  registerPublicOfferRoutes(app);
  registerCommercialAcknowledgementRoutes(app, storage);
  registerPortalPasswordRequestRoutes(app);
  registerB2BAdminRoutes(app, { getSalesChannelFilter });
  // Portal-Registrierungen: Anmelde-Mails über n8n, Abgleich, Admin-Mitarbeiter, Postausgang
  registerPortalRegistrationRoutes(app);
  registerSftpRoutes(app);

  const httpServer = createServer(app);

  return httpServer;
}
