/**
 * Teams-Info zu Problem-Tickets aus dem E-Mail-Eingang (Entscheidung 11.10.2026): Kanal-Post mit
 * @Erwähnung des Zuständigen, ohne Zuständigen ohne Erwähnung; n8n schickt die fertige Karte.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildIntakeTeamsBlock, buildTeamsTicketMessage } from "../../server/commercial/emailIntakeTeams";
import { isAllowedTeamsWebhookUrl, normalizeEmailIntakeSettings, type EmailIntakeTicketRef } from "../../shared/emailIntake";

const WEBHOOK = "https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=xyz";

const ticket: EmailIntakeTicketRef = {
  ticketNumber: "T-1052",
  ticketId: "t-uuid",
  reason: "margin_red",
  assignedTo: "isabell",
  assignedToEmail: "inoecker@meta-online.com",
  isNew: true,
  subject: "Bestellung <BE730134> *dringend*",
  customer: "Heinrich & Schleyer GmbH",
  draftPath: "/order-drafts?draftId=d-uuid",
};

const card = (msg: Record<string, any>) => msg.attachments[0].content;
const factsOf = (c: any) => Object.fromEntries(c.body.find((b: any) => b.type === "FactSet").facts.map((f: any) => [f.title, f.value]));

describe("Teams-Karte", () => {
  it("@Erwähnung über die E-Mail, Links zu Ticket und Entwurf", () => {
    const c = card(buildTeamsTicketMessage(ticket, "https://metaorder.example"));
    assert.equal(c.type, "AdaptiveCard");
    assert.match(c.body[0].text, /DB zu niedrig/);
    assert.equal(c.body[1].text, "<at>isabell</at>, bitte kümmere dich darum.");
    assert.deepEqual(c.msteams.entities[0].mentioned, { id: "inoecker@meta-online.com", name: "isabell" });
    const facts = factsOf(c);
    assert.equal(facts.Ticket, "T-1052");
    assert.equal(facts.Kunde, "Heinrich & Schleyer GmbH");
    // Text aus der Mail kann keine Erwähnung oder Formatierung einschleusen
    assert.ok(!/[<>*]/.test(facts.Betreff), facts.Betreff);
    assert.deepEqual(c.actions.map((a: any) => a.url), [
      "https://metaorder.example/tickets?ticketId=t-uuid",
      "https://metaorder.example/order-drafts?draftId=d-uuid",
    ]);
  });

  it("ohne Zuständigen oder ohne E-Mail: keine Erwähnung, Hinweis im Kanal", () => {
    for (const t of [{ ...ticket, assignedTo: null, assignedToEmail: null }, { ...ticket, assignedToEmail: null }]) {
      const c = card(buildTeamsTicketMessage(t, null));
      assert.equal(c.msteams, undefined);
      assert.ok(c.body.every((b: any) => !String(b.text ?? "").includes("<at>")));
      assert.equal(c.actions, undefined);
    }
    const none = card(buildTeamsTicketMessage({ ...ticket, assignedTo: null, assignedToEmail: null }, null));
    const facts = factsOf(none);
    assert.match(facts["Zuständig"], /niemand ermittelt/);
  });
});

describe("Teams-Block der Antwort", () => {
  it("nur neue Tickets und nur mit Webhook", () => {
    const block = buildIntakeTeamsBlock(WEBHOOK, [ticket, { ...ticket, ticketNumber: "T-1", isNew: false }], null);
    assert.equal(block?.webhookUrl, WEBHOOK);
    assert.equal(block?.messages.length, 1);
    assert.equal(buildIntakeTeamsBlock("", [ticket], null), null);
    assert.equal(buildIntakeTeamsBlock(WEBHOOK, [{ ...ticket, isNew: false }], null), null);
  });
});

describe("Webhook-Adresse", () => {
  it("nur https-Adressen von Microsoft", () => {
    assert.equal(isAllowedTeamsWebhookUrl(WEBHOOK), true);
    assert.equal(isAllowedTeamsWebhookUrl("https://default123.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x"), true);
    assert.equal(isAllowedTeamsWebhookUrl("https://metaonline.webhook.office.com/webhookb2/x"), true);
    assert.equal(isAllowedTeamsWebhookUrl("http://prod-12.westeurope.logic.azure.com/x"), false);
    assert.equal(isAllowedTeamsWebhookUrl("https://evil.example/logic.azure.com"), false);
    assert.equal(isAllowedTeamsWebhookUrl("https://logic.azure.com.evil.example/x"), false);
  });

  it("ungültige Adresse fällt beim Laden auf leer zurück", () => {
    assert.equal(normalizeEmailIntakeSettings({ teamsWebhookUrl: "https://evil.example/x" }).teamsWebhookUrl, "");
    assert.equal(normalizeEmailIntakeSettings({ teamsWebhookUrl: WEBHOOK }).teamsWebhookUrl, WEBHOOK);
    assert.equal(normalizeEmailIntakeSettings({}).teamsWebhookUrl, "");
  });
});

describe("n8n-Workflow", () => {
  it("schickt die Karten parallel an den Webhook", () => {
    const wf = JSON.parse(fs.readFileSync("n8n-workflows/m365-to-metaorder.json", "utf8"));
    const names = wf.nodes.map((n: any) => n.name);
    assert.ok(names.includes("Teams-Nachrichten") && names.includes("An Teams senden"));
    assert.ok(wf.connections["Nächster Schritt"].main[0].some((c: any) => c.node === "Teams-Nachrichten"));
    assert.ok(wf.connections["Meldung auswerten"].main[0].some((c: any) => c.node === "Teams-Nachrichten"));
    const send = wf.nodes.find((n: any) => n.name === "An Teams senden");
    assert.equal(send.onError, "continueRegularOutput");
    assert.equal(send.credentials, undefined);
  });
});
