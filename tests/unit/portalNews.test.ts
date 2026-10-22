/**
 * Portal-Neuigkeiten: Einstellungen, KI-Antwort, Regeln ohne KI, Seiten-HTML, Shop-Schreiben und der ganze
 * Ablauf (mit Speicher-Repo, Schein-Shop und Schein-KI), dazu die n8n-Vorlage.
 *
 *   Ausführung: npm test
 */
import { beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PORTAL_NEWS_SETTINGS,
  PORTAL_NEWS_CATEGORIES,
  isPortalNewsIntakeCandidate,
  normalizePortalNewsSettings,
  portalNewsMessageFilter,
  type PortalNewsSettings,
} from "../../shared/portalNews";
import type { PortalNewsPostRow } from "../../shared/schema";

// ---- Speicher statt Datenbank ----
const mem = vi.hoisted(() => ({ rows: [] as any[], seq: 0 }));

vi.mock("../../server/b2b/portalNewsRepo", () => {
  const sameTenant = (r: any, tenantId: string | null) => (r.tenantId ?? null) === tenantId;
  const repo = {
    async findByMessageId(tenantId: string | null, messageId: string) {
      return mem.rows.find((r) => sameTenant(r, tenantId) && r.messageId === messageId) ?? null;
    },
    async get(tenantId: string | null, id: string) {
      return mem.rows.find((r) => sameTenant(r, tenantId) && r.id === id) ?? null;
    },
    async list(tenantId: string | null, status?: string) {
      return mem.rows
        .filter((r) => sameTenant(r, tenantId) && (!status || r.status === status))
        .sort((a, b) => (a.postDate === b.postDate ? b.receivedAt.getTime() - a.receivedAt.getTime() : a.postDate < b.postDate ? 1 : -1));
    },
    async insert(row: any) {
      if (mem.rows.some((r) => sameTenant(r, row.tenantId ?? null) && r.messageId === row.messageId)) return null;
      const now = new Date();
      const full = {
        id: `id-${++mem.seq}`,
        graphMessageId: null,
        mailbox: null,
        fromEmail: null,
        fromName: null,
        summary: "",
        sections: [],
        tags: [],
        note: null,
        events: [],
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        ...row,
        tenantId: row.tenantId ?? null,
      };
      mem.rows.push(full);
      return full;
    },
    async update(tenantId: string | null, id: string, patch: any, newEvents: any[] = []) {
      const row = mem.rows.find((r) => sameTenant(r, tenantId) && r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date(), events: [...row.events, ...newEvents] });
      return row;
    },
    async remove(tenantId: string | null, id: string) {
      const before = mem.rows.length;
      mem.rows = mem.rows.filter((r) => !(sameTenant(r, tenantId) && r.id === id));
      return mem.rows.length < before;
    },
  };
  return { portalNewsRepo: repo };
});

import { cleanSubject, extractNewsByRules, interpretNewsResponse, plausiblePostDate } from "../../server/b2b/portalNewsExtraction";
import { OPEN_POSTS, formatNewsDate, portalNewsPageHtml } from "../../server/b2b/portalNewsPageHtml";
import { PORTAL_NEWS_CMS_PAGE_ID, createPortalNewsShopApi, type PortalNewsShopApi } from "../../server/b2b/portalNewsShop";
import {
  berlinDate,
  deleteNews,
  ingestNewsMail,
  mailHeaderDate,
  portalNewsWorkflowConfig,
  setNewsStatus,
  updateNewsContent,
  type ServiceContext,
} from "../../server/b2b/portalNewsService";

