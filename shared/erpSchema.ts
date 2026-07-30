/**
 * ERP-Kernschema: Warenwirtschaft, Einkauf, Retouren, Fibu, Produktion, Versand.
 * FK auf tenants wird in der SQL-Migration erzwungen (kein Circular-Import).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ========== Warenwirtschaft ==========

export const erpWarehouses = pgTable(
  "erp_warehouses",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: jsonb("address").$type<Record<string, string>>().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantCodeUnique: uniqueIndex("erp_warehouses_tenant_code_unique").on(table.tenantId, table.code),
  }),
);

/** Regaltyp / Art des Regals inkl. Hersteller (Standard: META). */
export const erpShelfTypes = pgTable(
  "erp_shelf_types",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    manufacturer: text("manufacturer").notNull().default("META"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantCodeUnique: uniqueIndex("erp_shelf_types_tenant_code_unique").on(table.tenantId, table.code),
  }),
);

export const erpWarehouseLocations = pgTable(
  "erp_warehouse_locations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    warehouseId: varchar("warehouse_id").notNull(),
    code: text("code").notNull(),
    name: text("name"),
    shelfTypeId: varchar("shelf_type_id"),
    regalzeile: text("regalzeile"),
    regalfeld: text("regalfeld"),
    regalfach: text("regalfach"),
    regalplatz: text("regalplatz"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    whCodeUnique: uniqueIndex("erp_warehouse_locations_wh_code_unique").on(table.warehouseId, table.code),
  }),
);

export const erpStockLevels = pgTable(
  "erp_stock_levels",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    warehouseId: varchar("warehouse_id").notNull(),
    locationId: varchar("location_id"),
    productNumber: text("product_number").notNull(),
    quantity: real("quantity").notNull().default(0),
    reservedQuantity: real("reserved_quantity").notNull().default(0),
    minQuantity: real("min_quantity").notNull().default(0),
    reorderPoint: real("reorder_point").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    productIdx: index("erp_stock_levels_tenant_product_idx").on(table.tenantId, table.productNumber),
  }),
);

export const erpStockMovements = pgTable(
  "erp_stock_movements",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    warehouseId: varchar("warehouse_id").notNull(),
    locationId: varchar("location_id"),
    productNumber: text("product_number").notNull(),
    quantity: real("quantity").notNull(),
    movementType: text("movement_type").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("erp_stock_movements_tenant_idx").on(table.tenantId),
  }),
);

export const erpInventoryCounts = pgTable("erp_inventory_counts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  warehouseId: varchar("warehouse_id").notNull(),
  status: text("status").notNull().default("draft"),
  countedAt: timestamp("counted_at"),
  createdBy: text("created_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const erpInventoryCountLines = pgTable("erp_inventory_count_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryCountId: varchar("inventory_count_id").notNull(),
  productNumber: text("product_number").notNull(),
  expectedQty: real("expected_qty").notNull().default(0),
  countedQty: real("counted_qty"),
  difference: real("difference"),
});

// ========== Einkauf ==========

export const erpSuppliers = pgTable(
  "erp_suppliers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    number: text("number").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: jsonb("address").$type<Record<string, string>>().default({}),
    paymentTerms: text("payment_terms"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantNumberUnique: uniqueIndex("erp_suppliers_tenant_number_unique").on(table.tenantId, table.number),
  }),
);

export const erpSupplierPriceLists = pgTable(
  "erp_supplier_price_lists",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull(),
    supplierId: varchar("supplier_id").notNull(),
    name: text("name"),
    currency: text("currency").notNull().default("EUR"),
    active: boolean("active").notNull().default(true),
    sourceFilename: text("source_filename"),
    importedAt: timestamp("imported_at"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantSupplierUnique: uniqueIndex("erp_supplier_price_lists_tenant_supplier_unique").on(
      table.tenantId,
      table.supplierId,
    ),
    supplierIdx: index("erp_supplier_price_lists_supplier_idx").on(table.supplierId),
  }),
);

