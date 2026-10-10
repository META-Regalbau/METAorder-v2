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
  type CommercialCustomerApiToken,
  type Bundle,
  type InsertBundle,
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
  type SftpServer,
  type InsertSftpServer,
  type SftpUploadLog,
  type InsertSftpUploadLog,
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
  type InsertProductHerstellpreis,
  type ShopwareProductMirror,
  type ShopwareCustomerMirror,
  type ShopwareB2bCompanyMirror,
  type ShopwareCustomerPriceMirror,
  type ShopwareCustomerPriceStat,
  type ShopwareOrderMirror,
  type ShopwareSyncStateRow,
  type ProductPriceHistory,
  type CpqRoomLayout,
  type CpqRoomPlacement,
  type CpqRoomWallFeature,
  type CrossSellPairState,
  type CrossSellPairStatus,
  type InsertCrossSellPairState,
  type CrossSellChangeLogEntry,
  type InsertCrossSellChangeLogEntry,
  type CrossSellRun,
  type CrossSellRunKind,
} from "@shared/schema";

export type CrossSellPairStateFilter = {
  statuses?: CrossSellPairStatus[];
  sourceProductNumber?: string;
  pendingOnly?: boolean;
  limit?: number;
  offset?: number;
};

/** Spalten, die ein Upsert bei bestehendem Paar ueberschreibt (Rest bleibt). */
export type CrossSellPairStateUpdateColumn = Exclude<
  keyof InsertCrossSellPairState,
  "id" | "tenantId" | "sourceProductNumber" | "targetProductNumber" | "createdAt" | "updatedAt"
>;

export type ShopwareProductIdentity = {
  id: string;
  productNumber: string;
  parentId: string | null;
  name: string | null;
  active: boolean | null;
};

export type ShopwareMirrorSyncEntity =
  | "products"
  | "customers"
  | "b2b_companies"
  | "customer_prices"
  | "orders";

export type ShopwareProductMirrorFilter = {
  search?: string;
  activeOnly?: boolean;
  includeInactive?: boolean;
  salesChannelIds?: string[];
  page?: number;
  limit?: number;
};

export type ShopwareSyncStatePatch = {
  cursorUpdatedAt?: Date | null;
  lastTotal?: number | null;
  lastFingerprint?: string | null;
  lastDeltaAt?: Date | null;
  lastReconcileAt?: Date | null;
  status?: string;
  error?: string | null;
};
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

