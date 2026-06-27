import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, jsonb, serial, real, boolean, uniqueIndex, index, customType, pgSchema } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Tenants
export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

const VECTOR_DIMENSIONS = 1536;
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${VECTOR_DIMENSIONS})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
});

// Roles table
export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  salesChannelIds: text("sales_channel_ids").array(),
  permissions: jsonb("permissions").notNull().$type<{
    viewOrders: boolean;
    editOrders: boolean;
    exportData: boolean;
    viewAnalytics: boolean;
    viewDelayedOrders: boolean;
    manageUsers: boolean;
    manageRoles: boolean;
    manageSettings: boolean;
    manageCrossSellingGroups: boolean;
    manageCrossSellingRules: boolean;
    viewTickets: boolean;
    manageTickets: boolean;
    viewShipping: boolean;
    manageAutomations: boolean;
    manageOrderDrafts: boolean;
    viewOffers: boolean;
    manageOffers: boolean;
    viewNaturalLanguageAnalytics: boolean;
    viewDocuments: boolean;
    manageDocuments: boolean;
    manageProducts: boolean;
    viewAccounting: boolean;
    viewCrm: boolean;
    manageCrm: boolean;
    approveCrm: boolean;
    viewCPQ: boolean;
    manageCPQ: boolean;
    manageCPQDiscountLevels: boolean;
    approveCPQQuotes: boolean;
  }>(),
});

export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
});

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("employee"), // Legacy field for backward compatibility
  roleId: varchar("role_id").references(() => roles.id),
  activeTenantId: varchar("active_tenant_id").references(() => tenants.id),
  salesChannelIds: text("sales_channel_ids").array(), // null/empty = all channels (for admin)
  skills: text("skills").array(), // Optional skills for routing (e.g. billing, shipping)
  pushEnabled: boolean("push_enabled").default(false),
  pushSubscription: jsonb("push_subscription"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  role: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/** SHA-256 des Klartext-API-Keys; Klartext nur einmal bei Erstellung. */
export const tenantIntegrationApiKeys = pgTable(
  "tenant_integration_api_keys",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    name: text("name").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("tenant_integration_api_keys_tenant_id_idx").on(table.tenantId),
  })
);

export const tenantUsers = pgTable(
  "tenant_users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueTenantUser: uniqueIndex("tenant_users_tenant_user_unique").on(table.tenantId, table.userId),
  })
);

export type TenantUser = typeof tenantUsers.$inferSelect;
export type InsertTenantUser = typeof tenantUsers.$inferInsert;

// Settings table for Shopware configuration
export const settings = pgTable(
  "settings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueTenantKey: uniqueIndex("settings_tenant_key_unique").on(table.tenantId, table.key),
  })
);

export const semanticDocuments = pgTable(
  "semantic_documents",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, any>>(),
    embedding: vector("embedding").notNull(),
    embeddingProvider: text("embedding_provider").notNull().default("local"),
    embeddingModel: text("embedding_model").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueSemanticSource: uniqueIndex("semantic_documents_source_unique").on(
      table.tenantId,
      table.sourceType,
      table.sourceId
    ),
  })
);

export type SemanticDocument = typeof semanticDocuments.$inferSelect;
export type InsertSemanticDocument = typeof semanticDocuments.$inferInsert;

// Sales Channel
export type SalesChannel = {
  id: string;
  name: string;
  active: boolean;
};

// Shopware settings
export type ShopwareSettings = {
  shopwareUrl: string;
  apiKey: string;
  apiSecret: string;
};

export const shopwareSettingsSchema = z.object({
  shopwareUrl: z.string().url("Please enter a valid URL"),
  apiKey: z.string().min(1, "API key is required"),
  apiSecret: z.string().min(1, "API secret is required"),
});

export type InsertShopwareSettings = z.infer<typeof shopwareSettingsSchema>;

// Mondu settings for invoice submission
export type MonduSettings = {
  apiKey: string;
  sandboxMode: boolean;
};

export const monduSettingsSchema = z.object({
  apiKey: z.string().optional(),
  sandboxMode: z.boolean().default(true),
});

export type InsertMonduSettings = z.infer<typeof monduSettingsSchema>;

// Proforma number range settings (per tenant)
export type ProformaNumberRangeSettings = {
  prefix: string;
  nextNumber: number;
  padding: number;
};

export const proformaNumberRangeSchema = z.object({
  prefix: z.string().max(20),
  nextNumber: z.number().int().min(1),
  padding: z.number().int().min(0).max(12),
});

export type InsertProformaNumberRangeSettings = z.infer<typeof proformaNumberRangeSchema>;

// Dunning (Mahnung) settings per tenant
export type DunningSettings = {
  enabled: boolean;
  manualOnly: boolean;
  dueDateFieldKey: string;
  stageDays: [number, number, number];
  documentTypeTechnicalName: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  /** PDF in METAorder erzeugen (sonst Shopware-Dokumenttyp). Default true. */
  generatePdfInApp?: boolean;
  /** Erzeugtes PDF per API in Shopware an Order anhängen. Default false. */
  savePdfToShop?: boolean;
};

export const dunningSettingsSchema = z.object({
  enabled: z.boolean(),
  manualOnly: z.boolean(),
  dueDateFieldKey: z.string().min(1).max(80),
  stageDays: z.tuple([z.number().int().min(1), z.number().int().min(1), z.number().int().min(1)]),
  documentTypeTechnicalName: z.string().min(1).max(64),
  emailSubjectTemplate: z.string().min(1).max(200),
  emailBodyTemplate: z.string().min(1).max(5000),
  generatePdfInApp: z.boolean().optional(),
  savePdfToShop: z.boolean().optional(),
});

export type InsertDunningSettings = z.infer<typeof dunningSettingsSchema>;

// Order types for Shopware integration
export type OrderStatus = "open" | "in_progress" | "completed" | "cancelled";
export type PaymentStatus = "open" | "paid" | "authorized" | "partially_paid" | "refunded" | "cancelled" | "reminded" | "failed";

export type OrderAddress = {
  firstName: string;
  lastName: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  company?: string;
  phoneNumber?: string;
};

export type Order = {
  id: string;
  orderNumber: string;
  /** Shopware Kundennummer (order_customer.customerNumber), falls vorhanden */
  customerNumber?: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  orderDate: string;
  updatedAt?: string;
  deliveryDateEarliest?: string;
  deliveryDateLatest?: string;
  totalAmount: number; // Bruttogesamtbetrag (mit MwSt)
  netTotalAmount: number; // Nettogesamtbetrag (ohne MwSt)
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: string; // Name der Zahlart (z.B. "Rechnung", "PayPal")
  shippingMethod?: string; // Name der Versandart (z.B. "DHL Standard", "Express")
  salesChannelId: string;
  salesChannelName?: string;
  billingAddress?: OrderAddress;
  shippingAddress?: OrderAddress;
  shippingInfo?: {
    carrier?: string;
    trackingNumber?: string;
    shippedDate?: string;
  };
  invoiceNumber?: string;
  invoiceDate?: string; // Datum der Rechnungserstellung (ISO String)
  hasInvoiceDocument?: boolean; // Es existiert mindestens ein echtes Rechnungsdokument in Shopware
  invoiceDocumentCount?: number; // Anzahl echter Rechnungsdokumente
  invoiceSent?: boolean; // true, wenn alle Rechnungsdokumente verschickt wurden (sent=true)
  dueDate?: string; // Faelligkeitsdatum (ISO String)
  deliveryNoteNumber?: string;
  erpNumber?: string;
  proformaNumber?: string; // Proforma-Rechnungsnummer
  vorkasseInvoiceNumber?: string; // Vorkasse-Rechnungsnummer (z. B. VKRE-…)
  customerComment?: string; // Checkout-Kommentar des Kunden
  isPaymentOverdue?: boolean; // Automatisch berechnet: 30 Tage nach invoiceDate + paymentStatus = open/authorized
  items: OrderItem[];
  customFields?: Record<string, any>;
  discount?: {
    amount: number; // Rabattbetrag (Brutto)
    percentage: number; // Rabattprozentsatz
  };
};

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  price: number; // Bruttopreis (mit MwSt)
  netPrice: number; // Nettopreis (ohne MwSt)
  total: number; // Bruttosumme
  netTotal: number; // Nettosumme
  taxRate: number; // Steuersatz in Prozent
  categoryNames?: string[]; // Für Analytics: Kategorie-Namen des Produkts
  weight?: number; // Produktgewicht in kg
  productNumber?: string; // Artikelnummer für Gewichts-Lookup
};

export type ShippingInfoInput = {
  carrier: string;
  trackingNumber: string;
  shippedDate: string;
};

export type AdminDocumentInput = {
  invoiceNumber?: string;
  vorkasseInvoiceNumber?: string;
  deliveryNoteNumber?: string;
  erpNumber?: string;
};

