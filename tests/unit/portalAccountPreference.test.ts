/**
 * Portal vor Onlineshop (Entscheidung 11.10.2026): Kunden, die im Händlerportal geführt werden,
 * werden auch darüber abgewickelt. Der Kanal folgt dem zugeordneten Konto – also wählt schon die
 * Kundenzuordnung das Portal-Konto.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveShopwareCustomerForDraft } from "../../server/commercial/draftCustomerEmailResolution";
import { isPortalAccount, pickPreferredAccount, PORTAL_SWITCH_MAX_CONFIDENCE } from "../../server/commercial/portalAccountPreference";

const SHOP = "018ec134507f703b82a76467791e7e61";
const PORTAL_DE = "019ce2d0bb6f718dbfeadaf95ee3da71";
const PORTAL_AT = "019dbe8796477859a8228ca4235d7b7a";
const CHANNELS = [
  { id: SHOP, name: "META Regalbau DE" },
  { id: PORTAL_DE, name: "META Händler Portal DE" },
  { id: PORTAL_AT, name: "META Händler Portal AT" },
];

type Acc = { id: string; email: string; customerNumber: string; company: string; salesChannelId: string; salesChannelName?: string };

const shopAcc: Acc = { id: "shop", email: "einkauf@delker.com", customerNumber: "12345", company: "Friedrich Delker GmbH & Co. KG", salesChannelId: SHOP, salesChannelName: "META Regalbau DE" };
const portalAcc: Acc = { id: "portal", email: "hendrik.bojahr@delker.com", customerNumber: "20000011727", company: "Friedrich Delker GmbH & Co.KG", salesChannelId: PORTAL_DE, salesChannelName: "META Händler Portal DE" };

function client(accounts: Acc[], opts: { channels?: boolean } = {}) {
  const searches: string[] = [];
  const c = {
    searches,
    findCustomerByEmail: async (email: string) => accounts.find((a) => a.email === email) ?? null,
    findCustomersByEmail: async (email: string) =>
      accounts.filter((a) => a.email === email).map((a) => ({ id: a.id, customerNumber: a.customerNumber, salesChannelId: a.salesChannelId })),
    searchCustomers: async (term: string) => {
      searches.push(term);
      const t = term.toLowerCase();
      return accounts.filter((a) => a.email.includes(t) || a.company.toLowerCase().includes(t.split(" ")[0]) || a.customerNumber.endsWith(t));
    },
    fetchCustomerSalesChannelId: async (id: string) => {
      const a = accounts.find((x) => x.id === id);
      return a ? { id: a.salesChannelId, name: a.salesChannelName ?? null } : null;
    },
    ...(opts.channels === false ? {} : { fetchSalesChannels: async () => CHANNELS }),
  };
  return c;
}

const draft = (email: string, company = "Friedrich Delker GmbH & Co. KG") =>
  ({ customer: { email }, billingAddress: { company, street: "Am Hafen 3", zipCode: "28197", city: "Bremen", country: "DE" } }) as Record<string, any>;

describe("Portal-Konto erkennen", () => {
  it("über den Kanal, ohne Kanalliste über die lange Kundennummer", () => {
    const ids = new Set([PORTAL_DE.toLowerCase()]);
    assert.equal(isPortalAccount(portalAcc, ids), true);
    assert.equal(isPortalAccount(shopAcc, ids), false);
    assert.equal(isPortalAccount({ id: "x", customerNumber: "20000011727" }, null), true);
    assert.equal(isPortalAccount({ id: "x", customerNumber: "BC-00467" }, null), false);
    assert.equal(pickPreferredAccount([shopAcc, portalAcc], ids)?.id, "portal");
  });
});

describe("Kundenzuordnung: Portal vor Onlineshop", () => {
  it("dieselbe E-Mail im Shop und im Portal → Portal-Konto", async () => {
    const same = { ...portalAcc, email: shopAcc.email };
    const data = draft(shopAcc.email);
    const id = await resolveShopwareCustomerForDraft(client([shopAcc, same]) as never, data as never, {});
    assert.equal(id, "portal");
    assert.equal(data.customer.portalAccountSwitch, undefined);
  });

  it("E-Mail passt nur aufs Shop-Konto, Firma hat ein Portal-Konto → Wechsel mit Vermerk, nicht automatisch sicher", async () => {
    const data = draft(shopAcc.email);
    const id = await resolveShopwareCustomerForDraft(client([shopAcc, portalAcc]) as never, data as never, {});
    assert.equal(id, "portal");
    assert.equal(data.customer.portalAccountSwitch.fromCustomerNumber, "12345");
    assert.equal(data.customer.portalAccountSwitch.toCustomerNumber, "20000011727");
    assert.equal(data.customer.portalAccountSwitch.toSalesChannelName, "META Händler Portal DE");
    assert.ok(data.customer.customerMatchConfidence <= PORTAL_SWITCH_MAX_CONFIDENCE);
  });

  it("mehrere Portal-Konten → keine Zuordnung, Auswahl aus Portal- und Shop-Konto", async () => {
    const portal2 = { ...portalAcc, id: "portal2", email: "lager@delker.com", customerNumber: "20000022222", salesChannelId: PORTAL_AT };
    const data = draft(shopAcc.email);
    const id = await resolveShopwareCustomerForDraft(client([shopAcc, portalAcc, portal2]) as never, data as never, { allowCustomerAutoCreate: true });
    assert.equal(id, null);
    assert.equal(data.customer.portalAccountChoiceRequired, true);
    assert.deepEqual(
      data.customer.shopwareCustomerCandidates.map((c: any) => [c.id, c.reason]),
      [["portal", "portal_account"], ["portal2", "portal_account"], ["shop", "shop_account"]],
    );
  });

  it("Portal-Konto direkt gefunden → keine Zusatzsuche", async () => {
    const c = client([shopAcc, portalAcc]);
    const data = draft(portalAcc.email);
    assert.equal(await resolveShopwareCustomerForDraft(c as never, data as never, {}), "portal");
    assert.deepEqual(c.searches, []);
  });

  it("Shop-Kunde ohne Portal-Konto bleibt im Shop", async () => {
    const hommel = { id: "hommel", email: "nicolas.schneider@hommel-hercules.com", customerNumber: "BC-00467", company: "Hommel Hercules Werkzeughandel", salesChannelId: SHOP };
    const data = draft(hommel.email, hommel.company);
    assert.equal(await resolveShopwareCustomerForDraft(client([hommel, portalAcc]) as never, data as never, {}), "hommel");
    assert.equal(data.customer.portalAccountSwitch, undefined);
  });

  it("Firmenabgleich mit Shop- und Portal-Konto derselben Firma → Portal-Konto", async () => {
    const shopSameName = { ...shopAcc, company: portalAcc.company };
    const data = draft("neu@unbekannt-kunde.de", portalAcc.company);
    const id = await resolveShopwareCustomerForDraft(client([shopSameName, portalAcc]) as never, data as never, {});
    assert.equal(id, "portal");
  });
});