export const erpSupplierPriceListLines = pgTable(
  "erp_supplier_price_list_lines",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    priceListId: varchar("price_list_id").notNull(),
    productNumber: text("product_number").notNull(),
    unitPrice: real("unit_price").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
  },
  (table) => ({
    listProductUnique: uniqueIndex("erp_supplier_price_list_lines_list_product_unique").on(
      table.priceListId,
      table.productNumber,
    ),
    listIdx: index("erp_supplier_price_list_lines_list_idx").on(table.priceListId),
    productIdx: index("erp_supplier_price_list_lines_product_idx").on(table.productNumber),
  }),
);

export const erpPurchaseOrders = pgTable(
  "erp_purchase_orders",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    supplierId: varchar("supplier_id").notNull(),
    number: text("number").notNull(),
    status: text("status").notNull().default("draft"),
    warehouseId: varchar("warehouse_id"),
    orderedAt: timestamp("ordered_at"),
    expectedAt: timestamp("expected_at"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantNumberUnique: uniqueIndex("erp_purchase_orders_tenant_number_unique").on(table.tenantId, table.number),
  }),
);

export const erpPurchaseOrderLines = pgTable("erp_purchase_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  productNumber: text("product_number").notNull(),
  quantity: real("quantity").notNull(),
  receivedQuantity: real("received_quantity").notNull().default(0),
  unitPrice: real("unit_price").notNull().default(0),
  herstellkostenNet: real("herstellkosten_net"),
});

export const erpGoodsReceipts = pgTable(
  "erp_goods_receipts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    purchaseOrderId: varchar("purchase_order_id").notNull(),
    warehouseId: varchar("warehouse_id").notNull(),
    number: text("number").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    createdBy: text("created_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantNumberUnique: uniqueIndex("erp_goods_receipts_tenant_number_unique").on(table.tenantId, table.number),
  }),
);

export const erpGoodsReceiptLines = pgTable("erp_goods_receipt_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  goodsReceiptId: varchar("goods_receipt_id").notNull(),
  purchaseOrderLineId: varchar("purchase_order_line_id"),
  productNumber: text("product_number").notNull(),
  quantity: real("quantity").notNull(),
});

export const erpSupplierInvoices = pgTable(
  "erp_supplier_invoices",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    supplierId: varchar("supplier_id").notNull(),
    purchaseOrderId: varchar("purchase_order_id"),
    number: text("number").notNull(),
    amountNet: real("amount_net").notNull().default(0),
    amountGross: real("amount_gross").notNull().default(0),
    invoiceDate: timestamp("invoice_date"),
    status: text("status").notNull().default("open"),
    filePath: text("file_path"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantNumberUnique: uniqueIndex("erp_supplier_invoices_tenant_number_unique").on(table.tenantId, table.number),
  }),
);

// ========== Retouren ==========

export const erpReturns = pgTable(
  "erp_returns",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    shopwareOrderId: text("shopware_order_id"),
    shopwareOrderNumber: text("shopware_order_number"),
    customerEmail: text("customer_email"),
    status: text("status").notNull().default("requested"),
    reason: text("reason"),
    warehouseId: varchar("warehouse_id"),
    creditNoteNumber: text("credit_note_number"),
    creditAmount: real("credit_amount"),
    creditPdfPath: text("credit_pdf_path"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("erp_returns_tenant_idx").on(table.tenantId),
  }),
);

export const erpReturnLines = pgTable("erp_return_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  returnId: varchar("return_id").notNull(),
  productNumber: text("product_number").notNull(),
  quantity: real("quantity").notNull(),
  restock: boolean("restock").notNull().default(true),
  unitPrice: real("unit_price").notNull().default(0),
});

// ========== Fibu ==========

export const erpOpenItems = pgTable(
  "erp_open_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    type: text("type").notNull(),
    partnerType: text("partner_type").notNull(),
    partnerId: text("partner_id"),
    partnerName: text("partner_name"),
    documentNumber: text("document_number").notNull(),
    documentDate: timestamp("document_date"),
    dueDate: timestamp("due_date"),
    amount: real("amount").notNull(),
    openAmount: real("open_amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: text("status").notNull().default("open"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("erp_open_items_tenant_idx").on(table.tenantId),
  }),
);