// ---- Einstellungen ----
describe("Portal-Neuigkeiten: Einstellungen", () => {
  it("füllt Standardwerte auf und verwirft Unbrauchbares", () => {
    const s = normalizePortalNewsSettings({ enabled: true, maxPerRun: 999, sourceFolderName: "", processSince: "2026-10-01", extra: 1 });
    assert.equal(s.enabled, true);
    assert.equal(s.maxPerRun, DEFAULT_PORTAL_NEWS_SETTINGS.maxPerRun);
    assert.equal(s.sourceFolderName, DEFAULT_PORTAL_NEWS_SETTINGS.sourceFolderName);
    assert.equal(s.processSince, "2026-10-01");
    assert.equal(s.autoPublish, true);
    assert.equal("extra" in s, false);
  });

  it("Filter: ab Datum, ohne bereits markierte Mails", () => {
    const f = portalNewsMessageFilter("2026-10-01T00:00:00Z");
    assert.ok(f.startsWith("receivedDateTime ge 2026-10-01T00:00:00Z"));
    for (const c of Object.values(PORTAL_NEWS_CATEGORIES)) assert.ok(f.includes(`c eq '${c}'`), c);
    const cfg = portalNewsWorkflowConfig({ ...DEFAULT_PORTAL_NEWS_SETTINGS, mailbox: "o@meta-online.com", processSince: "2026-10-01" });
    assert.equal(cfg.graphBase, "https://graph.microsoft.com/v1.0/users/o%40meta-online.com");
    assert.equal(cfg.sourceFolderName, "METAorder Neuigkeiten");
  });
});

describe("Portal-Neuigkeiten: aus dem E-Mail-Eingang", () => {
  const on = { ...DEFAULT_PORTAL_NEWS_SETTINGS, enabled: true };
  const mail = (fromEmail: string | null, subject: string, body = "") => ({ fromEmail, subject, body });

  it("nur eingestellte Absender, nur mit Changelog-Hinweis, keine Termin-Antworten", () => {
    assert.equal(isPortalNewsIntakeCandidate(mail("SFehd@meta-online.com", "Regalplaner; Changelog Version 1.0.50"), on), true);
    assert.equal(isPortalNewsIntakeCandidate(mail("cwanzkeboomers@meta-online.com", "WG: Statusmeeting META Kundenportal", "Alles ist heute in zwei Releases live gegangen"), on), true);
    assert.equal(isPortalNewsIntakeCandidate(mail("cwanzkeboomers@meta-online.com", "Gitterrost vzk - Absprache Ablauf", "Wie gehen wir vor?"), on), false);
    assert.equal(isPortalNewsIntakeCandidate(mail("cwanzkeboomers@meta-online.com", "Abgesagt: Release-Planung"), on), false);
    assert.equal(isPortalNewsIntakeCandidate(mail("anton@wirduzen.de", "Changelog 3.2.79"), on), false);
    assert.equal(isPortalNewsIntakeCandidate(mail("sfehd@meta-online.com", "Changelog"), { ...on, fromIntake: false }), false);
    assert.equal(isPortalNewsIntakeCandidate(mail("sfehd@meta-online.com", "Changelog"), DEFAULT_PORTAL_NEWS_SETTINGS), false, "Abholen aus");
  });

  it("Absender-Liste: klein geschrieben, ungültige Adressen fallen auf den Standard zurück", () => {
    assert.deepEqual(normalizePortalNewsSettings({ intakeSenders: ["A@Meta-Online.com"] }).intakeSenders, ["a@meta-online.com"]);
    assert.deepEqual(normalizePortalNewsSettings({ intakeSenders: ["kein-mail"] }).intakeSenders, DEFAULT_PORTAL_NEWS_SETTINGS.intakeSenders);
  });

  it("Datum aus dem Mailkopf", () => {
    assert.equal(mailHeaderDate(Buffer.from("Date: Thu, 22 Oct 2026 12:21:56 +0200\r\n\r\nx"))?.toISOString(), "2026-10-22T10:21:56.000Z");
    assert.equal(mailHeaderDate(Buffer.from("Subject: x\r\n\r\n")), null);
  });
});

