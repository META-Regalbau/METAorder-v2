import type { AnalyticsQuery, AnalyticsResult, Order, Product } from "@shared/schema";
import { ShopwareClient } from "./shopware";
import type { IStorage } from "./storage";
import { generateForecast } from "./forecastEngine";
import type { ForecastConfig, ForecastInput } from "./forecastEngine";

/**
 * Analytics Query Executor
 * 
 * This module executes structured analytics queries against the database
 * (for orders) and Shopware API (for products/customers), returning
 * formatted results ready for visualization.
 */

interface QueryExecutionContext {
  storage: IStorage;
  shopwareClient?: ShopwareClient;
  orders?: Order[];
  products?: Product[];
  allowedChannelIds?: string[] | null; // SECURITY: Restricts data to user's assigned sales channels
}

/**
 * Main function to execute analytics queries
 * 
 * @param queryObj - Structured analytics query from NL processor
 * @param storage - Storage interface for database access
 * @param shopwareClient - Optional Shopware client for API access
 * @param allowedChannelIds - Optional sales channel filter for user permissions (null = admin, [] = no access, [...ids] = specific channels)
 * @returns Formatted analytics results with labels and data
 */
export async function executeAnalyticsQuery(
  queryObj: AnalyticsQuery,
  storage: IStorage,
  shopwareClient?: ShopwareClient,
  allowedChannelIds?: string[] | null
): Promise<AnalyticsResult> {
  console.log(`[Analytics Executor] Executing query type: ${queryObj.type}`);
  console.log(`[Analytics Executor] Parameters:`, JSON.stringify(queryObj.parameters, null, 2));
  
  if (allowedChannelIds) {
    console.log(`[Analytics Executor] SECURITY: Filtering by allowed sales channels:`, allowedChannelIds);
  } else if (allowedChannelIds === null) {
    console.log(`[Analytics Executor] SECURITY: Admin access - no sales channel filtering`);
  }

  const context: QueryExecutionContext = {
    storage,
    shopwareClient,
    allowedChannelIds,
  };

  try {
    // Route to appropriate query handler based on type
    switch (queryObj.type) {
      case 'top_products':
        return await executeTopProducts(queryObj, context);
      
      case 'delayed_orders':
        return await executeDelayedOrders(queryObj, context);
      
      case 'order_trends':
        return await executeOrderTrends(queryObj, context);
      
      case 'revenue_trends':
        return await executeRevenueTrends(queryObj, context);
      
      case 'customer_analysis':
        return await executeCustomerAnalysis(queryObj, context);
      
      case 'customer_rankings':
        return await executeCustomerRankings(queryObj, context);
      
      case 'product_performance':
        return await executeProductPerformance(queryObj, context);
      
      case 'category_performance':
        return await executeCategoryPerformance(queryObj, context);
      
      case 'payment_analysis':
        return await executePaymentAnalysis(queryObj, context);
      
      case 'sales_channel_analysis':
        return await executeSalesChannelAnalysis(queryObj, context);
      
      case 'order_status_distribution':
        return await executeOrderStatusDistribution(queryObj, context);
      
      case 'general_statistics':
        return await executeGeneralStatistics(queryObj, context);
      
      case 'revenue_forecast':
        return await executeRevenueForecast(queryObj, context);
      
      case 'product_demand_forecast':
        return await executeProductDemandForecast(queryObj, context);
      
      case 'seasonal_analysis':
        return await executeSeasonalAnalysis(queryObj, context);
      
      case 'trend_forecast':
        return await executeTrendForecast(queryObj, context);
      
      case 'weight_analysis':
        return await executeWeightAnalysis(queryObj, context);
      
      case 'item_count_analysis':
        return await executeItemCountAnalysis(queryObj, context);
      
      default:
        throw new Error(`Unsupported query type: ${queryObj.type}`);
    }
  } catch (error) {
    console.error('[Analytics Executor] Error executing query:', error);
    throw new Error(
      `Failed to execute analytics query: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Helper function to get orders from Shopware
 */
async function getOrders(context: QueryExecutionContext): Promise<Order[]> {
  if (context.orders) {
    return context.orders;
  }

  if (!context.shopwareClient) {
    throw new Error('Shopware client not available');
  }

  console.log('[Analytics Executor] Fetching orders from Shopware...');
  // SECURITY: Pass allowedChannelIds to fetchOrders for server-side filtering at Shopware API level
  const allOrders = await context.shopwareClient.fetchOrders(context.allowedChannelIds);
  console.log(`[Analytics Executor] Fetched ${allOrders.length} orders from Shopware (filtered by sales channels)`);
  
  // SECURITY: Double-check filtering locally as defense-in-depth (should already be filtered by Shopware)
  let filteredOrders: Order[];
  if (context.allowedChannelIds) {
    // User has specific channel restrictions
    filteredOrders = allOrders.filter(order => 
      context.allowedChannelIds!.includes(order.salesChannelId)
    );
    console.log(`[Analytics Executor] SECURITY: Filtered to ${filteredOrders.length} orders from user's assigned sales channels`);
  } else if (context.allowedChannelIds === null) {
    // Admin with full access
    filteredOrders = allOrders;
    console.log(`[Analytics Executor] SECURITY: Admin access - returning all ${filteredOrders.length} orders`);
  } else {
    // Undefined means no filtering context provided (backward compatibility)
    filteredOrders = allOrders;
    console.log(`[Analytics Executor] WARNING: No sales channel filtering context - returning all ${filteredOrders.length} orders`);
  }
  
  // Cache the filtered orders for reuse in downstream queries
  context.orders = filteredOrders;
  
  return filteredOrders;
}

/**
 * Helper function to filter orders by date range
 */
function filterOrdersByDate(orders: Order[], dateFrom?: string, dateTo?: string): Order[] {
  console.log(`[filterOrdersByDate] Input: ${orders.length} orders, dateFrom: ${dateFrom}, dateTo: ${dateTo}`);
  
  let filtered = orders;

  if (dateFrom) {
    const fromDate = new Date(dateFrom);
    console.log(`[filterOrdersByDate] Filtering from date: ${fromDate.toISOString()}`);
    const beforeFilter = filtered.length;
    filtered = filtered.filter(order => new Date(order.orderDate) >= fromDate);
    console.log(`[filterOrdersByDate] After dateFrom filter: ${filtered.length} orders (removed ${beforeFilter - filtered.length})`);
    
    // Log first few order dates for debugging
    if (filtered.length > 0) {
      console.log(`[filterOrdersByDate] Sample order dates after from filter:`, filtered.slice(0, 3).map(o => o.orderDate));
    }
  }

  if (dateTo) {
    const toDate = new Date(dateTo);
    console.log(`[filterOrdersByDate] Filtering to date: ${toDate.toISOString()}`);
    const beforeFilter = filtered.length;
    filtered = filtered.filter(order => new Date(order.orderDate) <= toDate);
    console.log(`[filterOrdersByDate] After dateTo filter: ${filtered.length} orders (removed ${beforeFilter - filtered.length})`);
  }

  console.log(`[filterOrdersByDate] Final result: ${filtered.length} orders`);
  return filtered;
}

/**
 * Execute TOP_PRODUCTS query
 */
async function executeTopProducts(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing TOP_PRODUCTS query');
  console.log('[Analytics Executor] Query parameters:', query.parameters);
  
  const orders = await getOrders(context);
  console.log(`[Analytics Executor] Total orders: ${orders.length}`);
  
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  console.log(`[Analytics Executor] Filtered orders: ${filtered.length}`);
  
  // Count total items
  let totalItems = 0;
  for (const order of filtered) {
    totalItems += order.items?.length || 0;
  }
  console.log(`[Analytics Executor] Total items in filtered orders: ${totalItems}`);
  
  // Aggregate products by total quantity sold
  const productStats = new Map<string, { name: string; quantity: number; revenue: number }>();
  
  for (const order of filtered) {
    if (!order.items || order.items.length === 0) {
      continue;
    }
    for (const item of order.items) {
      const existing = productStats.get(item.name) || { name: item.name, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue += item.total;
      productStats.set(item.name, existing);
    }
  }
  
  console.log(`[Analytics Executor] Unique products found: ${productStats.size}`);
  
  // Sort by quantity and take top N
  const limit = query.parameters.limit || 10;
  const topProducts = Array.from(productStats.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
  
  console.log(`[Analytics Executor] Found ${topProducts.length} top products`);
  
  return {
    labels: topProducts.map(p => p.name),
    data: topProducts.map(p => p.quantity),
    metadata: {
      revenues: topProducts.map(p => p.revenue),
    },
    summary: {
      total: topProducts.reduce((sum, p) => sum + p.quantity, 0),
      count: topProducts.length,
    },
  };
}

/**
 * Execute DELAYED_ORDERS query
 */
async function executeDelayedOrders(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing DELAYED_ORDERS query');
  
  const orders = await getOrders(context);
  const now = new Date();
  
  // Find orders where delivery date has passed but status is not completed
  const delayedOrders = orders.filter(order => {
    if (order.status === 'completed' || order.status === 'cancelled') {
      return false;
    }
    
    if (order.deliveryDateLatest) {
      const deliveryDate = new Date(order.deliveryDateLatest);
      return deliveryDate < now;
    }
    
    return false;
  });
  
  console.log(`[Analytics Executor] Found ${delayedOrders.length} delayed orders`);
  
  return {
    labels: delayedOrders.map(o => o.orderNumber),
    data: delayedOrders.map(o => ({
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      orderDate: o.orderDate,
      deliveryDateLatest: o.deliveryDateLatest,
      status: o.status,
      totalAmount: o.totalAmount,
      daysDelayed: Math.floor((now.getTime() - new Date(o.deliveryDateLatest!).getTime()) / (1000 * 60 * 60 * 24)),
    })),
    summary: {
      count: delayedOrders.length,
      total: delayedOrders.reduce((sum, o) => sum + o.totalAmount, 0),
    },
  };
}

/**
 * Execute ORDER_TRENDS query
 */
async function executeOrderTrends(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing ORDER_TRENDS query');
  console.log('[Analytics Executor] Query parameters:', JSON.stringify(query.parameters, null, 2));
  
  const orders = await getOrders(context);
  console.log(`[Analytics Executor] Total orders: ${orders.length}`);
  
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  console.log(`[Analytics Executor] Filtered orders: ${filtered.length}`);
  
  const groupBy = query.parameters.groupBy || 'day';
  const trends = groupOrdersByTime(filtered, groupBy);
  
  console.log(`[Analytics Executor] Generated ${trends.labels.length} data points for order trends`);
  
  return {
    labels: trends.labels,
    data: trends.counts,
    summary: {
      total: trends.counts.reduce((sum, count) => sum + count, 0),
      average: trends.counts.length > 0 ? trends.counts.reduce((sum, count) => sum + count, 0) / trends.counts.length : 0,
      count: trends.labels.length,
    },
  };
}

/**
 * Execute REVENUE_TRENDS query
 */
async function executeRevenueTrends(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing REVENUE_TRENDS query');
  console.log('[Analytics Executor] Query parameters:', JSON.stringify(query.parameters, null, 2));
  
  const orders = await getOrders(context);
  console.log(`[Analytics Executor] Total orders: ${orders.length}`);
  
  // Log some sample order dates
  if (orders.length > 0) {
    const sortedOrders = [...orders].sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
    console.log(`[Analytics Executor] Date range in orders: ${sortedOrders[0].orderDate} to ${sortedOrders[sortedOrders.length - 1].orderDate}`);
  }
  
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  console.log(`[Analytics Executor] Filtered orders: ${filtered.length}`);
  
  const groupBy = query.parameters.groupBy || 'day';
  const trends = groupOrdersByTime(filtered, groupBy, (orders) => 
    orders.reduce((sum, o) => sum + o.totalAmount, 0)
  );
  
  console.log(`[Analytics Executor] Generated ${trends.labels.length} data points for revenue trends`);
  
  return {
    labels: trends.labels,
    data: trends.counts,
    summary: {
      total: trends.counts.reduce((sum, revenue) => sum + revenue, 0),
      average: trends.counts.length > 0 ? trends.counts.reduce((sum, revenue) => sum + revenue, 0) / trends.counts.length : 0,
      count: trends.labels.length,
    },
  };
}

/**
 * Execute CUSTOMER_ANALYSIS query
 */
async function executeCustomerAnalysis(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing CUSTOMER_ANALYSIS query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // Aggregate by customer
  const customerStats = new Map<string, { name: string; orderCount: number; totalSpent: number }>();
  
  for (const order of filtered) {
    const existing = customerStats.get(order.customerEmail) || {
      name: order.customerName,
      orderCount: 0,
      totalSpent: 0,
    };
    existing.orderCount += 1;
    existing.totalSpent += order.totalAmount;
    customerStats.set(order.customerEmail, existing);
  }
  
  const customerData = Array.from(customerStats.values());
  
  console.log(`[Analytics Executor] Analyzed ${customerData.length} customers`);
  
  return {
    labels: customerData.map(c => c.name),
    data: customerData.map(c => ({
      name: c.name,
      orderCount: c.orderCount,
      totalSpent: c.totalSpent,
      averageOrderValue: c.totalSpent / c.orderCount,
    })),
    summary: {
      total: customerData.reduce((sum, c) => sum + c.totalSpent, 0),
      count: customerData.length,
      average: customerData.reduce((sum, c) => sum + c.totalSpent, 0) / customerData.length,
    },
  };
}

/**
 * Execute CUSTOMER_RANKINGS query
 */
async function executeCustomerRankings(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing CUSTOMER_RANKINGS query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // Aggregate by customer
  const customerStats = new Map<string, { name: string; orderCount: number; totalSpent: number }>();
  
  for (const order of filtered) {
    const existing = customerStats.get(order.customerEmail) || {
      name: order.customerName,
      orderCount: 0,
      totalSpent: 0,
    };
    existing.orderCount += 1;
    existing.totalSpent += order.totalAmount;
    customerStats.set(order.customerEmail, existing);
  }
  
  // Sort by total spent and take top N
  const limit = query.parameters.limit || 20;
  const topCustomers = Array.from(customerStats.values())
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);
  
  console.log(`[Analytics Executor] Found ${topCustomers.length} top customers`);
  
  return {
    labels: topCustomers.map(c => c.name),
    data: topCustomers.map(c => c.totalSpent),
    metadata: {
      orderCounts: topCustomers.map(c => c.orderCount),
      averageOrderValues: topCustomers.map(c => c.totalSpent / c.orderCount),
    },
    summary: {
      total: topCustomers.reduce((sum, c) => sum + c.totalSpent, 0),
      count: topCustomers.length,
    },
  };
}

/**
 * Execute PRODUCT_PERFORMANCE query
 */
async function executeProductPerformance(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing PRODUCT_PERFORMANCE query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // If productId is specified, filter for that product
  const productId = query.parameters.productId;
  const productStats = new Map<string, { name: string; quantity: number; revenue: number }>();
  
  for (const order of filtered) {
    for (const item of order.items) {
      if (productId && item.id !== productId) {
        continue;
      }
      
      const existing = productStats.get(item.name) || { name: item.name, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue += item.total;
      productStats.set(item.name, existing);
    }
  }
  
  const products = Array.from(productStats.values());
  
  console.log(`[Analytics Executor] Analyzed ${products.length} products`);
  
  return {
    labels: products.map(p => p.name),
    data: products.map(p => p.revenue),
    metadata: {
      quantities: products.map(p => p.quantity),
    },
    summary: {
      total: products.reduce((sum, p) => sum + p.revenue, 0),
      count: products.length,
    },
  };
}

/**
 * Execute CATEGORY_PERFORMANCE query
 */
async function executeCategoryPerformance(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing CATEGORY_PERFORMANCE query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // Aggregate by category
  const categoryStats = new Map<string, { quantity: number; revenue: number }>();
  
  for (const order of filtered) {
    for (const item of order.items) {
      const categories = item.categoryNames || ['Uncategorized'];
      
      for (const category of categories) {
        const existing = categoryStats.get(category) || { quantity: 0, revenue: 0 };
        existing.quantity += item.quantity;
        existing.revenue += item.total;
        categoryStats.set(category, existing);
      }
    }
  }
  
  const categories = Array.from(categoryStats.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue);
  
  console.log(`[Analytics Executor] Analyzed ${categories.length} categories`);
  
  return {
    labels: categories.map(c => c.name),
    data: categories.map(c => c.revenue),
    metadata: {
      quantities: categories.map(c => c.quantity),
    },
    summary: {
      total: categories.reduce((sum, c) => sum + c.revenue, 0),
      count: categories.length,
    },
  };
}

/**
 * Execute PAYMENT_ANALYSIS query
 */
async function executePaymentAnalysis(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing PAYMENT_ANALYSIS query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // Group by payment status
  const paymentStats = new Map<string, { count: number; amount: number }>();
  
  for (const order of filtered) {
    const status = order.paymentStatus;
    const existing = paymentStats.get(status) || { count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += order.totalAmount;
    paymentStats.set(status, existing);
  }
  
  const statuses = Array.from(paymentStats.entries())
    .map(([status, stats]) => ({ status, ...stats }));
  
  console.log(`[Analytics Executor] Analyzed ${statuses.length} payment statuses`);
  
  return {
    labels: statuses.map(s => s.status),
    data: statuses.map(s => s.count),
    metadata: {
      amounts: statuses.map(s => s.amount),
    },
    summary: {
      total: statuses.reduce((sum, s) => sum + s.amount, 0),
      count: statuses.reduce((sum, s) => sum + s.count, 0),
    },
  };
}

/**
 * Execute SALES_CHANNEL_ANALYSIS query
 */
async function executeSalesChannelAnalysis(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing SALES_CHANNEL_ANALYSIS query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // Group by sales channel
  const channelStats = new Map<string, { count: number; revenue: number }>();
  
  for (const order of filtered) {
    const channel = order.salesChannelName || 'Unknown';
    const existing = channelStats.get(channel) || { count: 0, revenue: 0 };
    existing.count += 1;
    existing.revenue += order.totalAmount;
    channelStats.set(channel, existing);
  }
  
  const channels = Array.from(channelStats.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue);
  
  console.log(`[Analytics Executor] Analyzed ${channels.length} sales channels`);
  
  return {
    labels: channels.map(c => c.name),
    data: channels.map(c => c.revenue),
    metadata: {
      orderCounts: channels.map(c => c.count),
    },
    summary: {
      total: channels.reduce((sum, c) => sum + c.revenue, 0),
      count: channels.length,
    },
  };
}

/**
 * Execute ORDER_STATUS_DISTRIBUTION query
 */
async function executeOrderStatusDistribution(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing ORDER_STATUS_DISTRIBUTION query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  // Group by status
  const statusStats = new Map<string, number>();
  
  for (const order of filtered) {
    const count = statusStats.get(order.status) || 0;
    statusStats.set(order.status, count + 1);
  }
  
  const statuses = Array.from(statusStats.entries())
    .map(([status, count]) => ({ status, count }));
  
  console.log(`[Analytics Executor] Analyzed ${statuses.length} order statuses`);
  
  return {
    labels: statuses.map(s => s.status),
    data: statuses.map(s => s.count),
    summary: {
      total: statuses.reduce((sum, s) => sum + s.count, 0),
      count: statuses.length,
    },
  };
}

/**
 * Execute GENERAL_STATISTICS query
 */
async function executeGeneralStatistics(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  console.log('[Analytics Executor] Executing GENERAL_STATISTICS query');
  
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, query.parameters.dateFrom, query.parameters.dateTo);
  
  const totalRevenue = filtered.reduce((sum, o) => sum + o.totalAmount, 0);
  const averageOrderValue = totalRevenue / filtered.length;
  
  const stats = [
    { label: 'Anzahl Bestellungen', value: filtered.length },
    { label: 'Gesamtumsatz', value: totalRevenue },
    { label: 'Durchschn. Bestellwert', value: averageOrderValue },
  ];
  
  console.log(`[Analytics Executor] Generated general statistics for ${filtered.length} orders`);
  
  return {
    labels: stats.map(s => s.label),
    data: stats.map(s => s.value),
    summary: {
      total: totalRevenue,
      average: averageOrderValue,
      count: filtered.length,
    },
  };
}

/**
 * Helper function to group orders by time period
 */
function groupOrdersByTime(
  orders: Order[],
  groupBy: 'day' | 'week' | 'month' | 'year',
  valueFn: (orders: Order[]) => number = (orders) => orders.length
): { labels: string[]; counts: number[] } {
  console.log(`[groupOrdersByTime] Grouping ${orders.length} orders by ${groupBy}`);
  
  const groups = new Map<string, Order[]>();
  
  for (const order of orders) {
    const date = new Date(order.orderDate);
    let key: string;
    
    switch (groupBy) {
      case 'day':
        key = date.toISOString().split('T')[0];
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
        break;
      case 'month':
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'year':
        key = String(date.getFullYear());
        break;
    }
    
    const existing = groups.get(key) || [];
    existing.push(order);
    groups.set(key, existing);
  }
  
  console.log(`[groupOrdersByTime] Created ${groups.size} groups`);
  if (groups.size > 0) {
    console.log(`[groupOrdersByTime] Sample groups:`, Array.from(groups.keys()).slice(0, 5));
  }
  
  // Sort by date and calculate values
  const sorted = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  
  return {
    labels: sorted.map(([key]) => key),
    counts: sorted.map(([, orders]) => valueFn(orders)),
  };
}

/**
 * Execute revenue forecast query
 */
async function executeRevenueForecast(
  queryObj: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  const { parameters } = queryObj;
  const {
    dateFrom,
    dateTo,
    forecastPeriods = 12,
    forecastUnit = 'month',
    algorithm = 'auto',
    includeSeasonality = true,
    confidenceLevel = 0.95,
    groupBy = 'month',
  } = parameters;

  console.log('[Revenue Forecast] Collecting historical revenue data...');

  // Get historical revenue data
  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, dateFrom, dateTo);
  
  // Group by time period to get revenue trends
  const grouped = groupOrdersByTime(
    filtered,
    groupBy as 'day' | 'week' | 'month' | 'year',
    (orders) => orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0)
  );

  console.log(`[Revenue Forecast] Historical data: ${grouped.labels.length} periods`);

  // Prepare forecast input
  const forecastInput: ForecastInput = {
    labels: grouped.labels,
    values: grouped.counts,
  };

  const forecastConfig: ForecastConfig = {
    periods: forecastPeriods,
    unit: forecastUnit as "day" | "week" | "month" | "quarter" | "year",
    confidenceLevel,
    includeSeasonality,
    algorithm,
  };

  // Generate forecast
  const forecastOutput = await generateForecast(forecastInput, forecastConfig);

  // Combine historical + forecast data
  const allLabels = [...grouped.labels, ...forecastOutput.forecastLabels];
  const allData = [...grouped.counts, ...forecastOutput.forecastValues];

  // Calculate summary statistics
  const historicalTotal = grouped.counts.reduce((a, b) => a + b, 0);
  const forecastTotal = forecastOutput.forecastValues.reduce((a, b) => a + b, 0);

  return {
    labels: allLabels,
    data: allData,
    metadata: {
      historicalPeriods: grouped.labels.length,
      forecastPeriods: forecastOutput.forecastLabels.length,
      historicalTotal,
      forecastTotal,
    },
    summary: {
      total: historicalTotal + forecastTotal,
      average: (historicalTotal + forecastTotal) / allData.length,
      min: Math.min(...allData),
      max: Math.max(...allData),
      count: allData.length,
    },
    forecast: {
      periods: forecastOutput.forecastLabels.length,
      values: forecastOutput.forecastValues,
      lowerBound: forecastOutput.lowerBound,
      upperBound: forecastOutput.upperBound,
      accuracy: forecastOutput.accuracy,
      algorithm: forecastOutput.algorithm,
      seasonalityDetected: forecastOutput.seasonalityDetected,
    },
  };
}

/**
 * Execute product demand forecast query
 */
async function executeProductDemandForecast(
  queryObj: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  const { parameters } = queryObj;
  const {
    productId,
    dateFrom,
    dateTo,
    forecastPeriods = 12,
    forecastUnit = 'month',
    algorithm = 'auto',
    groupBy = 'month',
  } = parameters;

  console.log('[Product Demand Forecast] Collecting historical product sales...');

  const orders = await getOrders(context);
  let filtered = filterOrdersByDate(orders, dateFrom, dateTo);

  // If specific product, filter line items
  if (productId) {
    filtered = filtered.filter(order =>
      order.items?.some((item: any) => item.productId === productId)
    );
  }

  // Group by time and count product quantities
  const grouped = groupOrdersByTime(
    filtered,
    groupBy as 'day' | 'week' | 'month' | 'year',
    (orders) => {
      return orders.reduce((sum, order) => {
        const qty = order.items?.reduce((itemSum: number, item: any) => {
          if (!productId || item.productId === productId) {
            return itemSum + (item.quantity || 0);
          }
          return itemSum;
        }, 0) || 0;
        return sum + qty;
      }, 0);
    }
  );

  console.log(`[Product Demand Forecast] Historical data: ${grouped.labels.length} periods`);

  // Generate forecast
  const forecastOutput = await generateForecast(
    { labels: grouped.labels, values: grouped.counts },
    {
      periods: forecastPeriods,
      unit: forecastUnit as "day" | "week" | "month" | "quarter" | "year",
      algorithm,
      includeSeasonality: true,
    }
  );

  const allLabels = [...grouped.labels, ...forecastOutput.forecastLabels];
  const allData = [...grouped.counts, ...forecastOutput.forecastValues];

  return {
    labels: allLabels,
    data: allData,
    metadata: {
      productId,
      historicalPeriods: grouped.labels.length,
      forecastPeriods: forecastOutput.forecastLabels.length,
    },
    summary: {
      total: allData.reduce((a, b) => a + b, 0),
      average: allData.reduce((a, b) => a + b, 0) / allData.length,
      count: allData.length,
    },
    forecast: {
      periods: forecastOutput.forecastLabels.length,
      values: forecastOutput.forecastValues,
      lowerBound: forecastOutput.lowerBound,
      upperBound: forecastOutput.upperBound,
      accuracy: forecastOutput.accuracy,
      algorithm: forecastOutput.algorithm,
      seasonalityDetected: forecastOutput.seasonalityDetected,
    },
  };
}

/**
 * Execute seasonal analysis query
 */
async function executeSeasonalAnalysis(
  queryObj: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  const { parameters } = queryObj;
  const {
    dateFrom,
    dateTo,
    groupBy = 'week',
  } = parameters;

  console.log('[Seasonal Analysis] Analyzing seasonal patterns...');

  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, dateFrom, dateTo);

  // Group by time period
  const grouped = groupOrdersByTime(
    filtered,
    groupBy as 'day' | 'week' | 'month' | 'year',
    (orders) => orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0)
  );

  console.log(`[Seasonal Analysis] Analyzing ${grouped.labels.length} periods`);

  // Use forecast engine's seasonal detection
  const forecastOutput = await generateForecast(
    { labels: grouped.labels, values: grouped.counts },
    {
      periods: 1, // We just want to detect seasonality
      unit: groupBy as "day" | "week" | "month" | "quarter" | "year",
      algorithm: 'seasonal',
      includeSeasonality: true,
    }
  );

  return {
    labels: grouped.labels,
    data: grouped.counts,
    metadata: {
      seasonalityDetected: forecastOutput.seasonalityDetected,
      seasonalPeriod: forecastOutput.metadata?.seasonalPeriod,
      avgSeasonalVariation: forecastOutput.metadata?.avgSeasonalVariation,
      trend: forecastOutput.metadata?.trend,
      trendStrength: forecastOutput.metadata?.trendStrength,
    },
    summary: {
      total: grouped.counts.reduce((a, b) => a + b, 0),
      average: grouped.counts.reduce((a, b) => a + b, 0) / grouped.counts.length,
      min: Math.min(...grouped.counts),
      max: Math.max(...grouped.counts),
      count: grouped.counts.length,
    },
  };
}

