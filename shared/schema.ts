import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("employee"), // employee or admin
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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
