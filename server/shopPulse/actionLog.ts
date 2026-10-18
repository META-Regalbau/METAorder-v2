/**
 * Shop-Puls Stufe 2 (S2-1), Maßnahmen-Protokoll: Einträge aus den automatischen Quellen bauen (rein, ohne
 * Datenbank; Tests in tests/unit/shopPulseActions.test.ts). Jeder Eintrag hat einen festen Schlüssel je
 * Quelle, darüber vermeidet actionLogRepository.ts Dubletten:
 *
 * - Live-Veröffentlichung eines Shop-Inhalts: content:<Veröffentlichung>, Rücknahme content:<…>:revert
 * - von Hand erledigte Shop-Puls-Meldung: signal:<Meldung>:<erledigt am> (öffnet sie wieder und wird erneut
 *   erledigt, ist das eine neue Maßnahme)
 * - Deploy laut Shop-Wächter: deploy:<Start des Wächter-Laufs>
 * - Preisänderungen aus der Preis-Historie, je Kalendertag (Berlin) zusammengefasst: prices:<Tag>. Nur
 *   abgeschlossene Tage, sonst fehlten spätere Änderungen desselben Tages.
 *
 * Texte sind deutsch (das Protokoll ist eine Liste von Fakten, wie die Live-Protokolle). Der Bereich ist genau
 * eine Art: Seiten, Artikel, Kanal oder der ganze Shop.
 */
import type { ShopWatchDeployChange } from "@shared/shopWatch";
import { normalizeActionScope, type ShopPulseAction, type ShopPulseActionScope } from "@shared/shopPulseWeekly";
import type { ShopPulseSignal } from "@shared/shopPulse";
import { berlinTime } from "./pulseOrders";
import { productNumbersOf } from "./lossEstimate";
import { signalMessage, signalTitle } from "./shopPulseNotify";

export type ActionCandidate = Omit<ShopPulseAction, "id" | "createdAt" | "updatedAt" | "createdBy" | "sourceKey"> & { sourceKey: string };

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BERLIN_DATE = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const germanDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const SHOP: ShopPulseActionScope = { type: "shop", values: [] };

// ---------------------------------------------------------------------------------------------
// Shop-Inhalte

export type PublicationRow = {
  id: string;
  target: string;
  status: string;
  publishedAt: Date;
  publishedByName: string | null;
  revertedAt: Date | null;
  revertedByName: string | null;
  itemKind: string | null;
  itemKey: string | null;
  itemName: string | null;
  versionNo: number | null;
  /** Adresse der Seite aus der veröffentlichten Version (Branchenseiten) */
  url: string | null;
};

/** Seiten eines Shop-Inhalts: Branchenseite ihre Adresse, Startseiten-Abschnitte „/“, gemeinsame Texte alle Branchenseiten */
export function publicationScope(p: Pick<PublicationRow, "itemKind" | "url">, industryUrls: string[]): ShopPulseActionScope {
  if (p.itemKind === "industry_page" && p.url) return normalizeActionScope({ type: "pages", values: [p.url] });
  if (p.itemKind?.startsWith("home_")) return { type: "pages", values: ["/"] };
  if (p.itemKind === "common" && industryUrls.length) return normalizeActionScope({ type: "pages", values: industryUrls });
  return SHOP;
}

