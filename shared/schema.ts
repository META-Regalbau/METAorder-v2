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
    viewShipping: boolean;
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
  dueDate: timestamp("due_date"), // Fälligkeitsdatum/SLA
  tags: text("tags").array(), // Ticket tags/labels
  emailSubject: text("email_subject"), // Original email subject if created from email
  emailFrom: text("email_from"), // Original email sender if created from email
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

export const ticketCommentViews = pgTable("ticket_comment_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: varchar("comment_id").notNull().references(() => ticketComments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export const ticketAttachmentViews = pgTable("ticket_attachment_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  attachmentId: varchar("attachment_id").notNull().references(() => ticketAttachments.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export const ticketActivityLog = pgTable("ticket_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  category: z.enum(["general", "order_issue", "product_inquiry", "technical_support", "complaint", "feature_request", "other"]).default("general"),
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

// Notifications for real-time user alerts
export type NotificationType = "ticket_assigned" | "ticket_updated" | "comment_added" | "due_date_warning" | "ticket_status_changed";

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
