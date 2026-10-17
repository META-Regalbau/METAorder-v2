import { mirrorFreshnessDetector } from "./mirrorFreshness";
import { orderGapDetector, paymentGoneDetector, weekComparisonDetector } from "./revenue";
import type { ShopPulseDetector } from "./types";

/**
 * Alle Prüfungen, in dieser Reihenfolge nacheinander. Die Spiegel-Frische steht vorn: hängt der
 * Bestellabgleich, setzen die Umsatz-Prüfungen aus (Kaufbarkeit und GA4 folgen in PR C–E).
 */
export const SHOP_PULSE_DETECTORS: ShopPulseDetector[] = [mirrorFreshnessDetector, orderGapDetector, paymentGoneDetector, weekComparisonDetector];
