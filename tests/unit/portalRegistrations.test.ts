/**
 * Portal-Registrierungen: Auslesen, Abgleich mit dem Portal, Plan, Ausführung, Mails, Import der
 * Außendienst-Liste und der ganze Ablauf (mit Speicher-Repo, Schein-Shop und Schein-KI).
 *
 *   Ausführung: npm test
 */
import { beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PORTAL_REGISTRATION_SETTINGS,
  EMPTY_PORTAL_REGISTRATION_DATA,
  PORTAL_REGISTRATION_CATEGORIES,
  normalizePortalRegistrationSettings,
  type PortalCustomerSnapshot,
  type PortalRegistrationData,
  type PortalRegistrationSettings,
} from "../../shared/portalRegistrations";
import type { PortalRegistrationRow } from "../../shared/schema";

// ---- Speicher statt Datenbank ----
type Mail = {
  id: string;
  tenantId: string | null;
  registrationId: string;
  kind: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  html: string;
  attachOriginal: boolean;
  status: string;
  attempts: number;
  lastError: string | null;
  claimedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
};
const mem = vi.hoisted(() => ({
  rows: new Map<string, any>(),
  mails: new Map<string, any>(),
  reps: new Map<string, any>(),
  seq: 0,
}));

vi.mock("../../server/b2b/portalRegistrationRepo", () => {
  const id = () => `id-${++mem.seq}`;
  const repo = {
    async findByMessageId(tenantId: string | null, messageId: string) {
      return [...mem.rows.values()].find((r) => r.tenantId === tenantId && r.messageId === messageId) ?? null;
    },
    async get(tenantId: string | null, rid: string) {
      const r = mem.rows.get(rid);
      return r && r.tenantId === tenantId ? r : null;
    },
    async insert(row: any) {
      if ([...mem.rows.values()].some((r) => r.tenantId === row.tenantId && r.messageId === row.messageId)) return null;
      const now = new Date();
      const full = {
        id: id(),
        graphMessageId: null,
        mailbox: null,
        fromEmail: null,
        fromName: null,
        forwardedBy: null,
        rawEmlBase64: null,
        extraction: null,
        data: null,
        match: null,
        plan: null,
        events: [],
        customerId: null,
        employeeId: null,
        passwordResetAt: null,
        salesRepNotifiedAt: null,
        masterDataRequestedAt: null,
        lastCheckedAt: null,
        lastError: null,
        handledByUserId: null,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
        ...row,
      };
      mem.rows.set(full.id, full);
      return full;
    },
    async update(tenantId: string | null, rid: string, patch: any, events: any[] = []) {
      const r = mem.rows.get(rid);
      if (!r || r.tenantId !== tenantId) return null;
      const next = { ...r, ...patch, events: [...r.events, ...events], updatedAt: new Date() };
      mem.rows.set(rid, next);
      return next;
    },
    async list() {
      return [...mem.rows.values()];
    },
    async countByStatus() {
      return {};
    },
    async dueForRecheck(tenantId: string | null, olderThan: Date) {
      return [...mem.rows.values()].filter(
        (r) => r.tenantId === tenantId && r.status === "waiting_master_data" && (!r.lastCheckedAt || r.lastCheckedAt < olderThan),
      );
    },
    async enqueueMail(m: any) {
      const mail: Mail = {
        id: id(),
        tenantId: m.tenantId,
        registrationId: m.registrationId,
        kind: m.kind,
        toAddresses: m.to,
        ccAddresses: m.cc,
        subject: m.subject,
        html: m.html,
        attachOriginal: m.attachOriginal,
        status: "pending",
        attempts: 0,
        lastError: null,
        claimedAt: null,
        sentAt: null,
        createdAt: new Date(),
      };
      mem.mails.set(mail.id, mail);
      return mail;
    },
    async claimPendingMails(tenantId: string | null) {
      const out = [...mem.mails.values()].filter((m) => m.tenantId === tenantId && m.status === "pending" && !m.claimedAt);
      for (const m of out) {
        m.claimedAt = new Date();
        m.attempts += 1;
      }
      return out;
    },
    async getMail(_t: string | null, mid: string) {
      return mem.mails.get(mid) ?? null;
    },
    async markMail(_t: string | null, mid: string, patch: any) {
      Object.assign(mem.mails.get(mid), patch);
    },
    async mailsForRegistration(_t: string | null, rid: string) {
      return [...mem.mails.values()].filter((m) => m.registrationId === rid);
    },
    async findSalesRep(_t: string | null, customerNumber: string) {
      return mem.reps.get(customerNumber) ?? null;
    },
    async listSalesReps() {
      return [...mem.reps.values()];
    },
    async importSalesReps(_t: string | null, rows: any[]) {
      for (const r of rows) mem.reps.set(r.customerNumber, r);
      return rows.length;
    },
    async deleteSalesRep() {},
  };
  return { portalRegistrationRepo: repo };
});

