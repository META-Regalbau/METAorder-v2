/**
 * Shop-Puls, KI-Texte (PR F): Zahlenprüfung, Verlust-Schätzung, KI-Aufruf mit Rückfall auf die Vorlage
 * und der Lauf mit gemocktem chatCompletion (server/shopPulse/shopPulseAi.ts, lossEstimate.ts).
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
const llm = vi.hoisted(() => ({
  configured: true,
  calls: [] as Array<{ messages: Array<{ role: string; content: string }> }>,
  reply: async (): Promise<string> => "{}",
}));
vi.mock("../../server/ai/llmChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/ai/llmChat")>();
  return {
    ...actual,
    isChatLlmConfigured: async () => llm.configured,
    chatCompletion: async (_getSetting: unknown, params: { messages: Array<{ role: string; content: string }> }) => {
      llm.calls.push({ messages: params.messages });
      return llm.reply();
    },
  };
});

import type { ShopPulseDetection, ShopPulseSignal } from "../../shared/shopPulse";
import { addDays, type PulseOrder } from "../../server/shopPulse/pulseOrders";
import { estimateLoss, paymentShare, usualRevenueAt } from "../../server/shopPulse/lossEstimate";
import {
  allowedNumbers,
  noticeAiText,
  noticePayload,
  shopPulseAiDeps,
  textNumbers,
  unknownNumbers,
  type NoticeAiInput,
} from "../../server/shopPulse/shopPulseAi";
import { runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { getShopPulseState, SHOP_PULSE_SETTINGS_KEY, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "../../server/shopPulse/shopPulseSettings";
import { getTeamsOutbox } from "../../server/lib/teamsOutbox";
import type { ReconcileResult } from "../../server/shopPulse/shopPulseSignals";

// Dienstag, 20.10.2026, 14:00 Berlin
const NOW = new Date("2026-10-20T14:00:00+02:00");
const WEBHOOK = "https://prod-00.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x";

/** An den letzten 8 Dienstagen je eine Bestellung um 14 Uhr über 240 €, „Vorkasse“ bzw. jede vierte „PayPal“ */
function tuesdayOrders(): PulseOrder[] {
  return Array.from({ length: 8 }, (_, k) => {
    const day = addDays("2026-10-20", -7 * (k + 1));
    return { orderNumber: `MO${k}`, createdAt: new Date(`${day}T12:00:00Z`), day, hour: 14, total: 240, paymentMethod: k % 4 === 0 ? "PayPal" : "Vorkasse" };
  });
}

function signal(over: Partial<ShopPulseSignal> = {}): ShopPulseSignal {
  return {
    id: "s1",
    key: "buyability:cart:probe",
    source: "buyability",
    code: "cartProbeCheckout",
    severity: "critical",
    status: "open",
    params: { failures: 3, response: "HTTP 500", term: "Regal", number: "1001" },
    evidence: { step: "checkout", status: 500, firstFailureAt: "2026-10-20T11:30:00.000Z" },
    lossPerHour: null,
    firstSeenAt: "2026-10-20T11:45:00.000Z",
    lastSeenAt: "2026-10-20T12:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    mutedUntil: null,
    notifiedAt: null,
    notifiedSeverity: null,
    ...over,
  };
}

const reply = (o: Record<string, string>) => JSON.stringify(o);
const VALID = {
  lage: "Die Warenkorb-Probe scheitert seit 3 Versuchen an der Kasse (HTTP 500).",
  ursache: "unklar",
  verlust: "rund 80 € pro Stunde",
  zustaendig: "Agentur wirduzen",
  naechsterSchritt: "Kasse im Shop selbst testen und die Agentur mit dem Fehler HTTP 500 beauftragen.",
};

// -------------------------------------------------------------------------------------------------

describe("Zahlen im Text", () => {
  it("liest deutsche Zahlen, Prozent, Datum und Uhrzeit; Ziffern in Namen zählen nicht", () => {
    const t = textNumbers("Seit 18.10.2026, 14:05 fehlen 1.234,50 € (12,5 %) bei 3 Artikeln; GA4 und SW10001 sind Namen, am 19.10. wieder.");
    expect(t.numbers).toEqual([1234.5, 12.5, 3]);
    expect(t.dates).toEqual(["18.10.2026", "19.10"]);
    expect(t.times).toEqual(["14:5"]);
  });

  it("vergleicht gegen die Eingabedaten: gerundet passt, erfunden nicht", () => {
    const allowed = allowedNumbers({ revenue: 1234.567, share: 0.04, at: "18.10.2026, 14:05", text: "z. B. 4711 (Fachbodenregal)" });
    expect(unknownNumbers("rund 1.235 € bzw. 1.234,57 €, Anteil 4 %, Artikel 4711, um 14:05 am 18.10.", allowed)).toEqual([]);
    expect(unknownNumbers("rund 1.300 €", allowed)).toEqual(["1300"]);
    expect(unknownNumbers("am 17.10.2026", allowed)).toEqual(["17.10.2026"]);
    expect(unknownNumbers("um 15:05", allowed)).toEqual(["15:5"]);
  });
});

