/**
 * Fracht nach Lieferbedingung des Händlers (Entscheidung 11.10.2026).
 *
 * Im Portal hängt die Lieferbedingung als Kunden-Tag am Händler (LB01 … LB60, „frachtfrei“,
 * „ab Werk“). Eine Shopware-Regel „Kunden-Tag = LBxx“ wählt bei der Versandart Warenwert-Staffeln
 * aus; der Prozentsatz steht im Zusatzfeld `wduPercentualValue` (kein Shopware-Standard), z. B.
 * LB54: unter 400 € 12 %, unter 900 € 10 %, ab 900 € frachtfrei. Das Portal rechnet das nur im
 * Warenkorb – bei der Anlage über die Admin-API und auch bei Shopwares Neuberechnung nicht
 * (Testshop-Versuch 11.10.2026). Darum rechnet METAorder die Fracht selbst und schreibt sie in
 * die Bestellung; die Neuberechnung danach behält sie bei.
 */
import type { ShopwareClient } from "./shopware";
import { logger } from "../lib/logger";

const log = logger.child({ component: "shopware/dealerShipping" });

export type ShippingTierRow = {
  shippingMethodId: string;
  ruleId: string | null;
  /** 1 Stückzahl, 2 Warenwert, 3 Gewicht, 4 Volumen */
  calculation: number | null;
  from: number | null;
  to: number | null;
  fixedNet: number | null;
  percentOfGoods: number | null;
};

