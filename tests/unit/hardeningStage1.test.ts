/**
 * Härtung Stufe 1 (24.10.2026): Shopware-Pfade, Rechte-Ausweitung, XML-Laufzeit, Kundenzuordnung nach Absender,
 * begrenzte Anfragezähler.
 *
 *   Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import { assertSafeShopwareUrl, isShopwareId, UnsafeShopwareUrlError } from "../../server/shopware/safeShopwareUrl";
import { MAX_XML_CHARS, MAX_XML_DEPTH, parseXml } from "../../server/extraction/orderXmlParser";
import { isAdministrator, permissionSet, roleChangeError, userChangeError } from "../../server/auth/privilegeGuard";
import {
  accountMatchesSender,
  buildRankedCustomerEmails,
  normalizeSenderEmail,
  resolveShopwareCustomerForDraft,
  SENDER_MISMATCH_MAX_CONFIDENCE,
} from "../../server/commercial/draftCustomerEmailResolution";
import { createWindowRateLimiter } from "../../server/lib/windowRateLimit";
import { isTenantIdHeader } from "../../server/shopPulse/cartAlarm";

const BASE = "https://shop.example";
const ID = "0123456789abcdef0123456789abcdef";

describe("Shopware-Adressen: keine Pfad-Tricks aus Anfrage-IDs", () => {
  it("lässt normale API-Pfade durch", () => {
    expect(() => assertSafeShopwareUrl(`${BASE}/api/order/${ID}`)).not.toThrow();
    expect(() => assertSafeShopwareUrl(`${BASE}/api/_action/document/${ID}/AbC_12-x?download=1`)).not.toThrow();
    expect(() => assertSafeShopwareUrl(`${BASE}/api/search/order?filter=..%2F`)).not.toThrow();
  });

  it("lehnt Punkt-Segmente, kodierte Schräg-/Rückstriche und Fragmente ab", () => {
    // so kam der Wert nach dem Dekodieren durch Express an
    expect(() => assertSafeShopwareUrl(`${BASE}/api/_action/document/../../user?/x?download=1`)).toThrow(UnsafeShopwareUrlError);
    expect(() => assertSafeShopwareUrl(`${BASE}/api/order/./${ID}`)).toThrow(UnsafeShopwareUrlError);
    expect(() => assertSafeShopwareUrl(`${BASE}/api/order/..%2Fuser`)).toThrow(UnsafeShopwareUrlError);
    expect(() => assertSafeShopwareUrl(`${BASE}/api/order/%2e%2e/user`)).toThrow(UnsafeShopwareUrlError);
    expect(() => assertSafeShopwareUrl(`${BASE}/api/order/a\\..\\user`)).toThrow(UnsafeShopwareUrlError);
    expect(() => assertSafeShopwareUrl(`${BASE}/api/order/${ID}#frag`)).toThrow(UnsafeShopwareUrlError);
  });

  it("erkennt Shopware-IDs", () => {
    expect(isShopwareId(ID)).toBe(true);
    expect(isShopwareId(ID.toUpperCase())).toBe(true);
    expect(isShopwareId("../../user")).toBe(false);
    expect(isShopwareId(`${ID}/x`)).toBe(false);
    expect(isShopwareId(undefined)).toBe(false);
  });
});

describe("XML-Parser: lineare Laufzeit und Grenzen", () => {
  it("verarbeitet präparierte Verschachtelung schnell (früher 137 KB ≈ 3 s, quadratisch)", () => {
    const n = 40_000;
    const xml = "<ORDER>" + "<a>".repeat(n) + "</b>".repeat(n) + "</a>".repeat(n);
    const t = performance.now();
    parseXml(xml);
    expect(performance.now() - t).toBeLessThan(1_000);
  });

  it("schließt falsch verschachtelte Tags wie bisher tolerant", () => {
    const root = parseXml("<ORDER><HEADER><ID>1</ID></HEADER><ITEM><X>a</ITEM><ITEM>b</ITEM></ORDER>");
    expect(root?.name).toBe("ORDER");
    expect(root?.children.map((c) => c.name)).toEqual(["HEADER", "ITEM", "ITEM"]);
    expect(root?.children[2].text).toBe("b");
  });

  it("hängt zu tief Verschachteltes flach an und lehnt Übergroßes ab", () => {
    const deep = "<r>" + "<n>".repeat(MAX_XML_DEPTH + 50) + "x";
    let depth = 0;
    for (let node = parseXml(deep); node && node.children.length; node = node.children[node.children.length - 1]) depth++;
    expect(depth).toBeLessThanOrEqual(MAX_XML_DEPTH + 1);
    expect(parseXml("<r>" + "a".repeat(MAX_XML_CHARS) + "</r>")).toBeNull();
  });
});

describe("Benutzer- und Rollenverwaltung: keine Rechte-Ausweitung", () => {
  const manager = { role: "employee", roleDetails: { name: "Teamleitung", permissions: { manageUsers: true, manageRoles: true, viewOrders: true } } };
  const admin = { role: "admin", roleDetails: { name: "Administrator", permissions: {} } };

  it("Administrator-Rolle nur durch Administratoren", () => {
    expect(isAdministrator(admin)).toBe(true);
    expect(isAdministrator(manager)).toBe(false);
    expect(roleChangeError(manager, { name: "Administrator", permissions: {} })).toMatch(/Administrator/);
    expect(roleChangeError(manager, { name: "administrator ", permissions: {} })).toMatch(/Administrator/);
    // Umbenennen der Administrator-Rolle bzw. Umbenennen einer Rolle in „Administrator“
    expect(roleChangeError(manager, { name: "Alt", permissions: {} }, { name: "Administrator", permissions: {} })).toMatch(/Administrator/);
    expect(roleChangeError(admin, { name: "Administrator", permissions: { manageSettings: true } })).toBeNull();
  });

  it("niemand vergibt Rechte, die er selbst nicht hat", () => {
    expect(roleChangeError(manager, { name: "Lager", permissions: { viewOrders: true } })).toBeNull();
    expect(roleChangeError(manager, { name: "Lager", permissions: { viewOrders: true, manageSettings: true } })).toMatch(/manageSettings/);
    // bestehende Rechte einer Rolle, die man selbst nicht hat, blockieren unabhängige Änderungen nicht
    expect(
      roleChangeError(manager, { name: "Buchhaltung 2", permissions: { manageAccounting: true } }, { name: "Buchhaltung", permissions: { manageAccounting: true } }),
    ).toBeNull();
    expect(permissionSet(["a", "b", 3])).toEqual(new Set(["a", "b"]));
    expect(permissionSet({ a: true, b: false })).toEqual(new Set(["a"]));
  });

  it("Benutzer: keine Administratoren, nur gemeinsame Mandanten", () => {
    expect(userChangeError(manager, { id: "u1", role: "admin" }, null, true)).toMatch(/Administrator/);
    expect(userChangeError(manager, { id: "u1", role: "employee" }, { name: "Administrator" }, true)).toMatch(/Administrator/);
    expect(userChangeError(manager, { id: "u1", role: "employee" }, { name: "Lager" }, false)).toMatch(/Mandanten/);
    expect(userChangeError(manager, { id: "u1", role: "employee" }, { name: "Lager" }, true)).toBeNull();
    expect(userChangeError(admin, { id: "u1", role: "admin" }, null, false)).toBeNull();
  });
});

describe("Kundenzuordnung: der Absender zählt mehr als Adressen im Mailtext", () => {
  type Acc = { id: string; email: string; customerNumber: string; company: string };
  const victim: Acc = { id: "victim", email: "einkauf@opfer-gmbh.de", customerNumber: "10001", company: "Opfer GmbH" };
  const attacker: Acc = { id: "attacker", email: "info@fremd.de", customerNumber: "10002", company: "Fremd" };
  const colleague: Acc = { id: "colleague", email: "chef@opfer-gmbh.de", customerNumber: "10001", company: "Opfer GmbH" };

  const client = (accounts: Acc[]) => ({
    findCustomerByEmail: async (email: string) => accounts.find((a) => a.email === email) ?? null,
    findCustomersByEmail: async (email: string) =>
      accounts.filter((a) => a.email === email).map((a) => ({ id: a.id, customerNumber: a.customerNumber, salesChannelId: "shop" })),
    searchCustomers: async () => [],
    fetchCustomerSalesChannelId: async () => ({ id: "shop", name: "META Regalbau DE" }),
    fetchSalesChannels: async () => [{ id: "shop", name: "META Regalbau DE" }],
  });

  const spoofText = ["Von: einkauf@opfer-gmbh.de", "Bitte liefern an …", "einkauf@opfer-gmbh.de", "einkauf@opfer-gmbh.de"].join("\n");

  it("Absender-Adresse: normalisiert, eigene und noreply-Adressen zählen nicht", () => {
    expect(normalizeSenderEmail(" Info@Fremd.de ")).toBe("info@fremd.de");
    expect(normalizeSenderEmail("vertrieb@meta-online.com")).toBeNull();
    expect(normalizeSenderEmail("noreply@shop.de")).toBeNull();
    expect(normalizeSenderEmail("kein-mail")).toBeNull();
    expect(accountMatchesSender("chef@opfer-gmbh.de", "einkauf@opfer-gmbh.de")).toBe(true);
    expect(accountMatchesSender("x@gmail.com", "y@gmail.com")).toBe(false);
    expect(accountMatchesSender("einkauf@opfer-gmbh.de", "info@fremd.de")).toBe(false);
  });

  it("Absender rückt nach vorn, auch wenn der Text eine andere Adresse oft nennt", () => {
    const ranked = buildRankedCustomerEmails({ emailContext: spoofText, senderEmail: "info@fremd.de" });
    expect(ranked[0].email).toBe("info@fremd.de");
  });

  it("fremder Absender, Opfer-Adresse nur im Text: kein sicherer Treffer auf das Opfer", async () => {
    const data: Record<string, any> = { customer: {} };
    const id = await resolveShopwareCustomerForDraft(client([victim]) as never, data as never, {
      emailContext: spoofText,
      senderEmail: "info@unbekannt.de",
    });
    expect(id).toBe("victim");
    expect(data.customer.customerMatchConfidence).toBeLessThanOrEqual(SENDER_MISMATCH_MAX_CONFIDENCE);
    expect(data.customer.emailResolution.senderMismatch).toBe(true);
    expect(data.customer.emailResolution.exactUniqueAccount).toBeUndefined();
  });

  it("Absender hat selbst ein Konto: dieses Konto, sicher", async () => {
    const data: Record<string, any> = { customer: {} };
    const id = await resolveShopwareCustomerForDraft(client([victim, attacker]) as never, data as never, {
      emailContext: spoofText,
      senderEmail: "info@fremd.de",
    });
    expect(id).toBe("attacker");
    expect(data.customer.customerMatchConfidence).toBe(100);
  });

  it("Kollege derselben Firma (gleiche Domain): normaler Treffer ohne Deckel", async () => {
    const data: Record<string, any> = { customer: {} };
    await resolveShopwareCustomerForDraft(client([colleague]) as never, data as never, {
      emailContext: "Von: chef@opfer-gmbh.de\nBestellung anbei",
      senderEmail: "einkauf@opfer-gmbh.de",
    });
    expect(data.customer.emailResolution.senderMismatch).toBeUndefined();
  });

  it("ohne Absender (manueller Upload) wie bisher", async () => {
    const data: Record<string, any> = { customer: {} };
    const id = await resolveShopwareCustomerForDraft(client([victim]) as never, data as never, { emailContext: spoofText });
    expect(id).toBe("victim");
    expect(data.customer.customerMatchConfidence).toBe(100);
  });
});

describe("Anfragezähler im Speicher: begrenzt und aufgeräumt", () => {
  it("zählt je Schlüssel und Fenster", () => {
    const l = createWindowRateLimiter({ windowMs: 1_000, max: 2, maxKeys: 10 });
    expect([l.hit("a", 0), l.hit("a", 1), l.hit("a", 2)]).toEqual([true, true, false]);
    expect(l.hit("a", 1_500)).toBe(true);
  });

  it("wächst nicht über die Obergrenze und räumt Abgelaufenes ab", () => {
    const l = createWindowRateLimiter({ windowMs: 1_000, max: 5, maxKeys: 100 });
    for (let i = 0; i < 1_000; i++) l.hit(`k${i}`, 10);
    expect(l.size()).toBe(100);
    expect(l.hit("neu", 20)).toBe(false);
    expect(l.hit("k1", 20)).toBe(true);
    expect(l.hit("neu", 2_000)).toBe(true);
    expect(l.size()).toBe(1);
  });

  it("Mandanten-Header muss eine UUID sein", () => {
    expect(isTenantIdHeader("13e1a563-e54f-4a41-9550-69be94f312bf")).toBe(true);
    expect(isTenantIdHeader("x".repeat(15_000))).toBe(false);
    expect(isTenantIdHeader("")).toBe(false);
  });
});
