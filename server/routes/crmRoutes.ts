// CRM: Kundenliste, Kundenuebersicht, individuelle Preise/Rabatte, Zuweisungen, Rabattanfragen.
import { requireAuth, requireViewCrm, requireAuthOrIntegrationKey, requireManageCrm, requireCsrf, requireApproveCrm } from "../auth/auth";
import { getSalesChannelFilter, filterTicketsBySalesChannels, filterOrdersBySalesChannels, getOrdersWithCache, dedupeOrdersByNumber } from "./routeHelpers";
import { storage } from "../storage";
import { getHashCached, stableFingerprint } from "../lib/contentHashCache";
import { ShopwareClient } from "../shopware/shopware";
import { type Order, insertCustomerInteractionSchema, insertOrderAssignmentSchema, insertDiscountRequestSchema } from "@shared/schema";
import { loadCrmProfitabilitySettings } from "../analytics/crmProfitabilitySettings";
import { enrichCustomerPricesWithHerstellMargin } from "../products/herstellpreisMargin";
import type { Express } from "express";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "routes/crmRoutes" });

function filterCrmCustomersBySalesChannels<T extends { salesChannelIds?: string[] }>(
  customers: T[],
  allowedChannelIds: string[] | null,
): T[] {
  if (!allowedChannelIds) return customers;
  return customers.filter((customer) => {
    const channelIds = customer.salesChannelIds ?? [];
    return channelIds.length === 0 || channelIds.some((channelId) => allowedChannelIds.includes(channelId));
  });
}

/** Abwärtskompatibel: alter Index-Cache hatte nur emails, kein customers-Array. */
function individualPricesIndexCustomers(index: {
  customers?: Array<{
    id: string;
    email: string;
    name: string;
    company: string | null;
    phone: string | null;
    salesChannelId: string | null;
  }>;
  emails?: string[];
}): Array<{
  id: string;
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  salesChannelId: string | null;
}> {
  if (Array.isArray(index.customers) && index.customers.length > 0) {
    return index.customers;
  }
  return (index.emails ?? []).map((email) => ({
    id: "",
    email,
    name: email,
    company: null,
    phone: null,
    salesChannelId: null,
  }));
}

// v6: Bestellanzahl/Umsatz je Kunde ohne doppelt angelegte Bestellungen (gespeicherte v5-Summen zaehlten sie mit)
const CRM_CUSTOMERS_CACHE_KEY = "crm_customers_cache_v6";

const CRM_INDIVIDUAL_PRICES_CACHE_KEY = "crm_individual_prices_index_v2";

const BESTANDSKUNDEN_GROUP_TERMS = ["Portal", "Händler", "Haendler"];