import {
  detectModeRequest,
  extractByRules,
  interpretExtractionResponse,
  mergeWithRules,
} from "../../server/b2b/portalRegistrationExtraction";
import { companySimilarity, decidePortalMatch, scoreCustomer } from "../../server/b2b/portalRegistrationMatch";
import { buildRegistrationPlan, executeRegistrationPlan } from "../../server/b2b/portalRegistrationPlan";
import { buildGraphMessage, buildMasterDataRequestMail, buildSalesRepInfoMail, escapeHtml } from "../../server/b2b/portalRegistrationMails";
import { mapCustomerSnapshot } from "../../server/b2b/portalRegistrationShop";
import type { PortalEmployeeInfo, PortalRegistrationShopApi } from "../../server/b2b/portalRegistrationShop";
import { parseSalesRepFile, parseSalesRepRows } from "../../server/b2b/salesRepImport";
import {
  ackOutboxMail,
  categoriesForStatus,
  claimOutboxMails,
  executeRegistration,
  ingestRegistrationMail,
  portalRegistrationWorkflowConfig,
  recheckDueRegistrations,
  selectRegistrationCustomer,
  type ServiceContext,
} from "../../server/b2b/portalRegistrationService";

// ---- Hilfen ----
function customer(over: Partial<PortalCustomerSnapshot> = {}): PortalCustomerSnapshot {
  return {
    id: "c1",
    customerNumber: "20000016175",
    company: "Müller Lagertechnik GmbH",
    email: "info@mueller-lager.de",
    active: true,
    salesChannelId: "portal-de",
    salesChannelName: "META Händler Portal DE",
    isPortal: true,
    vatIds: [],
    address: { id: "a1", street: "Hauptstr. 1", zipCode: "59755", city: "Arnsberg", countryIso: "DE", phone: null },
    platformAccess: true,
    salesRepresentative: false,
    ...over,
  };
}

function data(over: Partial<PortalRegistrationData> = {}, contact: Partial<PortalRegistrationData["contact"]> = {}): PortalRegistrationData {
  return {
    ...EMPTY_PORTAL_REGISTRATION_DATA,
    company: "Müller Lagertechnik GmbH",
    zipCode: "59755",
    city: "Arnsberg",
    ...over,
    contact: { salutation: "mr", firstName: "Peter", lastName: "Müller", email: "p.mueller@mueller-lager.de", phone: null, ...contact },
  };
}

function employee(over: Partial<PortalEmployeeInfo> = {}): PortalEmployeeInfo {
  return {
    id: "e1",
    email: "p.mueller@mueller-lager.de",
    firstName: "Peter",
    lastName: "Müller",
    customerIds: [],
    expertMode: false,
    adminMode: false,
    boundSalesChannelId: null,
    ...over,
  };
}

type FakeShop = PortalRegistrationShopApi & { calls: string[]; customers: PortalCustomerSnapshot[]; employees: PortalEmployeeInfo[] };

