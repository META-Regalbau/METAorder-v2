/**
 * Filter des E-Mail-Eingangs und mehrere Postfächer (12.10.2026): Newsletter/Massenmails, interne
 * Post und Sperr-/Erlaubtlisten werden ohne KI aussortiert und bleiben mit der Kategorie
 * „METAorder: ignoriert“ im Posteingang; persönliche Postfächer werden nie verschoben oder
 * weitergeleitet; n8n ruft je Postfach nur Mails ohne METAorder-Kategorie ab.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_EMAIL_INTAKE_FILTER,
  DEFAULT_EMAIL_INTAKE_SETTINGS,
  EMAIL_INTAKE_CATEGORIES,
  emailIntakeSettingsSchema,
  findIntakeMailbox,
  internalDomainsFor,
  normalizeEmailIntakeSettings,
  type EmailIntakeSettings,
} from "../../shared/emailIntake";
import {
  emailAddressOf,
  evaluateEmailIntakeFilter,
  senderMatches,
  type EmailIntakeFilterInput,
} from "../../server/commercial/emailIntakeFilter";
import { planEmailIntake } from "../../server/commercial/emailIntakeOutcome";
import { workflowConfigFromSettings } from "../../server/commercial/emailIntakeSettings";
import { ingestCommercialEmailUpload } from "../../server/commercial/commercialEmailUploadIngest";
import { parseEmailBufferAutodetect } from "../../server/email/emailParser";

const internal = ["meta-online.com"];
const base: EmailIntakeFilterInput = {
  headerFrom: "Max Kunde <einkauf@kunde.de>",
  customerEmail: "einkauf@kunde.de",
  internalForward: false,
  subject: "Bestellung 4711",
  attachmentNames: [],
};
const filter = (input: Partial<EmailIntakeFilterInput>, settings: Partial<typeof DEFAULT_EMAIL_INTAKE_FILTER> = {}) =>
  evaluateEmailIntakeFilter({ ...base, ...input }, { ...DEFAULT_EMAIL_INTAKE_FILTER, ...settings }, internal);

describe("Filter: Regeln", () => {
  it("normale Kundenmail wird verarbeitet", () => {
    expect(filter({})).toMatchObject({ action: "process", rule: null });
  });

  it("Newsletter an Kopfzeilen und Absender erkannt", () => {
    expect(filter({ listUnsubscribe: "<mailto:unsub@x.de>" })).toMatchObject({ action: "ignore", rule: "bulk" });
    expect(filter({ listId: "<news.lieferant.de>" })).toMatchObject({ action: "ignore", rule: "bulk" });
    expect(filter({ precedence: "Bulk" })).toMatchObject({ action: "ignore", rule: "bulk" });
    for (const from of ["noreply@shop.de", "no-reply@x.de", "newsletter@x.de", "marketing@x.de", "notifications@github.com"]) {
      expect(filter({ headerFrom: from, customerEmail: from }).action, from).toBe("ignore");
    }
  });

  it("info@ und persönliche Adressen sind kein Newsletter", () => {
    for (const from of ["info@indiesemsinne.de", "m.mueller@kunde.de", "einkauf@roloff.de"]) {
      expect(filter({ headerFrom: from, customerEmail: from }).action, from).toBe("process");
    }
  });

  it("Massenmail mit Bestell-Anhang oder Bestell-XML wird trotzdem verarbeitet", () => {
    for (const name of ["Bestellung_112608258.pdf", "PO-4711.pdf", "order.xml", "Anfrage Regale.pdf", "opentrans.xml"]) {
      expect(filter({ headerFrom: "noreply@mercateo.com", customerEmail: "noreply@mercateo.com", attachmentNames: [name] }).action, name).toBe(
        "process",
      );
    }
    expect(filter({ listUnsubscribe: "x", attachmentNames: ["Katalog 2027.pdf"] }).action).toBe("ignore");
  });

  it("intern ignoriert, weitergeleitete Kundenmail verarbeitet", () => {
    const colleague = { headerFrom: "Isabell <i.noecker@meta-online.com>", customerEmail: "i.noecker@meta-online.com" };
    expect(filter(colleague)).toMatchObject({ action: "ignore", rule: "internal" });
    expect(filter({ ...colleague, internalForward: true, customerEmail: "einkauf@kunde.de" })).toMatchObject({ action: "process" });
    // Weiterleitung einer internen Mail bleibt intern
    expect(filter({ ...colleague, internalForward: true })).toMatchObject({ action: "ignore", rule: "internal" });
    expect(filter(colleague, { ignoreInternal: false }).action).toBe("process");
  });

  it("Sperrliste: Adresse, Domain, Subdomain", () => {
    expect(filter({}, { blockSenders: ["einkauf@kunde.de"] })).toMatchObject({ action: "ignore", rule: "block_list" });
    expect(filter({}, { blockSenders: ["kunde.de"] })).toMatchObject({ action: "ignore", rule: "block_list" });
    expect(filter({ headerFrom: "a@mail.kunde.de", customerEmail: "a@mail.kunde.de" }, { blockSenders: ["kunde.de"] }).action).toBe("ignore");
    expect(filter({ headerFrom: "a@notkunde.de", customerEmail: "a@notkunde.de" }, { blockSenders: ["kunde.de"] }).action).toBe("process");
  });

  it("Erlaubtliste geht allen Regeln vor", () => {
    expect(
      filter(
        { headerFrom: "noreply@mercateo.com", customerEmail: "noreply@mercateo.com", listUnsubscribe: "x" },
        { allowSenders: ["mercateo.com"], blockSenders: ["mercateo.com"] },
      ),
    ).toMatchObject({ action: "process", rule: "allow_list" });
  });

  it("Betreff-Stichwort, Groß-/Kleinschreibung egal", () => {
    expect(filter({ subject: "EINLADUNG zum Webinar" }, { blockSubjectKeywords: ["einladung"] })).toMatchObject({
      action: "ignore",
      rule: "subject_keyword",
    });
  });

  it("ohne Filterregeln wird alles verarbeitet", () => {
    expect(filter({ listUnsubscribe: "x" }, { ignoreBulk: false }).action).toBe("process");
  });

  it("Adresse aus Kopfzeile, Muster-Vergleich", () => {
    expect(emailAddressOf("Max <Max@Firma.DE>")).toBe("max@firma.de");
    expect(emailAddressOf("max@firma.de")).toBe("max@firma.de");
    expect(emailAddressOf("Unbekannt")).toBeNull();
    expect(senderMatches("a@b.firma.de", "@firma.de")).toBe(true);
    expect(senderMatches("a@firma.de", "b@firma.de")).toBe(false);
  });
});

describe("Einstellungen: mehrere Postfächer und Filter", () => {
  it("altes Einzelpostfach wird zum Bestellpostfach", () => {
    const s = normalizeEmailIntakeSettings({ enabled: true, mailbox: "bestellung@meta-online.com" });
    expect(s.mailboxes).toEqual([{ address: "bestellung@meta-online.com", mode: "order", enabled: true }]);
    expect(s.filter).toEqual(DEFAULT_EMAIL_INTAKE_FILTER);
  });

  it("Filter: gültige Felder bleiben, ungültige fallen auf den Standard zurück", () => {
    const s = normalizeEmailIntakeSettings({ filter: { ignoreBulk: false, blockSenders: ["@LinkedIn.com"], allowSenders: "kaputt" } });
    expect(s.filter).toMatchObject({ ignoreBulk: false, blockSenders: ["linkedin.com"], allowSenders: [] });
  });

  it("Speichern prüft Muster und doppelte Postfächer", () => {
    const valid = { ...DEFAULT_EMAIL_INTAKE_SETTINGS, filter: { ...DEFAULT_EMAIL_INTAKE_FILTER, blockSenders: ["kein muster"] } };
    expect(emailIntakeSettingsSchema.safeParse(valid).success).toBe(false);
    const dup = {
      ...DEFAULT_EMAIL_INTAKE_SETTINGS,
      mailboxes: [
        { address: "a@meta-online.com", mode: "order", enabled: true },
        { address: "A@meta-online.com", mode: "personal", enabled: true },
      ],
    };
    expect(emailIntakeSettingsSchema.safeParse(dup).success).toBe(false);
  });

  const settings: EmailIntakeSettings = {
    ...DEFAULT_EMAIL_INTAKE_SETTINGS,
    enabled: true,
    processSince: "2026-10-12",
    mailboxes: [
      { address: "bestellung@meta-online.com", mode: "order", enabled: true },
      { address: "osteiling@meta-online.com", mode: "personal", enabled: true },
      { address: "alt@meta-online.com", mode: "order", enabled: false },
    ],
    filter: { ...DEFAULT_EMAIL_INTAKE_FILTER, internalDomains: ["meta-regalbau.de"] },
  };

  it("Workflow-Konfiguration: aktive Postfächer mit Abfrage ohne METAorder-Kategorien", () => {
    const cfg = workflowConfigFromSettings(settings);
    expect(cfg.mailboxes.map((m) => [m.mailbox, m.mode])).toEqual([
      ["bestellung@meta-online.com", "order"],
      ["osteiling@meta-online.com", "personal"],
    ]);
    expect(cfg.mailboxes[1]!.graphBase).toBe("https://graph.microsoft.com/v1.0/users/osteiling%40meta-online.com");
    const f = cfg.mailboxes[0]!.messageFilter;
    expect(f.startsWith("receivedDateTime ge 2026-10-12T00:00:00Z and ")).toBe(true);
    for (const category of Object.values(EMAIL_INTAKE_CATEGORIES)) {
      expect(f).toContain(`not(categories/any(c:c eq '${category}'))`);
    }
    // ältere Workflows: erstes aktives Postfach
    expect(cfg.mailbox).toBe("bestellung@meta-online.com");
    expect(workflowConfigFromSettings({ ...settings, mailboxes: [settings.mailboxes[2]!] }).enabled).toBe(false);
  });

  it("Postfach finden, interne Domains", () => {
    expect(findIntakeMailbox(settings, "OSTEILING@meta-online.com")?.mode).toBe("personal");
    expect(findIntakeMailbox(settings, "fremd@x.de")).toBeNull();
    expect(internalDomainsFor(settings).sort()).toEqual(["meta-online.com", "meta-regalbau.de"]);
  });
});

describe("Ergebnis je Postfach-Art", () => {
  const intakeSettings = { forwardOtherTo: "info@meta-online.com", ticketOnFailure: true, ticketOnShopwareError: true, ticketOnMarginRed: true };
  const other = {
    skippedAsOther: true,
    triage: { kind: "other" as const, otherType: "invoice" as const, confidence: 0.9, reason: "Rechnung", source: "llm" as const },
    outcomes: [],
    existingDraftKind: null,
    settings: intakeSettings,
  };

  it("aussortiert: nur Kategorie ignoriert, nicht verschieben, nicht weiterleiten", () => {
    const plan = planEmailIntake({
      ...other,
      mailboxMode: "order",
      ignoredByFilter: { rule: "bulk", reason: "Newsletter" },
      skippedAsOther: false,
      triage: null,
    });
    expect(plan).toMatchObject({
      outcome: "ignored",
      categories: [EMAIL_INTAKE_CATEGORIES.ignored],
      move: false,
      forward: null,
      problems: [],
      filter: { rule: "bulk", reason: "Newsletter" },
    });
  });

  it("Bestellpostfach: Sonstiges weiterleiten und verschieben (wie bisher)", () => {
    const plan = planEmailIntake({ ...other, mailboxMode: "order" });
    expect(plan).toMatchObject({ outcome: "other", move: true, forward: { to: "info@meta-online.com" } });
  });

  it("persönliches Postfach: nie weiterleiten oder verschieben, aber immer eine Kategorie", () => {
    expect(planEmailIntake({ ...other, mailboxMode: "personal" })).toMatchObject({
      outcome: "other",
      move: false,
      forward: null,
      categories: [EMAIL_INTAKE_CATEGORIES.other],
    });
    const dup = planEmailIntake({ ...other, mailboxMode: "personal", skippedAsOther: false, triage: null, outcomes: [], existingDraftKind: null });
    expect(dup.categories.length).toBeGreaterThan(0);
    expect(dup.move).toBe(false);
  });
});

describe("Mail lesen und filtern", () => {
  const newsletter = Buffer.from(
    [
      "From: Lieferant Newsletter <news@lieferant.de>",
      "To: osteiling@meta-online.com",
      "Message-ID: <nl-1@lieferant.de>",
      "Subject: Unsere Herbstaktion",
      "List-Unsubscribe: <https://lieferant.de/abmelden?id=1>,",
      " <mailto:abmelden@lieferant.de>",
      "List-Id: Herbst <herbst.lieferant.de>",
      "Precedence: bulk",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Jetzt 20 % sparen.",
    ].join("\r\n"),
  );

  it("Parser liefert die Newsletter-Kopfzeilen (auch umbrochen)", async () => {
    const parsed = await parseEmailBufferAutodetect(newsletter);
    expect(parsed.listUnsubscribe).toBe("<https://lieferant.de/abmelden?id=1>, <mailto:abmelden@lieferant.de>");
    expect(parsed.listId).toBe("Herbst <herbst.lieferant.de>");
    expect(parsed.precedence).toBe("bulk");
  });

  it("Newsletter wird ohne KI aussortiert", async () => {
    let llmCalls = 0;
    const result = await ingestCommercialEmailUpload({
      storage: { getSetting: async () => undefined } as never,
      tenantId: "t1",
      fileBuffer: newsletter,
      fileName: "mail.eml",
      createdByUserId: "n8n",
      ocrEnabled: false,
      triage: {
        otherMinConfidence: 0.7,
        llm: async () => {
          llmCalls += 1;
          return "{}";
        },
      },
      filter: { settings: DEFAULT_EMAIL_INTAKE_FILTER, internalDomains: ["meta-online.com"] },
    });
    expect(result.ignoredByFilter).toMatchObject({ rule: "bulk" });
    expect(result.triage).toBeNull();
    expect(result.outcomes).toEqual([]);
    expect(llmCalls).toBe(0);
  });
});

describe("n8n-Workflow: mehrere Postfächer", () => {
  const workflow = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../../n8n-workflows/m365-to-metaorder.json"), "utf8"),
  );
  const byName = new Map<string, any>(workflow.nodes.map((n: any) => [n.name, n]));

  function runCode(nodeName: string, input: any[], refs: Record<string, any[]>) {
    const js = byName.get(nodeName).parameters.jsCode as string;
    const $input = { all: () => input, first: () => input[0], item: input[0] };
    const $ = (name: string) => ({ itemMatching: (i: number) => refs[name][i], first: () => refs[name][0], item: refs[name][0] });
    return new Function("$input", "$", "$getWorkflowStaticData", js)($input, $, () => ({}));
  }

  const order = { mailbox: "bestellung@meta-online.com", mode: "order", graphBase: "g1", messageFilter: "f1" };
  const personal = { mailbox: "osteiling@meta-online.com", mode: "personal", graphBase: "g2", messageFilter: "f2" };

  it("Postfächer einzeln: Liste bzw. altes Einzelpostfach", () => {
    expect(runCode("Postfächer einzeln", [{ json: { mailboxes: [order, personal] } }], {}).map((o: any) => o.json.mode)).toEqual([
      "order",
      "personal",
    ]);
    const legacy = runCode("Postfächer einzeln", [{ json: { graphBase: "g", mailbox: null, receivedAfter: "2026-10-12T00:00:00Z" } }], {});
    expect(legacy[0].json).toMatchObject({ mode: "order", messageFilter: "receivedDateTime ge 2026-10-12T00:00:00Z" });
  });

  it("Ordner-ID: persönliches Postfach ohne Ordner, fehlender Ordner lässt nur dieses Postfach aus", () => {
    const refs = { "Postfächer einzeln": [{ json: order }, { json: personal }, { json: { ...order, mailbox: "x@y.de" } }] };
    const out = runCode("Ordner-ID", [{ json: { value: [{ id: "F1" }] } }, { json: personal }, { json: { error: "403" } }], refs);
    expect(out.map((o: any) => [o.json.mailbox, o.json.folderId])).toEqual([
      ["bestellung@meta-online.com", "F1"],
      ["osteiling@meta-online.com", null],
    ]);
  });

  it("Mails einzeln: jede Mail mit ihrem Postfach", () => {
    const refs = { "Ordner-ID": [{ json: { ...order, folderId: "F1" } }, { json: { ...personal, folderId: null } }] };
    const out = runCode("Mails einzeln", [{ json: { value: [{ id: "m1" }] } }, { json: { value: [{ id: "m2" }, { id: "m3" }] } }], refs);
    expect(out.map((o: any) => [o.json.message.id, o.json.cfg.mode])).toEqual([
      ["m1", "order"],
      ["m2", "personal"],
      ["m3", "personal"],
    ]);
  });

  it("Abruf, Upload und Meldung tragen das Postfach", () => {
    const query = byName.get("Mails abrufen").parameters.queryParameters.parameters;
    expect(query.find((q: any) => q.name === "$filter").value).toBe("={{ $json.messageFilter }}");
    expect(byName.get("Mails abrufen").onError).toBe("continueRegularOutput");
    const form = byName.get("An METAorder senden").parameters.bodyParameters.parameters;
    expect(form.find((f: any) => f.name === "intake_mailbox").value).toBe("={{ $json.cfg.mailbox || '' }}");
    expect(byName.get("Problem melden").parameters.jsonBody).toContain("mailbox: ($json.cfg && $json.cfg.mailbox) || ''");
    expect(workflow.connections["Bestellpostfach?"].main[1][0].node).toBe("Ordner-ID");
  });
});
