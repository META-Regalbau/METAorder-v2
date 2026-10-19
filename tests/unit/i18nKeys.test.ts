/**
 * Uebersetzungsschluessel der Oberflaeche: jeder im Client verwendete Schluessel muss auf Deutsch
 * (Rueckfallsprache) als Text existieren - sonst zeigt die Oberflaeche den rohen Schluessel (z. B.
 * PAYMENTSTATUS.AUTHORIZED) oder auf Englisch/Spanisch den deutschen Standardtext aus dem Code.
 * Geprueft werden statische t("...")-Aufrufe und die dynamischen Schluessel, deren Werte feststehen
 * (Status, Prioritaeten, Automatisierungs-Katalog). Englisch und Spanisch muessen jeden deutschen
 * Schluessel mit denselben Platzhaltern enthalten.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ANALYTICS_INSIGHT_TYPES,
  ANALYTICS_QUERY_TYPES,
  IMPROVEMENT_CATEGORIES,
  IMPROVEMENT_PRIORITIES,
  NL_QUERY_ERROR_CODES,
} from "../../shared/schema";
import { nlImprovementCategoryKey, nlQueryTypeKey } from "../../client/src/lib/nlAnalytics";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_ACTIONS,
  AUTOMATION_FIELDS,
  AUTOMATION_OPERATORS,
  AUTOMATION_TRIGGER_TYPES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "../../shared/automation";
import { SHOP_WATCH_FINDING_CODES, SHOP_WATCH_GROUPS, SHOP_WATCH_KINDS, SHOP_WATCH_STATUSES } from "../../shared/shopWatch";
import {
  SHOP_PULSE_AI_REJECTIONS,
  SHOP_PULSE_CODES,
  SHOP_PULSE_LOSS_BASES,
  SHOP_PULSE_SEVERITIES,
  SHOP_PULSE_SOURCES,
  SHOP_PULSE_STATUSES,
} from "../../shared/shopPulse";
import { SHOP_PULSE_DETECTORS } from "../../server/shopPulse/detectors";
import {
  SHOP_PULSE_KEYWORD_MATCH_KINDS,
  SHOP_PULSE_KEYWORD_REASONS,
  SHOP_PULSE_KEYWORD_STATUSES,
  SHOP_PULSE_TICKET_PRIORITIES,
} from "../../shared/shopPulseHandoff";
import { SHOP_PULSE_REGULAR_STATES } from "../../shared/shopPulseRegulars";
import {
  SHOP_PULSE_ACTION_KINDS,
  SHOP_PULSE_ACTION_SCOPES,
  SHOP_PULSE_ACTION_SOURCES,
  SHOP_PULSE_IMPORT_SKIPS,
  SHOP_PULSE_NEXT_STEPS,
  SHOP_PULSE_OWNER_IDS,
} from "../../shared/shopPulseWeekly";

const ROOT = path.resolve(__dirname, "../..");
const flatten = (obj: Record<string, unknown>, prefix = ""): Record<string, unknown> =>
  Object.entries(obj).reduce<Record<string, unknown>>((out, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
    return out;
  }, {});
const locale = (lng: string) => flatten(JSON.parse(fs.readFileSync(path.join(ROOT, `client/src/i18n/locales/${lng}.json`), "utf8")));
const de = locale("de");
const missingIn = (keys: string[]) => keys.filter((k) => typeof de[k] !== "string");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** Statische Schluessel aus t("..."), t('...'), t(`...`) ohne ${} und i18nKey="..." (auch mit Standardtext im Code). */
function staticKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const call = /\bt\(\s*(['"`])([A-Za-z0-9_.-]+)\1/g;
  const attr = /i18nKey=\s*["']([A-Za-z0-9_.-]+)["']/g;
  for (const file of sourceFiles(path.join(ROOT, "client/src"))) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    for (const m of src.matchAll(call)) {
      if (!m[2].includes(".")) continue; // keine Schluessel-Form (z. B. t("x") als Variable)
      if (!keys.has(m[2])) keys.set(m[2], rel);
    }
    for (const m of src.matchAll(attr)) if (!keys.has(m[1])) keys.set(m[1], rel);
  }
  return keys;
}

const pascal = (s: string) => s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

describe("Uebersetzungsschluessel (Deutsch)", () => {
  it("jeder statisch verwendete Schluessel existiert als Text (auch mit Standardtext im Code)", () => {
    const keys = staticKeys();
    expect(keys.size).toBeGreaterThan(1000); // Plausibilitaet: die Suche findet die Aufrufe
    const missing = [...keys].filter(([k]) => typeof de[k] !== "string").map(([k, file]) => `${k} (${file})`);
    expect(missing).toEqual([]);
  });

  it("dynamische Schluessel mit festen Werten: Zahlungs-/Bestell-/Angebots-/Ticket-Status, Ratenplan", () => {
    expect(missingIn(PAYMENT_STATUSES.map((v) => `paymentStatus.${v}`))).toEqual([]);
    expect(missingIn(ORDER_STATUSES.flatMap((v) => [`status.${v}`, `orderStatus.${v}`]))).toEqual([]);
    const offerStatuses = ["draft", "submitted", "approved", "rejected", "sent", "offered", "accepted", "declined", "expired"];
    expect(missingIn(offerStatuses.map((v) => `offers.status.${v}`))).toEqual([]);
    expect(missingIn(TICKET_STATUSES.flatMap((v) => [`tickets.statusValues.${v}`, `tickets.status${pascal(v)}`]))).toEqual([]);
    expect(missingIn(TICKET_PRIORITIES.flatMap((v) => [`tickets.priorityValues.${v}`, `tickets.priority${pascal(v)}`]))).toEqual([]);
    expect(missingIn(TICKET_CATEGORIES.map((v) => `tickets.category${pascal(v)}`))).toEqual([]);
    expect(missingIn(["draft", "pending_confirmation", "active", "completed", "cancelled"].map((v) => `installmentPlan.status.${v}`))).toEqual([]);
    expect(missingIn(["pending", "sent", "paid", "overdue", "cancelled"].map((v) => `installmentPlan.invoiceStatus.${v}`))).toEqual([]);
  });

  it("Automatisierungs-Katalog: Ausloeser, Aktionen, Felder, Operatoren, Werte, Parameter", () => {
    const params = [...new Set(Object.values(AUTOMATION_ACTIONS).flatMap((a) => Object.keys(a.params ?? {})))];
    expect(missingIn([
      ...AUTOMATION_TRIGGER_TYPES.map((v) => `automation.triggers.${v}`),
      ...AUTOMATION_ACTION_TYPES.map((v) => `automation.actions.${v}`),
      ...Object.keys(AUTOMATION_FIELDS).map((v) => `automation.fields.${v}`),
      ...AUTOMATION_OPERATORS.map((v) => `automation.operators.${v}`),
      ...ORDER_STATUSES.map((v) => `automation.values.orderStatus.${v}`),
      ...PAYMENT_STATUSES.map((v) => `automation.values.paymentStatus.${v}`),
      ...params.map((v) => `automation.params.${v}`),
    ])).toEqual([]);
  });

  it("Lern-Insights: jeder vom Server erzeugte insightType hat Titel und Beschreibung", () => {
    const types = new Set<string>();
    for (const file of sourceFiles(path.join(ROOT, "server"))) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/insightType:\s*["']([a-z_]+)["']/g)) types.add(m[1]);
    }
    expect(types.size).toBeGreaterThanOrEqual(8); // Plausibilitaet: Angebote (4) und Cross-Selling (4)
    expect(missingIn([...types].flatMap((v) => [`insights.${v}.title`, `insights.${v}.description`]))).toEqual([]);
  });

  it("Statistik, Natuerliche Sprache: Abfragetypen, Fehlercodes, Hinweisarten, Vorschlaege, Beispielfragen", () => {
    expect(missingIn([
      ...ANALYTICS_QUERY_TYPES.map(nlQueryTypeKey),
      ...NL_QUERY_ERROR_CODES.map((v) => `analytics.nlQuery.errors.${v}`),
      ...ANALYTICS_INSIGHT_TYPES.map((v) => `analytics.nlQuery.insightTypes.${v}`),
      ...IMPROVEMENT_CATEGORIES.map(nlImprovementCategoryKey),
      ...IMPROVEMENT_PRIORITIES.map((v) => `analytics.nlQuery.improvements.${v}`),
      ...["q1", "q2", "q3", "q4", "q5", "q6"].map((v) => `analytics.nlQuery.examples.${v}`),
    ])).toEqual([]);
  });

  it("Shop-Wächter: Arten, Befunde, Gruppen, Status, Auslöser, Deploy-Felder, Reparatur", () => {
    expect(missingIn([
      ...SHOP_WATCH_KINDS.map((v) => `shopWatch.kinds.${v}`),
      ...SHOP_WATCH_FINDING_CODES.map((v) => `shopWatch.findings.${v}`),
      ...SHOP_WATCH_GROUPS.flatMap((v) => [`shopWatch.groups.${v}.title`, `shopWatch.groups.${v}.hint`]),
      ...SHOP_WATCH_STATUSES.map((v) => `shopWatch.status.${v}`),
      ...["manual", "schedule", "deploy"].map((v) => `shopWatch.trigger.${v}`),
      ...["shopwareVersion", "plugins", "themeAsset"].map((v) => `shopWatch.deploy.${v}`),
      ...["auto", "manual", "none"].map((v) => `shopWatch.repair.${v}`),
      ...["alert", "allClear", "deploy"].map((v) => `shopWatch.schedule.notice.${v}`),
    ])).toEqual([]);
  });

  it("Shop-Puls: Fund-Arten, Schwere, Quellen, Status, Prüfungen", () => {
    expect(missingIn([
      ...SHOP_PULSE_CODES.flatMap((v) => [`shopPulse.codes.${v}.title`, `shopPulse.codes.${v}.message`]),
      ...SHOP_PULSE_SEVERITIES.map((v) => `shopPulse.severity.${v}`),
      ...SHOP_PULSE_SOURCES.map((v) => `shopPulse.source.${v}`),
      ...SHOP_PULSE_STATUSES.map((v) => `shopPulse.status.${v}`),
      ...SHOP_PULSE_DETECTORS.map((d) => `shopPulse.detectors.names.${d.id}`),
      ...SHOP_PULSE_LOSS_BASES.map((v) => `shopPulse.lossBasis.${v}`),
      ...SHOP_PULSE_AI_REJECTIONS.map((v) => `shopPulse.signals.aiRejections.${v}`),
    ])).toEqual([]);
  });

  it("Shop-Puls Stufe 2: Reiter, Maßnahmen-Protokoll (Arten, Quellen, Bereiche, Import), Zuständige, nächste Schritte", () => {
    expect(missingIn([
      ...["signals", "weekly", "actions"].map((v) => `shopPulse.tabs.${v}`),
      ...SHOP_PULSE_ACTION_KINDS.map((v) => `shopPulse.actions.kinds.${v}`),
      ...SHOP_PULSE_ACTION_SOURCES.map((v) => `shopPulse.actions.sources.${v}`),
      ...SHOP_PULSE_ACTION_SCOPES.flatMap((v) => [`shopPulse.actions.scopeTypes.${v}`, `shopPulse.weekly.scope.${v}`]),
      ...SHOP_PULSE_ACTION_SCOPES.filter((v) => v !== "shop").map((v) => `shopPulse.actions.scopeValues.${v}`),
      ...SHOP_PULSE_IMPORT_SKIPS.map((v) => `shopPulse.actions.skip.${v}`),
      ...SHOP_PULSE_OWNER_IDS.map((v) => `shopPulse.weekly.owners.${v}`),
      ...SHOP_PULSE_NEXT_STEPS.map((v) => `shopPulse.weekly.nextSteps.${v}`),
    ])).toEqual([]);
  });

  it("Shop-Puls Stufe 3 (S3-1): Reiter, Ticket-Prioritäten, Suchwörter (Status, Zuordnung, Grund)", () => {
    expect(missingIn([
      ...["cart", "keywords", "regulars"].map((v) => `shopPulse.tabs.${v}`),
      ...SHOP_PULSE_REGULAR_STATES.map((v) => `shopPulse.regulars.states.${v}`),
      ...["notSellable", "longRestock", "longDelivery", "price"].map((v) => `shopPulse.regulars.causes.${v}`),
      ...SHOP_PULSE_TICKET_PRIORITIES.map((v) => `shopPulse.handoff.priorities.${v}`),
      ...SHOP_PULSE_KEYWORD_STATUSES.map((v) => `shopPulse.keywords.statuses.${v}`),
      ...SHOP_PULSE_KEYWORD_MATCH_KINDS.flatMap((v) => [`shopPulse.keywords.match.${v}`, `shopPulse.keywords.checked.${v}`]),
      ...SHOP_PULSE_KEYWORD_REASONS.map((v) => `shopPulse.keywords.reasons.${v}`),
    ])).toEqual([]);
  });

  it("Dokumenttypen der Shops (unbekannte zeigt die Detailansicht mit technischem Namen)", () => {
    const used = ["invoice", "delivery_note", "credit_note", "cancellation", "unknown", "pickware_erp_picklist", "partial_cancellation"];
    expect(missingIn(used.map((v) => `documentTypes.${v}`))).toEqual([]);
  });
});

describe("Uebersetzungsschluessel (Englisch, Spanisch)", () => {
  const placeholders = (s: string) => [...new Set([...s.matchAll(/\{\{\s*([\w.]+)/g)].map((m) => m[1]))].sort();
  const transTags = (s: string) => [...s.matchAll(/<\/?\d+\s*\/?>/g)].map((m) => m[0].replace(/\s/g, "")).sort();

  for (const lng of ["en", "es"]) {
    const other = locale(lng);

    it(`${lng}: jeder deutsche Schluessel existiert als Text`, () => {
      expect(Object.keys(de).length).toBeGreaterThan(3000);
      expect(Object.keys(de).filter((k) => typeof other[k] !== "string" || (other[k] === "" && de[k] !== ""))).toEqual([]);
    });

    it(`${lng}: Platzhalter und Trans-Markierungen wie auf Deutsch`, () => {
      const differ = Object.keys(de)
        .filter((k) => typeof de[k] === "string" && typeof other[k] === "string")
        .filter((k) => {
          const a = de[k] as string;
          const b = other[k] as string;
          return placeholders(a).join() !== placeholders(b).join() || transTags(a).join() !== transTags(b).join();
        });
      expect(differ).toEqual([]);
    });
  }

  it("Mehrzahl im Format von i18next 21+ (_one/_other), nicht mehr _plural", () => {
    const old = ["de", "en", "es"].flatMap((lng) => Object.keys(locale(lng)).filter((k) => k.endsWith("_plural")).map((k) => `${lng}: ${k}`));
    expect(old).toEqual([]);
  });
});