/**
 * Execute trend forecast query
 */
async function executeTrendForecast(
  queryObj: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  const { parameters } = queryObj;
  const {
    dateFrom,
    dateTo,
    forecastPeriods = 6,
    forecastUnit = 'month',
    algorithm = 'auto',
    groupBy = 'month',
  } = parameters;

  console.log('[Trend Forecast] Generating trend forecast...');

  const orders = await getOrders(context);
  const filtered = filterOrdersByDate(orders, dateFrom, dateTo);

  // Group orders to identify trend
  const grouped = groupOrdersByTime(
    filtered,
    groupBy as 'day' | 'week' | 'month' | 'year',
    (orders) => orders.length
  );

  console.log(`[Trend Forecast] Historical data: ${grouped.labels.length} periods`);

  // Generate forecast
  const forecastOutput = await generateForecast(
    { labels: grouped.labels, values: grouped.counts },
    {
      periods: forecastPeriods,
      unit: forecastUnit as "day" | "week" | "month" | "quarter" | "year",
      algorithm,
      includeSeasonality: false, // Focus on trend, not seasonality
    }
  );

  const allLabels = [...grouped.labels, ...forecastOutput.forecastLabels];
  const allData = [...grouped.counts, ...forecastOutput.forecastValues];

  return {
    labels: allLabels,
    data: allData,
    metadata: {
      trend: forecastOutput.metadata?.trend,
      trendStrength: forecastOutput.metadata?.trendStrength,
      historicalPeriods: grouped.labels.length,
      forecastPeriods: forecastOutput.forecastLabels.length,
    },
    summary: {
      total: allData.reduce((a, b) => a + b, 0),
      average: allData.reduce((a, b) => a + b, 0) / allData.length,
      min: Math.min(...allData),
      max: Math.max(...allData),
      count: allData.length,
    },
    forecast: {
      periods: forecastOutput.forecastLabels.length,
      values: forecastOutput.forecastValues,
      lowerBound: forecastOutput.lowerBound,
      upperBound: forecastOutput.upperBound,
      accuracy: forecastOutput.accuracy,
      algorithm: forecastOutput.algorithm,
      seasonalityDetected: forecastOutput.seasonalityDetected,
    },
  };
}