export function registerCrmRoutes(app: Express): void {
  // ============================================
  // CRM Routes
  // ============================================
  app.get("/api/crm/customers", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const allowedChannelIds = await getSalesChannelFilter(req);
      const tenantId = (req as any).tenantId ?? null;

      const customerRows = await storage.getAllCustomers();
      const customerByEmail = new Map(customerRows.map((row) => [row.email.toLowerCase(), row]));

      type CrmListItem = {
        id: string | null;
        email: string;
        name: string;
        phone: string | null;
        company: string | null;
        status: string;
        tags: string[];
        totalOrders: number;
        totalRevenue: number;
        lastOrderNumber: string | null;
        lastOrderDate: string | null;
        salesChannelIds: string[];
        hasIndividualPrice: boolean;
        /** Manuell erfasste Interaktionen (Notiz/Anruf/E-Mail/Termin) — s. Kunden-Detail, Tab „Interaktionen". */
        interactionCount: number;
        lastInteractionAt: string | null;
      };

      const { data: list } = await getHashCached<CrmListItem[]>({
        cacheKey: CRM_CUSTOMERS_CACHE_KEY,
        tenantId,
        fetchFingerprint: async () => {
          const settings = await storage.getShopwareSettings(tenantId);
          if (!settings) return null;
          const client = new ShopwareClient(settings);
          const ordersFp = await client.fetchOrdersFingerprint();
          const ipFp = await client.fetchIndividualPriceCustomerFingerprint();
          const tickets = await storage.getAllTickets();
          const customerMirrorCount = await storage.countShopwareCustomerMirrors(tenantId);
          // Interaktionen müssen in den Fingerprint: sonst taucht eine frisch erfasste
          // Notiz/Anruf erst auf, wenn zufällig eine andere Quelle (Bestellung/Ticket) den
          // Cache invalidiert. Summe aus Anzahl + jüngstem Zeitstempel erkennt auch das
          // Nachtragen einer älteren Interaktion bei gleichbleibender Gesamtzahl nicht —
          // dafür reicht die Anzahl, die sich beim Anlegen immer ändert.
          const interactionSummaries = await storage.getCustomerInteractionSummaries(tenantId);
          let interactionTotal = 0;
          let interactionLatest = 0;
          for (const summary of interactionSummaries.values()) {
            interactionTotal += summary.count;
            const ts = summary.lastAt ? new Date(summary.lastAt).getTime() : 0;
            if (ts > interactionLatest) interactionLatest = ts;
          }
          return stableFingerprint({
            orders: ordersFp ?? "none",
            crmRows: customerRows.length,
            tickets: tickets.length,
            individualPrices: ipFp ?? "none",
            customerMirror: customerMirrorCount,
            interactions: `${interactionTotal}:${interactionLatest}`,
          });
        },
        fetchFull: async () => {
          const individualPriceEmailsForList = new Set<string>();
          const aggregation = new Map<string, {
            email: string;
            shopwareCustomerId?: string | null;
            name?: string;
            phone?: string | null;
            company?: string | null;
            totalOrders: number;
            totalRevenue: number;
            lastOrderNumber?: string | null;
            lastOrderDate?: string | null;
            salesChannelIds: Set<string>;
          }>();

          const settings = await storage.getShopwareSettings(tenantId);
          if (settings) {
            const client = new ShopwareClient(settings);
            // Kundenstamm im Hintergrund spiegeln, damit die CRM-Liste den
            // vollständigen Shopware-Kundenbestand (nicht nur aktive) abbildet.
            const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
            triggerShopwareMirrorSync(storage, client, tenantId, ["customers"]);
            // Mehrfach vergebene Bestellnummern zaehlen einmal - wie Statistik, Versand und Export
            // (dedupeOrdersByNumber: die zuletzt geaenderte Bestellung).
            const { orders: mirrorOrders } = await getOrdersWithCache(client, tenantId);
            const orders = dedupeOrdersByNumber(mirrorOrders);

            orders.forEach((order) => {
              const emailKey = order.customerEmail?.toLowerCase();
              if (!emailKey) return;
              const existing = aggregation.get(emailKey) || {
                email: order.customerEmail,
                name: order.customerName,
                phone: order.customerPhone ?? null,
                company: order.billingAddress?.company ?? null,
                totalOrders: 0,
                totalRevenue: 0,
                lastOrderNumber: null,
                lastOrderDate: null,
                salesChannelIds: new Set<string>(),
              };
              existing.totalOrders += 1;
              existing.totalRevenue += Number(order.totalAmount || 0);
              if (order.salesChannelId) {
                existing.salesChannelIds.add(order.salesChannelId);
              }
              const orderDate = order.orderDate;
              if (!existing.lastOrderDate || new Date(orderDate) > new Date(existing.lastOrderDate)) {
                existing.lastOrderDate = orderDate;
                existing.lastOrderNumber = order.orderNumber;
              }
              aggregation.set(emailKey, existing);
            });

            const { data: individualPricesIndex } = await getHashCached({
              cacheKey: CRM_INDIVIDUAL_PRICES_CACHE_KEY,
              tenantId,
              fetchFingerprint: () => client.fetchIndividualPriceCustomerFingerprint(),
              fetchFull: async () => {
                const priceCount = await storage.countShopwareCustomerPriceMirrors(tenantId);
                if (priceCount > 0) {
                  const prices = await storage.getShopwareCustomerPriceMirrors(tenantId);
                  const customerIds = [
                    ...new Set(
                      prices.map((p) => p.customerId).filter((id): id is string => Boolean(id)),
                    ),
                  ];
                  const customers = await storage.getShopwareCustomerMirrors(tenantId);
                  const byId = new Map(customers.map((c) => [c.shopwareId, c]));
                  const emails: string[] = [];
                  const ipCustomers: Array<{
                    id: string;
                    email: string;
                    name: string;
                    company: string | null;
                    phone: string | null;
                    salesChannelId: string | null;
                  }> = [];
                  for (const id of customerIds) {
                    const c = byId.get(id);
                    const payload = c?.payload as any;
                    const email = (c?.email || payload?.email || "").toLowerCase();
                    if (!email) continue;
                    emails.push(email);
                    const firstName = payload?.firstName || "";
                    const lastName = payload?.lastName || "";
                    ipCustomers.push({
                      id,
                      email,
                      name: `${firstName} ${lastName}`.trim() || email,
                      company: c?.company ?? payload?.company ?? null,
                      phone: payload?.phone ?? null,
                      salesChannelId: c?.salesChannelId ?? payload?.salesChannelId ?? null,
                    });
                  }
                  return {
                    entity: "mirror",
                    customerCount: ipCustomers.length,
                    emails,
                    customers: ipCustomers,
                  };
                }
                return client.fetchIndividualPriceCustomerIndex();
              },
            });

            for (const ipCustomer of individualPricesIndexCustomers(individualPricesIndex)) {
              individualPriceEmailsForList.add(ipCustomer.email.toLowerCase());
              const emailKey = ipCustomer.email.toLowerCase();
              const existing = aggregation.get(emailKey);
              if (existing) {
                if (ipCustomer.salesChannelId) {
                  existing.salesChannelIds.add(ipCustomer.salesChannelId);
                }
                if (!existing.company && ipCustomer.company) existing.company = ipCustomer.company;
                if (!existing.name && ipCustomer.name) existing.name = ipCustomer.name;
                if (!existing.phone && ipCustomer.phone) existing.phone = ipCustomer.phone;
                if (!existing.shopwareCustomerId) existing.shopwareCustomerId = ipCustomer.id;
                continue;
              }
              aggregation.set(emailKey, {
                email: ipCustomer.email,
                shopwareCustomerId: ipCustomer.id,
                name: ipCustomer.name,
                phone: ipCustomer.phone,
                company: ipCustomer.company,
                totalOrders: 0,
                totalRevenue: 0,
                lastOrderNumber: null,
                lastOrderDate: null,
                salesChannelIds: ipCustomer.salesChannelId
                  ? new Set([ipCustomer.salesChannelId])
                  : new Set<string>(),
              });
            }
          }

          const tickets = await storage.getAllTickets();
          tickets.forEach((ticket) => {
            if (!ticket.customerEmail) return;
            const emailKey = ticket.customerEmail.toLowerCase();
            if (!aggregation.has(emailKey)) {
              aggregation.set(emailKey, {
                email: ticket.customerEmail,
                name: ticket.customerName || ticket.customerEmail,
                phone: null,
                company: null,
                totalOrders: 0,
                totalRevenue: 0,
                lastOrderNumber: ticket.orderNumber || null,
                lastOrderDate: null,
                salesChannelIds: new Set<string>(),
              });
            }
          });

          // Vollständiger Kundenstamm aus dem Shopware-Mirror: die AUTORITATIVE
          // Quelle für den Kundenbestand UND die Kanal-Zugehörigkeit. Ein Kunde
          // "gehört" zu dem Verkaufskanal, in dem sein Shopware-Konto gebunden ist
          // (salesChannelId) – NICHT (nur) dem Kanal, in dem er bestellt hat.
          //
          // Der gebundene Kanal wird per Union zu salesChannelIds hinzugefügt.
          // Union kann die sichtbare Menge nur VERGRÖSSERN (mehr Treffer im
          // Kanal-Filter), nie verkleinern. Dadurch zeigt z. B. "Händler Portal DE"
          // ALLE dort gebundenen Kunden, nicht nur die, die dort bestellt haben.
          // Kunden mit demselben E-Mail in mehreren Kanälen (Shop + Portal) landen
          // in einem CRM-Eintrag mit beiden Kanälen.
          const customerMirrors = await storage.getShopwareCustomerMirrors(tenantId);
          for (const mirror of customerMirrors) {
            const payload = (mirror.payload as any) ?? {};
            const email = (mirror.email || payload.email || "").toLowerCase();
            if (!email) continue;

            const existing = aggregation.get(email);
            if (existing) {
              if (mirror.salesChannelId) existing.salesChannelIds.add(mirror.salesChannelId);
              if (!existing.company && (mirror.company ?? payload.company)) {
                existing.company = mirror.company ?? payload.company;
              }
              if (!existing.phone && payload.phone) existing.phone = payload.phone;
              if (!existing.shopwareCustomerId) existing.shopwareCustomerId = mirror.shopwareId;
              continue;
            }

            const firstName = payload.firstName || "";
            const lastName = payload.lastName || "";
            aggregation.set(email, {
              email: mirror.email || email,
              shopwareCustomerId: mirror.shopwareId,
              name: `${firstName} ${lastName}`.trim() || mirror.email || email,
              phone: payload.phone ?? null,
              company: mirror.company ?? payload.company ?? null,
              totalOrders: 0,
              totalRevenue: 0,
              lastOrderNumber: null,
              lastOrderDate: null,
              salesChannelIds: mirror.salesChannelId
                ? new Set([mirror.salesChannelId])
                : new Set<string>(),
            });
          }

          // Interaktionen hängen an der lokalen customers-Zeile (customer_interactions.customerId),
          // deshalb erst hier über customerByEmail auflösen.
          const interactionSummaries = await storage.getCustomerInteractionSummaries(tenantId);

          return Array.from(aggregation.entries()).map(([emailKey, data]) => {
            const stored = customerByEmail.get(emailKey);
            const interaction = stored ? interactionSummaries.get(stored.id) : undefined;
            return {
              id: stored?.id ?? data.shopwareCustomerId ?? null,
              email: data.email,
              name: stored?.name || data.name || data.email,
              phone: stored?.phone ?? data.phone ?? null,
              company: stored?.company ?? data.company ?? null,
              status: stored?.status ?? "active",
              tags: stored?.tags ?? [],
              totalOrders: data.totalOrders,
              totalRevenue: data.totalRevenue,
              lastOrderNumber: data.lastOrderNumber ?? null,
              lastOrderDate: data.lastOrderDate ?? null,
              salesChannelIds: Array.from(data.salesChannelIds),
              hasIndividualPrice: individualPriceEmailsForList.has(emailKey),
              interactionCount: interaction?.count ?? 0,
              lastInteractionAt: interaction?.lastAt ? new Date(interaction.lastAt).toISOString() : null,
            };
          });
        },
      });

      const searched = rawQuery
        ? list.filter((item) =>
            [item.name, item.email, item.company, item.lastOrderNumber]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(rawQuery))
          )
        : list;

      const filtered = filterCrmCustomersBySalesChannels(searched, allowedChannelIds);

      res.json({ customers: filtered });
    } catch (error: any) {
      moduleLog.error({ err: error, stack: error?.stack }, "Error loading CRM customers:");
      res.status(500).json({ error: "Failed to load customers" });
    }
  });

  app.get("/api/crm/customers/resolve", requireAuthOrIntegrationKey, requireViewCrm, async (req, res) => {
    try {
      const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
      const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      let customer = await storage.getCustomerByEmail(email);
      if (!customer) {
        customer = await storage.createCustomer({
          email,
          name: name || email,
          status: "active",
        } as any);
      }
      res.json({ customer });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error resolving CRM customer:");
      res.status(500).json({ error: "Failed to resolve customer" });
    }
  });

  app.get("/api/crm/customers/:id/overview", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      let customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const customerId = customer.id;
      const customerEmail = customer.email.toLowerCase();

      const allowedChannelIds = await getSalesChannelFilter(req);
      const settings = await storage.getShopwareSettings();
      let orders: Order[] = [];
      if (settings) {
        const client = new ShopwareClient(settings);
        const { orders: allOrders } = await getOrdersWithCache(client, (req as any).tenantId ?? null);
        orders = filterOrdersBySalesChannels(allOrders, allowedChannelIds)
          .filter((order) => order.customerEmail?.toLowerCase() === customerEmail);
      }

      const tickets = await storage.getAllTickets();
      const filteredTickets = await filterTicketsBySalesChannels(tickets, allowedChannelIds, storage, (req.user as any)?.id);
      const customerTickets = filteredTickets.filter((ticket) => ticket.customerEmail?.toLowerCase() === customerEmail);
      const interactions = await storage.getCustomerInteractions(customerId);

      if (orders.length > 0) {
        const latestOrder = [...orders].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())[0];
        const nextUpdates: any = {};
        if (!customer.name || customer.name === customer.email) {
          nextUpdates.name = latestOrder.customerName;
        }
        if (!customer.phone && latestOrder.customerPhone) {
          nextUpdates.phone = latestOrder.customerPhone;
        }
        if (!customer.company && latestOrder.billingAddress?.company) {
          nextUpdates.company = latestOrder.billingAddress.company;
        }
        if (Object.keys(nextUpdates).length > 0) {
          customer = (await storage.updateCustomer(customer.id, nextUpdates)) || customer;
        }
      }

      res.json({
        customer,
        orders,
        tickets: customerTickets,
        interactions,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading CRM customer overview:");
      res.status(500).json({ error: "Failed to load customer overview" });
    }
  });

  // Bestandskunden-Abgleich: prüft über mehrere Felder (E-Mail, Name, Firma,
  // Telefon), ob der Shop-Kunde bereits als bestehender Shopware-Kunde mit
  // Kundennummer existiert. Rein lesend.
  app.get("/api/crm/customers/:id/match", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, self: null, matches: [] });
      }
      const client = new ShopwareClient(settings);

      // Namen best-effort in Vor-/Nachname zerlegen.
      const nameParts = (customer.name || "").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts.length > 1 ? nameParts[0] : "";
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : nameParts[0] || "";

      const candidates = await client.searchExistingCustomers({
        email: customer.email,
        firstName,
        lastName,
        name: customer.name,
        company: customer.company,
        limit: 25,
      });

      const norm = (s?: string | null) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const normCompany = (s?: string | null) =>
        norm(s)
          .replace(/\b(gmbh|ag|kg|ohg|e\.?\s?k\.?|mbh|co\.?|kgaa|ug|gbr|ltd|inc|gesellschaft|und|&)\b/g, " ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const digits = (s?: string | null) => (s || "").replace(/\D+/g, "");

      // Bestandskunden sitzen in den "Händler Portal"-Kundengruppen, Shopkunden in
      // "META B2B DE". Per Env überschreibbar (CRM_BESTANDSKUNDE_GROUP_PATTERN).
      const bestandskundePattern = (() => {
        const raw = process.env.CRM_BESTANDSKUNDE_GROUP_PATTERN;
        try {
          return raw ? new RegExp(raw, "i") : /portal|h(ä|ae)ndler/i;
        } catch {
          return /portal|h(ä|ae)ndler/i;
        }
      })();
      const isBestandskundeGroup = (name?: string | null) => !!name && bestandskundePattern.test(name);

      const custEmail = norm(customer.email);
      const custCompany = normCompany(customer.company);
      const custName = norm(customer.name);
      const custPhone = digits(customer.phone);

      const scored = candidates.map((c) => {
        const reasons: string[] = [];
        let score = 0;

        if (norm(c.email) && norm(c.email) === custEmail) {
          reasons.push("email");
          score += 50;
        }

        const candCompany = normCompany(c.company) || normCompany(c.billingAddress?.company);
        if (custCompany && candCompany && candCompany === custCompany) {
          reasons.push("company");
          score += 30;
        }

        const candName = norm([c.firstName, c.lastName].filter(Boolean).join(" "));
        if (custName && candName && (candName === custName || candName.includes(custName) || custName.includes(candName))) {
          reasons.push("name");
          score += 20;
        }

        const candPhone = digits(c.billingAddress?.phoneNumber);
        if (custPhone && candPhone && custPhone === candPhone) {
          reasons.push("phone");
          score += 20;
        }

        return {
          customerId: c.id,
          customerNumber: c.customerNumber,
          email: c.email,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
          company: c.company || c.billingAddress?.company || null,
          billingAddress: c.billingAddress || null,
          groupName: c.groupName,
          isBestandskunde: isBestandskundeGroup(c.groupName),
          reasons,
          score,
          isSelf: norm(c.email) === custEmail,
        };
      });

      // Eigener Shopware-Datensatz (gleiche E-Mail) separat zurückgeben.
      const self = scored.find((m) => m.isSelf) || null;

      // Bestandskunden-Kandidaten: alle Treffer mit Score > 0, ohne den eigenen
      // Datensatz. Echte Bestandskunden (Händler-Portal-Gruppe) zuerst.
      const matches = scored
        .filter((m) => !m.isSelf && m.score > 0)
        .sort((a, b) => Number(b.isBestandskunde) - Number(a.isBestandskunde) || b.score - a.score);

      res.json({
        configured: true,
        self: self ? { customerId: self.customerId, customerNumber: self.customerNumber } : null,
        matches,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error matching CRM customer:");
      res.status(500).json({ error: "Failed to match customer" });
    }
  });

  // Manueller Kunden-Merge: hängt die Bestellungen eines doppelten Shop-Kontos
  // (duplicate) auf einen bestehenden Bestandskunden (target) um und deaktiviert
  // anschließend das Dubletten-Konto. Schreibt auf Shopware -> requireManageCrm.
  // Mit dryRun=true wird nur eine Vorschau (betroffene Bestellungen) geliefert.
  app.post("/api/crm/customers/merge", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const duplicateId = String(req.body?.duplicateShopwareCustomerId || "").trim();
      const targetId = String(req.body?.targetShopwareCustomerId || "").trim();
      const dryRun = req.body?.dryRun === true;

      if (!duplicateId || !targetId) {
        return res.status(400).json({ error: "duplicateShopwareCustomerId and targetShopwareCustomerId are required" });
      }
      if (duplicateId === targetId) {
        return res.status(400).json({ error: "Quelle und Ziel dürfen nicht identisch sein" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.status(400).json({ error: "Shopware not configured" });
      }
      const client = new ShopwareClient(settings);

      const [duplicate, target] = await Promise.all([
        client.getCustomerById(duplicateId),
        client.getCustomerById(targetId),
      ]);
      if (!duplicate) return res.status(404).json({ error: "Duplicate customer not found" });
      if (!target) return res.status(404).json({ error: "Target customer not found" });
      if (!target.customerNumber) {
        return res.status(400).json({ error: "Zielkunde hat keine Kundennummer" });
      }

      const allowedChannelIds = await getSalesChannelFilter(req);
      const orderCustomers = await client.findOrderCustomersByCustomerId(duplicateId);

      // Verkaufskanal-Bindung: nur Bestellungen innerhalb erlaubter Kanäle umhängen.
      const inScope = orderCustomers.filter(
        (oc) => allowedChannelIds === null || (oc.salesChannelId != null && allowedChannelIds.includes(oc.salesChannelId)),
      );
      const outOfScope = orderCustomers.length - inScope.length;

      if (dryRun) {
        return res.json({
          dryRun: true,
          duplicate: { id: duplicate.id, email: duplicate.email, customerNumber: duplicate.customerNumber },
          target: { id: target.id, email: target.email, customerNumber: target.customerNumber },
          ordersTotal: orderCustomers.length,
          ordersInScope: inScope.length,
          ordersOutOfScope: outOfScope,
        });
      }

      if (outOfScope > 0) {
        return res.status(403).json({
          error: "Einige Bestellungen liegen außerhalb deiner Verkaufskanäle – Merge abgebrochen.",
          ordersOutOfScope: outOfScope,
        });
      }

      const reassignedOrders: string[] = [];
      const failures: Array<{ orderNumber: string | null; error: string }> = [];
      for (const oc of inScope) {
        try {
          await client.reassignOrderCustomer(oc.orderCustomerId, {
            customerId: target.id,
            customerNumber: target.customerNumber,
            email: target.email,
            firstName: target.firstName,
            lastName: target.lastName,
          });
          reassignedOrders.push(oc.orderNumber || oc.orderCustomerId);
        } catch (e: any) {
          failures.push({ orderNumber: oc.orderNumber, error: e?.message || String(e) });
        }
      }

      // Dublette nur deaktivieren, wenn alle Bestellungen erfolgreich umgehängt wurden.
      let deactivated = false;
      let deactivateError: string | null = null;
      if (failures.length === 0) {
        try {
          deactivated = await client.deactivateCustomer(duplicateId);
        } catch (e: any) {
          deactivateError = e?.message || String(e);
        }
      }

      // Lokales Protokoll an den lokalen CRM-Kunden (über die E-Mail der Dublette).
      try {
        if (duplicate.email) {
          let localCustomer = await storage.getCustomerByEmail(duplicate.email);
          if (!localCustomer) {
            localCustomer = await storage.createCustomer({
              email: duplicate.email,
              name: duplicate.email,
              status: "inactive",
            } as any);
          }
          await storage.createCustomerInteraction({
            customerId: localCustomer.id,
            userId: (req.user as any)?.id ?? null,
            interactionType: "other",
            subject: "Kunde zusammengeführt",
            body: JSON.stringify({
              action: "merge",
              duplicate: { id: duplicate.id, email: duplicate.email, customerNumber: duplicate.customerNumber },
              target: { id: target.id, email: target.email, customerNumber: target.customerNumber },
              reassignedOrders,
              failures,
              deactivated,
            }),
          } as any);
        }
      } catch (logErr) {
        moduleLog.warn({ err: logErr }, "[merge] logging failed:");
      }

      res.json({
        success: failures.length === 0 && !deactivateError,
        reassignedCount: reassignedOrders.length,
        reassignedOrders,
        failures,
        deactivated,
        deactivateError,
        target: { customerNumber: target.customerNumber, email: target.email },
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error merging CRM customers:");
      res.status(500).json({ error: "Failed to merge customers" });
    }
  });

  // Kundenindividuelle Preise (B2Bsellers Suite). Löst den Shopware-Kunden über
  // die E-Mail auf und liest dessen individuelle Preise aus dem Plugin.
  app.get("/api/crm/customers/:id/individual-prices", requireAuthOrIntegrationKey, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ available: false, total: 0, prices: [], resolved: false, configured: false });
      }

      const client = new ShopwareClient(settings);
      const tenantId = (req as any).tenantId as string | null | undefined;
      const emailKey = customer.email.toLowerCase();

      // Eine Person kann in mehreren Verkaufskanälen (bound sales channel) als
      // separate Shopware-Kunden mit gleicher E-Mail existieren – z. B. Portal
      // (mit individuellen Preisen) und Shop (ohne). Wir sammeln ALLE passenden
      // Accounts ein und beschriften jeden Preis mit seinem Verkaufskanal, damit
      // die beiden Kanäle im Frontend getrennt betrachtbar sind.
      type MatchedAccount = {
        customerId: string | null;
        customerNumber: string | null;
        salesChannelId: string | null;
      };
      const matchedAccounts: MatchedAccount[] = [];

      // Prefer customer mirror for resolve
      const mirroredCustomers = await storage.getShopwareCustomerMirrors(tenantId);
      const mirroredMatches = mirroredCustomers.filter(
        (c) => (c.email || "").toLowerCase() === emailKey,
      );
      for (const m of mirroredMatches) {
        matchedAccounts.push({
          customerId: m.shopwareId ?? null,
          customerNumber: m.customerNumber ?? null,
          salesChannelId: m.salesChannelId ?? null,
        });
      }

      if (matchedAccounts.length === 0) {
        try {
          const resolvedList = await client.findCustomersByEmail(customer.email);
          for (const r of resolvedList) {
            matchedAccounts.push({
              customerId: r.id ?? null,
              customerNumber: r.customerNumber ?? null,
              salesChannelId: r.salesChannelId ?? null,
            });
          }
        } catch (resolveError: any) {
          moduleLog.warn({ err: resolveError }, "[individual-prices] customer resolve failed:");
        }
      }

      const swCustomerIds = new Set(
        matchedAccounts.map((a) => a.customerId).filter((v): v is string => Boolean(v)),
      );
      const swCustomerNumbers = new Set(
        matchedAccounts.map((a) => a.customerNumber).filter((v): v is string => Boolean(v)),
      );

      if (swCustomerIds.size === 0 && swCustomerNumbers.size === 0) {
        return res.json({ available: false, total: 0, prices: [], resolved: false, configured: true });
      }

      // Optionaler Kanal-Filter (?salesChannelId=...) für die getrennte Betrachtung.
      const salesChannelFilter =
        typeof req.query.salesChannelId === "string" && req.query.salesChannelId.trim()
          ? req.query.salesChannelId.trim()
          : null;

      // Lookups customerId/customerNumber -> salesChannelId für die Preis-Beschriftung.
      const channelByCustomerId = new Map<string, string | null>();
      const channelByCustomerNumber = new Map<string, string | null>();
      for (const a of matchedAccounts) {
        if (a.customerId) channelByCustomerId.set(a.customerId, a.salesChannelId);
        if (a.customerNumber) channelByCustomerNumber.set(a.customerNumber, a.salesChannelId);
      }

      // Primär-ID (erste) für Kontext-Abfragen wie Standardrabatt.
      const primaryCustomerId = swCustomerIds.size > 0 ? Array.from(swCustomerIds)[0] : undefined;
      const primaryCustomerNumber = swCustomerNumbers.size > 0 ? Array.from(swCustomerNumbers)[0] : null;

      const currency =
        typeof req.query.currency === "string" && req.query.currency.trim()
          ? req.query.currency.trim().toUpperCase()
          : "EUR";

      // Mirror zuerst (schnell), aber nur als Treffer werten, wenn für DIESEN Kunden
      // Zeilen drinstehen. Der Voll-Snapshot der Preis-Entität ist bei großen Shops
      // nicht garantiert vollständig (Seitenlimit); ohne den Fallback unten meldet das
      // Modal für einen Kunden mit echten Preisen fälschlich „keine vorhanden".
      const mirroredPrices = await storage.getShopwareCustomerPriceMirrors(tenantId);
      let basePrices: import("../shopware/shopware").ShopwareCustomerPrice[] = [];
      let fromMirror = false;
      let pluginEntity: string | null = null;

      if (mirroredPrices.length > 0) {
        basePrices = mirroredPrices
          .filter((row) => {
            if (row.customerId && swCustomerIds.has(row.customerId)) return true;
            if (row.customerNumber && swCustomerNumbers.has(row.customerNumber)) return true;
            return false;
          })
          .map((row) => row.payload as import("../shopware/shopware").ShopwareCustomerPrice)
          .filter((p) => {
            if (!currency) return true;
            const iso = (p.currencyIsoCode || "").toUpperCase();
            return !iso || iso === currency;
          });
        if (basePrices.length > 0) {
          fromMirror = true;
          pluginEntity = "mirror";
        }
      }

      if (basePrices.length === 0) {
        const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
        triggerShopwareMirrorSync(storage, client, tenantId ?? null, ["customer_prices"]);
        // Preise für alle passenden Kunden (beide Kanäle) laden und mergen.
        // Dedup NUR innerhalb desselben Accounts (per Preis-ID) – Kanäle bleiben
        // getrennt, damit gleiche Produkte pro Kanal separat sichtbar sind.
        const seenPriceIds = new Set<string>();
        const targets: Array<{ customerId?: string; customerNumber?: string }> =
          swCustomerIds.size > 0
            ? Array.from(swCustomerIds).map((customerId) => ({ customerId }))
            : Array.from(swCustomerNumbers).map((customerNumber) => ({ customerNumber }));
        for (const target of targets) {
          const result = await client.fetchAllCustomerSpecificPrices({
            customerId: target.customerId ?? null,
            customerNumber: target.customerNumber ?? null,
            currencyIsoCode: currency,
          });
          if (result.entity) pluginEntity = result.entity;
          for (const price of result.prices) {
            const dedupeKey =
              price.id ||
              `${price.customerId ?? target.customerId ?? target.customerNumber}|${price.productNumber}|${price.from}|${price.to}|${price.priceNet}`;
            if (seenPriceIds.has(dedupeKey)) continue;
            seenPriceIds.add(dedupeKey);
            basePrices.push(price);
          }
        }
      }

      // Jeden Preis mit seinem Verkaufskanal beschriften.
      const channelNameMap = await client.fetchSalesChannelNameMap().catch(() => new Map<string, string>());
      const resolveChannelId = (p: import("../shopware/shopware").ShopwareCustomerPrice): string | null => {
        if (p.salesChannelId) return p.salesChannelId;
        if (p.customerId && channelByCustomerId.has(p.customerId)) return channelByCustomerId.get(p.customerId) ?? null;
        if (p.customerNumber && channelByCustomerNumber.has(p.customerNumber)) return channelByCustomerNumber.get(p.customerNumber) ?? null;
        return null;
      };
      for (const p of basePrices) {
        const scId = resolveChannelId(p);
        p.salesChannelId = scId;
        p.salesChannelName = scId ? channelNameMap.get(scId) ?? scId : null;
      }

      // Optionaler Kanal-Filter anwenden.
      if (salesChannelFilter) {
        basePrices = basePrices.filter((p) => p.salesChannelId === salesChannelFilter);
      }

      const standardDiscountPercent = primaryCustomerId
        ? await client.fetchCustomerB2BStandardDiscount(primaryCustomerId).catch(() => null)
        : null;

      // Zusatzrabatt-Staffeln aus dem gespiegelten Snapshot. Sie hängen an der
      // KUNDENNUMMER, weil die Shopware-Regel Nummern als Bedingung führt — deshalb wird
      // über alle gematchten Nummern des Kunden gesucht (Portal- und Shop-Konto können
      // getrennte Datensätze mit derselben Nummer sein).
      let additionalDiscountTiers: Array<{
        label: string | null;
        discountPercent: number;
        thresholdAmount: number | null;
        allowStacking: boolean;
      }> = [];
      try {
        if (swCustomerNumbers.size > 0) {
          const { customerDiscountTiers } = await import("@shared/schema");
          const { db } = await import("../db");
          const { and, eq, inArray, isNull } = await import("drizzle-orm");
          const tierRows = await db
            .select()
            .from(customerDiscountTiers)
            .where(
              and(
                tenantId
                  ? eq(customerDiscountTiers.tenantId, tenantId)
                  : isNull(customerDiscountTiers.tenantId),
                inArray(customerDiscountTiers.customerNumber, Array.from(swCustomerNumbers)),
              ),
            );
          additionalDiscountTiers = tierRows
            .map((t) => ({
              label: t.label,
              discountPercent: t.discountPercent,
              thresholdAmount: t.thresholdAmount,
              allowStacking: t.allowStacking,
            }))
            .sort((a, b) => (a.thresholdAmount ?? 0) - (b.thresholdAmount ?? 0));
        }
      } catch (tierError: any) {
        // Die Staffeln sind Zusatzinformation — ein Fehler hier darf die Preisliste nicht kippen.
        moduleLog.warn({ err: tierError }, "[individual-prices] Zusatzrabatte:");
      }

      // Kanal-Übersicht zählt über ALLE Preise des Kunden — unabhängig von Suche und Seitengröße.
      const priceCountByChannel = new Map<string, number>();
      for (const p of basePrices) {
        const key = p.salesChannelId ?? "__none__";
        priceCountByChannel.set(key, (priceCountByChannel.get(key) ?? 0) + 1);
      }
      const totalAll = basePrices.length;

      // Suche nach Artikelnummer oder Produktname. Kunden haben teils hunderte Preise —
      // das Modal lädt deshalb nicht mehr alles, sondern sucht gezielt.
      const search =
        typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
      const searched = search
        ? basePrices.filter((p) => {
            const pn = (p.productNumber || "").toLowerCase();
            const name = (p.productName || "").toLowerCase();
            return pn.includes(search) || name.includes(search);
          })
        : basePrices;

      const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
        200,
      );
      const offset = Math.max(Number.parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

      searched.sort((a, b) =>
        (a.productNumber || "").localeCompare(b.productNumber || "", undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
      const pageSlice = searched.slice(offset, offset + limit);

      // Anreicherung (Rabatte, Herstellkosten, Marge) nur auf der ausgelieferten Seite:
      // über alle Preise wäre das bei hunderten Positionen der teuerste Teil der Antwort.
      const pricesWithDiscounts = await client.enrichCustomerSpecificPricesWithDiscounts(pageSlice);
      const profitabilitySettings = await loadCrmProfitabilitySettings(storage, tenantId);
      const prices = await enrichCustomerPricesWithHerstellMargin(pricesWithDiscounts, {
        storage,
        client,
        tenantId,
        standardDiscountPercent,
        minMarginPercent: profitabilitySettings.minMarginPercent,
      });
      const channelsSeen = new Set<string>();
      const channels: Array<{
        salesChannelId: string | null;
        salesChannelName: string | null;
        customerId: string | null;
        customerNumber: string | null;
        priceCount: number;
      }> = [];
      for (const a of matchedAccounts) {
        const key = a.salesChannelId ?? "__none__";
        if (channelsSeen.has(key)) continue;
        channelsSeen.add(key);
        channels.push({
          salesChannelId: a.salesChannelId,
          salesChannelName: a.salesChannelId ? channelNameMap.get(a.salesChannelId) ?? a.salesChannelId : null,
          customerId: a.customerId,
          customerNumber: a.customerNumber,
          priceCount: priceCountByChannel.get(key) ?? 0,
        });
      }

      res.json({
        // available/total beziehen sich auf ALLE Preise des Kunden, nicht auf die
        // ausgelieferte Seite — sonst meldet das Modal bei einer Suche ohne Treffer
        // fälschlich „keine individuellen Preise".
        available: totalAll > 0,
        total: totalAll,
        matched: searched.length,
        limit,
        offset,
        search: search || null,
        prices,
        currency,
        salesChannelId: salesChannelFilter,
        channels,
        standardDiscountPercent,
        profitabilityMinMarginPercent: profitabilitySettings.minMarginPercent,
        resolved: true,
        configured: true,
        customerId: primaryCustomerId ?? null,
        customerNumber: primaryCustomerNumber,
        matchedCustomerIds: Array.from(swCustomerIds),
        matchedCustomerNumbers: Array.from(swCustomerNumbers),
        additionalDiscountTiers,
        pluginDetected: pluginEntity != null,
        fromMirror,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading customer individual prices:");
      res.status(500).json({ error: "Failed to load individual prices" });
    }
  });

  // Verfügbare Währungen für kundenindividuelle Preise (on demand für Währungsauswahl).
  app.get("/api/crm/customers/:id/individual-prices/currencies", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ currencies: [], resolved: false, configured: false });
      }

      const client = new ShopwareClient(settings);
      let resolved: any = null;
      try {
        resolved = await client.findCustomerByEmail(customer.email);
      } catch (resolveError: any) {
        moduleLog.warn({ err: resolveError }, "[individual-prices/currencies] customer resolve failed:");
      }
      const swCustomerId: string | undefined = resolved?.id;
      const swCustomerNumber: string | null =
        (resolved?.attributes?.customerNumber ?? resolved?.customerNumber)
          ? String(resolved.attributes?.customerNumber ?? resolved.customerNumber)
          : null;

      if (!swCustomerId && !swCustomerNumber) {
        return res.json({ currencies: [], resolved: false, configured: true });
      }

      const { currencies } = await client.fetchCustomerPriceCurrencies({
        customerId: swCustomerId,
        customerNumber: swCustomerNumber,
      });

      res.json({
        currencies,
        resolved: true,
        configured: true,
        pluginDetected: currencies.length > 0,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading customer individual price currencies:");
      res.status(500).json({ error: "Failed to load individual price currencies" });
    }
  });

  // Index aller Kunden mit kundenindividuellen Preisen (B2Bsellers Suite).
  // Liefert Anzahl + E-Mails, damit die CRM-Kundenliste nach "hat individuelle Preise" filtern kann.
  /**
   * Rabattübersicht über alle Kunden — Grundlage für die Auswertung des Rabattsystems.
   *
   * Liest ausschließlich aus dem Snapshot (customer_discount_snapshots + _tiers), nicht aus
   * Shopware: der Aufbau des Snapshots dauert Minuten (82 Preislisten-Stichproben), die
   * Seite muss sofort antworten. Aktualisiert wird über scripts/syncCustomerDiscounts.ts.
   */
  /**
   * Index der Kunden mit Zusatzrabatt — für den Filter in der CRM-Liste.
   *
   * Die Staffeln hängen an der Kundennummer, die CRM-Liste arbeitet mit E-Mail-Adressen.
   * Hier wird deshalb über den Kunden-Mirror auf E-Mail gemappt und gleich der höchste
   * Satz je Kunde mitgeliefert, damit die Liste ihn ohne Zusatzabfrage anzeigen kann.
   */
  app.get("/api/crm/customers/additional-discounts-index", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const { customerDiscountTiers } = await import("@shared/schema");
      const { db } = await import("../db");
      const { eq, isNull } = await import("drizzle-orm");

      const tiers = await db
        .select()
        .from(customerDiscountTiers)
        .where(
          tenantId
            ? eq(customerDiscountTiers.tenantId, tenantId)
            : isNull(customerDiscountTiers.tenantId),
        );

      if (tiers.length === 0) {
        return res.json({ configured: false, customerCount: 0, emails: [], maxPercentByEmail: {} });
      }

      const maxByNumber = new Map<string, number>();
      for (const t of tiers) {
        maxByNumber.set(
          t.customerNumber,
          Math.max(maxByNumber.get(t.customerNumber) ?? 0, t.discountPercent),
        );
      }

      const mirrors = await storage.getShopwareCustomerMirrors(tenantId);
      const emails = new Set<string>();
      const maxPercentByEmail: Record<string, number> = {};
      for (const c of mirrors) {
        if (!c.email || !c.customerNumber) continue;
        const pct = maxByNumber.get(c.customerNumber);
        if (pct == null) continue;
        const key = c.email.toLowerCase();
        emails.add(key);
        maxPercentByEmail[key] = Math.max(maxPercentByEmail[key] ?? 0, pct);
      }

      res.json({
        configured: true,
        customerCount: emails.size,
        // Kundennummern aus den Regeln, zu denen es keinen Kunden gibt — in dieser
        // Installation Tippfehler mit fehlender Null. Sichtbar machen statt verschlucken.
        unmatchedNumbers: [...maxByNumber.keys()].filter(
          (nr) => !mirrors.some((c) => c.customerNumber === nr),
        ).length,
        emails: [...emails],
        maxPercentByEmail,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading additional discounts index:");
      res.status(500).json({ error: "Failed to load additional discounts index" });
    }
  });

  app.get("/api/crm/discount-overview", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const tenantId = (req as any).tenantId ?? null;
      const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
      const only = typeof req.query.only === "string" ? req.query.only : "with-discount";
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
      const offset = Math.max(Number.parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

      const { customerDiscountSnapshots, customerDiscountTiers } = await import("@shared/schema");
      const { db } = await import("../db");
      const { eq, and, isNull } = await import("drizzle-orm");

      const tenantFilter = tenantId
        ? eq(customerDiscountSnapshots.tenantId, tenantId)
        : isNull(customerDiscountSnapshots.tenantId);
      const alle = await db.select().from(customerDiscountSnapshots).where(tenantFilter);

      const tierFilter = tenantId
        ? eq(customerDiscountTiers.tenantId, tenantId)
        : isNull(customerDiscountTiers.tenantId);
      const tierRows = await db.select().from(customerDiscountTiers).where(tierFilter);
      const tiersByNumber = new Map<string, typeof tierRows>();
      for (const t of tierRows) {
        const l = tiersByNumber.get(t.customerNumber) ?? [];
        l.push(t);
        tiersByNumber.set(t.customerNumber, l);
      }

      let rows = alle.map((r) => {
        const tiers = (r.customerNumber ? tiersByNumber.get(r.customerNumber) : undefined) ?? [];
        const maxTier = tiers.reduce((a, t) => Math.max(a, t.discountPercent), 0);
        // Der Zusatzrabatt greift zuletzt auf den Warenkorbwert, also multiplikativ auf
        // den bereits reduzierten Preis — nicht addiert.
        const artikel = r.effectiveDiscountPercent;
        const maximal =
          artikel != null && maxTier > 0
            ? 100 - ((100 - artikel) / 100) * ((100 - maxTier) / 100) * 100
            : artikel ?? (maxTier > 0 ? maxTier : null);
        return {
          customerId: r.customerId,
          customerNumber: r.customerNumber,
          email: r.email,
          company: r.company,
          groupName: r.groupName,
          standardDiscountPercent: r.standardDiscountPercent,
          individualPriceCount: r.individualPriceCount,
          priceListDiscountPercent: r.priceListDiscountPercent,
          articleDiscountPercent: artikel,
          tiers: [...tiers]
            .sort((a, b) => (a.thresholdAmount ?? 0) - (b.thresholdAmount ?? 0))
            .map((t) => ({
              label: t.label,
              discountPercent: t.discountPercent,
              thresholdAmount: t.thresholdAmount,
              allowStacking: t.allowStacking,
            })),
          maxTierPercent: maxTier || null,
          maxTotalDiscountPercent: maximal,
        };
      });

      if (only === "with-discount") {
        rows = rows.filter((r) => r.articleDiscountPercent != null || (r.maxTierPercent ?? 0) > 0);
      } else if (only === "individual") {
        rows = rows.filter((r) => r.individualPriceCount > 0);
      } else if (only === "tiers") {
        rows = rows.filter((r) => (r.maxTierPercent ?? 0) > 0);
      }

      if (search) {
        rows = rows.filter((r) =>
          [r.customerNumber, r.email, r.company]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(search)),
        );
      }

      rows.sort((a, b) => (b.maxTotalDiscountPercent ?? -1) - (a.maxTotalDiscountPercent ?? -1));

      const mitRabatt = rows.filter((r) => r.maxTotalDiscountPercent != null);
      const werte = mitRabatt
        .map((r) => r.maxTotalDiscountPercent as number)
        .sort((a, b) => a - b);
      const summary = {
        customersTotal: alle.length,
        matched: rows.length,
        withIndividualPrices: rows.filter((r) => r.individualPriceCount > 0).length,
        withStandardDiscount: rows.filter((r) => r.standardDiscountPercent != null).length,
        withTiers: rows.filter((r) => (r.maxTierPercent ?? 0) > 0).length,
        medianDiscount: werte.length ? werte[Math.floor(werte.length / 2)] : null,
        maxDiscount: werte.length ? werte[werte.length - 1] : null,
        syncedAt: alle[0]?.syncedAt ?? null,
      };

      res.json({ summary, rows: rows.slice(offset, offset + limit), limit, offset });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading discount overview:");
      res.status(500).json({ error: "Failed to load discount overview" });
    }
  });

  app.get("/api/crm/customers/individual-prices-index", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, pluginDetected: false, customerCount: 0, emails: [] });
      }

      const tenantId = (req as any).tenantId ?? null;
      const client = new ShopwareClient(settings);

      // Prefer persistent customer-price + customer mirrors
      const priceCount = await storage.countShopwareCustomerPriceMirrors(tenantId);
      if (priceCount > 0) {
        const prices = await storage.getShopwareCustomerPriceMirrors(tenantId);
        const customerIds = new Set(
          prices.map((p) => p.customerId).filter((id): id is string => Boolean(id)),
        );
        const customers = await storage.getShopwareCustomerMirrors(tenantId);
        const byId = new Map(customers.map((c) => [c.shopwareId, c]));
        const emails = new Set<string>();
        const channelNameMap = await client.fetchSalesChannelNameMap().catch(() => new Map<string, string>());
        // E-Mail -> Verkaufskanäle, in denen der Kunde individuelle Preise hat.
        const channelsByEmail: Record<string, string[]> = {};
        for (const id of customerIds) {
          const c = byId.get(id);
          if (!c?.email) continue;
          const key = c.email.toLowerCase();
          emails.add(key);
          const name = c.salesChannelId ? channelNameMap.get(c.salesChannelId) ?? c.salesChannelId : null;
          if (!name) continue;
          const list = (channelsByEmail[key] ??= []);
          if (!list.includes(name)) list.push(name);
        }
        const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
        triggerShopwareMirrorSync(storage, client, tenantId, ["customer_prices", "customers"]);
        return res.json({
          configured: true,
          pluginDetected: true,
          customerCount: customerIds.size,
          emails: Array.from(emails),
          channelsByEmail,
          fromMirror: true,
        });
      }

      const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
      triggerShopwareMirrorSync(storage, client, tenantId, ["customer_prices", "customers"]);

      const { data: index } = await getHashCached({
        cacheKey: CRM_INDIVIDUAL_PRICES_CACHE_KEY,
        tenantId,
        fetchFingerprint: () => client.fetchIndividualPriceCustomerFingerprint(),
        fetchFull: () => client.fetchIndividualPriceCustomerIndex(),
      });

      const channelNameMap = await client.fetchSalesChannelNameMap().catch(() => new Map<string, string>());
      const channelsByEmail: Record<string, string[]> = {};
      for (const c of index.customers ?? []) {
        const key = (c.email || "").toLowerCase();
        if (!key) continue;
        const name = c.salesChannelId ? channelNameMap.get(c.salesChannelId) ?? c.salesChannelId : null;
        if (!name) continue;
        const list = (channelsByEmail[key] ??= []);
        if (!list.includes(name)) list.push(name);
      }

      res.json({
        configured: true,
        pluginDetected: index.entity != null,
        customerCount: index.customerCount,
        emails: index.emails,
        channelsByEmail,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading individual prices index:");
      res.status(500).json({ error: "Failed to load individual prices index" });
    }
  });

  // Diagnose: Rohzahlen zu kundenindividuellen Preisen direkt aus Shopware +
  // Vergleich mit dem lokalen Mirror. Hilft zu klären, ob der angezeigte
  // "X Kunden mit individuellen Preisen" Zähler vollständig ist.
  app.get("/api/crm/customers/individual-prices-diagnostics", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false });
      }

      const tenantId = (req as any).tenantId ?? null;
      const client = new ShopwareClient(settings);

      // Live-Rohzahlen aus Shopware.
      const live = await client.fetchIndividualPriceDiagnostics();

      // Lokaler Mirror-Vergleich.
      const mirrorRows = await storage.getShopwareCustomerPriceMirrors(tenantId);
      const mirrorCustomerIds = new Set<string>();
      const mirrorCustomerNumbers = new Set<string>();
      let mirrorRowsWithoutCustomerId = 0;
      for (const row of mirrorRows) {
        if (row.customerId) mirrorCustomerIds.add(row.customerId);
        else mirrorRowsWithoutCustomerId += 1;
        if (row.customerNumber) mirrorCustomerNumbers.add(row.customerNumber);
      }

      // Wie viele der Live-Kunden lassen sich per E-Mail im Customer-Mirror auflösen?
      const customerMirrors = await storage.getShopwareCustomerMirrors(tenantId);
      const resolvableEmails = new Set(
        customerMirrors
          .filter((c) => mirrorCustomerIds.has(c.shopwareId) && c.email)
          .map((c) => (c.email as string).toLowerCase()),
      );

      res.json({
        configured: true,
        pluginDetected: live.entity != null,
        entity: live.entity,
        live: {
          totalPriceRows: live.totalRows,
          distinctCustomerId: live.distinctCustomerId,
          distinctCustomerNumber: live.distinctCustomerNumber,
          rowsWithoutCustomerId: live.rowsWithoutCustomerId,
          aggregationCapped: live.aggregationCapped,
        },
        mirror: {
          priceRows: mirrorRows.length,
          distinctCustomerId: mirrorCustomerIds.size,
          distinctCustomerNumber: mirrorCustomerNumbers.size,
          rowsWithoutCustomerId: mirrorRowsWithoutCustomerId,
          resolvableEmails: resolvableEmails.size,
        },
        note:
          "displayedCount = mirror.distinctCustomerId (bei vorhandenem Mirror) bzw. Live-Index. " +
          "Ist live.distinctCustomerId oder distinctCustomerNumber deutlich groesser, ist der angezeigte Zaehler unvollstaendig.",
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading individual prices diagnostics:");
      res.status(500).json({ error: "Failed to load individual prices diagnostics" });
    }
  });

  // Anzahl der Kunden im Shop (gesamt) + Aufschlüsselung pro Verkaufskanal
  // (z. B. Shop vs. Händler-Portal). Liefert die Live-Zahl direkt aus Shopware.
  app.get("/api/crm/customers/count", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, total: 0, byChannel: [] });
      }

      const tenantId = (req as any).tenantId ?? null;
      const client = new ShopwareClient(settings);
      const counts = await client.fetchCustomerCounts();

      // Kunden-Mirror im Hintergrund anstoßen, damit der vollständige Stamm
      // (Basis der CRM-Liste) befüllt/aktualisiert wird.
      const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
      triggerShopwareMirrorSync(storage, client, tenantId, ["customers"]);

      // Lokaler Kunden-Mirror + Sync-Status: zeigt, ob der vollständige
      // Kundenstamm bereits gespiegelt ist (Basis der CRM-Liste) und ob der
      // Sync ggf. mit einem Fehler hängt.
      const mirrorCount = await storage.countShopwareCustomerMirrors(tenantId);
      const syncState = await storage.getShopwareSyncState("customers", tenantId);

      res.json({
        configured: true,
        total: counts.total,
        byChannel: counts.byChannel,
        mirrorCount,
        mirrorSynced: mirrorCount >= counts.total,
        sync: {
          status: syncState?.status ?? "unknown",
          error: syncState?.error ?? null,
          lastTotal: syncState?.lastTotal ?? null,
          lastDeltaAt: syncState?.lastDeltaAt ?? null,
        },
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading customer count:");
      res.status(500).json({ error: "Failed to load customer count" });
    }
  });

  // Index der Bestandskunden-Firmen (Händler-Portal-Gruppen) für den CRM-Filter
  // "möglicher Bestandskunde". Liefert normalisierte Firmennamen -> Kundennummer;
  // der Abgleich gegen die CRM-Liste erfolgt clientseitig per Firmen-Match.
  app.get("/api/crm/customers/possible-existing-index", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const settings = await storage.getShopwareSettings();
      if (!settings) {
        return res.json({ configured: false, customerCount: 0, companies: {} });
      }

      const tenantId = (req as any).tenantId ?? null;
      const client = new ShopwareClient(settings);

      const normCompany = (s?: string | null) =>
        (s || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim()
          .replace(/\b(gmbh|ag|kg|ohg|e\.?\s?k\.?|mbh|co\.?|kgaa|ug|gbr|ltd|inc|gesellschaft|und|&)\b/g, " ")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();

      // Prefer customer mirror filtered by group name terms
      const mirrorCount = await storage.countShopwareCustomerMirrors(tenantId);
      if (mirrorCount > 0) {
        const customers = await storage.getShopwareCustomerMirrors(tenantId);
        const terms = BESTANDSKUNDEN_GROUP_TERMS.map((t) => t.toLowerCase());
        const companies: Record<string, string | null> = {};
        let matched = 0;
        for (const c of customers) {
          const groupName = (c.groupName || "").toLowerCase();
          if (!terms.some((term) => groupName.includes(term.toLowerCase()))) continue;
          const company = c.company || (c.payload as any)?.company;
          if (!company) continue;
          matched += 1;
          const key = normCompany(company);
          if (key.length >= 3 && !(key in companies)) {
            companies[key] = c.customerNumber;
          }
        }
        const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
        triggerShopwareMirrorSync(storage, client, tenantId, ["customers"]);
        return res.json({
          configured: true,
          customerCount: matched,
          companies,
          fromMirror: true,
        });
      }

      const { triggerShopwareMirrorSync } = await import("../shopware/shopwareMirror");
      triggerShopwareMirrorSync(storage, client, tenantId, ["customers"]);

      const { data: cached, fromCache } = await getHashCached({
        cacheKey: "crm_bestandskunden_index_v1",
        tenantId,
        fetchFingerprint: () => client.fetchBestandskundenFingerprint(BESTANDSKUNDEN_GROUP_TERMS),
        fetchFull: async () => {
          const rows = await client.fetchBestandskundenIndex(BESTANDSKUNDEN_GROUP_TERMS);
          const companies: Record<string, string | null> = {};
          for (const row of rows) {
            const key = normCompany(row.company);
            if (key.length >= 3 && !(key in companies)) {
              companies[key] = row.customerNumber;
            }
          }
          return { customerCount: rows.length, companies };
        },
      });

      if (fromCache) {
        moduleLog.info(`[hash-cache] bestandskunden index served from cache (${cached.customerCount} customers)`);
      }

      res.json({
        configured: true,
        customerCount: cached.customerCount,
        companies: cached.companies,
      });
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading possible-existing index:");
      res.status(500).json({ error: "Failed to load possible-existing index" });
    }
  });

  app.post("/api/crm/customers/:id/interactions", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const customer = await storage.getCustomer(id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      const data = insertCustomerInteractionSchema.parse({
        ...req.body,
        customerId: id,
        userId: (req.user as any)?.id,
      });
      const created = await storage.createCustomerInteraction(data);
      res.status(201).json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid interaction data", details: error.errors });
      }
      moduleLog.error({ err: error }, "Error creating CRM interaction:");
      res.status(500).json({ error: "Failed to create interaction" });
    }
  });

  app.get("/api/crm/assignees", requireAuth, requireManageCrm, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const simplified = users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        skills: user.skills || [],
      }));
      res.json(simplified);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading CRM assignees:");
      res.status(500).json({ error: "Failed to load assignees" });
    }
  });

  app.get("/api/crm/assignments", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
      let assignments = orderId
        ? await storage.getOrderAssignmentsByOrderId(orderId)
        : await storage.getOrderAssignments();
      if (status) {
        assignments = assignments.filter((assignment) => assignment.status === status);
      }
      const users = await storage.getAllUsers();
      const userById = new Map(users.map((user) => [user.id, user.username]));
      const enriched = assignments.map((assignment) => ({
        ...assignment,
        requestedByUserName: assignment.requestedByUserId ? userById.get(assignment.requestedByUserId) || null : null,
        assignedToUserName: assignment.assignedToUserId ? userById.get(assignment.assignedToUserId) || null : null,
        approvedByUserName: assignment.approvedByUserId ? userById.get(assignment.approvedByUserId) || null : null,
      }));
      res.json(enriched);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading CRM assignments:");
      res.status(500).json({ error: "Failed to load assignments" });
    }
  });

  app.post("/api/crm/assignments", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const data = insertOrderAssignmentSchema.parse(req.body);
      const existing = await storage.getOrderAssignmentsByOrderId(data.orderId);
      if (existing.some((assignment) => assignment.status === "requested")) {
        return res.status(409).json({ error: "Assignment request already pending" });
      }
      const created = await storage.createOrderAssignment({
        ...data,
        requestedByUserId: (req.user as any)?.id,
        status: "requested",
      });
      res.status(201).json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid assignment data", details: error.errors });
      }
      moduleLog.error({ err: error }, "Error creating CRM assignment:");
      res.status(500).json({ error: "Failed to create assignment" });
    }
  });

  app.post("/api/crm/assignments/:id/approve", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getOrderAssignment(id);
      if (!existing) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      const updated = await storage.updateOrderAssignment(id, {
        status: "approved",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error approving CRM assignment:");
      res.status(500).json({ error: "Failed to approve assignment" });
    }
  });

  app.post("/api/crm/assignments/:id/reject", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getOrderAssignment(id);
      if (!existing) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      const updated = await storage.updateOrderAssignment(id, {
        status: "rejected",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error rejecting CRM assignment:");
      res.status(500).json({ error: "Failed to reject assignment" });
    }
  });

  app.get("/api/crm/discount-requests", requireAuth, requireViewCrm, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId : "";
      let requests = ticketId
        ? await storage.getDiscountRequestsByTicketId(ticketId)
        : await storage.getDiscountRequests();
      if (status) {
        requests = requests.filter((request) => request.status === status);
      }
      const users = await storage.getAllUsers();
      const userById = new Map(users.map((user) => [user.id, user.username]));
      const enriched = requests.map((request) => ({
        ...request,
        requestedByUserName: request.requestedByUserId ? userById.get(request.requestedByUserId) || null : null,
        approvedByUserName: request.approvedByUserId ? userById.get(request.approvedByUserId) || null : null,
      }));
      res.json(enriched);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error loading CRM discount requests:");
      res.status(500).json({ error: "Failed to load discount requests" });
    }
  });

  app.post("/api/crm/discount-requests", requireAuth, requireManageCrm, requireCsrf, async (req, res) => {
    try {
      const data = insertDiscountRequestSchema.parse(req.body);
      const created = await storage.createDiscountRequest({
        ...data,
        requestedByUserId: (req.user as any)?.id,
        status: "requested",
      });
      if (created.ticketId) {
        await storage.createTicketActivityLog({
          ticketId: created.ticketId,
          userId: (req.user as any)?.id,
          action: "discount_requested",
          fieldName: "discount",
          oldValue: null,
          newValue: JSON.stringify({
            type: created.discountType,
            value: created.discountValue,
            currency: created.currency,
          }),
        });
      }
      res.status(201).json(created);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: "Invalid discount request data", details: error.errors });
      }
      moduleLog.error({ err: error }, "Error creating CRM discount request:");
      res.status(500).json({ error: "Failed to create discount request" });
    }
  });

  app.post("/api/crm/discount-requests/:id/approve", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getDiscountRequest(id);
      if (!existing) {
        return res.status(404).json({ error: "Discount request not found" });
      }
      const updated = await storage.updateDiscountRequest(id, {
        status: "approved",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error approving CRM discount request:");
      res.status(500).json({ error: "Failed to approve discount request" });
    }
  });

  app.post("/api/crm/discount-requests/:id/reject", requireAuth, requireApproveCrm, requireCsrf, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getDiscountRequest(id);
      if (!existing) {
        return res.status(404).json({ error: "Discount request not found" });
      }
      const updated = await storage.updateDiscountRequest(id, {
        status: "rejected",
        approvedByUserId: (req.user as any)?.id,
        approvedAt: new Date(),
      });
      res.json(updated);
    } catch (error: any) {
      moduleLog.error({ err: error }, "Error rejecting CRM discount request:");
      res.status(500).json({ error: "Failed to reject discount request" });
    }
  });
}
