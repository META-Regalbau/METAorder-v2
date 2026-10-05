// Shopware: Angebote (B2B Sellers) lesen und als PDF laden.
import type { ShopwareClient } from "../shopware";
import { logger } from "../../lib/logger";

const log = logger.child({ component: "shopware/client/offers" });

/**
 * Fetch all offers from PremSoft Individual Offer plugin
 */
export async function fetchOffers(this: ShopwareClient): Promise<any[]> {
  try {
    const limit = 100;
    let page = 1;
    let allOffers: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/prems-individual-offer`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch offers: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      const offers = result.data || [];
      
      allOffers = allOffers.concat(offers);
      
      // Check if there are more pages
      const total = result.meta?.total || offers.length;
      hasMore = allOffers.length < total;
      page++;
      
      // Safety check to avoid infinite loops
      if (page > 100) {
        log.warn("Reached maximum page limit for offers");
        break;
      }
    }

    return allOffers;
  } catch (error) {
    log.error({ err: error }, "Error fetching offers from Shopware:");
    throw error;
  }
}

/**
 * Fetch single offer with full details from PremSoft plugin
 */
export async function fetchOfferById(this: ShopwareClient, offerId: string): Promise<any> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/prems-individual-offer/${offerId}?associations[items][]=&associations[customer][]=`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch offer: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    return result.data || result;
  } catch (error) {
    log.error({ err: error }, "Error fetching offer by ID:");
    throw error;
  }
}

/**
 * Fetch offer PDF from PremSoft plugin
 */
export async function fetchOfferPDF(this: ShopwareClient, offerId: string, customerId: string, salesChannelId: string): Promise<Buffer> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/prems/offer/renderpdf/${offerId}?customerId=${customerId}&salesChannelId=${salesChannelId}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch offer PDF: ${response.statusText} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    log.error({ err: error }, "Error fetching offer PDF:");
    throw error;
  }
}