/**
 * Execute weight analysis query
 * Calculates average order weight, total weight, and weight distribution
 */
async function executeWeightAnalysis(
  queryObj: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  const { parameters } = queryObj;
  const { dateFrom, dateTo, salesChannelId } = parameters;

  console.log('[Weight Analysis] Analyzing order weights...');

  let orders = await getOrders(context);
  orders = filterOrdersByDate(orders, dateFrom, dateTo);
  
  if (salesChannelId) {
    orders = orders.filter(o => o.salesChannelId === salesChannelId);
  }

  console.log(`[Weight Analysis] Analyzing ${orders.length} orders`);

  // Calculate weight statistics for each order
  const orderWeights: { orderNumber: string; weight: number; itemsWithWeight: number; totalItems: number }[] = [];
  let totalWeight = 0;
  let ordersWithWeight = 0;
  let totalItemsWithWeight = 0;
  let totalItems = 0;

  for (const order of orders) {
    if (!order.items || order.items.length === 0) continue;
    
    let orderWeight = 0;
    let itemsWithWeight = 0;
    
    for (const item of order.items) {
      totalItems++;
      if (item.weight !== undefined && item.weight !== null) {
        orderWeight += item.weight * item.quantity;
        itemsWithWeight++;
        totalItemsWithWeight++;
      }
    }
    
    if (itemsWithWeight > 0) {
      ordersWithWeight++;
      totalWeight += orderWeight;
      orderWeights.push({
        orderNumber: order.orderNumber,
        weight: orderWeight,
        itemsWithWeight,
        totalItems: order.items.length,
      });
    }
  }

  const averageWeight = ordersWithWeight > 0 ? totalWeight / ordersWithWeight : 0;
  
  // Create weight distribution buckets (0-1kg, 1-5kg, 5-10kg, 10-25kg, 25-50kg, 50kg+)
  const weightBuckets = [
    { label: '0-1 kg', min: 0, max: 1, count: 0 },
    { label: '1-5 kg', min: 1, max: 5, count: 0 },
    { label: '5-10 kg', min: 5, max: 10, count: 0 },
    { label: '10-25 kg', min: 10, max: 25, count: 0 },
    { label: '25-50 kg', min: 25, max: 50, count: 0 },
    { label: '50+ kg', min: 50, max: Infinity, count: 0 },
  ];
  
  for (const ow of orderWeights) {
    for (const bucket of weightBuckets) {
      if (ow.weight >= bucket.min && ow.weight < bucket.max) {
        bucket.count++;
        break;
      }
    }
  }

  // Sort orders by weight descending for top heavy orders
  const topHeavyOrders = [...orderWeights].sort((a, b) => b.weight - a.weight).slice(0, 10);

  console.log(`[Weight Analysis] Total weight: ${totalWeight.toFixed(2)} kg, Average: ${averageWeight.toFixed(2)} kg`);
  console.log(`[Weight Analysis] Orders with weight data: ${ordersWithWeight}/${orders.length}`);

  return {
    labels: weightBuckets.map(b => b.label),
    data: weightBuckets.map(b => b.count),
    metadata: {
      totalOrders: orders.length,
      ordersWithWeight,
      ordersWithoutWeight: orders.length - ordersWithWeight,
      totalItems,
      itemsWithWeight: totalItemsWithWeight,
      itemsWithoutWeight: totalItems - totalItemsWithWeight,
      weightCoverage: orders.length > 0 ? ((ordersWithWeight / orders.length) * 100).toFixed(1) + '%' : '0%',
      topHeavyOrders: topHeavyOrders.map(o => ({
        orderNumber: o.orderNumber,
        weight: o.weight.toFixed(2) + ' kg',
      })),
    },
    summary: {
      total: parseFloat(totalWeight.toFixed(2)),
      average: parseFloat(averageWeight.toFixed(2)),
      min: orderWeights.length > 0 ? parseFloat(Math.min(...orderWeights.map(o => o.weight)).toFixed(2)) : 0,
      max: orderWeights.length > 0 ? parseFloat(Math.max(...orderWeights.map(o => o.weight)).toFixed(2)) : 0,
      count: ordersWithWeight,
    },
  };
}