// Dunning status per order
export const orderDunningStatus = pgTable("order_dunning_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  orderId: text("order_id").notNull(),
  stage: integer("stage").notNull().default(0),
  lastSentAt: timestamp("last_sent_at"),
  lastDocumentId: text("last_document_id"),
  lastPdfUrl: text("last_pdf_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OrderDunningStatus = typeof orderDunningStatus.$inferSelect;
export type InsertOrderDunningStatus = typeof orderDunningStatus.$inferInsert;

// Installment / Teilzahlungspläne (lokal, pro Shopware-Bestellung)
export const installmentPlans = pgTable(
  "installment_plans",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    orderId: text("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
    depositAmount: decimal("deposit_amount", { precision: 12, scale: 2 }).notNull(),
    depositPercent: decimal("deposit_percent", { precision: 5, scale: 2 }),
    depositInvoiceNumber: text("deposit_invoice_number"),
    remainingAmount: decimal("remaining_amount", { precision: 12, scale: 2 }).notNull(),
    numberOfInstallments: integer("number_of_installments").notNull(),
    installmentAmount: decimal("installment_amount", { precision: 12, scale: 2 }).notNull(),
    status: text("status").notNull().default("draft"),
    agreementPdfPath: text("agreement_pdf_path"),
    agreementConfirmedAt: timestamp("agreement_confirmed_at"),
    agreementConfirmedBy: text("agreement_confirmed_by"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantOrderLookupIdx: index("installment_plans_tenant_order_idx").on(table.tenantId, table.orderId),
  })
);

export const installmentInvoices = pgTable(
  "installment_invoices",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    installmentPlanId: varchar("installment_plan_id")
      .notNull()
      .references(() => installmentPlans.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    invoiceNumber: text("invoice_number"),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    dueDate: timestamp("due_date"),
    status: text("status").notNull().default("pending"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    planSeqIdx: uniqueIndex("installment_invoices_plan_seq_idx").on(table.installmentPlanId, table.sequenceNumber),
  })
);

export type InstallmentPlan = typeof installmentPlans.$inferSelect;

/** Öffentlicher Link zu einem Shopware/B2B-Angebot (Klartext-Token nur bei Erstellung) */
export const offerPublicLinks = pgTable(
  "offer_public_links",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    shopwareOfferId: text("shopware_offer_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastAccessAt: timestamp("last_access_at"),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("offer_public_links_token_hash_idx").on(table.tokenHash),
    tenantOfferIdx: index("offer_public_links_tenant_offer_idx").on(table.tenantId, table.shopwareOfferId),
  })
);

export const offerPublicEvents = pgTable(
  "offer_public_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    linkId: varchar("link_id")
      .notNull()
      .references(() => offerPublicLinks.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    ip: text("ip"),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    linkIdx: index("offer_public_events_link_idx").on(table.linkId),
  })
);

export type OfferPublicLink = typeof offerPublicLinks.$inferSelect;
export type InsertOfferPublicLink = typeof offerPublicLinks.$inferInsert;
export type OfferPublicEvent = typeof offerPublicEvents.$inferSelect;
export type InsertOfferPublicEvent = typeof offerPublicEvents.$inferInsert;
export type InsertInstallmentPlan = typeof installmentPlans.$inferInsert;
export type InstallmentInvoice = typeof installmentInvoices.$inferSelect;
export type InsertInstallmentInvoice = typeof installmentInvoices.$inferInsert;

export type InstallmentPlanStatus =
  | "draft"
  | "pending_confirmation"
  | "active"
  | "completed"
  | "cancelled";

export type InstallmentInvoiceStatus = "pending" | "sent" | "paid" | "overdue" | "cancelled";

