/**
 * Kundenmails: Einwilligung über die Bestätigungsmail des Shops (Double-Opt-in). Erfasst der Außendienst eine
 * Einwilligung, löst METAorder im Shop die Newsletter-Anmeldung aus (Store-API newsletter/subscribe im Kanal
 * „META Regalbau DE“). Shopware schickt die Bestätigungsmail; erst nach dem Klick ist die Anmeldung bestätigt und
 * zählt beim nächsten Abgleich als Einwilligung. Das Brevo-Plugin hebt dann auch die Brevo-Sperre auf.
 * Vermerk und Zeitpunkt stehen am Kontakt (consent_note, doi_requested_at), die Einwilligung selbst (consent_at)
 * setzt erst der Abgleich.
 */
import { and, eq, isNull, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";
import { findDeChannel, shopApi } from "../shopContent/shopProducts";
import { marketingContacts, type MarketingContactRow } from "@shared/schema";
import { normalizeEmail } from "./legalBasis";
import { CustomerMailError, type CustomerMailDeps } from "./customerMailsRun";

const log = logger.child({ component: "customerMails/consentDoi" });
const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

/** Vor- und Nachname aus „Vorname Nachname“ (Shopware verlangt beides nicht, nutzt es aber zur Ansprache) */
export function splitName(full: string | null | undefined): { firstName?: string; lastName?: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return {};
  return { firstName: parts.slice(0, -1).join(" ").slice(0, 100), lastName: parts[parts.length - 1].slice(0, 100) };
}

export async function requestConsentDoi(
  deps: CustomerMailDeps,
  tenantId: string | null,
  input: { email: string; note: string },
  by: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketingContactRow> {
  const email = normalizeEmail(input.email);
  if (!email) throw new CustomerMailError("invalidEmail");
  const settings = await deps.storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error("Shopware not configured");
  const { api, base } = shopApi(settings);
  const de = await findDeChannel(api, base);
  const channel = await api("POST", "search/sales-channel", { ids: [de.id], includes: { sales_channel: ["id", "accessKey"] } });
  const accessKey = channel?.data?.[0]?.accessKey;
  if (!accessKey) throw new Error("Sales channel access key missing");
  const [existing] = await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), eq(marketingContacts.email, email)));
  const res = await fetchImpl(`${base}/store-api/newsletter/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "sw-access-key": accessKey },
    body: JSON.stringify({ email, option: "subscribe", storefrontUrl: de.domain, ...splitName(existing?.contactName) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Shopware newsletter/subscribe: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const now = deps.now();
  const note = `${input.note} (Bestätigungsmail angefordert von ${by})`.slice(0, 500);
  await db
    .insert(marketingContacts)
    .values({ tenantId, email, doiRequestedAt: now, consentNote: note, consentBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: [marketingContacts.tenantId, marketingContacts.email], set: { doiRequestedAt: now, consentNote: note, consentBy: by, updatedAt: now } });
  log.info({ tenantId, by }, "Kundenmails: Bestätigungsmail für die Newsletter-Anmeldung angefordert");
  const [row] = await db.select().from(marketingContacts).where(and(tenantIs(marketingContacts.tenantId, tenantId), eq(marketingContacts.email, email)));
  return row;
}