export const erpPayments = pgTable("erp_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  openItemId: varchar("open_item_id").notNull(),
  amount: real("amount").notNull(),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),
  method: text("method"),
  reference: text("reference"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ========== Produktion ==========

export const erpBoms = pgTable(
  "erp_boms",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull(),
    productNumber: text("product_number").notNull(),
    name: text("name"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantProductUnique: uniqueIndex("erp_boms_tenant_product_unique").on(
      table.tenantId,
      table.productNumber,
    ),
    tenantIdx: index("erp_boms_tenant_idx").on(table.tenantId),
  }),
);

export const erpBomLines = pgTable(
  "erp_bom_lines",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    bomId: varchar("bom_id").notNull(),
    productNumber: text("product_number").notNull(),
    quantity: real("quantity").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
  },
  (table) => ({
    bomProductUnique: uniqueIndex("erp_bom_lines_bom_product_unique").on(
      table.bomId,
      table.productNumber,
    ),
    bomIdx: index("erp_bom_lines_bom_idx").on(table.bomId),
  }),
);

export const erpProductionOrders = pgTable(
  "erp_production_orders",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    number: text("number").notNull(),
    productNumber: text("product_number").notNull(),
    quantity: real("quantity").notNull(),
    status: text("status").notNull().default("planned"),
    warehouseId: varchar("warehouse_id"),
    bom: jsonb("bom")
      .$type<Array<{ productNumber: string; quantity: number }>>()
      .default([]),
    plannedStart: timestamp("planned_start"),
    plannedEnd: timestamp("planned_end"),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantNumberUnique: uniqueIndex("erp_production_orders_tenant_number_unique").on(
      table.tenantId,
      table.number,
    ),
  }),
);

export const erpProductionMaterials = pgTable("erp_production_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productionOrderId: varchar("production_order_id").notNull(),
  productNumber: text("product_number").notNull(),
  requiredQty: real("required_qty").notNull(),
  issuedQty: real("issued_qty").notNull().default(0),
});

// ========== Versand ==========

export const erpShippingProviderSettings = pgTable(
  "erp_shipping_provider_settings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull(),
    provider: text("provider").notNull(),
    publicKey: text("public_key"),
    secretKey: text("secret_key"),
    enabled: boolean("enabled").notNull().default(false),
    sandboxMode: boolean("sandbox_mode").notNull().default(true),
    defaultShippingMethodId: text("default_shipping_method_id"),
    defaultShippingMethodCode: text("default_shipping_method_code"),
    senderAddressId: text("sender_address_id"),
    rawConfig: jsonb("raw_config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantProviderUnique: uniqueIndex("erp_shipping_provider_settings_tenant_provider_unique").on(
      table.tenantId,
      table.provider,
    ),
    tenantIdx: index("erp_shipping_provider_settings_tenant_idx").on(table.tenantId),
  }),
);

export const erpShippingLabels = pgTable(
  "erp_shipping_labels",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id"),
    shopwareOrderId: text("shopware_order_id"),
    orderNumber: text("order_number"),
    carrierCode: text("carrier_code").notNull(),
    trackingNumber: text("tracking_number"),
    labelUrl: text("label_url"),
    labelStatus: text("label_status").notNull().default("draft"),
    packageWeight: real("package_weight"),
    packageCount: integer("package_count").notNull().default(1),
    recipient: jsonb("recipient").$type<Record<string, string>>().default({}),
    rawResponse: jsonb("raw_response"),
    provider: text("provider"),
    externalParcelId: text("external_parcel_id"),
    labelFilePath: text("label_file_path"),
    shippingMethodCode: text("shipping_method_code"),
    carrierStatus: text("carrier_status"),
    carrierStatusMessage: text("carrier_status_message"),
    carrierStatusId: integer("carrier_status_id"),
    lastWebhookAt: timestamp("last_webhook_at"),
    lastWebhookPayload: jsonb("last_webhook_payload"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("erp_shipping_labels_tenant_idx").on(table.tenantId),
  }),
);

