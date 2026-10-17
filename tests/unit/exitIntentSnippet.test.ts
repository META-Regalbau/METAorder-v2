import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";
import {
  EXIT_INTENT_CODE,
  EXIT_INTENT_DISCOUNT_PERCENT,
  EXIT_INTENT_IDS,
  exitIntentPromotionPayload,
  exitIntentRulePayload,
} from "../../server/shopContent/exitIntentPromotion";

// Das Storefront-Skript ist reines Browser-JS ohne Module; ohne window liefert es nur die reinen Helfer.
const source = readFileSync(path.resolve(import.meta.dirname, "../../shopware/storefront-snippets/exit-intent.js"), "utf8");
const context: Record<string, any> = {};
vm.runInNewContext(source, context);
const { isExcludedPath, isValidEmail, allowedByState, newsletterSucceeded, config } = context.MetaExitIntent as {
  isExcludedPath: (path: string) => boolean;
  isValidEmail: (value: string) => boolean;
  allowedByState: (state: unknown, now: number) => boolean;
  newsletterSucceeded: (payload: unknown) => boolean;
  config: { code: string; discountLabel: string; snoozeDays: number; salesChannelIds: string[] };
};
const DAY = 24 * 60 * 60 * 1000;

describe("Exit-Intent-Modal (Storefront-Skript)", () => {
  it("zeigt denselben Code und Rabatt wie die Aktion", () => {
    expect(config.code).toBe(EXIT_INTENT_CODE);
    expect(config.discountLabel).toBe(`${EXIT_INTENT_DISCOUNT_PERCENT} %`);
  });

  it("erscheint nicht im Checkout, im Konto und auf Pflichtseiten", () => {
    for (const p of ["/checkout/cart", "/checkout/confirm", "/account", "/account/order", "/b2b/offer", "/newsletter-subscribe", "/datenschutz", "/impressum"]) {
      expect(isExcludedPath(p), p).toBe(true);
    }
    for (const p of ["/", "/fachbodenregale/", "/regal-schnellkonfigurator", "/search", "/accountmanager-regal"]) {
      expect(isExcludedPath(p), p).toBe(false);
    }
  });

  it("prüft E-Mail-Adressen grob", () => {
    expect(isValidEmail(" einkauf@firma.de ")).toBe(true);
    expect(isValidEmail("einkauf@firma")).toBe(false);
    expect(isValidEmail("einkauf firma.de")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("ruht nach „Nein danke“ einige Tage und nach der Anmeldung für immer", () => {
    const now = 1_000 * DAY;
    expect(allowedByState(null, now)).toBe(true);
    expect(allowedByState({ status: "dismissed", at: now - DAY }, now)).toBe(false);
    expect(allowedByState({ status: "dismissed", at: now - config.snoozeDays * DAY }, now)).toBe(true);
    expect(allowedByState({ status: "subscribed", at: now - 365 * DAY }, now)).toBe(false);
  });

  it("wertet die Antwort des Newsletter-Formulars aus", () => {
    expect(newsletterSucceeded([{ type: "success", alert: "…" }])).toBe(true);
    expect(newsletterSucceeded([{ type: "info", alert: "…" }])).toBe(true);
    expect(newsletterSucceeded([{ type: "danger", alert: "…" }])).toBe(false);
    expect(newsletterSucceeded([])).toBe(false);
    expect(newsletterSucceeded(null)).toBe(false);
  });
});

describe("Aktion Newsletter-Willkommensrabatt", () => {
  it("gibt 10 % auf den Warenkorb, einmal pro Kunde, nur im Kanal und nur ohne frühere Bestellung", () => {
    const p = exitIntentPromotionPayload("channel-1");
    expect(p.code).toBe(EXIT_INTENT_CODE);
    expect(p.useCodes).toBe(true);
    expect(p.maxRedemptionsPerCustomer).toBe(1);
    expect(p.preventCombination).toBe(true);
    expect(p.salesChannels).toEqual([{ id: EXIT_INTENT_IDS.salesChannel, salesChannelId: "channel-1", priority: 1 }]);
    expect(p.personaRules).toEqual([{ id: EXIT_INTENT_IDS.rule }]);
    expect(p.discounts[0]).toMatchObject({ scope: "cart", type: "percentage", value: 10 });

    const rule = exitIntentRulePayload();
    const count = rule.conditions.find((c) => c.type === "customerOrderCount");
    expect(count?.value).toEqual({ operator: "=", count: 0 });
    expect(count?.parentId).toBe(EXIT_INTENT_IDS.ruleAnd);
  });
});
