/**
 * Legt die Aktion „Newsletter-Willkommensrabatt“ (Code WILLKOMMEN10, 10 % auf die erste Bestellung) und ihre
 * Regel „Noch keine Bestellung“ im Shop an (server/shopContent/exitIntentPromotion.ts). Den Code zeigt das
 * Exit-Intent-Modal (scripts/writeExitIntent.ts) – deshalb dieses Skript zuerst ausführen.
 *
 * Beide Entitäten haben feste IDs: ein zweiter Lauf ersetzt nur sie. Bricht ab, wenn eine fremde Aktion
 * denselben Code nutzt. Ohne --apply nur Testlauf. Mit --apply Protokoll (Stand vorher) im
 * Arbeitsverzeichnis; --revert stellt ihn wieder her bzw. löscht Aktion und Regel. Schreibt nur in Shops
 * mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeExitIntentPromotion.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeExitIntentPromotion.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import {
  EXIT_INTENT_CODE,
  EXIT_INTENT_IDS,
  exitIntentPromotionPayload,
  exitIntentRulePayload,
} from "../server/shopContent/exitIntentPromotion";
import { findDeChannel, shopApi, type ShopApi } from "../server/shopContent/shopProducts";

type Snapshot = { rule: any | null; promotion: any | null };
type Protocol = { tenantId: string; at: string; base: string; before: Snapshot };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadSnapshot(api: ShopApi): Promise<Snapshot> {
  const rule = (await api("POST", "search/rule", { ids: [EXIT_INTENT_IDS.rule], associations: { conditions: {} } }))?.data?.[0] ?? null;
  const promotion = (await api("POST", "search/promotion", {
    ids: [EXIT_INTENT_IDS.promotion],
    associations: { discounts: {}, salesChannels: {}, personaRules: {} },
  }))?.data?.[0] ?? null;
  return {
    rule: rule && {
      id: rule.id, name: rule.name, priority: rule.priority, description: rule.description,
      conditions: (rule.conditions ?? []).map((c: any) => ({ id: c.id, type: c.type, parentId: c.parentId, position: c.position, value: c.value ?? {} })),
    },
    promotion: promotion && {
      id: promotion.id, name: promotion.name, active: promotion.active, validFrom: promotion.validFrom, validUntil: promotion.validUntil,
      useCodes: promotion.useCodes, useIndividualCodes: promotion.useIndividualCodes, code: promotion.code, useSetGroups: promotion.useSetGroups,
      customerRestriction: promotion.customerRestriction, preventCombination: promotion.preventCombination, exclusive: promotion.exclusive,
      priority: promotion.priority, maxRedemptionsGlobal: promotion.maxRedemptionsGlobal, maxRedemptionsPerCustomer: promotion.maxRedemptionsPerCustomer,
      salesChannels: (promotion.salesChannels ?? []).map((s: any) => ({ id: s.id, salesChannelId: s.salesChannelId, priority: s.priority })),
      personaRules: (promotion.personaRules ?? []).map((r: any) => ({ id: r.id })),
      discounts: (promotion.discounts ?? []).map((d: any) => ({
        id: d.id, scope: d.scope, type: d.type, value: d.value, maxValue: d.maxValue, considerAdvancedRules: d.considerAdvancedRules,
        applierKey: d.applierKey, usageKey: d.usageKey, sorterKey: d.sorterKey,
      })),
    },
  };
}

async function upsert(api: ShopApi, entity: string, payload: unknown) {
  await api("POST", "_action/sync", [{ action: "upsert", entity, payload: [payload] }]);
}

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/writeExitIntentPromotion.ts <tenantId> [--apply] [--live] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");
  const current = await loadSnapshot(api);

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
    if (log.before.promotion) await upsert(api, "promotion", log.before.promotion);
    else if (current.promotion) await api("DELETE", `promotion/${EXIT_INTENT_IDS.promotion}`);
    if (log.before.rule) await upsert(api, "rule", log.before.rule);
    else if (current.rule) await api("DELETE", `rule/${EXIT_INTENT_IDS.rule}`);
    console.log(`Aktion und Regel auf Stand ${log.at} zurückgesetzt`);
    return;
  }

  const channel = await findDeChannel(api, base);
  // Fremde Aktion mit demselben Code? Shopware vergleicht Codes ohne Groß-/Kleinschreibung.
  const sameCode = await api("POST", "search/promotion", {
    filter: [{ type: "equals", field: "code", value: EXIT_INTENT_CODE }],
    includes: { promotion: ["id", "name", "code"] },
  });
  const foreign = (sameCode?.data ?? []).filter((p: any) => p.id !== EXIT_INTENT_IDS.promotion);
  if (foreign.length) throw new Error(`Code ${EXIT_INTENT_CODE} ist schon vergeben: ${foreign.map((p: any) => p.name).join(", ")}`);

  const rule = exitIntentRulePayload();
  const promotion = exitIntentPromotionPayload(channel.id);
  console.log(`${base} · Kanal ${channel.name} (${channel.id})`);
  console.log(`Regel „${rule.name}“: ${current.rule ? "vorhanden, wird ersetzt" : "wird angelegt"}`);
  console.log(`Aktion „${promotion.name}“ (Code ${promotion.code}): ${current.promotion ? "vorhanden, wird ersetzt" : "wird angelegt"}`);

  if (!process.argv.includes("--apply")) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }
  if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);

  const log: Protocol = { tenantId, at: new Date().toISOString(), base, before: current };
  const file = `Exit-Intent-Aktion-Protokoll-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`Protokoll: ${file}`);

  await upsert(api, "rule", rule);
  await upsert(api, "promotion", promotion);
  console.log("Fertig");
}

main().then(() => process.exit(0), (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