function fakeShop(customers: PortalCustomerSnapshot[], employees: PortalEmployeeInfo[] = [], opts: { resetFails?: boolean } = {}): FakeShop {
  const calls: string[] = [];
  const shop: FakeShop = {
    calls,
    customers,
    employees,
    async findCandidates(q) {
      const hits = shop.customers
        .filter(
          (c) =>
            (q.customerNumber && c.customerNumber === q.customerNumber) ||
            (q.email && c.email === q.email) ||
            (q.company && companySimilarity(q.company, c.company) > 0.5) ||
            (q.zipCode && c.address.zipCode === q.zipCode),
        )
        .map((c) => ({ customer: c }));
      const emp = q.email ? shop.employees.find((e) => e.email === q.email) : null;
      for (const id of emp?.customerIds ?? []) {
        const c = shop.customers.find((x) => x.id === id);
        if (c) hits.push({ customer: c, viaEmployeeEmail: true } as never);
      }
      return hits;
    },
    async getCustomer(id) {
      return shop.customers.find((c) => c.id === id) ?? null;
    },
    async findCustomersByNumber(n) {
      return shop.customers.filter((c) => c.customerNumber === n);
    },
    async findEmployee(email) {
      return shop.employees.find((e) => e.email === email) ?? null;
    },
    async createEmployee(input) {
      calls.push(`create:${input.email}:${input.expertMode ? "expert" : "plain"}`);
      const e = employee({ id: `e-new-${calls.length}`, email: input.email, firstName: input.firstName, lastName: input.lastName });
      shop.employees.push(e);
      return e.id;
    },
    async updateEmployee(id, patch) {
      calls.push(`update:${id}:${patch.expertMode ? "expert" : "plain"}`);
    },
    async ensureAdminLink(employeeId, customerId) {
      calls.push(`link:${employeeId}:${customerId}`);
      const e = shop.employees.find((x) => x.id === employeeId);
      const created = Boolean(e && !e.customerIds.includes(customerId));
      if (e && created) e.customerIds.push(customerId);
      return { created };
    },
    async updateCustomer(c, changes) {
      calls.push(`customer:${c.id}:${Object.keys(changes).filter((k) => (changes as Record<string, unknown>)[k] !== undefined).join(",")}`);
    },
    async requestPasswordReset(p) {
      if (opts.resetFails) throw new Error("Flow aus");
      calls.push(`reset:${p.email}:${p.salesChannelId}:${p.storefrontUrl}`);
    },
  };
  return shop;
}

function eml(params: { from: string; subject: string; body: string; messageId: string }): Buffer {
  return Buffer.from(
    [
      `From: ${params.from}`,
      "To: registrierung@meta-online.com",
      `Subject: ${params.subject}`,
      `Message-ID: <${params.messageId}>`,
      "Date: Fri, 16 Oct 2026 10:00:00 +0200",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      params.body,
    ].join("\r\n"),
  );
}

const AI_ANSWER = JSON.stringify({
  isRegistration: true,
  confidence: 0.95,
  reason: "Portal-Anmeldung",
  company: "Müller Lagertechnik GmbH",
  customerNumber: "20000016175",
  vatId: null,
  street: "Hauptstr. 1",
  zipCode: "59755",
  city: "Arnsberg",
  country: "DE",
  phone: null,
  contact: { salutation: "Herr", firstName: "Peter", lastName: "Müller", email: "p.mueller@mueller-lager.de", phone: null },
  expertMode: true,
  adminMode: null,
  notes: null,
});

function ctx(shop: FakeShop, settings: Partial<PortalRegistrationSettings> = {}, llmAnswer = AI_ANSWER): ServiceContext {
  return {
    tenantId: "t1",
    settings: { ...DEFAULT_PORTAL_REGISTRATION_SETTINGS, enabled: true, masterDataEmail: "kundenstamm@meta-online.com", ...settings },
    userName: "tester",
    appBaseUrl: "https://metaorder.example",
    shopApi: async () => shop,
    storage: { getSetting: async () => undefined } as never,
    llm: async () => llmAnswer,
  };
}

beforeEach(() => {
  mem.rows.clear();
  mem.mails.clear();
  mem.reps.clear();
});

