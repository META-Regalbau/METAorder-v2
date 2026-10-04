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