export const erpPickLists = pgTable("erp_pick_lists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  warehouseId: varchar("warehouse_id"),
  status: text("status").notNull().default("open"),
  orderRefs: jsonb("order_refs")
    .$type<Array<{ orderId?: string; orderNumber?: string }>>()
    .notNull()
    .default([]),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const erpPickListLines = pgTable("erp_pick_list_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pickListId: varchar("pick_list_id").notNull(),
  productNumber: text("product_number").notNull(),
  quantity: real("quantity").notNull(),
  pickedQuantity: real("picked_quantity").notNull().default(0),
  locationCode: text("location_code"),
  orderNumber: text("order_number"),
});

// Insert schemas & types
export const insertErpWarehouseSchema = createInsertSchema(erpWarehouses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertErpWarehouse = z.infer<typeof insertErpWarehouseSchema>;
export type ErpWarehouse = typeof erpWarehouses.$inferSelect;

export const insertErpSupplierSchema = createInsertSchema(erpSuppliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertErpSupplier = z.infer<typeof insertErpSupplierSchema>;
export type ErpSupplier = typeof erpSuppliers.$inferSelect;
export type ErpSupplierPriceList = typeof erpSupplierPriceLists.$inferSelect;
export type ErpSupplierPriceListLine = typeof erpSupplierPriceListLines.$inferSelect;

export const insertErpShelfTypeSchema = createInsertSchema(erpShelfTypes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertErpShelfType = z.infer<typeof insertErpShelfTypeSchema>;
export type ErpShelfType = typeof erpShelfTypes.$inferSelect;

export const insertErpWarehouseLocationSchema = createInsertSchema(erpWarehouseLocations).omit({
  id: true,
  createdAt: true,
});
export type InsertErpWarehouseLocation = z.infer<typeof insertErpWarehouseLocationSchema>;
export type ErpWarehouseLocation = typeof erpWarehouseLocations.$inferSelect;
export type ErpStockLevel = typeof erpStockLevels.$inferSelect;
export type ErpStockMovement = typeof erpStockMovements.$inferSelect;
export type ErpInventoryCount = typeof erpInventoryCounts.$inferSelect;
export type ErpInventoryCountLine = typeof erpInventoryCountLines.$inferSelect;
export type ErpPurchaseOrder = typeof erpPurchaseOrders.$inferSelect;
export type ErpPurchaseOrderLine = typeof erpPurchaseOrderLines.$inferSelect;
export type ErpGoodsReceipt = typeof erpGoodsReceipts.$inferSelect;
export type ErpGoodsReceiptLine = typeof erpGoodsReceiptLines.$inferSelect;
export type ErpSupplierInvoice = typeof erpSupplierInvoices.$inferSelect;
export type ErpReturn = typeof erpReturns.$inferSelect;
export type ErpReturnLine = typeof erpReturnLines.$inferSelect;
export type ErpOpenItem = typeof erpOpenItems.$inferSelect;
export type ErpPayment = typeof erpPayments.$inferSelect;
export type ErpBom = typeof erpBoms.$inferSelect;
export type ErpBomLine = typeof erpBomLines.$inferSelect;
export type ErpProductionOrder = typeof erpProductionOrders.$inferSelect;
export type ErpProductionMaterial = typeof erpProductionMaterials.$inferSelect;
export type ErpShippingProviderSettings = typeof erpShippingProviderSettings.$inferSelect;
export type ErpShippingLabel = typeof erpShippingLabels.$inferSelect;
export type ErpPickList = typeof erpPickLists.$inferSelect;
export type ErpPickListLine = typeof erpPickListLines.$inferSelect;

export type StockMovementType =
  | "receipt"
  | "issue"
  | "transfer"
  | "adjustment"
  | "reservation"
  | "release"
  | "return"
  | "production_issue"
  | "production_receipt";
