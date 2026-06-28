import {
  type User,
  type InsertUser,
  type Role,
  type ShopwareSettings,
  type InsertShopwareSettings,
  type MonduSettings,
  type InsertMonduSettings,
  type ProformaNumberRangeSettings,
  type InsertProformaNumberRangeSettings,
  type DunningSettings,
  type InsertDunningSettings,
  type OrderDunningStatus,
  type InsertOrderDunningStatus,
  type CrossSellingRule,
  type InsertCrossSellingRule,
  type RuleCondition,
  type RuleTargetCriteria,
  type Ticket,
  type InsertTicket,
  type TicketComment,
  type InsertTicketComment,
  type TicketEmailMessage,
  type InsertTicketEmailMessage,
  type TicketAttachment,
  type InsertTicketAttachment,
  type TicketActivityLog,
  type InsertTicketActivityLog,
  type TicketAssignmentRule,
  type InsertTicketAssignmentRule,
  type Notification,
  type InsertNotification,
  type TicketTemplate,
  type InsertTicketTemplate,
  type ProcessUpdate,
  type InsertProcessUpdate,
  type AutomationRule,
  type InsertAutomationRule,
  type AutomationExecution,
  type InsertAutomationExecution,
  type OrderDraft,
  type InsertOrderDraft,
  type OfferDraft,
  type InsertOfferDraft,
  type CommercialAgentExemplar,
  type InsertCommercialAgentExemplar,
  type CommercialProductMatchFeedback,
  type InsertCommercialProductMatchFeedback,
  type Bundle,
  type InsertBundle,
  type BundleItem,
  type BundleItemInput,
  type BundleWithItems,
  type ErpAutomationRun,
  type InsertErpAutomationRun,
  type ShippingCarrier,
  type InsertShippingCarrier,
  type WebhookConfig,
  type InsertWebhookConfig,
  type WebhookLog,
  type InsertWebhookLog,
  type WebhookEventType,
  type CrossSellCooccurrence,
  type InsertCrossSellCooccurrence,
  type AiCrossSellRule,
  type InsertAiCrossSellRule,
  type AiRecommendation,
  type InsertAiRecommendation,
  type AiInsight,
  type InsertAiInsight,
  type InsertCrossSellEvent,
  type CrossSellEventPairStats,
  type CrossSellStagingBatch,
  type InsertCrossSellStagingBatch,
  type CrossSellStagingRule,
  type InsertCrossSellStagingRule,
  type CrossSellStagingSuggestion,
  type InsertCrossSellStagingSuggestion,
  type OfferLearningInsight,
  type InsertOfferLearningInsight,
  type M365Connection,
  type InsertM365Connection,
  type Tenant,
  type InsertTenant,
  type TenantUser,
  type InsertTenantUser,
  type SemanticDocument,
  type InsertSemanticDocument,
  type Customer,
  type InsertCustomer,
  type CustomerInteraction,
  type InsertCustomerInteraction,
  type OrderAssignment,
  type InsertOrderAssignment,
  type DiscountRequest,
  type InsertDiscountRequest,
  type InstallmentPlan,
  type InsertInstallmentPlan,
  type InstallmentInvoice,
  type InsertInstallmentInvoice,
  type OfferPublicLink,
  type InsertOfferPublicLink,
  type OfferPublicEvent,
  type InsertOfferPublicEvent,
  type B2bApprovalLog,
  type InsertB2bApprovalLog,
} from "@shared/schema";
import { createHash, randomBytes, randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

export type InsertRole = Omit<Role, "id">;
export type UpdateUser = {
  username?: string;
  password?: string;
  role?: "employee" | "admin";
  roleId?: string;
  activeTenantId?: string | null;
  salesChannelIds?: string[] | null;
  skills?: string[] | null;
  pushEnabled?: boolean;
  pushSubscription?: any | null;
};

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: UpdateUser): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  
  // Tenants
  getTenant(id: string): Promise<Tenant | undefined>;
  getTenantByName(name: string): Promise<Tenant | undefined>;
  getAllTenants(): Promise<Tenant[]>;
  getTenantsForUser(userId: string): Promise<Tenant[]>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  addUserToTenant(tenantUser: InsertTenantUser): Promise<TenantUser>;

  findTenantIdByIntegrationKeyHash(keyHash: string): Promise<string | null>;
  createTenantIntegrationApiKey(tenantId: string, name: string): Promise<{ id: string; apiKey: string }>;
  listTenantIntegrationApiKeys(
    tenantId: string
  ): Promise<Array<{ id: string; name: string; createdAt: Date }>>;
  deleteTenantIntegrationApiKey(id: string, tenantId: string): Promise<boolean>;
  
  // Roles
  getRole(id: string): Promise<Role | undefined>;
  getAllRoles(): Promise<Role[]>;
  createRole(role: InsertRole): Promise<Role>;
  updateRole(id: string, updates: Partial<InsertRole>): Promise<Role | undefined>;
  deleteRole(id: string): Promise<boolean>;
  
  // Shopware settings
  getShopwareSettings(tenantId?: string | null): Promise<ShopwareSettings | undefined>;
  saveShopwareSettings(settings: InsertShopwareSettings, tenantId?: string | null): Promise<ShopwareSettings>;
  
  // Mondu settings
  getMonduSettings(tenantId?: string | null): Promise<MonduSettings | undefined>;
  saveMonduSettings(settings: InsertMonduSettings, tenantId?: string | null): Promise<MonduSettings>;

  // Proforma number range settings
  getProformaNumberRangeSettings(tenantId?: string | null): Promise<ProformaNumberRangeSettings | undefined>;
  saveProformaNumberRangeSettings(settings: InsertProformaNumberRangeSettings, tenantId?: string | null): Promise<ProformaNumberRangeSettings>;

  // Dunning settings
  getDunningSettings(tenantId?: string | null): Promise<DunningSettings | undefined>;
  saveDunningSettings(settings: InsertDunningSettings, tenantId?: string | null): Promise<DunningSettings>;

  // Dunning status per order
  getOrderDunningStatus(orderId: string, tenantId?: string | null): Promise<OrderDunningStatus | undefined>;
  getOrderDunningStatuses(orderIds: string[], tenantId?: string | null): Promise<OrderDunningStatus[]>;
  upsertOrderDunningStatus(status: InsertOrderDunningStatus, tenantId?: string | null): Promise<OrderDunningStatus>;
  
  // Cross-Selling Rules
  getAllCrossSellingRules(tenantId?: string | null): Promise<CrossSellingRule[]>;
  getCrossSellingRule(id: string, tenantId?: string | null): Promise<CrossSellingRule | undefined>;
  createCrossSellingRule(rule: InsertCrossSellingRule, tenantId?: string | null): Promise<CrossSellingRule>;
  updateCrossSellingRule(id: string, rule: Partial<InsertCrossSellingRule>, tenantId?: string | null): Promise<CrossSellingRule | undefined>;
  deleteCrossSellingRule(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Tickets
  getAllTickets(tenantId?: string | null): Promise<Ticket[]>;
  getTicketsPaginated(limit: number, offset: number, tenantId?: string | null): Promise<{ tickets: Ticket[]; total: number }>;
  getTicket(id: string, tenantId?: string | null): Promise<Ticket | undefined>;
  getTicketsByOrderId(orderId: string, tenantId?: string | null): Promise<Ticket[]>;
  createTicket(ticket: InsertTicket, tenantId?: string | null): Promise<Ticket>;
  updateTicket(id: string, updates: Partial<InsertTicket>, tenantId?: string | null): Promise<Ticket | undefined>;
  deleteTicket(id: string, tenantId?: string | null): Promise<boolean>;

  // CRM - Customers
  getAllCustomers(tenantId?: string | null): Promise<Customer[]>;
  getCustomer(id: string, tenantId?: string | null): Promise<Customer | undefined>;
  getCustomerByEmail(email: string, tenantId?: string | null): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer, tenantId?: string | null): Promise<Customer>;
  updateCustomer(id: string, updates: Partial<InsertCustomer>, tenantId?: string | null): Promise<Customer | undefined>;
  deleteCustomer(id: string, tenantId?: string | null): Promise<boolean>;

  // CRM - Customer Interactions
  getCustomerInteractions(customerId: string, tenantId?: string | null): Promise<CustomerInteraction[]>;
  getRecentCustomerInteractions(limit: number, tenantId?: string | null): Promise<CustomerInteraction[]>;
  createCustomerInteraction(interaction: InsertCustomerInteraction, tenantId?: string | null): Promise<CustomerInteraction>;
  deleteCustomerInteraction(id: string, tenantId?: string | null): Promise<boolean>;

  // CRM - Order Assignments
  getOrderAssignments(tenantId?: string | null): Promise<OrderAssignment[]>;
  getOrderAssignmentsByOrderId(orderId: string, tenantId?: string | null): Promise<OrderAssignment[]>;
  getOrderAssignment(id: string, tenantId?: string | null): Promise<OrderAssignment | undefined>;
  createOrderAssignment(assignment: InsertOrderAssignment, tenantId?: string | null): Promise<OrderAssignment>;
  updateOrderAssignment(id: string, updates: Partial<InsertOrderAssignment>, tenantId?: string | null): Promise<OrderAssignment | undefined>;

  // CRM - Discount Requests
  getDiscountRequests(tenantId?: string | null): Promise<DiscountRequest[]>;
  getDiscountRequestsByTicketId(ticketId: string, tenantId?: string | null): Promise<DiscountRequest[]>;
  getDiscountRequest(id: string, tenantId?: string | null): Promise<DiscountRequest | undefined>;
  createDiscountRequest(request: InsertDiscountRequest, tenantId?: string | null): Promise<DiscountRequest>;
  updateDiscountRequest(id: string, updates: Partial<InsertDiscountRequest>, tenantId?: string | null): Promise<DiscountRequest | undefined>;
  
  // Ticket Comments
  getTicketComments(ticketId: string, tenantId?: string | null): Promise<TicketComment[]>;
  createTicketComment(comment: InsertTicketComment, tenantId?: string | null): Promise<TicketComment>;
  deleteTicketComment(id: string, tenantId?: string | null): Promise<boolean>;

  // Ticket Email Messages (dedupe/threading)
  getTicketEmailMessageByMessageId(messageId: string, tenantId?: string | null): Promise<TicketEmailMessage | undefined>;
  createTicketEmailMessage(message: InsertTicketEmailMessage, tenantId?: string | null): Promise<TicketEmailMessage>;
  getLatestTicketEmailMessage(ticketId: string, tenantId?: string | null): Promise<TicketEmailMessage | undefined>;

  // M365 Connections
  getM365Connections(tenantId?: string | null): Promise<M365Connection[]>;
  getM365Connection(id: string, tenantId?: string | null): Promise<M365Connection | undefined>;
  getM365ConnectionByEmail(email: string, tenantId?: string | null): Promise<M365Connection | undefined>;
  createM365Connection(connection: InsertM365Connection, tenantId?: string | null): Promise<M365Connection>;
  updateM365Connection(id: string, updates: Partial<InsertM365Connection>, tenantId?: string | null): Promise<M365Connection | undefined>;
  deleteM365Connection(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Ticket Attachments
  getTicketAttachments(ticketId: string, tenantId?: string | null): Promise<TicketAttachment[]>;
  getTicketAttachment(id: string, tenantId?: string | null): Promise<TicketAttachment | undefined>;
  createTicketAttachment(attachment: InsertTicketAttachment, tenantId?: string | null): Promise<TicketAttachment>;
  deleteTicketAttachment(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Ticket Views (Read/Unread tracking)
  markTicketCommentsAsRead(ticketId: string, userId: string, tenantId?: string | null): Promise<void>;
  markTicketAttachmentsAsRead(ticketId: string, userId: string, tenantId?: string | null): Promise<void>;
  getUnreadCounts(ticketId: string, userId: string, tenantId?: string | null): Promise<{ unreadComments: number; unreadAttachments: number }>;
  
  // Ticket Activity Log
  getTicketActivityLog(ticketId: string, tenantId?: string | null): Promise<TicketActivityLog[]>;
  createTicketActivityLog(log: InsertTicketActivityLog, tenantId?: string | null): Promise<TicketActivityLog>;
  
  // Ticket Assignment Rules
  getAllTicketAssignmentRules(tenantId?: string | null): Promise<TicketAssignmentRule[]>;
  getActiveTicketAssignmentRules(tenantId?: string | null): Promise<TicketAssignmentRule[]>;
  getTicketAssignmentRule(id: string, tenantId?: string | null): Promise<TicketAssignmentRule | undefined>;
  createTicketAssignmentRule(rule: InsertTicketAssignmentRule, tenantId?: string | null): Promise<TicketAssignmentRule>;
  updateTicketAssignmentRule(id: string, updates: Partial<InsertTicketAssignmentRule>, tenantId?: string | null): Promise<TicketAssignmentRule | undefined>;
  deleteTicketAssignmentRule(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Notifications
  getNotificationsByUserId(userId: string, limit?: number, tenantId?: string | null): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string, tenantId?: string | null): Promise<number>;
  createNotification(notification: InsertNotification, tenantId?: string | null): Promise<Notification>;
  markNotificationAsRead(id: string, tenantId?: string | null): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string, tenantId?: string | null): Promise<number>;
  deleteNotification(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Ticket Templates
  getAllTicketTemplates(tenantId?: string | null): Promise<TicketTemplate[]>;
  getTicketTemplate(id: string, tenantId?: string | null): Promise<TicketTemplate | undefined>;
  createTicketTemplate(template: InsertTicketTemplate, tenantId?: string | null): Promise<TicketTemplate>;
  updateTicketTemplate(id: string, updates: Partial<InsertTicketTemplate>, tenantId?: string | null): Promise<TicketTemplate | undefined>;
  deleteTicketTemplate(id: string, tenantId?: string | null): Promise<boolean>;

  // Process Updates
  getProcessUpdates(tenantId?: string | null): Promise<ProcessUpdate[]>;
  getProcessUpdate(id: string, tenantId?: string | null): Promise<ProcessUpdate | undefined>;
  createProcessUpdate(update: InsertProcessUpdate, tenantId?: string | null): Promise<ProcessUpdate>;
  updateProcessUpdate(id: string, updates: Partial<InsertProcessUpdate>, tenantId?: string | null): Promise<ProcessUpdate | undefined>;
  deleteProcessUpdate(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Settings (generic key-value store for AI settings etc.)
  getSetting(key: string, tenantId?: string | null): Promise<any | undefined>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<void>;

  // AI Cross-Selling learning
  replaceCrossSellCooccurrences(rows: InsertCrossSellCooccurrence[], tenantId?: string | null): Promise<void>;
  getCrossSellCooccurrences(tenantId?: string | null): Promise<CrossSellCooccurrence[]>;
  replaceAiCrossSellRules(rows: InsertAiCrossSellRule[], tenantId?: string | null): Promise<void>;
  getAiCrossSellRules(tenantId?: string | null): Promise<AiCrossSellRule[]>;
  replaceAiRecommendations(rows: InsertAiRecommendation[], tenantId?: string | null): Promise<void>;
  getAiRecommendations(productNumber?: string, limit?: number, tenantId?: string | null): Promise<AiRecommendation[]>;
  replaceAiInsights(rows: InsertAiInsight[], tenantId?: string | null): Promise<void>;
  getAiInsights(tenantId?: string | null): Promise<AiInsight[]>;
  recordCrossSellEvent(row: InsertCrossSellEvent, tenantId?: string | null): Promise<void>;
  getCrossSellEventStats(tenantId: string | null, since: Date): Promise<CrossSellEventPairStats[]>;

  // Cross-Sell Staging
  createCrossSellStagingBatch(
    batch: InsertCrossSellStagingBatch,
    tenantId?: string | null
  ): Promise<CrossSellStagingBatch>;
  getCrossSellStagingBatch(id: string, tenantId?: string | null): Promise<CrossSellStagingBatch | undefined>;
  getLatestCrossSellStagingBatch(tenantId?: string | null): Promise<CrossSellStagingBatch | undefined>;
  getCrossSellStagingRules(batchId: string, tenantId?: string | null): Promise<CrossSellStagingRule[]>;
  getCrossSellStagingSuggestions(batchId: string, tenantId?: string | null): Promise<CrossSellStagingSuggestion[]>;
  replaceCrossSellStagingRules(
    batchId: string,
    rows: InsertCrossSellStagingRule[],
    tenantId?: string | null
  ): Promise<void>;
  replaceCrossSellStagingSuggestions(
    batchId: string,
    rows: InsertCrossSellStagingSuggestion[],
    tenantId?: string | null
  ): Promise<void>;
  replaceCrossSellStagingSuggestionsForSource(
    batchId: string,
    sourceProductNumber: string,
    rows: InsertCrossSellStagingSuggestion[],
    tenantId?: string | null
  ): Promise<void>;
  updateCrossSellStagingRule(
    id: string,
    updates: Partial<InsertCrossSellStagingRule>,
    tenantId?: string | null
  ): Promise<CrossSellStagingRule | undefined>;
  updateCrossSellStagingSuggestion(
    id: string,
    updates: Partial<InsertCrossSellStagingSuggestion>,
    tenantId?: string | null
  ): Promise<CrossSellStagingSuggestion | undefined>;

  // Offer Learning Insights
  replaceOfferLearningInsights(rows: InsertOfferLearningInsight[], tenantId?: string | null): Promise<void>;
  getOfferLearningInsights(tenantId?: string | null): Promise<OfferLearningInsight[]>;
  
  // Automation Rules
  getAllAutomationRules(tenantId?: string | null): Promise<AutomationRule[]>;
  getActiveAutomationRules(tenantId?: string | null): Promise<AutomationRule[]>;
  getAutomationRule(id: string, tenantId?: string | null): Promise<AutomationRule | undefined>;
  createAutomationRule(rule: InsertAutomationRule, tenantId?: string | null): Promise<AutomationRule>;
  updateAutomationRule(id: string, updates: Partial<InsertAutomationRule>, tenantId?: string | null): Promise<AutomationRule | undefined>;
  deleteAutomationRule(id: string, tenantId?: string | null): Promise<boolean>;
  incrementRuleExecutionCount(id: string, tenantId?: string | null): Promise<void>;
  createAutomationExecution(execution: InsertAutomationExecution, tenantId?: string | null): Promise<AutomationExecution>;
  getAutomationExecutions(ruleId: string, limit?: number, tenantId?: string | null): Promise<AutomationExecution[]>;
  
  // Order Drafts (AI-powered order creation)
  getAllOrderDrafts(tenantId?: string | null): Promise<OrderDraft[]>;
  getOrderDraft(id: string, tenantId?: string | null): Promise<OrderDraft | undefined>;
  createOrderDraft(draft: InsertOrderDraft, tenantId?: string | null): Promise<OrderDraft>;
  updateOrderDraft(id: string, updates: Partial<InsertOrderDraft>, tenantId?: string | null): Promise<OrderDraft | undefined>;
  deleteOrderDraft(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Offer Drafts (AI-powered offer/quote creation)
  getAllOfferDrafts(tenantId?: string | null): Promise<OfferDraft[]>;
  getOfferDraft(id: string, tenantId?: string | null): Promise<OfferDraft | undefined>;
  /** Entwurf zu einem bereits erstellten B2B-Angebot (u. a. CPQ config-PDF-Fallback) */
  getOfferDraftByShopwareOfferId(
    shopwareOfferId: string,
    tenantId?: string | null
  ): Promise<OfferDraft | undefined>;
  createOfferDraft(draft: InsertOfferDraft, tenantId?: string | null): Promise<OfferDraft>;
  updateOfferDraft(id: string, updates: Partial<InsertOfferDraft>, tenantId?: string | null): Promise<OfferDraft | undefined>;
  deleteOfferDraft(id: string, tenantId?: string | null): Promise<boolean>;

  // Commercial Agent — Few-Shot-Lernexemplare
  createCommercialAgentExemplar(
    row: InsertCommercialAgentExemplar,
    tenantId?: string | null
  ): Promise<CommercialAgentExemplar>;
  getCommercialAgentExemplarsForPrompt(tenantId: string, limit: number): Promise<CommercialAgentExemplar[]>;
  countCommercialAgentExemplars(tenantId?: string | null): Promise<number>;
  createCommercialProductMatchFeedback(
    rows: InsertCommercialProductMatchFeedback[],
    tenantId?: string | null
  ): Promise<number>;
  getCommercialProductMatchFeedbackByLineKeys(
    lineKeys: string[],
    tenantId?: string | null,
    limit?: number
  ): Promise<CommercialProductMatchFeedback[]>;
  
  // Bundles
  getAllBundles(tenantId?: string | null): Promise<BundleWithItems[]>;
  getBundle(id: string, tenantId?: string | null): Promise<BundleWithItems | undefined>;
  getBundleByMockNumber(mockProductNumber: string, tenantId?: string | null): Promise<Bundle | undefined>;
  createBundle(bundle: InsertBundle, items: BundleItemInput[], tenantId?: string | null): Promise<BundleWithItems>;
  updateBundle(id: string, updates: Partial<InsertBundle>, items: BundleItemInput[] | undefined, tenantId?: string | null): Promise<BundleWithItems | undefined>;
  deleteBundle(id: string, tenantId?: string | null): Promise<boolean>;
  
  // ERP Automation Runs (tracking automated actions triggered by CustomFields)
  getAllErpAutomationRuns(limit?: number, offset?: number, tenantId?: string | null): Promise<ErpAutomationRun[]>;
  getErpAutomationRunsByOrderId(orderId: string, tenantId?: string | null): Promise<ErpAutomationRun[]>;
  createErpAutomationRun(run: InsertErpAutomationRun, tenantId?: string | null): Promise<ErpAutomationRun>;
  getLatestAutomationRun(orderId: string, trigger: string, tenantId?: string | null): Promise<ErpAutomationRun | undefined>;
  
  // Shipping Carriers
  getAllShippingCarriers(tenantId?: string | null): Promise<ShippingCarrier[]>;
  createShippingCarrier(carrier: InsertShippingCarrier, tenantId?: string | null): Promise<ShippingCarrier>;
  deleteShippingCarrier(id: number, tenantId?: string | null): Promise<boolean>;
  
  // Webhook Configuration
  getAllWebhookConfigs(tenantId?: string | null): Promise<WebhookConfig[]>;
  getWebhookConfig(eventType: WebhookEventType, tenantId?: string | null): Promise<WebhookConfig | undefined>;
  upsertWebhookConfig(config: InsertWebhookConfig, tenantId?: string | null): Promise<WebhookConfig>;
  updateWebhookConfig(eventType: WebhookEventType, updates: Partial<InsertWebhookConfig>, tenantId?: string | null): Promise<WebhookConfig | undefined>;
  
  // Webhook Logs
  createWebhookLog(log: InsertWebhookLog, tenantId?: string | null): Promise<WebhookLog>;
  getWebhookLogs(filters?: { eventType?: string; status?: string; limit?: number; offset?: number }, tenantId?: string | null): Promise<{ logs: WebhookLog[]; total: number }>;
  getWebhookLogsByRequestId(requestId: string, tenantId?: string | null): Promise<WebhookLog[]>;
  cleanupOldWebhookLogs(retentionDays: number, tenantId?: string | null): Promise<number>;

  // Semantic Documents
  upsertSemanticDocuments(rows: InsertSemanticDocument[], tenantId?: string | null): Promise<void>;
  deleteSemanticDocumentsBySourceTypes(sourceTypes: string[], tenantId?: string | null): Promise<number>;
  getSemanticDocumentEmbedding(sourceType: string, sourceId: string, tenantId?: string | null): Promise<number[] | null>;
  searchSemanticDocuments(
    queryEmbedding: number[],
    options: { limit: number; sourceTypes?: string[]; query?: string },
    tenantId?: string | null
  ): Promise<Array<SemanticDocument & { distance: number; textRank: number }>>;

  // Installment plans (Teilzahlung)
  createInstallmentPlanWithInvoices(
    plan: InsertInstallmentPlan,
    invoices: Array<Omit<InsertInstallmentInvoice, "installmentPlanId" | "tenantId">>,
    tenantId?: string | null
  ): Promise<{ plan: InstallmentPlan; invoices: InstallmentInvoice[] }>;
  getInstallmentPlan(id: string, tenantId?: string | null): Promise<InstallmentPlan | undefined>;
  getInstallmentPlansByOrder(orderId: string, tenantId?: string | null): Promise<InstallmentPlan[]>;
  updateInstallmentPlan(
    id: string,
    updates: Partial<InsertInstallmentPlan>,
    tenantId?: string | null
  ): Promise<InstallmentPlan | undefined>;
  deleteInstallmentPlan(id: string, tenantId?: string | null): Promise<boolean>;
  getInstallmentInvoices(planId: string, tenantId?: string | null): Promise<InstallmentInvoice[]>;
  updateInstallmentInvoice(
    id: string,
    updates: Partial<InsertInstallmentInvoice>,
    tenantId?: string | null
  ): Promise<InstallmentInvoice | undefined>;

  // Öffentliche Angebots-Links (Kunden-Landingpage)
  createOfferPublicLink(
    row: Omit<InsertOfferPublicLink, "id" | "createdAt">,
    tenantId?: string | null
  ): Promise<OfferPublicLink>;
  revokeOfferPublicLinksForOffer(shopwareOfferId: string, tenantId?: string | null): Promise<void>;
  getOfferPublicLinkByTokenHash(tokenHash: string): Promise<OfferPublicLink | undefined>;
  getActiveOfferPublicLinkForOffer(
    shopwareOfferId: string,
    tenantId?: string | null
  ): Promise<OfferPublicLink | undefined>;
  touchOfferPublicLinkAccess(linkId: string): Promise<void>;
  createOfferPublicEvent(
    row: Omit<InsertOfferPublicEvent, "id" | "createdAt">,
    tenantId?: string | null
  ): Promise<OfferPublicEvent>;

  createB2bApprovalLog(
    row: Omit<InsertB2bApprovalLog, "id" | "createdAt">,
    tenantId?: string | null
  ): Promise<B2bApprovalLog>;
  listB2bApprovalLogs(
    tenantId?: string | null,
    options?: { limit?: number }
  ): Promise<B2bApprovalLog[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private roles: Map<string, Role>;
  private tenants: Map<string, Tenant>;
  private tenantUsers: TenantUser[];
  private tenantIntegrationKeyRows: Array<{
    id: string;
    tenantId: string;
    keyHash: string;
    name: string;
    createdAt: Date;
  }>;
  private shopwareSettings: ShopwareSettings | undefined;
  private crossSellingRules: Map<string, CrossSellingRule>;
  private crossSellStagingBatches: Map<string, CrossSellStagingBatch>;
  private crossSellStagingRules: Map<string, CrossSellStagingRule>;
  private crossSellStagingSuggestions: Map<string, CrossSellStagingSuggestion>;
  /** In-Memory Cross-Sell-Events (Tests / MemStorage). */
  private crossSellEventRows: Array<InsertCrossSellEvent & { createdAt: Date }>;
  private tickets: Map<string, Ticket>;
  private ticketComments: Map<string, TicketComment>;
  private ticketEmailMessages: Map<string, TicketEmailMessage>;
  private ticketAttachments: Map<string, TicketAttachment>;
  private customers: Map<string, Customer>;
  private customerInteractions: Map<string, CustomerInteraction>;
  private orderAssignments: Map<string, OrderAssignment>;
  private discountRequests: Map<string, DiscountRequest>;
  private m365Connections: Map<string, M365Connection>;
  private ticketActivityLogs: Map<string, TicketActivityLog>;
  private ticketAssignmentRules: Map<string, TicketAssignmentRule>;
  private notifications: Map<string, Notification>;
  private ticketCounter: number;
  private semanticDocuments: SemanticDocument[];
  private dunningSettings?: DunningSettings;
  private orderDunningStatus: Map<string, OrderDunningStatus>;
  private monduSettings?: MonduSettings;
  private proformaNumberRangeSettings?: ProformaNumberRangeSettings;
  private erpAutomationRuns: ErpAutomationRun[];
  private shippingCarriers: ShippingCarrier[];
  private installmentPlansMap: Map<string, InstallmentPlan>;
  private installmentInvoicesMap: Map<string, InstallmentInvoice[]>;
  private commercialAgentExemplars: CommercialAgentExemplar[];
  private commercialProductMatchFeedbackRows: CommercialProductMatchFeedback[];
  private offerPublicLinksMap: Map<string, OfferPublicLink>;
  private offerPublicEvents: OfferPublicEvent[];

  constructor() {
    this.users = new Map();
    this.roles = new Map();
    this.tenants = new Map();
    this.tenantUsers = [];
    this.tenantIntegrationKeyRows = [];
    this.shopwareSettings = undefined;
    this.crossSellingRules = new Map();
    this.crossSellStagingBatches = new Map();
    this.crossSellStagingRules = new Map();
    this.crossSellStagingSuggestions = new Map();
    this.crossSellEventRows = [];
    this.tickets = new Map();
    this.ticketComments = new Map();
    this.ticketEmailMessages = new Map();
    this.ticketAttachments = new Map();
    this.customers = new Map();
    this.customerInteractions = new Map();
    this.orderAssignments = new Map();
    this.discountRequests = new Map();
    this.m365Connections = new Map();
    this.ticketActivityLogs = new Map();
    this.ticketAssignmentRules = new Map();
    this.notifications = new Map();
    this.ticketCounter = 1000;
    this.semanticDocuments = [];
    this.dunningSettings = undefined;
    this.orderDunningStatus = new Map();
    this.monduSettings = undefined;
    this.proformaNumberRangeSettings = undefined;
    this.erpAutomationRuns = [];
    this.shippingCarriers = [];
    this.installmentPlansMap = new Map();
    this.installmentInvoicesMap = new Map();
    this.commercialAgentExemplars = [];
    this.commercialProductMatchFeedbackRows = [];
    this.offerPublicLinksMap = new Map();
    this.offerPublicEvents = [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id, 
      role: "employee", 
      roleId: null, 
      salesChannelIds: null,
      email: insertUser.email ?? null,
      skills: insertUser.skills ?? null,
      activeTenantId: null,
      pushEnabled: null,
      pushSubscription: null,
    };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: UpdateUser): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updatedUser: User = {
      ...user,
      ...updates,
      activeTenantId: updates.activeTenantId ?? user.activeTenantId ?? null,
      pushEnabled: updates.pushEnabled ?? user.pushEnabled ?? null,
      pushSubscription: updates.pushSubscription ?? user.pushSubscription ?? null,
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    return this.tenants.get(id);
  }

  async getTenantByName(name: string): Promise<Tenant | undefined> {
    return Array.from(this.tenants.values()).find((tenant) => tenant.name === name);
  }

  async getAllTenants(): Promise<Tenant[]> {
    return Array.from(this.tenants.values());
  }

  async getTenantsForUser(userId: string): Promise<Tenant[]> {
    const tenantIds = this.tenantUsers
      .filter((tenantUser) => tenantUser.userId === userId)
      .map((tenantUser) => tenantUser.tenantId);
    return tenantIds
      .map((tenantId) => this.tenants.get(tenantId))
      .filter((tenant): tenant is Tenant => !!tenant);
  }

  async createTenant(tenant: InsertTenant): Promise<Tenant> {
    const id = randomUUID();
    const now = new Date();
    const created: Tenant = {
      id,
      name: tenant.name,
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.set(id, created);
    return created;
  }

  async addUserToTenant(tenantUser: InsertTenantUser): Promise<TenantUser> {
    const created: TenantUser = {
      id: randomUUID(),
      tenantId: tenantUser.tenantId,
      userId: tenantUser.userId,
      createdAt: new Date(),
    };
    this.tenantUsers.push(created);
    return created;
  }

  async findTenantIdByIntegrationKeyHash(keyHash: string): Promise<string | null> {
    const row = this.tenantIntegrationKeyRows.find((r) => r.keyHash === keyHash);
    return row?.tenantId ?? null;
  }

  async createTenantIntegrationApiKey(tenantId: string, name: string): Promise<{ id: string; apiKey: string }> {
    const apiKey = `mo_${randomBytes(32).toString("base64url")}`;
    const keyHash = createHash("sha256").update(apiKey, "utf8").digest("hex");
    const id = randomUUID();
    this.tenantIntegrationKeyRows.push({
      id,
      tenantId,
      keyHash,
      name: name.trim() || "",
      createdAt: new Date(),
    });
    return { id, apiKey };
  }

  async listTenantIntegrationApiKeys(
    tenantId: string
  ): Promise<Array<{ id: string; name: string; createdAt: Date }>> {
    return this.tenantIntegrationKeyRows
      .filter((r) => r.tenantId === tenantId)
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteTenantIntegrationApiKey(id: string, tenantId: string): Promise<boolean> {
    const idx = this.tenantIntegrationKeyRows.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (idx === -1) return false;
    this.tenantIntegrationKeyRows.splice(idx, 1);
    return true;
  }

  async getRole(id: string): Promise<Role | undefined> {
    return this.roles.get(id);
  }

  async getAllRoles(): Promise<Role[]> {
    return Array.from(this.roles.values());
  }

  async createRole(insertRole: InsertRole): Promise<Role> {
    const id = randomUUID();
    const role: Role = { id, ...insertRole };
    this.roles.set(id, role);
    return role;
  }

  async updateRole(id: string, updates: Partial<InsertRole>): Promise<Role | undefined> {
    const role = this.roles.get(id);
    if (!role) return undefined;

    const updatedRole: Role = {
      ...role,
      ...updates,
    };

    this.roles.set(id, updatedRole);
    return updatedRole;
  }

  async deleteRole(id: string): Promise<boolean> {
    return this.roles.delete(id);
  }

  async getShopwareSettings(_tenantId?: string | null): Promise<ShopwareSettings | undefined> {
    return this.shopwareSettings;
  }

  async saveShopwareSettings(settings: InsertShopwareSettings): Promise<ShopwareSettings> {
    this.shopwareSettings = settings;
    return settings;
  }

  async getMonduSettings(): Promise<MonduSettings | undefined> {
    return this.monduSettings;
  }

  async saveMonduSettings(settings: InsertMonduSettings): Promise<MonduSettings> {
    const normalized: MonduSettings = {
      apiKey: settings.apiKey ?? "",
      sandboxMode: settings.sandboxMode ?? true,
    };
    this.monduSettings = normalized;
    return normalized;
  }

  async getProformaNumberRangeSettings(): Promise<ProformaNumberRangeSettings | undefined> {
    return this.proformaNumberRangeSettings;
  }

  async saveProformaNumberRangeSettings(settings: InsertProformaNumberRangeSettings): Promise<ProformaNumberRangeSettings> {
    const normalized: ProformaNumberRangeSettings = {
      prefix: settings.prefix,
      nextNumber: settings.nextNumber,
      padding: settings.padding,
    };
    this.proformaNumberRangeSettings = normalized;
    return normalized;
  }

  async getDunningSettings(): Promise<DunningSettings | undefined> {
    return this.dunningSettings;
  }

  async saveDunningSettings(settings: InsertDunningSettings): Promise<DunningSettings> {
    this.dunningSettings = settings;
    return settings;
  }

  async getOrderDunningStatus(orderId: string): Promise<OrderDunningStatus | undefined> {
    return this.orderDunningStatus.get(orderId);
  }

  async getOrderDunningStatuses(orderIds: string[]): Promise<OrderDunningStatus[]> {
    return orderIds
      .map((orderId) => this.orderDunningStatus.get(orderId))
      .filter((status): status is OrderDunningStatus => Boolean(status));
  }

  async upsertOrderDunningStatus(status: InsertOrderDunningStatus): Promise<OrderDunningStatus> {
    const existing = this.orderDunningStatus.get(status.orderId);
    const next: OrderDunningStatus = {
      id: existing?.id ?? randomUUID(),
      tenantId: existing?.tenantId ?? null,
      orderId: status.orderId,
      stage: status.stage ?? existing?.stage ?? 0,
      lastSentAt: status.lastSentAt ?? existing?.lastSentAt ?? null,
      lastDocumentId: status.lastDocumentId ?? existing?.lastDocumentId ?? null,
      lastPdfUrl: status.lastPdfUrl ?? existing?.lastPdfUrl ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.orderDunningStatus.set(status.orderId, next);
    return next;
  }

  async getAllCrossSellingRules(_tenantId?: string | null): Promise<CrossSellingRule[]> {
    return Array.from(this.crossSellingRules.values());
  }

  async getCrossSellingRule(id: string, _tenantId?: string | null): Promise<CrossSellingRule | undefined> {
    return this.crossSellingRules.get(id);
  }

  async createCrossSellingRule(
    insertRule: InsertCrossSellingRule,
    _tenantId?: string | null
  ): Promise<CrossSellingRule> {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    // Parse JSON strings if needed (from DB), otherwise use directly
    const sourceConditions = typeof insertRule.sourceConditions === 'string' 
      ? JSON.parse(insertRule.sourceConditions)
      : insertRule.sourceConditions;
    
    const targetCriteria = typeof insertRule.targetCriteria === 'string'
      ? JSON.parse(insertRule.targetCriteria)
      : insertRule.targetCriteria;
    
    const rule: CrossSellingRule = {
      id,
      name: insertRule.name,
      description: insertRule.description || undefined,
      active: insertRule.active ?? 1,
      category: insertRule.category ?? undefined,
      sourceConditions,
      targetCriteria,
      createdAt: now,
      updatedAt: now,
    };
    
    this.crossSellingRules.set(id, rule);
    return rule;
  }

  async updateCrossSellingRule(
    id: string,
    updates: Partial<InsertCrossSellingRule>,
    _tenantId?: string | null
  ): Promise<CrossSellingRule | undefined> {
    const existing = this.crossSellingRules.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: CrossSellingRule = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };

    if (updates.name) {
      updated.name = updates.name;
    }
    if (updates.description !== undefined) {
      updated.description = updates.description || undefined;
    }
    if (updates.active !== undefined) {
      updated.active = updates.active;
    }
    if (updates.category !== undefined) {
      updated.category = updates.category ?? undefined;
    }
    if (updates.sourceConditions) {
      updated.sourceConditions = typeof updates.sourceConditions === 'string'
        ? JSON.parse(updates.sourceConditions)
        : updates.sourceConditions;
    }
    if (updates.targetCriteria) {
      updated.targetCriteria = typeof updates.targetCriteria === 'string'
        ? JSON.parse(updates.targetCriteria)
        : updates.targetCriteria;
    }

    this.crossSellingRules.set(id, updated);
    return updated;
  }

  async deleteCrossSellingRule(id: string, _tenantId?: string | null): Promise<boolean> {
    return this.crossSellingRules.delete(id);
  }

  async getAllTickets(): Promise<Ticket[]> {
    return Array.from(this.tickets.values());
  }

  async getTicketsPaginated(limit: number, offset: number): Promise<{ tickets: Ticket[]; total: number }> {
    const allTickets = Array.from(this.tickets.values());
    const total = allTickets.length;
    
    // Sort by createdAt DESC (newest first)
    const sortedTickets = allTickets.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    const tickets = sortedTickets.slice(offset, offset + limit);
    
    return {
      tickets,
      total,
    };
  }

  async getTicket(id: string): Promise<Ticket | undefined> {
    return this.tickets.get(id);
  }

  async getTicketsByOrderId(orderId: string): Promise<Ticket[]> {
    return Array.from(this.tickets.values()).filter(
      (ticket) => ticket.orderId === orderId
    );
  }

  async createTicket(insertTicket: InsertTicket): Promise<Ticket> {
    const id = randomUUID();
    const ticketNumber = `T-${this.ticketCounter++}`;
    const now = new Date();
    
    const ticket: Ticket = {
      id,
      tenantId: insertTicket.tenantId ?? null,
      ticketNumber,
      title: insertTicket.title,
      description: insertTicket.description,
      status: insertTicket.status || "open",
      priority: insertTicket.priority || "normal",
      category: insertTicket.category || "general",
      orderId: insertTicket.orderId || null,
      orderNumber: insertTicket.orderNumber || null,
      assignedToUserId: insertTicket.assignedToUserId || null,
      createdByUserId: insertTicket.createdByUserId || null,
      customerId: insertTicket.customerId || null,
      customerEmail: insertTicket.customerEmail || null,
      customerName: insertTicket.customerName || null,
      dueDate: insertTicket.dueDate || null,
      tags: insertTicket.tags || null,
      emailSubject: insertTicket.emailSubject || null,
      emailFrom: insertTicket.emailFrom || null,
      returnReason: insertTicket.returnReason || null,
      returnItems: insertTicket.returnItems || null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      closedAt: null,
    };
    
    this.tickets.set(id, ticket);
    return ticket;
  }

  async updateTicket(id: string, updates: Partial<InsertTicket>): Promise<Ticket | undefined> {
    const ticket = this.tickets.get(id);
    if (!ticket) return undefined;

    const now = new Date();
    const updatedTicket: Ticket = {
      ...ticket,
      ...updates,
      tenantId: updates.tenantId ?? ticket.tenantId ?? null,
      customerId: updates.customerId ?? ticket.customerId ?? null,
      customerEmail: updates.customerEmail ?? ticket.customerEmail ?? null,
      customerName: updates.customerName ?? ticket.customerName ?? null,
      returnReason: updates.returnReason ?? ticket.returnReason ?? null,
      returnItems: updates.returnItems ?? ticket.returnItems ?? null,
      updatedAt: now,
      resolvedAt: updates.status === "resolved" ? (ticket.resolvedAt || now) : ticket.resolvedAt,
      closedAt: updates.status === "closed" ? (ticket.closedAt || now) : ticket.closedAt,
    };
    
    this.tickets.set(id, updatedTicket);
    return updatedTicket;
  }

  async deleteTicket(id: string): Promise<boolean> {
    return this.tickets.delete(id);
  }

  async getAllCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values());
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customers.get(id);
  }

  async getCustomerByEmail(email: string): Promise<Customer | undefined> {
    return Array.from(this.customers.values()).find(
      (customer) => customer.email.toLowerCase() === email.toLowerCase()
    );
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const id = randomUUID();
    const now = new Date();
    const customer: Customer = {
      id,
      tenantId: insertCustomer.tenantId ?? null,
      externalId: insertCustomer.externalId ?? null,
      name: insertCustomer.name,
      email: insertCustomer.email,
      phone: insertCustomer.phone ?? null,
      company: insertCustomer.company ?? null,
      status: insertCustomer.status ?? "active",
      tags: insertCustomer.tags ?? null,
      notes: insertCustomer.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(id, customer);
    return customer;
  }

  async updateCustomer(id: string, updates: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const existing = this.customers.get(id);
    if (!existing) return undefined;
    const updated: Customer = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.customers.set(id, updated);
    return updated;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    return this.customers.delete(id);
  }

  async getCustomerInteractions(customerId: string): Promise<CustomerInteraction[]> {
    return Array.from(this.customerInteractions.values()).filter(
      (interaction) => interaction.customerId === customerId
    );
  }

  async getRecentCustomerInteractions(limit: number): Promise<CustomerInteraction[]> {
    return Array.from(this.customerInteractions.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async createCustomerInteraction(interaction: InsertCustomerInteraction): Promise<CustomerInteraction> {
    const id = randomUUID();
    const record: CustomerInteraction = {
      id,
      tenantId: interaction.tenantId ?? null,
      customerId: interaction.customerId,
      userId: interaction.userId ?? null,
      interactionType: interaction.interactionType ?? "note",
      subject: interaction.subject ?? null,
      body: interaction.body ?? null,
      createdAt: new Date(),
    };
    this.customerInteractions.set(id, record);
    return record;
  }

  async deleteCustomerInteraction(id: string): Promise<boolean> {
    return this.customerInteractions.delete(id);
  }

  async getOrderAssignments(): Promise<OrderAssignment[]> {
    return Array.from(this.orderAssignments.values());
  }

  async getOrderAssignmentsByOrderId(orderId: string): Promise<OrderAssignment[]> {
    return Array.from(this.orderAssignments.values()).filter(
      (assignment) => assignment.orderId === orderId
    );
  }

  async getOrderAssignment(id: string): Promise<OrderAssignment | undefined> {
    return this.orderAssignments.get(id);
  }

  async createOrderAssignment(assignment: InsertOrderAssignment): Promise<OrderAssignment> {
    const id = randomUUID();
    const now = new Date();
    const record: OrderAssignment = {
      id,
      tenantId: assignment.tenantId ?? null,
      orderId: assignment.orderId,
      orderNumber: assignment.orderNumber,
      requestedByUserId: assignment.requestedByUserId ?? null,
      assignedToUserId: assignment.assignedToUserId ?? null,
      status: assignment.status ?? "requested",
      reason: assignment.reason ?? null,
      approvedByUserId: assignment.approvedByUserId ?? null,
      approvedAt: assignment.approvedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.orderAssignments.set(id, record);
    return record;
  }

  async updateOrderAssignment(id: string, updates: Partial<InsertOrderAssignment>): Promise<OrderAssignment | undefined> {
    const existing = this.orderAssignments.get(id);
    if (!existing) return undefined;
    const updated: OrderAssignment = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.orderAssignments.set(id, updated);
    return updated;
  }

  async getDiscountRequests(): Promise<DiscountRequest[]> {
    return Array.from(this.discountRequests.values());
  }

  async getDiscountRequestsByTicketId(ticketId: string): Promise<DiscountRequest[]> {
    return Array.from(this.discountRequests.values()).filter(
      (request) => request.ticketId === ticketId
    );
  }

  async getDiscountRequest(id: string): Promise<DiscountRequest | undefined> {
    return this.discountRequests.get(id);
  }

  async createDiscountRequest(request: InsertDiscountRequest): Promise<DiscountRequest> {
    const id = randomUUID();
    const now = new Date();
    const record: DiscountRequest = {
      id,
      tenantId: request.tenantId ?? null,
      ticketId: request.ticketId ?? null,
      orderId: request.orderId ?? null,
      orderNumber: request.orderNumber ?? null,
      customerId: request.customerId ?? null,
      customerEmail: request.customerEmail ?? null,
      customerName: request.customerName ?? null,
      requestedByUserId: request.requestedByUserId ?? null,
      discountType: request.discountType ?? "percent",
      discountValue: String(request.discountValue),
      currency: request.currency ?? "EUR",
      reason: request.reason ?? null,
      status: request.status ?? "requested",
      approvedByUserId: request.approvedByUserId ?? null,
      approvedAt: request.approvedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.discountRequests.set(id, record);
    return record;
  }

  async updateDiscountRequest(id: string, updates: Partial<InsertDiscountRequest>): Promise<DiscountRequest | undefined> {
    const existing = this.discountRequests.get(id);
    if (!existing) return undefined;
    const { discountValue: dv, ...restUpdates } = updates;
    const updated: DiscountRequest = {
      ...existing,
      ...restUpdates,
      discountValue: dv !== undefined ? String(dv) : existing.discountValue,
      updatedAt: new Date(),
    };
    this.discountRequests.set(id, updated);
    return updated;
  }

  async getTicketComments(ticketId: string): Promise<TicketComment[]> {
    return Array.from(this.ticketComments.values()).filter(
      (comment) => comment.ticketId === ticketId
    );
  }

  async createTicketComment(insertComment: InsertTicketComment, _tenantId?: string | null): Promise<TicketComment> {
    const id = randomUUID();
    const comment: TicketComment = {
      id,
      tenantId: insertComment.tenantId ?? null,
      ticketId: insertComment.ticketId,
      userId: insertComment.userId ?? null,
      authorType: insertComment.authorType || "user",
      customerId: insertComment.customerId || null,
      customerEmail: insertComment.customerEmail || null,
      customerName: insertComment.customerName || null,
      comment: insertComment.comment,
      isInternal: insertComment.isInternal || 0,
      createdAt: new Date(),
    };
    
    this.ticketComments.set(id, comment);
    return comment;
  }

  async deleteTicketComment(id: string): Promise<boolean> {
    return this.ticketComments.delete(id);
  }

  async getTicketEmailMessageByMessageId(messageId: string): Promise<TicketEmailMessage | undefined> {
    return Array.from(this.ticketEmailMessages.values()).find(
      (message) => message.messageId === messageId
    );
  }

  async createTicketEmailMessage(message: InsertTicketEmailMessage): Promise<TicketEmailMessage> {
    const id = randomUUID();
    const record: TicketEmailMessage = {
      tenantId: message.tenantId ?? null,
      ticketId: message.ticketId ?? null,
      commentId: message.commentId ?? null,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo ?? null,
      references: message.references ?? null,
      direction: message.direction,
      source: message.source,
      subject: message.subject ?? null,
      from: message.from ?? null,
      to: message.to ?? null,
      id,
      createdAt: new Date(),
    };
    this.ticketEmailMessages.set(id, record);
    return record;
  }

  async getLatestTicketEmailMessage(ticketId: string): Promise<TicketEmailMessage | undefined> {
    const messages = Array.from(this.ticketEmailMessages.values()).filter(
      (message) => message.ticketId === ticketId
    );
    return messages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async getM365Connections(): Promise<M365Connection[]> {
    return Array.from(this.m365Connections.values());
  }

  async getM365Connection(id: string): Promise<M365Connection | undefined> {
    return this.m365Connections.get(id);
  }

  async getM365ConnectionByEmail(email: string): Promise<M365Connection | undefined> {
    return Array.from(this.m365Connections.values()).find(
      (connection) => connection.email.toLowerCase() === email.toLowerCase()
    );
  }

  async createM365Connection(connection: InsertM365Connection): Promise<M365Connection> {
    const id = randomUUID();
    const record: M365Connection = {
      tenantId: connection.tenantId,
      email: connection.email,
      userId: connection.userId ?? null,
      scopes: connection.scopes ?? null,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken ?? null,
      expiresAt: connection.expiresAt ?? null,
      lastSyncAt: connection.lastSyncAt ?? null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.m365Connections.set(id, record);
    return record;
  }

  async updateM365Connection(id: string, updates: Partial<InsertM365Connection>): Promise<M365Connection | undefined> {
    const existing = this.m365Connections.get(id);
    if (!existing) return undefined;
    const updated: M365Connection = {
      ...existing,
      ...updates,
      userId: updates.userId ?? existing.userId ?? null,
      scopes: updates.scopes ?? existing.scopes ?? null,
      refreshToken: updates.refreshToken ?? existing.refreshToken ?? null,
      expiresAt: updates.expiresAt ?? existing.expiresAt ?? null,
      lastSyncAt: updates.lastSyncAt ?? existing.lastSyncAt ?? null,
      updatedAt: new Date(),
    };
    this.m365Connections.set(id, updated);
    return updated;
  }

  async deleteM365Connection(id: string): Promise<boolean> {
    return this.m365Connections.delete(id);
  }

  async getTicketAttachments(ticketId: string): Promise<TicketAttachment[]> {
    return Array.from(this.ticketAttachments.values()).filter(
      (attachment) => attachment.ticketId === ticketId
    );
  }

  async getTicketAttachment(id: string): Promise<TicketAttachment | undefined> {
    return this.ticketAttachments.get(id);
  }

  async createTicketAttachment(insertAttachment: InsertTicketAttachment): Promise<TicketAttachment> {
    const id = randomUUID();
    const attachment: TicketAttachment = {
      id,
      ...insertAttachment,
      tenantId: insertAttachment.tenantId ?? null,
      createdAt: new Date(),
    };
    
    this.ticketAttachments.set(id, attachment);
    return attachment;
  }

  async deleteTicketAttachment(id: string): Promise<boolean> {
    return this.ticketAttachments.delete(id);
  }

  async markTicketCommentsAsRead(ticketId: string, userId: string): Promise<void> {
    // Stub implementation - not used in production (using DbStorage)
  }

  async markTicketAttachmentsAsRead(ticketId: string, userId: string): Promise<void> {
    // Stub implementation - not used in production (using DbStorage)
  }

  async getUnreadCounts(ticketId: string, userId: string): Promise<{ unreadComments: number; unreadAttachments: number }> {
    // Stub implementation - not used in production (using DbStorage)
    return { unreadComments: 0, unreadAttachments: 0 };
  }

  async getTicketActivityLog(ticketId: string): Promise<TicketActivityLog[]> {
    return Array.from(this.ticketActivityLogs.values())
      .filter(log => log.ticketId === ticketId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createTicketActivityLog(log: InsertTicketActivityLog): Promise<TicketActivityLog> {
    const newLog: TicketActivityLog = {
      ...log,
      tenantId: log.tenantId ?? null,
      id: randomUUID(),
      fieldName: log.fieldName || null,
      oldValue: log.oldValue || null,
      newValue: log.newValue || null,
      createdAt: new Date(),
    };
    this.ticketActivityLogs.set(newLog.id, newLog);
    return newLog;
  }

  // Ticket Assignment Rules
  async getAllTicketAssignmentRules(): Promise<TicketAssignmentRule[]> {
    return Array.from(this.ticketAssignmentRules.values())
      .sort((a, b) => b.priority - a.priority);
  }

  async getActiveTicketAssignmentRules(): Promise<TicketAssignmentRule[]> {
    return Array.from(this.ticketAssignmentRules.values())
      .filter(rule => rule.active === 1)
      .sort((a, b) => b.priority - a.priority);
  }

  async getTicketAssignmentRule(id: string): Promise<TicketAssignmentRule | undefined> {
    return this.ticketAssignmentRules.get(id);
  }

  async createTicketAssignmentRule(insertRule: InsertTicketAssignmentRule): Promise<TicketAssignmentRule> {
    const id = randomUUID();
    const rule: TicketAssignmentRule = {
      id,
      ...insertRule,
      tenantId: insertRule.tenantId ?? null,
      active: insertRule.active ?? 1,
      priority: insertRule.priority ?? 0,
      conditions: insertRule.conditions ?? null,
      assignToUserId: insertRule.assignToUserId ?? null,
      assignToRoleId: insertRule.assignToRoleId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.ticketAssignmentRules.set(id, rule);
    return rule;
  }

  async updateTicketAssignmentRule(id: string, updates: Partial<InsertTicketAssignmentRule>): Promise<TicketAssignmentRule | undefined> {
    const existing = this.ticketAssignmentRules.get(id);
    if (!existing) return undefined;

    const updated: TicketAssignmentRule = {
      ...existing,
      ...updates,
      tenantId: updates.tenantId ?? existing.tenantId ?? null,
      updatedAt: new Date(),
    };
    this.ticketAssignmentRules.set(id, updated);
    return updated;
  }

  async deleteTicketAssignmentRule(id: string): Promise<boolean> {
    return this.ticketAssignmentRules.delete(id);
  }

  // Notifications
  async getNotificationsByUserId(userId: string, limit?: number): Promise<Notification[]> {
    const userNotifications = Array.from(this.notifications.values())
      .filter(n => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return limit ? userNotifications.slice(0, limit) : userNotifications;
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    return Array.from(this.notifications.values())
      .filter(n => n.userId === userId && n.read === 0)
      .length;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const id = randomUUID();
    const notification: Notification = {
      id,
      ...insertNotification,
      tenantId: insertNotification.tenantId ?? null,
      ticketId: insertNotification.ticketId ?? null,
      ticketNumber: insertNotification.ticketNumber ?? null,
      read: insertNotification.read ?? 0,
      createdAt: new Date(),
    };
    
    this.notifications.set(id, notification);
    return notification;
  }

  async markNotificationAsRead(id: string): Promise<Notification | undefined> {
    const notification = this.notifications.get(id);
    if (!notification) return undefined;

    const updated: Notification = {
      ...notification,
      read: 1,
    };
    this.notifications.set(id, updated);
    return updated;
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    let count = 0;
    const entries = Array.from(this.notifications.entries());
    for (const [id, notification] of entries) {
      if (notification.userId === userId && notification.read === 0) {
        this.notifications.set(id, { ...notification, read: 1 });
        count++;
      }
    }
    return count;
  }

  async deleteNotification(id: string): Promise<boolean> {
    return this.notifications.delete(id);
  }
  
  // Ticket Templates
  async getAllTicketTemplates(): Promise<TicketTemplate[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }
  
  async getTicketTemplate(id: string): Promise<TicketTemplate | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async createTicketTemplate(template: InsertTicketTemplate): Promise<TicketTemplate> {
    // Stub implementation - not used in production (using DbStorage)
    const newTemplate: TicketTemplate = {
      ...template,
      id: randomUUID(),
      tenantId: template.tenantId ?? null,
      category: template.category ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return newTemplate;
  }
  
  async updateTicketTemplate(id: string, updates: Partial<InsertTicketTemplate>): Promise<TicketTemplate | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async deleteTicketTemplate(id: string): Promise<boolean> {
    // Stub implementation - not used in production (using DbStorage)
    return false;
  }

  // Process Updates
  async getProcessUpdates(): Promise<ProcessUpdate[]> {
    return [];
  }

  async getProcessUpdate(_id: string): Promise<ProcessUpdate | undefined> {
    return undefined;
  }

  async createProcessUpdate(update: InsertProcessUpdate): Promise<ProcessUpdate> {
    const now = new Date();
    return {
      ...update,
      id: randomUUID(),
      tenantId: update.tenantId ?? null,
      tags: update.tags ?? null,
      createdByUserId: update.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateProcessUpdate(_id: string, _updates: Partial<InsertProcessUpdate>): Promise<ProcessUpdate | undefined> {
    return undefined;
  }

  async deleteProcessUpdate(_id: string): Promise<boolean> {
    return false;
  }
  
  // Settings
  async getSetting(_key: string, _tenantId?: string | null): Promise<any | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  async saveSetting(_key: string, _value: any, _tenantId?: string | null): Promise<void> {
    // Stub implementation - not used in production (using DbStorage)
  }

  // AI Cross-Selling learning (stub for MemStorage)
  async replaceCrossSellCooccurrences(_rows: InsertCrossSellCooccurrence[]): Promise<void> {}
  async getCrossSellCooccurrences(_tenantId?: string | null): Promise<CrossSellCooccurrence[]> {
    return [];
  }
  async replaceAiCrossSellRules(_rows: InsertAiCrossSellRule[]): Promise<void> {}
  async getAiCrossSellRules(_tenantId?: string | null): Promise<AiCrossSellRule[]> {
    return [];
  }
  async replaceAiRecommendations(_rows: InsertAiRecommendation[]): Promise<void> {}
  async getAiRecommendations(_productNumber?: string, _limit?: number, _tenantId?: string | null): Promise<AiRecommendation[]> {
    return [];
  }
  async replaceAiInsights(_rows: InsertAiInsight[]): Promise<void> {}
  async getAiInsights(_tenantId?: string | null): Promise<AiInsight[]> {
    return [];
  }

  async recordCrossSellEvent(row: InsertCrossSellEvent, tenantId?: string | null): Promise<void> {
    const tid = tenantId ?? row.tenantId ?? null;
    this.crossSellEventRows.push({
      ...row,
      tenantId: tid,
      createdAt: new Date(),
    });
  }

  async getCrossSellEventStats(tenantId: string | null, since: Date): Promise<CrossSellEventPairStats[]> {
    const key = (tid: string | null | undefined, src: string, tgt: string) =>
      `${tid ?? "null"}|${src}|${tgt}`;
    const pairs = new Map<
      string,
      { sourceProductNumber: string; targetProductNumber: string; impressions: number; clicks: number; adds: number; removes: number; returns: number }
    >();
    for (const ev of this.crossSellEventRows) {
      if ((ev.tenantId ?? null) !== tenantId) continue;
      if (ev.createdAt < since) continue;
      const src = (ev.sourceProductNumber || "").trim();
      const tgt = (ev.targetProductNumber || "").trim();
      if (!src || !tgt) continue;
      const k = key(ev.tenantId ?? null, src, tgt);
      let p = pairs.get(k);
      if (!p) {
        p = { sourceProductNumber: src, targetProductNumber: tgt, impressions: 0, clicks: 0, adds: 0, removes: 0, returns: 0 };
        pairs.set(k, p);
      }
      const t = ev.eventType;
      if (t === "product_suggestion_impression" || t === "draft_suggestions_impression") p.impressions += 1;
      else if (t === "product_suggestion_click") p.clicks += 1;
      else if (t === "product_suggestion_add_to_group" || t === "draft_suggestion_add") p.adds += 1;
      else if (t === "product_suggestion_remove") p.removes += 1;
      else if (t === "product_suggestion_return") p.returns += 1;
    }
    return Array.from(pairs.values());
  }

  async createCrossSellStagingBatch(
    batch: InsertCrossSellStagingBatch,
    _tenantId?: string | null
  ): Promise<CrossSellStagingBatch> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const created: CrossSellStagingBatch = {
      id,
      tenantId: batch.tenantId ?? null,
      createdByUserId: batch.createdByUserId ?? null,
      status: (batch.status as CrossSellStagingBatch["status"]) || "draft",
      createdAt: now,
      updatedAt: now,
    };
    this.crossSellStagingBatches.set(id, created);
    return created;
  }

  async getLatestCrossSellStagingBatch(_tenantId?: string | null): Promise<CrossSellStagingBatch | undefined> {
    const batches = Array.from(this.crossSellStagingBatches.values());
    return batches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  async getCrossSellStagingBatch(id: string, _tenantId?: string | null): Promise<CrossSellStagingBatch | undefined> {
    return this.crossSellStagingBatches.get(id);
  }

  async getCrossSellStagingRules(batchId: string, _tenantId?: string | null): Promise<CrossSellStagingRule[]> {
    return Array.from(this.crossSellStagingRules.values()).filter((rule) => rule.batchId === batchId);
  }

  async getCrossSellStagingSuggestions(
    batchId: string,
    _tenantId?: string | null
  ): Promise<CrossSellStagingSuggestion[]> {
    return Array.from(this.crossSellStagingSuggestions.values()).filter(
      (suggestion) => suggestion.batchId === batchId
    );
  }

  async replaceCrossSellStagingRules(
    batchId: string,
    rows: InsertCrossSellStagingRule[],
    _tenantId?: string | null
  ): Promise<void> {
    for (const [id, rule] of this.crossSellStagingRules.entries()) {
      if (rule.batchId === batchId) {
        this.crossSellStagingRules.delete(id);
      }
    }
    const now = new Date().toISOString();
    rows.forEach((row) => {
      const id = row.id ?? randomUUID();
      this.crossSellStagingRules.set(id, {
        id,
        batchId: (row.batchId ?? batchId) as string,
        tenantId: row.tenantId ?? null,
        ruleType: row.ruleType as CrossSellStagingRule["ruleType"],
        name: row.name as string,
        description: row.description ?? null,
        active: row.active ?? 1,
        sourceConditions: row.sourceConditions as RuleCondition[],
        targetCriteria: row.targetCriteria as RuleTargetCriteria[],
        sourceProductNumber: row.sourceProductNumber ?? null,
        targetProductNumber: row.targetProductNumber ?? null,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async replaceCrossSellStagingSuggestions(
    batchId: string,
    rows: InsertCrossSellStagingSuggestion[],
    _tenantId?: string | null
  ): Promise<void> {
    for (const [id, suggestion] of this.crossSellStagingSuggestions.entries()) {
      if (suggestion.batchId === batchId) {
        this.crossSellStagingSuggestions.delete(id);
      }
    }
    const now = new Date().toISOString();
    rows.forEach((row) => {
      const id = row.id ?? randomUUID();
      this.crossSellStagingSuggestions.set(id, {
        id,
        batchId: (row.batchId ?? batchId) as string,
        tenantId: row.tenantId ?? null,
        sourceProductId: row.sourceProductId ?? null,
        sourceProductNumber: row.sourceProductNumber as string,
        targetProductId: row.targetProductId ?? null,
        targetProductNumber: row.targetProductNumber as string,
        active: row.active ?? 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async replaceCrossSellStagingSuggestionsForSource(
    batchId: string,
    sourceProductNumber: string,
    rows: InsertCrossSellStagingSuggestion[],
    _tenantId?: string | null
  ): Promise<void> {
    for (const [id, suggestion] of this.crossSellStagingSuggestions.entries()) {
      if (suggestion.batchId === batchId && suggestion.sourceProductNumber === sourceProductNumber) {
        this.crossSellStagingSuggestions.delete(id);
      }
    }
    const now = new Date().toISOString();
    rows.forEach((row) => {
      const id = row.id ?? randomUUID();
      this.crossSellStagingSuggestions.set(id, {
        id,
        batchId: row.batchId as string,
        tenantId: row.tenantId ?? null,
        sourceProductId: row.sourceProductId ?? null,
        sourceProductNumber: row.sourceProductNumber as string,
        targetProductId: row.targetProductId ?? null,
        targetProductNumber: row.targetProductNumber as string,
        active: row.active ?? 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async updateCrossSellStagingRule(
    id: string,
    updates: Partial<InsertCrossSellStagingRule>,
    _tenantId?: string | null
  ): Promise<CrossSellStagingRule | undefined> {
    const existing = this.crossSellStagingRules.get(id);
    if (!existing) return undefined;
    const updated: CrossSellStagingRule = {
      ...existing,
      ...updates,
      batchId: updates.batchId ?? existing.batchId,
      ruleType: (updates.ruleType as CrossSellStagingRule["ruleType"]) ?? existing.ruleType,
      sourceConditions: (updates.sourceConditions as RuleCondition[]) ?? existing.sourceConditions,
      targetCriteria: (updates.targetCriteria as RuleTargetCriteria[]) ?? existing.targetCriteria,
      createdAt:
        updates.createdAt instanceof Date
          ? updates.createdAt.toISOString()
          : (updates.createdAt as string | undefined) ?? existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.crossSellStagingRules.set(id, updated);
    return updated;
  }

  async updateCrossSellStagingSuggestion(
    id: string,
    updates: Partial<InsertCrossSellStagingSuggestion>,
    _tenantId?: string | null
  ): Promise<CrossSellStagingSuggestion | undefined> {
    const existing = this.crossSellStagingSuggestions.get(id);
    if (!existing) return undefined;
    const updated: CrossSellStagingSuggestion = {
      ...existing,
      ...updates,
      batchId: updates.batchId ?? existing.batchId,
      createdAt:
        updates.createdAt instanceof Date
          ? updates.createdAt.toISOString()
          : (updates.createdAt as string | undefined) ?? existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.crossSellStagingSuggestions.set(id, updated);
    return updated;
  }

  // Offer Learning Insights (stub for MemStorage)
  async replaceOfferLearningInsights(_rows: InsertOfferLearningInsight[], _tenantId?: string | null): Promise<void> {}
  async getOfferLearningInsights(_tenantId?: string | null): Promise<OfferLearningInsight[]> {
    return [];
  }
  
  // Automation Rules
  async getAllAutomationRules(): Promise<AutomationRule[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }
  
  async getActiveAutomationRules(): Promise<AutomationRule[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }
  
  async getAutomationRule(id: string): Promise<AutomationRule | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async createAutomationRule(rule: InsertAutomationRule): Promise<AutomationRule> {
    // Stub implementation - not used in production (using DbStorage)
    const newRule: AutomationRule = {
      ...rule,
      id: randomUUID(),
      tenantId: (rule as Partial<AutomationRule>).tenantId ?? null,
      enabled: rule.enabled ?? 0,
      description: rule.description ?? null,
      schedule: rule.schedule ?? null,
      lastExecutedAt: null,
      executionCount: 0,
      createdByUserId: rule.createdByUserId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      conditions: JSON.stringify(rule.conditions),
      actions: JSON.stringify(rule.actions),
    };
    return newRule;
  }
  
  async updateAutomationRule(id: string, updates: Partial<InsertAutomationRule>): Promise<AutomationRule | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async deleteAutomationRule(id: string): Promise<boolean> {
    // Stub implementation - not used in production (using DbStorage)
    return false;
  }
  
  async incrementRuleExecutionCount(id: string): Promise<void> {
    // Stub implementation - not used in production (using DbStorage)
  }
  
  async createAutomationExecution(execution: any): Promise<any> {
    // Stub implementation - not used in production (using DbStorage)
    return execution;
  }
  
  async getAutomationExecutions(ruleId: string, limit?: number): Promise<any[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }
  
  // Order Drafts
  async getAllOrderDrafts(): Promise<OrderDraft[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }
  
  async getOrderDraft(id: string, _tenantId?: string | null): Promise<OrderDraft | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async createOrderDraft(draft: InsertOrderDraft, _tenantId?: string | null): Promise<OrderDraft> {
    // Stub implementation - not used in production (using DbStorage)
    const newDraft: OrderDraft = {
      ...draft,
      id: randomUUID(),
      status: draft.status ?? "pending",
      tenantId: draft.tenantId ?? null,
      createdByUserId: draft.createdByUserId ?? null,
      originalFilePath: draft.originalFilePath ?? null,
      extractedData: (draft.extractedData as OrderDraft["extractedData"] | null | undefined) ?? null,
      matchingResults: (draft.matchingResults as OrderDraft["matchingResults"] | null | undefined) ?? null,
      shopwareCustomerId: draft.shopwareCustomerId ?? null,
      shopwareOrderId: draft.shopwareOrderId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return newDraft;
  }
  
  async updateOrderDraft(id: string, updates: Partial<InsertOrderDraft>, _tenantId?: string | null): Promise<OrderDraft | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async deleteOrderDraft(id: string): Promise<boolean> {
    // Stub implementation - not used in production (using DbStorage)
    return false;
  }
  
  // Offer Drafts
  async getAllOfferDrafts(): Promise<OfferDraft[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }
  
  async getOfferDraft(id: string, _tenantId?: string | null): Promise<OfferDraft | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  async getOfferDraftByShopwareOfferId(
    _shopwareOfferId: string,
    _tenantId?: string | null
  ): Promise<OfferDraft | undefined> {
    return undefined;
  }
  
  async createOfferDraft(draft: InsertOfferDraft, _tenantId?: string | null): Promise<OfferDraft> {
    // Stub implementation - not used in production (using DbStorage)
    const newDraft: OfferDraft = {
      ...draft,
      id: randomUUID(),
      status: draft.status ?? "pending",
      tenantId: draft.tenantId ?? null,
      createdByUserId: draft.createdByUserId ?? null,
      originalFilePath: draft.originalFilePath ?? null,
      extractedData: (draft.extractedData as OfferDraft["extractedData"] | null | undefined) ?? null,
      matchingResults: (draft.matchingResults as OfferDraft["matchingResults"] | null | undefined) ?? null,
      shopwareCustomerId: draft.shopwareCustomerId ?? null,
      shopwareOfferId: draft.shopwareOfferId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return newDraft;
  }
  
  async updateOfferDraft(id: string, updates: Partial<InsertOfferDraft>, _tenantId?: string | null): Promise<OfferDraft | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }
  
  async deleteOfferDraft(id: string): Promise<boolean> {
    // Stub implementation - not used in production (using DbStorage)
    return false;
  }

  async createCommercialAgentExemplar(
    row: InsertCommercialAgentExemplar,
    _tenantId?: string | null
  ): Promise<CommercialAgentExemplar> {
    const now = new Date();
    const ex: CommercialAgentExemplar = {
      id: randomUUID(),
      tenantId: row.tenantId ?? null,
      sourceKind: row.sourceKind,
      intentLabel: row.intentLabel,
      subjectExcerpt: row.subjectExcerpt ?? null,
      emailExcerpt: row.emailExcerpt ?? null,
      pdfExcerpt: row.pdfExcerpt ?? null,
      signalsJson:
        row.signalsJson != null &&
        typeof row.signalsJson === "object" &&
        !Array.isArray(row.signalsJson)
          ? (row.signalsJson as Record<string, unknown>)
          : null,
      qualityScore: row.qualityScore ?? 1,
      draftKind: row.draftKind ?? null,
      referenceDraftId: row.referenceDraftId ?? null,
      createdAt: now,
    };
    this.commercialAgentExemplars.push(ex);
    const tid = ex.tenantId;
    if (tid) {
      const same = this.commercialAgentExemplars.filter((e) => e.tenantId === tid);
      if (same.length > 250) {
        const sorted = [...same].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
        const drop = sorted.slice(0, same.length - 250).map((e) => e.id);
        this.commercialAgentExemplars = this.commercialAgentExemplars.filter((e) => !drop.includes(e.id));
      }
    }
    return ex;
  }

  async getCommercialAgentExemplarsForPrompt(tenantId: string, limit: number): Promise<CommercialAgentExemplar[]> {
    return this.commercialAgentExemplars
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => {
        const q = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
        if (q !== 0) return q;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, Math.max(1, Math.min(12, limit)));
  }

  async countCommercialAgentExemplars(tenantId?: string | null): Promise<number> {
    if (tenantId) {
      return this.commercialAgentExemplars.filter((e) => e.tenantId === tenantId).length;
    }
    return this.commercialAgentExemplars.length;
  }

  async createCommercialProductMatchFeedback(
    rows: InsertCommercialProductMatchFeedback[],
    tenantId?: string | null
  ): Promise<number> {
    const now = new Date();
    const normalizedTenant = tenantId ?? null;
    let inserted = 0;
    for (const row of rows) {
      if (!row?.lineKey?.trim() || !row?.outcome?.trim()) continue;
      const entity: CommercialProductMatchFeedback = {
        id: randomUUID(),
        tenantId: row.tenantId ?? normalizedTenant,
        draftKind: row.draftKind,
        outcome: row.outcome,
        lineKey: row.lineKey,
        sourceLine: row.sourceLine ?? null,
        sourceIdentifier: row.sourceIdentifier ?? null,
        selectedProductId: row.selectedProductId ?? null,
        selectedIdentifier: row.selectedIdentifier ?? null,
        selectedStrategy: row.selectedStrategy ?? null,
        createdByUserId: row.createdByUserId ?? null,
        createdAt: now,
      };
      this.commercialProductMatchFeedbackRows.push(entity);
      inserted++;
    }
    if (this.commercialProductMatchFeedbackRows.length > 5000) {
      this.commercialProductMatchFeedbackRows = this.commercialProductMatchFeedbackRows
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5000);
    }
    return inserted;
  }

  async getCommercialProductMatchFeedbackByLineKeys(
    lineKeys: string[],
    tenantId?: string | null,
    limit: number = 300
  ): Promise<CommercialProductMatchFeedback[]> {
    const keySet = new Set((lineKeys ?? []).map((k) => k.trim()).filter(Boolean));
    if (keySet.size === 0) return [];
    const normalizedTenant = tenantId ?? null;
    return this.commercialProductMatchFeedbackRows
      .filter((r) => r.tenantId === normalizedTenant && keySet.has(r.lineKey))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(1, Math.min(1000, limit)));
  }

  // Bundles
  async getAllBundles(): Promise<BundleWithItems[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }

  async getBundle(id: string): Promise<BundleWithItems | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  async getBundleByMockNumber(mockProductNumber: string): Promise<Bundle | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  async createBundle(bundle: InsertBundle, items: BundleItemInput[]): Promise<BundleWithItems> {
    // Stub implementation - not used in production (using DbStorage)
    const now = new Date();
    const id = randomUUID();
    return {
      ...bundle,
      id,
      tenantId: null,
      active: bundle.active ?? 1,
      createdByUserId: bundle.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
      items: items.map((item, index) => ({
        ...item,
        id: randomUUID(),
        tenantId: null,
        bundleId: id,
        sortOrder: item.sortOrder ?? index,
        createdAt: now,
        updatedAt: now,
      })),
    } as BundleWithItems;
  }

  async updateBundle(id: string, updates: Partial<InsertBundle>, items?: BundleItemInput[]): Promise<BundleWithItems | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  async deleteBundle(id: string): Promise<boolean> {
    // Stub implementation - not used in production (using DbStorage)
    return false;
  }

  // ERP Automation Runs
  async getAllErpAutomationRuns(limit: number = 100, offset: number = 0): Promise<ErpAutomationRun[]> {
    return this.erpAutomationRuns.slice(offset, offset + limit);
  }

  async getErpAutomationRunsByOrderId(orderId: string): Promise<ErpAutomationRun[]> {
    return this.erpAutomationRuns.filter((run) => run.orderId === orderId);
  }

  async createErpAutomationRun(run: InsertErpAutomationRun): Promise<ErpAutomationRun> {
    const record: ErpAutomationRun = {
      id: randomUUID(),
      tenantId: run.tenantId ?? null,
      orderId: run.orderId,
      orderNumber: (run as Partial<ErpAutomationRun>).orderNumber ?? null,
      trigger: run.trigger,
      action: run.action,
      status: run.status,
      errorMessage: run.errorMessage ?? null,
      metadata: (run.metadata as ErpAutomationRun["metadata"] | null | undefined) ?? null,
      executedAt: new Date(),
    };
    this.erpAutomationRuns.push(record);
    return record;
  }

  async getLatestAutomationRun(orderId: string, trigger: string): Promise<ErpAutomationRun | undefined> {
    return this.erpAutomationRuns
      .filter((run) => run.orderId === orderId && run.trigger === trigger)
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())[0];
  }

  // Shipping Carriers
  async getAllShippingCarriers(): Promise<ShippingCarrier[]> {
    return this.shippingCarriers;
  }

  async createShippingCarrier(carrier: InsertShippingCarrier): Promise<ShippingCarrier> {
    const record: ShippingCarrier = {
      id: this.shippingCarriers.length + 1,
      tenantId: carrier.tenantId ?? null,
      name: carrier.name,
      createdAt: new Date(),
    };
    this.shippingCarriers.push(record);
    return record;
  }

  async deleteShippingCarrier(id: number): Promise<boolean> {
    const before = this.shippingCarriers.length;
    this.shippingCarriers = this.shippingCarriers.filter((carrier) => carrier.id !== id);
    return this.shippingCarriers.length < before;
  }

  // Webhook Configuration
  async getAllWebhookConfigs(): Promise<WebhookConfig[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }

  async getWebhookConfig(eventType: WebhookEventType): Promise<WebhookConfig | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  async upsertWebhookConfig(config: InsertWebhookConfig): Promise<WebhookConfig> {
    // Stub implementation - not used in production (using DbStorage)
    return {
      ...config,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WebhookConfig;
  }

  async updateWebhookConfig(eventType: WebhookEventType, updates: Partial<InsertWebhookConfig>): Promise<WebhookConfig | undefined> {
    // Stub implementation - not used in production (using DbStorage)
    return undefined;
  }

  // Webhook Logs
  async createWebhookLog(log: InsertWebhookLog): Promise<WebhookLog> {
    // Stub implementation - not used in production (using DbStorage)
    return {
      ...log,
      id: randomUUID(),
      executedAt: new Date(),
    } as WebhookLog;
  }

  async getWebhookLogs(filters?: { eventType?: string; status?: string; limit?: number; offset?: number }): Promise<{ logs: WebhookLog[]; total: number }> {
    // Stub implementation - not used in production (using DbStorage)
    return { logs: [], total: 0 };
  }

  async getWebhookLogsByRequestId(requestId: string): Promise<WebhookLog[]> {
    // Stub implementation - not used in production (using DbStorage)
    return [];
  }

  async cleanupOldWebhookLogs(retentionDays: number): Promise<number> {
    // Stub implementation - not used in production (using DbStorage)
    return 0;
  }

  // Semantic Documents
  async upsertSemanticDocuments(rows: InsertSemanticDocument[]): Promise<void> {
    rows.forEach((row) => {
      const index = this.semanticDocuments.findIndex(
        (doc) =>
          doc.sourceType === row.sourceType &&
          doc.sourceId === row.sourceId &&
          doc.tenantId === (row.tenantId ?? null)
      );
      const now = new Date();
      const next: SemanticDocument = {
        id: row.id ?? randomUUID(),
        tenantId: row.tenantId ?? null,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        title: row.title,
        content: row.content,
        metadata: row.metadata ?? null,
        embedding: row.embedding,
        embeddingProvider: row.embeddingProvider ?? "local",
        embeddingModel: row.embeddingModel,
        contentHash: row.contentHash,
        createdAt: row.createdAt ?? now,
        updatedAt: row.updatedAt ?? now,
      };
      if (index >= 0) {
        this.semanticDocuments[index] = next;
      } else {
        this.semanticDocuments.push(next);
      }
    });
  }

  async deleteSemanticDocumentsBySourceTypes(sourceTypes: string[]): Promise<number> {
    const before = this.semanticDocuments.length;
    this.semanticDocuments = this.semanticDocuments.filter(
      (doc) => !sourceTypes.includes(doc.sourceType)
    );
    return before - this.semanticDocuments.length;
  }

  async getSemanticDocumentEmbedding(
    sourceType: string,
    sourceId: string,
    _tenantId?: string | null
  ): Promise<number[] | null> {
    const doc = this.semanticDocuments.find(
      (entry) => entry.sourceType === sourceType && entry.sourceId === sourceId
    );
    return doc?.embedding ?? null;
  }

  async searchSemanticDocuments(
    _queryEmbedding: number[],
    options: { limit: number; sourceTypes?: string[]; query?: string }
  ): Promise<Array<SemanticDocument & { distance: number; textRank: number }>> {
    const filtered = options.sourceTypes?.length
      ? this.semanticDocuments.filter((doc) => options.sourceTypes?.includes(doc.sourceType))
      : this.semanticDocuments;
    return filtered.slice(0, options.limit).map((doc) => ({
      ...doc,
      distance: 0,
      textRank: 0,
    }));
  }

  async createInstallmentPlanWithInvoices(
    plan: InsertInstallmentPlan,
    invoiceRows: Array<Omit<InsertInstallmentInvoice, "installmentPlanId" | "tenantId">>,
    tenantId?: string | null
  ): Promise<{ plan: InstallmentPlan; invoices: InstallmentInvoice[] }> {
    const id = randomUUID();
    const now = new Date();
    const resolvedTenant = plan.tenantId ?? tenantId ?? null;
    const row: InstallmentPlan = {
      id,
      tenantId: resolvedTenant,
      orderId: plan.orderId,
      orderNumber: plan.orderNumber,
      customerName: plan.customerName,
      customerEmail: plan.customerEmail ?? null,
      totalAmount: plan.totalAmount,
      depositAmount: plan.depositAmount,
      depositPercent: plan.depositPercent ?? null,
      depositInvoiceNumber: plan.depositInvoiceNumber ?? null,
      remainingAmount: plan.remainingAmount,
      numberOfInstallments: plan.numberOfInstallments,
      installmentAmount: plan.installmentAmount,
      status: plan.status ?? "draft",
      agreementPdfPath: plan.agreementPdfPath ?? null,
      agreementConfirmedAt: plan.agreementConfirmedAt ?? null,
      agreementConfirmedBy: plan.agreementConfirmedBy ?? null,
      createdBy: plan.createdBy,
      createdAt: plan.createdAt ?? now,
      updatedAt: plan.updatedAt ?? now,
    };
    this.installmentPlansMap.set(id, row);
    const invoices: InstallmentInvoice[] = invoiceRows.map((inv) => {
      const invId = randomUUID();
      const invRow: InstallmentInvoice = {
        id: invId,
        tenantId: row.tenantId,
        installmentPlanId: id,
        type: inv.type,
        sequenceNumber: inv.sequenceNumber,
        invoiceNumber: inv.invoiceNumber ?? null,
        amount: inv.amount,
        dueDate: inv.dueDate ?? null,
        status: inv.status ?? "pending",
        paidAt: inv.paidAt ?? null,
        createdAt: inv.createdAt ?? now,
        updatedAt: inv.updatedAt ?? now,
      };
      return invRow;
    });
    this.installmentInvoicesMap.set(id, invoices);
    return { plan: row, invoices };
  }

  async getInstallmentPlan(id: string, _tenantId?: string | null): Promise<InstallmentPlan | undefined> {
    return this.installmentPlansMap.get(id);
  }

  async getInstallmentPlansByOrder(orderId: string, _tenantId?: string | null): Promise<InstallmentPlan[]> {
    return Array.from(this.installmentPlansMap.values()).filter((p) => p.orderId === orderId);
  }

  async updateInstallmentPlan(
    id: string,
    updates: Partial<InsertInstallmentPlan>,
    _tenantId?: string | null
  ): Promise<InstallmentPlan | undefined> {
    const existing = this.installmentPlansMap.get(id);
    if (!existing) return undefined;
    const next: InstallmentPlan = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.installmentPlansMap.set(id, next);
    return next;
  }

  async deleteInstallmentPlan(id: string, _tenantId?: string | null): Promise<boolean> {
    this.installmentInvoicesMap.delete(id);
    return this.installmentPlansMap.delete(id);
  }

  async getInstallmentInvoices(planId: string, _tenantId?: string | null): Promise<InstallmentInvoice[]> {
    return this.installmentInvoicesMap.get(planId) ?? [];
  }

  async updateInstallmentInvoice(
    id: string,
    updates: Partial<InsertInstallmentInvoice>,
    _tenantId?: string | null
  ): Promise<InstallmentInvoice | undefined> {
    for (const [planId, list] of this.installmentInvoicesMap.entries()) {
      const idx = list.findIndex((i) => i.id === id);
      if (idx >= 0) {
        const next = { ...list[idx], ...updates, updatedAt: new Date() } as InstallmentInvoice;
        const copy = [...list];
        copy[idx] = next;
        this.installmentInvoicesMap.set(planId, copy);
        return next;
      }
    }
    return undefined;
  }

  async createOfferPublicLink(
    row: Omit<InsertOfferPublicLink, "id" | "createdAt">,
    _tenantId?: string | null
  ): Promise<OfferPublicLink> {
    const tid = row.tenantId ?? null;
    const oid = row.shopwareOfferId;
    for (const link of this.offerPublicLinksMap.values()) {
      if (
        link.shopwareOfferId === oid &&
        (link.tenantId ?? null) === tid &&
        !link.revokedAt
      ) {
        this.offerPublicLinksMap.set(link.id, { ...link, revokedAt: new Date() });
      }
    }
    const id = randomUUID();
    const created: OfferPublicLink = {
      id,
      tenantId: row.tenantId ?? null,
      shopwareOfferId: row.shopwareOfferId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
      createdByUserId: row.createdByUserId ?? null,
      createdAt: new Date(),
      lastAccessAt: row.lastAccessAt ?? null,
    };
    this.offerPublicLinksMap.set(id, created);
    return created;
  }

  async revokeOfferPublicLinksForOffer(shopwareOfferId: string, tenantId?: string | null): Promise<void> {
    const tid = tenantId ?? null;
    for (const link of this.offerPublicLinksMap.values()) {
      if (
        link.shopwareOfferId === shopwareOfferId &&
        (link.tenantId ?? null) === tid &&
        !link.revokedAt
      ) {
        this.offerPublicLinksMap.set(link.id, { ...link, revokedAt: new Date() });
      }
    }
  }

  async getOfferPublicLinkByTokenHash(tokenHash: string): Promise<OfferPublicLink | undefined> {
    return Array.from(this.offerPublicLinksMap.values()).find((l) => l.tokenHash === tokenHash);
  }

  async getActiveOfferPublicLinkForOffer(
    shopwareOfferId: string,
    tenantId?: string | null
  ): Promise<OfferPublicLink | undefined> {
    const tid = tenantId ?? null;
    const now = new Date();
    const candidates = Array.from(this.offerPublicLinksMap.values()).filter(
      (l) =>
        l.shopwareOfferId === shopwareOfferId &&
        (l.tenantId ?? null) === tid &&
        !l.revokedAt &&
        l.expiresAt > now,
    );
    candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return candidates[0];
  }

  async touchOfferPublicLinkAccess(linkId: string): Promise<void> {
    const link = this.offerPublicLinksMap.get(linkId);
    if (link) {
      this.offerPublicLinksMap.set(linkId, { ...link, lastAccessAt: new Date() });
    }
  }

  async createOfferPublicEvent(
    row: Omit<InsertOfferPublicEvent, "id" | "createdAt">,
    _tenantId?: string | null
  ): Promise<OfferPublicEvent> {
    const ev: OfferPublicEvent = {
      id: randomUUID(),
      linkId: row.linkId,
      eventType: row.eventType,
      ip: row.ip ?? null,
      meta: row.meta ?? null,
      createdAt: new Date(),
    };
    this.offerPublicEvents.push(ev);
    return ev;
  }

  private b2bApprovalLogs: B2bApprovalLog[] = [];

  async createB2bApprovalLog(
    row: Omit<InsertB2bApprovalLog, "id" | "createdAt">,
    tenantId?: string | null
  ): Promise<B2bApprovalLog> {
    const record: B2bApprovalLog = {
      id: randomUUID(),
      tenantId: tenantId ?? row.tenantId ?? null,
      shopwareReferenceId: row.shopwareReferenceId,
      referenceType: row.referenceType,
      action: row.action,
      status: row.status ?? "completed",
      actorUserId: row.actorUserId ?? null,
      comment: row.comment ?? null,
      payload: row.payload ?? null,
      createdAt: new Date(),
    };
    this.b2bApprovalLogs.unshift(record);
    return record;
  }

  async listB2bApprovalLogs(tenantId?: string | null, options?: { limit?: number }): Promise<B2bApprovalLog[]> {
    const tid = tenantId ?? null;
    const limit = options?.limit ?? 50;
    return this.b2bApprovalLogs
      .filter((l) => (l.tenantId ?? null) === tid)
      .slice(0, limit);
  }
}

// Import DbStorage and use it as the default storage implementation
import { DbStorage } from "./dbStorage";

// Export DbStorage as the default storage
export const storage = new DbStorage();

// Keep MemStorage available for testing/development if needed
// export const storage = new MemStorage();
