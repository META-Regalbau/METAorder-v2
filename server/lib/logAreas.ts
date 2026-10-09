import { isLogArea, type LogArea } from "@shared/logAreas";

/**
 * Bereich eines Log-Eintrags fuer das Systemprotokoll:
 * - Modul-Logger: aus `component` (z. B. "shopware/shopwareTokenCache" -> shopware)
 * - API-Anfragen: aus dem Pfad (/api/orders/... -> orders)
 * - sonst aus dem Praefix der Meldung ("[CrossSellLearning] ..."), zuletzt "system"
 * Die Reihenfolge der Regeln zaehlt: die erste passende gewinnt.
 */

type Rule = [RegExp, LogArea];

const COMPONENT_RULES: Rule[] = [
  [/^erp\/shipping\b/, "shipping"],
  [/^routes\/(aiRoutes)$/, "ai"],
  [/^routes\/(analyticsRoutes)$/, "analytics"],
  [/^routes\/(authRoutes|userRoutes)$/, "auth"],
  [/^routes\/crmRoutes$/, "crm"],
  [/^routes\/(crossSellingRoutes|crossSellAutomationRoutes)$/, "crossSelling"],
  [/^routes\/draftRoutes$/, "drafts"],
  [/^routes\/integrationRoutes$/, "integration"],
  [/^routes\/invoicingRoutes$/, "invoicing"],
  [/^routes\/(masterDataRoutes|productRoutes)$/, "products"],
  [/^routes\/offerRoutes$/, "offers"],
  [/^routes\/(orderRoutes|operationsRoutes|routeHelpers)$/, "orders"],
  [/^routes\/settingsRoutes$/, "settings"],
  [/^routes\/ticketRoutes$/, "tickets"],
  [/^routes\/notificationRoutes$/, "system"],
  [/^shopware(\/|-|$)/, "shopware"],
  [/^(commercial|extraction)\//, "drafts"],
  [/^offers\//, "offers"],
  [/^b2b\//, "b2b"],
  [/^crm\//, "crm"],
  [/^(products|pdf)\//, "products"],
  [/^cpq(-core)?\//, "cpq"],
  [/^cross-selling\//, "crossSelling"],
  [/^erp\//, "erp"],
  [/^(invoicing\/|invoice-watcher$)/, "invoicing"],
  [/^email\//, "email"],
  [/^(integration\/|sftp\/|lib\/webhookService$)/, "integration"],
  [/^automation\b/, "automation"],
  [/^tickets\//, "tickets"],
  [/^(ai|semantic)\//, "ai"],
  [/^analytics\//, "analytics"],
  [/^auth\//, "auth"],
];

/** Pfad ohne /api/ -> Bereich */
const PATH_RULES: Rule[] = [
  [/^settings\/(integration-api-keys|n8n-connection|webhooks|sftp-servers|commercial-customer-tokens)\b/, "integration"],
  [/^settings\/(email-inbound|email-outbound|email-routing|m365)\b/, "email"],
  [/^settings\/(ai|ai-prompts|semantic-ranking)\b/, "ai"],
  [/^settings\/(mondu|dunning|invoice-automation|proforma-number-range)\b/, "invoicing"],
  [/^settings\/shopware\b/, "shopware"],
  [/^settings\b/, "settings"],
  [/^erp\/(shipping|shipping-labels|shipping-provider|pick-lists|zebra)\b/, "shipping"],
  [/^erp\/(finance|open-items|payments|supplier-invoices)\b/, "invoicing"],
  [/^(erp|erp-automation)\b/, "erp"],
  [/^(shipping|carriers)\b/, "shipping"],
  [/^(orders|process-updates)\b/, "orders"],
  [/^(offers|public\/offers)\b/, "offers"],
  [/^ai\/cross-selling\b/, "crossSelling"],
  [/^ai\/offers\b/, "offers"],
  [/^(order-drafts|offer-drafts|commercial-drafts|commercial-agent|attachments|parse-email|public\/commercial)\b/, "drafts"],
  [/^(b2b|portal|public\/portal-password-request)\b/, "b2b"],
  [/^crm\b/, "crm"],
  [/^(products|categories|bundles|sales-channels|templates)\b/, "products"],
  [/^cpq(-core)?\b/, "cpq"],
  [/^(cross-selling|cross-selling-rules)\b/, "crossSelling"],
  [/^(accounting|dunning|installment-plans)\b/, "invoicing"],
  [/^(email|m365)\b/, "email"],
  [/^webhooks\b/, "integration"],
  [/^automation-rules\b/, "automation"],
  [/^(tickets|ticket-assignment-rules)\b/, "tickets"],
  [/^(ai|semantic|search)\b/, "ai"],
  [/^(analytics|dashboard)\b/, "analytics"],
  [/^(auth|users|roles|tenants|profile)\b/, "auth"],
];

/** Praefix "[Name]" am Anfang der Meldung (aeltere Log-Texte, log() aus vite.ts) */
const PREFIX_RULES: Rule[] = [
  [/shopware/, "shopware"],
  [/cross-?sell/, "crossSelling"],
  [/offer/, "offers"],
  [/cpq/, "cpq"],
  [/semantic|openai|llm|^ai\b/, "ai"],
  [/dunning|invoice|mondu|faktur/, "invoicing"],
  [/sendcloud|shipping|versand/, "shipping"],
  [/e-?mail|m365/, "email"],
  [/sftp|webhook|n8n/, "integration"],
  [/automation|automatisierung/, "automation"],
  [/erp|stock|lager/, "erp"],
  [/order|bestell/, "orders"],
  [/ticket/, "tickets"],
  [/auth|login|portal-password/, "auth"],
];

const firstMatch = (rules: Rule[], text: string): LogArea | null => {
  for (const [pattern, area] of rules) if (pattern.test(text)) return area;
  return null;
};

export function areaForComponent(component: unknown): LogArea | null {
  return typeof component === "string" && component ? firstMatch(COMPONENT_RULES, component) : null;
}

export function areaForPath(path: unknown): LogArea | null {
  if (typeof path !== "string" || !path.startsWith("/api/")) return null;
  return firstMatch(PATH_RULES, path.slice("/api/".length)) ?? "system";
}

export function areaForMessage(msg: unknown): LogArea | null {
  if (typeof msg !== "string") return null;
  const prefix = /^\s*\[([^\]]{2,40})\]/.exec(msg);
  return prefix ? firstMatch(PREFIX_RULES, prefix[1].toLowerCase()) : null;
}

/** Bereich eines Eintrags: gesetztes Feld, Modul, Pfad, Meldungs-Praefix, sonst "system" */
export function areaForEntry(entry: { area?: unknown; component?: unknown; path?: unknown; msg?: unknown }): LogArea {
  return (
    (isLogArea(entry.area) ? entry.area : null) ??
    areaForComponent(entry.component) ??
    areaForPath(entry.path) ??
    areaForMessage(entry.msg) ??
    "system"
  );
}
