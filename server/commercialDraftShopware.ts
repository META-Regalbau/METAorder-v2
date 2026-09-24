import type { OfferDraft, OrderDraft, ShopwareSettings } from "@shared/schema";
import type { IStorage } from "./storage";
import { B2BSellersClient } from "./b2bSellersClient";
import { ShopwareClient } from "./shopware";
import { scheduleSftpUploadAfterOrderCreate } from "./sftpUpload";
import { buildShopwareLinePayloadFromCpqSource, type CpqSourceSnapshot } from "./cpq/cpqMetaCalcPayload";

export type CreateFromDraftFailure = { ok: false; error: string; statusCode: number };
export type CreateOfferSuccess = { ok: true; offerId: string; draft: OfferDraft };
export type CreateOrderSuccess = { ok: true; orderId: string; draft: OrderDraft };

/** Portal-Kunden (META Händler Portal) haben lange Kundennummern (z. B. 20000016175), Shop-Kunden fünfstellige. */
const PORTAL_CUSTOMER_NUMBER_MIN_DIGITS = 8;

/**
 * Prüft die im Entwurf gespeicherte Shopware-Kunden-ID gegen Shopware. Wurde die Instanz
 * neu aufgesetzt (z. B. Testsystem aus Live-Dump), zeigt die ID ins Leere und die Anlage
 * scheitert mit einem FK-Fehler auf order_customer. Dann wird der Kunde über die E-Mail
 * neu aufgelöst — bei mehreren Treffern gewinnt der eine Portal-Kunde (lange Kundennummer).
 */
async function resolveDraftShopwareCustomerId(
  settings: ShopwareSettings,
  storedCustomerId: string,
  emails: Array<string | undefined>
): Promise<{ ok: true; customerId: string; changed: boolean } | CreateFromDraftFailure> {
  const client = new ShopwareClient(settings);
  const { toShopwareUuid } = await import("./b2bOfferCreateContext");
  const existing = await client.searchEntity("customer", {
    limit: 1,
    ids: [toShopwareUuid(storedCustomerId)],
    includes: { customer: ["id"] },
  });
  if (Array.isArray(existing?.data) && existing.data.length > 0) {
    return { ok: true, customerId: storedCustomerId, changed: false };
  }

  // Zuerst die Login-Adresse des früher zugeordneten Kontos, dann die Beleg-Kontaktadresse.
  let normalizedEmail = "";
  let candidates: Awaited<ReturnType<typeof client.findCustomersByEmail>> = [];
  for (const raw of emails) {
    const e = (raw || "").trim();
    if (!e) continue;
    normalizedEmail = e;
    candidates = await client.findCustomersByEmail(e);
    if (candidates.length > 0) break;
  }
  const portal = candidates.filter(
    (c) => (c.customerNumber ?? "").replace(/\D/g, "").length >= PORTAL_CUSTOMER_NUMBER_MIN_DIGITS
  );
  const match = candidates.length === 1 ? candidates[0] : portal.length === 1 ? portal[0] : null;
  if (match) {
    return { ok: true, customerId: match.id, changed: true };
  }
  return {
    ok: false,
    error:
      candidates.length > 1
        ? `Der zugeordnete Shopware-Kunde existiert nicht mehr, und zu ${normalizedEmail} gibt es mehrere Kunden. Bitte Kunde im Entwurf neu zuordnen.`
        : "Der zugeordnete Shopware-Kunde existiert nicht (mehr) in Shopware. Bitte Kunde im Entwurf neu zuordnen.",
    statusCode: 400,
  };
}

/** E-Mails zum Wiederfinden des Kontos: Login-Adresse des zugeordneten Kontos vor Beleg-Kontakt. */
function draftCustomerEmails(extractedData: unknown): Array<string | undefined> {
  const customer = (extractedData as {
    customer?: { email?: string; emailResolution?: { shopwareAccountEmail?: string } };
  } | null)?.customer;
  return [customer?.emailResolution?.shopwareAccountEmail, customer?.email];
}

/**
 * Repariert eine veraltete Kunden-ID im Entwurf und speichert die neue. Muss VOR der
 * Verkaufskanal-Ermittlung laufen, weil der Kanal am Kunden hängt (Portal-Kunde →
 * META Händler Portal DE) — mit toter ID fiele die Wahl sonst auf den Standardkanal.
 */