/** Ausfuehrungen einer Regel je Entitaet (zeitgesteuerte Regeln: einmal je Bestellung bzw. je Ticket-Stand) */
export type AutomationEntityRunStats = { succeeded: boolean; failures: number; lastHandledAt: string | null };

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

  findTenantIdByIntegrationKeyHash(
    keyHash: string
  ): Promise<{ tenantId: string; userId: string | null } | null>;
  createTenantIntegrationApiKey(
    tenantId: string,
    name: string,
    userId?: string | null
  ): Promise<{ id: string; apiKey: string }>;
  listTenantIntegrationApiKeys(
    tenantId: string
  ): Promise<Array<{ id: string; name: string; createdAt: Date; userId: string | null }>>;
  deleteTenantIntegrationApiKey(id: string, tenantId: string): Promise<boolean>;
  /** Benutzer eines Schluessels aendern (null = Ersatz-Benutzer); false, wenn der Schluessel fehlt */
  setTenantIntegrationApiKeyUser(id: string, tenantId: string, userId: string | null): Promise<boolean>;
  
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
  getAllOrderDunningStatuses(tenantId?: string | null): Promise<OrderDunningStatus[]>;
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
  getCustomerInteractionSummaries(
    tenantId?: string | null,
  ): Promise<Map<string, { count: number; lastAt: Date | null }>>;
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
  /**
   * Ereignisse je Entwurf und Paar hoechstens einmal (Impressionen beim Oeffnen, Hinzufuegen).
   * Liefert die Zahl neu gespeicherter Zeilen.
   */
  recordCrossSellEventsOncePerDraft(
    rows: Array<{ sourceProductNumber: string; targetProductNumber: string; metadata?: Record<string, unknown> | null }>,
    ctx: { eventType: string; draftId: string; context?: string | null; userId?: string | null },
    tenantId?: string | null,
  ): Promise<number>;
  // Cross-Selling-Gedaechtnis (cross_sell_pair_state, cross_sell_change_log, cross_sell_runs)
  getCrossSellPairStates(filter: CrossSellPairStateFilter, tenantId?: string | null): Promise<CrossSellPairState[]>;
  getCrossSellPairState(id: string, tenantId?: string | null): Promise<CrossSellPairState | undefined>;
  /** Upsert je Paar; bei bestehendem Paar nur `updateColumns` ueberschreiben. Liefert die Zeilen. */
  upsertCrossSellPairStates(
    rows: Array<Omit<InsertCrossSellPairState, "id" | "tenantId" | "createdAt" | "updatedAt">>,
    updateColumns: CrossSellPairStateUpdateColumn[],
    tenantId?: string | null,
  ): Promise<CrossSellPairState[]>;
  updateCrossSellPairState(
    id: string,
    patch: Partial<Omit<InsertCrossSellPairState, "id" | "tenantId" | "createdAt">>,
    tenantId?: string | null,
  ): Promise<CrossSellPairState | undefined>;
  /** Liefert die IDs der neuen Eintraege. */
  appendCrossSellChangeLog(
    rows: Array<Omit<InsertCrossSellChangeLogEntry, "id" | "tenantId" | "createdAt">>,
    tenantId?: string | null,
  ): Promise<number[]>;
  getCrossSellChangeLogEntry(id: number, tenantId?: string | null): Promise<CrossSellChangeLogEntry | undefined>;
  markCrossSellChangeUndone(id: number, undoneById: number, tenantId?: string | null): Promise<void>;
  getCrossSellChangeLog(
    filter: { limit?: number; runId?: string; sourceProductNumber?: string },
    tenantId?: string | null,
  ): Promise<CrossSellChangeLogEntry[]>;
  /**
   * Lauf-Sperre: legt den Lauf (kind, periodKey) an oder uebernimmt einen haengenden
   * (Heartbeat aelter als staleAfterMinutes) bzw. fehlgeschlagenen (attempt < maxAttempts).
   * Liefert null, wenn ein anderer Prozess laeuft oder der Lauf schon abgeschlossen ist.
   */
  acquireCrossSellRun(
    args: { kind: CrossSellRunKind; periodKey: string; userId?: string | null; staleAfterMinutes?: number; maxAttempts?: number },
    tenantId?: string | null,
  ): Promise<CrossSellRun | null>;
  heartbeatCrossSellRun(id: string, stats?: Record<string, unknown>, tenantId?: string | null): Promise<void>;
  finishCrossSellRun(
    id: string,
    result: { status: "completed" | "failed"; stats?: Record<string, unknown>; report?: Record<string, unknown>; error?: string | null; notifiedAt?: Date },
    tenantId?: string | null,
  ): Promise<void>;
  getCrossSellRuns(filter: { kind?: CrossSellRunKind; limit?: number }, tenantId?: string | null): Promise<CrossSellRun[]>;
  /** Nutzer eines Mandanten, deren Rolle die Berechtigung hat (Array- und Objektformat). */
  getUsersWithPermissionInTenant(permission: string, tenantId: string | null): Promise<Array<{ id: string; username: string; email: string | null }>>;
  /** Spiegel-Zeilen (mit payload) zu Artikelnummern, fuer gezielte Detailabfragen. */
  getShopwareProductMirrorsByNumbers(productNumbers: string[], tenantId?: string | null): Promise<ShopwareProductMirror[]>;
  /** Schlanke Produktliste aus dem Spiegel (ID, Nummer, Hauptprodukt) fuer Zuordnungen. */
  getShopwareProductIdentities(tenantId?: string | null): Promise<ShopwareProductIdentity[]>;
  /** Paare eines Ereignistyps fuer einen Entwurf (z. B. per Vorschlag hinzugefuegte Ziele). */
  getCrossSellDraftEventPairs(
    draftId: string,
    eventType: string,
    tenantId?: string | null,
  ): Promise<Array<{ sourceProductNumber: string; targetProductNumber: string }>>;
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
  /**
   * Je Entitaet (z. B. Bestellung): bereits erfolgreich ausgefuehrt? Anzahl Fehlversuche.
   * lastHandledAt: juengster bei Erfolg protokollierter Stand der Entitaet (result.entity.stateAt).
   */
  getAutomationEntityRunStats(
    ruleId: string,
    entityType: string,
    tenantId?: string | null
  ): Promise<Map<string, AutomationEntityRunStats>>;
  getAutomationExecutions(ruleId: string, limit?: number, tenantId?: string | null): Promise<AutomationExecution[]>;
  
  // Order Drafts (AI-powered order creation)
  getAllOrderDrafts(tenantId?: string | null): Promise<OrderDraft[]>;
  getOrderDraft(id: string, tenantId?: string | null): Promise<OrderDraft | undefined>;
  createOrderDraft(draft: InsertOrderDraft, tenantId?: string | null): Promise<OrderDraft>;
  updateOrderDraft(id: string, updates: Partial<InsertOrderDraft>, tenantId?: string | null): Promise<OrderDraft | undefined>;
  /**
   * Atomarer "Claim" direkt vor dem Shopware-Create-Call: setzt Status auf "creating",
   * aber NUR wenn der Entwurf noch nicht "created"/"creating" ist. Verhindert doppelte
   * Shopware-Bestellungen bei gleichzeitigen Requests (Doppelklick, Webhook-Retry).
   * Gibt undefined zurück, wenn ein anderer Request den Entwurf bereits geclaimt hat.
   */
  claimOrderDraftForCreation(id: string, tenantId?: string | null): Promise<OrderDraft | undefined>;
  deleteOrderDraft(id: string, tenantId?: string | null): Promise<boolean>;
  
  // Offer Drafts (AI-powered offer/quote creation)
  getAllOfferDrafts(tenantId?: string | null, statuses?: string[]): Promise<OfferDraft[]>;
  getOfferDraft(id: string, tenantId?: string | null): Promise<OfferDraft | undefined>;
  /** Entwurf zu einem bereits erstellten B2B-Angebot (u. a. CPQ config-PDF-Fallback) */
  getOfferDraftByShopwareOfferId(
    shopwareOfferId: string,
    tenantId?: string | null
  ): Promise<OfferDraft | undefined>;
  createOfferDraft(draft: InsertOfferDraft, tenantId?: string | null): Promise<OfferDraft>;
  updateOfferDraft(id: string, updates: Partial<InsertOfferDraft>, tenantId?: string | null): Promise<OfferDraft | undefined>;
  /** Atomarer "Claim" — siehe claimOrderDraftForCreation. */
  claimOfferDraftForCreation(id: string, tenantId?: string | null): Promise<OfferDraft | undefined>;
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

  // Kundenseitiger Rückmelde-Endpunkt (Auftragsbestätigung für das ERP des Kunden)
  /**
   * Lookup ohne Mandantenkontext — das Token bestimmt den Mandanten (wie bei
   * `findTenantIdByIntegrationKeyHash`). Der Aufrufer prüft Ablauf/Widerruf.
   */
  findCommercialCustomerApiTokenByHash(
    tokenHash: string
  ): Promise<CommercialCustomerApiToken | undefined>;
  touchCommercialCustomerApiTokenLastUsed(id: string): Promise<void>;
  createCommercialCustomerApiToken(params: {
    tenantId: string;
    shopwareCustomerId: string;
    name?: string;
    expiresAt?: Date | null;
    createdByUserId?: string | null;
  }): Promise<{ id: string; token: string }>;
  listCommercialCustomerApiTokens(tenantId?: string | null): Promise<CommercialCustomerApiToken[]>;
  revokeCommercialCustomerApiToken(id: string, tenantId?: string | null): Promise<boolean>;
  /**
   * Sucht den Vorgang zur Belegnummer des Kunden. Immer **beide** Filter — Mandant und
   * `shopwareCustomerId` — damit ein Token niemals fremde Vorgänge sieht.
   */
  findDraftsForAcknowledgement(params: {
    tenantId: string;
    shopwareCustomerId: string;
    buyerDocumentNumber: string;
  }): Promise<
    Array<{ kind: "order"; draft: OrderDraft } | { kind: "offer"; draft: OfferDraft }>
  >;
  /**
   * Dublettenschutz für Auto-Create: andere Entwürfe derselben Art mit gleicher
   * Kunden-Belegnummer und gleichem Shopware-Kunden (ohne `rejected`).
   */
  findSiblingDraftsByBuyerDocumentNumber(params: {
    tenantId?: string | null;
    draftKind: "offer" | "order";
    excludeDraftId: string;
    shopwareCustomerId: string;
    buyerDocumentNumber: string;
  }): Promise<Array<{ id: string; status: string; shopwareEntityId: string | null; createdAt: Date }>>;

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
  
  // SFTP-Server (DMS-Übergabe) — Secrets werden verschlüsselt gespeichert (server/sftp/sftpServers.ts)
  getSftpServers(tenantId?: string | null): Promise<SftpServer[]>;
  getSftpServer(id: string, tenantId?: string | null): Promise<SftpServer | undefined>;
  createSftpServer(server: InsertSftpServer, tenantId?: string | null): Promise<SftpServer>;
  updateSftpServer(id: string, updates: Partial<InsertSftpServer>, tenantId?: string | null): Promise<SftpServer | undefined>;
  deleteSftpServer(id: string, tenantId?: string | null): Promise<boolean>;
  createSftpUploadLog(log: InsertSftpUploadLog, tenantId?: string | null): Promise<SftpUploadLog>;
  getSftpUploadLogs(filters?: { serverId?: string; draftId?: string; status?: string; limit?: number; offset?: number }, tenantId?: string | null): Promise<{ logs: SftpUploadLog[]; total: number }>;

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
    options: { limit: number; sourceTypes?: string[]; query?: string; localQueryEmbedding?: boolean },
    tenantId?: string | null
  ): Promise<Array<SemanticDocument & { distance: number; textRank: number }>>;

  // Herstellpreise (SAP/VTLS, nur META Order)
  upsertProductHerstellpreise(
    rows: Array<Pick<InsertProductHerstellpreis, "productNumber" | "herstellkostenNet" | "source">>,
    tenantId?: string | null,
  ): Promise<void>;
  getProductHerstellpreiseByProductNumbers(
    productNumbers: string[],
    tenantId?: string | null,
  ): Promise<Map<string, number>>;
  getAllProductHerstellpreise(tenantId?: string | null): Promise<Map<string, number>>;

  // Shopware Mirror (Delta-Sync)
  getShopwareSyncState(
    entity: ShopwareMirrorSyncEntity,
    tenantId?: string | null,
  ): Promise<ShopwareSyncStateRow | undefined>;
  upsertShopwareSyncState(
    entity: ShopwareMirrorSyncEntity,
    patch: ShopwareSyncStatePatch,
    tenantId?: string | null,
  ): Promise<ShopwareSyncStateRow>;

  upsertShopwareProductMirrors(
    rows: Array<{
      shopwareId: string;
      productNumber: string;
      manufacturerNumber?: string | null;
      ean?: string | null;
      name?: string | null;
      active?: boolean | null;
      swUpdatedAt?: Date | null;
      lastPriceChangeAt?: Date | null;
      payload: Record<string, unknown>;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  getShopwareProductMirrors(
    filter?: ShopwareProductMirrorFilter,
    tenantId?: string | null,
  ): Promise<{ rows: ShopwareProductMirror[]; total: number }>;
  countShopwareProductMirrors(tenantId?: string | null): Promise<number>;
  getShopwareProductMirrorIds(tenantId?: string | null): Promise<string[]>;
  deleteShopwareProductMirrorsNotIn(keepIds: string[], tenantId?: string | null): Promise<number>;
  /** Aktuelle Preise + letzter Änderungszeitpunkt für einen Batch Shopware-IDs (für Preisänderungs-Erkennung beim Sync). */
  getShopwareProductPricesByShopwareIds(
    shopwareIds: string[],
    tenantId?: string | null,
  ): Promise<Map<string, { priceGross: number | null; priceNet: number | null; lastPriceChangeAt: Date | null }>>;
  insertProductPriceHistory(
    rows: Array<{
      shopwareId: string;
      productNumber: string;
      oldPriceGross: number | null;
      newPriceGross: number;
      oldPriceNet: number | null;
      newPriceNet: number;
      changedAt: Date;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  getProductPriceHistory(
    shopwareId: string,
    tenantId?: string | null,
  ): Promise<ProductPriceHistory[]>;

  /** Bestell-Spiegel — payload ist das fertig gemappte Order-Objekt (siehe fetchOrders()). */
  upsertShopwareOrderMirrors(
    rows: Array<{
      shopwareId: string;
      orderNumber?: string | null;
      salesChannelId?: string | null;
      swUpdatedAt?: Date | null;
      payload: Record<string, unknown>;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  getShopwareOrderMirrors(tenantId?: string | null): Promise<{ rows: ShopwareOrderMirror[]; total: number }>;
  getShopwareOrderMirrorByShopwareId(
    shopwareId: string,
    tenantId?: string | null,
  ): Promise<ShopwareOrderMirror | undefined>;
  countShopwareOrderMirrors(tenantId?: string | null): Promise<number>;
  /** Bisheriger Status/Zahlungsstatus je Bestellung im Spiegel (fuer die Aenderungserkennung). */
  getShopwareOrderMirrorStates(
    shopwareIds: string[],
    tenantId?: string | null
  ): Promise<Map<string, { status: string | null; paymentStatus: string | null }>>;
  /** Alle Shopware-IDs im Bestell-Spiegel (Abgleich fehlender Bestellungen). */
  listShopwareOrderMirrorIds(tenantId?: string | null): Promise<string[]>;
  deleteShopwareOrderMirrorsNotIn(keepIds: string[], tenantId?: string | null): Promise<number>;

  /** Raumplanung — ein Raum-Layout pro Angebot (Raummaße + Regal-Platzierungen). */
  getCpqRoomLayoutByOfferId(
    shopwareOfferId: string,
    tenantId?: string | null,
  ): Promise<CpqRoomLayout | undefined>;
  upsertCpqRoomLayout(
    data: {
      shopwareOfferId: string;
      name?: string | null;
      lengthMm: number;
      widthMm: number;
      heightMm: number;
      minSpacingMm?: number | null;
      frontClearanceMm?: number | null;
      placements: CpqRoomPlacement[];
      wallFeatures?: CpqRoomWallFeature[];
      previewImageBase64?: string | null;
    },
    tenantId?: string | null,
  ): Promise<CpqRoomLayout>;

  upsertShopwareCustomerMirrors(
    rows: Array<{
      shopwareId: string;
      customerNumber?: string | null;
      email?: string | null;
      company?: string | null;
      groupId?: string | null;
      groupName?: string | null;
      salesChannelId?: string | null;
      swUpdatedAt?: Date | null;
      payload: Record<string, unknown>;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  getShopwareCustomerMirrors(tenantId?: string | null): Promise<ShopwareCustomerMirror[]>;
  countShopwareCustomerMirrors(tenantId?: string | null): Promise<number>;
  getShopwareCustomerMirrorIds(tenantId?: string | null): Promise<string[]>;
  deleteShopwareCustomerMirrorsNotIn(keepIds: string[], tenantId?: string | null): Promise<number>;

  replaceShopwareB2bCompanyMirrors(
    rows: Array<{
      companyId: string;
      customerId?: string | null;
      company?: string | null;
      email?: string | null;
      customerNumber?: string | null;
      active?: boolean | null;
      salesChannelId?: string | null;
      swUpdatedAt?: Date | null;
      payload: Record<string, unknown>;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  getShopwareB2bCompanyMirrors(tenantId?: string | null): Promise<ShopwareB2bCompanyMirror[]>;
  countShopwareB2bCompanyMirrors(tenantId?: string | null): Promise<number>;

  replaceShopwareCustomerPriceMirrors(
    rows: Array<{
      priceId: string;
      customerId?: string | null;
      productId?: string | null;
      productNumber?: string | null;
      customerNumber?: string | null;
      swUpdatedAt?: Date | null;
      payload: Record<string, unknown>;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  upsertShopwareCustomerPriceMirrors(
    rows: Array<{
      priceId: string;
      customerId?: string | null;
      productId?: string | null;
      productNumber?: string | null;
      customerNumber?: string | null;
      swUpdatedAt?: Date | null;
      payload: Record<string, unknown>;
    }>,
    tenantId?: string | null,
  ): Promise<void>;
  getShopwareCustomerPriceMirrors(tenantId?: string | null): Promise<ShopwareCustomerPriceMirror[]>;
  countShopwareCustomerPriceMirrors(tenantId?: string | null): Promise<number>;
  getShopwareCustomerPriceStats(tenantId?: string | null): Promise<ShopwareCustomerPriceStat[]>;
  upsertShopwareCustomerPriceStats(
    rows: Array<{
      customerId: string;
      customerNumber?: string | null;
      priceCount: number;
      priceSum: number;
      fingerprint: string;
    }>,
    tenantId?: string | null,
  ): Promise<{ inserted: number; changed: number; unchanged: number; removed: number }>;
  getShopwareCustomerPriceMirrorIds(tenantId?: string | null): Promise<string[]>;
  deleteShopwareCustomerPriceMirrorsNotIn(keepIds: string[], tenantId?: string | null): Promise<number>;

  // Installment plans (Teilzahlung)
  createInstallmentPlanWithInvoices(
    plan: InsertInstallmentPlan,
    invoices: Array<Omit<InsertInstallmentInvoice, "installmentPlanId" | "tenantId">>,
    tenantId?: string | null
  ): Promise<{ plan: InstallmentPlan; invoices: InstallmentInvoice[] }>;
  getInstallmentPlan(id: string, tenantId?: string | null): Promise<InstallmentPlan | undefined>;
  getInstallmentPlansByOrder(orderId: string, tenantId?: string | null): Promise<InstallmentPlan[]>;
  getAllInstallmentPlans(tenantId?: string | null): Promise<InstallmentPlan[]>;
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

import { DbStorage } from "./dbStorage";

export const storage = new DbStorage();