// -------------------------------------------------------------------------------------------------

describe("Verlust-Schätzung", () => {
  const data = { orders: tuesdayOrders(), productRevenue: new Map([["A1", 36500], ["A2", 18250]]), now: NOW };

  it("üblicher Umsatz dieser Tageszeit: Stunde ±1 an 8 gleichen Wochentagen", () => {
    // 8 × 240 € in den Stunden 13–15 → 1.920 € / (3 × 8) = 80 € pro Stunde
    expect(usualRevenueAt(data.orders, NOW)).toBe(80);
    // um 3 Uhr nachts keine Bestellungen → keine Schätzung
    expect(usualRevenueAt(data.orders, new Date("2026-10-20T03:00:00+02:00"))).toBeNull();
  });

  it("Prüfung zuerst, dann Artikelumsatz, Zahlart-Anteil, Tageszeit; sonst keine", () => {
    expect(estimateLoss(signal({ lossPerHour: 312 }), data)).toEqual({ perHour: 312, basis: "detector" });
    // (36.500 + 18.250) × 1,19 / 365 / 12 = 14,88 → 15 € pro Stunde
    expect(estimateLoss(signal({ code: "productsSoldOut", evidence: { products: ["A1", "A2", "X"] } }), data)).toEqual({ perHour: 15, basis: "products" });
    expect(paymentShare(data.orders, "paypal", NOW)).toBe(0.25);
    expect(estimateLoss(signal({ code: "paymentGone", params: { method: "PayPal", perWeek: 3, days: 7 } }), data)).toEqual({ perHour: 20, basis: "paymentShare" });
    expect(estimateLoss(signal(), data)).toEqual({ perHour: 80, basis: "hourOfDay" });
    expect(estimateLoss(signal({ code: "weekOrdersDown" }), data)).toBeNull();
    expect(estimateLoss(signal({ code: "paymentGone", params: { method: "Rechnung" } }), data)).toBeNull();
    expect(estimateLoss(signal({ code: "productsSoldOut", evidence: { products: ["A1"] } }), { ...data, productRevenue: null })).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------------

describe("KI-Text einer Meldung", () => {
  const input: NoticeAiInput = { signal: signal(), estimate: { perHour: 80, basis: "hourOfDay" }, now: NOW, others: [], deploys: [], priceChanges: [] };

  it("Eingabedaten: Zeitpunkte deutsch in Berlin, keine Kundendaten, Verlust mit Grundlage", () => {
    const p = noticePayload(input) as any;
    expect(p.jetzt).toBe("20.10.2026, 14:00");
    expect(p.meldung.seit).toBe("20.10.2026, 13:45");
    expect(p.meldung.verlustProStunde.euro).toBe(80);
    expect(JSON.stringify(p)).not.toMatch(/@|customer|Kunde:/i);
  });

  it("gültige Antwort: Text mit Ursache, Schätzung, Zuständigem und nächstem Schritt", async () => {
    const r = await noticeAiText(input, async () => reply({ ...VALID, lage: `${VALID.lage} Erstmals am 20.10.2026, 13:45.` }));
    expect(r.rejected).toBeUndefined();
    expect(r.text).toContain("Verlust (Schätzung): rund 80 € pro Stunde");
    expect(r.text).toContain("Zuständig: Agentur wirduzen");
    expect(r.text).toContain("Ursache: unklar");
  });

  it("falsche Zahl → verworfen", async () => {
    const r = await noticeAiText(input, async () => reply({ ...VALID, verlust: "rund 95 € pro Stunde" }));
    expect(r).toEqual({ text: null, rejected: "number", badNumbers: ["95"] });
  });

  it("Zeitüberschreitung, Fehler, leer, zu lang, unbekannter Zuständiger → verworfen", async () => {
    expect((await noticeAiText(input, () => new Promise(() => undefined), 20)).rejected).toBe("timeout");
    expect((await noticeAiText(input, async () => Promise.reject(new Error("429")))).rejected).toBe("error");
    expect((await noticeAiText(input, async () => "")).rejected).toBe("empty");
    expect((await noticeAiText(input, async () => reply({ ...VALID, zustaendig: "IT-Abteilung" }))).rejected).toBe("empty");
    const long = "Die Kasse ist gestört. ".repeat(17);
    expect((await noticeAiText(input, async () => reply({ ...VALID, lage: long, ursache: long, naechsterSchritt: long }))).rejected).toBe("tooLong");
  });
});

// -------------------------------------------------------------------------------------------------
// Lauf mit gemocktem chatCompletion

function memoryStore() {
  const settings = new Map<string, any>();
  const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
  return {
    getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
    saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
  };
}

const CART_FINDING: ShopPulseDetection = {
  key: "buyability:cart:probe",
  source: "buyability",
  code: "cartProbeCheckout",
  severity: "critical",
  params: { failures: 3, response: "HTTP 500", term: "Regal", number: "1001" },
  evidence: { step: "checkout", status: 500 },
};

function setup(opts: { now?: Date; aiTexts?: boolean; findings?: ShopPulseDetection[] } = {}) {
  const store = memoryStore();
  const rows: ShopPulseSignal[] = [];
  const notifications: any[] = [];
  const now = opts.now ?? NOW;
  const findings = opts.findings ?? [CART_FINDING];
  const deps: ShopPulseDeps = {
    storage: {
      ...store,
      getAllTenants: async () => [{ id: "t1" }] as any,
      getShopwareSettings: async () => ({}) as any,
      getUsersWithPermissionInTenant: async () => [{ id: "admin-1", username: "admin", email: null }],
      createNotification: async (n: any) => {
        notifications.push(n);
        return { ...n, id: `n${notifications.length}`, createdAt: new Date() };
      },
      getShopwareSyncState: async () => null as any,
    } as any,
    repo: {
      listSignalsBySources: async (_t, sources) => structuredClone(rows.filter((r) => sources.includes(r.source))),
      listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
      applyReconcile: async (_t, result: ReconcileResult) => {
        rows.push(...structuredClone(result.inserts));
        for (const u of result.updates) Object.assign(rows.find((r) => r.id === u.id)!, structuredClone(u.patch));
      },
    },
    detectors: [{ id: "cartProbe", source: "buyability", run: async () => structuredClone(findings) }],
    loadOrders: async () => tuesdayOrders(),
    ai: {
      ...shopPulseAiDeps(store as any),
      saveNote: async (_t, id, note) => void Object.assign(rows.find((r) => r.id === id)!, { aiNote: structuredClone(note) }),
      priceChanges: async () => [],
      timeoutMs: 50,
    },
    onNotificationCreated: () => undefined,
    baseUrl: "https://app.example",
    now: () => now,
    newId: () => `id${rows.length + 1}`,
  };
  const settings = { enabled: true, learningUntil: "2026-10-01T00:00:00Z", teamsWebhookUrl: WEBHOOK, ...(opts.aiTexts === false ? { aiTexts: false } : {}) };
  const ready = store.saveSetting(SHOP_PULSE_SETTINGS_KEY, settings, "t1");
  const cards = async () => (await getTeamsOutbox(store, SHOP_PULSE_TEAMS_OUTBOX_KEY, "t1", now)).map((i) => JSON.stringify((i.message as any).attachments[0].content.body));
  return { store, rows, notifications, deps, ready, cards };
}

describe("Lauf mit KI-Texten (chatCompletion gemockt)", () => {
  beforeEach(() => {
    llm.configured = true;
    llm.calls = [];
    llm.reply = async () => reply(VALID);
  });

  it("gültiger KI-Text geht raus, wird gespeichert und im nächsten Takt nicht erneut erfragt", async () => {
    const { deps, rows, ready, cards, notifications } = setup();
    await ready;
    await runShopPulseForTenant(deps, "t1");
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].messages[1].content).toContain("Warenkorb-Probe");
    expect(rows[0].aiNote).toMatchObject({ severity: "critical", lossEstimate: { perHour: 80, basis: "hourOfDay" } });
    expect(rows[0].aiNote?.text).toContain("Zuständig: Agentur wirduzen");
    const [card] = await cards();
    expect(card).toContain("Nächster Schritt: Kasse im Shop selbst testen");
    expect(card).toContain("Zahlen gegen die Messwerte geprüft");
    expect(notifications[0].message).toContain("Verlust (Schätzung): rund 80 € pro Stunde");

    await runShopPulseForTenant(deps, "t1");
    expect(llm.calls).toHaveLength(1);
  });

  it("falsche Zahl → feste Vorlage mit Schätzung; verworfener Versuch gespeichert, kein zweiter Aufruf", async () => {
    llm.reply = async () => reply({ ...VALID, verlust: "rund 95 € pro Stunde" });
    const { deps, rows, ready, cards } = setup();
    await ready;
    await runShopPulseForTenant(deps, "t1");
    const [card] = await cards();
    expect(card).toContain("Kunden können vermutlich nicht bestellen");
    expect(card).toMatch(/rund 80\s€ pro Stunde \(Schätzung: üblicher Umsatz dieser Tageszeit\)/);
    expect(card).not.toContain("95");
    expect(rows[0].aiNote).toMatchObject({ text: null, rejected: "number", badNumbers: ["95"] });
    await runShopPulseForTenant(deps, "t1");
    expect(llm.calls).toHaveLength(1);
  });

  it("Zeitüberschreitung und leere Antwort → Vorlage", async () => {
    llm.reply = () => new Promise(() => undefined);
    const a = setup();
    await a.ready;
    await runShopPulseForTenant(a.deps, "t1");
    expect(a.rows[0].aiNote?.rejected).toBe("timeout");
    expect((await a.cards())[0]).toContain("Kunden können vermutlich nicht bestellen");

    llm.reply = async () => "";
    const b = setup();
    await b.ready;
    await runShopPulseForTenant(b.deps, "t1");
    expect(b.rows[0].aiNote?.rejected).toBe("empty");
    expect((await b.cards())[0]).toContain("Kunden können vermutlich nicht bestellen");
  });

  it("Schalter aus oder kein Anbieter → kein Aufruf, Vorlage", async () => {
    const off = setup({ aiTexts: false });
    await off.ready;
    await runShopPulseForTenant(off.deps, "t1");
    llm.configured = false;
    const none = setup();
    await none.ready;
    await runShopPulseForTenant(none.deps, "t1");
    expect(llm.calls).toHaveLength(0);
    expect(off.rows[0].aiNote ?? null).toBeNull();
    expect((await none.cards())[0]).toContain("Kunden können vermutlich nicht bestellen");
  });

  it("Schwere steigt → ein neuer Aufruf; Warnung bekommt ihren Text im Nachzug", async () => {
    const finding = { ...CART_FINDING, severity: "warning" as const };
    const { deps, rows, ready } = setup({ findings: [finding] });
    await ready;
    await runShopPulseForTenant(deps, "t1");
    // Warnung: keine Sofort-Meldung, aber Text für die Seite
    expect(llm.calls).toHaveLength(1);
    expect(rows[0].aiNote?.severity).toBe("warning");
    deps.detectors = [{ id: "cartProbe", source: "buyability", run: async () => [{ ...CART_FINDING }] }];
    await runShopPulseForTenant(deps, "t1");
    expect(llm.calls).toHaveLength(2);
    expect(rows[0].aiNote?.severity).toBe("critical");
  });

  it("Tagesbericht: geprüfte KI-Zusammenfassung über den Zahlen; falsche Zahl → ohne", async () => {
    const now = new Date("2026-10-20T08:15:00+02:00");
    llm.reply = async () =>
      llm.calls.length === 1
        ? reply(VALID)
        : reply({ zusammenfassung: "Gestern 0 Bestellungen; offen ist 1 kritische Meldung zur Kasse.", naechsterSchritt: "Agentur wirduzen prüft die Kasse." });
    const { deps, store, ready, cards } = setup({ now });
    await ready;
    await runShopPulseForTenant(deps, "t1");
    const daily = (await cards()).find((c) => c.includes("Tagesbericht"))!;
    expect(daily).toContain("offen ist 1 kritische Meldung zur Kasse");
    expect((await getShopPulseState(store, "t1")).lastDailyAi?.rejected).toBeUndefined();

    llm.calls = [];
    llm.reply = async () => reply({ zusammenfassung: "Gestern 7 Bestellungen.", naechsterSchritt: "Oliver prüft." });
    const b = setup({ now, findings: [] });
    await b.ready;
    await runShopPulseForTenant(b.deps, "t1");
    const dailyB = (await b.cards()).find((c) => c.includes("Tagesbericht"))!;
    expect(dailyB).not.toContain("Gestern 7 Bestellungen");
    expect((await getShopPulseState(b.store, "t1")).lastDailyAi).toMatchObject({ text: null, rejected: "number" });
  });
});