// ---- KI-Antwort und Regeln ----
describe("Portal-Neuigkeiten: Umschreiben", () => {
  const ok = {
    isChangelog: true,
    confidence: 0.9,
    reason: "Changelog",
    title: "  Merkliste im Portal  ",
    summary: "Händler können Artikel merken.",
    sections: [
      { heading: "Neu", items: ["Merkliste im Portal", "  ", "Export als PDF"] },
      { heading: "Behoben", items: [] },
    ],
    tags: ["Händlerportal", "Händlerportal", "Onlineshop", "A", "B"],
    postDate: "2026-10-20",
  };

  it("übernimmt eine gute Antwort und räumt auf", () => {
    const r = interpretNewsResponse(JSON.stringify(ok), "2026-10-21")!;
    assert.equal(r.content.title, "Merkliste im Portal");
    assert.equal(r.content.postDate, "2026-10-20");
    assert.deepEqual(r.content.sections, [{ heading: "Neu", items: ["Merkliste im Portal", "Export als PDF"] }]);
    assert.deepEqual(r.content.tags, ["Händlerportal", "Onlineshop", "A", "B"]);
  });

  it("verwirft Changelog ohne Punkte und Antworten ohne Einordnung", () => {
    assert.equal(interpretNewsResponse(JSON.stringify({ ...ok, sections: [] }), "2026-10-21"), null);
    assert.equal(interpretNewsResponse(JSON.stringify({ title: "x" }), "2026-10-21"), null);
    assert.equal(interpretNewsResponse("kein json", "2026-10-21"), null);
  });

  it("Datum nur, wenn plausibel", () => {
    assert.equal(plausiblePostDate("2026-02-30", "2026-10-21"), "2026-10-21");
    assert.equal(plausiblePostDate("2025-01-01", "2026-10-21"), "2026-10-21");
    assert.equal(plausiblePostDate(null, "2026-10-21"), "2026-10-21");
    assert.equal(plausiblePostDate("2026-10-14", "2026-10-21"), "2026-10-14");
  });

  it("ohne KI: Betreff als Titel, Aufzählung bis zur Signatur", () => {
    const r = extractNewsByRules(
      { subject: "WG: AW: Changelog KW 43", body: "Hallo,\n\n- Merkliste im Portal\n* Export als PDF\n1. Suche schneller\n\nViele Grüße\n- Signatur-Zeile" },
      "2026-10-21",
    );
    assert.equal(r.content.title, "Changelog KW 43");
    assert.deepEqual(r.content.sections[0].items, ["Merkliste im Portal", "Export als PDF", "Suche schneller"]);
    assert.equal(r.isChangelog, true);
    assert.equal(cleanSubject("Fwd: RE: Test"), "Test");
  });
});

// ---- Seite ----
describe("Portal-Neuigkeiten: Seiten-HTML", () => {
  const post = (i: number) => ({
    id: `post-${i}-0000000000`,
    postDate: `2026-10-${String(30 - i).padStart(2, "0")}`,
    title: `Beitrag ${i}`,
    summary: "",
    sections: [{ heading: "Neu", items: [`Punkt ${i}`] }],
    tags: [],
  });

  it("maskiert alle Texte aus Mail und KI", () => {
    const html = portalNewsPageHtml({
      title: "Neuigkeiten <b>",
      intro: "",
      posts: [{ ...post(1), title: '<img src=x onerror="alert(1)">', sections: [{ heading: "<script>", items: ["a & b"] }], tags: ["<i>"] }],
    });
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
    assert.ok(html.includes("a &amp; b"));
    assert.ok(html.includes("Neuigkeiten &lt;b&gt;"));
  });

  it("neueste offen, ältere zusammengeklappt, leere Seite mit Hinweis", () => {
    const posts = Array.from({ length: OPEN_POSTS + 2 }, (_, i) => post(i));
    const html = portalNewsPageHtml({ title: "Neuigkeiten", intro: "Intro", posts });
    const details = html.indexOf("<details");
    assert.ok(details > html.indexOf(`Beitrag ${OPEN_POSTS - 1}`));
    assert.ok(details < html.indexOf(`Beitrag ${OPEN_POSTS}`));
    assert.ok(html.includes("Ältere Neuigkeiten (2)"));
    assert.ok(portalNewsPageHtml({ title: "N", intro: "", posts: [] }).includes("Noch keine Neuigkeiten"));
    assert.equal(formatNewsDate("2026-03-05"), "5. März 2026");
  });
});

