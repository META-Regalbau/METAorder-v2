/**
 * Verteilpostfächer (Modus „route“, z. B. digital-service@ und digitaler-vertrieb@): Produkt- und
 * Angebotsanfragen an das Shop-Postfach weiterleiten, alles andere liegen lassen.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_EMAIL_INTAKE_SETTINGS,
  EMAIL_INTAKE_CATEGORIES,
  emailIntakeSettingsSchema,
  isInquiryTargetRouteMailbox,
  isMetaorderForwardedMail,
  isMetaorderRoutedMail,
  METAORDER_ROUTE_MARKER,
  normalizeEmailIntakeSettings,
} from "../../shared/emailIntake";
import { interpretRouteResponse, routeInboundEmail, type EmailRouteResult } from "../../server/commercial/emailIntakeRouting";
import { planEmailIntake } from "../../server/commercial/emailIntakeOutcome";
import { ingestCommercialEmailUpload } from "../../server/commercial/commercialEmailUploadIngest";
import { workflowConfigFromSettings } from "../../server/commercial/emailIntakeSettings";

const noAiStorage = { getSetting: async () => undefined } as never;

const routeSettings = {
  forwardOtherTo: "",
  ticketOnFailure: true,
  ticketOnShopwareError: true,
  ticketOnMarginRed: true,
  inquiryForwardTo: "shop@meta-online.com",
  inquiryMinConfidence: 0.6,
  mailboxes: [
    { address: "shop@meta-online.com", mode: "order" as const, enabled: true },
    { address: "digital-service@meta-online.com", mode: "route" as const, enabled: true },
    { address: "digitaler-vertrieb@meta-online.com", mode: "route" as const, enabled: true },
  ],
};

function planRoute(route: EmailRouteResult | null, settings: Partial<typeof routeSettings> = {}) {
  return planEmailIntake({
    mailboxMode: "route",
    mailboxAddress: "digital-service@meta-online.com",
    route,
    customerEmail: "einkauf@kunde.de",
    skippedAsOther: false,
    triage: null,
    outcomes: [],
    existingDraftKind: null,
    settings: { ...routeSettings, ...settings },
  });
}

function eml(lines: string[]): Buffer {
  return Buffer.from(lines.join("\r\n"));
}

describe("Verteilpostfach: KI-Antwort", () => {
  it("liest Kategorie, Sicherheit in Prozent und Begründung", () => {
    const r = interpretRouteResponse('{"category":"Quote_Request","confidence":"85%","reason":"Kunde will Preise für Fachbodenregale"}');
    assert.deepEqual(r, { kind: "quote_request", confidence: 0.85, reason: "Kunde will Preise für Fachbodenregale", source: "llm" });
  });

  it("verwirft unbekannte Kategorien", () => {
    assert.equal(interpretRouteResponse('{"category":"invoice","confidence":0.9}'), null);
  });

  it("Abwesenheitsnotiz ohne KI-Aufruf: bleibt liegen", async () => {
    let calls = 0;
    const r = await routeInboundEmail(
      noAiStorage,
      { subject: "Automatische Antwort: Anfrage", body: "Bin nicht da", from: "a@b.de", attachmentNames: [] },
      async () => {
        calls++;
        return '{"category":"quote_request","confidence":0.9}';
      },
    );
    assert.equal(r.kind, "other");
    assert.equal(r.source, "heuristic");
    assert.equal(calls, 0);
  });

  it("ohne KI oder bei KI-Fehler: bleibt liegen (Sicherheit 0)", async () => {
    const input = { subject: "Regalanfrage", body: "Was kostet ein Fachbodenregal?", from: "k@kunde.de", attachmentNames: [] };
    const noAi = await routeInboundEmail(noAiStorage, input);
    assert.equal(noAi.kind, "other");
    assert.equal(noAi.source, "fallback");
    const broken = await routeInboundEmail(noAiStorage, input, async () => {
      throw new Error("timeout");
    });
    assert.equal(broken.kind, "other");
    assert.equal(broken.confidence, 0);
  });
});

describe("Verteilpostfach: Entscheidung je Mail", () => {
  it("Angebotsanfrage → an shop@ weiterleiten, nicht verschieben, Hinweis mit Kundenadresse", () => {
    const plan = planRoute({ kind: "quote_request", confidence: 0.82, reason: "Kunde bittet um ein Angebot", source: "llm" });
    assert.equal(plan.outcome, "routed");
    assert.equal(plan.move, false);
    assert.deepEqual(plan.categories, [EMAIL_INTAKE_CATEGORIES.routed]);
    assert.equal(plan.forward?.to, "shop@meta-online.com");
    assert.ok(plan.forward?.comment.startsWith(METAORDER_ROUTE_MARKER));
    assert.match(plan.forward?.comment ?? "", /digital-service@meta-online\.com/);
    assert.match(plan.forward?.comment ?? "", /Angebotsanfrage, Sicherheit 82 %/);
    assert.match(plan.forward?.comment ?? "", /einkauf@kunde\.de/);
    // Der Hinweis darf im Shop-Postfach nicht als „Sonstiges“-Weiterleitung gelten (die würde ignoriert)
    assert.equal(isMetaorderForwardedMail(plan.forward?.comment), false);
    assert.equal(isMetaorderRoutedMail(plan.forward?.comment), true);
    assert.equal(plan.problems.length, 0);
  });

  it("Produktanfrage und Bestellung werden ebenfalls weitergeleitet", () => {
    assert.equal(planRoute({ kind: "product_question", confidence: 0.7, reason: "", source: "llm" }).outcome, "routed");
    assert.equal(planRoute({ kind: "order", confidence: 0.95, reason: "", source: "llm" }).outcome, "routed");
  });

  it("keine Anfrage oder zu unsicher → bleibt liegen mit „geprüft“", () => {
    for (const route of [
      { kind: "other" as const, confidence: 0.9, reason: "Agentur bietet SEO an", source: "llm" as const },
      { kind: "quote_request" as const, confidence: 0.55, reason: "", source: "llm" as const },
      null,
    ]) {
      const plan = planRoute(route);
      assert.equal(plan.outcome, "kept");
      assert.equal(plan.forward, null);
      assert.equal(plan.move, false);
      assert.deepEqual(plan.categories, [EMAIL_INTAKE_CATEGORIES.checked]);
    }
  });

  it("ohne Ziel oder mit einem Verteilpostfach als Ziel: nicht weiterleiten", () => {
    const route = { kind: "quote_request" as const, confidence: 0.9, reason: "", source: "llm" as const };
    assert.equal(planRoute(route, { inquiryForwardTo: "" }).forward, null);
    assert.equal(planRoute(route, { inquiryForwardTo: "digitaler-vertrieb@meta-online.com" }).forward, null);
  });

  it("vom Filter aussortiert: ignoriert, bleibt im Posteingang", () => {
    const plan = planEmailIntake({
      mailboxMode: "route",
      ignoredByFilter: { rule: "bulk", reason: "Newsletter" },
      skippedAsOther: false,
      triage: null,
      outcomes: [],
      existingDraftKind: null,
      settings: routeSettings,
    });
    assert.equal(plan.outcome, "ignored");
    assert.equal(plan.move, false);
    assert.equal(plan.forward, null);
  });
});

describe("Verteilpostfach: Mail lesen", () => {
  it("ordnet nur ein, legt keinen Entwurf an und gibt der KI Text und Anhangsnamen", async () => {
    let prompt = "";
    const result = await ingestCommercialEmailUpload({
      storage: noAiStorage,
      tenantId: "t1",
      fileBuffer: eml([
        "From: Max Kunde <einkauf@kunde.de>",
        "To: digital-service@meta-online.com",
        "Message-ID: <anfrage-1@kunde.de>",
        "Subject: Anfrage Fachbodenregale",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Guten Tag, bitte senden Sie uns ein Angebot über 10 Fachbodenregale 2000 x 1000 x 500 mm.",
      ]),
      fileName: "mail.eml",
      createdByUserId: "n8n",
      ocrEnabled: false,
      skipMetaorderForwards: true,
      route: {
        llm: async (_system, user) => {
          prompt = user;
          return '{"category":"quote_request","confidence":0.9,"reason":"Angebot für Regale"}';
        },
      },
    });
    assert.equal(result.route?.kind, "quote_request");
    assert.equal(result.outcomes.length, 0);
    assert.equal(result.results.length, 0);
    assert.match(prompt, /10 Fachbodenregale/);
    assert.equal(result.envelope.customerEmail, "einkauf@kunde.de");
  });

  it("schon von METAorder weitergeleitete Anfrage: in einem Verteilpostfach ignoriert, ohne KI", async () => {
    let calls = 0;
    const result = await ingestCommercialEmailUpload({
      storage: noAiStorage,
      tenantId: "t1",
      fileBuffer: eml([
        "From: Digital-Service <digital-service@meta-online.com>",
        "To: digitaler-vertrieb@meta-online.com",
        "Message-ID: <route-1@meta-online.com>",
        "Subject: WG: Anfrage",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `${METAORDER_ROUTE_MARKER} im Postfach digital-service@meta-online.com (Einordnung: Angebotsanfrage, Sicherheit 90 %).`,
      ]),
      fileName: "mail.eml",
      createdByUserId: "n8n",
      ocrEnabled: false,
      skipMetaorderForwards: true,
      route: {
        llm: async () => {
          calls++;
          return '{"category":"quote_request","confidence":0.9}';
        },
      },
    });
    assert.equal(result.ignoredByFilter?.rule, "metaorder_forward");
    assert.equal(calls, 0);
  });

  it("im Shop-Postfach wird die weitergeleitete Anfrage normal geprüft (nicht als intern aussortiert)", async () => {
    let triageCalls = 0;
    const result = await ingestCommercialEmailUpload({
      storage: noAiStorage,
      tenantId: "t1",
      fileBuffer: eml([
        "From: Digital-Service <digital-service@meta-online.com>",
        "To: shop@meta-online.com",
        "Message-ID: <route-2@meta-online.com>",
        "Subject: WG: Anfrage Fachbodenregale",
        "Content-Type: text/plain; charset=utf-8",
        "",
        `${METAORDER_ROUTE_MARKER} im Postfach digital-service@meta-online.com (Einordnung: Angebotsanfrage, Sicherheit 90 %). Antworten bitte direkt an den Kunden: einkauf@kunde.de.`,
        "",
        "________________________________",
        "Von: Max Kunde <einkauf@kunde.de>",
        "Gesendet: Mittwoch, 22. Oktober 2026 09:12",
        "An: digital-service@meta-online.com",
        "Betreff: Anfrage Fachbodenregale",
        "",
        "Guten Tag, bitte senden Sie uns ein Angebot über 10 Fachbodenregale.",
      ]),
      fileName: "mail.eml",
      createdByUserId: "n8n",
      ocrEnabled: false,
      skipMetaorderForwards: true,
      filter: {
        settings: { ...DEFAULT_EMAIL_INTAKE_SETTINGS.filter, internalDomains: ["meta-online.com"] },
        internalDomains: ["meta-online.com"],
      },
      // „Sonstiges“ mit hoher Sicherheit beendet die Verarbeitung vor der Entwurfs-Pipeline
      triage: {
        otherMinConfidence: 0.7,
        llm: async () => {
          triageCalls++;
          return '{"category":"other","otherType":"general","confidence":0.99}';
        },
      },
    });
    assert.equal(result.ignoredByFilter, null);
    assert.equal(triageCalls, 1);
    assert.equal(result.envelope.customerEmail, "einkauf@kunde.de");
    assert.equal(result.envelope.internalForward, true);
  });
});

describe("Verteilpostfach: Einstellungen", () => {
  it("ältere Einstellungen bekommen die neuen Felder mit Standardwerten", () => {
    const s = normalizeEmailIntakeSettings({ enabled: true, mailboxes: [{ address: "shop@meta-online.com", mode: "order", enabled: true }] });
    assert.equal(s.inquiryForwardTo, "");
    assert.equal(s.inquiryMinConfidence, 0.6);
  });

  it("Modus „route“ ist gültig; ein Verteilpostfach als Ziel wird erkannt", () => {
    const parsed = emailIntakeSettingsSchema.safeParse({ ...DEFAULT_EMAIL_INTAKE_SETTINGS, ...routeSettings });
    assert.equal(parsed.success, true);
    assert.equal(isInquiryTargetRouteMailbox(routeSettings), false);
    assert.equal(isInquiryTargetRouteMailbox({ ...routeSettings, inquiryForwardTo: "Digital-Service@meta-online.com" }), true);
  });

  it("n8n bekommt den Modus und schließt die neuen Kategorien beim Abruf aus", () => {
    const cfg = workflowConfigFromSettings({ ...DEFAULT_EMAIL_INTAKE_SETTINGS, ...routeSettings, enabled: true }, new Date("2026-10-22T10:00:00Z"));
    const route = cfg.mailboxes.find((m) => m.mailbox === "digital-service@meta-online.com");
    assert.equal(route?.mode, "route");
    assert.match(route?.messageFilter ?? "", /METAorder: weitergeleitet/);
    assert.match(route?.messageFilter ?? "", /METAorder: geprüft/);
  });

  it("Vorlage: Zielordner nur für Bestellpostfächer", () => {
    const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, "../../n8n-workflows/m365-to-metaorder.json"), "utf8"));
    const node = workflow.nodes.find((n: { name: string }) => n.name === "Bestellpostfach?");
    assert.match(JSON.stringify(node.parameters), /\$json\.mode === 'order'/);
  });
});
