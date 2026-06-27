import OpenAI from "openai";
import { ShopwareClient } from "./shopware";
import type { Product } from "@shared/schema";

export interface PricingRecommendation {
  totalCatalogValue: number;
  totalSuggestedValue: number;
  totalDiscountPercentage: number;
  reasoning?: string;
}

export interface LineItemWithPricing {
  extractedProductName: string;
  extractedProductNumber?: string;
  quantity: number;
  matchedProduct?: {
    id: string;
    productNumber: string;
    name: string;
    catalogPrice: number;
    suggestedPrice?: number;
    suggestedDiscount?: number;
  };
  alternativeMatches?: Array<{
    id: string;
    productNumber: string;
    name: string;
    price: number;
    confidence: number;
  }>;
  systemMatch?: any;
  confidence: number;
  status: string;
  productScreen?: { likelihood: string; reasons?: string[] };
}

interface CustomerAnalytics {
  totalOrders: number;
  lifetimeValue: number;
  averageOrderValue: number;
  orderFrequency: number; // orders per month
  lastOrderDate?: Date;
  isVIP: boolean;
}

/**
 * Fetch customer analytics from Shopware order history
 */
async function getCustomerAnalytics(
  shopwareClient: ShopwareClient,
  customerEmail: string
): Promise<CustomerAnalytics | null> {
  try {
    // Find customer by email
    const customer = await shopwareClient.findCustomerByEmail(customerEmail);
    if (!customer) {
      console.log(`[Smart Pricing] Customer not found: ${customerEmail}`);
      return null;
    }

    console.log(`[Smart Pricing] Fetching order history for customer: ${customerEmail}`);
    
    // Fetch all orders from Shopware
    const allOrders = await shopwareClient.fetchOrders();
    
    // Filter orders for this customer by email
    const customerOrders = allOrders.filter(
      order => order.customerEmail?.toLowerCase() === customerEmail.toLowerCase()
    );

    if (customerOrders.length === 0) {
      console.log(`[Smart Pricing] No order history found for customer`);
      return {
        totalOrders: 0,
        lifetimeValue: 0,
        averageOrderValue: 0,
        orderFrequency: 0,
        isVIP: false,
      };
    }

    // Calculate analytics
    const totalOrders = customerOrders.length;
    const lifetimeValue = customerOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const averageOrderValue = lifetimeValue / totalOrders;

    // Calculate order frequency (orders per month)
    const orderDates = customerOrders.map(o => new Date(o.orderDate)).sort((a, b) => a.getTime() - b.getTime());
    const firstOrderDate = orderDates[0];
    const lastOrderDate = orderDates[orderDates.length - 1];
    const monthsBetween = (lastOrderDate.getTime() - firstOrderDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    const orderFrequency = monthsBetween > 0 ? totalOrders / monthsBetween : totalOrders;

    // Determine VIP status: >5 orders OR LTV > €5000
    const isVIP = totalOrders > 5 || lifetimeValue > 5000;

    console.log(`[Smart Pricing] Customer analytics - Orders: ${totalOrders}, LTV: €${lifetimeValue.toFixed(2)}, VIP: ${isVIP}`);

    return {
      totalOrders,
      lifetimeValue,
      averageOrderValue,
      orderFrequency,
      lastOrderDate,
      isVIP,
    };
  } catch (error) {
    console.error("[Smart Pricing] Error fetching customer analytics:", error);
    return null;
  }
}

/**
 * Generate smart pricing recommendations using AI
 * Considers:
 * - Catalog prices
 * - Order quantity (volume discounts)
 * - Customer history and lifetime value
 * - Product margins
 */
export async function generateSmartPricing(
  lineItems: Array<{
    extractedProductName: string;
    extractedProductNumber?: string;
    quantity: number;
    matchedProduct?: {
      id: string;
      productNumber: string;
      name: string;
      price: number;
    };
    confidence: number;
    status: string;
  }>,
  customerEmail?: string,
  openaiClient?: OpenAI,
  shopwareClient?: ShopwareClient
): Promise<{
  items: LineItemWithPricing[];
  pricingRecommendations: PricingRecommendation;
}> {
  // Fetch customer analytics if available
  let customerAnalytics: CustomerAnalytics | null = null;
  if (shopwareClient && customerEmail) {
    try {
      customerAnalytics = await getCustomerAnalytics(shopwareClient, customerEmail);
    } catch (error) {
      console.warn("[Smart Pricing] Failed to fetch customer analytics:", error);
    }
  }

  // Calculate total catalog value
  let totalCatalogValue = 0;
  const itemsWithPricing: LineItemWithPricing[] = [];

  // Process each line item
  for (const item of lineItems) {
    const screen = (item as { productScreen?: { likelihood: string } }).productScreen;
    if (screen?.likelihood === "unlikely_product") {
      itemsWithPricing.push({
        extractedProductName: item.extractedProductName,
        extractedProductNumber: item.extractedProductNumber,
        quantity: item.quantity,
        alternativeMatches: (item as any).alternativeMatches,
        systemMatch: (item as any).systemMatch,
        confidence: item.confidence,
        status: item.status,
        productScreen: screen as any,
      });
      continue;
    }

    if (item.matchedProduct) {
      const catalogPrice = item.matchedProduct.price;
      const itemTotal = catalogPrice * item.quantity;
      totalCatalogValue += itemTotal;

      // Calculate base discount based on quantity
      let baseDiscount = 0;
      if (item.quantity >= 10) {
        baseDiscount = 10; // 10% for 10+ units
      } else if (item.quantity >= 5) {
        baseDiscount = 5; // 5% for 5-9 units
      } else if (item.quantity >= 3) {
        baseDiscount = 2; // 2% for 3-4 units
      }

      // Apply customer loyalty bonus if VIP
      if (customerAnalytics?.isVIP) {
        baseDiscount += 3; // Extra 3% for VIP customers
        console.log(`[Smart Pricing] Applied VIP bonus: +3% for ${item.matchedProduct.name}`);
      }

      // AI-enhanced discount if OpenAI is available
      let finalDiscount = baseDiscount;
      let suggestedPrice = catalogPrice * (1 - finalDiscount / 100);

      // If we have AI, let it refine the pricing based on customer data
      if (openaiClient) {
        try {
          const aiDiscount = await getAIDiscountRecommendation(
            openaiClient,
            item.matchedProduct.name,
            catalogPrice,
            item.quantity,
            baseDiscount,
            customerAnalytics
          );
          finalDiscount = aiDiscount;
          suggestedPrice = catalogPrice * (1 - finalDiscount / 100);
        } catch (error) {
          console.warn("[Smart Pricing] AI discount failed, using base discount:", error);
        }
      }

      itemsWithPricing.push({
        extractedProductName: item.extractedProductName,
        extractedProductNumber: item.extractedProductNumber,
        quantity: item.quantity,
        matchedProduct: {
          id: item.matchedProduct.id,
          productNumber: item.matchedProduct.productNumber,
          name: item.matchedProduct.name,
          catalogPrice: catalogPrice,
          suggestedPrice: suggestedPrice,
          suggestedDiscount: finalDiscount,
        },
        alternativeMatches: (item as any).alternativeMatches,
        systemMatch: (item as any).systemMatch,
        confidence: item.confidence,
        status: item.status,
        productScreen: (item as any).productScreen,
      });
    } else {
      // No matched product - pass through unchanged (including alternatives)
      itemsWithPricing.push({
        extractedProductName: item.extractedProductName,
        extractedProductNumber: item.extractedProductNumber,
        quantity: item.quantity,
        alternativeMatches: (item as any).alternativeMatches,
        systemMatch: (item as any).systemMatch,
        confidence: item.confidence,
        status: item.status,
        productScreen: (item as any).productScreen,
      });
    }
  }

  // Calculate suggested total
  const totalSuggestedValue = itemsWithPricing.reduce((sum, item) => {
    if (item.matchedProduct?.suggestedPrice) {
      return sum + item.matchedProduct.suggestedPrice * item.quantity;
    }
    return sum;
  }, 0);

  const totalDiscountPercentage =
    totalCatalogValue > 0
      ? ((totalCatalogValue - totalSuggestedValue) / totalCatalogValue) * 100
      : 0;

  // Generate AI reasoning if available
  let reasoning = `Mengenrabatt basierend auf Bestellmenge. Gesamt: ${totalDiscountPercentage.toFixed(1)}% Rabatt.`;

  if (openaiClient) {
    try {
      reasoning = await generatePricingReasoning(
        openaiClient,
        itemsWithPricing,
        totalCatalogValue,
        totalSuggestedValue,
        totalDiscountPercentage,
        customerAnalytics
      );
    } catch (error) {
      console.warn("[Smart Pricing] AI reasoning failed:", error);
    }
  }

  return {
    items: itemsWithPricing,
    pricingRecommendations: {
      totalCatalogValue,
      totalSuggestedValue,
      totalDiscountPercentage,
      reasoning,
    },
  };
}

/**
 * Use AI to refine discount percentage based on customer data and product info
 */
async function getAIDiscountRecommendation(
  openai: OpenAI,
  productName: string,
  catalogPrice: number,
  quantity: number,
  baseDiscount: number,
  customerAnalytics?: CustomerAnalytics | null
): Promise<number> {
  const customerContext = customerAnalytics
    ? `
Kundenhistorie:
- Anzahl bisheriger Bestellungen: ${customerAnalytics.totalOrders}
- Lifetime Value: €${customerAnalytics.lifetimeValue.toFixed(2)}
- Durchschnittlicher Bestellwert: €${customerAnalytics.averageOrderValue.toFixed(2)}
- Bestellfrequenz: ${customerAnalytics.orderFrequency.toFixed(1)} Bestellungen/Monat
- VIP-Status: ${customerAnalytics.isVIP ? 'Ja' : 'Nein'}`
    : `
Kundenhistorie: Neukunde (keine bisherigen Bestellungen)`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Du bist ein Experte für B2B-Preisgestaltung mit Fokus auf kundenspezifische Angebote. 
Deine Aufgabe ist es, einen intelligenten Rabatt-Vorschlag zu machen basierend auf:
- Produktname und Preis
- Bestellmenge
- Standard-Mengenrabatt
- Kundenhistorie und Lifetime Value
- Bestellfrequenz und Loyalität

Berücksichtige:
- Höhere Rabatte für größere Mengen
- Treue-Rabatte für langjährige Kunden
- VIP-Kunden verdienen bessere Konditionen
- Neukunden: Attraktive Einstiegspreise
- Typische B2B-Margen (20-40%)
- Langfristige Kundenbindung ist wichtiger als kurzfristige Marge

Antworte NUR mit einer Zahl (der empfohlene Rabatt in Prozent zwischen 0 und 35).`,
      },
      {
        role: "user",
        content: `Produkt: ${productName}
Katalogpreis: €${catalogPrice.toFixed(2)}
Menge: ${quantity}
Basis-Mengenrabatt: ${baseDiscount}%
${customerContext}

Welchen Rabatt (0-35%) würdest du unter Berücksichtigung der Kundenhistorie empfehlen?`,
      },
    ],
    temperature: 0.3,
    max_tokens: 10,
  });

  const discountText = completion.choices[0]?.message?.content?.trim();
  if (!discountText) {
    return baseDiscount;
  }

  // Parse discount percentage
  const discount = parseFloat(discountText.replace(/[^0-9.]/g, ""));
  if (isNaN(discount) || discount < 0 || discount > 35) {
    return baseDiscount;
  }

  return discount;
}

/**
 * Generate AI explanation for pricing strategy with customer context
 */
async function generatePricingReasoning(
  openai: OpenAI,
  items: LineItemWithPricing[],
  catalogTotal: number,
  suggestedTotal: number,
  discountPercent: number,
  customerAnalytics?: CustomerAnalytics | null
): Promise<string> {
  const itemSummary = items
    .filter((item) => item.matchedProduct)
    .map(
      (item) =>
        `- ${item.matchedProduct!.name}: ${item.quantity}x à €${item.matchedProduct!.catalogPrice.toFixed(2)} (Rabatt: ${item.matchedProduct!.suggestedDiscount?.toFixed(1)}%)`
    )
    .join("\n");

  const customerContext = customerAnalytics
    ? `
Kundeninformationen:
- Bisherige Bestellungen: ${customerAnalytics.totalOrders}
- Lifetime Value: €${customerAnalytics.lifetimeValue.toFixed(2)}
- VIP-Status: ${customerAnalytics.isVIP ? 'Ja' : 'Nein'}
- Bestellfrequenz: ${customerAnalytics.orderFrequency.toFixed(1)} Bestellungen/Monat`
    : `
Kundeninformationen: Neukunde`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Du bist ein B2B-Vertriebs-Assistent. Erstelle eine kurze, professionelle Begründung für die Preisstrategie eines Angebots.
        
Achte darauf:
- Kurz und prägnant (2-4 Sätze)
- Erwähne die Hauptgründe für Rabatte (Menge, Kundentreue, VIP-Status, Neukundengewinnung)
- Wenn VIP-Kunde: Wertschätzung ausdrücken
- Wenn Neukunde: Willkommensbonus erwähnen
- Professioneller, freundlicher Ton
- Auf Deutsch`,
      },
      {
        role: "user",
        content: `Angebots-Details:

${itemSummary}

${customerContext}

Katalogwert gesamt: €${catalogTotal.toFixed(2)}
Angebotspreis gesamt: €${suggestedTotal.toFixed(2)}
Gesamtrabatt: ${discountPercent.toFixed(1)}%

Erstelle eine kurze, überzeugende Begründung für diese Preisstrategie:`,
      },
    ],
    temperature: 0.7,
    max_tokens: 200,
  });

  return completion.choices[0]?.message?.content?.trim() || `Mengenrabatt: ${discountPercent.toFixed(1)}%`;
}