// ---- Tests ----
describe("Portal-Registrierungen: Einstellungen", () => {
  it("füllt Unbrauchbares mit Standardwerten auf und ist ab Werk aus", () => {
    const s = normalizePortalRegistrationSettings({ enabled: true, maxPerRun: 999, masterDataEmail: "ks@meta-online.com", customerUpdate: "kaputt" });
    assert.equal(s.enabled, true);
    assert.equal(s.maxPerRun, DEFAULT_PORTAL_REGISTRATION_SETTINGS.maxPerRun);
    assert.equal(s.customerUpdate, "fill_empty");
    assert.equal(s.masterDataEmail, "ks@meta-online.com");
    assert.equal(DEFAULT_PORTAL_REGISTRATION_SETTINGS.enabled, false);
    assert.equal(DEFAULT_PORTAL_REGISTRATION_SETTINGS.autoExecute, false);
  });

  it("liefert n8n Postfach und $filter ohne eigene Kategorien", () => {
    const cfg = portalRegistrationWorkflowConfig(
      { ...DEFAULT_PORTAL_REGISTRATION_SETTINGS, mailbox: "registrierung@meta-online.com", processSince: "2026-10-01" },
      { ready: true, notReadyReason: null },
    );
    assert.match(cfg.graphBase, /users\/registrierung%40meta-online\.com$/);
    assert.ok(cfg.messageFilter.startsWith("receivedDateTime ge 2026-10-01T00:00:00Z"));
    for (const c of Object.values(PORTAL_REGISTRATION_CATEGORIES)) assert.ok(cfg.messageFilter.includes(`'${c}'`));
  });
});

describe("Portal-Registrierungen: Auslesen", () => {
  it("erkennt Expertenmodus, auch verneint", () => {
    assert.equal(detectModeRequest("Bitte mit Expertenmodus freischalten", /experten[\s-]*modus/i), true);
    assert.equal(detectModeRequest("Expertenmodus: ja", /experten[\s-]*modus/i), true);
    assert.equal(detectModeRequest("Kein Expertenmodus nötig", /experten[\s-]*modus/i), false);
    assert.equal(detectModeRequest("Expertenmodus: nein", /experten[\s-]*modus/i), false);
    assert.equal(detectModeRequest("Bitte Zugang anlegen", /experten[\s-]*modus/i), null);
  });

  it("findet Kundennummer, USt-IdNr. und die externe E-Mail per Regel", () => {
    const r = extractByRules({
      subject: "WG: Registrierung Händlerportal",
      body: "Von: Kollege <kollege@meta-online.com>\nKundennummer: 20000016175\nUSt-IdNr. DE 123 456 789\nKontakt: p.mueller@mueller-lager.de\nExperten-Modus gewünscht",
    });
    assert.equal(r.customerNumber, "20000016175");
    assert.equal(r.vatId, "DE123456789");
    assert.equal(r.contact.email, "p.mueller@mueller-lager.de");
    assert.equal(r.expertMode, true);
  });

  it("liest die KI-Antwort tolerant und verwirft META-Adressen als Kontakt", () => {
    const parsed = interpretExtractionResponse(
      JSON.stringify({ isRegistration: "true", confidence: "90", contact: { salutation: "Frau", email: "kollegin@meta-online.com" }, expertMode: "ja" }),
    );
    assert.ok(parsed);
    assert.equal(parsed!.confidence, 0.9);
    assert.equal(parsed!.data.contact.salutation, "mrs");
    assert.equal(parsed!.data.contact.email, null);
    assert.equal(parsed!.data.expertMode, true);
    assert.equal(interpretExtractionResponse("kein json"), null);
  });

  it("Regeln ergänzen nur, was die KI auslässt", () => {
    const merged = mergeWithRules(data({ customerNumber: null, expertMode: null }), data({ customerNumber: "123456", expertMode: true }));
    assert.equal(merged.customerNumber, "123456");
    assert.equal(merged.expertMode, true);
    const kept = mergeWithRules(data({ expertMode: false }), data({ expertMode: true }));
    assert.equal(kept.expertMode, false);
  });
});

