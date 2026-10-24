/**
 * Shop-Puls Stufe 2 (S2-3), B2B-Warenkorb-Alarm: reine Logik ohne Datenbank (Tests in
 * tests/unit/shopPulseCartAlarm.test.ts). Regeln in shared/shopPulseCart.ts; Speicherung und Lauf in
 * cartAlarmRun.ts, Webhook in server/routes/shopPulseCartRoutes.ts.
 *
 * - Signatur: HMAC-SHA256 über „<Zeitstempel>.<Body>“ mit dem Schlüssel des Mandanten (wie das Plugin,
 *   CartSignalSigner.php), Zeitstempel höchstens 5 Minuten daneben.
 * - Alarm: Warenkorb ab Schwelle (netto), seit der Wartezeit unverändert, höchstens 7 Tage alt, seitdem keine
 *   Bestellung des Kunden (Bestellspiegel oder Meldung „bestellt“ des Plugins), je Kunde höchstens einer in 7
 *   Tagen und nie zweimal für denselben Warenkorb.
 * - Empfänger: Außendienst laut Zuordnung (Kundennummer), sonst Ersatz-Empfänger, sonst Oliver.
 * - Erfolg: Bestellung des Kunden binnen 14 Tagen nach dem Alarm → Eintrag im Maßnahmen-Protokoll.
 */
import { createHmac, timingSafeEqual } from "crypto";
import {
  SHOP_PULSE_CART_RULES as RULES,
  type ShopPulseCart,
  type ShopPulseCartRecipientSource,
  type ShopPulseCartSettings,
  type ShopPulseCartState,
} from "@shared/shopPulseCart";
import { normalizeActionScope } from "@shared/shopPulseWeekly";
import type { ActionCandidate } from "./actionLog";
import { createWindowRateLimiter } from "../lib/windowRateLimit";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------------------------
// Signatur

export type CartSignatureCheck = "ok" | "missing" | "badTimestamp" | "badSignature";

export function signCartBody(secret: string, timestamp: number, body: string | Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}

/** Signatur und Zeitstempel prüfen (Header X-Meta-Timestamp und X-Meta-Signature „sha256=<hex>“) */
export function verifyCartSignature(secret: string, timestampHeader: unknown, signatureHeader: unknown, body: Buffer, now: Date): CartSignatureCheck {
  if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string" || !secret) return "missing";
  const ts = Number(timestampHeader);
  if (!/^\d{9,11}$/.test(timestampHeader) || Math.abs(now.getTime() / 1000 - ts) > RULES.maxClockSkewSeconds) return "badTimestamp";
  const given = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return "badSignature";
  const expected = Buffer.from(signCartBody(secret, ts, body), "hex");
  return timingSafeEqual(expected, Buffer.from(given, "hex")) ? "ok" : "badSignature";
}

// ---------------------------------------------------------------------------------------------
// Rate-Limit je Mandant (im Speicher, je Minute)

// Gezählt wird erst nach geprüfter Signatur (Schlüssel = Mandant), siehe shopPulseCartRoutes/customerMailRoutes:
// sonst könnten Fremde mit der Mandanten-ID die Quote aufbrauchen. Obergrenze für die Zahl der Schlüssel.
const cartSignalLimiter = createWindowRateLimiter({ windowMs: 60_000, max: RULES.ratePerMinute, maxKeys: 1_000 });

export function cartSignalRateOk(key: string, now = Date.now()): boolean {
  return cartSignalLimiter.hit(key, now);
}

