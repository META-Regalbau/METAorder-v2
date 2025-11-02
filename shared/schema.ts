import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("employee"), // Legacy field for backward compatibility
  roleId: varchar("role_id").references(() => roles.id),
  salesChannelIds: text("sales_channel_ids").array(), // null/empty = all channels (for admin)
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  role: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Settings table for Shopware configuration
export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

// Order types for Shopware integration
export type OrderStatus = "open" | "in_progress" | "completed" | "cancelled";
export type PaymentStatus = "open" | "paid" | "partially_paid" | "refunded" | "cancelled" | "reminded" | "failed";

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
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  orderDate: string;
  deliveryDateEarliest?: string;
  deliveryDateLatest?: string;
  totalAmount: number; // Bruttogesamtbetrag (mit MwSt)
  netTotalAmount: number; // Nettogesamtbetrag (ohne MwSt)
  status: OrderStatus;
  paymentStatus: PaymentStatus;
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
  deliveryNoteNumber?: string;
  erpNumber?: string;
  items: OrderItem[];
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
};

export type ShippingInfoInput = {
  carrier: string;
  trackingNumber: string;
  shippedDate: string;
};

export type AdminDocumentInput = {
  invoiceNumber?: string;
  deliveryNoteNumber?: string;
  erpNumber?: string;
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
  manufacturerName?: string;
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
  dimensions?: {
    width?: number;
    height?: number;
    length?: number;
    unit?: string;
  };
  customFields?: Record<string, any>;
  
  // Timestamps
  createdAt?: string;
  updatedAt?: string;
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

// Rule-based cross-selling system
export type RuleConditionOperator = "equals" | "notEquals" | "contains" | "notContains" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual" | "matchesDimensions";

export type RuleCondition = {
  field: string; // e.g., "categoryNames", "dimensions.height", "customFields.regalSystem"
  operator: RuleConditionOperator;
  value: string | number | string[] | number[];
};

export type RuleTargetCriteria = {
  field: string; // e.g., "categoryNames", "dimensions"
  matchType: "exact" | "contains" | "sameDimensions" | "sameProperty";
  value?: string | number | string[];
};

export type CrossSellingRule = {
  id: string;
  name: string;
  description?: string;
  active: number; // 1 = active, 0 = inactive (matching database integer type)
  
  // When to apply this rule - conditions on the source product
  sourceConditions: RuleCondition[];
  
  // What products to suggest - criteria for target products
  targetCriteria: RuleTargetCriteria[];
  
  // Metadata
  createdAt: string;
  updatedAt: string;
};

// Database table for cross-selling rules
export const crossSellingRules = pgTable("cross_selling_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
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
    matchType: z.enum(["exact", "contains", "sameDimensions", "sameProperty"]),
    value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  })),
});

export type InsertCrossSellingRule = z.infer<typeof insertCrossSellingRuleSchema>;
export type SelectCrossSellingRule = typeof crossSellingRules.$inferSelect;

// Ticket System
export type TicketStatus = "open" | "in_progress" | "waiting_for_customer" | "waiting_for_internal" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketCategory = "general" | "order_issue" | "product_inquiry" | "technical_support" | "complaint" | "feature_request" | "other";

export const tickets = pgTable("tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
});

export const ticketComments = pgTable("ticket_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  comment: text("comment").notNull(),
  isInternal: integer("is_internal").notNull().default(0), // 0 = public, 1 = internal note
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ticketAttachments = pgTable("ticket_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  category: z.enum(["general", "order_issue", "product_inquiry", "technical_support", "complaint", "feature_request", "other"]).default("general"),
});

export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({
  id: true,
  createdAt: true,
});

export const insertTicketAttachmentSchema = createInsertSchema(ticketAttachments).omit({
  id: true,
  createdAt: true,
});

export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;
export type TicketComment = typeof ticketComments.$inferSelect;
export type InsertTicketAttachment = z.infer<typeof insertTicketAttachmentSchema>;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