describe("Portal-Registrierungen: Abgleich", () => {
  it("Firmennamen ohne Rechtsform vergleichen", () => {
    assert.equal(companySimilarity("Müller Lagertechnik GmbH", "Mueller Lagertechnik GmbH & Co. KG"), 1);
    assert.ok(companySimilarity("Müller Lagertechnik", "Schmidt Regalbau") < 0.4);
  });

  it("Kundennummer im Portal = sicherer Treffer", () => {
    const m = decidePortalMatch(data({ customerNumber: "20000016175" }), [{ customer: customer() }]);
    assert.equal(m.status, "matched");
    assert.equal(m.customerId, "c1");
    assert.equal(m.confidence, 100);
  });

  it("Nummer passt, Firma ganz anders → prüfen", () => {
    const m = decidePortalMatch(data({ customerNumber: "20000016175", company: "Schmidt Regalbau KG" }, { email: "info@schmidt-regalbau.de" }), [
      { customer: customer() },
    ]);
    assert.equal(m.status, "ambiguous");
    assert.ok(m.notes.includes("number_company_mismatch"));
  });

  it("zwei Portal-Kunden mit derselben E-Mail → prüfen", () => {
    const m = decidePortalMatch(data({}, { email: "info@mueller-lager.de" }), [
      { customer: customer() },
      { customer: customer({ id: "c2", customerNumber: "20000099999" }) },
    ]);
    assert.equal(m.status, "ambiguous");
    assert.ok(m.notes.includes("several_portal_accounts"));
  });

  it("nur Firma + PLZ → Kandidat, kein sicherer Treffer", () => {
    const m = decidePortalMatch(data({}, { email: "p@gmail.com" }), [{ customer: customer({ email: "x@y.de" }) }]);
    assert.equal(m.status, "ambiguous");
    assert.equal(m.candidates[0].score, 92);
  });

  it("Konto nur im Onlineshop zählt nicht als Portal-Kunde", () => {
    const m = decidePortalMatch(data({ customerNumber: "10001" }), [
      { customer: customer({ id: "s1", customerNumber: "10001", isPortal: false, salesChannelName: "Onlineshop" }) },
    ]);
    assert.equal(m.status, "not_found");
    assert.equal(m.shopAccounts.length, 1);
    assert.ok(m.notes.includes("number_not_found"));
  });

  it("internes META-Konto ist nie der Händler", () => {
    const m = decidePortalMatch(data({ customerNumber: "12514" }), [{ customer: customer({ customerNumber: "12514", salesRepresentative: true }) }]);
    assert.equal(m.status, "not_found");
    assert.ok(m.notes.includes("sales_rep_account"));
  });

  it("Mitarbeiter-E-Mail führt zum Kunden", () => {
    const scored = scoreCustomer(data({ company: null, zipCode: null }), { customer: customer(), viaEmployeeEmail: true });
    assert.equal(scored.score, 100);
    assert.ok(scored.methods.includes("employee_email"));
  });
});

describe("Portal-Registrierungen: Shop-Daten", () => {
  it("bildet Kunde, Adresse und Portal-Kanal ab", () => {
    const snap = mapCustomerSnapshot(
      {
        id: "abc",
        customerNumber: "20000016175",
        company: "Firma",
        email: "INFO@X.DE",
        active: false,
        salesChannelId: "AA-BB",
        vatIds: ["DE1"],
        customFields: { b2b_platform_access: false, b2b_sales_representative: "1" },
        defaultBillingAddress: { id: "ad", street: "S", zipcode: "1", city: "C", phoneNumber: "", country: { iso: "DE" } },
      },
      new Map([["aabb", { name: "META Händler Portal DE", isPortal: true }]]),
    );
    assert.equal(snap.isPortal, true);
    assert.equal(snap.email, "info@x.de");
    assert.equal(snap.active, false);
    assert.equal(snap.platformAccess, false);
    assert.equal(snap.salesRepresentative, true);
    assert.equal(snap.address.countryIso, "DE");
    assert.equal(snap.address.phone, null);
  });
});