/** Mandanten-IDs sind UUIDs; alles andere wird vor jeder Datenbankabfrage abgewiesen. */
export function isTenantIdHeader(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ---------------------------------------------------------------------------------------------
// Stand und Planung

/** Eine Bestellung eines Kunden (Bestellspiegel, MO) */
export type CustomerOrder = { customerNumber: string; orderNumber: string; createdAt: Date };

const time = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

export function cartState(cart: Pick<ShopPulseCart, "netTotal" | "alarmedAt" | "orderedAt">, settings: Pick<ShopPulseCartSettings, "thresholdNet">): ShopPulseCartState {
  if (cart.orderedAt) return cart.alarmedAt && time(cart.orderedAt) >= time(cart.alarmedAt) ? "won" : "ordered";
  if (cart.alarmedAt) return "alarmed";
  return cart.netTotal >= settings.thresholdNet ? "waiting" : "below";
}

const normNumber = (v: string) => v.trim().toUpperCase();

/** Erste Bestellung des Kunden ab dem Zeitpunkt */
function firstOrderSince(orders: CustomerOrder[], customerNumber: string, since: number): CustomerOrder | null {
  const key = normNumber(customerNumber);
  let best: CustomerOrder | null = null;
  for (const o of orders) {
    if (normNumber(o.customerNumber) !== key || o.createdAt.getTime() < since) continue;
    if (!best || o.createdAt < best.createdAt) best = o;
  }
  return best;
}

export type CartPlan = {
  /** Warenkörbe, für die ein Alarm geht */
  alarm: ShopPulseCart[];
  /** Warenkörbe, die inzwischen bestellt wurden (laut Spiegel): Bestellnummer und Zeitpunkt eintragen */
  ordered: Array<{ id: string; orderNumber: string; orderedAt: Date }>;
  /** Erfolge: Bestellung binnen 14 Tagen nach dem Alarm */
  won: Array<{ cart: ShopPulseCart; orderNumber: string; orderedAt: Date }>;
};

export function planCartAlarms(carts: ShopPulseCart[], orders: CustomerOrder[], settings: ShopPulseCartSettings, now: Date): CartPlan {
  const plan: CartPlan = { alarm: [], ordered: [], won: [] };
  const nowMs = now.getTime();
  for (const cart of carts) {
    const updated = time(cart.cartUpdatedAt);
    const alarmed = time(cart.alarmedAt);
    // Erfolg nach einem Alarm: Bestellung im Spiegel oder Meldung „bestellt“ binnen 14 Tagen
    if (!Number.isNaN(alarmed)) {
      const viaMirror = firstOrderSince(orders, cart.customerNumber, alarmed);
      const viaShop = cart.orderedAt && time(cart.orderedAt) >= alarmed ? { orderNumber: cart.orderNumber ?? "", createdAt: new Date(cart.orderedAt) } : null;
      const hit = [viaMirror, viaShop].filter((o): o is { orderNumber: string; createdAt: Date } => !!o).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (hit && hit.createdAt.getTime() <= alarmed + RULES.successDays * DAY_MS) plan.won.push({ cart, orderNumber: hit.orderNumber, orderedAt: hit.createdAt });
    }
    if (cart.orderedAt) continue;
    const order = firstOrderSince(orders, cart.customerNumber, updated);
    if (order) {
      plan.ordered.push({ id: cart.id, orderNumber: order.orderNumber, orderedAt: order.createdAt });
      continue;
    }
    if (cart.netTotal < settings.thresholdNet) continue;
    if (updated > nowMs - settings.waitHours * HOUR_MS || updated < nowMs - RULES.maxCartAgeDays * DAY_MS) continue;
    if (!Number.isNaN(alarmed) && (alarmed > nowMs - RULES.alarmEveryDays * DAY_MS || updated <= alarmed)) continue;
    plan.alarm.push(cart);
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Empfänger

export type CartRecipient = { source: ShopPulseCartRecipientSource; name: string; email: string | null };

export function recipientFor(customerNumber: string, reps: Map<string, { name: string; email: string }>, settings: Pick<ShopPulseCartSettings, "fallbackEmail" | "fallbackName">): CartRecipient {
  const rep = reps.get(normNumber(customerNumber));
  if (rep?.email) return { source: "rep", name: rep.name || rep.email, email: rep.email };
  if (settings.fallbackEmail) return { source: "fallback", name: settings.fallbackName || settings.fallbackEmail, email: settings.fallbackEmail };
  return { source: "oliver", name: "Oliver", email: null };
}

// ---------------------------------------------------------------------------------------------
// Texte (deutsch: interne Nachricht an den Außendienst)

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const BERLIN = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const POSITIONS_LISTED = 8;

export function cartAlarmSubject(cart: ShopPulseCart): string {
  return `Warenkorb-Alarm: ${cart.company || cart.contactName || "Kunde"} (${cart.customerNumber}), ${EURO.format(cart.netTotal)} netto`;
}

/** Empfehlung nach Inhalt: große Mengen → Staffelpreis, immer Lieferzeit */
export function cartRecommendation(cart: Pick<ShopPulseCart, "positions" | "netTotal">): string {
  const bulk = cart.positions.some((p) => p.quantity >= 10);
  return bulk || cart.netTotal >= 2500
    ? "Kurz anrufen: Lieferzeit erfragen bzw. nennen und einen Staffelpreis anbieten."
    : "Kurz anrufen: offene Fragen klären und die Lieferzeit nennen.";
}

export function cartAlarmLines(cart: ShopPulseCart, recipient: CartRecipient): string[] {
  const lines = [
    `Für: ${recipient.name}${recipient.source === "rep" ? " (Außendienst laut Zuordnung)" : recipient.source === "fallback" ? " (Ersatz-Empfänger, keine Zuordnung)" : " (keine Zuordnung)"}`,
    `Kunde: ${cart.company || "–"}, Kundennummer ${cart.customerNumber}`,
    `Ansprechpartner: ${[cart.contactName, cart.contactEmail, cart.contactPhone].filter(Boolean).join(", ") || "–"}`,
    `Warenkorb: ${EURO.format(cart.netTotal)} netto, ${cart.positionCount} Position(en), unverändert seit ${BERLIN.format(new Date(cart.cartUpdatedAt))}`,
    ...cart.positions.slice(0, POSITIONS_LISTED).map((p) => `- ${p.quantity} × ${p.label || p.productNumber} (${p.productNumber}): ${EURO.format(p.netTotal)}`),
  ];
  if (cart.positions.length > POSITIONS_LISTED) lines.push(`- … und ${cart.positions.length - POSITIONS_LISTED} weitere`);
  lines.push(`Empfehlung: ${cartRecommendation(cart)}`);
  lines.push("Seitdem keine Bestellung dieses Kunden. Der Kunde wurde nicht automatisch angeschrieben.");
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Maßnahmen-Protokoll

/** Erfolg als Maßnahme (fester Schlüssel je Kunde und Alarm) */
export function cartWonAction(won: CartPlan["won"][number]): ActionCandidate {
  const c = won.cart;
  return {
    occurredAt: won.orderedAt.toISOString(),
    kind: "cartAlarmWon",
    title: `Warenkorb-Alarm erfolgreich: ${c.company || c.customerNumber} hat bestellt${won.orderNumber ? ` (${won.orderNumber})` : ""}`,
    description: `Alarm am ${BERLIN.format(new Date(c.alarmedAt!))} an ${c.alarmRecipient ?? "–"}; Warenkorb ${EURO.format(c.netTotal)} netto, Kundennummer ${c.customerNumber}.`,
    scope: normalizeActionScope({ type: "products", values: c.positions.map((p) => p.productNumber) }),
    source: "cartAlarm",
    sourceKey: `cartAlarm:${c.customerNumber}:${c.alarmedAt}`,
    actor: c.alarmRecipient,
  };
}