// ---- Shop ----
describe("Portal-Neuigkeiten: Erlebniswelt schreiben", () => {
  const fakeApi = (page: any) => {
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const api = async (method: string, p: string, body?: unknown) => {
      calls.push({ method, path: p, body });
      if (p === "search/cms-page") return { data: page ? [page] : [] };
      if (p === "search/category") return { data: [{ id: "cat1", name: "Neuigkeiten", translated: { name: "Neuigkeiten" } }] };
      return null;
    };
    return { api, calls };
  };

  it("legt die Seite einmal an (Typ Shopseite, feste ID)", async () => {
    const { api, calls } = fakeApi(null);
    assert.equal(await createPortalNewsShopApi(api).writePage("<p>x</p>"), "created");
    const post = calls.find((c) => c.method === "POST" && c.path === "cms-page")!;
    assert.equal(post.body.id, PORTAL_NEWS_CMS_PAGE_ID);
    assert.equal(post.body.type, "page");
    assert.equal(post.body.sections[0].blocks[0].slots[0].config.content.value, "<p>x</p>");
  });

  it("ersetzt danach nur den Inhalt – nie löschen (Kategorie-Zuordnung bleibt)", async () => {
    const slotId = (await (async () => {
      const { api, calls } = fakeApi(null);
      await createPortalNewsShopApi(api).writePage("a");
      return calls[1].body.sections[0].blocks[0].slots[0].id as string;
    })());
    const { api, calls } = fakeApi({ id: PORTAL_NEWS_CMS_PAGE_ID, sections: [{ blocks: [{ slots: [{ id: slotId }] }] }] });
    assert.equal(await createPortalNewsShopApi(api).writePage("b"), "updated");
    assert.ok(calls.some((c) => c.method === "PATCH" && c.path === `cms-slot/${slotId}` && c.body.config.content.value === "b"));
    assert.ok(!calls.some((c) => c.method === "DELETE"));

    const missing = fakeApi({ id: PORTAL_NEWS_CMS_PAGE_ID, sections: [] });
    assert.equal(await createPortalNewsShopApi(missing.api).writePage("c"), "repaired");
    assert.ok(missing.calls.some((c) => c.method === "PATCH" && c.path === `cms-page/${PORTAL_NEWS_CMS_PAGE_ID}`));
    assert.deepEqual(await createPortalNewsShopApi(missing.api).assignedCategories(), [{ id: "cat1", name: "Neuigkeiten" }]);
  });
});

// ---- Ablauf ----
function eml(messageId: string, subject: string, body: string, from = "Carolin Muster <carolin@agentur.example>"): Buffer {
  return Buffer.from(
    [`Message-ID: <${messageId}>`, `From: ${from}`, "To: o@meta-online.com", `Subject: ${subject}`, "Date: Tue, 20 Oct 2026 09:00:00 +0200", "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n"),
    "utf8",
  );
}

