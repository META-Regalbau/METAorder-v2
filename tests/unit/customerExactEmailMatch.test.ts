/**
 * Kunde per E-Mail: Ein exakter Treffer auf genau ein Shopware-Konto gilt als sicher (Entscheidung 11.10.2026).
 * Live-Anlass: Absender info@indiesemsinne.de = Login von Kd. 10001, trotzdem nur 87 % → nie über der
 * Strikt-Schwelle von 95.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  computeCustomerMatchConfidence,
  EXACT_UNIQUE_EMAIL_MATCH_CONFIDENCE,
  resolveShopwareCustomerForDraft,
} from "../../server/commercial/draftCustomerEmailResolution";

type Account = { id: string; email: string };

function fakeClient(accounts: Account[]) {
  return {
    findCustomerByEmail: async (email: string) => accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null,
    findCustomersByEmail: async (email: string, limit = 25) =>
      accounts
        .filter((a) => a.email.toLowerCase() === email.toLowerCase())
        .slice(0, limit)
        .map((a) => ({ id: a.id, customerNumber: null, salesChannelId: null })),
    searchCustomers: async () => [],
  } as never;
}

function draft() {
  return {
    customer: { email: "info@indiesemsinne.de" },
    billingAddress: { street: "Schüttweg 3", zipCode: "59494", city: "Soest", country: "DE" },
  } as Record<string, any>;
}

describe("Kundenzuordnung: exakter E-Mail-Treffer", () => {
  it("genau ein Konto mit der Absenderadresse → 100 %, als eindeutig vermerkt", async () => {
    const data = draft();
    const id = await resolveShopwareCustomerForDraft(fakeClient([{ id: "c10001", email: "info@indiesemsinne.de" }]), data, {});
    assert.equal(id, "c10001");
    assert.equal(data.customer.customerMatchConfidence, EXACT_UNIQUE_EMAIL_MATCH_CONFIDENCE);
    assert.equal(data.customer.emailResolution.exactUniqueAccount, true);
  });

  it("zwei Konten mit derselben Adresse (z. B. Portal und Shop) → bleibt unter der Schwelle", async () => {
    const data = draft();
    const id = await resolveShopwareCustomerForDraft(
      fakeClient([
        { id: "portal", email: "info@indiesemsinne.de" },
        { id: "shop", email: "info@indiesemsinne.de" },
      ]),
      data,
      {},
    );
    assert.equal(id, "portal");
    assert.ok(data.customer.customerMatchConfidence < 95, String(data.customer.customerMatchConfidence));
    assert.equal(data.customer.emailResolution.exactUniqueAccount, undefined);
  });

  it("ohne Treffer, ohne Sonderfall: Berechnung wie bisher", () => {
    const ranked = [{ email: "a@b.de", score: 20 }];
    assert.equal(computeCustomerMatchConfidence({ ranked, shopwareCustomerId: "x", usedLlm: false }), 87);
    assert.equal(computeCustomerMatchConfidence({ ranked, shopwareCustomerId: null, usedLlm: false, exactUniqueEmailMatch: true }) < 95, true);
  });
});
