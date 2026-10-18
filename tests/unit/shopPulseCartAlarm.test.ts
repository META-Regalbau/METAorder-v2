/**
 * Shop-Puls Stufe 2 (S2-3), B2B-Warenkorb-Alarm: Signatur (gemeinsame Vorlage mit dem PHP-Plugin
 * MetaCartSignal), Meldung des Plugins, wann ein Alarm geht (Schwelle, Wartezeit, Wochen-Grenze, bestellt),
 * Empfänger, Erfolg, Teams-Karte mit @Erwähnung und der Lauf mit simulierten Quellen.
 * Ausführung: npm test
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { cartSignalRateOk, cartState, planCartAlarms, recipientFor, signCartBody, verifyCartSignature, type CustomerOrder } from "../../server/shopPulse/cartAlarm";
import { buildCartAlarmCard, runCartAlarm, type CartAlarmDeps } from "../../server/shopPulse/cartAlarmRun";
import { cartSignalSchema, DEFAULT_SHOP_PULSE_CART_SETTINGS, normalizeShopPulseCartSettings, type ShopPulseCart, type ShopPulseCartSettings } from "../../shared/shopPulseCart";

const fixture = JSON.parse(readFileSync(path.join(__dirname, "../../shopware/custom/plugins/MetaCartSignal/tests/Fixtures/signature.json"), "utf8")) as {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
};

const NOW = new Date("2026-10-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const ON: ShopPulseCartSettings = { ...DEFAULT_SHOP_PULSE_CART_SETTINGS, enabled: true };

function cart(over: Partial<ShopPulseCart> = {}): ShopPulseCart {
  return {
    id: "c1",
    customerNumber: "20001",
    company: "Muster GmbH",
    contactName: "Erika Muster",
    contactEmail: "erika@example.org",
    contactPhone: "0123 456",
    netTotal: 1500,
    currency: "EUR",
    positionCount: 2,
    positions: [
      { productNumber: "SW1", label: "Fachbodenregal", quantity: 12, netTotal: 1200 },
      { productNumber: "SW2", label: "Fachboden", quantity: 3, netTotal: 300 },
    ],
    cartUpdatedAt: hoursAgo(30),
    receivedAt: hoursAgo(30),
    alarmedAt: null,
    alarmRecipient: null,
    alarmRecipientSource: null,
    alarmMailed: false,
    orderedAt: null,
    orderNumber: null,
    state: "waiting",
    ...over,
  };
}

describe("Signatur", () => {
  it("stimmt mit der Vorlage des PHP-Plugins überein", () => {
    expect(signCartBody(fixture.secret, fixture.timestamp, fixture.body)).toBe(fixture.signature);
    const now = new Date(fixture.timestamp * 1000 + 60_000);
    expect(verifyCartSignature(fixture.secret, String(fixture.timestamp), `sha256=${fixture.signature}`, Buffer.from(fixture.body), now)).toBe("ok");
  });

  it("lehnt falschen Schlüssel, veränderten Inhalt, alten Zeitstempel und fehlende Angaben ab", () => {
    const now = new Date(fixture.timestamp * 1000);
    const sig = `sha256=${fixture.signature}`;
    expect(verifyCartSignature("anders", String(fixture.timestamp), sig, Buffer.from(fixture.body), now)).toBe("badSignature");
    expect(verifyCartSignature(fixture.secret, String(fixture.timestamp), sig, Buffer.from(fixture.body + " "), now)).toBe("badSignature");
    expect(verifyCartSignature(fixture.secret, String(fixture.timestamp), sig, Buffer.from(fixture.body), new Date(now.getTime() + 301_000))).toBe("badTimestamp");
    expect(verifyCartSignature(fixture.secret, undefined, sig, Buffer.from(fixture.body), now)).toBe("missing");
    expect(verifyCartSignature(fixture.secret, String(fixture.timestamp), "sha256=zz", Buffer.from(fixture.body), now)).toBe("badSignature");
  });

  it("die Meldung der Vorlage ist gültig", () => {
    const parsed = cartSignalSchema.safeParse(JSON.parse(fixture.body));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.event === "cart.saved" && parsed.data.cart.netTotal).toBe(1250.5);
    expect(cartSignalSchema.safeParse({ ...JSON.parse(fixture.body), event: "cart.deleted" }).success).toBe(false);
  });

  it("begrenzt Meldungen je Mandant und Minute", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 120; i++) expect(cartSignalRateOk("rate-test", t0)).toBe(true);
    expect(cartSignalRateOk("rate-test", t0)).toBe(false);
    expect(cartSignalRateOk("rate-test", t0 + 61_000)).toBe(true);
  });
});

describe("planCartAlarms", () => {
  const plan = (carts: ShopPulseCart[], orders: CustomerOrder[] = [], s = ON) => planCartAlarms(carts, orders, s, NOW);

  it("Alarm ab Schwelle nach der Wartezeit, nicht darunter, nicht zu früh, nicht zu alt", () => {
    expect(plan([cart()]).alarm).toHaveLength(1);
    expect(plan([cart({ netTotal: 999 })]).alarm).toHaveLength(0);
    expect(plan([cart({ cartUpdatedAt: hoursAgo(10) })]).alarm).toHaveLength(0);
    expect(plan([cart({ cartUpdatedAt: hoursAgo(8 * 24) })]).alarm).toHaveLength(0);
    expect(plan([cart({ cartUpdatedAt: hoursAgo(10) })], [], { ...ON, waitHours: 6 }).alarm).toHaveLength(1);
  });

  it("je Kunde höchstens ein Alarm pro Woche, nie zweimal für denselben Warenkorb", () => {
    expect(plan([cart({ alarmedAt: hoursAgo(3 * 24), cartUpdatedAt: hoursAgo(30) })]).alarm).toHaveLength(0);
    expect(plan([cart({ alarmedAt: hoursAgo(8 * 24), cartUpdatedAt: hoursAgo(9 * 24) })]).alarm).toHaveLength(0);
    expect(plan([cart({ alarmedAt: hoursAgo(8 * 24), cartUpdatedAt: hoursAgo(30) })]).alarm).toHaveLength(1);
  });

  it("bestellt seitdem (Spiegel): kein Alarm, Bestellung eintragen", () => {
    const p = plan([cart()], [{ customerNumber: "20001", orderNumber: "MO1", createdAt: new Date(hoursAgo(20)) }]);
    expect(p.alarm).toHaveLength(0);
    expect(p.ordered).toEqual([{ id: "c1", orderNumber: "MO1", orderedAt: new Date(hoursAgo(20)) }]);
    // ältere Bestellung zählt nicht
    expect(plan([cart()], [{ customerNumber: "20001", orderNumber: "MO0", createdAt: new Date(hoursAgo(40)) }]).alarm).toHaveLength(1);
    // vom Plugin als bestellt gemeldet
    expect(plan([cart({ orderedAt: hoursAgo(5), orderNumber: "MO2" })]).alarm).toHaveLength(0);
  });

  it("Erfolg: Bestellung binnen 14 Tagen nach dem Alarm (Spiegel oder Plugin)", () => {
    const alarmed = cart({ alarmedAt: hoursAgo(48), cartUpdatedAt: hoursAgo(80) });
    expect(plan([alarmed], [{ customerNumber: "20001", orderNumber: "MO9", createdAt: new Date(hoursAgo(5)) }]).won).toEqual([
      { cart: alarmed, orderNumber: "MO9", orderedAt: new Date(hoursAgo(5)) },
    ]);
    const late = cart({ alarmedAt: hoursAgo(20 * 24), cartUpdatedAt: hoursAgo(21 * 24) });
    expect(plan([late], [{ customerNumber: "20001", orderNumber: "MO9", createdAt: new Date(hoursAgo(1)) }]).won).toHaveLength(0);
    expect(plan([cart({ alarmedAt: hoursAgo(48), orderedAt: hoursAgo(2), orderNumber: "MO3" })]).won[0].orderNumber).toBe("MO3");
  });

  it("Stand für die Seite", () => {
    expect(cartState(cart(), ON)).toBe("waiting");
    expect(cartState(cart({ netTotal: 10 }), ON)).toBe("below");
    expect(cartState(cart({ alarmedAt: hoursAgo(5) }), ON)).toBe("alarmed");
    expect(cartState(cart({ alarmedAt: hoursAgo(5), orderedAt: hoursAgo(1) }), ON)).toBe("won");
    expect(cartState(cart({ orderedAt: hoursAgo(1) }), ON)).toBe("ordered");
  });
});

describe("Empfänger und Einstellungen", () => {
  const reps = new Map([["20001", { name: "Max Außendienst", email: "max@meta-online.com" }]]);

  it("Außendienst laut Zuordnung, sonst Ersatz-Empfänger, sonst Oliver", () => {
    expect(recipientFor(" 20001 ", reps, ON)).toEqual({ source: "rep", name: "Max Außendienst", email: "max@meta-online.com" });
    expect(recipientFor("30000", reps, { fallbackEmail: "innendienst@meta-online.com", fallbackName: "" })).toEqual({ source: "fallback", name: "innendienst@meta-online.com", email: "innendienst@meta-online.com" });
    expect(recipientFor("30000", reps, ON)).toEqual({ source: "oliver", name: "Oliver", email: null });
  });

  it("Standard: aus, 1.000 € netto, 24 Stunden", () => {
    expect(normalizeShopPulseCartSettings(undefined)).toEqual({ enabled: false, thresholdNet: 1000, waitHours: 24, fallbackEmail: "", fallbackName: "" });
    expect(normalizeShopPulseCartSettings({ enabled: "ja", waitHours: 0 }).waitHours).toBe(1);
  });

  it("Teams-Karte erwähnt den Empfänger", () => {
    const card = buildCartAlarmCard(cart(), { source: "rep", name: "Max Außendienst", email: "max@meta-online.com" }, "https://metaorder.example/admin/shop-puls?tab=cart");
    const content = (card.attachments as any[])[0].content;
    expect(content.msteams.entities[0]).toEqual({ type: "mention", text: "<at>Max Außendienst</at>", mentioned: { id: "max@meta-online.com", name: "Max Außendienst" } });
    const text = JSON.stringify(content.body);
    expect(text).toContain("Muster GmbH");
    expect(text).toContain("Staffelpreis");
    expect(text).toContain("nicht automatisch angeschrieben");
  });
});

describe("runCartAlarm", () => {
  function fakeDeps(over: Partial<CartAlarmDeps> = {}) {
    const calls = { mails: [] as string[], teams: [] as unknown[], notes: [] as Array<string | null>, alarmed: [] as Array<{ id: string; mailed: boolean; source: string }>, ordered: [] as string[], actions: [] as any[] };
    const deps: CartAlarmDeps = {
      settings: async () => ON,
      listCarts: async () => [cart(), cart({ id: "c2", customerNumber: "30000", company: "Ohne Zuordnung AG" })],
      purge: async () => undefined,
      loadOrders: async () => [],
      salesReps: async () => new Map([["20001", { name: "Max", email: "max@meta-online.com" }]]),
      markAlarmed: async (id, _at, r, mailed) => {
        calls.alarmed.push({ id, mailed, source: r.source });
      },
      markOrdered: async (id) => {
        calls.ordered.push(id);
      },
      sendMail: async (_t, to) => {
        calls.mails.push(to);
      },
      enqueueTeams: async (_t, m) => {
        calls.teams.push(m);
      },
      notify: async (_t, email) => {
        calls.notes.push(email);
      },
      insertActions: async (_t, c) => {
        calls.actions.push(...c);
      },
      ...over,
    };
    return { deps, calls };
  }

  it("aus: nichts tun", async () => {
    const { deps, calls } = fakeDeps({ settings: async () => DEFAULT_SHOP_PULSE_CART_SETTINGS });
    expect(await runCartAlarm(deps, null, NOW, { silent: false, pageUrl: null })).toBeNull();
    expect(calls.teams).toHaveLength(0);
  });

  it("Alarm per E-Mail an den Außendienst, ohne Zuordnung an Oliver (Teams/Glocke)", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runCartAlarm(deps, "t1", NOW, { silent: false, pageUrl: "https://x/admin/shop-puls?tab=cart" });
    expect(r).toEqual({ alarms: 2, mailed: 1, ordered: 0, won: 0 });
    expect(calls.mails).toEqual(["max@meta-online.com"]);
    expect(calls.teams).toHaveLength(2);
    expect(calls.notes).toEqual(["max@meta-online.com", null]);
    expect(calls.alarmed).toEqual([
      { id: "c1", mailed: true, source: "rep" },
      { id: "c2", mailed: false, source: "oliver" },
    ]);
  });

  it("E-Mail nicht eingerichtet: trotzdem Teams und Glocke", async () => {
    const { deps, calls } = fakeDeps({
      sendMail: async () => {
        throw new Error("Outbound email disabled");
      },
    });
    const r = await runCartAlarm(deps, "t1", NOW, { silent: false, pageUrl: null });
    expect(r?.mailed).toBe(0);
    expect(calls.alarmed[0]).toEqual({ id: "c1", mailed: false, source: "rep" });
    expect(calls.teams).toHaveLength(2);
  });

  it("Lernwoche: keine Alarme, aber Bestellungen und Erfolge werden erfasst", async () => {
    const alarmed = cart({ id: "c3", customerNumber: "40000", alarmedAt: hoursAgo(48), alarmRecipient: "Max <max@meta-online.com>", cartUpdatedAt: hoursAgo(80) });
    const { deps, calls } = fakeDeps({
      listCarts: async () => [cart(), alarmed],
      loadOrders: async () => [
        { customerNumber: "20001", orderNumber: "MO5", createdAt: new Date(hoursAgo(2)) },
        { customerNumber: "40000", orderNumber: "MO6", createdAt: new Date(hoursAgo(3)) },
      ],
    });
    const r = await runCartAlarm(deps, "t1", NOW, { silent: true, pageUrl: null });
    expect(r).toEqual({ alarms: 0, mailed: 0, ordered: 2, won: 1 });
    expect(calls.teams).toHaveLength(0);
    expect(calls.actions[0]).toMatchObject({ kind: "cartAlarmWon", source: "cartAlarm", sourceKey: `cartAlarm:40000:${alarmed.alarmedAt}`, scope: { type: "products", values: ["SW1", "SW2"] } });
    expect(calls.actions[0].title).toContain("MO6");
  });
});