describe("Portal-Registrierungen: Plan und Ausführung", () => {
  it("neuer Admin-Mitarbeiter mit Expertenmodus, Kunde wird aktiviert", () => {
    const plan = buildRegistrationPlan(data({ expertMode: true, vatId: "DE123456789" }), customer({ active: false }), null, { customerUpdate: "fill_empty" });
    assert.equal(plan.employee.action, "create");
    assert.equal(plan.employee.expertMode, true);
    assert.equal(plan.link.action, "create");
    assert.deepEqual(plan.customerChanges.map((c) => c.field), ["active", "vatId"]);
    assert.deepEqual(plan.blockers, []);
  });

  it("Mitarbeiter eines anderen Kunden wird nie umgehängt", () => {
    const plan = buildRegistrationPlan(data(), customer(), employee({ customerIds: ["other"] }), { customerUpdate: "none" });
    assert.ok(plan.blockers.includes("employee_other_customer"));
  });

  it("META-Adresse und fehlende Namen blockieren", () => {
    const plan = buildRegistrationPlan(data({}, { email: "kollege@meta-online.com", lastName: null }), customer(), null, { customerUpdate: "none" });
    assert.ok(plan.blockers.includes("internal_email"));
    assert.ok(plan.blockers.includes("missing_name"));
  });

  it("vom Bearbeiter abgewählte Änderung bleibt abgewählt", () => {
    const first = buildRegistrationPlan(data(), customer({ active: false }), null, { customerUpdate: "none" });
    first.customerChanges[0].apply = false;
    const again = buildRegistrationPlan(data(), customer({ active: false }), null, { customerUpdate: "none" }, first);
    assert.equal(again.customerChanges[0].apply, false);
  });

  it("führt aus: anlegen, verknüpfen, Kunde anpassen, Passwort-Mail", async () => {
    const shop = fakeShop([customer({ active: false })]);
    const plan = buildRegistrationPlan(data({ expertMode: true }), customer({ active: false }), null, { customerUpdate: "none" });
    const r = await executeRegistrationPlan(shop, plan, { storefrontUrl: "https://portal.meta-online.com" });
    assert.equal(r.ok, true);
    assert.equal(r.passwordResetSent, true);
    assert.deepEqual(shop.calls, [
      "create:p.mueller@mueller-lager.de:expert",
      "link:e-new-1:c1",
      "customer:c1:active",
      "reset:p.mueller@mueller-lager.de:portal-de:https://portal.meta-online.com",
    ]);
  });

  it("prüft vor dem Schreiben erneut: inzwischen anderem Kunden zugeordnet → Prüfung", async () => {
    const shop = fakeShop([customer()], [employee({ customerIds: ["other"] })]);
    const plan = buildRegistrationPlan(data(), customer(), null, { customerUpdate: "none" });
    const r = await executeRegistrationPlan(shop, plan, { storefrontUrl: "x" });
    assert.equal(r.needsReview, true);
    assert.deepEqual(shop.calls, []);
  });
});

describe("Portal-Registrierungen: Mails", () => {
  it("Kundenstamm-Mail nennt Daten und ähnliche Kunden, ohne HTML aus der Mail", () => {
    const m = buildMasterDataRequestMail({
      data: data({ company: "<b>Böse</b> GmbH" }),
      match: decidePortalMatch(data(), [{ customer: customer({ email: "x@y.de" }) }]),
      forwardedBy: "kollege@meta-online.com",
      registrationUrl: "https://metaorder.example/b2b/registrations?id=1",
      autoExecute: false,
    });
    assert.ok(m.subject.startsWith("Portal-Registrierung prüfen"));
    assert.ok(m.html.includes("&lt;b&gt;Böse&lt;/b&gt;"));
    assert.ok(m.html.includes("20000016175"));
    assert.ok(m.html.includes("kollege@meta-online.com"));
  });

  it("Außendienst-Mail und Graph-Nachricht mit Anhang", () => {
    const plan = buildRegistrationPlan(data({ expertMode: true }), customer(), null, { customerUpdate: "none" });
    const m = buildSalesRepInfoMail({ repName: "Anna Vertrieb", plan, data: data(), passwordResetSent: true, portalUrl: "https://portal.meta-online.com" });
    assert.match(m.subject, /Kd\. 20000016175/);
    assert.ok(m.html.includes("Hallo Anna Vertrieb"));
    const g = buildGraphMessage({ subject: "s", html: "h", to: ["a@b.de"], cc: ["c@d.de"], attachment: { name: "x.eml", base64: "QQ==" } });
    assert.deepEqual(g.toRecipients, [{ emailAddress: { address: "a@b.de" } }]);
    assert.equal((g.attachments as Array<Record<string, unknown>>)[0]["@odata.type"], "#microsoft.graph.fileAttachment");
    assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
  });
});

