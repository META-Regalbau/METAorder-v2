/**
 * Besteller und Vertriebsmitarbeiter für die Zusatzfelder der Bestellung (nur lesend).
 *
 * - Besteller (b2b_order_customer_employee_id): B2B-Mitarbeiter mit der Absender-/Besteller-E-Mail,
 *   der aktiv mit dem Kunden verknüpft ist. Nur bei genau einem Treffer – lieber leer als falsch.
 * - Vertriebsmitarbeiter (b2b_order_sales_representative_id): der dem Kunden in B2B Sellers
 *   zugeordnete Vertriebsmitarbeiter (b2bsellers_sales_representative_customer). Nur wenn eindeutig.
 */
import type { ShopwareSettings } from "@shared/schema";
import { B2BSellersAdminClient, getStoredB2BEntityMapping } from "../b2b/b2bSellersAdmin";
import { isOwnOperatorEmail } from "../commercial/draftCustomerEmailResolution";
import { logger } from "../lib/logger";

const log = logger.child({ component: "shopware/orderPeople" });

export const SALES_REP_ASSIGNMENT_ENTITY = "b2bsellers-sales-representative-customer";

export type PeopleLookup = {
  employeesByEmail(email: string): Promise<Array<{ id: string }>>;
  activeLink(employeeId: string, customerId: string): Promise<{ active: boolean } | null>;
  /** Zeilen der Zuordnung Vertriebsmitarbeiter ↔ Kunde für diesen Kunden (roh) */
  salesRepAssignments(customerId: string): Promise<Array<Record<string, unknown>>>;
};

export type OrderPeople = {
  ordererEmployeeId: string | null;
  ordererNote: "found" | "no_email" | "not_found" | "ambiguous" | "error";
  salesRepresentativeId: string | null;
  salesRepNote: "found" | "none" | "ambiguous" | "error";
};

const normId = (v: unknown) => (typeof v === "string" ? v.replace(/-/g, "").toLowerCase() : "");

/** Id des Vertriebsmitarbeiters aus einer Zuordnungszeile (Feldname je nach Plugin-Version) */
export function salesRepIdOf(row: Record<string, unknown>): string | null {
  const attrs = (row.attributes && typeof row.attributes === "object" ? row.attributes : row) as Record<string, unknown>;
  for (const key of ["salesRepresentativeId", "salesRepresentativeCustomerId", "representativeId", "salesRepresentativeCustomer"]) {
    const v = attrs[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const key = Object.keys(attrs).find((k) => /sales.?rep.*id$/i.test(k) && typeof attrs[k] === "string");
  return key ? String(attrs[key]) : null;
}

export async function resolveOrderPeople(
  lookup: PeopleLookup,
  params: { customerId: string; emails: string[]; wantOrderer: boolean; wantSalesRep: boolean },
): Promise<OrderPeople> {
  const out: OrderPeople = { ordererEmployeeId: null, ordererNote: "no_email", salesRepresentativeId: null, salesRepNote: "none" };
  const customer = normId(params.customerId);

  if (params.wantOrderer) {
    const emails = params.emails.filter((e) => !isOwnOperatorEmail(e));
    if (emails.length) {
      try {
        const found = new Set<string>();
        for (const email of emails) {
          for (const employee of await lookup.employeesByEmail(email)) {
            const link = await lookup.activeLink(employee.id, customer);
            if (link?.active) found.add(employee.id);
          }
          // Die erste Adresse mit Treffer entscheidet (Absender vor Beleg-Kontakt)
          if (found.size) break;
        }
        if (found.size === 1) {
          out.ordererEmployeeId = [...found][0];
          out.ordererNote = "found";
        } else {
          out.ordererNote = found.size ? "ambiguous" : "not_found";
        }
      } catch (error) {
        log.warn({ err: error }, "[OrderPeople] Besteller nicht ermittelt");
        out.ordererNote = "error";
      }
    }
  }

  if (params.wantSalesRep) {
    try {
      const rows = await lookup.salesRepAssignments(customer);
      const ids = [...new Set(rows.map(salesRepIdOf).filter((id): id is string => Boolean(id)))];
      if (ids.length === 1) {
        out.salesRepresentativeId = ids[0];
        out.salesRepNote = "found";
      } else {
        out.salesRepNote = ids.length ? "ambiguous" : "none";
      }
    } catch (error) {
      log.warn({ err: error }, "[OrderPeople] Vertriebsmitarbeiter nicht ermittelt");
      out.salesRepNote = "error";
    }
  }
  return out;
}

/** Abfragen im Shop über die B2B-Sellers-Admin-API */
export async function createPeopleLookup(settings: ShopwareSettings): Promise<PeopleLookup> {
  const client = new B2BSellersAdminClient(settings, await getStoredB2BEntityMapping());
  const raw = client as unknown as { baseUrl: string; makeAuthenticatedRequest: (url: string, init: RequestInit) => Promise<Response> };
  return {
    employeesByEmail: (email) => client.findEmployeesByEmail(email),
    activeLink: (employeeId, customerId) => client.findEmployeeCustomerLink(employeeId, customerId),
    async salesRepAssignments(customerId) {
      const res = await raw.makeAuthenticatedRequest(`${raw.baseUrl}/api/search/${SALES_REP_ASSIGNMENT_ENTITY}`, {
        method: "POST",
        body: JSON.stringify({ limit: 10, filter: [{ type: "equals", field: "customerId", value: customerId }] }),
      });
      if (!res.ok) throw new Error(`${SALES_REP_ASSIGNMENT_ENTITY}: HTTP ${res.status}`);
      const json = await res.json();
      return (json.data ?? []) as Array<Record<string, unknown>>;
    },
  };
}
