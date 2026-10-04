// Bestellungen: Liste/Abfrage/Export, Details, Dokumente, Rechnungen, Versand, Mondu, Teilzahlungsplaene.
import { requireAuth, requireViewDelayedOrders, requireManageDocuments, requireCsrf, requireEditOrders } from "../auth/auth";
import { storage } from "../storage";
import { ShopwareClient, getRealInvoiceDocument, isMonduPluginShipError, ZUGFERD_EMBEDDED_INVOICE_TYPE } from "../shopware/shopware";
import { getSalesChannelFilter, getOrdersWithCache, filterOrdersBySalesChannels, filterTicketsBySalesChannels, defaultProformaNumberRange, resolveAttachmentPath, dedupeOrdersByNumber } from "./routeHelpers";
import { filterOrdersList, sortOrdersList, computeDuplicateOrderIds, paginateOrdersList, type OrdersListQuery } from "../shopware/ordersList";
import { enrichOrdersWithProfitability, buildOrderProfitabilityAnalysisSummary, sortOrdersByMargin } from "../analytics/orderProfitabilityAnalysis";
import { enrichOrdersWithStockAvailability } from "../erp/orderStockEnrichment";
import { loadCrmProfitabilitySettings } from "../analytics/crmProfitabilitySettings";
import { z } from "zod";
import * as XLSX from "xlsx";
import { getInvoiceAutomationSettings, type SendInvoiceResult, sendOrderInvoice, markOrderInvoiceSentInCache } from "../invoicing/invoiceSending";
import { webhookService, type DocumentCreatedPayload } from "../lib/webhookService";
import { settlementInvoicePdfBodySchema, additionalInvoiceBodySchema, createInstallmentPlanBodySchema, type Order, type InstallmentPlan, type InstallmentInvoice } from "@shared/schema";
import { type SettlementInvoicePdfInput, generateSettlementInvoicePdf } from "../invoicing/settlementInvoicePdf";
import { generateAdditionalInvoicePdf } from "../invoicing/additionalInvoicePdf";
import { type InstallmentAgreementLine, generateInstallmentAgreementPdf } from "../invoicing/installmentAgreementPdf";
import path from "path";
import { getUploadsRoot } from "../uploadsRoot";
import fs from "fs/promises";
import { type InstallmentInvoicePdfInput, generateInstallmentInvoicePdf } from "../invoicing/installmentInvoicePdf";
import archiver from "archiver";
import type { Request, Response, Express } from "express";

/** Gleiche Sichtbarkeit wie GET /api/orders/:orderId — Lesezugriff auf Ratenpläne ohne viewDocuments */
async function assertInstallmentOrderAccess(
  req: Request,
  orderId: string,
  tenantId: string | null
): Promise<{ ok: true } | { ok: false; status: number; body: { error: string } }> {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    return { ok: false, status: 400, body: { error: "Shopware settings not configured" } };
  }
  let allowedChannelIds: string[] | null;
  try {
    allowedChannelIds = await getSalesChannelFilter(req);
  } catch (authError) {
    console.error("[assertInstallmentOrderAccess] channel filter:", authError);
    return { ok: false, status: 403, body: { error: "Access denied: authentication error" } };
  }
  if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
    return { ok: false, status: 403, body: { error: "Access denied: no sales channel permissions" } };
  }
  const client = new ShopwareClient(settings);
  const order = await client.fetchOrderById(orderId, allowedChannelIds);
  if (!order) {
    return { ok: false, status: 404, body: { error: "Order not found or access denied" } };
  }
  return { ok: true };
}

function hasPermission(user: any, permission: string): boolean {
  const roleDetails = user?.roleDetails;
  if (!roleDetails) {
    return false;
  }

  const permissions = roleDetails.permissions;
  if (!permissions) {
    return false;
  }

  if (Array.isArray(permissions)) {
    return permissions.includes(permission);
  }

  return Boolean(permissions[permission]);
}

function requireViewDocumentsOrAccounting(req: Request, res: Response, next: () => void) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Please login" });
  }

  const isAdmin =
    user?.roleDetails?.name === "Administrator" ||
    user?.role === "admin";

  if (isAdmin || hasPermission(user, "viewDocuments") || hasPermission(user, "viewAccounting")) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden: viewDocuments or viewAccounting permission required" });
}

function orderTotalAmountNumber(order: Order): number {
  const t = order.totalAmount as unknown;
  return typeof t === "number" ? t : parseFloat(String(t));
}

function decimalNum(v: string | number): number {
  return typeof v === "number" ? v : parseFloat(String(v));
}

function splitRemainingInstallments(remainingGross: number, n: number): number[] {
  const cents = Math.round(remainingGross * 100);
  if (n <= 0) return [];
  const base = Math.floor(cents / n);
  const remainder = cents - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((base + (i === n - 1 ? remainder : 0)) / 100);
  }
  return out;
}

function serializeInstallmentPlan(plan: InstallmentPlan, invoices: InstallmentInvoice[]) {
  return {
    ...plan,
    totalAmount: decimalNum(plan.totalAmount as any),
    depositAmount: decimalNum(plan.depositAmount as any),
    depositPercent: plan.depositPercent ? decimalNum(plan.depositPercent as any) : null,
    remainingAmount: decimalNum(plan.remainingAmount as any),
    installmentAmount: decimalNum(plan.installmentAmount as any),
    invoices: invoices.map((inv) => ({
      ...inv,
      amount: decimalNum(inv.amount as any),
    })),
  };
}

function monduShipBlockedPayload(errorMessage: string) {
  const afterPaymentSwitch = errorMessage.includes("MONDU_SHIP_BLOCKED_AFTER_PAYMENT_SWITCH");
  return {
    error: "Mondu plugin error",
    code: afterPaymentSwitch
      ? "mondu_ship_blocked_after_payment_switch"
      : "mondu_ship_blocked",
    message: afterPaymentSwitch
      ? "Das Mondu-Plugin blockiert den Versandstatus, obwohl die aktuelle Zahlart nicht Mondu ist (Zahlart wurde im Checkout gewechselt). Bitte in Shopware prüfen: alte Mondu-Transaktion stornieren oder im Mondu-Plugin „Skip order state validation“ aktivieren."
      : "Das Mondu-Zahlungs-Plugin in Shopware verhindert die Statusänderung. Bitte den Lieferstatus manuell in Shopware setzen oder den Shopware-/Mondu-Support kontaktieren.",
    details: errorMessage,
  };
}

function parseOrdersListQuery(query: Record<string, unknown>): OrdersListQuery {
  const str = (key: string) => {
    const v = query[key];
    return typeof v === "string" ? v.trim() : undefined;
  };
  const status = str("status");
  const invoiceFilter = str("invoiceFilter");
  const orderNumberFilter = str("orderNumberFilter");
  const sortKey = str("sortKey");
  const sortDirection = str("sortDirection");

  return {
    search: str("search"),
    status:
      status === "open" ||
      status === "in_progress" ||
      status === "completed" ||
      status === "cancelled"
        ? status
        : "all",
    invoiceFilter:
      invoiceFilter === "with" ||
      invoiceFilter === "without" ||
      invoiceFilter === "unsent"
        ? invoiceFilter
        : "all",
    orderNumberFilter: orderNumberFilter === "mo" ? "mo" : "all",
    dateFrom: str("dateFrom"),
    dateTo: str("dateTo"),
    sortKey:
      sortKey === "orderNumber" ||
      sortKey === "customerName" ||
      sortKey === "orderDate" ||
      sortKey === "status" ||
      sortKey === "totalAmount" ||
      sortKey === "trackingNumber"
        ? sortKey
        : "orderDate",
    sortDirection: sortDirection === "asc" ? "asc" : "desc",
  };
}