describe("Portal-Registrierungen: Außendienst-Liste", () => {
  it("erkennt Spalten, nimmt Excel-Zahlen ganzzahlig und meldet Fehler", () => {
    const r = parseSalesRepRows([
      ["Kundenname", "Kd.-Nr.", "Außendienst", "E-Mail Außendienst"],
      ["Müller", 20000016175, "Anna Vertrieb", "A.Vertrieb@meta-online.com"],
      ["Schmidt", "10001", "Bernd", "kaputt"],
      ["", "", "", ""],
      ["Müller doppelt", "20000016175", "Anna V.", "a.vertrieb@meta-online.com"],
    ]);
    assert.equal(r.columns.customerNumber, "Kd.-Nr.");
    assert.equal(r.columns.name, "Außendienst");
    assert.equal(r.columns.email, "E-Mail Außendienst");
    assert.deepEqual(r.rows, [{ customerNumber: "20000016175", repEmail: "a.vertrieb@meta-online.com", repName: "Anna V." }]);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].rowNumber, 3);
  });

  it("CSV mit Umlauten: UTF-8 mit BOM und Windows-1252 (Excel)", () => {
    const text = "Kundennummer;Kundenname;Außendienst;E-Mail\n12776;Müller;Jörg Weiß;j.weiss@meta-online.com\n";
    for (const buffer of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]), Buffer.from(text, "latin1")]) {
      const r = parseSalesRepFile(buffer);
      assert.equal(r.columns.name, "Außendienst");
      assert.deepEqual(r.rows, [{ customerNumber: "12776", repEmail: "j.weiss@meta-online.com", repName: "Jörg Weiß" }]);
    }
  });

  it("ohne Kundennummer-Spalte kein Import", () => {
    const r = parseSalesRepRows([["Name", "Mail"], ["x", "a@b.de"]]);
    assert.equal(r.rows.length, 0);
    assert.equal(r.errors.length, 1);
  });
});