export async function ensureDraftShopwareCustomerId(
  storage: IStorage,
  params: { kind: "offer" | "order"; draftId: string; tenantId?: string | null }
): Promise<{ ok: true; customerId: string | null } | CreateFromDraftFailure> {
  const tenantId = params.tenantId ?? null;
  const draft =
    params.kind === "offer"
      ? await storage.getOfferDraft(params.draftId, tenantId)
      : await storage.getOrderDraft(params.draftId, tenantId);
  if (!draft?.shopwareCustomerId) return { ok: true, customerId: null };
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) return { ok: true, customerId: draft.shopwareCustomerId };

  const resolved = await resolveDraftShopwareCustomerId(settings, draft.shopwareCustomerId, draftCustomerEmails(draft.extractedData));
  if (!resolved.ok) return resolved;
  if (resolved.changed) {
    console.log(
      `[CommercialDraft] Veraltete Kunden-ID ${draft.shopwareCustomerId} → ${resolved.customerId} (${params.kind} ${params.draftId})`
    );
    if (params.kind === "offer") {
      await storage.updateOfferDraft(params.draftId, { shopwareCustomerId: resolved.customerId }, tenantId);
    } else {
      await storage.updateOrderDraft(params.draftId, { shopwareCustomerId: resolved.customerId }, tenantId);
    }
  }
  return { ok: true, customerId: resolved.customerId };
}

/** Sicherheitsnetz in den Executoren: Kanal wurde mit dieser ID ermittelt, also nicht still austauschen. */
async function assertDraftShopwareCustomerExists(
  settings: ShopwareSettings,
  customerId: string,
  emails: Array<string | undefined>
): Promise<CreateFromDraftFailure | null> {
  const resolved = await resolveDraftShopwareCustomerId(settings, customerId, emails);
  if (!resolved.ok) return resolved;
  if (resolved.changed) {
    return {
      ok: false,
      error: "Der zugeordnete Shopware-Kunde existiert nicht mehr. Bitte Kunde im Entwurf neu zuordnen.",
      statusCode: 400,
    };
  }
  return null;
}