export function registerOrderRoutes(app: Express): void {
  // Orders routes
  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      
      // Parse pagination parameters
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";
      
      // Pagination wenn limit/offset ODER Listen-Filter gesetzt (Bestellübersicht)
      const usePagination =
        req.query.limit !== undefined ||
        req.query.offset !== undefined ||
        req.query.search !== undefined ||
        req.query.status !== undefined ||
        req.query.invoiceFilter !== undefined ||
        req.query.orderNumberFilter !== undefined ||
        req.query.dateFrom !== undefined ||
        req.query.dateTo !== undefined;
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      const listQuery = parseOrdersListQuery(req.query as Record<string, unknown>);
      
      if (usePagination) {
        const { orders: cachedOrders } = await getOrdersWithCache(
          client,
          tenantId,
          { forceRefresh },
        );

        let filteredOrders = filterOrdersBySalesChannels(cachedOrders, allowedChannelIds);
        filteredOrders = filterOrdersList(filteredOrders, listQuery);
        filteredOrders = sortOrdersList(filteredOrders, listQuery);
        const duplicateIds = computeDuplicateOrderIds(filteredOrders);
        const total = filteredOrders.length;
        const pageOrders = paginateOrdersList(filteredOrders, limit, offset);
        const duplicateOrderIds = pageOrders
          .filter((o) => duplicateIds.has(o.id))
          .map((o) => o.id);

        const enrichedPage = await enrichOrdersWithProfitability(pageOrders, {
          storage,
          client,
          tenantId,
        });
        const withStock = await enrichOrdersWithStockAvailability(enrichedPage, tenantId);

        res.json({
          orders: withStock,
          total,
          limit,
          offset,
          duplicateOrderIds,
        });
      } else {
        const { orders } = await getOrdersWithCache(client, tenantId, { forceRefresh });

        const filteredOrders = filterOrdersBySalesChannels(orders, allowedChannelIds);
        const withStock = await enrichOrdersWithStockAvailability(filteredOrders, tenantId);
        
        res.json(withStock);
      }
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/db-summary", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allowedChannelIds = await getSalesChannelFilter(req);
      const listQuery = parseOrdersListQuery(req.query as Record<string, unknown>);
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";

      const { orders: cachedOrders } = await getOrdersWithCache(client, tenantId, { forceRefresh });
      let filteredOrders = filterOrdersBySalesChannels(cachedOrders, allowedChannelIds);
      filteredOrders = filterOrdersList(filteredOrders, listQuery);

      const enrichedOrders = await enrichOrdersWithProfitability(filteredOrders, {
        storage,
        client,
        tenantId,
      });
      const summary = buildOrderProfitabilityAnalysisSummary(enrichedOrders);

      res.json({
        avgDb1: summary.avgDb1,
        ordersWithDb1: summary.ordersWithHerstellpreis,
        totalFiltered: summary.totalOrders,
      });
    } catch (error: any) {
      console.error("[/api/orders/db-summary] Error:", error?.message || error);
      res.status(500).json({ error: error.message || "DB-Zusammenfassung fehlgeschlagen" });
    }
  });

  app.get("/api/orders/profitability-analysis", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const allowedChannelIds = await getSalesChannelFilter(req);
      const listQuery = parseOrdersListQuery(req.query as Record<string, unknown>);
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";

      const { orders: cachedOrders } = await getOrdersWithCache(client, tenantId, { forceRefresh });
      let filteredOrders = filterOrdersBySalesChannels(cachedOrders, allowedChannelIds);
      filteredOrders = filterOrdersList(filteredOrders, listQuery);

      const enrichedOrders = await enrichOrdersWithProfitability(filteredOrders, {
        storage,
        client,
        tenantId,
      });
      const profitabilitySettings = await loadCrmProfitabilitySettings(storage, tenantId);
      const summary = buildOrderProfitabilityAnalysisSummary(enrichedOrders);
      const worstOrders = sortOrdersByMargin(enrichedOrders, "asc", 15);
      const bestOrders = sortOrdersByMargin(enrichedOrders, "desc", 10);

      res.json({
        orders: enrichedOrders,
        summary,
        worstOrders,
        bestOrders,
        total: enrichedOrders.length,
        profitabilityMinMarginPercent: profitabilitySettings.minMarginPercent,
      });
    } catch (error: any) {
      console.error("[/api/orders/profitability-analysis] Error:", error?.message || error);
      res.status(500).json({ error: error.message || "Bestell-Analyse fehlgeschlagen" });
    }
  });

  // Advanced query endpoint for n8n automation and filtering
  app.get("/api/orders/query", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // Pre-process and normalize query parameters
      // Handle arrays, trim whitespace, provide clear error messages
      const normalizedQuery: any = {};
      for (const [key, value] of Object.entries(req.query)) {
        if (Array.isArray(value)) {
          // Take first value for repeated params, reject array-style params (e.g., param[]=value)
          if (value.length === 0) {
            continue; // Skip empty arrays
          }
          const firstValue = value[0];
          if (typeof firstValue === 'string') {
            normalizedQuery[key] = firstValue.trim();
          } else {
            normalizedQuery[key] = firstValue;
          }
        } else if (typeof value === 'string') {
          normalizedQuery[key] = value.trim(); // Trim whitespace
        } else {
          normalizedQuery[key] = value;
        }
      }

      // Validate query parameters with actionable error messages
      const querySchema = z.object({
        // Date range filters (flexible ISO 8601 format with trimming)
        // Accepts: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SSZ, etc.
        orderDateFrom: z.string({
          invalid_type_error: "orderDateFrom must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        orderDateTo: z.string({
          invalid_type_error: "orderDateTo must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        invoiceDateFrom: z.string({
          invalid_type_error: "invoiceDateFrom must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        invoiceDateTo: z.string({
          invalid_type_error: "invoiceDateTo must be a string in ISO 8601 format (e.g., 2025-01-15)",
        }).optional(),
        
        // Status filters with clear error messages
        status: z.enum(['open', 'in_progress', 'completed', 'cancelled'], {
          errorMap: () => ({ message: "status must be one of: open, in_progress, completed, cancelled" }),
        }).optional(),
        paymentStatus: z.enum(['open', 'paid', 'authorized', 'partially_paid', 'refunded', 'cancelled', 'reminded', 'failed'], {
          errorMap: () => ({ message: "paymentStatus must be one of: open, paid, authorized, partially_paid, refunded, cancelled, reminded, failed" }),
        }).optional(),
        
        // Boolean filters with clear error messages
        hasInvoice: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "hasInvoice must be 'true' or 'false' (as string)" }),
        }).optional(),
        hasDeliveryNote: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "hasDeliveryNote must be 'true' or 'false' (as string)" }),
        }).optional(),
        paymentOverdue: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "paymentOverdue must be 'true' or 'false' (as string)" }),
        }).optional(),
        isShipped: z.enum(['true', 'false'], {
          errorMap: () => ({ message: "isShipped must be 'true' or 'false' (as string)" }),
        }).optional(),
        
        // Pagination with strict bounds and clear errors
        limit: z.coerce.number({
          invalid_type_error: "limit must be a number between 1 and 500",
        }).int("limit must be an integer").min(1, "limit must be at least 1").max(500, "limit cannot exceed 500").optional(),
        offset: z.coerce.number({
          invalid_type_error: "offset must be a non-negative number",
        }).int("offset must be an integer").min(0, "offset cannot be negative").optional(),
      });

      const validated = querySchema.parse(normalizedQuery);
      
      // Parse pagination with safe defaults
      const limit = validated.limit ?? 100; // Default: 100, max: 500
      const offset = validated.offset ?? 0;
      
      // Validate dates are actually valid (trimmed whitespace already handled)
      if (validated.orderDateFrom) {
        const date = new Date(validated.orderDateFrom);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid orderDateFrom date value", 
            message: `'${validated.orderDateFrom}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }
      if (validated.orderDateTo) {
        const date = new Date(validated.orderDateTo);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid orderDateTo date value",
            message: `'${validated.orderDateTo}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }
      if (validated.invoiceDateFrom) {
        const date = new Date(validated.invoiceDateFrom);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid invoiceDateFrom date value",
            message: `'${validated.invoiceDateFrom}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }
      if (validated.invoiceDateTo) {
        const date = new Date(validated.invoiceDateTo);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ 
            error: "Invalid invoiceDateTo date value",
            message: `'${validated.invoiceDateTo}' is not a valid ISO 8601 date. Use format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ` 
          });
        }
      }

      const client = new ShopwareClient(settings);
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // Fetch all orders with sales channel filtering
      const allOrders = await client.fetchOrders(allowedChannelIds);
      
      // SECURITY: Double-check filtering locally as defense-in-depth
      let filteredOrders = filterOrdersBySalesChannels(allOrders, allowedChannelIds);
      
      // Apply date filters
      if (validated.orderDateFrom) {
        const fromDate = new Date(validated.orderDateFrom);
        filteredOrders = filteredOrders.filter(order => new Date(order.orderDate) >= fromDate);
      }
      
      if (validated.orderDateTo) {
        const toDate = new Date(validated.orderDateTo);
        filteredOrders = filteredOrders.filter(order => new Date(order.orderDate) <= toDate);
      }
      
      if (validated.invoiceDateFrom) {
        const fromDate = new Date(validated.invoiceDateFrom);
        filteredOrders = filteredOrders.filter(order => 
          order.invoiceDate && new Date(order.invoiceDate) >= fromDate
        );
      }
      
      if (validated.invoiceDateTo) {
        const toDate = new Date(validated.invoiceDateTo);
        filteredOrders = filteredOrders.filter(order => 
          order.invoiceDate && new Date(order.invoiceDate) <= toDate
        );
      }
      
      // Apply status filters
      if (validated.status) {
        filteredOrders = filteredOrders.filter(order => order.status === validated.status);
      }
      
      if (validated.paymentStatus) {
        filteredOrders = filteredOrders.filter(order => order.paymentStatus === validated.paymentStatus);
      }
      
      // Apply boolean filters
      if (validated.hasInvoice === 'true') {
        filteredOrders = filteredOrders.filter(order => !!order.invoiceNumber);
      } else if (validated.hasInvoice === 'false') {
        filteredOrders = filteredOrders.filter(order => !order.invoiceNumber);
      }
      
      if (validated.hasDeliveryNote === 'true') {
        filteredOrders = filteredOrders.filter(order => !!order.deliveryNoteNumber);
      } else if (validated.hasDeliveryNote === 'false') {
        filteredOrders = filteredOrders.filter(order => !order.deliveryNoteNumber);
      }
      
      if (validated.paymentOverdue === 'true') {
        filteredOrders = filteredOrders.filter(order => order.isPaymentOverdue === true);
      } else if (validated.paymentOverdue === 'false') {
        filteredOrders = filteredOrders.filter(order => order.isPaymentOverdue !== true);
      }
      
      if (validated.isShipped === 'true') {
        filteredOrders = filteredOrders.filter(order => 
          order.status === 'completed' || (order.shippingInfo && order.shippingInfo.shippedDate)
        );
      } else if (validated.isShipped === 'false') {
        filteredOrders = filteredOrders.filter(order => 
          order.status !== 'completed' && (!order.shippingInfo || !order.shippingInfo.shippedDate)
        );
      }
      
      // Calculate total before pagination
      const total = filteredOrders.length;
      
      // Apply pagination
      const paginatedOrders = filteredOrders.slice(offset, offset + limit);
      
      res.json({
        orders: paginatedOrders,
        total,
        limit,
        offset,
        filters: {
          orderDateFrom: validated.orderDateFrom,
          orderDateTo: validated.orderDateTo,
          invoiceDateFrom: validated.invoiceDateFrom,
          invoiceDateTo: validated.invoiceDateTo,
          status: validated.status,
          paymentStatus: validated.paymentStatus,
          hasInvoice: validated.hasInvoice,
          hasDeliveryNote: validated.hasDeliveryNote,
          paymentOverdue: validated.paymentOverdue,
          isShipped: validated.isShipped,
        },
      });
    } catch (error: any) {
      console.error("Error querying orders:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid query parameters", details: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to query orders" });
    }
  });

  // Delayed orders route
  app.get("/api/orders/delayed", requireAuth, requireViewDelayedOrders, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      // Aus dem Bestell-Spiegel statt alle Bestellungen live (Testing ~18 s); refresh=1 (nach
      // Aenderungen auf der Seite / Aktualisieren-Knopf) stoesst vorher einen Delta-Abgleich an.
      const forceRefresh = req.query.refresh === "true" || req.query.refresh === "1";
      const { orders: mirrorOrders } = await getOrdersWithCache(client, (req as any).tenantId ?? null, { forceRefresh });
      const orders = dedupeOrdersByNumber(mirrorOrders);
      
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      // SECURITY: Filter by user's assigned sales channels FIRST
      const accessibleOrders = filterOrdersBySalesChannels(orders, allowedChannelIds);
      
      // Default threshold: 3 days
      const daysThreshold = parseInt(req.query.days as string) || 3;
      const now = new Date();
      const thresholdDate = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000);
      
      // Filter delayed orders: deliveryDateLatest passed or order old, not completed/cancelled, and payment is paid
      const delayedOrders = accessibleOrders
        .filter(order => {
          // Must not be completed or cancelled
          const isNotFinished = order.status !== 'completed' && order.status !== 'cancelled';
          
          // Payment must be paid (not failed, cancelled, or open)
          const hasValidPayment = order.paymentStatus === 'paid';
          
          if (!isNotFinished || !hasValidPayment) {
            return false;
          }
          
          // Check if delivery date is overdue or order is old
          if (order.deliveryDateLatest) {
            const deliveryDate = new Date(order.deliveryDateLatest);
            const isOverdue = deliveryDate < thresholdDate;
            return isOverdue;
          } else {
            // Fallback to order date if no delivery date
            const orderDate = new Date(order.orderDate);
            const isOld = orderDate < thresholdDate;
            return isOld;
          }
        })
        .map(order => {
          // Calculate days since expected delivery (or order date as fallback)
          const referenceDate = order.deliveryDateLatest 
            ? new Date(order.deliveryDateLatest)
            : new Date(order.orderDate);
          const daysSinceOrder = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
          
          return {
            ...order,
            daysSinceOrder,
          };
        })
        .sort((a, b) => {
          // Sort by delivery date (latest delivery date first = most overdue)
          const dateA = a.deliveryDateLatest ? new Date(a.deliveryDateLatest) : new Date(a.orderDate);
          const dateB = b.deliveryDateLatest ? new Date(b.deliveryDateLatest) : new Date(b.orderDate);
          return dateA.getTime() - dateB.getTime(); // Earliest date first (most overdue)
        });
      
      res.json(delayedOrders);
    } catch (error: any) {
      console.error("Error fetching delayed orders:", error);
      res.status(500).json({ error: error.message || "Failed to fetch delayed orders" });
    }
  });

  // Export orders endpoint
  app.post("/api/orders/export", requireAuth, async (req, res) => {
    try {
      // Validate request body
      const exportSchema = z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        format: z.enum(['csv', 'xlsx', 'json']),
        columns: z.array(z.string()).min(1, "At least one column must be selected"),
        salesChannelIds: z.array(z.string()).optional(), // Admin can select specific channels
      });

      const validated = exportSchema.parse(req.body);
      const { dateFrom, dateTo, format, columns, salesChannelIds } = validated;

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      // Aus dem Bestell-Spiegel statt alle Bestellungen live; eine Bestellung je Bestellnummer
      // wie zuvor bei fetchOrders.
      const { orders: mirrorOrders } = await getOrdersWithCache(client, (req as any).tenantId ?? null);
      const allOrders = dedupeOrdersByNumber(mirrorOrders);

      // Verkaufskanaele wie auf den Bestellseiten (getSalesChannelFilter: Kanaele von Nutzer und
      // Rolle; null = alle, [] = keine). Wer alle Kanaele sehen darf, kann im Export einzelne
      // auswaehlen (bisher nur Admins; Rollen-Kanaele wurden ignoriert).
      const allowedChannelIds = await getSalesChannelFilter(req);
      let filteredOrders = filterOrdersBySalesChannels(allOrders, allowedChannelIds);
      if (allowedChannelIds === null && salesChannelIds && salesChannelIds.length > 0) {
        filteredOrders = filteredOrders.filter(order =>
          salesChannelIds.includes(order.salesChannelId)
        );
      }

      // Filter by date range
      if (dateFrom || dateTo) {
        filteredOrders = filteredOrders.filter(order => {
          const orderDate = new Date(order.orderDate);
          if (dateFrom && orderDate < new Date(dateFrom)) return false;
          if (dateTo && orderDate > new Date(dateTo)) return false;
          return true;
        });
      }

      // Neueste Bestellung zuerst - wie bisher der Live-Abruf; am selben Tag (orderDate ist ein
      // Datum) nach Bestellnummer absteigend, damit der Export reproduzierbar ist.
      filteredOrders = [...filteredOrders].sort(
        (a, b) =>
          new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime() ||
          String(b.orderNumber ?? "").localeCompare(String(a.orderNumber ?? ""), "de", { numeric: true })
      );

      // Extract only selected columns
      const exportData = filteredOrders.map(order => {
        const row: any = {};
        columns.forEach((col: string) => {
          switch (col) {
            case 'orderNumber':
              row['Order Number'] = order.orderNumber;
              break;
            case 'customerName':
              row['Customer Name'] = order.customerName;
              break;
            case 'customerEmail':
              row['Customer Email'] = order.customerEmail;
              break;
            case 'orderDate':
              row['Order Date'] = new Date(order.orderDate).toLocaleDateString('de-DE');
              break;
            case 'status':
              row['Status'] = order.status;
              break;
            case 'totalAmount':
              row['Total Amount (Gross)'] = `€${order.totalAmount.toFixed(2)}`;
              break;
            case 'netTotalAmount':
              row['Total Amount (Net)'] = `€${(order.netTotalAmount || 0).toFixed(2)}`;
              break;
            case 'carrier':
              row['Carrier'] = order.shippingInfo?.carrier || '';
              break;
            case 'trackingNumber':
              row['Tracking Number'] = order.shippingInfo?.trackingNumber || '';
              break;
            case 'invoiceNumber':
              row['Invoice Number'] = order.invoiceNumber || '';
              break;
            case 'deliveryNoteNumber':
              row['Delivery Note Number'] = order.deliveryNoteNumber || '';
              break;
            case 'erpNumber':
              row['ERP Number'] = order.erpNumber || '';
              break;
          }
        });
        return row;
      });

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.json"`);
        res.send(JSON.stringify(exportData, null, 2));
      } else if (format === 'csv') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.csv"`);
        res.send('\uFEFF' + csv); // BOM for proper UTF-8 encoding in Excel
      } else if (format === 'xlsx') {
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');
        
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="orders-export-${Date.now()}.xlsx"`);
        res.send(buffer);
      } else {
        res.status(400).json({ error: 'Invalid format' });
      }
    } catch (error: any) {
      console.error("Error exporting orders:", error);
      
      // Handle Zod validation errors
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }
      
      res.status(500).json({ error: error.message || "Failed to export orders" });
    }
  });

  app.get("/api/orders/:orderId/documents", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const documents = await client.fetchOrderDocuments(req.params.orderId);
      
      res.json(documents);
    } catch (error: any) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: error.message || "Failed to fetch documents" });
    }
  });

  app.get("/api/orders/:orderId/document/:documentId/:deepLinkCode", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { documentId, deepLinkCode } = req.params;
      const client = new ShopwareClient(settings);
      
      const pdfBlob = await client.downloadDocumentPdf(documentId, deepLinkCode);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="document-${documentId}.pdf"`);
      res.send(Buffer.from(await pdfBlob.arrayBuffer()));
    } catch (error: any) {
      console.error("Error downloading document:", error);
      res.status(500).json({ error: error.message || "Failed to download document" });
    }
  });

  app.post("/api/orders/invoices/by-order-numbers", requireAuth, requireViewDocumentsOrAccounting, async (req, res) => {
    try {
      const schema = z.object({
        orderNumbers: z.array(z.string()).min(1, "At least one order number is required"),
      });

      const validated = schema.parse(req.body);
      const normalizedOrderNumbers = Array.from(
        new Set(validated.orderNumbers.map((orderNumber) => orderNumber.trim()).filter(Boolean))
      );

      if (normalizedOrderNumbers.length === 0) {
        return res.status(400).json({ error: "No valid order numbers provided" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
      } catch (authError) {
        console.error(`[/api/orders/invoices/by-order-numbers] SECURITY: Auth error during channel filter:`, authError);
        return res.status(403).json({ error: "Unauthorized: No authenticated user found" });
      }

      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        return res.json({
          results: normalizedOrderNumbers.map((orderNumber) => ({
            orderNumber,
            status: "forbidden",
            message: "No sales channel access",
          })),
        });
      }

      const client = new ShopwareClient(settings);
      const results = await Promise.all(
        normalizedOrderNumbers.map(async (orderNumber) => {
          try {
            const order = await client.fetchOrderByNumber(orderNumber, allowedChannelIds);
            if (!order?.id) {
              return {
                orderNumber,
                status: "not_found",
                message: "Order not found or access denied",
              };
            }

            const documents = await client.fetchOrderDocuments(order.id);
            const invoiceDocument = getRealInvoiceDocument(documents);
            if (!invoiceDocument) {
              return {
                orderNumber,
                orderId: order.id,
                status: "no_invoice",
                message: "No invoice document found",
              };
            }

            if (!invoiceDocument.deepLinkCode) {
              return {
                orderNumber,
                orderId: order.id,
                status: "error",
                message: "Invoice document is missing deep link code",
              };
            }

            return {
              orderNumber,
              orderId: order.id,
              status: "ok",
              downloadUrl: `/api/orders/${order.id}/document/${invoiceDocument.id}/${invoiceDocument.deepLinkCode}`,
              filename: `invoice-${orderNumber}.pdf`,
            };
          } catch (error: any) {
            return {
              orderNumber,
              status: "error",
              message: error?.message || "Failed to resolve invoice",
            };
          }
        })
      );

      res.json({ results });
    } catch (error: any) {
      console.error("Error resolving invoices by order numbers:", error);

      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }

      res.status(500).json({ error: error.message || "Failed to resolve invoices" });
    }
  });

  // Get customer order history by email (lightweight for display in order detail)
  app.get("/api/orders/:orderId/customer-history", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const { email, limit } = req.query;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: "Customer email is required" });
      }

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
      } catch (authError) {
        console.error(`[/api/orders/:orderId/customer-history] SECURITY: Auth error during channel filter:`, authError);
        return res.json([]);
      }

      // SECURITY: If user has empty array (explicitly no access to any channel), return empty results
      // null = full access (admin), [] = no access, [...ids] = specific channel access
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        console.log(`[/api/orders/:orderId/customer-history] SECURITY: User has no channel access, returning empty results`);
        return res.json([]);
      }

      const client = new ShopwareClient(settings);
      const customerOrders = await client.fetchCustomerOrderHistory(
        email,
        orderId,
        limit ? parseInt(limit as string, 10) : 10,
        allowedChannelIds
      );

      res.json(customerOrders);
    } catch (error: any) {
      console.error("Error fetching customer order history:", error);
      res.status(500).json({ error: error.message || "Failed to fetch customer order history" });
    }
  });

  // Get ticket counts for all orders (must come before /api/orders/:orderId)
  app.get("/api/orders/ticket-counts", requireAuth, async (req, res) => {
    try {
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);

      const tickets = await storage.getAllTickets();

      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const user = req.user as any;
      let filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, user?.id);

      // Filter out standalone tickets (no orderId) for counts
      filteredTickets = filteredTickets.filter(ticket => ticket.orderId);

      const ticketCounts: Record<string, number> = {};
      filteredTickets.forEach(ticket => {
        if (ticket.orderId) {
          ticketCounts[ticket.orderId] = (ticketCounts[ticket.orderId] || 0) + 1;
        }
      });

      res.json(ticketCounts);
    } catch (error: any) {
      console.error("Error fetching ticket counts:", error);
      res.status(500).json({ error: "Failed to fetch ticket counts" });
    }
  });

  // Badges für die Bestellübersicht (Mahnstufe + Ratenzahlungs-Zähler je Bestellung).
  // Der Client (OrdersPage) ruft diese Route seit d896e27 auf, serverseitig fehlte sie aber —
  // die Aufrufe liefen in die :orderId-Route darunter (orderId="badge-flags"), verbrannten
  // dort ~600ms für eine zum Scheitern verurteilte Bestellsuche und die Badges blieben stumm.
  // Muss VOR /api/orders/:orderId registriert bleiben. Rein lokale DB-Abfragen, kein Shopware.
  app.get("/api/orders/badge-flags", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const [dunningStatuses, installmentPlans] = await Promise.all([
        storage.getAllOrderDunningStatuses(tenantId),
        storage.getAllInstallmentPlans(tenantId),
      ]);

      const dunningStages: Record<string, number> = {};
      for (const status of dunningStatuses) {
        if (status.orderId && status.stage > 0) dunningStages[status.orderId] = status.stage;
      }

      const installmentCounts: Record<string, number> = {};
      for (const plan of installmentPlans) {
        if (plan.orderId) installmentCounts[plan.orderId] = (installmentCounts[plan.orderId] || 0) + 1;
      }

      res.json({ dunningStages, installmentCounts });
    } catch (error: any) {
      console.error("Error fetching order badge flags:", error);
      res.status(500).json({ error: "Failed to fetch badge flags" });
    }
  });

  // Get single order by ID (with sales channel access enforcement)
  app.get("/api/orders/:orderId", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;

      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      let allowedChannelIds: string[] | null;
      try {
        allowedChannelIds = await getSalesChannelFilter(req);
      } catch (authError) {
        console.error(`[/api/orders/:orderId] SECURITY: Auth error during channel filter:`, authError);
        return res.status(403).json({ error: "Access denied: authentication error" });
      }

      // SECURITY: If user has empty array (explicitly no access to any channel), deny access
      // null = full access (admin), [] = no access, [...ids] = specific channel access
      if (Array.isArray(allowedChannelIds) && allowedChannelIds.length === 0) {
        console.log(`[/api/orders/:orderId] SECURITY: User has no channel access, denying request`);
        return res.status(403).json({ error: "Access denied: no sales channel permissions" });
      }

      const client = new ShopwareClient(settings);
      const order = await client.fetchOrderById(orderId, allowedChannelIds);

      if (!order) {
        return res.status(404).json({ error: "Order not found or access denied" });
      }

      const tenantId = (req as any).tenantId ?? null;
      const [enrichedOrder] = await enrichOrdersWithProfitability([order], {
        storage,
        client,
        tenantId,
      });

      const [withStock] = await enrichOrdersWithStockAvailability(
        [enrichedOrder ?? order],
        tenantId,
      );

      res.json(withStock ?? enrichedOrder ?? order);
    } catch (error: any) {
      console.error("Error fetching order:", error);
      res.status(500).json({ error: error.message || "Failed to fetch order" });
    }
  });

  // Update order shipping information and set status to shipped
  app.patch("/api/orders/:orderId/shipping", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const shippingInfo = req.body;

      // Validate shipping info
      if (!shippingInfo.carrier && !shippingInfo.trackingNumber && !shippingInfo.shippedDate) {
        return res.status(400).json({ error: "At least one shipping field is required" });
      }

      const client = new ShopwareClient(settings);
      
      // Update shipping info and set status to shipped in Shopware
      await client.updateOrderShipping(orderId, shippingInfo);

      // Versandangaben kommen aus dem Bestell-Spiegel: gleich abgleichen (wie beim Sammel-Tracking)
      try {
        const { syncShopwareMirrorForTenant } = await import("../shopware/shopwareMirror");
        await syncShopwareMirrorForTenant(storage, client, (req as any).tenantId ?? null, { entities: ["orders"] });
      } catch (error) {
        console.error("[order-shipping] Spiegel-Abgleich nach dem Update fehlgeschlagen:", error);
      }
      
      res.json({ 
        success: true,
        message: "Shipping information updated and order marked as shipped",
        orderId,
        shippingInfo
      });
    } catch (error: any) {
      console.error("Error updating order shipping:", error);
      const message = error.message || "Failed to update shipping information";
      if (isMonduPluginShipError(message)) {
        return res.status(502).json(monduShipBlockedPayload(message));
      }
      res.status(500).json({ error: message });
    }
  });

  // Create documents in Shopware and update custom fields
  app.patch("/api/orders/:orderId/documents", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const tenantId = (req as any).tenantId ?? null;
      const invoiceAutomation = await getInvoiceAutomationSettings(tenantId);
      // Pro Anfrage abschaltbar (Checkbox im Formular); Default = Mandanten-Einstellung.
      const sendInvoiceRequested =
        typeof req.body?.sendInvoice === "boolean" ? req.body.sendInvoice : invoiceAutomation.autoSend;

      const { orderId } = req.params;
      let { invoiceNumber, vorkasseInvoiceNumber, deliveryNoteNumber, erpNumber } = req.body;

      // Convert empty strings to undefined (Shopware rejects empty strings)
      invoiceNumber = invoiceNumber?.trim() || undefined;
      vorkasseInvoiceNumber = vorkasseInvoiceNumber?.trim() || undefined;
      deliveryNoteNumber = deliveryNoteNumber?.trim() || undefined;
      erpNumber = erpNumber?.trim() || undefined;

      // Validate that at least one document field is provided
      if (!invoiceNumber && !vorkasseInvoiceNumber && !deliveryNoteNumber && !erpNumber) {
        return res.status(400).json({ error: "At least one document number is required" });
      }

      const client = new ShopwareClient(settings);
      
      // Track outcomes for response
      const results = {
        invoiceCreated: false,
        invoiceSkipped: false,
        vorkasseInvoiceCreated: false,
        vorkasseInvoiceSkipped: false,
        deliveryNoteCreated: false,
        deliveryNoteSkipped: false,
        customFieldsUpdated: false,
        /** true = ZUGFeRD-PDF, false = klassische PDF-Rechnung (nur gesetzt, wenn erstellt). */
        invoiceIsEInvoice: undefined as boolean | undefined,
        invoiceSend: undefined as SendInvoiceResult | undefined,
      };

      // PREFLIGHT: Check ALL documents for conflicts BEFORE creating anything
      let invoiceCheck: { exists: boolean; documentNumber?: string; documentId?: string; conflict: boolean } | null = null;
      let deliveryCheck: { exists: boolean; documentNumber?: string; documentId?: string; conflict: boolean } | null = null;

      if (invoiceNumber) {
        invoiceCheck = await client.checkExistingDocument(orderId, 'invoice', invoiceNumber);
        if (invoiceCheck.conflict) {
          return res.status(409).json({ 
            error: "Invoice number conflict",
            message: `Order already has invoice ${invoiceCheck.documentNumber}, cannot create invoice ${invoiceNumber}`,
            existingNumber: invoiceCheck.documentNumber,
            requestedNumber: invoiceNumber,
            documentType: 'invoice',
          });
        }
      }

      if (deliveryNoteNumber) {
        deliveryCheck = await client.checkExistingDocument(orderId, 'delivery_note', deliveryNoteNumber);
        if (deliveryCheck.conflict) {
          return res.status(409).json({ 
            error: "Delivery note number conflict",
            message: `Order already has delivery note ${deliveryCheck.documentNumber}, cannot create delivery note ${deliveryNoteNumber}`,
            existingNumber: deliveryCheck.documentNumber,
            requestedNumber: deliveryNoteNumber,
            documentType: 'delivery_note',
          });
        }
      }

      // CREATE: All preflight checks passed, now create documents
      const errors: string[] = [];
      
      // ===== DEBUG LOGGING: REQUEST RECEIVED =====
      console.log(`[DEBUG] Document creation request for order ${orderId}:`, {
        invoiceNumber,
        deliveryNoteNumber,
        erpNumber,
        invoiceCheck: invoiceCheck ? { exists: invoiceCheck.exists, documentNumber: invoiceCheck.documentNumber } : null,
        deliveryCheck: deliveryCheck ? { exists: deliveryCheck.exists, documentNumber: deliveryCheck.documentNumber } : null,
      });
      // ==========================================
      
      // Create invoice if needed (independent operation)
      if (invoiceNumber && invoiceCheck && !invoiceCheck.exists) {
        try {
          console.log(`[Orders] Creating invoice ${invoiceNumber} for order ${orderId}`);
          console.log(`[DEBUG] Calling client.createInvoice with:`, { orderId, invoiceNumber, erpNumber });
          const createdInvoice = await client.createInvoice(
            orderId,
            invoiceNumber,
            erpNumber,
            undefined,
            // Bei Auto-Versand erst nach dem tatsaechlichen Versand als verschickt markieren.
            !sendInvoiceRequested,
            { eInvoice: invoiceAutomation.eInvoice },
          );
          console.log(`[DEBUG] ✓ client.createInvoice succeeded`);
          results.invoiceCreated = true;
          results.invoiceIsEInvoice = createdInvoice.documentType === ZUGFERD_EMBEDDED_INVOICE_TYPE;

          // Poll for document generation (Shopware uses async message queue)
          let pdfUrl: string | undefined = undefined;
          let invoiceId: string | undefined = undefined;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000)); // First check after 0.5s
            try {
              const docs = await client.fetchOrderDocuments(orderId);
              console.log(`[DEBUG] Poll attempt ${attempt + 1}: Found ${docs.length} documents for order ${orderId}`);
              
              // Find invoice by number, or fallback to newest invoice
              let invoice = docs.find(d => d.type === 'invoice' && d.number === invoiceNumber);
              if (!invoice) {
                // Fallback: find any invoice with matching number prefix
                invoice = docs.find(d => d.type === 'invoice' && d.number.includes(invoiceNumber));
              }
              if (!invoice) {
                // Fallback: get newest invoice (documents are usually returned newest first)
                invoice = docs.find(d => d.type === 'invoice');
              }
              
              if (invoice && invoice.deepLinkCode) {
                invoiceId = invoice.id; // Capture Shopware document UUID
                pdfUrl = `${settings.shopwareUrl}/api/_action/document/${invoice.id}/${invoice.deepLinkCode}?download=1`;
                console.log(`[DEBUG] Invoice PDF URL found: ${pdfUrl} (doc ${invoice.number}, id ${invoiceId})`);
                break;
              } else if (invoice) {
                console.log(`[DEBUG] Invoice found but missing deepLinkCode:`, invoice);
              }
            } catch (err) {
              console.error(`[DEBUG] Attempt ${attempt + 1} to fetch invoice document failed:`, err);
            }
          }

          // Trigger webhook for document.created (invoice)
          webhookService.trigger("document.created", {
            documentType: "invoice",
            orderId: orderId,
            orderNumber: invoiceNumber,
            documentNumber: invoiceNumber,
            pdfUrl: pdfUrl, // Will be undefined if document not yet generated
            createdAt: new Date().toISOString(),
          }, {
            source: "document_creation",
            actorType: "system",
            actorId: "system",
            erpNumber: erpNumber || null,
            orderId: orderId,
            documentType: "invoice",
            invoiceNumber: invoiceNumber,
            invoiceId: invoiceId, // Shopware document UUID for correlation
          }).catch(err => {
            console.error("Error triggering document.created webhook for invoice:", err);
          });

          // Versand nur, wenn die Rechnung ordnungsgemaess erstellt wurde (PDF liegt vor).
          if (sendInvoiceRequested) {
            if (!createdInvoice.documentId || !createdInvoice.pdfReady) {
              results.invoiceSend = {
                status: "failed",
                invoiceId: createdInvoice.documentId,
                invoiceNumber,
                message: "Rechnung erstellt, aber das PDF lag noch nicht vor – bitte manuell verschicken.",
              };
            } else {
              results.invoiceSend = await sendOrderInvoice(
                client,
                { id: orderId, orderNumber: typeof req.body?.orderNumber === "string" ? req.body.orderNumber : undefined },
                { trigger: "invoice_number", tenantId, invoiceId: createdInvoice.documentId },
              );
              if (results.invoiceSend.status === "sent") {
                await markOrderInvoiceSentInCache(orderId, tenantId);
              }
            }
            if (results.invoiceSend.status === "failed") {
              errors.push(`Rechnungsversand fehlgeschlagen: ${results.invoiceSend.message ?? "unbekannter Fehler"}`);
            }
          }
        } catch (invoiceError: any) {
          console.error(`[Orders] Failed to create invoice for order ${orderId}:`, invoiceError);
          console.error(`[DEBUG] Invoice error details:`, {
            message: invoiceError.message,
            stack: invoiceError.stack,
            response: invoiceError.response?.data || invoiceError.response,
          });
          errors.push(`Invoice creation failed: ${invoiceError.message}`);
        }
      } else if (invoiceNumber && invoiceCheck && invoiceCheck.exists) {
        console.log(`[Orders] Invoice ${invoiceNumber} already exists for order ${orderId}, skipping creation`);
        results.invoiceSkipped = true;
      }

      // Create Vorkasse invoice document if needed (same as invoice, number e.g. VKRE-…)
      if (vorkasseInvoiceNumber) {
        const docs = await client.fetchOrderDocuments(orderId);
        const existingVorkasse = docs.find((d: { number: string }) => d.number === vorkasseInvoiceNumber);
        if (!existingVorkasse) {
          try {
            console.log(`[Orders] Creating Vorkasse invoice ${vorkasseInvoiceNumber} for order ${orderId}`);
            await client.createInvoice(orderId, vorkasseInvoiceNumber, erpNumber);
            results.vorkasseInvoiceCreated = true;
          } catch (vorkasseError: any) {
            console.error(`[Orders] Failed to create Vorkasse invoice for order ${orderId}:`, vorkasseError);
            errors.push(`Vorkasse-Rechnung: ${vorkasseError.message}`);
          }
        } else {
          console.log(`[Orders] Vorkasse invoice ${vorkasseInvoiceNumber} already exists for order ${orderId}, skipping creation`);
          results.vorkasseInvoiceSkipped = true;
        }
      }

      // Create delivery note if needed (independent operation)
      if (deliveryNoteNumber && deliveryCheck && !deliveryCheck.exists) {
        try {
          console.log(`[Orders] Creating delivery note ${deliveryNoteNumber} for order ${orderId}`);
          console.log(`[DEBUG] Calling client.createDeliveryNote with:`, { orderId, deliveryNoteNumber, erpNumber });
          await client.createDeliveryNote(orderId, deliveryNoteNumber, erpNumber);
          console.log(`[DEBUG] ✓ client.createDeliveryNote succeeded`);
          results.deliveryNoteCreated = true;

          // Poll for document generation (Shopware uses async message queue)
          let pdfUrl: string | undefined = undefined;
          let deliveryNoteId: string | undefined = undefined;
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000)); // First check after 0.5s
            try {
              const docs = await client.fetchOrderDocuments(orderId);
              console.log(`[DEBUG] Poll attempt ${attempt + 1}: Found ${docs.length} documents for order ${orderId}`);
              
              // Find delivery note by number, or fallback to newest delivery note
              let deliveryNote = docs.find(d => d.type === 'delivery_note' && d.number === deliveryNoteNumber);
              if (!deliveryNote) {
                // Fallback: find any delivery note with matching number prefix
                deliveryNote = docs.find(d => d.type === 'delivery_note' && d.number.includes(deliveryNoteNumber));
              }
              if (!deliveryNote) {
                // Fallback: get newest delivery note
                deliveryNote = docs.find(d => d.type === 'delivery_note');
              }
              
              if (deliveryNote && deliveryNote.deepLinkCode) {
                deliveryNoteId = deliveryNote.id; // Capture Shopware document UUID
                pdfUrl = `${settings.shopwareUrl}/api/_action/document/${deliveryNote.id}/${deliveryNote.deepLinkCode}?download=1`;
                console.log(`[DEBUG] Delivery note PDF URL found: ${pdfUrl} (doc ${deliveryNote.number}, id ${deliveryNoteId})`);
                break;
              } else if (deliveryNote) {
                console.log(`[DEBUG] Delivery note found but missing deepLinkCode:`, deliveryNote);
              }
            } catch (err) {
              console.error(`[DEBUG] Attempt ${attempt + 1} to fetch delivery note document failed:`, err);
            }
          }

          // Trigger webhook for document.created (delivery note)
          webhookService.trigger("document.created", {
            documentType: "delivery_note",
            orderId: orderId,
            orderNumber: deliveryNoteNumber,
            documentNumber: deliveryNoteNumber,
            pdfUrl: pdfUrl, // Will be undefined if document not yet generated
            createdAt: new Date().toISOString(),
          }, {
            source: "document_creation",
            actorType: "system",
            actorId: "system",
            erpNumber: erpNumber || null,
            orderId: orderId,
            documentType: "delivery_note",
            deliveryNoteNumber: deliveryNoteNumber,
            deliveryNoteId: deliveryNoteId, // Shopware document UUID for correlation
          }).catch(err => {
            console.error("Error triggering document.created webhook for delivery note:", err);
          });
        } catch (deliveryError: any) {
          console.error(`[Orders] Failed to create delivery note for order ${orderId}:`, deliveryError);
          console.error(`[DEBUG] Delivery note error details:`, {
            message: deliveryError.message,
            stack: deliveryError.stack,
            response: deliveryError.response?.data || deliveryError.response,
          });
          errors.push(`Delivery note creation failed: ${deliveryError.message}`);
        }
      } else if (deliveryNoteNumber && deliveryCheck && deliveryCheck.exists) {
        console.log(`[Orders] Delivery note ${deliveryNoteNumber} already exists for order ${orderId}, skipping creation`);
        results.deliveryNoteSkipped = true;
      }

      // UPDATE: Always update custom fields (even if document creation partially failed)
      try {
        await client.updateOrderDocumentNumbers(orderId, {
          invoiceNumber,
          vorkasseInvoiceNumber,
          deliveryNoteNumber,
          erpNumber
        });
        results.customFieldsUpdated = true;
        console.log(`[Orders] Custom fields updated for order ${orderId}`);
      } catch (customFieldError: any) {
        console.error(`[Orders] Failed to update custom fields for order ${orderId}:`, customFieldError);
        errors.push(`Custom field update failed: ${customFieldError.message}`);
      }

      // Determine response based on results
      const hasErrors = errors.length > 0;
      const hasSuccess = results.invoiceCreated || results.invoiceSkipped ||
                         results.vorkasseInvoiceCreated || results.vorkasseInvoiceSkipped ||
                         results.deliveryNoteCreated || results.deliveryNoteSkipped ||
                         results.customFieldsUpdated;
      const partialSuccess = hasSuccess && hasErrors;
      
      console.log(`[Orders] Document operation completed for order ${orderId}:`, {
        results,
        errors: errors.length > 0 ? errors : undefined
      });

      // Return appropriate response
      if (!hasErrors) {
        // Complete success
        return res.json({ 
          success: true,
          message: "Document operation completed successfully",
          orderId,
          documents: {
            invoiceNumber,
            vorkasseInvoiceNumber,
            deliveryNoteNumber,
            erpNumber
          },
          results,
        });
      } else if (partialSuccess) {
        // Partial success - some operations succeeded, some failed
        return res.status(207).json({ 
          success: false,
          partial: true,
          message: "Document operation partially completed",
          orderId,
          documents: {
            invoiceNumber,
            vorkasseInvoiceNumber,
            deliveryNoteNumber,
            erpNumber
          },
          results,
          errors,
        });
      } else {
        // Complete failure - nothing succeeded
        return res.status(502).json({ 
          success: false,
          message: "Document operation failed",
          orderId,
          results,
          errors,
        });
      }
    } catch (error: any) {
      console.error("Error in document operation:", error);
      
      // Handle Shopware API errors
      if (error.message?.includes('Failed to create invoice') || 
          error.message?.includes('Failed to create delivery note')) {
        return res.status(502).json({ 
          error: "Shopware API error",
          message: error.message || "Failed to create document in Shopware" 
        });
      }
      
      res.status(500).json({ error: error.message || "Failed to process document operation" });
    }
  });

  // Create proforma invoice for an order
  app.post("/api/orders/:orderId/proforma", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const client = new ShopwareClient(settings);

      console.log(`[Proforma] Creating proforma invoice for order ${orderId}`);

      // Fetch order data to get additional fields
      const order = await client.fetchOrderById(orderId, null); // null = admin access
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const buyerReference = order.customFields?.custom_buyerreference_invoice;
      const customerComment = order.customerComment;

      console.log(`[Proforma] Order data: buyerReference=${buyerReference}, customerComment=${customerComment}`);

      // Check if proforma invoice already exists
      const documents = await client.fetchOrderDocuments(orderId);
      const existingProforma = documents.find((doc: any) => 
        doc.type === 'proforma_invoice' || 
        (doc.type === 'invoice' && order.proformaNumber && doc.number === order.proformaNumber)
      );

      if (existingProforma) {
        return res.status(409).json({
          error: "Proforma invoice already exists",
          message: `Order already has proforma invoice ${existingProforma.number}`,
          proformaNumber: existingProforma.number,
        });
      }

      const numberRangeSettings = await storage.getProformaNumberRangeSettings();
      const resolvedRange = numberRangeSettings ?? defaultProformaNumberRange;
      const nextNumber = resolvedRange.nextNumber ?? defaultProformaNumberRange.nextNumber;
      const padding = resolvedRange.padding ?? defaultProformaNumberRange.padding;
      const prefix = resolvedRange.prefix ?? defaultProformaNumberRange.prefix;
      const numberPart = padding > 0
        ? String(nextNumber).padStart(padding, "0")
        : String(nextNumber);
      const proformaNumberCandidate = `${prefix}${numberPart}`;

      // Create proforma invoice
      const { documentId, invoiceNumber } = await client.createProformaInvoice(
        orderId,
        buyerReference,
        customerComment,
        proformaNumberCandidate
      );
      const finalProformaNumber = invoiceNumber || proformaNumberCandidate;

      console.log(`[Proforma] Proforma invoice created: ${finalProformaNumber} (Document ID: ${documentId})`);

      // Update order custom field with proforma number
      await client.updateOrderDocumentNumbers(orderId, {
        proformaNumber: finalProformaNumber,
      });

      console.log(`[Proforma] Updated order custom field: custom_order_proforma_number = ${finalProformaNumber}`);

      await storage.saveProformaNumberRangeSettings({
        prefix,
        padding,
        nextNumber: nextNumber + 1,
      });

      // Poll for PDF URL
      let pdfUrl: string | undefined = undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000));
        try {
          const docs = await client.fetchOrderDocuments(orderId);
          const proforma = docs.find((d: any) => d.number === finalProformaNumber);
          
          if (proforma && proforma.deepLinkCode) {
            pdfUrl = `${settings.shopwareUrl}/api/_action/document/${proforma.id}/${proforma.deepLinkCode}?download=1`;
            console.log(`[Proforma] PDF URL found: ${pdfUrl}`);
            break;
          }
        } catch (err) {
          console.error(`[Proforma] Attempt ${attempt + 1} to fetch PDF failed:`, err);
        }
      }

      // Trigger webhook (optional)
      const documentType: DocumentCreatedPayload["documentType"] = "proforma_invoice";
      webhookService.trigger("document.created", {
        documentType,
        orderId: orderId,
        orderNumber: order.orderNumber,
        documentNumber: finalProformaNumber,
        pdfUrl: pdfUrl,
        createdAt: new Date().toISOString(),
      }, {
        source: "proforma_creation",
        actorType: "user",
        actorId: (req.user as any)?.id || "system",
        orderId: orderId,
        documentType,
        proformaNumber: finalProformaNumber,
        documentId: documentId,
      }).catch(err => {
        console.error("Error triggering document.created webhook for proforma:", err);
      });

      res.json({
        success: true,
        message: "Proforma invoice created successfully",
        orderId,
        proformaNumber: finalProformaNumber,
        documentId,
        pdfUrl,
      });
    } catch (error: any) {
      console.error("Error creating proforma invoice:", error);
      
      if (error.message?.includes('Failed to create proforma invoice')) {
        return res.status(502).json({
          error: "Shopware API error",
          message: error.message || "Failed to create proforma invoice in Shopware"
        });
      }
      
      res.status(500).json({ 
        error: error.message || "Failed to create proforma invoice" 
      });
    }
  });

  // Abschlussrechnung (PDF in METAorder, nicht Shopware-Dokument)
  app.post(
    "/api/orders/:orderId/settlement-invoice/pdf",
    requireAuth,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const access = await assertInstallmentOrderAccess(req, req.params.orderId, tenantId);
        if (!access.ok) {
          return res.status(access.status).json(access.body);
        }

        const parsed = settlementInvoicePdfBodySchema.safeParse(req.body);
        if (!parsed.success) {
          const msg = parsed.error.issues[0]?.message || "Ungültige Eingabe";
          return res.status(400).json({ error: msg });
        }
        const body = parsed.data;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const client = new ShopwareClient(settings);
        const order = await client.fetchOrderById(req.params.orderId, null);
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        let invoiceDate = new Date();
        if (body.invoiceDate?.trim()) {
          const d = new Date(body.invoiceDate.trim());
          if (!Number.isNaN(d.getTime())) {
            invoiceDate = d;
          }
        }

        const balanceGross =
          Math.round((body.originalAmountGross - body.stornoAmountGross) * 100) / 100;

        let billingAddress: SettlementInvoicePdfInput["billingAddress"] = null;
        if (order.billingAddress) {
          billingAddress = order.billingAddress;
        }

        const pdfInput: SettlementInvoicePdfInput = {
          settlementInvoiceNumber: body.settlementInvoiceNumber.trim(),
          originalInvoiceNumber: body.originalInvoiceNumber.trim(),
          originalAmountGross: body.originalAmountGross,
          stornoInvoiceNumber: body.stornoInvoiceNumber.trim(),
          stornoAmountGross: body.stornoAmountGross,
          balanceGross,
          invoiceDate,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          billingAddress,
        };

        const pdfBuffer = await generateSettlementInvoicePdf(pdfInput);
        const safeName = body.settlementInvoiceNumber.trim().replace(/[^\w.-]+/g, "_");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="abschlussrechnung-${safeName}.pdf"`,
        );
        res.send(pdfBuffer);
      } catch (error: any) {
        console.error("settlement-invoice pdf:", error);
        res.status(500).json({ error: error.message || "Failed to generate settlement invoice PDF" });
      }
    },
  );

  // Nachberechnung (PDF + Upload als Shopware-Rechnungsdokument)
  app.post(
    "/api/orders/:orderId/additional-invoice",
    requireAuth,
    requireCsrf,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const access = await assertInstallmentOrderAccess(req, req.params.orderId, tenantId);
        if (!access.ok) {
          return res.status(access.status).json(access.body);
        }

        const parsed = additionalInvoiceBodySchema.safeParse(req.body);
        if (!parsed.success) {
          const msg = parsed.error.issues[0]?.message || "Ungültige Eingabe";
          return res.status(400).json({ error: msg });
        }
        const body = parsed.data;

        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const client = new ShopwareClient(settings);
        const order = await client.fetchOrderById(req.params.orderId, null);
        if (!order) {
          return res.status(404).json({ error: "Order not found" });
        }

        let invoiceDate = new Date();
        if (body.invoiceDate?.trim()) {
          const d = new Date(body.invoiceDate.trim());
          if (!Number.isNaN(d.getTime())) {
            invoiceDate = d;
          }
        }

        const pdfBuffer = await generateAdditionalInvoicePdf({
          invoiceNumber: body.invoiceNumber.trim(),
          invoiceDate,
          referenceInvoiceNumber: body.referenceInvoiceNumber?.trim() || null,
          note: body.note?.trim() || null,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          billingAddress: order.billingAddress ?? null,
          items: body.items.map((item) => ({
            description: item.description.trim(),
            quantity: item.quantity,
            unitNetPrice: item.unitNetPrice,
            vatRate: item.vatRate,
          })),
        });

        const safeName = body.invoiceNumber.trim().replace(/[^\w.-]+/g, "_");
        const uploadResult = await client.uploadOrderDocumentPdf(
          req.params.orderId,
          pdfBuffer,
          `nachberechnung-${safeName}.pdf`,
          {
            preferredTechnicalName: "invoice",
            documentNumber: body.invoiceNumber.trim(),
          },
        );

        if (!uploadResult.documentId) {
          return res.status(502).json({
            error: "Shopware upload failed",
            message: "PDF wurde erzeugt, konnte aber nicht als Bestelldokument hinterlegt werden",
          });
        }

        res.json({
          ok: true,
          documentId: uploadResult.documentId,
          documentNumber: uploadResult.documentNumber,
        });
      } catch (error: any) {
        console.error("additional-invoice:", error);
        res.status(500).json({ error: error.message || "Failed to create additional invoice" });
      }
    },
  );

  // --- Teilzahlungspläne / Ratenzahlung ---
  app.get("/api/orders/:orderId/installment-plans", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const access = await assertInstallmentOrderAccess(req, req.params.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const plans = await storage.getInstallmentPlansByOrder(req.params.orderId, tenantId);
      const withInv = await Promise.all(
        plans.map(async (p) => {
          const inv = await storage.getInstallmentInvoices(p.id, tenantId);
          return serializeInstallmentPlan(p, inv);
        })
      );
      res.json(withInv);
    } catch (error: any) {
      console.error("installment-plans list:", error);
      res.status(500).json({ error: error.message || "Failed to load installment plans" });
    }
  });

  app.post("/api/orders/:orderId/installment-plans", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const userId = (req.user as any)?.id as string | undefined;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const body = createInstallmentPlanBodySchema.parse(req.body);
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }
      const client = new ShopwareClient(settings);
      const order = await client.fetchOrderById(req.params.orderId, null);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      const total = orderTotalAmountNumber(order);

      let depositAmount: number;
      let depositPercent: number | null = null;
      if (body.depositPercent) {
        depositPercent = body.depositPercent;
        depositAmount = Math.round(total * depositPercent) / 100;
      } else if (body.depositAmount) {
        depositAmount = body.depositAmount;
      } else {
        return res.status(400).json({ error: "depositAmount oder depositPercent erforderlich" });
      }

      if (depositAmount >= total || depositAmount <= 0) {
        return res.status(400).json({ error: "Anzahlung muss größer als 0 und kleiner als der Gesamtbetrag sein" });
      }
      const remaining = Math.round((total - depositAmount) * 100) / 100;
      const n = body.numberOfInstallments;
      const installmentAmounts = splitRemainingInstallments(remaining, n);
      const avgInstallment = installmentAmounts[0] ?? remaining / n;
      const dueDates = body.dueDates;

      const invoiceRows: Array<{
        type: string;
        sequenceNumber: number;
        invoiceNumber: string;
        amount: string;
        dueDate: Date | null;
        status: string;
      }> = [
        {
          type: "deposit",
          sequenceNumber: 0,
          invoiceNumber: body.depositInvoiceNumber.trim(),
          amount: depositAmount.toFixed(2),
          dueDate: dueDates?.[0] ? new Date(dueDates[0]) : null,
          status: "pending",
        },
      ];
      for (let i = 0; i < n; i++) {
        invoiceRows.push({
          type: "installment",
          sequenceNumber: i + 1,
          invoiceNumber: body.installmentInvoiceNumbers[i]!.trim(),
          amount: installmentAmounts[i]!.toFixed(2),
          dueDate: dueDates?.[i + 1] ? new Date(dueDates[i + 1]!) : null,
          status: "pending",
        });
      }

      const { plan, invoices } = await storage.createInstallmentPlanWithInvoices(
        {
          orderId: req.params.orderId,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail ?? null,
          totalAmount: total.toFixed(2),
          depositAmount: depositAmount.toFixed(2),
          depositPercent: depositPercent?.toFixed(2) ?? null,
          depositInvoiceNumber: body.depositInvoiceNumber.trim(),
          remainingAmount: remaining.toFixed(2),
          numberOfInstallments: n,
          installmentAmount: avgInstallment.toFixed(2),
          status: "draft",
          agreementPdfPath: null,
          agreementConfirmedAt: null,
          agreementConfirmedBy: null,
          createdBy: userId,
        },
        invoiceRows,
        tenantId
      );

      res.status(201).json(serializeInstallmentPlan(plan, invoices));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      console.error("installment-plans create:", error);
      res.status(500).json({ error: error.message || "Failed to create installment plan" });
    }
  });

  app.get("/api/installment-plans/:planId", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      res.json(serializeInstallmentPlan(plan, invoices));
    } catch (error: any) {
      console.error("installment-plans get:", error);
      res.status(500).json({ error: error.message || "Failed to load plan" });
    }
  });

  app.patch("/api/installment-plans/:planId", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "draft") {
        return res.status(400).json({ error: "Plan kann nur im Entwurfsstatus bearbeitet werden" });
      }
      const schema = z.object({
        customerName: z.string().min(1).optional(),
        customerEmail: z.string().optional().nullable(),
      });
      const updates = schema.parse(req.body);
      const updated = await storage.updateInstallmentPlan(req.params.planId, updates, tenantId);
      if (!updated) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const invoices = await storage.getInstallmentInvoices(updated.id, tenantId);
      res.json(serializeInstallmentPlan(updated, invoices));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      console.error("installment-plans patch:", error);
      res.status(500).json({ error: error.message || "Failed to update plan" });
    }
  });

  app.delete("/api/installment-plans/:planId", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "draft") {
        return res.status(400).json({ error: "Nur Entwürfe können gelöscht werden" });
      }
      const ok = await storage.deleteInstallmentPlan(req.params.planId, tenantId);
      res.json({ success: ok });
    } catch (error: any) {
      console.error("installment-plans delete:", error);
      res.status(500).json({ error: error.message || "Failed to delete plan" });
    }
  });

  app.post("/api/installment-plans/:planId/send-agreement", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "draft") {
        return res.status(400).json({ error: "Vereinbarung nur aus Entwurf sendbar" });
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      const lines: InstallmentAgreementLine[] = invoices.map((inv) => ({
        kind: inv.type === "deposit" ? "deposit" : "installment",
        sequenceNumber: inv.sequenceNumber,
        invoiceNumber: inv.invoiceNumber || "—",
        amount: decimalNum(inv.amount as any),
        dueDate: inv.dueDate,
      }));
      const pdfInput = {
        orderNumber: plan.orderNumber,
        customerName: plan.customerName,
        customerEmail: plan.customerEmail,
        totalAmount: decimalNum(plan.totalAmount as any),
        depositAmount: decimalNum(plan.depositAmount as any),
        remainingAmount: decimalNum(plan.remainingAmount as any),
        numberOfInstallments: plan.numberOfInstallments,
        lines,
      };
      const pdfBuffer = await generateInstallmentAgreementPdf(pdfInput);
      const dir = path.join(getUploadsRoot(), "installment-agreements");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${plan.id}.pdf`);
      await fs.writeFile(filePath, pdfBuffer);
      const updated = await storage.updateInstallmentPlan(
        req.params.planId,
        { agreementPdfPath: filePath, status: "pending_confirmation" },
        tenantId
      );
      if (!updated) {
        return res.status(500).json({ error: "Failed to update plan" });
      }
      res.json({
        success: true,
        plan: serializeInstallmentPlan(updated, invoices),
        pdfPath: filePath,
      });
    } catch (error: any) {
      console.error("installment send-agreement:", error);
      res.status(500).json({ error: error.message || "Failed to generate agreement" });
    }
  });

  const confirmInstallmentSchema = z.object({
    confirmedBy: z.string().min(1, "Name oder Kennung des Bestätigenden erforderlich"),
  });

  app.post("/api/installment-plans/:planId/confirm", requireAuth, requireManageDocuments, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const { confirmedBy } = confirmInstallmentSchema.parse(req.body);
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "pending_confirmation") {
        return res.status(400).json({ error: "Bestätigung nur im Status „Vereinbarung ausstehend“ möglich" });
      }
      const now = new Date();
      const updated = await storage.updateInstallmentPlan(
        req.params.planId,
        {
          status: "active",
          agreementConfirmedAt: now,
          agreementConfirmedBy: confirmedBy.trim(),
        },
        tenantId
      );
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      res.json(serializeInstallmentPlan(updated!, invoices));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      console.error("installment confirm:", error);
      res.status(500).json({ error: error.message || "Failed to confirm" });
    }
  });

  app.post(
    "/api/installment-plans/:planId/invoices/:invoiceId/mark-paid",
    requireAuth,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
        if (!plan) {
          return res.status(404).json({ error: "Plan not found" });
        }
        if (plan.status !== "active") {
          return res.status(400).json({ error: "Zahlungen nur bei aktivem Plan markierbar" });
        }
        const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
        const inv = invoices.find((i) => i.id === req.params.invoiceId);
        if (!inv) {
          return res.status(404).json({ error: "Invoice not found" });
        }
        if (inv.status === "cancelled") {
          return res.status(400).json({ error: "Stornierte Position" });
        }
        const paidAt = new Date();
        await storage.updateInstallmentInvoice(
          req.params.invoiceId,
          { status: "paid", paidAt },
          tenantId
        );
        const fresh = await storage.getInstallmentInvoices(plan.id, tenantId);
        const nonCancelled = fresh.filter((i) => i.status !== "cancelled");
        const allPaid =
          nonCancelled.length > 0 && nonCancelled.every((i) => i.status === "paid");
        let planRow = plan;
        if (allPaid) {
          const u = await storage.updateInstallmentPlan(req.params.planId, { status: "completed" }, tenantId);
          if (u) planRow = u;
        }
        const finalInv = await storage.getInstallmentInvoices(plan.id, tenantId);
        res.json(serializeInstallmentPlan(planRow, finalInv));
      } catch (error: any) {
        console.error("installment mark-paid:", error);
        res.status(500).json({ error: error.message || "Failed to mark paid" });
      }
    }
  );

  app.get("/api/installment-plans/:planId/agreement-pdf", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      if (!plan.agreementPdfPath) {
        return res.status(404).json({ error: "No agreement PDF yet" });
      }
      const abs = resolveAttachmentPath(plan.agreementPdfPath);
      if (!abs.includes(`${path.sep}installment-agreements${path.sep}`)) {
        return res.status(400).json({ error: "Invalid agreement path" });
      }
      const buf = await fs.readFile(abs);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="teilzahlungsvereinbarung-${plan.orderNumber}.pdf"`
      );
      res.send(buf);
    } catch (error: any) {
      console.error("installment agreement-pdf:", error);
      res.status(500).json({ error: error.message || "Failed to read PDF" });
    }
  });

  // --- Einzelne Teilrechnung / Anzahlungsrechnung als PDF ---
  app.get("/api/installment-plans/:planId/invoices/:invoiceId/pdf", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      const inv = invoices.find((i) => i.id === req.params.invoiceId);
      if (!inv) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      let billingAddress: InstallmentInvoicePdfInput["billingAddress"] = null;
      try {
        const settings = await storage.getShopwareSettings(tenantId);
        if (settings) {
          const client = new ShopwareClient(settings);
          const order = await client.fetchOrderById(plan.orderId, null);
          if (order?.billingAddress) {
            billingAddress = order.billingAddress;
          }
        }
      } catch {
        // billing address is optional
      }

      const pdfInput: InstallmentInvoicePdfInput = {
        type: inv.type === "deposit" ? "deposit" : "installment",
        sequenceNumber: inv.sequenceNumber,
        invoiceNumber: inv.invoiceNumber || `${plan.orderNumber}-${inv.sequenceNumber}`,
        amount: decimalNum(inv.amount as any),
        dueDate: inv.dueDate,
        orderNumber: plan.orderNumber,
        customerName: plan.customerName,
        customerEmail: plan.customerEmail,
        billingAddress,
        totalAmount: decimalNum(plan.totalAmount as any),
        depositAmount: decimalNum(plan.depositAmount as any),
        depositPercent: plan.depositPercent ? decimalNum(plan.depositPercent as any) : null,
        remainingAmount: decimalNum(plan.remainingAmount as any),
        numberOfInstallments: plan.numberOfInstallments,
        planId: plan.id,
      };
      const pdfBuffer = await generateInstallmentInvoicePdf(pdfInput);
      const filename = inv.type === "deposit"
        ? `anzahlungsrechnung-${inv.invoiceNumber || plan.orderNumber}.pdf`
        : `teilrechnung-${inv.sequenceNumber}-${inv.invoiceNumber || plan.orderNumber}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("installment invoice pdf:", error);
      res.status(500).json({ error: error.message || "Failed to generate invoice PDF" });
    }
  });

  // --- Alle Rechnungen eines Plans als ZIP ---
  app.get("/api/installment-plans/:planId/invoices-zip", requireAuth, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const plan = await storage.getInstallmentPlan(req.params.planId, tenantId);
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      const access = await assertInstallmentOrderAccess(req, plan.orderId, tenantId);
      if (!access.ok) {
        return res.status(access.status).json(access.body);
      }
      const invoices = await storage.getInstallmentInvoices(plan.id, tenantId);
      if (invoices.length === 0) {
        return res.status(404).json({ error: "No invoices found" });
      }

      let billingAddress: InstallmentInvoicePdfInput["billingAddress"] = null;
      try {
        const settings = await storage.getShopwareSettings(tenantId);
        if (settings) {
          const client = new ShopwareClient(settings);
          const order = await client.fetchOrderById(plan.orderId, null);
          if (order?.billingAddress) {
            billingAddress = order.billingAddress;
          }
        }
      } catch {
        // billing address is optional
      }

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rechnungen-${plan.orderNumber}.zip"`
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => res.status(500).json({ error: err.message }));
      archive.pipe(res);

      for (const inv of invoices.sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
        const pdfInput: InstallmentInvoicePdfInput = {
          type: inv.type === "deposit" ? "deposit" : "installment",
          sequenceNumber: inv.sequenceNumber,
          invoiceNumber: inv.invoiceNumber || `${plan.orderNumber}-${inv.sequenceNumber}`,
          amount: decimalNum(inv.amount as any),
          dueDate: inv.dueDate,
          orderNumber: plan.orderNumber,
          customerName: plan.customerName,
          customerEmail: plan.customerEmail,
          billingAddress,
          totalAmount: decimalNum(plan.totalAmount as any),
          depositAmount: decimalNum(plan.depositAmount as any),
          depositPercent: plan.depositPercent ? decimalNum(plan.depositPercent as any) : null,
          remainingAmount: decimalNum(plan.remainingAmount as any),
          numberOfInstallments: plan.numberOfInstallments,
          planId: plan.id,
        };
        const pdfBuffer = await generateInstallmentInvoicePdf(pdfInput);
        const filename = inv.type === "deposit"
          ? `anzahlungsrechnung-${inv.invoiceNumber || plan.orderNumber}.pdf`
          : `teilrechnung-${inv.sequenceNumber}-${inv.invoiceNumber || plan.orderNumber}.pdf`;
        archive.append(pdfBuffer, { name: filename });
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("installment invoices zip:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "Failed to generate invoice ZIP" });
      }
    }
  });

  // Mark order as shipped - requires invoice to exist, transitions state and sends invoice email
  app.post("/api/orders/:orderId/mark-shipped", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const { orderId } = req.params;
      const client = new ShopwareClient(settings);

      // Step 1: Check if invoice exists for this order (prefer real invoice over VKRE/PF)
      const documents = await client.fetchOrderDocuments(orderId);
      const invoice = getRealInvoiceDocument(documents);

      if (!invoice || !invoice.id) {
        return res.status(400).json({ 
          error: "No invoice found",
          message: "Order must have an invoice before it can be marked as shipped"
        });
      }

      console.log(`[Mark Shipped] Order ${orderId} has invoice ${invoice.id}, proceeding with shipping workflow`);

      // Step 2: Set order delivery to "shipped" status in Shopware
      await client.setOrderShipped(orderId);
      console.log(`[Mark Shipped] Order ${orderId} delivery status set to shipped`);

      // Step 3: Send invoice email to customer (Mondu requirement)
      await client.sendInvoiceEmail(orderId, invoice.id);
      console.log(`[Mark Shipped] Invoice email sent for order ${orderId}`);

      // Trigger webhook for order.ready_to_ship (using minimal data from context)
      webhookService.trigger("order.ready_to_ship", {
        orderId: orderId,
        orderNumber: "N/A", // Order number not available in this context
        customerName: "N/A", // Customer details not available
        customerEmail: "",
        totalAmount: 0, // Amount not available
        items: [], // Line items not available
        readyAt: new Date().toISOString(),
      }, {
        source: "mark_shipped",
        actorType: "user",
        actorId: (req.user as any)?.id || "system",
        invoiceId: invoice.id,
      }).catch(err => {
        console.error("Error triggering order.ready_to_ship webhook:", err);
      });

      res.json({ 
        success: true,
        message: "Order marked as shipped and invoice email sent",
        orderId,
        invoiceId: invoice.id,
      });
    } catch (error: any) {
      console.error("Error marking order as shipped:", error);
      const message = error.message || "Failed to mark order as shipped";

      if (isMonduPluginShipError(message)) {
        return res.status(502).json(monduShipBlockedPayload(message));
      }
      
      res.status(500).json({ 
        error: message,
      });
    }
  });

  // Rechnung ueber die Shopware-Funktion verschicken (Dokument per Mail an den
  // Kunden + document.sent = true). Manueller Klick aus der Bestelluebersicht.
  app.post(
    "/api/orders/:orderId/send-invoice",
    requireAuth,
    requireCsrf,
    requireManageDocuments,
    async (req, res) => {
      try {
        const tenantId = (req as any).tenantId ?? null;
        const settings = await storage.getShopwareSettings(tenantId);
        if (!settings) {
          return res.status(400).json({ error: "Shopware settings not configured" });
        }

        const { orderId } = req.params;
        const orderNumber =
          typeof req.body?.orderNumber === "string" ? req.body.orderNumber : undefined;
        const force = req.body?.force === true;
        const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
        if (emailRaw && !z.string().email().safeParse(emailRaw).success) {
          return res.status(400).json({ error: "Invalid email", message: "Ungültige E-Mail-Adresse." });
        }

        const client = new ShopwareClient(settings);
        const result = await sendOrderInvoice(
          client,
          { id: orderId, orderNumber },
          { trigger: "manual", force, tenantId, overrideEmail: emailRaw || undefined },
        );

        if (result.status === "no_invoice") {
          return res.status(400).json({
            error: "No invoice found",
            message: "Diese Bestellung hat keine Rechnung, die verschickt werden kann.",
            ...result,
          });
        }

        if (result.status === "failed") {
          return res.status(502).json({
            error: "Failed to send invoice",
            message: result.message || "Rechnung konnte nicht verschickt werden.",
            ...result,
          });
        }

        // Cache aktualisieren, damit das Badge sofort "verschickt" zeigt.
        if (result.status === "sent") {
          await markOrderInvoiceSentInCache(orderId, (req as any).tenantId ?? null);
        }

        res.json(result);
      } catch (error: any) {
        console.error("Error sending invoice:", error);
        res.status(500).json({ error: error.message || "Failed to send invoice" });
      }
    },
  );

  // Submit invoice to Mondu - downloads PDF from Shopware and uploads to Mondu
  app.post("/api/orders/:orderId/submit-to-mondu", requireAuth, async (req, res) => {
    try {
      const shopwareSettings = await storage.getShopwareSettings();
      if (!shopwareSettings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const monduSettings = await storage.getMonduSettings();
      if (!monduSettings) {
        return res.status(400).json({ error: "Mondu settings not configured" });
      }

      const { orderId } = req.params;
      const { monduOrderUuid, invoiceNumber, grossAmountCents } = req.body;

      // Validate required fields
      if (!monduOrderUuid) {
        return res.status(400).json({ error: "Mondu order UUID is required" });
      }
      if (!invoiceNumber) {
        return res.status(400).json({ error: "Invoice number is required" });
      }
      if (!grossAmountCents || grossAmountCents <= 0) {
        return res.status(400).json({ error: "Valid gross amount in cents is required" });
      }

      const shopwareClient = new ShopwareClient(shopwareSettings);

      // Step 1: Fetch the invoice document from Shopware (prefer real invoice over VKRE/PF)
      console.log(`[Mondu Submit] Fetching invoice document for order ${orderId}`);
      const documents = await shopwareClient.fetchOrderDocuments(orderId);
      const invoice = getRealInvoiceDocument(documents);

      if (!invoice || !invoice.id || !invoice.deepLinkCode) {
        return res.status(400).json({ 
          error: "No invoice found",
          message: "Order must have an invoice before it can be submitted to Mondu"
        });
      }

      // Step 2: Download the PDF as binary data
      console.log(`[Mondu Submit] Downloading invoice PDF ${invoice.id}`);
      const pdfBlob = await shopwareClient.downloadDocumentPdf(invoice.id, invoice.deepLinkCode);
      const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

      // Step 3: Submit to Mondu
      console.log(`[Mondu Submit] Submitting invoice to Mondu order ${monduOrderUuid}`);
      const { MonduClient } = await import("../invoicing/mondu");
      const monduClient = new MonduClient(monduSettings);

      const result = await monduClient.submitInvoice({
        orderUuid: monduOrderUuid,
        externalReferenceId: invoiceNumber,
        grossAmountCents: grossAmountCents,
        invoicePdf: pdfBuffer,
        invoiceFileName: `invoice-${invoiceNumber}.pdf`,
      });

      console.log(`[Mondu Submit] Successfully submitted invoice to Mondu:`, result);

      res.json({ 
        success: true,
        message: "Invoice successfully submitted to Mondu",
        monduInvoiceUuid: result.invoice?.uuid,
        monduInvoiceState: result.invoice?.state,
      });
    } catch (error: any) {
      console.error("Error submitting invoice to Mondu:", error);
      res.status(500).json({ 
        error: error.message || "Failed to submit invoice to Mondu" 
      });
    }
  });

  // Bulk Tracking Number Update
  app.post("/api/orders/bulk-tracking", requireAuth, requireEditOrders, async (req, res) => {
    try {
      const bulkTrackingSchema = z.object({
        orderIds: z.array(z.string()).min(1, "At least one order ID is required"),
        trackingNumbers: z.array(z.string()).min(1, "At least one tracking number is required"),
      });

      const validatedData = bulkTrackingSchema.parse(req.body);
      const { orderIds, trackingNumbers } = validatedData;

      // Validate arrays have same length
      if (orderIds.length !== trackingNumbers.length) {
        return res.status(400).json({ 
          error: "orderIds and trackingNumbers arrays must have the same length" 
        });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      let updated = 0;

      // Process each order
      for (let i = 0; i < orderIds.length; i++) {
        const orderId = orderIds[i];
        const trackingNumber = trackingNumbers[i];

        try {
          // Update tracking number and mark as completed in Shopware
          await client.updateOrderShipping(orderId, {
            trackingNumber,
          });
          updated++;
        } catch (error: any) {
          console.error(`Error updating order ${orderId}:`, error);
          // Continue with next order even if one fails
        }
      }

      // Versandliste & Co. lesen aus dem Bestell-Spiegel: Aenderungen gleich uebernehmen (normaler
      // Delta-Abgleich inkl. Aenderungserkennung), damit sie nach dem Neuladen sichtbar sind.
      if (updated > 0) {
        try {
          const { syncShopwareMirrorForTenant } = await import("../shopware/shopwareMirror");
          await syncShopwareMirrorForTenant(storage, client, (req as any).tenantId ?? null, { entities: ["orders"] });
        } catch (error) {
          console.error("[bulk-tracking] Spiegel-Abgleich nach dem Update fehlgeschlagen:", error);
        }
      }

      res.json({ 
        success: true, 
        updated 
      });
    } catch (error: any) {
      console.error("Error in bulk tracking update:", error);
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: error.message || "Failed to update tracking numbers" });
    }
  });

  app.get("/api/orders/:orderId/invoice", requireAuth, requireViewDocumentsOrAccounting, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware settings not configured" });
      }

      const client = new ShopwareClient(settings);
      const pdfBlob = await client.downloadInvoicePdf(req.params.orderId);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.orderId}.pdf"`);
      res.send(Buffer.from(await pdfBlob.arrayBuffer()));
    } catch (error: any) {
      console.error("Error downloading invoice:", error);
      res.status(500).json({ error: error.message || "Failed to download invoice" });
    }
  });

  // Get tickets by order ID
  app.get("/api/orders/:orderId/tickets", requireAuth, async (req, res) => {
    try {
      // SECURITY: Get sales channel filter from user permissions (server-side, authoritative)
      const allowedChannelIds = await getSalesChannelFilter(req);
      
      const tickets = await storage.getTicketsByOrderId(req.params.orderId);
      
      // SECURITY: Filter tickets by sales channel (indirect via orderId)
      const user = req.user as any;
      const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, user?.id);
      
      res.json(filteredTickets);
    } catch (error) {
      console.error("Error fetching tickets for order:", error);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });
}
