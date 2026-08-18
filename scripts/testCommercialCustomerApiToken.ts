/**
 * Unit-Tests für Zugangs-Token und Rate-Limit des Rückmelde-Endpunkts.
 *
 *   npm run test:customer-api-token
 */

import assert from "node:assert/strict";
import {
  constantTimeHashEquals,
  generateCommercialCustomerToken,
  hashCommercialCustomerToken,
  readCustomerTokenFromRequest,
  validateCustomerToken,
} from "../server/commercialCustomerApiToken";
import {
  rateLimitAcknowledgement,
  resetAcknowledgementRateLimit,
} from "../server/commercialAcknowledgementRoutes";

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ${name}: OK`);
  } catch (error) {
    failures += 1;
    console.error(`  ${name}: FAILED`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\n=== commercialCustomerApiToken Unit Tests ===\n");

check("erzeugt erkennbare, ausreichend lange Token", () => {
  const token = generateCommercialCustomerToken();
  assert.ok(token.startsWith("moc_"), `unerwartetes Präfix: ${token.slice(0, 8)}`);
  assert.ok(token.length > 40, "Token zu kurz");
  assert.notEqual(token, generateCommercialCustomerToken(), "Token müssen eindeutig sein");
});

check("Hash ist stabil und token-spezifisch", () => {
  const a = generateCommercialCustomerToken();
  assert.equal(hashCommercialCustomerToken(a), hashCommercialCustomerToken(a));
  assert.notEqual(
    hashCommercialCustomerToken(a),
    hashCommercialCustomerToken(generateCommercialCustomerToken())
  );
  // Klartext darf im Hash nicht auftauchen
  assert.ok(!hashCommercialCustomerToken(a).includes(a.slice(4, 20)));
});

check("liest Bearer-Header", () => {
  assert.equal(readCustomerTokenFromRequest({ authorization: "Bearer moc_abc" }), "moc_abc");
  assert.equal(readCustomerTokenFromRequest({ authorization: "bearer   moc_abc" }), "moc_abc");
});

check("liest den eigenen Header als Alternative", () => {
  assert.equal(
    readCustomerTokenFromRequest({ "x-metaorder-customer-token": "moc_xyz" }),
    "moc_xyz"
  );
});

check("ohne Header kein Token", () => {
  assert.equal(readCustomerTokenFromRequest({}), null);
  assert.equal(readCustomerTokenFromRequest({ authorization: "Basic abc" }), null);
  assert.equal(readCustomerTokenFromRequest({ authorization: "Bearer   " }), null);
});

const baseToken = {
  id: "t1",
  tenantId: "tenant-1",
  shopwareCustomerId: "cust-1",
  expiresAt: null,
  revokedAt: null,
};

check("gültiges Token wird akzeptiert", () => {
  const result = validateCustomerToken(baseToken);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.token.shopwareCustomerId, "cust-1");
});

check("unbekanntes Token wird abgelehnt", () => {
  assert.deepEqual(validateCustomerToken(null), { ok: false, reason: "unknown" });
  assert.deepEqual(validateCustomerToken(undefined), { ok: false, reason: "unknown" });
});

check("widerrufenes Token wird abgelehnt", () => {
  const result = validateCustomerToken({ ...baseToken, revokedAt: new Date("2026-01-01") });
  assert.deepEqual(result, { ok: false, reason: "revoked" });
});

check("abgelaufenes Token wird abgelehnt", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const result = validateCustomerToken(
    { ...baseToken, expiresAt: new Date("2026-08-14T23:59:59Z") },
    now
  );
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

check("noch gültiges Ablaufdatum wird akzeptiert", () => {
  const now = new Date("2026-08-15T00:00:00Z");
  const result = validateCustomerToken(
    { ...baseToken, expiresAt: new Date("2026-09-01T00:00:00Z") },
    now
  );
  assert.equal(result.ok, true);
});

check("Widerruf schlägt Ablauf — beide Gründe führen zur Ablehnung", () => {
  const result = validateCustomerToken({
    ...baseToken,
    revokedAt: new Date("2026-01-01"),
    expiresAt: new Date("2099-01-01"),
  });
  assert.equal(result.ok, false);
});

check("zeitkonstanter Vergleich arbeitet korrekt", () => {
  assert.equal(constantTimeHashEquals("abc", "abc"), true);
  assert.equal(constantTimeHashEquals("abc", "abd"), false);
  assert.equal(constantTimeHashEquals("abc", "abcd"), false);
});

check("Rate-Limit greift nach 60 Anfragen pro Minute", () => {
  resetAcknowledgementRateLimit();
  const t0 = 1_000_000;
  for (let i = 0; i < 60; i++) {
    assert.equal(rateLimitAcknowledgement("ip:1.2.3.4", t0), true, `Anfrage ${i + 1} blockiert`);
  }
  assert.equal(rateLimitAcknowledgement("ip:1.2.3.4", t0), false, "61. Anfrage muss blocken");
});

check("Rate-Limit trennt nach Schlüssel", () => {
  resetAcknowledgementRateLimit();
  const t0 = 2_000_000;
  for (let i = 0; i < 60; i++) rateLimitAcknowledgement("ip:1.1.1.1", t0);
  assert.equal(rateLimitAcknowledgement("ip:1.1.1.1", t0), false);
  assert.equal(rateLimitAcknowledgement("ip:2.2.2.2", t0), true, "andere IP darf nicht mitleiden");
});

check("Rate-Limit öffnet nach dem Zeitfenster wieder", () => {
  resetAcknowledgementRateLimit();
  const t0 = 3_000_000;
  for (let i = 0; i < 60; i++) rateLimitAcknowledgement("ip:9.9.9.9", t0);
  assert.equal(rateLimitAcknowledgement("ip:9.9.9.9", t0), false);
  assert.equal(rateLimitAcknowledgement("ip:9.9.9.9", t0 + 60_001), true);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll tests passed.\n");
