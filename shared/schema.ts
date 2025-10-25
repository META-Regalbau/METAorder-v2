import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("employee"), // employee or admin
  salesChannelIds: text("sales_channel_ids").array(), // null/empty = all channels (for admin)
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Role management
export type Role = {
  id: string;
  name: string;
  salesChannelIds?: string[]; // null/empty = all channels
  permissions: {
    viewOrders: boolean;
    editOrders: boolean;
    exportData: boolean;
    viewAnalytics: boolean;
    manageUsers: boolean;
    manageRoles: boolean;
    manageSettings: boolean;
  };
};

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

export type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  orderDate: string;
  totalAmount: number;
  status: OrderStatus;
  salesChannelId: string;
  salesChannelName?: string;
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
  price: number;
  total: number;
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
  price: number;
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
  price: number;
  stock: number;
  available: boolean;
};

export type Product = {
  id: string;
  productNumber: string;
  name: string;
  description?: string;
  price: number;
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