describe("Portal-Registrierungen: Ablauf", () => {
  const mail = (id: string, body = "Bitte Zugang fürs Händlerportal anlegen, Kd.-Nr. 20000016175, mit Expertenmodus.") =>
    eml({ from: "Kollege <kollege@meta-online.com>", subject: "WG: Registrierung Händlerportal", body, messageId: id });

  it("sicherer Treffer mit Automatik: anlegen, Passwort-Mail, Außendienst-Info im Postausgang", async () => {
    mem.reps.set("20000016175", { customerNumber: "20000016175", repName: "Anna Vertrieb", repEmail: "a.vertrieb@meta-online.com" });
    const shop = fakeShop([customer()]);
    const c = ctx(shop, { autoExecute: true });
    const res = await ingestRegistrationMail(c, { buffer: mail("m1@x") });
    assert.equal(res.outcome, "completed");
    assert.deepEqual(res.categories, [PORTAL_REGISTRATION_CATEGORIES.done]);
    const row = mem.rows.get(res.registrationId!) as PortalRegistrationRow;
    assert.equal(row.forwardedBy, "kollege@meta-online.com");
    assert.ok(row.passwordResetAt);
    assert.ok(shop.calls.includes("create:p.mueller@mueller-lager.de:expert"));
    const mails = [...mem.mails.values()];
    assert.equal(mails.length, 1);
    assert.equal(mails[0].kind, "sales_rep_info");
    assert.deepEqual(mails[0].ccAddresses, ["kollege@meta-online.com"]);

    // n8n holt die Mail und meldet den Versand
    const out = await claimOutboxMails(c);
    assert.equal(out.length, 1);
    assert.match(out[0].graphBase, /graph\.microsoft\.com\/v1\.0\/me$/);
    await ackOutboxMail(c, out[0].id, { ok: true });
    assert.equal(mem.mails.get(out[0].id).status, "sent");

    // dieselbe Mail noch einmal: nichts doppelt
    const again = await ingestRegistrationMail(c, { buffer: mail("m1@x") });
    assert.equal(again.outcome, "duplicate");
    assert.equal(shop.calls.filter((x) => x.startsWith("create:")).length, 1);
  });

  it("ohne Automatik wartet ein sicherer Treffer auf „Ausführen“; ohne Außendienst nur Vermerk", async () => {
    const shop = fakeShop([customer()]);
    const c = ctx(shop);
    const res = await ingestRegistrationMail(c, { buffer: mail("m2@x") });
    assert.equal(res.outcome, "ready");
    assert.deepEqual(shop.calls, []);
    const done = await executeRegistration(c, res.registrationId!);
    assert.equal(done.status, "completed");
    assert.ok((done.events as Array<{ type: string }>).some((e) => e.type === "sales_rep_missing"));
    assert.equal(mem.mails.size, 0);
  });

  it("Kunde nicht im Portal: Bitte an den Kundenstamm, später neu geprüft und erledigt", async () => {
    const shop = fakeShop([]);
    const c = ctx(shop, { autoExecute: true });
    const res = await ingestRegistrationMail(c, { buffer: mail("m3@x") });
    assert.equal(res.outcome, "waiting_master_data");
    assert.deepEqual(res.categories, [PORTAL_REGISTRATION_CATEGORIES.masterData]);
    const request = [...mem.mails.values()][0];
    assert.equal(request.kind, "master_data_request");
    assert.deepEqual(request.toAddresses, ["kundenstamm@meta-online.com"]);
    assert.equal(request.attachOriginal, true);
    const out = await claimOutboxMails(c);
    assert.equal(((out[0].message.attachments as unknown[]) ?? []).length, 1);

    // Kundenstamm legt den Kunden an → Neuprüfung findet ihn und führt aus
    shop.customers.push(customer());
    const changed = await recheckDueRegistrations(c, new Date(Date.now() + 5 * 3600_000));
    assert.equal(changed, 1);
    assert.equal(mem.rows.get(res.registrationId!).status, "completed");
    assert.equal(mem.mails.size, 1, "keine zweite Kundenstamm-Mail");
  });

  it("keine Registrierung laut KI → verworfen, Kategorie „keine Registrierung“", async () => {
    const shop = fakeShop([customer()]);
    const c = ctx(shop, {}, JSON.stringify({ isRegistration: false, confidence: 0.9, reason: "Bestellung" }));
    const res = await ingestRegistrationMail(c, { buffer: mail("m4@x", "Wir bestellen 3 Regale") });
    assert.equal(res.outcome, "not_registration");
    assert.deepEqual(res.categories, [PORTAL_REGISTRATION_CATEGORIES.notRegistration]);
  });

  it("von Hand gewählter Kunde läuft nie automatisch", async () => {
    const shop = fakeShop([customer({ id: "c9", customerNumber: "20000077777", company: "Ganz Andere AG", email: null })]);
    const c = ctx(shop, { autoExecute: true }, JSON.stringify({ ...JSON.parse(AI_ANSWER), customerNumber: null, company: "Unbekannt", zipCode: null }));
    const res = await ingestRegistrationMail(c, { buffer: mail("m5@x") });
    assert.equal(res.outcome, "waiting_master_data");
    const picked = await selectRegistrationCustomer(c, res.registrationId!, { customerNumber: "20000077777" });
    assert.equal(picked.status, "ready");
    assert.deepEqual(shop.calls, []);
  });

  it("Passwort-Mail scheitert → Status Fehler", async () => {
    const shop = fakeShop([customer()], [], { resetFails: true });
    const res = await ingestRegistrationMail(ctx(shop, { autoExecute: true }), { buffer: mail("m6@x") });
    assert.equal(res.outcome, "failed");
    assert.deepEqual(categoriesForStatus("failed"), [PORTAL_REGISTRATION_CATEGORIES.failed]);
  });
});

describe("Portal-Registrierungen: n8n-Vorlage", () => {
  it("nutzt die METAorder-Endpunkte und Graph sendMail", () => {
    const wf = JSON.parse(fs.readFileSync(path.join(process.cwd(), "n8n-workflows/m365-portal-registrations.json"), "utf8"));
    const urls = wf.nodes.map((n: { parameters: { url?: string } }) => n.parameters.url ?? "").join("\n");
    for (const p of ["/api/b2b/registrations/n8n/config", "/api/b2b/registrations/n8n/intake", "/api/b2b/registrations/n8n/outbox", "/sendMail", "/move"]) {
      assert.ok(urls.includes(p), p);
    }
    const names = new Set(wf.nodes.map((n: { name: string }) => n.name));
    for (const [from, conn] of Object.entries(wf.connections as Record<string, { main: Array<Array<{ node: string }>> }>)) {
      assert.ok(names.has(from), from);
      for (const list of conn.main) for (const t of list) assert.ok(names.has(t.node), t.node);
    }
  });
});