/**
 * Execute ITEM_COUNT_ANALYSIS query
 * Analyzes the number of items per order
 */
async function executeItemCountAnalysis(
  query: AnalyticsQuery,
  context: QueryExecutionContext
): Promise<AnalyticsResult> {
  const { dateFrom, dateTo, salesChannelId } = query.parameters;
  
  console.log('[Item Count Analysis] Analyzing item counts per order...');

  let orders = await getOrders(context);
  orders = filterOrdersByDate(orders, dateFrom, dateTo);
  
  if (salesChannelId) {
    orders = orders.filter(o => o.salesChannelId === salesChannelId);
  }

  console.log(`[Item Count Analysis] Analyzing ${orders.length} orders`);

  // Calculate item count statistics for each order
  const orderItemCounts: { orderNumber: string; itemCount: number; totalQuantity: number }[] = [];
  let totalLineItems = 0;
  let totalQuantity = 0;

  for (const order of orders) {
    const lineItemCount = order.items?.length || 0;
    const quantitySum = order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    
    totalLineItems += lineItemCount;
    totalQuantity += quantitySum;
    
    orderItemCounts.push({
      orderNumber: order.orderNumber,
      itemCount: lineItemCount,
      totalQuantity: quantitySum,
    });
  }

  const averageLineItems = orders.length > 0 ? totalLineItems / orders.length : 0;
  const averageQuantity = orders.length > 0 ? totalQuantity / orders.length : 0;
  
  // Create item count distribution buckets (1, 2-3, 4-5, 6-10, 11-20, 20+)
  const itemCountBuckets = [
    { label: '1 Artikel', min: 1, max: 2, count: 0 },
    { label: '2-3 Artikel', min: 2, max: 4, count: 0 },
    { label: '4-5 Artikel', min: 4, max: 6, count: 0 },
    { label: '6-10 Artikel', min: 6, max: 11, count: 0 },
    { label: '11-20 Artikel', min: 11, max: 21, count: 0 },
    { label: '20+ Artikel', min: 21, max: Infinity, count: 0 },
  ];
  
  // Create quantity distribution buckets
  const quantityBuckets = [
    { label: '1-2 Stück', min: 1, max: 3, count: 0 },
    { label: '3-5 Stück', min: 3, max: 6, count: 0 },
    { label: '6-10 Stück', min: 6, max: 11, count: 0 },
    { label: '11-25 Stück', min: 11, max: 26, count: 0 },
    { label: '26-50 Stück', min: 26, max: 51, count: 0 },
    { label: '50+ Stück', min: 51, max: Infinity, count: 0 },
  ];
  
  for (const oc of orderItemCounts) {
    // Bucket by line item count
    for (const bucket of itemCountBuckets) {
      if (oc.itemCount >= bucket.min && oc.itemCount < bucket.max) {
        bucket.count++;
        break;
      }
    }
    // Bucket by total quantity
    for (const bucket of quantityBuckets) {
      if (oc.totalQuantity >= bucket.min && oc.totalQuantity < bucket.max) {
        bucket.count++;
        break;
      }
    }
  }

  // Sort orders by quantity descending for top orders
  const topOrdersByQuantity = [...orderItemCounts].sort((a, b) => b.totalQuantity - a.totalQuantity).slice(0, 10);
  const topOrdersByLineItems = [...orderItemCounts].sort((a, b) => b.itemCount - a.itemCount).slice(0, 10);

  console.log(`[Item Count Analysis] Total line items: ${totalLineItems}, Total quantity: ${totalQuantity}`);
  console.log(`[Item Count Analysis] Average line items: ${averageLineItems.toFixed(2)}, Average quantity: ${averageQuantity.toFixed(2)}`);

  return {
    labels: itemCountBuckets.map(b => b.label),
    data: itemCountBuckets.map(b => b.count),
    metadata: {
      totalOrders: orders.length,
      totalLineItems,
      totalQuantity,
      averageLineItems: parseFloat(averageLineItems.toFixed(2)),
      averageQuantity: parseFloat(averageQuantity.toFixed(2)),
      quantityDistribution: quantityBuckets.map(b => ({ label: b.label, count: b.count })),
      topOrdersByQuantity: topOrdersByQuantity.map(o => ({
        orderNumber: o.orderNumber,
        quantity: o.totalQuantity,
        lineItems: o.itemCount,
      })),
      topOrdersByLineItems: topOrdersByLineItems.map(o => ({
        orderNumber: o.orderNumber,
        lineItems: o.itemCount,
        quantity: o.totalQuantity,
      })),
    },
    summary: {
      total: totalQuantity,
      average: parseFloat(averageQuantity.toFixed(2)),
      min: orderItemCounts.length > 0 ? Math.min(...orderItemCounts.map(o => o.totalQuantity)) : 0,
      max: orderItemCounts.length > 0 ? Math.max(...orderItemCounts.map(o => o.totalQuantity)) : 0,
      count: orders.length,
    },
  };
}
