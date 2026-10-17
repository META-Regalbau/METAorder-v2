import type { IStorage } from "../../storage";
import type { ShopPulseDetection, ShopPulseSource } from "@shared/shopPulse";

export type ShopPulseDetectorContext = {
  storage: Pick<IStorage, "getShopwareSyncState">;
  tenantId: string | null;
  now: Date;
};

/**
 * Eine Prüfung des Shop-Puls. run liefert die aktuellen Funde; wirft sie, gilt die Quelle in diesem Lauf
 * als unvollständig (ihre offenen Meldungen bleiben offen).
 */
export type ShopPulseDetector = {
  id: string;
  source: ShopPulseSource;
  run(ctx: ShopPulseDetectorContext): Promise<ShopPulseDetection[]>;
};
