/**
 * Einstellung „Übergabe in die Bestellung“ je Mandant und die fertigen Feldwerte für einen Entwurf
 * (Anlage und Vorschau rechnen identisch).
 */
import type { ShopwareSettings } from "@shared/schema";
import {
  ORDER_FIELD_MAPPING_SETTING_KEY,
  normalizeOrderFieldMapping,
  type OrderFieldMappingSettings,
} from "@shared/orderFieldMapping";
import type { IStorage } from "../storage";
import {
  buildOrderFieldValues,
  collectOrderFieldInputs,
  ordererEmailCandidates,
  type OrderFieldValues,
} from "./orderFieldValues";
import { createPeopleLookup, resolveOrderPeople, type OrderPeople, type PeopleLookup } from "./orderPeople";

export async function getOrderFieldMapping(storage: IStorage, tenantId?: string | null): Promise<OrderFieldMappingSettings> {
  return normalizeOrderFieldMapping(await storage.getSetting(ORDER_FIELD_MAPPING_SETTING_KEY, tenantId));
}

export async function saveOrderFieldMapping(
  storage: IStorage,
  settings: OrderFieldMappingSettings,
  tenantId?: string | null,
): Promise<OrderFieldMappingSettings> {
  const normalized = normalizeOrderFieldMapping(settings);
  await storage.saveSetting(ORDER_FIELD_MAPPING_SETTING_KEY, normalized, tenantId);
  return normalized;
}

export type DraftOrderFieldResult = OrderFieldValues & { people: OrderPeople | null };

export async function resolveDraftOrderFieldValues(params: {
  mapping: OrderFieldMappingSettings;
  shopwareSettings: ShopwareSettings;
  customerId: string;
  draft: Parameters<typeof collectOrderFieldInputs>[0];
  lookup?: PeopleLookup;
}): Promise<DraftOrderFieldResult> {
  const { mapping } = params;
  if (!mapping.enabled) return { ...buildOrderFieldValues(mapping, {}), people: null };
  const inputs = collectOrderFieldInputs(params.draft);
  const wantOrderer = mapping.targets.orderer.length > 0;
  const wantSalesRep = mapping.targets.salesRepresentative.length > 0;
  let people: OrderPeople | null = null;
  if (wantOrderer || wantSalesRep) {
    const lookup = params.lookup ?? (await createPeopleLookup(params.shopwareSettings));
    people = await resolveOrderPeople(lookup, {
      customerId: params.customerId,
      emails: ordererEmailCandidates(params.draft.extractedData),
      wantOrderer,
      wantSalesRep,
    });
    inputs.ordererEmployeeId = people.ordererEmployeeId;
    inputs.salesRepresentativeId = people.salesRepresentativeId;
  }
  return { ...buildOrderFieldValues(mapping, inputs), people };
}