export const createInstallmentPlanBodySchema = z
  .object({
    depositAmount: z.number().positive("Anzahlung muss größer als 0 sein").optional(),
    depositPercent: z.number().min(0.01).max(99.99).optional(),
    numberOfInstallments: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    depositInvoiceNumber: z.string().min(1, "Rechnungsnummer Anzahlung erforderlich"),
    installmentInvoiceNumbers: z.array(z.string().min(1)),
    /** ISO-Datum: zuerst Anzahlung, dann je Rate (Länge = 1 + numberOfInstallments) */
    dueDates: z.array(z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.depositAmount && !data.depositPercent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Entweder depositAmount oder depositPercent muss angegeben werden",
        path: ["depositAmount"],
      });
    }
    if (data.installmentInvoiceNumbers.length !== data.numberOfInstallments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Es müssen genau ${data.numberOfInstallments} Teilrechnungsnummern angegeben werden`,
        path: ["installmentInvoiceNumbers"],
      });
    }
    if (data.dueDates && data.dueDates.length !== 1 + data.numberOfInstallments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `dueDates muss ${1 + data.numberOfInstallments} Einträge haben (Anzahlung + Raten) oder leer sein`,
        path: ["dueDates"],
      });
    }
  });

export type CreateInstallmentPlanBody = z.infer<typeof createInstallmentPlanBodySchema>;

/** Body für POST /api/orders/:orderId/settlement-invoice/pdf (Abschlussrechnung-PDF) */
export const settlementInvoicePdfBodySchema = z
  .object({
    settlementInvoiceNumber: z.string().min(1, "Abschlussrechnungsnummer erforderlich"),
    originalInvoiceNumber: z.string().min(1, "Ursprungsrechnungsnummer erforderlich"),
    originalAmountGross: z.coerce.number().positive("Ursprungsbetrag muss größer als 0 sein"),
    stornoInvoiceNumber: z.string().min(1, "Stornorechnungsnummer erforderlich"),
    stornoAmountGross: z.coerce.number().min(0, "Stornobetrag darf nicht negativ sein"),
    /** ISO-Datum YYYY-MM-DD; optional, Standard: heute (Server) */
    invoiceDate: z.string().min(1).optional(),
  })
  .refine((d) => d.stornoAmountGross <= d.originalAmountGross, {
    message: "Stornobetrag darf den Ursprungsbetrag nicht übersteigen",
    path: ["stornoAmountGross"],
  });

export type SettlementInvoicePdfBody = z.infer<typeof settlementInvoicePdfBodySchema>;

/** Einzelposition für Nachberechnungs-Rechnung (PDF + Shopware-Upload) */
export const additionalInvoiceLineItemSchema = z.object({
  description: z.string().min(1, "Beschreibung erforderlich"),
  quantity: z.coerce.number().positive("Menge muss größer als 0 sein"),
  unitNetPrice: z.coerce.number().min(0, "Einzelpreis darf nicht negativ sein"),
  vatRate: z.union([z.literal(0), z.literal(7), z.literal(19)]),
});

/** Body für POST /api/orders/:orderId/additional-invoice */
export const additionalInvoiceBodySchema = z.object({
  invoiceNumber: z.string().min(1, "Rechnungsnummer erforderlich"),
  invoiceDate: z.string().min(1).optional(),
  referenceInvoiceNumber: z.string().min(1).optional(),
  note: z.string().optional(),
  items: z.array(additionalInvoiceLineItemSchema).min(1, "Mindestens eine Position erforderlich"),
});

export type AdditionalInvoiceBody = z.infer<typeof additionalInvoiceBodySchema>;

export type AdditionalInvoicePdfInput = {
  invoiceNumber: string;
  invoiceDate: Date;
  referenceInvoiceNumber?: string | null;
  note?: string | null;
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  billingAddress?: {
    company?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    street?: string | null;
    zipCode?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
  items: Array<{
    description: string;
    quantity: number;
    unitNetPrice: number;
    vatRate: 0 | 7 | 19;
  }>;
};

// Offer types (B2B Sellers Suite / legacy)
export type OfferStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'offered'
  | 'accepted'
  | 'declined'
  | 'expired';

export type Offer = {
  id: string;
  offerNumber: string;
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  /** Shopware-Kundennummer, falls aus Angebot/Kunde ermittelbar */
  customerNumber?: string;
  /** Rechnungs-/Standardadresse für PDF & Anzeige */
  billingAddress?: OrderAddress;
  customerPhone?: string;
  salesChannelId: string;
  salesChannelName?: string;
  totalPrice: number; // Brutto
  netPrice: number; // Netto
  taxStatus: string;
  status: OfferStatus;
  statusId?: string | null;
  statusLabel?: string | null;
  offered: boolean;
  accepted: boolean;
  declined: boolean;
  offerExpiration: string;
  createdAt: string;
  updatedAt: string;
  items?: any[]; // Angebotspositionen
};

// Product types for Shopware integration and CPQ
export type ProductPriceRule = {
  quantity: number; // Minimum quantity for this price
  price: number; // Bruttopreis
  netPrice: number; // Nettopreis
  discount?: number; // Percentage discount
};

export type ProductVariant = {
  id: string;
  name: string;
  /** Shopware-Artikelnummer der Varianten-Zeile (für Listen/Detail) */
  productNumber?: string;
  options: Array<{
    group: string;
    option: string;
    value?: string;
  }>;
  price: number; // Bruttopreis
  netPrice: number; // Nettopreis
  stock: number;
  available: boolean;
};

export type Product = {
  id: string;
  productNumber: string;
  name: string;
  description?: string;
  price: number; // Bruttopreis (mit MwSt)
  netPrice: number; // Nettopreis (ohne MwSt)
  currency: string;
  taxRate: number;
  stock: number;
  available: boolean;
  active?: boolean;
  /** Shopware: Anzahl Kind-Varianten (Parent-Produkt) */
  childCount?: number;
  /** Shopware: Parent-ID bei Varianten-Zeilen, sonst null */
  parentId?: string | null;
  manufacturerName?: string;
  manufacturerNumber?: string;
  /** Externe ERP-/SAP-Produktnummer (aus Shopware customFields gemappt) */
  sapProductNumber?: string;
  categoryNames?: string[];
  
  // CPQ-relevant fields
  priceRules?: ProductPriceRule[]; // Graduated pricing for quantity
  variants?: ProductVariant[]; // Product variants/configurations
  minOrderQuantity?: number;
  maxOrderQuantity?: number;
  packagingUnit?: string; // e.g., "piece", "box", "pallet"
  
  // Media
  imageUrl?: string;
  images?: string[];
  
  // Additional metadata
  ean?: string;
  weight?: number;
  dataQualityScore?: number;
  dimensions?: {
    width?: number;
    height?: number;
    length?: number;
    unit?: string;
  };
  customFields?: Record<string, any>;
  properties?: Array<{
    groupName: string;
    optionName: string;
  }>;
  
  // Timestamps
  createdAt?: string;
  updatedAt?: string;
};

export type BundleComponent = {
  productNumber: string;
  productId?: string;
  productName?: string;
  quantity: number;
};

export type BundlePayload = {
  id: string;
  name: string;
  mockProductNumber: string;
  components: BundleComponent[];
};

// Cross-Selling types
export type CrossSellingProduct = {
  id: string;
  productNumber: string;
  name: string;
  price: number; // Bruttopreis
  netPrice: number; // Nettopreis
  taxRate: number;
  imageUrl?: string;
  stock: number;
  available: boolean;
};

export type CrossSellingGroup = {
  id: string;
  name: string;
  type: "productList" | "productStream"; // Shopware supports both
  active: boolean;
  products: CrossSellingProduct[];
};

/** Shopware-Tabname (Storefront) fuer Cross-Selling-Gruppen, die METAorder anlegt oder befuellt. */
export const SHOPWARE_CROSS_SELLING_STOREFRONT_NAME = "Passende Produkte";

// Rule-based cross-selling system
export type RuleConditionOperator = "equals" | "notEquals" | "contains" | "notContains" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual" | "matchesDimensions";

export type RuleCondition = {
  field: string; // e.g., "categoryNames", "dimensions.height", "customFields.regalSystem"
  operator: RuleConditionOperator;
  value: string | number | string[] | number[];
};

export type RuleTargetCriteria = {
  field: string; // e.g., "categoryNames", "dimensions"
  matchType: "exact" | "contains" | "sameDimensions" | "sameProperty" | "sameWidthAndDepth";
  value?: string | number | string[];
};

export type CrossSellingRule = {
  id: string;
  name: string;
  description?: string;
  active: number; // 1 = active, 0 = inactive (matching database integer type)
  category?: string | null; // regale, komponenten, zubehoer, sonstiges
  
  // When to apply this rule - conditions on the source product
  sourceConditions: RuleCondition[];
  
  // What products to suggest - criteria for target products
  targetCriteria: RuleTargetCriteria[];
  
  // Metadata
  createdAt: string;
  updatedAt: string;
};

// Cross-Selling Categories (varchar auf staging/rules, Reihenfolge siehe getCategoryPosition in routes)
export const CROSS_SELL_CATEGORIES = {
  SHELVES: "regale",
  BOARDS: "boeden",
  COMPONENTS: "komponenten",
  DIAGONAL: "diagonal",
  ACCESSORIES: "zubehoer",
  SMALL_PARTS: "kleinteile",
  OTHER: "sonstiges",
} as const;

export type CrossSellCategory = typeof CROSS_SELL_CATEGORIES[keyof typeof CROSS_SELL_CATEGORIES];

// Database table for cross-selling rules
export const crossSellingRules = pgTable("cross_selling_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  category: varchar("category", { length: 50 }), // regale, boeden, komponenten, diagonal, zubehoer, kleinteile, sonstiges
  sourceConditions: text("source_conditions").notNull(), // JSON array of RuleCondition
  targetCriteria: text("target_criteria").notNull(), // JSON array of RuleTargetCriteria
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCrossSellingRuleSchema = createInsertSchema(crossSellingRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sourceConditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(["equals", "notEquals", "contains", "notContains", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual", "matchesDimensions"]),
    value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]),
  })),
  targetCriteria: z.array(z.object({
    field: z.string(),
    matchType: z.enum(["exact", "contains", "sameDimensions", "sameProperty", "sameWidthAndDepth"]),
    value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  })),
});

export type InsertCrossSellingRule = z.infer<typeof insertCrossSellingRuleSchema>;
export type SelectCrossSellingRule = typeof crossSellingRules.$inferSelect;

export type CrossSellCooccurrence = {
  id: string;
  productNumberA: string;
  productNumberB: string;
  pairCount: number;
  ordersWithA: number;
  ordersWithB: number;
  totalOrders: number;
  support: number;
  confidence: number;
  lift: number;
  generatedAt: string;
};

export const crossSellCooccurrences = pgTable("cross_sell_cooccurrences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  productNumberA: text("product_number_a").notNull(),
  productNumberB: text("product_number_b").notNull(),
  pairCount: integer("pair_count").notNull(),
  ordersWithA: integer("orders_with_a").notNull(),
  ordersWithB: integer("orders_with_b").notNull(),
  totalOrders: integer("total_orders").notNull(),
  support: real("support").notNull(),
  confidence: real("confidence").notNull(),
  lift: real("lift").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type InsertCrossSellCooccurrence = typeof crossSellCooccurrences.$inferInsert;

/** Funnel-Events fuer Cross-Selling-Qualitaet (Hybrid-Ranker / Learning). */
export const crossSellEvents = pgTable(
  "cross_sell_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    eventType: text("event_type").notNull(),
    sourceProductNumber: text("source_product_number").notNull(),
    targetProductNumber: text("target_product_number").notNull(),
    context: text("context"),
    draftId: varchar("draft_id"),
    userId: varchar("user_id").references(() => users.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantSrcTgtEvtIdx: index("cross_sell_events_tenant_src_tgt_evt_idx").on(
      table.tenantId,
      table.sourceProductNumber,
      table.targetProductNumber,
      table.eventType,
    ),
    tenantCreatedIdx: index("cross_sell_events_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

export type InsertCrossSellEvent = typeof crossSellEvents.$inferInsert;
export type CrossSellEventRow = typeof crossSellEvents.$inferSelect;

/** Aggregierte Kennzahlen pro Quell-/Ziel-Artikelpaar (fuer Hybrid-Score). */
export type CrossSellEventPairStats = {
  sourceProductNumber: string;
  targetProductNumber: string;
  impressions: number;
  clicks: number;
  adds: number;
  removes: number;
  returns: number;
};

export type AiCrossSellRule = {
  id: string;
  sourceProductNumber: string;
  targetProductNumber: string;
  support: number;
  confidence: number;
  lift: number;
  reason?: string;
  category?: string | null;
  active: number;
  generatedAt: string;
};

export const aiCrossSellRules = pgTable("ai_cross_sell_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  sourceProductNumber: text("source_product_number").notNull(),
  targetProductNumber: text("target_product_number").notNull(),
  support: real("support").notNull(),
  confidence: real("confidence").notNull(),
  lift: real("lift").notNull(),
  reason: text("reason"),
  category: varchar("category", { length: 50 }), // regale, komponenten, zubehoer, sonstiges
  active: integer("active").notNull().default(1),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type InsertAiCrossSellRule = typeof aiCrossSellRules.$inferInsert;

export type CrossSellStagingBatch = {
  id: string;
  tenantId?: string | null;
  createdByUserId?: string | null;
  status: "draft" | "approved" | "applied";
  createdAt: string;
  updatedAt: string;
};

export const crossSellStagingBatches = pgTable("cross_sell_staging_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertCrossSellStagingBatch = typeof crossSellStagingBatches.$inferInsert;

export type CrossSellStagingRule = {
  id: string;
  batchId: string;
  tenantId?: string | null;
  ruleType: "ai" | "manual";
  name: string;
  description?: string | null;
  active: number;
  category?: string | null;
  sourceConditions: RuleCondition[];
  targetCriteria: RuleTargetCriteria[];
  sourceProductNumber?: string | null;
  targetProductNumber?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const crossSellStagingRules = pgTable("cross_sell_staging_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").references(() => crossSellStagingBatches.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ruleType: text("rule_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  active: integer("active").notNull().default(1),
  category: varchar("category", { length: 50 }),
  sourceConditions: jsonb("source_conditions").notNull().$type<RuleCondition[]>(),
  targetCriteria: jsonb("target_criteria").notNull().$type<RuleTargetCriteria[]>(),
  sourceProductNumber: text("source_product_number"),
  targetProductNumber: text("target_product_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertCrossSellStagingRule = typeof crossSellStagingRules.$inferInsert;

export type CrossSellStagingSuggestion = {
  id: string;
  batchId: string;
  tenantId?: string | null;
  sourceProductId?: string | null;
  sourceProductNumber: string;
  targetProductId?: string | null;
  targetProductNumber: string;
  category?: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
};

export const crossSellStagingSuggestions = pgTable("cross_sell_staging_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").references(() => crossSellStagingBatches.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  sourceProductId: text("source_product_id"),
  sourceProductNumber: text("source_product_number").notNull(),
  targetProductId: text("target_product_id"),
  targetProductNumber: text("target_product_number").notNull(),
  category: varchar("category", { length: 50 }),
  active: integer("active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InsertCrossSellStagingSuggestion = typeof crossSellStagingSuggestions.$inferInsert;

export type AiRecommendation = {
  id: string;
  productNumber: string;
  recommendedProductNumber: string;
  score: number;
  reason?: string;
  generatedAt: string;
};

export const aiRecommendations = pgTable("ai_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  productNumber: text("product_number").notNull(),
  recommendedProductNumber: text("recommended_product_number").notNull(),
  score: real("score").notNull(),
  reason: text("reason"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type InsertAiRecommendation = typeof aiRecommendations.$inferInsert;

export type AiInsight = {
  id: string;
  insightType: string;
  title: string;
  description?: string;
  data?: Record<string, any>;
  generatedAt: string;
};

export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  insightType: text("insight_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  data: jsonb("data"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type InsertAiInsight = typeof aiInsights.$inferInsert;

export type OfferLearningInsight = {
  id: string;
  insightType: string;
  title: string;
  description?: string;
  data?: Record<string, any>;
  generatedAt: string;
};

export const offerLearningInsights = pgTable("offer_learning_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  insightType: text("insight_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  data: jsonb("data"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type InsertOfferLearningInsight = typeof offerLearningInsights.$inferInsert;

// Ticket System
export type TicketStatus = "open" | "in_progress" | "waiting_for_customer" | "waiting_for_internal" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketCategory =
  | "general"
  | "order_issue"
  | "product_inquiry"
  | "technical_support"
  | "complaint"
  | "feature_request"
  | "discount_request"
  | "other";

export type EmailInboundSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  mailbox: string;
  pollIntervalSeconds: number;
  markAsSeen: boolean;
  maxMessages: number;
  allowAttachments: boolean;
};

export type EmailOutboundSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  fromAddress: string;
  fromName?: string;
  replyTo?: string;
  m365ConnectionId?: string;
};

export type EmailRoutingRule = {
  pattern: string;
  target: "subject" | "body" | "from" | "all";
  category?: TicketCategory;
  priority?: TicketPriority;
  skill?: string;
};

export type EmailRoutingSettings = {
  enabled: boolean;
  confidenceThreshold: number;
  defaultCategory: TicketCategory;
  defaultPriority: TicketPriority;
  defaultSkill?: string;
  fallbackRules: EmailRoutingRule[];
};

export type M365Settings = {
  enabled: boolean;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  enableGraph: boolean;
  enableImapSmtp: boolean;
  authFlow?: "device_code" | "auth_code";
};

export type GoogleAnalyticsSettings = {
  enabled: boolean;
  propertyIds: string[];
  serviceAccountJson?: string;
};

export type GoogleAdsSettings = {
  enabled: boolean;
  customerIds: string[];
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  loginCustomerId?: string;
};

export type CustomerStatus = "active" | "inactive";
export type CustomerInteractionType = "note" | "call" | "email" | "meeting" | "other";
export type OrderAssignmentStatus = "requested" | "approved" | "rejected";
export type DiscountRequestStatus = "requested" | "approved" | "rejected";
export type DiscountType = "percent" | "amount";

export const customers = pgTable(
  "customers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    externalId: text("external_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    company: text("company"),
    status: text("status").notNull().default("active"),
    tags: text("tags").array(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueCustomerEmail: uniqueIndex("customers_tenant_email_unique").on(table.tenantId, table.email),
  })
);

export const customerInteractions = pgTable("customer_interactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id),
  interactionType: text("interaction_type").notNull().default("note"),
  subject: text("subject"),
  body: text("body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orderAssignments = pgTable("order_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  orderId: text("order_id").notNull(),
  orderNumber: text("order_number").notNull(),
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  status: text("status").notNull().default("requested"),
  reason: text("reason"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tickets = pgTable("tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ticketNumber: text("ticket_number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  category: text("category").notNull().default("general"),
  orderId: text("order_id"), // Optional link to order
  orderNumber: text("order_number"), // Denormalized for display
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  customerId: text("customer_id"), // Optional: end-customer identifier
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  dueDate: timestamp("due_date"), // Fälligkeitsdatum/SLA
  tags: text("tags").array(), // Ticket tags/labels
  emailSubject: text("email_subject"), // Original email subject if created from email
  emailFrom: text("email_from"), // Original email sender if created from email
  returnReason: text("return_reason"), // Return/Retoure reason (optional, for n8n integration)
  returnItems: jsonb("return_items"), // Return items details (optional, for n8n integration)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
});

export const ticketComments = pgTable("ticket_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id),
  authorType: text("author_type").notNull().default("user"), // user | customer
  customerId: text("customer_id"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  comment: text("comment").notNull(),
  isInternal: integer("is_internal").notNull().default(0), // 0 = public, 1 = internal note
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketEmailMessages = pgTable("ticket_email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ticketId: varchar("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  commentId: varchar("comment_id").references(() => ticketComments.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull().unique(),
  inReplyTo: text("in_reply_to"),
  references: text("references").array(),
  direction: text("direction").notNull(), // inbound | outbound
  source: text("source").notNull(), // imap | smtp | n8n | api
  subject: text("subject"),
  from: text("from"),
  to: text("to"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TicketEmailMessage = typeof ticketEmailMessages.$inferSelect;
export type InsertTicketEmailMessage = typeof ticketEmailMessages.$inferInsert;

export const m365Connections = pgTable("m365_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text("tenant_id").notNull(),
  email: text("email").notNull(),
  userId: varchar("user_id").references(() => users.id),
  scopes: text("scopes").array(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type M365Connection = typeof m365Connections.$inferSelect;
export type InsertM365Connection = typeof m365Connections.$inferInsert;

export const ticketAttachments = pgTable("ticket_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketCommentViews = pgTable("ticket_comment_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  commentId: varchar("comment_id").notNull().references(() => ticketComments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export const ticketAttachmentViews = pgTable("ticket_attachment_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  attachmentId: varchar("attachment_id").notNull().references(() => ticketAttachments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export const ticketActivityLog = pgTable("ticket_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  action: text("action").notNull(), // e.g., "status_changed", "assigned", "priority_changed", "tag_added"
  fieldName: text("field_name"), // Which field was changed
  oldValue: text("old_value"), // Previous value (as JSON string if complex)
  newValue: text("new_value"), // New value (as JSON string if complex)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketAssignmentRules = pgTable("ticket_assignment_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  priority: integer("priority").notNull().default(0), // Higher number = higher priority
  assignmentType: text("assignment_type").notNull(), // "round_robin" or "rule_based"
  conditions: text("conditions"), // JSON string of conditions for rule_based
  assignToUserId: varchar("assign_to_user_id").references(() => users.id), // For specific assignment
  assignToRoleId: varchar("assign_to_role_id").references(() => roles.id), // For role-based assignment
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTicketSchema = createInsertSchema(tickets).omit({
  id: true,
  ticketNumber: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
}).extend({
  status: z.enum(["open", "in_progress", "waiting_for_customer", "waiting_for_internal", "resolved", "closed"]).default("open"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  category: z.enum(["general", "order_issue", "product_inquiry", "technical_support", "complaint", "feature_request", "discount_request", "other"]).default("general"),
  dueDate: z.union([z.string(), z.date()]).transform((val) => {
    if (typeof val === 'string') {
      return new Date(val);
    }
    return val;
  }).optional(),
});

export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({
  id: true,
  createdAt: true,
});

export const insertTicketAttachmentSchema = createInsertSchema(ticketAttachments).omit({
  id: true,
  createdAt: true,
});

export const insertTicketActivityLogSchema = createInsertSchema(ticketActivityLog).omit({
  id: true,
  createdAt: true,
});

export const insertTicketAssignmentRuleSchema = createInsertSchema(ticketAssignmentRules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;
export type TicketComment = typeof ticketComments.$inferSelect;
export type InsertTicketAttachment = z.infer<typeof insertTicketAttachmentSchema>;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type InsertTicketActivityLog = z.infer<typeof insertTicketActivityLogSchema>;
export type TicketActivityLog = typeof ticketActivityLog.$inferSelect;
export type InsertTicketAssignmentRule = z.infer<typeof insertTicketAssignmentRuleSchema>;
export type TicketAssignmentRule = typeof ticketAssignmentRules.$inferSelect;

export const discountRequests = pgTable("discount_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ticketId: varchar("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
  orderId: text("order_id"),
  orderNumber: text("order_number"),
  customerId: text("customer_id"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id),
  discountType: text("discount_type").notNull().default("percent"),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  reason: text("reason"),
  status: text("status").notNull().default("requested"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(["active", "inactive"]).default("active"),
});

export const insertCustomerInteractionSchema = createInsertSchema(customerInteractions).omit({
  id: true,
  createdAt: true,
}).extend({
  interactionType: z.enum(["note", "call", "email", "meeting", "other"]).default("note"),
});

export const insertOrderAssignmentSchema = createInsertSchema(orderAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(["requested", "approved", "rejected"]).default("requested"),
});

export const insertDiscountRequestSchema = createInsertSchema(discountRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(["requested", "approved", "rejected"]).default("requested"),
  discountType: z.enum(["percent", "amount"]).default("percent"),
  discountValue: z.preprocess((val) => Number(val), z.number().min(0)),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type CustomerInteraction = typeof customerInteractions.$inferSelect;
export type InsertCustomerInteraction = z.infer<typeof insertCustomerInteractionSchema>;
export type OrderAssignment = typeof orderAssignments.$inferSelect;
export type InsertOrderAssignment = z.infer<typeof insertOrderAssignmentSchema>;
export type DiscountRequest = typeof discountRequests.$inferSelect;
export type InsertDiscountRequest = z.infer<typeof insertDiscountRequestSchema>;

// Notifications for real-time user alerts
export type NotificationType = "ticket_assigned" | "ticket_updated" | "comment_added" | "due_date_warning" | "ticket_status_changed";

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // NotificationType
  title: text("title").notNull(),
  message: text("message").notNull(),
  ticketId: varchar("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
  ticketNumber: text("ticket_number"), // Denormalized for quick access
  read: integer("read").notNull().default(0), // 0 = unread, 1 = read
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
}).extend({
  type: z.enum(["ticket_assigned", "ticket_updated", "comment_added", "due_date_warning", "ticket_status_changed"]),
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// Ticket Templates for quick responses
export const ticketTemplates = pgTable("ticket_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category"), // Optional category for organization
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTicketTemplateSchema = createInsertSchema(ticketTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTicketTemplate = z.infer<typeof insertTicketTemplateSchema>;
export type TicketTemplate = typeof ticketTemplates.$inferSelect;

// Process Updates for internal workflow changes/FAQ
export const processUpdates = pgTable("process_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: text("tags").array(),
  effectiveDate: timestamp("effective_date").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProcessUpdateSchema = createInsertSchema(processUpdates, {
  tags: z.array(z.string()).optional(),
  effectiveDate: z.coerce.date(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProcessUpdate = z.infer<typeof insertProcessUpdateSchema>;
export type ProcessUpdate = typeof processUpdates.$inferSelect;

// Automation Rules System
export type AutomationTriggerType = "order_created" | "order_status_changed" | "order_payment_changed" | "ticket_created" | "ticket_status_changed" | "scheduled";
export type AutomationActionType = "create_ticket" | "update_order_status" | "send_notification" | "assign_ticket" | "update_ticket_priority" | "send_email" | "run_ai_analysis";

export type AutomationCondition = {
  field: string; // e.g., "status", "paymentStatus", "totalAmount", "daysSinceOrder"
  operator: "equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual" | "contains";
  value: string | number | boolean;
};

export type AutomationAction = {
  type: AutomationActionType;
  params: Record<string, any>; // Action-specific parameters
};

export const automationRules = pgTable("automation_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled").notNull().default(0), // 0 = disabled, 1 = enabled
  triggerType: text("trigger_type").notNull(), // AutomationTriggerType
  conditions: text("conditions"), // JSON array of AutomationCondition (nullable)
  actions: text("actions").notNull(), // JSON array of AutomationAction
  priority: integer("priority").notNull().default(0), // Rule execution priority
  schedule: text("schedule"), // Cron expression for scheduled triggers (optional)
  lastExecutedAt: timestamp("last_executed_at"),
  executionCount: integer("execution_count").notNull().default(0),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Schema for validating frontend input (arrays, booleans or numbers for enabled)
export const insertAutomationRuleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  enabled: z.union([z.boolean(), z.number()]).transform(val => typeof val === 'boolean' ? val : !!val),
  triggerType: z.enum(["order_created", "order_status_changed", "order_payment_changed", "ticket_created", "ticket_status_changed", "scheduled"]),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(["equals", "notEquals", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual", "contains"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })).optional(),
  actions: z.array(z.object({
    type: z.enum(["create_ticket", "update_order_status", "send_notification", "assign_ticket", "update_ticket_priority", "send_email", "run_ai_analysis"]),
    params: z.record(z.any()),
  })),
  priority: z.number().default(0),
  schedule: z.string().optional(),
  createdByUserId: z.string().optional(),
});

// Type for validated frontend data
export type ValidatedAutomationRule = z.infer<typeof insertAutomationRuleSchema>;

// Type for database insertion (strings, integers)
export type InsertAutomationRule = {
  name: string;
  description?: string | null;
  enabled: number; // 0 or 1
  triggerType: string;
  conditions?: string | null; // JSON string
  actions: string; // JSON string
  priority: number;
  schedule?: string | null;
  createdByUserId?: string | null;
};

export type AutomationRule = typeof automationRules.$inferSelect;

// Automation Executions table - tracks automation rule execution history
export const automationExecutions = pgTable("automation_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  ruleId: varchar("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // 'success' | 'failure'
  executedAt: timestamp("executed_at").notNull().defaultNow(),
  error: text("error"), // Error message if status is 'failure'
  result: jsonb("result"), // Execution result data
});

export const insertAutomationExecutionSchema = createInsertSchema(automationExecutions).omit({
  id: true,
  executedAt: true,
}).extend({
  status: z.enum(["success", "failure"]),
});

export type InsertAutomationExecution = z.infer<typeof insertAutomationExecutionSchema>;
export type AutomationExecution = typeof automationExecutions.$inferSelect;

// Bundles (mock products composed of real items)
export const bundles = pgTable(
  "bundles",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    name: text("name").notNull(),
    mockProductNumber: text("mock_product_number").notNull(),
    description: text("description"),
    active: integer("active").notNull().default(1), // 0 = inactive, 1 = active
    createdByUserId: varchar("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueTenantMockNumber: uniqueIndex("bundles_tenant_mock_number_unique").on(table.tenantId, table.mockProductNumber),
  })
);

export const bundleItems = pgTable("bundle_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  bundleId: varchar("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
  productNumber: text("product_number").notNull(),
  productId: text("product_id"),
  quantity: integer("quantity").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBundleSchema = createInsertSchema(bundles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBundleItemSchema = createInsertSchema(bundleItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBundle = z.infer<typeof insertBundleSchema>;
export type Bundle = typeof bundles.$inferSelect;
export type InsertBundleItem = z.infer<typeof insertBundleItemSchema>;
export type BundleItem = typeof bundleItems.$inferSelect;
export type BundleWithItems = Bundle & { items: BundleItem[] };
export type BundleItemInput = Omit<InsertBundleItem, "bundleId" | "tenantId">;

// Order Drafts table - for AI-powered order creation from PDFs/emails
export const orderDrafts = pgTable("order_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  status: text("status").notNull().default("pending"), // pending, review_required, approved, rejected, created
  originalFileName: text("original_file_name").notNull(),
  originalFilePath: text("original_file_path"), // Path to stored upload file
  extractedData: jsonb("extracted_data").$type<{
    customer?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      company?: string;
      emailResolution?: {
        candidatesTried?: string[];
        chosenEmail?: string;
        method?: "heuristic" | "llm" | "extracted_only";
      };
      /** 0–100, KI/heuristische Sicherheit der E-Mail-/Kundenzuordnung */
      customerMatchConfidence?: number;
    };
    billingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
      phone?: string;
    };
    shippingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
      phone?: string;
    };
    lineItems?: Array<{
      extractedProductName: string;
      /** Pos.-Nr. aus dem Dokument — nicht Menge, nicht Artikelnummer */
      extractedPositionNumber?: string;
      extractedProductNumber?: string;
      quantity: number;
      extractedPrice?: number;
    }>;
    orderNotes?: string;
    commercialIntent?: "quote_request" | "purchase_order" | "unclear";
    commercialIntentConfidence?: number;
    commercialIntentRationale?: string;
    commercialIntentRoutedAsOfferDueToPermission?: boolean;
    commercialIntentVsUploadMismatch?: boolean;
    webDomainVerification?: {
      domain: string;
      urlsTried: string[];
      ok: boolean;
      checks: {
        zipMatch: boolean;
        cityMatch: boolean;
        companyMatch: boolean;
        streetPartialMatch: boolean;
      };
      excerpt?: string;
      error?: string;
      fetchedAt: string;
      skippedReason?: "freemail" | "no_domain" | "no_email_context";
    };
    addressReviewHints?: string[];
    lineItemPlausibility?: Array<{
      index: number;
      skipCatalogMatching: boolean;
      skipReason?: string;
      quantityWasZero?: boolean;
    }>;
    extractionAgentTrace?: Array<{ step: string; ms: number; version: string }>;
    extractionRefinementApplied?: boolean;
  }>(),
  matchingResults: jsonb("matching_results").$type<{
    items: Array<{
      extractedProductName: string;
      extractedPositionNumber?: string;
      extractedProductNumber?: string;
      quantity: number;
      matchedProduct?: {
        id: string;
        productNumber: string;
        name: string;
        price: number;
      };
      bundle?: BundlePayload;
      alternativeMatches?: Array<{
        id: string;
        productNumber: string;
        name: string;
        price: number;
        confidence: number; // 0-100
        reasoning?: string; // Why this alternative was suggested (e.g., "Fachlast 150kg, 1000mm breit")
      }>;
      confidence: number; // 0-100, overall confidence for this line item
      status: string; // "matched", "uncertain", "not_found"
      // Holmebenen conversion tracking (Holme are sold as 2-piece sets)
      originalQuantity?: number; // Original quantity from request (e.g., 12 Holme)
      convertedQuantity?: number; // Converted quantity (e.g., 6 Holmebenen sets)
      conversionNote?: string; // Conversion explanation (e.g., "1 Holmebene = 2 Holme")
      matchStrategy?: "ean" | "productNumber" | "manufacturerNumber" | "sapProductNumber" | "synthetic_gtin";
      learningHint?: {
        type: "blocked_line" | "preferred_identifier";
        identifier?: string;
      };
      catalogProductInactive?: boolean;
      inactiveMatchedProduct?: {
        id: string;
        productNumber: string;
        name: string;
        ean?: string;
      };
      /** Heuristik: echte Produktzeile vs. Floskel (E-Mail, Anrede, …) */
      productScreen?: {
        likelihood: "likely_product" | "unclear" | "unlikely_product";
        reasons?: string[];
      };
      catalogMatchSkipped?: boolean;
    }>;
    overallConfidence: number; // 0-100, average confidence across all items
  }>(),
  shopwareCustomerId: text("shopware_customer_id"), // ID of matched/created customer in Shopware
  shopwareOrderId: text("shopware_order_id"), // ID of created order in Shopware (if created)
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrderDraftSchema = createInsertSchema(orderDrafts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrderDraft = z.infer<typeof insertOrderDraftSchema>;
export type OrderDraft = typeof orderDrafts.$inferSelect;

/** Cross-selling block returned with GET order/offer draft (not persisted on draft row). */
export type CrossSellingDraftSuggestionProduct = {
  id: string;
  productNumber: string;
  name: string;
  price: number;
  netPrice: number;
  imageUrl?: string;
  stock: number;
  available: boolean;
  /** GPT/Hybrid-Begruendung aus GET offer-/order-draft (optional). */
  crossSellReason?: string;
  hybridScore?: number;
};

export type CrossSellingDraftSuggestionGroup = {
  forProduct: {
    id: string;
    name: string;
    productNumber: string;
  };
  suggestions: CrossSellingDraftSuggestionProduct[];
};

export type OrderDraftWithCrossSelling = OrderDraft & {
  crossSellingSuggestions?: CrossSellingDraftSuggestionGroup[];
};

/** KI-/Commercial-Felder in JSONB extracted_data (z. B. für UI-Casts neben Drizzle-Inferenz) */
export type CommercialDraftAiExtractedMeta = {
  commercialIntent?: "quote_request" | "purchase_order" | "unclear";
  commercialIntentConfidence?: number;
  commercialIntentRationale?: string;
  commercialIntentRoutedAsOfferDueToPermission?: boolean;
  commercialIntentVsUploadMismatch?: boolean;
  webDomainVerification?: {
    domain: string;
    urlsTried: string[];
    ok: boolean;
    checks: {
      zipMatch: boolean;
      cityMatch: boolean;
      companyMatch: boolean;
      streetPartialMatch: boolean;
    };
    excerpt?: string;
    error?: string;
    fetchedAt: string;
    skippedReason?: "freemail" | "no_domain" | "no_email_context";
  };
  addressReviewHints?: string[];
  lineItemPlausibility?: Array<{
    index: number;
    skipCatalogMatching: boolean;
    skipReason?: string;
    quantityWasZero?: boolean;
  }>;
  extractionAgentTrace?: Array<{ step: string; ms: number; version: string }>;
  extractionRefinementApplied?: boolean;
};

// Offer Drafts table - for AI-powered offer/quote creation from PDFs/emails
export const offerDrafts = pgTable("offer_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  status: text("status").notNull().default("pending"), // pending, review_required, approved, rejected, created
  originalFileName: text("original_file_name").notNull(),
  originalFilePath: text("original_file_path"), // Path to stored upload file
  extractedData: jsonb("extracted_data").$type<{
    customer?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      company?: string;
      emailResolution?: {
        candidatesTried?: string[];
        chosenEmail?: string;
        method?: "heuristic" | "llm" | "extracted_only";
      };
      customerMatchConfidence?: number;
    };
    billingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
      phone?: string;
    };
    lineItems?: Array<{
      extractedProductName: string;
      extractedProductNumber?: string;
      quantity: number;
      extractedPrice?: number;
    }>;
    offerNotes?: string; // Customer's request notes
    validUntil?: string; // Requested validity date
    commercialIntent?: "quote_request" | "purchase_order" | "unclear";
    commercialIntentConfidence?: number;
    commercialIntentRationale?: string;
    commercialIntentRoutedAsOfferDueToPermission?: boolean;
    commercialIntentVsUploadMismatch?: boolean;
    webDomainVerification?: {
      domain: string;
      urlsTried: string[];
      ok: boolean;
      checks: {
        zipMatch: boolean;
        cityMatch: boolean;
        companyMatch: boolean;
        streetPartialMatch: boolean;
      };
      excerpt?: string;
      error?: string;
      fetchedAt: string;
      skippedReason?: "freemail" | "no_domain" | "no_email_context";
    };
    addressReviewHints?: string[];
    lineItemPlausibility?: Array<{
      index: number;
      skipCatalogMatching: boolean;
      skipReason?: string;
      quantityWasZero?: boolean;
    }>;
    extractionAgentTrace?: Array<{ step: string; ms: number; version: string }>;
    extractionRefinementApplied?: boolean;
    /** CPQ-Konfigurator: Snapshot für MetaCalc-Payload, PDF-Fallback und Stückliste im Angebotsdetail */
    cpqSource?: {
      systemId?: string | null;
      systemName?: string | null;
      config?: Record<string, unknown> | null;
      cpqConfigurationId?: string | null;
      billOfMaterials?: {
        items: Array<{
          productId: string;
          productNumber: string;
          name: string;
          quantity: number;
          unitPrice?: number;
          lineTotal?: number;
          componentType?: string;
        }>;
        totalPrice?: number;
      };
    };
  }>(),
  matchingResults: jsonb("matching_results").$type<{
    items: Array<{
      extractedProductName: string;
      extractedProductNumber?: string;
      quantity: number;
      matchedProduct?: {
        id: string;
        productNumber: string;
        name: string;
        catalogPrice: number; // Original catalog price
        suggestedPrice?: number; // AI-suggested price
        suggestedDiscount?: number; // AI-suggested discount percentage
      };
      bundle?: BundlePayload;
      alternativeMatches?: Array<{
        id: string;
        productNumber: string;
        name: string;
        price: number;
        confidence: number; // 0-100
        reasoning?: string; // Why this alternative was suggested (e.g., "Fachlast 150kg, 1000mm breit")
      }>;
      confidence: number; // 0-100, overall confidence for this line item
      status: string; // "matched", "uncertain", "not_found"
      // Holmebenen conversion tracking (Holme are sold as 2-piece sets)
      originalQuantity?: number; // Original quantity from request (e.g., 12 Holme)
      convertedQuantity?: number; // Converted quantity (e.g., 6 Holmebenen sets)
      conversionNote?: string; // Conversion explanation (e.g., "1 Holmebene = 2 Holme")
      /** Heuristik: echte Produktzeile vs. Floskel (E-Mail, Anrede, …) */
      productScreen?: {
        likelihood: "likely_product" | "unclear" | "unlikely_product";
        reasons?: string[];
      };
      matchStrategy?: "ean" | "productNumber" | "manufacturerNumber" | "sapProductNumber" | "synthetic_gtin";
      learningHint?: {
        type: "blocked_line" | "preferred_identifier";
        identifier?: string;
      };
      catalogProductInactive?: boolean;
      inactiveMatchedProduct?: {
        id: string;
        productNumber: string;
        name: string;
        ean?: string;
      };
      catalogMatchSkipped?: boolean;
    }>;
    overallConfidence: number; // 0-100, average confidence across all items
    pricingRecommendations?: {
      totalCatalogValue: number;
      totalSuggestedValue: number;
      totalDiscountPercentage: number;
      reasoning?: string; // AI explanation for pricing
    };
  }>(),
  shopwareCustomerId: text("shopware_customer_id"), // ID of matched/created customer in Shopware
  shopwareOfferId: text("shopware_offer_id"), // ID of created offer in Shopware (if created)
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertOfferDraftSchema = createInsertSchema(offerDrafts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOfferDraft = z.infer<typeof insertOfferDraftSchema>;
export type OfferDraft = typeof offerDrafts.$inferSelect;

export type OfferDraftWithCrossSelling = OfferDraft & {
  crossSellingSuggestions?: CrossSellingDraftSuggestionGroup[];
};

/** Few-Shot-Lernbeispiele für Commercial Agent (Intent / Muster aus E-Mail+PDF) */
export const commercialAgentExemplars = pgTable("commercial_agent_exemplars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  sourceKind: text("source_kind").notNull(),
  intentLabel: text("intent_label").notNull(),
  subjectExcerpt: text("subject_excerpt"),
  emailExcerpt: text("email_excerpt"),
  pdfExcerpt: text("pdf_excerpt"),
  signalsJson: jsonb("signals_json").$type<Record<string, unknown> | null>(),
  qualityScore: integer("quality_score").notNull().default(1),
  draftKind: text("draft_kind"),
  referenceDraftId: varchar("reference_draft_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCommercialAgentExemplarSchema = createInsertSchema(commercialAgentExemplars).omit({
  id: true,
  createdAt: true,
});

export type InsertCommercialAgentExemplar = z.infer<typeof insertCommercialAgentExemplarSchema>;
export type CommercialAgentExemplar = typeof commercialAgentExemplars.$inferSelect;

/** Produkt-Matching-Learnings aus manuellen Korrekturen in Draft-Reviews (pro Tenant). */
export const commercialProductMatchFeedback = pgTable(
  "commercial_product_match_feedback",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    draftKind: text("draft_kind").notNull(), // offer | order
    outcome: text("outcome").notNull(), // confirmed_product | not_product
    lineKey: text("line_key").notNull(), // normalisierter Fingerprint der Zeile
    sourceLine: text("source_line"), // Originaltext (gekürzt)
    sourceIdentifier: text("source_identifier"), // erkannte Kennung aus Dokument
    selectedProductId: text("selected_product_id"), // bestätigtes Shopware-Produkt
    selectedIdentifier: text("selected_identifier"), // bevorzugte Referenz (z. B. productNumber/SAP)
    selectedStrategy: text("selected_strategy"), // ean/productNumber/manufacturerNumber/sapProductNumber/...
    createdByUserId: varchar("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantLineIdx: index("commercial_product_feedback_tenant_line_idx").on(table.tenantId, table.lineKey),
    tenantOutcomeIdx: index("commercial_product_feedback_tenant_outcome_idx").on(
      table.tenantId,
      table.outcome,
      table.createdAt
    ),
  })
);

export const insertCommercialProductMatchFeedbackSchema = createInsertSchema(
  commercialProductMatchFeedback
).omit({
  id: true,
  createdAt: true,
});

export type InsertCommercialProductMatchFeedback = z.infer<
  typeof insertCommercialProductMatchFeedbackSchema
>;
export type CommercialProductMatchFeedback = typeof commercialProductMatchFeedback.$inferSelect;

// Natural Language Analytics Types
export type AnalyticsQueryType =
  | "top_products"
  | "delayed_orders"
  | "order_trends"
  | "revenue_trends"
  | "customer_analysis"
  | "weight_analysis"
  | "item_count_analysis"
  | "customer_rankings"
  | "product_performance"
  | "category_performance"
  | "payment_analysis"
  | "sales_channel_analysis"
  | "order_status_distribution"
  | "general_statistics"
  | "revenue_forecast"
  | "product_demand_forecast"
  | "seasonal_analysis"
  | "trend_forecast";

export type AnalyticsQuery = {
  type: AnalyticsQueryType;
  parameters: {
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    salesChannelId?: string;
    categoryName?: string;
    productId?: string;
    customerId?: string;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    groupBy?: "day" | "week" | "month" | "year";
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    filters?: Record<string, any>;
    // Forecast-specific parameters
    forecastPeriods?: number; // Number of periods to forecast (e.g., 12 months, 52 weeks)
    forecastUnit?: "day" | "week" | "month" | "quarter" | "year"; // Unit for forecast
    confidenceLevel?: number; // Confidence level for intervals (e.g., 0.95 for 95%)
    includeSeasonality?: boolean; // Include seasonal patterns in forecast
    algorithm?: "linear" | "exponential" | "seasonal" | "auto"; // Forecast algorithm
  };
  sqlHints?: string[];
  naturalLanguageQuery: string;
};

export type AnalyticsResult = {
  labels: string[];
  data: number[] | any[];
  metadata?: Record<string, any>;
  summary?: {
    total?: number;
    average?: number;
    min?: number;
    max?: number;
    count?: number;
  };
  // Forecast-specific fields
  forecast?: {
    periods: number;
    values: number[];
    lowerBound?: number[]; // Lower confidence interval
    upperBound?: number[]; // Upper confidence interval
    accuracy?: number; // Forecast accuracy/confidence (0-100)
    algorithm?: string; // Algorithm used for forecasting
    seasonalityDetected?: boolean;
  };
  improvements?: ImprovementSuggestion[]; // AI-generated improvement suggestions
};

export type AnalyticsInsight = {
  text: string;
  type: "trend" | "anomaly" | "comparison" | "general" | "forecast" | "recommendation";
  confidence?: number;
};

export type ImprovementSuggestion = {
  id: string;
  category: "revenue" | "inventory" | "marketing" | "operations" | "customer_service" | "general";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact?: string; // E.g., "Potential 15% revenue increase"
  actionItems?: string[]; // Concrete steps to implement
  timeframe?: string; // E.g., "Implement within 2 weeks"
  confidence?: number; // AI confidence in this suggestion (0-100)
  basedOn?: string; // Data points/patterns that led to this suggestion
};

// ERP Automation History table - tracks automated actions triggered by CustomField updates
export const erpAutomationRuns = pgTable("erp_automation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  orderId: text("order_id").notNull(), // Shopware Order ID
  orderNumber: text("order_number"), // Order number for display
  trigger: text("trigger").notNull(), // Which CustomField triggered this: 'invoice_number', 'delivery_note', 'order_number'
  action: text("action").notNull(), // What action was performed: 'create_invoice', 'set_shipped', 'send_invoice'
  status: text("status").notNull(), // 'success', 'failed', 'skipped'
  errorMessage: text("error_message"), // Error details if status = 'failed'
  metadata: jsonb("metadata").$type<{
    erpInvoiceNumber?: string;
    erpDeliveryNoteNumber?: string;
    erpOrderNumber?: string;
    shopwareInvoiceId?: string;
    previousOrderStatus?: string;
    newOrderStatus?: string;
    emailSent?: boolean;
    skippedReason?: string; // Why was this skipped (e.g., "Invoice already exists")
  }>(),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
}, (table) => ({
  // Index for fast history lookups by order and trigger
  orderTriggerIdx: sql`CREATE INDEX IF NOT EXISTS erp_automation_runs_order_trigger_idx ON ${table} (order_id, trigger)`,
}));

export const insertErpAutomationRunSchema = createInsertSchema(erpAutomationRuns).omit({
  id: true,
  executedAt: true,
});

export type InsertErpAutomationRun = z.infer<typeof insertErpAutomationRunSchema>;
export type ErpAutomationRun = typeof erpAutomationRuns.$inferSelect;

// Shipping Carriers table - stores reusable carrier names for dropdown
export const shippingCarriers = pgTable(
  "shipping_carriers",
  {
    id: serial("id").primaryKey(),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueTenantCarrier: uniqueIndex("shipping_carriers_tenant_name_unique").on(table.tenantId, table.name),
  })
);

export const insertShippingCarrierSchema = createInsertSchema(shippingCarriers).omit({
  id: true,
  createdAt: true,
});

export type InsertShippingCarrier = z.infer<typeof insertShippingCarrierSchema>;
export type ShippingCarrier = typeof shippingCarriers.$inferSelect;

// Webhook Configuration table - stores webhook endpoints for external integrations (n8n, Zapier, etc.)
export const webhookConfigs = pgTable(
  "webhook_configs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id),
    eventType: text("event_type").notNull(), // e.g., 'ticket.created', 'order.ready_to_ship'
    targetUrl: text("target_url"), // Webhook URL (nullable when disabled)
    enabled: integer("enabled").notNull().default(0), // 0 = disabled, 1 = enabled
    secret: text("secret"), // Optional HMAC secret for signing (encrypted at rest)
    maxAttempts: integer("max_attempts").notNull().default(3), // Retry attempts (1-5)
    initialBackoffMs: integer("initial_backoff_ms").notNull().default(1000), // Initial backoff in ms (500-60000)
    backoffFactor: real("backoff_factor").notNull().default(2.0), // Backoff multiplier (1.0-5.0)
    timeoutMs: integer("timeout_ms").notNull().default(10000), // Request timeout in ms
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueTenantEvent: uniqueIndex("webhook_configs_tenant_event_unique").on(table.tenantId, table.eventType),
    // Check constraint for event types
    eventTypeCheck: sql`CHECK (event_type IN ('ticket.created', 'ticket.updated', 'ticket.commented', 'ticket.assigned', 'ticket.customer_replied', 'ticket.agent_replied', 'order.ready_to_ship', 'document.created', 'commercial.draft_created', 'commercial.draft_review_required', 'commercial.auto_offer_created', 'commercial.auto_order_created'))`,
  })
);

export const insertWebhookConfigSchema = createInsertSchema(webhookConfigs, {
  eventType: z.enum([
    'ticket.created',
    'ticket.updated',
    'ticket.commented',
    'ticket.assigned',
    'ticket.customer_replied',
    'ticket.agent_replied',
    'order.ready_to_ship',
    'document.created',
    'commercial.draft_created',
    'commercial.draft_review_required',
    'commercial.auto_offer_created',
    'commercial.auto_order_created',
  ]),
  targetUrl: z.string().url().optional().nullable(),
  enabled: z.number().int().min(0).max(1).default(0),
  secret: z.string().optional().nullable(),
  maxAttempts: z.number().int().min(1).max(5).default(3),
  initialBackoffMs: z.number().int().min(500).max(60000).default(1000),
  backoffFactor: z.number().min(1.0).max(5.0).default(2.0),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWebhookConfig = z.infer<typeof insertWebhookConfigSchema>;
export type WebhookConfig = typeof webhookConfigs.$inferSelect;
export type WebhookEventType =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.commented'
  | 'ticket.assigned'
  | 'ticket.customer_replied'
  | 'ticket.agent_replied'
  | 'order.ready_to_ship'
  | 'document.created'
  | 'commercial.draft_created'
  | 'commercial.draft_review_required'
  | 'commercial.auto_offer_created'
  | 'commercial.auto_order_created';

// Webhook Logs table - tracks all webhook delivery attempts
export const webhookLogs = pgTable("webhook_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  requestId: varchar("request_id").notNull(), // Groups retries together
  eventType: text("event_type").notNull(),
  targetUrl: text("target_url").notNull(),
  status: text("status").notNull(), // 'pending', 'success', 'failed', 'skipped'
  responseStatus: integer("response_status"), // HTTP status code
  responseBody: text("response_body"), // Truncated response (first 1000 chars)
  errorMessage: text("error_message"), // Error details if failed
  attempt: integer("attempt").notNull().default(1), // Attempt number (1, 2, 3...)
  executedAt: timestamp("executed_at").notNull().defaultNow(),
  durationMs: integer("duration_ms"), // Request duration in ms
  payload: jsonb("payload"), // Trimmed payload (entity ID + summary, not full object)
}, (table) => ({
  // Partial index for fast filtering by event type and recent logs
  eventTypeExecutedIdx: sql`CREATE INDEX IF NOT EXISTS webhook_logs_event_type_executed_idx ON ${table} (event_type, executed_at DESC)`,
  // Index for request ID lookups (to find all retries)
  requestIdIdx: sql`CREATE INDEX IF NOT EXISTS webhook_logs_request_id_idx ON ${table} (request_id)`,
  // Status check constraint
  statusCheck: sql`CHECK (status IN ('pending', 'success', 'failed', 'skipped'))`,
}));

export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({
  id: true,
  executedAt: true,
});

export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogs.$inferSelect;

// CPQ Schema - Configure, Price, Quote module
const cpqSchema = pgSchema("cpq");

export const CPQ_REVIEW_STATUS_VALUES = [
  "not_required",
  "pending",
  "approved",
  "customer_contact_required",
  "rejected",
] as const;
export type CpqReviewStatus = (typeof CPQ_REVIEW_STATUS_VALUES)[number];

export const CPQ_REVIEW_QUEUE_STATUS_VALUES = [
  "pending",
  "approved",
  "customer_contact_required",
  "rejected",
] as const;
export type CpqReviewQueueStatus = (typeof CPQ_REVIEW_QUEUE_STATUS_VALUES)[number];

export const cpqSystems = cpqSchema.table("cpq_systems", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // active, draft, archived
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqComponentTypes = cpqSchema.table("cpq_component_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  systemId: varchar("system_id").notNull().references(() => cpqSystems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull(), // frame, beam, shelf, accessory, connector
  required: boolean("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  icon: text("icon"),
  attributeSchema: jsonb("attribute_schema").$type<Record<string, { type: string; unit?: string; label: string }>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqProductMapping = cpqSchema.table("cpq_product_mapping", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  shopwareProductId: text("shopware_product_id").notNull(),
  shopwareProductNumber: text("shopware_product_number").notNull(),
  productName: text("product_name"), // Shop-Name zur Anzeige (z. B. bei Produkt-Mappings)
  systemId: varchar("system_id").notNull().references(() => cpqSystems.id, { onDelete: "cascade" }),
  componentTypeId: varchar("component_type_id").notNull().references(() => cpqComponentTypes.id, { onDelete: "cascade" }),
  attributes: jsonb("attributes").$type<Record<string, number | string | boolean>>(),
  status: text("status").notNull().default("active"), // active, inactive, pending_review
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqGeometry = cpqSchema.table("cpq_geometry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productMappingId: varchar("product_mapping_id").notNull().references(() => cpqProductMapping.id, { onDelete: "cascade" }),
  origin: jsonb("origin").$type<{ x: number; y: number; z: number }>(),
  anchorPoints: jsonb("anchor_points").$type<Array<{
    id: string;
    position: { x: number; y: number; z: number };
    type: string;
    pattern?: string;
    start?: number;
    pitch?: number;
  }>>(),
  boundingBox: jsonb("bounding_box").$type<{ width: number; height: number; depth: number }>(),
  glbAssetUrl: text("glb_asset_url"),
  lodLevels: jsonb("lod_levels").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqRules = cpqSchema.table("cpq_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  systemId: varchar("system_id").notNull().references(() => cpqSystems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // compatibility, physical, configuration, business
  priority: integer("priority").notNull().default(0),
  condition: jsonb("condition").$type<Record<string, unknown>>(),
  action: jsonb("action").$type<Record<string, unknown>>(),
  fallback: jsonb("fallback").$type<Record<string, unknown>>(),
  message: text("message"),
  status: text("status").notNull().default("active"), // active, draft, disabled
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqRuleVersions = cpqSchema.table("cpq_rule_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleId: varchar("rule_id").notNull().references(() => cpqRules.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  condition: jsonb("condition").$type<Record<string, unknown>>(),
  action: jsonb("action").$type<Record<string, unknown>>(),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  changeNote: text("change_note"),
});

export const cpqConfigurations = cpqSchema.table("cpq_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  systemId: varchar("system_id").notNull().references(() => cpqSystems.id, { onDelete: "cascade" }),
  customerId: text("customer_id"),
  name: text("name").notNull(),
  configData: jsonb("config_data").$type<Record<string, unknown>>(),
  validationStatus: text("validation_status").notNull().default("valid"), // valid, warnings, errors
  reviewRequired: boolean("review_required").notNull().default(false),
  reviewStatus: text("review_status").notNull().default("not_required"), // not_required, pending, approved, customer_contact_required, rejected
  reviewNotes: text("review_notes"),
  reviewedBy: text("reviewed_by"),
  reviewRequestedAt: timestamp("review_requested_at"),
  reviewedAt: timestamp("reviewed_at"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqReviewAudit = cpqSchema.table("cpq_review_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  configurationId: varchar("configuration_id")
    .notNull()
    .references(() => cpqConfigurations.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  reviewNotes: text("review_notes"),
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const cpqDiscountLevels = cpqSchema.table("cpq_discount_levels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  color: text("color").notNull(),
  icon: text("icon"),
  discountMin: decimal("discount_min", { precision: 5, scale: 2 }).notNull().default("0"),
  discountMax: decimal("discount_max", { precision: 5, scale: 2 }).notNull(),
  messageTemplate: text("message_template"),
  approvalType: text("approval_type").notNull().default("none"), // none, department_lead, management, blocked
  justificationRequired: boolean("justification_required").notNull().default(false),
  notifyRoles: jsonb("notify_roles").$type<string[]>(),
  escalationHours: integer("escalation_hours"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"), // active, draft
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqDiscountLevelRules = cpqSchema.table("cpq_discount_level_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  discountLevelId: varchar("discount_level_id").references(() => cpqDiscountLevels.id, { onDelete: "cascade" }),
  contextType: text("context_type").notNull(), // system, customer_group, order_value, default
  contextValue: text("context_value"),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cpqQuoteLog = cpqSchema.table("cpq_quote_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  configurationId: varchar("configuration_id").references(() => cpqConfigurations.id, { onDelete: "set null" }),
  offerId: text("offer_id"),
  userId: text("user_id").notNull(),
  discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }).notNull(),
  discountLevelId: varchar("discount_level_id").references(() => cpqDiscountLevels.id, { onDelete: "set null" }),
  listPrice: decimal("list_price", { precision: 12, scale: 2 }).notNull(),
  discountedPrice: decimal("discounted_price", { precision: 12, scale: 2 }).notNull(),
  revenueLoss: decimal("revenue_loss", { precision: 12, scale: 2 }).notNull(),
  justification: text("justification"),
  approvalType: text("approval_type").notNull(), // none, department_lead, management, blocked, exception_request
  approvalStatus: text("approval_status").notNull(), // not_required, pending, approved, rejected, blocked
  approvedBy: text("approved_by"),
  approvalComment: text("approval_comment"),
  approvedAt: timestamp("approved_at"),
  escalated: boolean("escalated").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CpqSystem = typeof cpqSystems.$inferSelect;
export type InsertCpqSystem = typeof cpqSystems.$inferInsert;
export type CpqComponentType = typeof cpqComponentTypes.$inferSelect;
export type InsertCpqComponentType = typeof cpqComponentTypes.$inferInsert;
export type CpqProductMapping = typeof cpqProductMapping.$inferSelect;
export type InsertCpqProductMapping = typeof cpqProductMapping.$inferInsert;
export type CpqGeometry = typeof cpqGeometry.$inferSelect;
export type InsertCpqGeometry = typeof cpqGeometry.$inferInsert;
export type CpqRule = typeof cpqRules.$inferSelect;
export type InsertCpqRule = typeof cpqRules.$inferInsert;
export type CpqRuleVersion = typeof cpqRuleVersions.$inferSelect;
export type InsertCpqRuleVersion = typeof cpqRuleVersions.$inferInsert;
export type CpqConfiguration = typeof cpqConfigurations.$inferSelect;
export type InsertCpqConfiguration = typeof cpqConfigurations.$inferInsert;
export type CpqReviewAudit = typeof cpqReviewAudit.$inferSelect;
export type InsertCpqReviewAudit = typeof cpqReviewAudit.$inferInsert;
export type CpqDiscountLevel = typeof cpqDiscountLevels.$inferSelect;
export type InsertCpqDiscountLevel = typeof cpqDiscountLevels.$inferInsert;
export type CpqDiscountLevelRule = typeof cpqDiscountLevelRules.$inferSelect;
export type InsertCpqDiscountLevelRule = typeof cpqDiscountLevelRules.$inferInsert;
export type CpqQuoteLog = typeof cpqQuoteLog.$inferSelect;
export type InsertCpqQuoteLog = typeof cpqQuoteLog.$inferInsert;