describe("Portal-Neuigkeiten: Ablauf", () => {
  let settingsStore: Record<string, unknown>;
  let written: string[];
  let shopFails: boolean;
  let llmAnswer: Record<string, unknown>;

  const shop: PortalNewsShopApi = {
    async pageState() {
      return { exists: written.length > 0, hasSlot: written.length > 0 };
    },
    async writePage(html) {
      if (shopFails) throw new Error("Shopware 500");
      written.push(html);
      return written.length === 1 ? "created" : "updated";
    },
    async assignedCategories() {
      return [];
    },
  };

  const ctx = (settings: Partial<PortalNewsSettings> = {}): ServiceContext => ({
    tenantId: "t1",
    settings: { ...DEFAULT_PORTAL_NEWS_SETTINGS, enabled: true, ...settings },
    userName: "admin",
    storage: {
      getSetting: async (key: string) => settingsStore[key],
      saveSetting: async (key: string, value: unknown) => {
        settingsStore[key] = value;
      },
    } as any,
    shopApi: async () => shop,
    llm: async () => JSON.stringify(llmAnswer),
  });

  beforeEach(() => {
    mem.rows = [];
    settingsStore = {};
    written = [];
    shopFails = false;
    llmAnswer = {
      isChangelog: true,
      confidence: 0.9,
      title: "Merkliste im Händlerportal",
      summary: "Händler können Artikel merken.",
      sections: [{ heading: "Neu", items: ["Artikel lassen sich auf eine Merkliste setzen."] }],
      tags: ["Händlerportal"],
      postDate: null,
    };
  });

  it("Mail → KI-Beitrag → sofort auf der Seite; zweite Lieferung ist ein Duplikat", async () => {
    const buffer = eml("cl-1@agentur", "Changelog KW 43", "- Merkliste\n- Export");
    const r = await ingestNewsMail(ctx(), { buffer, receivedAt: new Date("2026-10-20T07:00:00Z") });
    assert.equal(r.outcome, "published");
    assert.deepEqual(r.categories, [PORTAL_NEWS_CATEGORIES.published]);
    assert.equal(written.length, 1);
    assert.ok(written[0].includes("Merkliste im Händlerportal"));
    const row = mem.rows[0] as PortalNewsPostRow;
    assert.equal(row.postDate, "2026-10-20");
    assert.equal(row.fromEmail, "carolin@agentur.example");
    assert.equal(row.fromName, "Carolin Muster");
    assert.equal((settingsStore.portal_news_page_state as any).postCount, 1);

    const again = await ingestNewsMail(ctx(), { buffer });
    assert.equal(again.outcome, "duplicate");
    assert.equal(written.length, 1);
  });

  it("weitergeleiteter Changelog: Absender ist, wer geschickt hat, nicht der Dienstleister darin", async () => {
    const body = "Hallo zusammen,\n\nanbei der Changelog.\n\nVon: Anton von WIRDUZEN <anton@wirduzen.de>\nGesendet: Freitag, 16. Oktober 2026 09:36\nAn: Sebastian Fehd <sfehd@meta-online.com>\nBetreff: Report\n\n- Montagekosten in Tagessätzen";
    await ingestNewsMail(ctx(), { buffer: eml("fw@x", "WG: Report", body, "Sebastian Fehd <sfehd@meta-online.com>") });
    assert.equal(mem.rows[0].fromName, "Sebastian Fehd");
    assert.equal(mem.rows[0].fromEmail, "sfehd@meta-online.com");
    assert.ok(mem.rows[0].bodyText.includes("Montagekosten"), "ganzer Text geht an die KI");
  });

  it("Automatik aus, unsicher oder kein Changelog: Entwurf, Seite bleibt", async () => {
    const off = await ingestNewsMail(ctx({ autoPublish: false }), { buffer: eml("a@x", "Changelog", "- a") });
    assert.equal(off.outcome, "draft");
    llmAnswer = { ...llmAnswer, confidence: 0.3 };
    const unsure = await ingestNewsMail(ctx(), { buffer: eml("b@x", "Changelog", "- a") });
    assert.equal(unsure.outcome, "draft");
    llmAnswer = { isChangelog: false, confidence: 0.9, reason: "Terminabsprache", title: "", sections: [], tags: [] };
    const none = await ingestNewsMail(ctx(), { buffer: eml("c@x", "Termin", "Passt Donnerstag?") });
    assert.equal(none.outcome, "draft");
    assert.deepEqual(none.categories, [PORTAL_NEWS_CATEGORIES.draft]);
    assert.ok(String(mem.rows[2].note).includes("Kein Changelog"));
    assert.equal(written.length, 0);
  });

  it("aus dem E-Mail-Eingang: ohne Changelog kein Beitrag (auch kein Entwurf), mit Changelog veröffentlicht", async () => {
    llmAnswer = { isChangelog: false, confidence: 0.9, reason: "Rückfrage", title: "", sections: [], tags: [] };
    const none = await ingestNewsMail(ctx(), { buffer: eml("i1@x", "Release-Termin?", "Wann kommt das Release?") }, { dropIfNotChangelog: true });
    assert.equal(none.outcome, "not_changelog");
    assert.equal(mem.rows.length, 0);
    assert.equal(written.length, 0);
    llmAnswer = { isChangelog: true, confidence: 0.9, title: "Neu", summary: "", sections: [{ heading: "Neu", items: ["x"] }], tags: [] };
    const yes = await ingestNewsMail(ctx(), { buffer: eml("i2@x", "Changelog", "- x") }, { dropIfNotChangelog: true });
    assert.equal(yes.outcome, "published");
    assert.equal(written.length, 1);
  });

  it("aus dem E-Mail-Eingang ohne KI: kein grob gegliederter Entwurf", async () => {
    const r = await ingestNewsMail(
      { ...ctx(), llm: async () => { throw new Error("KI weg"); } },
      { buffer: eml("i3@x", "Changelog", "- a\n- b") },
      { dropIfNotChangelog: true },
    );
    assert.equal(r.outcome, "not_changelog");
    assert.equal(mem.rows.length, 0);
  });

  it("Shop-Fehler: Beitrag bleibt veröffentlicht, Fehler im Seitenstand und Verlauf", async () => {
    shopFails = true;
    const r = await ingestNewsMail(ctx(), { buffer: eml("d@x", "Changelog", "- a") });
    assert.equal(r.outcome, "published");
    assert.match(String((settingsStore.portal_news_page_state as any).lastError), /Shopware 500/);
    assert.ok(mem.rows[0].events.some((e: any) => e.type === "page_failed"));
  });

  it("Bearbeiten, Ausblenden und Löschen schreiben die Seite neu", async () => {
    await ingestNewsMail(ctx(), { buffer: eml("e@x", "Changelog", "- a") });
    const id = mem.rows[0].id;
    await updateNewsContent(ctx(), id, { postDate: "2026-10-19", title: "Neuer Titel", summary: "", sections: [{ heading: "", items: ["x"] }], tags: [] });
    assert.ok(written.at(-1)!.includes("Neuer Titel"));
    await setNewsStatus(ctx(), id, "hidden");
    assert.ok(!written.at(-1)!.includes("Neuer Titel"));
    await setNewsStatus(ctx(), id, "published");
    assert.ok(written.at(-1)!.includes("Neuer Titel"));
    const before = written.length;
    await deleteNews(ctx(), id);
    assert.equal(written.length, before + 1);
    assert.ok(written.at(-1)!.includes("Noch keine Neuigkeiten"));
  });

  it("Datum der Seite ist der deutsche Kalendertag", () => {
    assert.equal(berlinDate(new Date("2026-10-20T22:30:00Z")), "2026-10-21");
  });
});

