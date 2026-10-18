import { mirrorFreshnessDetector } from "./mirrorFreshness";
import { orderGapDetector, paymentGoneDetector, weekComparisonDetector } from "./revenue";
import { channelMethodsDetector, productBuyabilityDetector } from "./buyability";
import { cartProbeDetector, productPagesDetector } from "./storefront";
import { GA4_DETECTORS } from "./ga4";
import { offerWatchDetector } from "./offers";
import type { ShopPulseDetector } from "./types";

/**
 * Alle Prüfungen, in dieser Reihenfolge nacheinander. Die Spiegel-Frische steht vorn: hängt der
 * Bestellabgleich, setzen die Umsatz-Prüfungen aus. Zahl- und Versandarten prüft jeder Takt, die Artikel nur der Nachtlauf.
 * Produktseiten (5 je Takt) und Warenkorb-Probe (30 Minuten, 6–22 Uhr) fragen die Storefront ab, unter der Sperre des Shop-Wächters.
 * GA4: Live-Trichter alle 30 Minuten (6–22 Uhr), die übrigen einmal am Tag ab 7 Uhr; ohne GA4-Einrichtung setzen sie aus.
 * Angebotsanfragen (B2Bsellers) einmal je Stunde.
 */
export const SHOP_PULSE_DETECTORS: ShopPulseDetector[] = [
  mirrorFreshnessDetector,
  orderGapDetector,
  paymentGoneDetector,
  weekComparisonDetector,
  channelMethodsDetector,
  productBuyabilityDetector,
  productPagesDetector,
  cartProbeDetector,
  ...GA4_DETECTORS,
  offerWatchDetector,
];
