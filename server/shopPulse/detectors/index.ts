import { mirrorFreshnessDetector } from "./mirrorFreshness";
import { orderGapDetector, paymentGoneDetector, weekComparisonDetector } from "./revenue";
import { channelMethodsDetector, productBuyabilityDetector } from "./buyability";
import { cartProbeDetector, productPagesDetector } from "./storefront";
import type { ShopPulseDetector } from "./types";

/**
 * Alle Prüfungen, in dieser Reihenfolge nacheinander. Die Spiegel-Frische steht vorn: hängt der
 * Bestellabgleich, setzen die Umsatz-Prüfungen aus (GA4 folgt in PR E). Zahl- und Versandarten prüft jeder Takt, die Artikel nur der Nachtlauf.
 * Produktseiten (5 je Takt) und Warenkorb-Probe (30 Minuten, 6–22 Uhr) fragen die Storefront ab, unter der Sperre des Shop-Wächters.
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
];
