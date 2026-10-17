/**
 * Shop-Puls, Prüfung „Spiegel-Frische“: läuft der Abgleich der Bestellungen mit dem Shop noch? Der Abgleich
 * läuft alle 3 Minuten; ohne ihn sehen Statistik und die Umsatz-Prüfungen keine neuen Bestellungen, und
 * eine Bestell-Lücke wäre ein Fehlalarm.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import type { ShopPulseDetector } from "./types";

/** Ab so vielen Minuten ohne erfolgreichen Abgleich wird gemeldet */
export const MIRROR_STALE_MINUTES = 30;
/** Schlüssel des Funds; solange er besteht, setzen die Umsatz-Prüfungen aus */
export const MIRROR_SIGNAL_KEY = "system:mirror:orders";

export type MirrorSyncStateLike = { status: string; error: string | null; lastDeltaAt: Date | null; updatedAt: Date } | undefined;

export function mirrorFreshnessDetections(state: MirrorSyncStateLike, now: Date): ShopPulseDetection[] {
  if (!state) return []; // Spiegel noch nie gelaufen: nichts zu bewerten
  const last = state.lastDeltaAt ?? state.updatedAt;
  const minutes = Math.floor((now.getTime() - last.getTime()) / 60000);
  if (minutes < MIRROR_STALE_MINUTES) return [];
  const failing = state.status === "error";
  return [
    {
      key: MIRROR_SIGNAL_KEY,
      source: "system",
      code: failing ? "mirrorError" : "mirrorStale",
      severity: "critical",
      params: { minutes, error: (state.error ?? "").slice(0, 200) },
      evidence: { lastDeltaAt: state.lastDeltaAt?.toISOString() ?? null, status: state.status },
    },
  ];
}

export const mirrorFreshnessDetector: ShopPulseDetector = {
  id: "mirrorFreshness",
  source: "system",
  async run({ storage, tenantId, now }) {
    return mirrorFreshnessDetections(await storage.getShopwareSyncState("orders", tenantId), now);
  },
};