export async function executeCreateOfferFromDraft(
  storage: IStorage,
  draftId: string,
  options: { salesChannelId: string; tenantId?: string | null }
): Promise<CreateOfferSuccess | CreateFromDraftFailure> {
  const draft = await storage.getOfferDraft(draftId, options.tenantId ?? null);
  if (!draft) {
    return { ok: false, error: "Offer draft not found", statusCode: 404 };
  }
  if (draft.status === "rejected") {
    return { ok: false, error: "Cannot create offer from rejected draft", statusCode: 400 };
  }
  if (draft.status === "created") {
    return { ok: false, error: "Offer has already been created from this draft", statusCode: 400 };
  }
  if (draft.status === "pending") {
    return { ok: false, error: "Draft is still pending. Please approve it first.", statusCode: 400 };
  }
  if (!draft.extractedData) {
    return { ok: false, error: "Draft has no extracted data", statusCode: 400 };
  }
  if (!draft.matchingResults?.items?.length) {
    return { ok: false, error: "Draft has no matched products", statusCode: 400 };
  }
  const unmatchedItems = draft.matchingResults.items.filter((item) => !item.matchedProduct && !item.bundle);
  if (unmatchedItems.length > 0) {
    return {
      ok: false,
      error: "Some products are not matched. Please review and match all products before creating the offer.",
      statusCode: 400,
    };
  }
  const invalidQuantityItems = draft.matchingResults.items.filter(
    (item) => !Number.isFinite(item.quantity) || item.quantity <= 0
  );
  if (invalidQuantityItems.length > 0) {
    return {
      ok: false,
      error: "Some line items have an invalid quantity (must be a positive number).",
      statusCode: 400,
    };
  }
  if (!draft.shopwareCustomerId) {
    return {
      ok: false,
      error: "Draft has no Shopware customer (shopwareCustomerId). Bitte Kunde im Entwurf zuordnen.",
      statusCode: 400,
    };
  }
  if (!options.salesChannelId) {
    return {
      ok: false,
      error: "sales_channel_id erforderlich. Bitte angeben oder B2B_SELLERS_DEFAULT_SALES_CHANNEL setzen.",
      statusCode: 400,
    };
  }

  const { productCache } = await import("./productCache");
  const lineItemMap = new Map<string, number>();
  const productNumberById = new Map<string, string>();
  const manualNetById = new Map<string, number>();
  const unresolvedProducts: string[] = [];

  draft.matchingResults.items.forEach((item) => {
    if (item.bundle) {
      item.bundle.components.forEach((component) => {
        const productId = component.productId || productCache.getProductByNumber(component.productNumber)?.id;
        if (!productId) {
          unresolvedProducts.push(component.productNumber);
          return;
        }
        const nextQty = (lineItemMap.get(productId) ?? 0) + item.quantity * component.quantity;
        lineItemMap.set(productId, nextQty);
        if (component.productNumber) productNumberById.set(productId, component.productNumber);
      });
      return;
    }
    const productId = item.matchedProduct!.id;
    const nextQty = (lineItemMap.get(productId) ?? 0) + item.quantity;
    lineItemMap.set(productId, nextQty);
    if (item.matchedProduct!.productNumber) {
      productNumberById.set(productId, item.matchedProduct!.productNumber);
    }
    // Manuelle Preis-Override hat Vorrang; sonst greift der von der Smart-Pricing-Engine
    // vorgeschlagene (und dem Prüfer im Review sowie im Kunden-PDF bereits gezeigte) Preis —
    // sonst wird der im Review sichtbare Rabatt beim echten Shopware-Angebot nie angewendet.
    const manualNet = item.matchedProduct!.manualUnitPriceNet ?? item.matchedProduct!.suggestedPrice;
    if (typeof manualNet === "number" && Number.isFinite(manualNet) && manualNet >= 0 && !manualNetById.has(productId)) {
      manualNetById.set(productId, manualNet);
    }
  });

  if (unresolvedProducts.length > 0) {
    return {
      ok: false,
      error: "Some bundle products could not be resolved",
      statusCode: 400,
    };
  }

  const sortedEntries = Array.from(lineItemMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  let lineItems: Array<{
    productId: string;
    quantity: number;
    productNumber?: string;
    payload?: Record<string, unknown>;
    unitPriceNet?: number;
  }> = sortedEntries.map(([productId, quantity]) => ({
    productId,
    quantity,
    productNumber: productNumberById.get(productId),
    ...(manualNetById.has(productId) ? { unitPriceNet: manualNetById.get(productId) } : {}),
  }));

  const cpqRaw = draft.extractedData?.cpqSource;
  const cpq =
    cpqRaw && typeof cpqRaw === "object" && (cpqRaw as CpqSourceSnapshot).billOfMaterials?.items?.length
      ? (cpqRaw as CpqSourceSnapshot)
      : null;
  if (cpq && lineItems.length > 0) {
    const payload = buildShopwareLinePayloadFromCpqSource(cpq);
    lineItems[0] = { ...lineItems[0], payload };
  }

  const settings = await storage.getShopwareSettings(options.tenantId ?? null);
  if (!settings) {
    return { ok: false, error: "Shopware-Einstellungen nicht konfiguriert", statusCode: 400 };
  }

  // Produkt-IDs gegen Shopware validieren und veraltete IDs über die productNumber neu auflösen.
  const { resolveOfferLineItemProducts } = await import("./b2bOfferCreateContext");
  const productResolution = await resolveOfferLineItemProducts(settings, lineItems);
  if (productResolution.invalid.length > 0) {
    const names = productResolution.invalid
      .map((p) => p.productNumber || p.productId)
      .join(", ");
    return {
      ok: false,
      error: `Folgende Produkte existieren nicht (mehr) in Shopware und müssen neu zugeordnet werden: ${names}`,
      statusCode: 400,
    };
  }
  lineItems = productResolution.items;

  const offerCustomerError = await assertDraftShopwareCustomerExists(
    settings,
    draft.shopwareCustomerId,
    draftCustomerEmails(draft.extractedData)
  );
  if (offerCustomerError) return offerCustomerError;

  const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
  const client = new B2BSellersClient(settings, { statusMapping });

  const extracted = draft.extractedData as {
    customer?: { email?: string; firstName?: string; lastName?: string; company?: string; phone?: string };
    billingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
      /** Schema-Feld heißt `phone` (siehe shared/schema.ts offerDrafts.extractedData.billingAddress) */
      phone?: string;
    };
  } | null;

  // Atomarer Claim direkt vor dem Shopware-Call: verhindert doppelte Angebote bei
  // gleichzeitigen Requests (Doppelklick, Webhook-Retry) — siehe dbStorage.ts.
  const claimed = await storage.claimOfferDraftForCreation(draftId, options.tenantId ?? null);
  if (!claimed) {
    return {
      ok: false,
      error: "Angebot wird bereits erstellt oder wurde bereits erstellt (gleichzeitiger Request).",
      statusCode: 409,
    };
  }

  let created: { id: string };
  try {
    created = await client.createOffer({
      customerId: draft.shopwareCustomerId,
      salesChannelId: options.salesChannelId,
      lineItems,
      customerContext: {
        email: extracted?.customer?.email,
        firstName: extracted?.customer?.firstName ?? extracted?.billingAddress?.firstName,
        lastName: extracted?.customer?.lastName ?? extracted?.billingAddress?.lastName,
        company: extracted?.customer?.company ?? extracted?.billingAddress?.company,
        phoneNumber: extracted?.customer?.phone ?? extracted?.billingAddress?.phone,
        billingAddress: extracted?.billingAddress
          ? {
              firstName: extracted.billingAddress.firstName,
              lastName: extracted.billingAddress.lastName,
              company: extracted.billingAddress.company,
              street: extracted.billingAddress.street,
              zipCode: extracted.billingAddress.zipCode,
              city: extracted.billingAddress.city,
              country: extracted.billingAddress.country,
              phoneNumber: extracted.billingAddress.phone,
            }
          : undefined,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Angebot konnte nicht erstellt werden";
    console.error("[CreateOfferFromDraft] failed:", error instanceof Error ? error.stack || error.message : error);
    // Claim zurücknehmen, damit der Entwurf erneut versucht werden kann.
    await storage.updateOfferDraft(draftId, { status: draft.status }, options.tenantId ?? null);
    return { ok: false, error: message, statusCode: 502 };
  }

  const updatedDraft = await storage.updateOfferDraft(
    draftId,
    {
      status: "created",
      shopwareOfferId: created.id,
    },
    options.tenantId ?? null
  );

  if (!updatedDraft) {
    return { ok: false, error: "Failed to update offer draft", statusCode: 500 };
  }

  return { ok: true, offerId: created.id, draft: updatedDraft };
}

export async function executeCreateOrderFromDraft(
  storage: IStorage,
  draftId: string,
  options: { salesChannelId: string; tenantId?: string | null }
): Promise<CreateOrderSuccess | CreateFromDraftFailure> {
  const draft = await storage.getOrderDraft(draftId, options.tenantId ?? null);
  if (!draft) {
    return { ok: false, error: "Order draft not found", statusCode: 404 };
  }
  if (draft.status === "rejected") {
    return { ok: false, error: "Cannot create order from rejected draft", statusCode: 400 };
  }
  if (draft.status === "created") {
    return { ok: false, error: "Order has already been created from this draft", statusCode: 400 };
  }
  if (draft.status === "pending") {
    return { ok: false, error: "Draft is still pending. Please approve it first.", statusCode: 400 };
  }
  if (!draft.extractedData) {
    return { ok: false, error: "Draft has no extracted data", statusCode: 400 };
  }
  if (!draft.matchingResults?.items?.length) {
    return { ok: false, error: "Draft has no matched products", statusCode: 400 };
  }
  const unmatchedItems = draft.matchingResults.items.filter((item) => !item.matchedProduct && !item.bundle);
  if (unmatchedItems.length > 0) {
    return {
      ok: false,
      error: "Some products are not matched. Please review and match all products before creating the order.",
      statusCode: 400,
    };
  }
  const invalidQuantityItems = draft.matchingResults.items.filter(
    (item) => !Number.isFinite(item.quantity) || item.quantity <= 0
  );
  if (invalidQuantityItems.length > 0) {
    return {
      ok: false,
      error: "Some line items have an invalid quantity (must be a positive number).",
      statusCode: 400,
    };
  }
  if (!draft.shopwareCustomerId) {
    return {
      ok: false,
      error: "Draft has no Shopware customer (shopwareCustomerId). Bitte Kunde im Entwurf zuordnen.",
      statusCode: 400,
    };
  }
  if (!options.salesChannelId) {
    return {
      ok: false,
      error: "sales_channel_id erforderlich. Bitte angeben oder B2B_SELLERS_DEFAULT_SALES_CHANNEL setzen.",
      statusCode: 400,
    };
  }

  const shopwareSettings = await storage.getShopwareSettings(options.tenantId ?? null);
  if (!shopwareSettings) {
    return { ok: false, error: "Shopware settings not configured", statusCode: 400 };
  }

  const { productCache } = await import("./productCache");
  const productNumberById = new Map<string, string>();
  const lineItemMap = new Map<string, number>();
  const manualNetById = new Map<string, number>();
  const unresolvedProducts: string[] = [];

  draft.matchingResults.items.forEach((item) => {
    if (item.bundle) {
      item.bundle.components.forEach((component) => {
        const productId = component.productId || productCache.getProductByNumber(component.productNumber)?.id;
        if (!productId) {
          unresolvedProducts.push(component.productNumber);
          return;
        }
        const nextQty = (lineItemMap.get(productId) ?? 0) + item.quantity * component.quantity;
        lineItemMap.set(productId, nextQty);
        if (component.productNumber) productNumberById.set(productId, component.productNumber);
      });
      return;
    }
    const productId = item.matchedProduct!.id;
    const nextQty = (lineItemMap.get(productId) ?? 0) + item.quantity;
    lineItemMap.set(productId, nextQty);
    if (item.matchedProduct!.productNumber) {
      productNumberById.set(productId, item.matchedProduct!.productNumber);
    }
    // Manueller Netto-Stückpreis aus dem Review hat Vorrang (gleiche Konvention wie beim Angebot);
    // sonst ermittelt buildOrderCreateAttributes Kundenpreis → Kundenrabatt → Listenpreis.
    const manualNet = (item.matchedProduct as { manualUnitPriceNet?: number }).manualUnitPriceNet;
    if (typeof manualNet === "number" && Number.isFinite(manualNet) && manualNet >= 0 && !manualNetById.has(productId)) {
      manualNetById.set(productId, manualNet);
    }
  });

  if (unresolvedProducts.length > 0) {
    return {
      ok: false,
      error: "Some bundle products could not be resolved",
      statusCode: 400,
    };
  }

  let lineItems: Array<{ productId: string; quantity: number; productNumber?: string; unitPriceNet?: number }> =
    Array.from(lineItemMap.entries()).map(([productId, quantity]) => ({
      productId,
      quantity,
      productNumber: productNumberById.get(productId),
      ...(manualNetById.has(productId) ? { unitPriceNet: manualNetById.get(productId) } : {}),
    }));

  // Produkt-IDs gegen Shopware validieren und veraltete IDs über die productNumber neu auflösen
  // (gleiches Vorgehen wie bei der Angebotserstellung).
  const { resolveOfferLineItemProducts } = await import("./b2bOfferCreateContext");
  const productResolution = await resolveOfferLineItemProducts(shopwareSettings, lineItems);
  if (productResolution.invalid.length > 0) {
    const names = productResolution.invalid.map((p) => p.productNumber || p.productId).join(", ");
    return {
      ok: false,
      error: `Folgende Produkte wurden in Shopware nicht gefunden: ${names}`,
      statusCode: 400,
    };
  }
  lineItems = productResolution.items;

  const { extractedData } = draft;

  const orderCustomerError = await assertDraftShopwareCustomerExists(
    shopwareSettings,
    draft.shopwareCustomerId,
    draftCustomerEmails(extractedData)
  );
  if (orderCustomerError) return orderCustomerError;

  const { buildOrderCreateAttributes } = await import("./shopwareOrderCreateContext");

  // Atomarer Claim direkt vor dem Shopware-Call: verhindert doppelte Bestellungen bei
  // gleichzeitigen Requests (Doppelklick, Webhook-Retry) — siehe dbStorage.ts.
  const claimed = await storage.claimOrderDraftForCreation(draftId, options.tenantId ?? null);
  if (!claimed) {
    return {
      ok: false,
      error: "Bestellung wird bereits erstellt oder wurde bereits erstellt (gleichzeitiger Request).",
      statusCode: 409,
    };
  }

  let shopwareOrder: { id: string };
  try {
    const attributes = await buildOrderCreateAttributes(shopwareSettings, {
      shopwareCustomerId: draft.shopwareCustomerId,
      salesChannelId: options.salesChannelId,
      lineItems,
      customerContext: {
        email: extractedData.customer?.email,
        firstName: extractedData.customer?.firstName,
        lastName: extractedData.customer?.lastName,
        company: extractedData.customer?.company,
        phoneNumber: extractedData.customer?.phone,
        billingAddress: extractedData.billingAddress
          ? {
              firstName: extractedData.billingAddress.firstName,
              lastName: extractedData.billingAddress.lastName,
              company: extractedData.billingAddress.company,
              street: extractedData.billingAddress.street,
              zipCode: extractedData.billingAddress.zipCode,
              city: extractedData.billingAddress.city,
              country: extractedData.billingAddress.country,
              phoneNumber: extractedData.billingAddress.phone,
            }
          : undefined,
        shippingAddress: extractedData.shippingAddress
          ? {
              firstName: extractedData.shippingAddress.firstName,
              lastName: extractedData.shippingAddress.lastName,
              company: extractedData.shippingAddress.company,
              street: extractedData.shippingAddress.street,
              zipCode: extractedData.shippingAddress.zipCode,
              city: extractedData.shippingAddress.city,
              country: extractedData.shippingAddress.country,
              phoneNumber: extractedData.shippingAddress.phone,
            }
          : undefined,
      },
      customerComment: buildOrderCustomerComment(extractedData),
    });

    const client = new ShopwareClient(shopwareSettings);
    shopwareOrder = await client.createOrder(attributes);
  } catch (error) {
    // Claim zurücknehmen, damit der Entwurf erneut versucht werden kann.
    await storage.updateOrderDraft(draftId, { status: draft.status }, options.tenantId ?? null);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Bestellung konnte nicht in Shopware angelegt werden",
      statusCode: 502,
    };
  }

  const updatedDraft = await storage.updateOrderDraft(
    draftId,
    {
      status: "created",
      shopwareOrderId: shopwareOrder.id,
    },
    options.tenantId ?? null
  );

  if (!updatedDraft) {
    return { ok: false, error: "Failed to update order draft", statusCode: 500 };
  }

  // Beilagen (Kundenlieferschein u. a.) an die SFTP-Server des Mandanten (Lobster → d.3) —
  // asynchron, die Bestellanlage wartet nicht darauf. Gilt für manuelle und automatische Anlage.
  if ((updatedDraft.attachments ?? []).length > 0) {
    scheduleSftpUploadAfterOrderCreate(storage, draftId, options.tenantId ?? null);
  }

  return { ok: true, orderId: shopwareOrder.id, draft: updatedDraft };
}

/**
 * Kundenkommentar der Shopware-Bestellung: Notizen aus dem Beleg plus die Referenzen,
 * die auf Lieferschein/AB gehören (Kundenreferenz, Kommission, Lieferkontakt, Hinweise).
 * Eigene Zeilen mit festen Labels, damit Lieferschein-Druck und DMS sie wiederfinden.
 */
export function buildOrderCustomerComment(extractedData: {
  orderNotes?: string;
  documentReferences?: {
    customerReference?: string;
    commission?: string;
    supplierOfferNumber?: string;
    deliveryContactName?: string;
    deliveryContactPhone?: string;
    deliveryContactEmail?: string;
    deliveryNoteInstructions?: string;
    orderConfirmationEmail?: string;
    invoiceEmail?: string;
  };
}): string | undefined {
  const refs = extractedData.documentReferences ?? {};
  const lines: string[] = [];
  if (refs.customerReference) lines.push(`Kundenreferenz: ${refs.customerReference}`);
  if (refs.commission) lines.push(`Kommission: ${refs.commission}`);
  if (refs.supplierOfferNumber) lines.push(`Angebotsbezug: ${refs.supplierOfferNumber}`);
  const contact = [refs.deliveryContactName, refs.deliveryContactPhone, refs.deliveryContactEmail]
    .filter((v) => v && v.trim())
    .join(", ");
  if (contact) lines.push(`Lieferkontakt: ${contact}`);
  if (refs.deliveryNoteInstructions) lines.push(`Lieferschein/Anlieferung: ${refs.deliveryNoteInstructions}`);
  if (refs.orderConfirmationEmail) lines.push(`AB an: ${refs.orderConfirmationEmail}`);
  if (refs.invoiceEmail) lines.push(`Rechnung an: ${refs.invoiceEmail}`);
  const notes = extractedData.orderNotes?.trim();
  if (notes) lines.push(notes);
  const text = lines.join("\n").trim();
  return text || undefined;
}
