/**
 * E-Mail-Eingang über n8n: Vorprüfung „Sonstiges“, Entscheidung je Mail, Zuweisungs-Kette,
 * Problem-Tickets und der n8n-Workflow selbst.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_EMAIL_INTAKE_SETTINGS,
  EMAIL_INTAKE_CATEGORIES,
  graphBaseForMailbox,
  normalizeEmailIntakeSettings,
  receivedAfterFor,
} from "../../shared/emailIntake";
import {
  interpretTriageResponse,
  triageByHeuristics,
  triageInboundEmail,
  type EmailTriageInput,
} from "../../server/commercial/emailIntakeTriage";
import { planEmailIntake } from "../../server/commercial/emailIntakeOutcome";
import {
  pickInvolvedColleague,
  pickLastDraftCreator,
  pickLastTicketAssignee,
} from "../../server/commercial/emailIntakeAssignee";
import {
  buildIntakeTicket,
  createIntakeProblemTicket,
  intakeProblemKey,
  type IntakeProblem,
} from "../../server/commercial/emailIntakeTickets";
import { acquireIntakeLock, releaseIntakeLock } from "../../server/commercial/emailIntakeUpload";
import { workflowConfigFromSettings } from "../../server/commercial/emailIntakeSettings";
import { ingestCommercialEmailUpload } from "../../server/commercial/commercialEmailUploadIngest";
import { summarizeN8nWorkflow } from "../../server/integration/n8nConnection";
import type { CommercialAgentProcessOutcome } from "../../server/commercial/commercialAgentOrchestrator";
import { parseEmailBufferAutodetect } from "../../server/email/emailParser";

const baseTriage: EmailTriageInput = {
  subject: "Anfrage",
  body: "Hallo",
  from: "Kunde <kunde@example.com>",
  draftParts: [],
  supportingParts: [],
};

const settingsAll = {
  forwardOtherTo: "info@meta-online.com",
  ticketOnFailure: true,
  ticketOnShopwareError: true,
  ticketOnMarginRed: true,
};

function created(kind: "order" | "offer", id: string, strict?: { allowed: boolean; reasons?: string[]; created?: boolean; error?: string }): CommercialAgentProcessOutcome {
  return {
    status: "created",
    result: {
      draftId: id,
      draftKind: kind,
      intent: kind === "order" ? "purchase_order" : "quote_request",
      intentConfidence: 0.9,
      strict: strict
        ? {
            strictAllowed: strict.allowed,
            strictReasons: strict.reasons ?? [],
            shopwareCreated: strict.created ?? false,
            shopwareError: strict.error,
          }
        : undefined,
    },
  };
}

describe("E-Mail-Eingang: Einstellungen", () => {
  it("füllt fehlende und ungültige Werte mit Standardwerten", () => {
    const s = normalizeEmailIntakeSettings({ maxPerRun: 999, forwardOtherTo: "info@x.de", processSince: "gestern" });
    assert.equal(s.maxPerRun, DEFAULT_EMAIL_INTAKE_SETTINGS.maxPerRun);
    assert.equal(s.forwardOtherTo, "info@x.de");
    assert.equal(s.processSince, "");
    assert.equal(s.enabled, false, "ohne Einstellung bleibt der Eingang aus");
  });

  it("Graph-Basis: eigenes oder freigegebenes Postfach", () => {
    assert.equal(graphBaseForMailbox(""), "https://graph.microsoft.com/v1.0/me");
    assert.equal(graphBaseForMailbox("bestellung@meta.de"), "https://graph.microsoft.com/v1.0/users/bestellung%40meta.de");
  });

  it("Startdatum begrenzt den Abruf, ohne Datum die letzten 2 Tage", () => {
    assert.equal(receivedAfterFor("2026-10-01"), "2026-10-01T00:00:00Z");
    assert.equal(receivedAfterFor("", new Date("2026-10-10T12:00:00Z")), "2026-10-08T12:00:00Z");
    const cfg = workflowConfigFromSettings({ ...DEFAULT_EMAIL_INTAKE_SETTINGS, mailbox: " bestellung@meta.de ", processSince: "2026-10-05" });
    assert.equal(cfg.mailbox, "bestellung@meta.de");
    assert.equal(cfg.receivedAfter, "2026-10-05T00:00:00Z");
  });
});

describe("E-Mail-Eingang: Vorprüfung", () => {
  it("Abwesenheitsnotiz über Kopfzeile und Betreff", () => {
    assert.equal(triageByHeuristics({ ...baseTriage, autoSubmitted: "auto-replied" })?.kind, "other");
    const bySubject = triageByHeuristics({ ...baseTriage, subject: "Automatische Antwort: Bestellung 4711" });
    assert.equal(bySubject?.kind, "other");
    assert.equal(bySubject?.kind === "other" && bySubject.otherType, "auto_reply");
    assert.equal(triageByHeuristics({ ...baseTriage, autoSubmitted: "no" }), null);
  });

  it("Unzustellbarkeitsmeldung ist Sonstiges", () => {
    assert.equal(triageByHeuristics({ ...baseTriage, from: "MAILER-DAEMON@mx.example.com" })?.kind, "other");
  });

  it("Anhang mit Belegtitel Bestellung geht ohne KI in die Pipeline", () => {
    const result = triageByHeuristics({
      ...baseTriage,
      draftParts: [{ filename: "PO.pdf", classification: { kind: "purchase_order", confidence: 0.9, signals: ["title_bestellung"], references: {} } }],
    });
    assert.equal(result?.kind, "commercial");
  });

  it("KI-Antwort wird übersetzt, Unbrauchbares verworfen", () => {
    const other = interpretTriageResponse('{"category":"other","otherType":"invoice","confidence":0.93,"reason":"Rechnung"}');
    assert.deepEqual(other && { kind: other.kind, type: other.kind === "other" && other.otherType }, { kind: "other", type: "invoice" });
    assert.equal(interpretTriageResponse('{"category":"quote_request","confidence":0.8}')?.kind, "commercial");
    assert.equal(interpretTriageResponse('{"category":"vielleicht"}'), null);
  });

  it("im Zweifel Pipeline: KI-Fehler und Müll ergeben commercial", async () => {
    const storage = { getSetting: async () => undefined } as never;
    const failing = await triageInboundEmail(storage, baseTriage, async () => {
      throw new Error("timeout");
    });
    assert.equal(failing.kind, "commercial");
    const garbage = await triageInboundEmail(storage, baseTriage, async () => "kein json");
    assert.equal(garbage.kind, "commercial");
    const other = await triageInboundEmail(storage, baseTriage, async () => '{"category":"other","otherType":"newsletter","confidence":0.9}');
    assert.equal(other.kind, "other");
  });

  it("Ingest legt bei sicherem Sonstiges keinen Entwurf an", async () => {
    const eml = Buffer.from(
      [
        "From: Lieferant <rechnung@lieferant.de>",
        "To: bestellung@meta-online.com",
        "Message-ID: <rechnung-1@lieferant.de>",
        "Subject: Ihre Rechnung 2026-1001",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Anbei Ihre Rechnung, zahlbar bis 20.10.2026.",
      ].join("\r\n"),
    );
    const storage = { getSetting: async () => undefined } as never;
    const result = await ingestCommercialEmailUpload({
      storage,
      tenantId: "t1",
      fileBuffer: eml,
      fileName: "mail.eml",
      createdByUserId: "n8n",
      ocrEnabled: false,
      triage: { otherMinConfidence: 0.7, llm: async () => '{"category":"other","otherType":"invoice","confidence":0.95,"reason":"Rechnung eines Lieferanten"}' },
    });
    assert.equal(result.skippedAsOther, true);
    assert.equal(result.outcomes.length, 0);
    assert.deepEqual(result.envelope.toAddresses, ["bestellung@meta-online.com"]);
    assert.equal(result.messageId, "mail:rechnung-1@lieferant.de");
  });
});

describe("E-Mail-Eingang: Mail lesen", () => {
  it("Mails mit beliebiger erster Kopfzeile werden als .eml gelesen (früher als .msg verschluckt)", async () => {
    for (const first of ["From: A <a@b.de>", "Delivered-To: bestellung@meta-online.com", "Message-ID: <x@y>"]) {
      const parsed = await parseEmailBufferAutodetect(
        Buffer.from(`${first}\r\nFrom: A <a@b.de>\r\nTo: Bestellung <bestellung@meta-online.com>\r\nCc: m.muster@meta-online.com\r\nAuto-Submitted: auto-replied\r\nSubject: Hallo\r\n\r\nText`),
      );
      assert.equal(parsed.subject, "Hallo", first);
      assert.deepEqual(parsed.toAddresses, ["bestellung@meta-online.com"]);
      assert.deepEqual(parsed.ccAddresses, ["m.muster@meta-online.com"]);
      assert.equal(parsed.autoSubmitted, "auto-replied");
    }
  });
});

describe("E-Mail-Eingang: Entscheidung je Mail", () => {
  it("Sonstiges: weiterleiten mit Hinweis, keine Tickets", () => {
    const plan = planEmailIntake({
      skippedAsOther: true,
      triage: { kind: "other", otherType: "invoice", confidence: 0.92, reason: "Rechnung", source: "llm" },
      outcomes: [],
      existingDraftKind: null,
      settings: settingsAll,
    });
    assert.equal(plan.outcome, "other");
    assert.deepEqual(plan.categories, [EMAIL_INTAKE_CATEGORIES.other]);
    assert.equal(plan.forward?.to, "info@meta-online.com");
    assert.match(plan.forward?.comment ?? "", /Rechnung\/Zahlung, Sicherheit 92 %\)\. Begründung: Rechnung\. Sie wurde/);
    assert.equal(plan.problems.length, 0);
  });

  it("Sonstiges ohne Weiterleitungsadresse: nur Kategorie", () => {
    const plan = planEmailIntake({
      skippedAsOther: true,
      triage: { kind: "other", otherType: "spam", confidence: 0.99, reason: "", source: "llm" },
      outcomes: [],
      existingDraftKind: null,
      settings: { ...settingsAll, forwardOtherTo: "" },
    });
    assert.equal(plan.forward, null);
  });

  it("Bestellung + Angebot = mixed; Prüfungsentwurf ohne Ticket", () => {
    const plan = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [
        { filename: "a.pdf", outcome: created("order", "o1", { allowed: false, reasons: ["missing_shopware_customer_id"] }) },
        { filename: "b.pdf", outcome: created("offer", "f1") },
      ],
      existingDraftKind: null,
      settings: settingsAll,
    });
    assert.equal(plan.outcome, "mixed");
    assert.deepEqual(plan.categories, [EMAIL_INTAKE_CATEGORIES.order, EMAIL_INTAKE_CATEGORIES.offer]);
    assert.equal(plan.problems.length, 0, "Entwurf zur Prüfung ist kein Problem-Ticket");
  });

  it("Shopware-Fehler und DB rot ergeben je ein Problem", () => {
    const plan = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [
        { filename: "a.pdf", outcome: created("order", "o1", { allowed: true, created: false, error: "Kanal fehlt" }) },
        { filename: "b.pdf", outcome: created("offer", "f1", { allowed: false, reasons: ["margin_below_minimum", "line_1_not_matched"] }) },
      ],
      existingDraftKind: null,
      settings: settingsAll,
    });
    assert.deepEqual(
      plan.problems.map((p) => [p.reason, p.draft?.id]),
      [
        ["shopware_failed", "o1"],
        ["margin_red", "f1"],
      ],
    );
  });

  it("abgeschaltete Ticket-Arten erzeugen nichts", () => {
    const plan = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [{ filename: "a.pdf", outcome: created("order", "o1", { allowed: false, reasons: ["margin_below_minimum"] }) }],
      existingDraftKind: null,
      settings: { ...settingsAll, ticketOnMarginRed: false },
    });
    assert.equal(plan.problems.length, 0);
  });

  it("alles gescheitert = failed mit einem Ticket; teilweise gescheitert = Ticket trotz Entwurf", () => {
    const allFailed = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [
        { filename: "a.pdf", outcome: { status: "failed", error: "OCR" } },
        { filename: "b.pdf", outcome: { status: "failed", error: "LLM" } },
      ],
      existingDraftKind: null,
      settings: settingsAll,
    });
    assert.equal(allFailed.outcome, "failed");
    assert.deepEqual(allFailed.categories, [EMAIL_INTAKE_CATEGORIES.failed]);
    assert.equal(allFailed.problems.length, 1);
    assert.match(allFailed.problems[0].error ?? "", /a\.pdf: OCR\nb\.pdf: LLM/);

    const partly = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [
        { filename: "a.pdf", outcome: created("order", "o1") },
        { filename: "b.pdf", outcome: { status: "failed", error: "OCR" } },
      ],
      existingDraftKind: null,
      settings: settingsAll,
    });
    assert.equal(partly.outcome, "order");
    assert.deepEqual(partly.problems.map((p) => p.reason), ["processing_failed"]);
  });

  it("Wiederholung: duplicate mit Kategorie des vorhandenen Entwurfs", () => {
    const plan = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [{ filename: "a.pdf", outcome: { status: "skipped", reason: "duplicate" } }],
      existingDraftKind: "offer",
      settings: settingsAll,
    });
    assert.equal(plan.outcome, "duplicate");
    assert.deepEqual(plan.categories, [EMAIL_INTAKE_CATEGORIES.offer]);
    assert.equal(plan.problems.length, 0);
  });

  it("Automatik aus = failed mit verständlichem Grund", () => {
    const plan = planEmailIntake({
      skippedAsOther: false,
      triage: null,
      outcomes: [{ filename: "mail.eml", outcome: { status: "skipped", reason: "agent_disabled" } }],
      existingDraftKind: null,
      settings: settingsAll,
    });
    assert.equal(plan.outcome, "failed");
    assert.match(plan.problems[0].error ?? "", /ausgeschaltet/);
  });
});

describe("E-Mail-Eingang: Zuweisung", () => {
  const users = [
    { id: "u1", username: "inoecker", email: "i.noecker@meta-online.com" },
    { id: "u2", username: "mmuster", email: "m.muster@meta-online.com" },
    { id: "u3", username: "n8n", email: "bestellung@meta-online.com" },
  ];
  const eligible = new Map(users.map((u) => [u.id, u]));

  it("interner Weiterleiter vor An/CC; Eingangspostfach zählt nie", () => {
    const viaForward = pickInvolvedColleague(
      { headerFrom: "Max Muster <m.muster@meta-online.com>", toAddresses: ["bestellung@meta-online.com"], ccAddresses: ["i.noecker@meta-online.com"] },
      users,
      ["bestellung@meta-online.com"],
    );
    assert.equal(viaForward?.id, "u2");
    const viaCc = pickInvolvedColleague(
      { headerFrom: "kunde@example.com", toAddresses: ["bestellung@meta-online.com"], ccAddresses: ["i.noecker@meta-online.com"] },
      users,
      ["bestellung@meta-online.com"],
    );
    assert.equal(viaCc?.id, "u1");
    const nobody = pickInvolvedColleague(
      { headerFrom: "kunde@example.com", toAddresses: ["bestellung@meta-online.com"], ccAddresses: [] },
      users,
      ["bestellung@meta-online.com"],
    );
    assert.equal(nobody, null);
  });

  it("externer Absender mit gleicher Adresse wie ein Benutzer zählt nicht als Weiterleiter", () => {
    const external = pickInvolvedColleague({ headerFrom: "chef@kunde.de", toAddresses: [], ccAddresses: [] }, [
      { id: "x", username: "x", email: "chef@kunde.de" },
    ], []);
    assert.equal(external, null);
  });

  it("letzter Sachbearbeiter des Kunden, nur im Mandanten", () => {
    const drafts = [
      { tenantId: "t1", shopwareCustomerId: "c1", shopwareCreatedByUserId: "u1", updatedAt: "2026-10-01T00:00:00Z" },
      { tenantId: "t1", shopwareCustomerId: "c1", shopwareCreatedByUserId: "u2", updatedAt: "2026-10-05T00:00:00Z" },
      { tenantId: "t2", shopwareCustomerId: "c1", shopwareCreatedByUserId: "u1", updatedAt: "2026-10-09T00:00:00Z" },
      { tenantId: "t1", shopwareCustomerId: "c1", shopwareCreatedByUserId: null, updatedAt: "2026-10-09T00:00:00Z" },
    ];
    assert.equal(pickLastDraftCreator(drafts, "c1", "t1", eligible)?.id, "u2");
    assert.equal(pickLastDraftCreator(drafts, "c2", "t1", eligible), null);
  });

  it("letzter Ticket-Bearbeiter zur Kunden-Mail", () => {
    const tickets = [
      { tenantId: "t1", customerEmail: "Kunde@Example.com", assignedToUserId: "u1", updatedAt: "2026-10-03T00:00:00Z" },
      { tenantId: "t1", customerEmail: "andere@example.com", assignedToUserId: "u2", updatedAt: "2026-10-09T00:00:00Z" },
    ];
    assert.equal(pickLastTicketAssignee(tickets, "kunde@example.com", "t1", eligible)?.id, "u1");
  });
});

describe("E-Mail-Eingang: Problem-Tickets", () => {
  const problem: IntakeProblem = {
    reason: "shopware_failed",
    messageId: "mail:abc@kunde.de",
    subject: "Bestellung 4711",
    envelope: {
      headerFrom: "Max Muster <m.muster@meta-online.com>",
      customerFrom: "Kunde GmbH <kunde@example.com>",
      customerEmail: "kunde@example.com",
      toAddresses: ["bestellung@meta-online.com"],
      ccAddresses: [],
    },
    draft: { kind: "order", id: "d1", shopwareCustomerId: "c1" },
    error: "Kanal fehlt",
  };

  it("Schlüssel ist stabil je Mail/Grund/Entwurf", () => {
    assert.equal(intakeProblemKey(problem), intakeProblemKey({ ...problem }));
    assert.notEqual(intakeProblemKey(problem), intakeProblemKey({ ...problem, reason: "margin_red" }));
    assert.notEqual(intakeProblemKey(problem), intakeProblemKey({ ...problem, draft: { kind: "order", id: "d2" } }));
  });

  it("Ticket-Text nennt Entwurf, Fehler, Weiterleiter und Zuständigen", () => {
    const t = buildIntakeTicket(problem, { id: "u2", username: "mmuster" }, "involved_colleague");
    assert.match(t.title, /^Automatische Anlage in Shopware fehlgeschlagen: Bestellung 4711/);
    assert.match(t.description, /\/order-drafts\?draftId=d1/);
    assert.match(t.description, /Fehler: Kanal fehlt/);
    assert.match(t.description, /Weitergeleitet von: Max Muster/);
    assert.match(t.description, /Zuständig: mmuster \(an der Mail beteiligt/);
    assert.equal(t.customerEmail, "kunde@example.com");
    assert.equal(t.customerName, "Kunde GmbH");
    assert.equal(t.priority, "high");
    assert.ok(t.tags?.includes("email-intake"));
  });

  it("interne Adresse wird nicht als Kunde eingetragen", () => {
    const internal = buildIntakeTicket(
      { ...problem, envelope: { ...problem.envelope, customerFrom: "Max Muster <m.muster@meta-online.com>", customerEmail: "m.muster@meta-online.com" } },
      null,
      "none",
    );
    assert.equal(internal.customerEmail, null);
    assert.equal(internal.customerName, null);
    assert.match(internal.description, /Zuständig: niemand gefunden/);
  });

  function fakeStorage() {
    const tickets: Array<Record<string, unknown>> = [];
    const notifications: Array<Record<string, unknown>> = [];
    const storage = {
      getAllTickets: async () => tickets,
      getUser: async (id: string) => ({ id, username: id === "u2" ? "mmuster" : "x" }),
      getUsersWithPermissionInTenant: async () => [
        { id: "n8n", username: "n8n", email: "n8n@meta-online.com" },
        { id: "u1", username: "inoecker", email: "i.noecker@meta-online.com" },
        { id: "u2", username: "mmuster", email: "m.muster@meta-online.com" },
      ],
      getAllOrderDrafts: async () => [],
      getAllOfferDrafts: async () => [],
      createTicket: async (t: Record<string, unknown>) => {
        const row = { ...t, id: `id${tickets.length + 1}`, ticketNumber: `T-${100 + tickets.length}`, updatedAt: new Date() };
        tickets.push(row);
        return row;
      },
      createNotification: async (n: Record<string, unknown>) => {
        notifications.push(n);
        return { ...n, id: "n1", createdAt: new Date() };
      },
      createTicketAttachment: async () => ({}),
    };
    return { storage: storage as never, tickets, notifications };
  }

  it("legt einmal an, weist zu und benachrichtigt; Wiederholung findet das Ticket", async () => {
    const { storage, tickets, notifications } = fakeStorage();
    const params = {
      tenantId: "t1",
      problem,
      integrationUserId: "n8n",
      excludeEmails: ["bestellung@meta-online.com"],
      defaultAssigneeUserId: "u1",
    };
    const first = await createIntakeProblemTicket(storage, params);
    assert.equal(first?.ticketNumber, "T-100");
    assert.equal(first?.assignedTo, "mmuster", "Weiterleiter geht vor Standard-Bearbeiter");
    assert.equal(tickets[0].assignedToUserId, "u2");
    assert.equal(tickets[0].createdByUserId, "n8n");
    assert.equal(notifications.length, 1);

    const again = await createIntakeProblemTicket(storage, params);
    assert.equal(again?.ticketNumber, "T-100");
    assert.equal(tickets.length, 1);
    assert.equal(notifications.length, 1);
  });

  it("ohne Beteiligte und Vorgeschichte: Standard-Bearbeiter; n8n-Benutzer nie", async () => {
    const { storage, tickets } = fakeStorage();
    const ref = await createIntakeProblemTicket(storage, {
      tenantId: "t1",
      problem: { ...problem, envelope: { ...problem.envelope, headerFrom: "kunde@example.com", ccAddresses: ["n8n@meta-online.com"] } },
      integrationUserId: "n8n",
      excludeEmails: [],
      defaultAssigneeUserId: "u1",
    });
    assert.equal(ref?.assignedTo, "inoecker");
    assert.equal(tickets[0].assignedToUserId, "u1");
  });
});

describe("E-Mail-Eingang: Sperre je Mail", () => {
  it("zweiter Aufruf derselben Mail wartet, nach Freigabe wieder frei", () => {
    assert.equal(acquireIntakeLock("t1:mail:a", 1000), true);
    assert.equal(acquireIntakeLock("t1:mail:a", 2000), false);
    assert.equal(acquireIntakeLock("t1:mail:b", 2000), true);
    releaseIntakeLock("t1:mail:a");
    assert.equal(acquireIntakeLock("t1:mail:a", 3000), true);
    // verwaiste Sperre läuft nach 15 Minuten ab
    assert.equal(acquireIntakeLock("t1:mail:b", 2000 + 16 * 60 * 1000), true);
    releaseIntakeLock("t1:mail:a");
    releaseIntakeLock("t1:mail:b");
  });
});

describe("E-Mail-Eingang: n8n-Workflow", () => {
  const workflow = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../../n8n-workflows/m365-to-metaorder.json"), "utf8"),
  );
  const byName = new Map<string, any>(workflow.nodes.map((n: any) => [n.name, n]));

  it("alle Verbindungen zeigen auf vorhandene Knoten", () => {
    for (const [source, conn] of Object.entries<any>(workflow.connections)) {
      assert.ok(byName.has(source), `Quelle fehlt: ${source}`);
      for (const branch of conn.main) for (const target of branch) assert.ok(byName.has(target.node), `Ziel fehlt: ${target.node}`);
    }
  });

  it("Zugangsdaten sind Platzhalter, keine Schlüssel im Workflow", () => {
    const text = JSON.stringify(workflow);
    assert.ok(!/X-METAORDER-Integration-Key"\s*:\s*"[^"]{8,}/i.test(text));
    for (const node of workflow.nodes) {
      for (const cred of Object.values<any>(node.credentials ?? {})) {
        assert.match(cred.id, /^(OUTLOOK_OAUTH_CREDENTIAL_ID|METAORDER_INTEGRATION_KEY_CREDENTIAL_ID)$/);
      }
    }
  });

  it("Upload und Meldungen mit Header-Auth-Credential, Produktions-URL an einer Stelle, ohne $env", () => {
    // n8n Cloud sperrt $env in Ausdrücken
    assert.ok(!JSON.stringify(workflow).includes("$env"));
    const settings = byName.get("Einstellungen");
    assert.equal(settings.parameters.assignments.assignments[0].value, "https://p-bbpye5.project.space");
    assert.match(settings.notes, /host\.docker\.internal:5001/);
    for (const name of ["METAorder: Konfiguration", "An METAorder senden", "Problem melden"]) {
      const node = byName.get(name);
      assert.equal(node.parameters.authentication, "genericCredentialType", name);
      assert.equal(node.parameters.genericAuthType, "httpHeaderAuth", name);
      assert.deepEqual(node.credentials, { httpHeaderAuth: { id: "METAORDER_INTEGRATION_KEY_CREDENTIAL_ID", name: "METAorder Integration-Key" } });
    }
  });

  it("die n8n-Übersicht erkennt Postfach und Upload", () => {
    const summary = summarizeN8nWorkflow(workflow, "https://p-bbpye5.project.space");
    assert.deepEqual(summary.mailSources, ["m365"]);
    assert.deepEqual(summary.metaorderUploads, ["{…}/api/commercial-drafts/upload"]);
  });

  function runCode(nodeName: string, input: any[], refs: Record<string, any[]>, staticData: Record<string, any> = {}) {
    const js = byName.get(nodeName).parameters.jsCode as string;
    const $input = { all: () => input, first: () => input[0], item: input[0] };
    const $ = (name: string) => ({
      itemMatching: (i: number) => refs[name][i],
      first: () => refs[name][0],
      item: refs[name][0],
    });
    const fn = new Function("$input", "$", "$getWorkflowStaticData", js);
    return fn($input, $, () => staticData);
  }

  it("Ergebnis auswerten: erledigen, liegen lassen, erst beim 3. Fehler melden", () => {
    const ctx = (id: string) => ({ json: { cfg: {}, message: { id } } });
    const refs = { "Mail vorbereiten": [ctx("a"), ctx("b"), ctx("c")] };
    const input = [
      { json: { statusCode: 200, body: { intake: { outcome: "order", categories: ["x"], move: true } } } },
      { json: { statusCode: 409, body: { code: "email_intake_in_progress" } } },
      { json: { statusCode: 500, body: { error: "kaputt" } } },
    ];
    const store: Record<string, any> = {};
    const first = runCode("Ergebnis auswerten", input, refs, store);
    assert.deepEqual(first.map((o: any) => [o.json.message.id, o.json.action]), [["a", "done"]]);
    runCode("Ergebnis auswerten", input, refs, store);
    const third = runCode("Ergebnis auswerten", input, refs, store);
    assert.deepEqual(third.map((o: any) => [o.json.message.id, o.json.action]), [["a", "done"], ["c", "report"]]);
    assert.equal(third[1].json.errorText, "kaputt");
    assert.equal(store.failures["c:upload"], undefined, "Zähler nach dem Melden zurückgesetzt");
  });
});