export type DealerShipping = {
  shippingMethodId: string;
  costNet: number;
  percent: number | null;
  /** Name der Regel bzw. des Tags (z. B. „LB54“) für Hinweise */
  ruleName: string | null;
  goodsNet: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Passende Staffel für den Warenwert; bei mehreren Versandarten gewinnt die bevorzugte. */
export function pickShippingTier(rows: ShippingTierRow[], goodsNet: number, preferredMethodId?: string | null): ShippingTierRow | null {
  const fits = rows.filter(
    (r) =>
      (r.calculation == null || r.calculation === 2) &&
      (r.from == null || goodsNet >= r.from) &&
      (r.to == null || goodsNet <= r.to),
  );
  if (!fits.length) return null;
  const norm = (id: string | null | undefined) => (id ?? "").replace(/-/g, "").toLowerCase();
  return fits.find((r) => preferredMethodId && norm(r.shippingMethodId) === norm(preferredMethodId)) ?? fits[0];
}

export function shippingCostFor(row: ShippingTierRow, goodsNet: number): number {
  if (row.percentOfGoods != null && Number.isFinite(row.percentOfGoods)) return round2((goodsNet * row.percentOfGoods) / 100);
  return round2(row.fixedNet ?? 0);
}

type Searcher = { baseUrl: string; makeAuthenticatedRequest: (url: string, init: RequestInit) => Promise<Response> };

async function search(client: Searcher, entity: string, body: Record<string, unknown>): Promise<any[]> {
  const res = await client.makeAuthenticatedRequest(`${client.baseUrl}/api/search/${entity}`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${entity}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map((d: any) => ({ id: d.id, ...(d.attributes ?? d) }));
}

/**
 * Fracht für den Händler und den Warenwert (netto). null = keine Lieferbedingungs-Regel gefunden
 * (dann bleibt es bei der Standard-Versandart ohne Fracht).
 */
export async function resolveDealerShipping(
  shopware: ShopwareClient,
  params: { customerId: string; goodsNet: number; preferredShippingMethodId?: string | null },
): Promise<DealerShipping | null> {
  const client = shopware as unknown as Searcher;
  const [customer] = await search(client, "customer", { ids: [params.customerId.replace(/-/g, "")], includes: { customer: ["id", "tagIds"] } });
  const tagIds: string[] = customer?.tagIds ?? [];
  if (!tagIds.length) return null;

  const ruleIds = new Set<string>();
  for (const tagId of tagIds) {
    const conds = await search(client, "rule-condition", { limit: 50, filter: [{ type: "contains", field: "value", value: tagId }] });
    for (const c of conds) if (/customerTag/i.test(c.type) && ((c.value?.identifiers ?? []) as string[]).includes(tagId)) ruleIds.add(c.ruleId);
  }
  if (!ruleIds.size) return null;

  const prices = await search(client, "shipping-method-price", { limit: 200, filter: [{ type: "equalsAny", field: "ruleId", value: [...ruleIds] }] });
  const rows: ShippingTierRow[] = prices.map((p) => ({
    shippingMethodId: p.shippingMethodId,
    ruleId: p.ruleId ?? null,
    calculation: typeof p.calculation === "number" ? p.calculation : null,
    from: typeof p.quantityStart === "number" ? p.quantityStart : null,
    to: typeof p.quantityEnd === "number" ? p.quantityEnd : null,
    fixedNet: p.currencyPrice?.[0]?.net ?? null,
    percentOfGoods: typeof p.customFields?.wduPercentualValue === "number" ? p.customFields.wduPercentualValue : null,
  }));
  const tier = pickShippingTier(rows, params.goodsNet, params.preferredShippingMethodId);
  if (!tier) return null;

  let ruleName: string | null = null;
  if (tier.ruleId) {
    const [rule] = await search(client, "rule", { ids: [tier.ruleId], includes: { rule: ["id", "name"] } }).catch(() => []);
    ruleName = rule?.name ?? null;
  }
  const result: DealerShipping = {
    shippingMethodId: tier.shippingMethodId,
    costNet: shippingCostFor(tier, params.goodsNet),
    percent: tier.percentOfGoods,
    ruleName,
    goodsNet: round2(params.goodsNet),
  };
  log.info({ event: "dealer_shipping", ...result }, `[DealerShipping] ${ruleName ?? "Lieferbedingung"}: ${result.costNet} € Fracht bei ${result.goodsNet} € Warenwert`);
  return result;
}

/** Mindermengenzuschlag: Service-Artikel des Portal-Plugins (customFields.wdu_service_type) */
export const SMALL_VOLUME_SERVICE_TYPE = "minimum_quantity_surcharge";

export type SmallVolumeSurcharge = {
  productId: string;
  productNumber: string;
  label: string;
  net: number;
  taxRate: number;
  threshold: number;
};

/** Greift der Mindermengenzuschlag? Nur unterhalb der Grenze und mit Betrag > 0. */
export function smallVolumeApplies(surcharge: unknown, threshold: unknown, goodsNet: number): number | null {
  const amount = Number(surcharge);
  const limit = Number(threshold);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(limit) || limit <= 0) return null;
  return goodsNet < limit ? round2(amount) : null;
}

/**
 * Mindermengenzuschlag wie im Portal: unter `wdu_small_volume_threshold` kommt
 * `wdu_small_volume_surcharge` als eigene Position mit dem Service-Artikel dazu. Shopwares
 * Neuberechnung würde ihn zwar einfügen, aber ohne Artikelnummer – die Version ließe sich dann
 * nicht übernehmen (Testshop 11.10.2026). Darum legt METAorder die Position selbst an.
 */
export async function resolveSmallVolumeSurcharge(
  shopware: ShopwareClient,
  params: { customerId: string; goodsNet: number },
): Promise<SmallVolumeSurcharge | null> {
  const client = shopware as unknown as Searcher;
  const [customer] = await search(client, "customer", { ids: [params.customerId.replace(/-/g, "")], includes: { customer: ["id", "customFields"] } });
  const cf = (customer?.customFields ?? {}) as Record<string, unknown>;
  const net = smallVolumeApplies(cf.wdu_small_volume_surcharge, cf.wdu_small_volume_threshold, params.goodsNet);
  if (net == null) return null;
  const [product] = await search(client, "product", {
    limit: 1,
    filter: [{ type: "equals", field: "customFields.wdu_service_type", value: SMALL_VOLUME_SERVICE_TYPE }],
    associations: { tax: {} },
  });
  if (!product) {
    log.warn("[DealerShipping] Service-Artikel für den Mindermengenzuschlag nicht gefunden – Zuschlag fehlt");
    return null;
  }
  return {
    productId: product.id,
    productNumber: product.productNumber,
    label: product.name ?? product.translated?.name ?? "Mindermengenzuschlag",
    net,
    taxRate: Number(product.tax?.taxRate ?? 19),
    threshold: Number(cf.wdu_small_volume_threshold),
  };
}
