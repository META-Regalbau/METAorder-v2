// Standardzubehoer ohne Mass je Regalsystem (Wandbefestigung, Fussplatten, Abdeckkappen …):
// Vorschlag aus den Bestellungen – was haeufig zusammen mit Regalen eines Systems bestellt wird.
// Der Vorschlag wird einmal freigegeben (Einstellung nameRuleSystemAccessories) und gilt dann
// fest fuer alle Regale des Systems (User-Entscheidung 17.10.2026).
import { nameRuleCategory, nameRuleSystem } from "./crossSellNameRules";

export type AccessoryProduct = {
  productNumber: string;
  name: string;
  active: boolean;
  /** Eigenschaft "Regal-System" (z. B. "CLIP S3") */
  regalSystem: string | null;
  /** Service-Artikel (Montage, Lieferung …) werden nie vorgeschlagen */
  isService: boolean;
};

export type AccessoryOrder = { customerKey: string; productNumbers: string[] };

export type SystemAccessoryProposal = {
  system: string;
  shelfOrders: number;
  items: Array<{ productNumber: string; name: string; orders: number; customers: number; share: number; recommended: boolean }>;
};

/** Vorausgewaehlt (gut belegt) bzw. nur angezeigt (schwaecher belegt). */
const STRICT = { minShare: 0.03, minCustomers: 3, minOrders: 5 };
const LOOSE = { minShare: 0.015, minCustomers: 2, minOrders: 3 };

export function proposeSystemAccessories(
  products: AccessoryProduct[],
  orders: AccessoryOrder[],
  opts: { maxPerSystem?: number } = {},
): SystemAccessoryProposal[] {
  const maxPerSystem = opts.maxPerSystem ?? 20;
  const byNumber = new Map(products.map((p) => [p.productNumber, p]));

  // System eines Regals (Namensschema) und das zugehoerige "Regal-System" laut Eigenschaft
  const shelfSystem = new Map<string, string>();
  const propVotes = new Map<string, Map<string, number>>();
  for (const p of products) {
    if (nameRuleCategory(p.name) !== "shelf") continue;
    const sys = nameRuleSystem(p.name);
    if (!sys) continue;
    shelfSystem.set(p.productNumber, sys);
    if (p.regalSystem) {
      const votes = propVotes.get(sys) ?? new Map<string, number>();
      votes.set(p.regalSystem, (votes.get(p.regalSystem) ?? 0) + 1);
      propVotes.set(sys, votes);
    }
  }
  const propOfSystem = new Map<string, string>();
  for (const [sys, votes] of propVotes) propOfSystem.set(sys, [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  const isCandidate = (p: AccessoryProduct | undefined, sys: string): p is AccessoryProduct => {
    if (!p || !p.active || p.isService) return false;
    if (nameRuleCategory(p.name) !== null) return false; // Regal oder ueber Masse zugeordnet
    // "CLIP"-Zubehoer passt auch zu "CLIP S3"/"CLIP SPLIT" (gleiches Grundsystem)
    const prop = propOfSystem.get(sys);
    const accSys = p.regalSystem?.trim().toUpperCase();
    const shelfSys = prop?.trim().toUpperCase();
    return !accSys || !shelfSys || shelfSys === accSys || shelfSys.startsWith(`${accSys} `);
  };

  const shelfOrders = new Map<string, number>();
  const counts = new Map<string, Map<string, { orders: number; customers: Set<string> }>>();
  for (const o of orders) {
    const unique = Array.from(new Set(o.productNumbers));
    const systems = new Set(unique.map((pn) => shelfSystem.get(pn)).filter((s): s is string => !!s));
    for (const sys of systems) {
      shelfOrders.set(sys, (shelfOrders.get(sys) ?? 0) + 1);
      const perSys = counts.get(sys) ?? new Map();
      for (const pn of unique) {
        if (!isCandidate(byNumber.get(pn), sys)) continue;
        const c = perSys.get(pn) ?? { orders: 0, customers: new Set<string>() };
        c.orders += 1;
        c.customers.add(o.customerKey);
        perSys.set(pn, c);
      }
      counts.set(sys, perSys);
    }
  }

  const out: SystemAccessoryProposal[] = [];
  for (const [sys, perSys] of counts) {
    const total = shelfOrders.get(sys) ?? 0;
    const items = [...perSys.entries()]
      .map(([pn, c]) => {
        const share = total ? c.orders / total : 0;
        const meets = (t: typeof STRICT) => c.orders >= t.minOrders && c.customers.size >= t.minCustomers && share >= t.minShare;
        return { productNumber: pn, name: byNumber.get(pn)!.name, orders: c.orders, customers: c.customers.size, share, recommended: meets(STRICT), listed: meets(LOOSE) };
      })
      .filter((i) => i.listed)
      .map(({ listed: _l, ...i }) => i)
      .sort((a, b) => b.share - a.share || a.productNumber.localeCompare(b.productNumber))
      .slice(0, maxPerSystem);
    if (items.length > 0) out.push({ system: sys, shelfOrders: total, items });
  }
  return out.sort((a, b) => b.shelfOrders - a.shelfOrders);
}
