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
import { registerSftpRoutes } from "./sftp/sftpRoutes";
import { registerErpRoutes } from "./erp/erpRoutes";
import { registerErpProductLabelRoutes } from "./erp/erpProductLabels";
import { registerTicketRoutes } from "./routes/ticketRoutes";
import { getSalesChannelFilter } from "./routes/routeHelpers";
import { registerCrmRoutes } from "./routes/crmRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerOrderRoutes } from "./routes/orderRoutes";
import { registerCrossSellingRoutes } from "./routes/crossSellingRoutes";
import { registerProductRoutes } from "./routes/productRoutes";
import { registerDraftRoutes } from "./routes/draftRoutes";
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
 * (publicOffer, commercialAcknowledgement, portalPasswordRequest). Beim Umstellen der Aufrufe hier darauf achten.
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

  // Mahnwesen und Buchhaltungs-Import
  registerInvoicingRoutes(app);

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

  // Produkte inkl. Imports, Shopware-Cross-Selling, Produktcache und Bundles
  registerProductRoutes(app);

  // Cross-Selling: Vorschlaege, Staging, Analytics, Regeln
  registerCrossSellingRoutes(app);

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
  registerSftpRoutes(app);

  const httpServer = createServer(app);

  return httpServer;
}
