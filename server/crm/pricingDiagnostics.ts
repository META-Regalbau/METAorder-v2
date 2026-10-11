/**
 * Preis-Diagnose je Händler (nur lesend, Admin): Was gilt im Shop/Portal für diesen Kunden?
 *
 * Preismodell (Fachvorgabe, siehe scripts/syncCustomerDiscounts.ts):
 *   1. Katalogpreis: erweiterter Preis (Regel), sonst Listenpreis
 *   2. Händlerrabatt: customFields.b2b_customer_discount_rate auf den Katalogpreis
 *   3. Kundenindividueller Preis (B2B Sellers) schlägt den Händlerrabatt
 *   4. Zusatzrabatt-Staffel (WDU Partner Daten) zuletzt auf den Warenwert, höchste Stufe
 *   Versand: Lieferbedingung als Kunden-Tag (LB01 …, „frachtfrei“, „ab Werk“) → Versandkosten-
 *   Staffel der Versandart (customFields.wduPercentualValue = % vom Warenwert), dazu der
 *   Mindermengenzuschlag (wdu_small_volume_surcharge unter wdu_small_volume_threshold).
 * Die Diagnose zeigt alle Bausteine nebeneinander, damit das Modell an echten Händlern geprüft
 * werden kann, bevor METAorder damit rechnet.
 */
import type { ShopwareClient } from "../shopware/shopware";
import { ADDITIONAL_DISCOUNT_SCALE_FIELD, parseAdditionalDiscountScale } from "@shared/additionalDiscountScale";
import { resolveCustomerUnitPrices } from "../commercial/commercialCustomerPricing";

type Row = Record<string, any> & { id: string };

async function search(client: ShopwareClient, entity: string, body: Record<string, unknown>): Promise<{ data: Row[]; included: any[]; total: number | null }> {
  const c = client as unknown as { baseUrl: string; makeAuthenticatedRequest: (url: string, init: RequestInit) => Promise<Response> };
  const res = await c.makeAuthenticatedRequest(`${c.baseUrl}/api/search/${entity}`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) return { data: [], included: [], total: null };
  const json = await res.json();
  return {
    data: (json.data ?? []).map((d: any) => ({ id: d.id, ...(d.attributes ?? d) })),
    included: json.included ?? [],
    total: json.total ?? json.meta?.total ?? null,
  };
}

const incOf = (included: any[], type: string) => included.filter((i) => i.type === type).map((i) => ({ id: i.id, ...(i.attributes ?? i) }));

function conditionSummary(c: any): string {
  const v = c.value ?? {};
  if (/customerTag/i.test(c.type)) return `Kunden-Tag ${v.operator ?? "="} ${(v.identifiers ?? []).length} Tag(s)`;
  if (/customerNumber/i.test(c.type)) return `Kundennummer ${v.operator ?? "="} ${(v.numbers ?? []).join(", ")}`;
  if (/cartGoodsPrice|cartAmount|cartPrice/i.test(c.type)) return `Warenwert ${v.operator ?? ""} ${v.amount ?? ""}`;
  return `${c.type} ${JSON.stringify(v).slice(0, 120)}`;
}

export type PricingDiagnostics = Awaited<ReturnType<typeof buildPricingDiagnostics>>;