// ---- n8n ----
describe("Portal-Neuigkeiten: n8n-Vorlage", () => {
  it("nutzt die METAorder-Endpunkte, liest den Ordner und verschiebt nichts", () => {
    const wf = JSON.parse(fs.readFileSync(path.join(process.cwd(), "n8n-workflows/m365-portal-news.json"), "utf8"));
    const urls = wf.nodes.map((n: { parameters: { url?: string } }) => n.parameters.url ?? "").join("\n");
    for (const p of ["/api/b2b/news/n8n/config", "/api/b2b/news/n8n/intake", "/mailFolders/{{ $json.folderId }}/messages"]) assert.ok(urls.includes(p), p);
    for (const p of ["/move", "/sendMail", "registrations"]) assert.ok(!urls.includes(p), p);
    const names = new Set(wf.nodes.map((n: { name: string }) => n.name));
    for (const [from, conn] of Object.entries(wf.connections as Record<string, { main: Array<Array<{ node: string }>> }>)) {
      assert.ok(names.has(from), from);
      for (const list of conn.main) for (const t of list) assert.ok(names.has(t.node), t.node);
    }
    assert.ok(JSON.stringify(wf).includes("received_at"));
    // Proxy bricht lange KI-Läufe ab (ECONNRESET): kein Fehlerlauf, die Mail kommt im nächsten Lauf als Duplikat
    const send = wf.nodes.find((n: { name: string }) => n.name === "An METAorder senden");
    assert.equal(send.onError, "continueRegularOutput");
  });
});
