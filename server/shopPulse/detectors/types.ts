import type { IStorage } from "../../storage";
import type { ShopPulseDetection, ShopPulseSource } from "@shared/shopPulse";
import type { PulseOrder } from "../pulseOrders";

export type ShopPulseDetectorContext = {
  storage: Pick<IStorage, "getShopwareSyncState">;
  tenantId: string | null;
  now: Date;
  /** Shop-Bestellungen der letzten gut 13 Monate aus dem Spiegel; je Lauf nur einmal geladen */
  orders: () => Promise<PulseOrder[]>;
};

/**
 * Eine Prüfung des Shop-Puls. run liefert die aktuellen Funde; wirft sie, gilt die Quelle in diesem Lauf
 * als unvollständig (ihre offenen Meldungen bleiben offen).
 */
export type ShopPulseDetector = {
  id: string;
  source: ShopPulseSource;
  /** Setzt aus, solange der Bestellabgleich hängt (Fund der Spiegel-Frische), sonst Fehlalarme */
  needsFreshMirror?: boolean;
  run(ctx: ShopPulseDetectorContext): Promise<ShopPulseDetection[]>;
};