export async function buildPricingDiagnostics(
  client: ShopwareClient,
  params: { customerNumber: string; productNumbers: string[] },
) {
  const customers = await search(client, "customer", {
    limit: 5,
    filter: [{ type: "equals", field: "customerNumber", value: params.customerNumber.trim() }],
  });
  const names = async (entity: string, ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const r = await search(client, entity, { ids: unique, limit: unique.length });
    return new Map(r.data.map((x) => [x.id, String(x.name ?? x.translated?.name ?? x.id)]));
  };
  const tagNameById = await names("tag", customers.data.flatMap((c) => (c.tagIds ?? []) as string[]));
  const groupName = await names("customer-group", customers.data.map((c) => c.groupId));
  const channelName = await names("sales-channel", customers.data.map((c) => c.salesChannelId));

  const out = [];
  for (const cu of customers.data) {
    const cf = (cu.customFields ?? {}) as Record<string, unknown>;
    const tagIds: string[] = cu.tagIds ?? [];

    // Rabattregeln der Suite, die diese Kundennummer oder einen ihrer Tags nennen
    const rules = await search(client, "b2bsellers-discount-rules", { limit: 500, associations: { rule: { associations: { conditions: {} } } } });
    const ruleConds = incOf(rules.included, "rule_condition");
    const discountRules = rules.data
      .map((r) => ({ r, conds: ruleConds.filter((c) => c.ruleId === r.ruleId) }))
      .filter(({ conds }) =>
        conds.some(
          (c) =>
            ((c.value?.numbers ?? []) as string[]).some((n) => String(n).trim() === cu.customerNumber) ||
            ((c.value?.identifiers ?? []) as string[]).some((id) => tagIds.includes(id)),
        ),
      )
      .map(({ r, conds }) => ({ label: r.label, discountPercent: r.discountPercent, priority: r.priority, allowStacking: r.allowStacking, conditions: conds.filter((c) => !/Container/.test(c.type)).map(conditionSummary) }));

    // Versandkosten-Staffeln: Regeln mit Bedingung „Kunden-Tag = …“ (z. B. „Versandregel LB54“)
    let shipping: Array<Record<string, unknown>> = [];
    const ruleIds = new Set<string>();
    for (const tagId of tagIds) {
      const conds = await search(client, "rule-condition", { limit: 50, filter: [{ type: "contains", field: "value", value: tagId }] });
      for (const c of conds.data) if (/customerTag/i.test(c.type) && ((c.value?.identifiers ?? []) as string[]).includes(tagId)) ruleIds.add(c.ruleId);
    }
    if (ruleIds.size) {
      const prices = await search(client, "shipping-method-price", {
        limit: 200,
        filter: [{ type: "equalsAny", field: "ruleId", value: [...ruleIds] }],
        sort: [{ field: "quantityStart", order: "ASC" }],
      });
      const methodName = await names("shipping-method", prices.data.map((p) => p.shippingMethodId));
      const ruleName = await names("rule", prices.data.map((p) => p.ruleId));
      shipping = prices.data.map((p) => ({
        method: methodName.get(p.shippingMethodId) ?? p.shippingMethodId,
        rule: ruleName.get(p.ruleId) ?? null,
        calculation: ({ 1: "Stückzahl", 2: "Warenwert", 3: "Gewicht", 4: "Volumen" } as Record<number, string>)[p.calculation] ?? p.calculation,
        from: p.quantityStart,
        to: p.quantityEnd,
        fixedNet: p.currencyPrice?.[0]?.net ?? null,
        percentOfGoods: p.customFields?.wduPercentualValue ?? null,
      }));
    }

    // Artikel: Katalog, erweiterte Preise, Kundenpreise und was METAorder rechnet
    const products = params.productNumbers.length
      ? await search(client, "product", {
          limit: 50,
          filter: [{ type: "equalsAny", field: "productNumber", value: params.productNumbers }],
          associations: { prices: { associations: { rule: {} } } },
        })
      : { data: [], included: [] as any[] };
    const adv = incOf(products.included, "product_price");
    const advRules = await names("rule", adv.map((a) => a.ruleId));
    const customerPrices = params.productNumbers.length
      ? await search(client, "b2bsellers-customer-price", {
          limit: 200,
          filter: [{ type: "equals", field: "customerId", value: cu.id }, { type: "equalsAny", field: "productNumber", value: params.productNumbers }],
          associations: { currency: {} },
        })
      : { data: [], included: [] as any[] };
    const isoById = new Map(incOf(customerPrices.included, "currency").map((c) => [c.id, c.isoCode as string]));
    let resolved: Awaited<ReturnType<typeof resolveCustomerUnitPrices>> | null = null;
    if (products.data.length) {
      const currencyId = (await search(client, "currency", { limit: 1, filter: [{ type: "equals", field: "isoCode", value: "EUR" }] })).data[0]?.id;
      if (currencyId) {
        resolved = await resolveCustomerUnitPrices(client, {
          customerId: cu.id,
          currencyId,
          items: products.data.map((p) => ({ productId: p.id, productNumber: p.productNumber, quantity: 1 })),
        });
      }
    }

    out.push({
      customer: {
        id: cu.id,
        customerNumber: cu.customerNumber,
        company: cu.company,
        group: groupName.get(cu.groupId) ?? null,
        salesChannel: channelName.get(cu.salesChannelId) ?? null,
        tags: tagIds.map((id) => tagNameById.get(id) ?? id),
      },
      dealerDiscountPercent: cf.b2b_customer_discount_rate ?? null,
      additionalDiscountScale: { raw: cf[ADDITIONAL_DISCOUNT_SCALE_FIELD] ?? null, tiers: parseAdditionalDiscountScale(cf[ADDITIONAL_DISCOUNT_SCALE_FIELD]) },
      smallVolume: { surcharge: cf.wdu_small_volume_surcharge ?? null, threshold: cf.wdu_small_volume_threshold ?? null },
      paymentCondition: { text: cf.wdu_payment_condition_text ?? null, code: cf.wdu_payment_condition_sort_code ?? null },
      discountRules,
      shipping,
      products: products.data.map((p) => ({
        productNumber: p.productNumber,
        name: p.name ?? p.translated?.name ?? null,
        listNet: p.price?.[0]?.net ?? null,
        advancedPrices: adv
          .filter((a) => a.productId === p.id)
          .map((a) => ({ rule: advRules.get(a.ruleId) ?? a.ruleId, from: a.quantityStart, net: a.price?.[0]?.net ?? null })),
        customerPrices: customerPrices.data
          .filter((x) => x.productNumber === p.productNumber)
          .map((x) => ({ currency: x.currencyIsoCode ?? isoById.get(x.currencyId) ?? null, from: x.from, net: x.priceNet })),
        metaorder: (() => {
          const r = resolved?.prices.get(String(p.id).replace(/-/g, ""));
          return r ? { net: r.net, source: r.source, discountPercent: r.discountPercent ?? null } : null;
        })(),
      })),
    });
  }
  return { customerNumber: params.customerNumber, accounts: out };
}
