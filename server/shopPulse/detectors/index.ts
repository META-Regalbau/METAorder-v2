import { mirrorFreshnessDetector } from "./mirrorFreshness";
import { orderGapDetector, paymentGoneDetector, weekComparisonDetector } from "./revenue";
import { channelMethodsDetector, productBuyabilityDetector } from "./buyability";
import { cartProbeDetector, productPagesDetector } from "./storefront";
import { GA4_DETECTORS } from "./ga4";
import { offerWatchDetector } from "./offers";
import { adsDetector } from "./ads";
import { GSC_DETECTORS } from "./gsc";
import { paymentWatchDetector } from "./payments";
import { pageSpeedDetector, pageWeightDetector } from "./speed";
import type { ShopPulseDetector } from "./types";

/**
 * Alle Prüfungen, in dieser Reihenfolge nacheinander. Die Spiegel-Frische steht vorn: hängt der
 * Bestellabgleich, setzen die Umsatz-Prüfungen aus. Zahl- und Versandarten prüft jeder Takt, die Artikel nur der Nachtlauf.
 * Produktseiten (5 je Takt) und Warenkorb-Probe (30 Minuten, 6–22 Uhr) fragen die Storefront ab, unter der Sperre des Shop-Wächters.
 * GA4: Live-Trichter alle 30 Minuten (6–22 Uhr), die übrigen einmal am Tag ab 7 Uhr; ohne GA4-Einrichtung setzen sie aus.
 * Zahlungsanbieter-Wache (S3-3) jeden Takt aus dem Bestellspiegel. Ladezeit (S3-5) einmal am Tag ab 7 Uhr
 * (Seitengewicht ohne, PageSpeed nur mit API-Schlüssel). Angebotsanfragen (B2Bsellers) einmal je Stunde. Google Ads einmal am Tag ab 7 Uhr, Search Console ab 9 Uhr; ohne Einrichtung setzen sie aus.
 */
export const SHOP_PULSE_DETECTORS: ShopPulseDetector[] = [
  mirrorFreshnessDetector,
  orderGapDetector,
  paymentGoneDetector,
  paymentWatchDetector,
  weekComparisonDetector,
  channelMethodsDetector,
  productBuyabilityDetector,
  productPagesDetector,
  cartProbeDetector,
  ...GA4_DETECTORS,
  offerWatchDetector,
  adsDetector,
  ...GSC_DETECTORS,
  pageWeightDetector,
  pageSpeedDetector,
];