/** Live-Veröffentlichungen (erfolgreich, auch später zurückgenommene) und Rücknahmen */
export function actionsFromPublications(rows: PublicationRow[], industryUrls: string[]): ActionCandidate[] {
  const out: ActionCandidate[] = [];
  for (const p of rows) {
    if (p.target !== "live" || (p.status !== "ok" && p.status !== "reverted")) continue;
    const name = p.itemName?.trim() || p.itemKey || "Shop-Inhalt";
    const version = p.versionNo != null ? ` (Version ${p.versionNo})` : "";
    const scope = publicationScope(p, industryUrls);
    out.push({
      occurredAt: p.publishedAt.toISOString(),
      kind: "contentPublish",
      title: `Live veröffentlicht: ${name}${version}`,
      description: `Shop-Inhalte in METAorder: „${name}“${version} in den Live-Shop geschrieben.`,
      scope,
      source: "shopContent",
      sourceKey: `content:${p.id}`,
      actor: p.publishedByName?.trim() || null,
    });
    if (p.revertedAt) {
      out.push({
        occurredAt: p.revertedAt.toISOString(),
        kind: "contentRevert",
        title: `Zurückgenommen: ${name}${version}`,
        description: `Shop-Inhalte in METAorder: Veröffentlichung vom ${BERLIN_DATE.format(p.publishedAt)} im Live-Shop zurückgenommen.`,
        scope,
        source: "shopContent",
        sourceKey: `content:${p.id}:revert`,
        actor: p.revertedByName?.trim() || null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Shop-Puls-Meldungen

/** Bereich einer Meldung: betroffene Artikel, sonst Seite (Produktseiten-Prüfung), sonst der ganze Shop */
export function signalScope(s: Pick<ShopPulseSignal, "params" | "evidence">): ShopPulseActionScope {
  const products = [...(typeof s.params.number === "string" && s.params.number ? [s.params.number] : []), ...productNumbersOf(s.evidence)];
  if (products.length) return normalizeActionScope({ type: "products", values: products });
  const url = typeof s.evidence.url === "string" ? s.evidence.url : typeof s.params.url === "string" ? s.params.url : "";
  if (url) return normalizeActionScope({ type: "pages", values: [url] });
  return SHOP;
}

/** Von Hand erledigte Meldungen (resolvedBy gesetzt); von selbst verschwundene Funde sind keine Maßnahme */
export function actionsFromResolvedSignals(signals: ShopPulseSignal[]): ActionCandidate[] {
  return signals
    .filter((s) => s.status === "resolved" && s.resolvedBy && s.resolvedAt)
    .map((s) => ({
      occurredAt: s.resolvedAt!,
      kind: "signalResolved" as const,
      title: `Meldung erledigt: ${signalTitle(s)}`,
      description: signalMessage(s),
      scope: signalScope(s),
      source: "shopPulse" as const,
      sourceKey: `signal:${s.id}:${s.resolvedAt}`,
      actor: s.resolvedBy,
    }));
}

// ---------------------------------------------------------------------------------------------
// Deploys

export type DeployEntry = { startedAt: string; deployChanges?: ShopWatchDeployChange[] | null };

const DEPLOY_FIELD: Record<ShopWatchDeployChange["field"], string> = {
  shopwareVersion: "Shopware-Version",
  plugins: "Plugins",
  themeAsset: "Theme",
};

/** Vom Shop-Wächter erkannte Deploys (Fingerabdruck geändert); wer deployt hat, weiß der Wächter nicht */
export function actionsFromDeploys(history: DeployEntry[]): ActionCandidate[] {
  return history
    .filter((h) => h.deployChanges?.length && !Number.isNaN(Date.parse(h.startedAt)))
    .map((h) => {
      const changes = h.deployChanges!;
      const fields = Array.from(new Set(changes.map((c) => DEPLOY_FIELD[c.field] ?? c.field)));
      return {
        occurredAt: new Date(h.startedAt).toISOString(),
        kind: "deploy" as const,
        title: `Deploy erkannt: ${fields.join(", ")}`,
        description: changes.map((c) => `${DEPLOY_FIELD[c.field] ?? c.field}: ${c.before || "–"} → ${c.after || "–"}`.slice(0, 400)).join("\n"),
        scope: SHOP,
        source: "shopWatch" as const,
        sourceKey: `deploy:${h.startedAt}`,
        actor: null,
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Preisänderungen

export type PriceChangeRow = { productNumber: string; oldPriceGross: number | null; newPriceGross: number; changedAt: Date };

/** So viele Änderungen stehen in der Beschreibung; alle Artikel im Bereich */
const PRICE_LISTED = 15;

/** Preisänderungen je abgeschlossenem Kalendertag (Berlin) zu einem Eintrag; je Artikel die letzte Änderung des Tages */
export function actionsFromPriceChanges(changes: PriceChangeRow[], now: Date): ActionCandidate[] {
  const today = berlinTime(now).day;
  const byDay = new Map<string, Map<string, { first: PriceChangeRow; last: PriceChangeRow }>>();
  for (const c of [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())) {
    const day = berlinTime(c.changedAt).day;
    if (day >= today) continue;
    const products = byDay.get(day) ?? new Map();
    byDay.set(day, products);
    const prev = products.get(c.productNumber);
    products.set(c.productNumber, { first: prev?.first ?? c, last: c });
  }
  const out: ActionCandidate[] = [];
  for (const [day, products] of Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const list = Array.from(products.entries()).sort(([a], [b]) => a.localeCompare(b));
    const latest = list.reduce((t, [, c]) => Math.max(t, c.last.changedAt.getTime()), 0);
    const lines = list
      .slice(0, PRICE_LISTED)
      .map(([pn, c]) => `${pn}: ${c.first.oldPriceGross != null ? EURO.format(c.first.oldPriceGross) : "–"} → ${EURO.format(c.last.newPriceGross)}`);
    if (list.length > PRICE_LISTED) lines.push(`… und ${list.length - PRICE_LISTED} weitere`);
    out.push({
      occurredAt: new Date(latest).toISOString(),
      kind: "priceChanges",
      title: `Preisänderungen am ${germanDay(day)}: ${list.length} Artikel`,
      description: `Laut Preis-Historie des Produktspiegels (brutto):\n${lines.join("\n")}`,
      scope: normalizeActionScope({ type: "products", values: list.map(([pn]) => pn) }),
      source: "priceHistory",
      sourceKey: `prices:${day}`,
      actor: null,
    });
  }
  return out;
}

/** Je Schlüssel nur der erste Eintrag, und nur die, die es noch nicht gibt */
export function newCandidates(candidates: ActionCandidate[], existingKeys: Set<string>): ActionCandidate[] {
  const seen = new Set(existingKeys);
  const out: ActionCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.sourceKey)) continue;
    seen.add(c.sourceKey);
    out.push(c);
  }
  return out;
}
