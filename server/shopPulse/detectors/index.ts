import { mirrorFreshnessDetector } from "./mirrorFreshness";
import type { ShopPulseDetector } from "./types";

/** Alle Prüfungen, in dieser Reihenfolge nacheinander (Umsatz, Kaufbarkeit, GA4 folgen in PR B–E) */
export const SHOP_PULSE_DETECTORS: ShopPulseDetector[] = [mirrorFreshnessDetector];
