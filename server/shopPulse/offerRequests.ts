/**
 * Shop-Puls Stufe 2 (S2-2): Datenquellen der Angebotsanfragen-Wache (detectors/offers.ts).
 *
 * - Anfragen: B2Bsellers-Angebote (Entität b2bsellers-offer, Live und Testshop) im Status „Angefragt von
 *   Kunde“, angelegt in den letzten 365 Tagen. Der Status kommt aus der Zuordnung b2b.offerStatusMapping
 *   („submitted“): mit Status-ID, sonst über die Bezeichnung (die Zuordnung im Testshop trägt noch die englische
 *   Bezeichnung, darum zusätzlich „Angefragt von Kunde“). Ausgelaufene Gültigkeit spielt keine Rolle: eine
 *   unbeantwortete Anfrage bleibt unbeantwortet. Je Seite 100, nacheinander, höchstens 5 Seiten.
 * - Außendienst aus sales_rep_assignments, Standard-Bearbeiter aus den Einstellungen des E-Mail-Eingangs.
 * - Kanalnamen über die Admin-API (eine Abfrage).
 */
import { and, eq, inArray, isNull, type AnyColumn } from "drizzle-orm";
import { salesRepAssignments } from "@shared/schema";
import type { IStorage } from "../storage";
import { db } from "../db";
import { getOfferStatusMapping } from "../b2b/b2bSellersClient";
import { getEmailIntakeSettings } from "../commercial/emailIntakeSettings";
import { shopApi, type ShopApi } from "../shopContent/shopProducts";
import type { OfferAssignee, OfferRequest, OfferWatchSources } from "./detectors/offers";

const OFFER_ENTITY = "b2bsellers-offer";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
export const OFFER_LOOKBACK_DAYS = 365;
/** Bezeichnung des Status im deutschen Shop (Live und Testshop) */
const REQUESTED_LABELS = ["Angefragt von Kunde", "Requested by customer"];

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

type StatusMapping = ReturnType<typeof getOfferStatusMapping>;

/** Filter auf den Status „Angefragt von Kunde“: Status-ID, sonst Bezeichnung */
export function requestedStatusFilter(mapping: StatusMapping): Record<string, unknown> {
  const id = mapping.submitted.id?.trim();
  if (id) return { type: "equals", field: "statusId", value: id };
  const labels = Array.from(new Set([mapping.submitted.label, ...REQUESTED_LABELS].map((l) => l?.trim()).filter(Boolean)));
  return { type: "equalsAny", field: "status.label", value: labels };
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Eine Zeile der Admin-API → Anfrage */
export function toOfferRequest(raw: any): OfferRequest | null {
  const id = text(raw?.id);
  const createdAt = text(raw?.createdAt);
  if (!id || !createdAt) return null;
  const c = raw.offerCustomer ?? {};
  const person = [text(c.firstName), text(c.lastName)].filter(Boolean).join(" ");
  return {
    id,
    number: text(raw.number) || id.slice(0, 8),
    createdAt,
    customer: text(c.company) || person || text(c.email) || "–",
    customerNumber: text(c.customerNumber),
    customerEmail: text(c.email).toLowerCase(),
    salesChannelId: text(raw.salesChannelId),
    net: num(raw.price?.netPrice),
    gross: num(raw.price?.totalPrice),
    positions: Array.isArray(raw.items) ? raw.items.length : 0,
  };
}

/** Offene Anfragen der letzten 365 Tage, neueste zuerst */
export async function loadOfferRequests(api: ShopApi, mapping: StatusMapping, now: Date): Promise<OfferRequest[]> {
  const since = new Date(now.getTime() - OFFER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const out: OfferRequest[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await api("POST", `search/${OFFER_ENTITY}`, {
      page,
      limit: PAGE_SIZE,
      sort: [{ field: "createdAt", order: "DESC" }],
      filter: [requestedStatusFilter(mapping), { type: "range", field: "createdAt", parameters: { gte: since } }],
      associations: { offerCustomer: {}, items: {} },
      includes: {
        b2bsellers_offer: ["id", "number", "createdAt", "statusId", "salesChannelId", "price", "offerCustomer", "items"],
        b2bsellers_offer_customer: ["company", "firstName", "lastName", "email", "customerNumber"],
        b2bsellers_offer_item: ["id"],
        cart_price: ["netPrice", "totalPrice"],
      },
    });
    const rows: any[] = Array.isArray(res?.data) ? res.data : [];
    for (const raw of rows) {
      const r = toOfferRequest(raw);
      if (r) out.push(r);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export function offerWatchSources(storage: Pick<IStorage, "getShopwareSettings" | "getSetting" | "getUser">, tenantId: string | null, now: Date): OfferWatchSources {
  let api: ShopApi | null = null;
  const apiOf = async () => {
    if (api) return api;
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    api = shopApi(settings).api;
    return api;
  };
  return {
    requests: async () => {
      const mapping = getOfferStatusMapping(await storage.getSetting("b2b.offerStatusMapping", tenantId));
      return loadOfferRequests(await apiOf(), mapping, now);
    },
    salesReps: async (customerNumbers) => {
      const out = new Map<string, OfferAssignee>();
      for (let i = 0; i < customerNumbers.length; i += 500) {
        const rows = await db
          .select({ customerNumber: salesRepAssignments.customerNumber, name: salesRepAssignments.repName, email: salesRepAssignments.repEmail })
          .from(salesRepAssignments)
          .where(and(tenantIs(salesRepAssignments.tenantId, tenantId), inArray(salesRepAssignments.customerNumber, customerNumbers.slice(i, i + 500))));
        for (const r of rows) out.set(r.customerNumber, { name: r.name.trim() || r.email, email: r.email });
      }
      return out;
    },
    defaultAssignee: async () => {
      const { defaultAssigneeUserId } = await getEmailIntakeSettings(storage as IStorage, tenantId);
      if (!defaultAssigneeUserId) return null;
      const user = await storage.getUser(defaultAssigneeUserId);
      if (!user) return null;
      return { name: user.username, email: user.email ?? null };
    },
    channelNames: async (ids) => {
      const res = await (await apiOf())("POST", "search/sales-channel", { ids, includes: { sales_channel: ["id", "name", "translated"] } });
      const out = new Map<string, string>();
      for (const c of Array.isArray(res?.data) ? res.data : []) out.set(String(c.id), String(c.translated?.name ?? c.name ?? c.id));
      return out;
    },
  };
}
