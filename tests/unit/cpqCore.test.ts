import { describe, it } from "vitest";
import {
  buildBlockedReviewTransfer,
  cpqSubmitTransferRequestSchema,
  cpqValidateRequestSchema,
  cpqValidationContextSchema,
  decideAdapterTransfer,
  deriveReviewDecision,
  evaluateCpqRules,
  type CpqConstraintRule,
} from "../../server/cpq-core";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Aus scripts/testCpqCore.ts uebernommen. Submit- und Transfer-Entscheidung pruefen die echten
// Funktionen aus server/cpq-core/submitDecision.ts (frueher nachgebaute Kopien im Test); wie die
// Routen sie zusammensetzen, prueft tests/unit/cpqCoreRoutes.test.ts.
describe("CpqCore", () => {
  const rules: CpqConstraintRule[] = [
    {
      ruleId: "GEO-01",
      category: "geometry",
      severity: "hard",
      messageDe: "Boden tiefer als Rahmen",
      isActive: true,
      sortOrder: 10,
    },
    {
      ruleId: "GEO-02",
      category: "geometry",
      severity: "hard",
      messageDe: "Bodenbreite muss Rahmenbreite entsprechen",
      isActive: true,
      sortOrder: 20,
    },
    {
      ruleId: "GEO-06",
      category: "geometry",
      severity: "hard",
      messageDe: "Verankerung ist erforderlich",
      isActive: true,
      sortOrder: 30,
    },
    {
      ruleId: "OBF-03",
      category: "oberflaeche",
      severity: "trigger",
      messageDe: "Sonderfarbe aktiv",
      isActive: true,
      sortOrder: 40,
    },
    {
      ruleId: "BODEN-03",
      category: "boden",
      severity: "default",
      messageDe: "Default fuer Werkstatt: Stahl verzinkt",
      isActive: true,
      sortOrder: 50,
    },
  ];

  const classA = cpqValidateRequestSchema.parse({
    context: { customerGroup: "b2c" },
    configuration: {
      frame: {
        heightMm: 2500,
        depthMm: 800,
        widthMm: 1000,
        anchoringIncluded: true,
      },
      shelves: [
        {
          material: "stahl_verzinkt",
          maxFachlastKg: 180,
          depthMm: 800,
          widthMm: 1000,
          count: 4,
        },
      ],
      accessories: [],
      application: "werkstatt",
      leadTimeDays: 3,
    },
    rules,
  });

  const classB = cpqValidateRequestSchema.parse({
    ...classA,
    configuration: {
      ...classA.configuration,
      leadTimeDays: 10,
    },
  });

  const classC = cpqValidateRequestSchema.parse({
    ...classA,
    configuration: {
      ...classA.configuration,
      ralColor: "3001",
    },
  });

  const resultA = evaluateCpqRules(classA);
  const resultB = evaluateCpqRules(classB);
  const resultC = evaluateCpqRules(classC);

  it("Klassifizierung A/B/C mit Disclaimer, Defaults und Fachlast je Boden", () => {
    assert(resultA.valid, "Klasse-A-Konfiguration sollte gueltig sein");
    assert(resultB.valid, "Klasse-B-Konfiguration sollte gueltig sein");
    assert(resultC.valid, "Klasse-C-Konfiguration sollte gueltig sein");
    assert(resultA.classification === "A", "Basis-Konfiguration muss Klasse A sein");
    assert(resultB.classification === "B", "10 Tage Lead Time muss Klasse B liefern");
    assert(resultC.classification === "C", "Sonderfarbe muss Klasse C liefern");
    assert(resultC.disclaimers.length >= 1, "Klasse C muss Disclaimer liefern");
    assert(resultC.defaultsApplied.length >= 1, "Default-Regel muss als angewendet markiert sein");
    assert(resultC.computed.effectiveFachlasten.length === 4, "Fachlast muss je Bodeninstanz berechnet werden");
  });

  it("Submit-Status: A/B akzeptiert, C zur Prüfung", () => {
    const submitA = deriveReviewDecision(resultA.classification);
    const submitB = deriveReviewDecision(resultB.classification);
    const submitC = deriveReviewDecision(resultC.classification);

    assert(submitA.status === "accepted" && !submitA.requiresReview, "Klasse A muss akzeptiert werden");
    assert(submitB.status === "accepted" && !submitB.requiresReview, "Klasse B muss akzeptiert werden");
    assert(submitC.status === "review_required" && submitC.requiresReview, "Klasse C muss review_required sein");
    assert(submitC.reviewStatus === "pending", "Klasse C muss reviewStatus=pending setzen");
  });

  it("Transfer: A/B vorbereitet, C blockiert mit Hinweis, ohne Warenkorb übersprungen", () => {
    const transferA = decideAdapterTransfer(deriveReviewDecision(resultA.classification), 1);
    const transferB = decideAdapterTransfer(deriveReviewDecision(resultB.classification), 1);
    const transferC = decideAdapterTransfer(deriveReviewDecision(resultC.classification), 1);
    assert(transferA === "prepared", "Klasse A muss Transfer vorbereiten");
    assert(transferB === "prepared", "Klasse B muss Transfer vorbereiten");
    assert(transferC === "blocked", "Klasse C muss Transfer blockieren");
    assert(decideAdapterTransfer(deriveReviewDecision(resultA.classification), 0) === "skipped", "Ohne Cart-Items muss Transfer uebersprungen werden");
    assert(
      buildBlockedReviewTransfer().reviewHint.includes("Checkout bleibt gesperrt"),
      "Klasse C muss einen klaren Review-Hinweis fuer den blockierten Handover liefern"
    );
  });

  it("Kundengruppen-Kontext wird robust normalisiert", () => {
    const contextB2c = cpqValidationContextSchema.parse({ customerGroup: "b2c" });
    const contextB2bAlias = cpqValidationContextSchema.parse({ customerGroup: "b2b" });
    const contextB2bIndustrial = cpqValidationContextSchema.parse({ customerGroup: "B2B Industrie" });
    assert(contextB2c.customerGroup === "b2c", "B2C-Kontext muss stabil bleiben");
    assert(contextB2bAlias.customerGroup === "b2b_standard", "B2B-Alias muss robust zu b2b_standard normalisiert werden");
    assert(contextB2bIndustrial.customerGroup === "b2b_industrie", "B2B-Industrie-Kontext muss robust normalisiert werden");
  });

  it("Adapter-Payload: cart_items akzeptiert, ohne product_id abgelehnt", () => {
    const transferPayload = cpqSubmitTransferRequestSchema.parse({
      ...classA,
      systemId: "shopware-pdp",
      cartTransfer: {
        cart_items: [{ product_id: "pdp-product", product_number: "SKU-1", quantity: 2 }],
        customer_id: "customer-1",
        sales_channel_id: "channel-1",
        create_offer: true,
      },
    });
    assert(transferPayload.cartTransfer?.cart_items.length === 1, "Adapter-Payload muss cart_items korrekt akzeptieren");
    assert(
      cpqSubmitTransferRequestSchema.safeParse({
        ...classA,
        systemId: "shopware-pdp",
        cartTransfer: { cart_items: [{ product_id: "", quantity: 1 }] },
      }).success === false,
      "Adapter-Payload ohne product_id muss abgefangen werden"
    );
  });
});
