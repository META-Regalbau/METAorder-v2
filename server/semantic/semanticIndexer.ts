import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { getTenantIdFromContext, runWithTenantContext } from "../lib/tenantContext";
import { generateEmbedding, hashContent, LOCAL_EMBEDDING_MODEL } from "./semanticEmbeddings";
import { productCache } from "../products/productCache";
import { ShopwareClient } from "../shopware/shopware";
import { B2BSellersClient, getOfferStatusMapping } from "../b2b/b2bSellersClient";
import type { IStorage } from "../storage";
import {
  offerDrafts,
  orderDrafts,
  tickets,
  ticketComments,
  ticketTemplates,
  semanticDocuments,
  type InsertSemanticDocument,
  type Product,
  type Offer,
} from "@shared/schema";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "semantic/semanticIndexer" });

type IndexOptions = {
  sources?: string[];
  preferOpenAI?: boolean;
};


const DEFAULT_SOURCES = [
  "products",
  "offers",
  "offer_drafts",
  "order_drafts",
  "tickets",
  "ticket_templates",
];

const SOURCE_TYPE_MAP: Record<string, string> = {
  products: "product",
  offers: "offer",
  offer_drafts: "offer_draft",
  order_drafts: "order_draft",
  tickets: "ticket",
  ticket_templates: "ticket_template",
};

function compactContent(parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join("\n");
}

function buildProductDocument(product: Product) {
  const dimensions = product.dimensions
    ? `${product.dimensions.width ?? ""}x${product.dimensions.height ?? ""}x${product.dimensions.length ?? ""} ${product.dimensions.unit || "cm"}`
    : undefined;
  const properties = product.properties?.map((prop) => `${prop.groupName}: ${prop.optionName}`).join(", ");
  const content = compactContent([
    product.name,
    product.description,
    product.productNumber,
    product.manufacturerName,
    product.manufacturerNumber,
    product.ean,
    product.categoryNames?.join(", "),
    properties,
    dimensions,
    product.weight ? `${product.weight} kg` : undefined,
  ]);

  return {
    sourceType: "product",
    sourceId: product.id,
    title: `${product.name} (${product.productNumber})`,
    content,
    metadata: {
      productNumber: product.productNumber,
      manufacturerName: product.manufacturerName,
      manufacturerNumber: product.manufacturerNumber,
      ean: product.ean,
      categories: product.categoryNames,
      dimensions: product.dimensions,
      weight: product.weight,
      price: product.price,
      netPrice: product.netPrice,
      currency: product.currency,
      properties: product.properties,
    },
  };
}

function buildOfferContent(offer: Offer) {
  const itemLines = (offer.items || [])
    .map((item: any) => {
      const label = item?.label || item?.name || item?.productName;
      const productNumber = item?.productNumber || item?.payload?.productNumber;
      const qty = item?.quantity ? `x${item.quantity}` : "";
      return [label, productNumber, qty].filter(Boolean).join(" ");
    })
    .filter(Boolean);

  const content = compactContent([
    offer.offerNumber,
    offer.customerName,
    offer.customerEmail,
    offer.status,
    offer.statusLabel || undefined,
    itemLines.join("\n"),
  ]);

  return {
    sourceType: "offer",
    sourceId: offer.id,
    title: `Angebot ${offer.offerNumber}`,
    content,
    metadata: {
      offerNumber: offer.offerNumber,
      customerName: offer.customerName,
      customerEmail: offer.customerEmail,
      status: offer.status,
      statusLabel: offer.statusLabel,
      totalPrice: offer.totalPrice,
      netPrice: offer.netPrice,
      salesChannelId: offer.salesChannelId,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
    },
  };
}

function buildDraftContent(draft: { id: string; originalFileName: string; extractedData?: any; matchingResults?: any }, type: "offer_draft" | "order_draft") {
  const lineItems = draft.extractedData?.lineItems || [];
  const itemLines = lineItems.map((item: any) => {
    const number = item.extractedProductNumber ? `(${item.extractedProductNumber})` : "";
    return `${item.extractedProductName || "Unbekannt"} ${number} x${item.quantity || 1}`.trim();
  });
  const content = compactContent([
    draft.originalFileName,
    draft.extractedData?.customer?.company,
    draft.extractedData?.customer?.email,
    draft.extractedData?.offerNotes,
    itemLines.join("\n"),
  ]);

  return {
    sourceType: type,
    sourceId: draft.id,
    title: draft.originalFileName,
    content,
    metadata: {
      customer: draft.extractedData?.customer,
      items: lineItems,
      matchingResults: draft.matchingResults,
    },
  };
}

export type SourceIndexResult = {
  /** Dokumente mit Inhalt nach diesem Lauf */
  total: number;
  /** neu oder geaendert (Embedding berechnet) */
  updated: number;
  /** unveraendert uebersprungen */
  unchanged: number;
  /** nicht mehr vorhanden, aus dem Index geloescht */
  removed: number;
  /** Quelle nicht lesbar - ihr Index bleibt dann unveraendert */
  error?: string;
};
export type IndexResult = Record<string, SourceIndexResult>;

export type IndexDoc = { sourceType: string; sourceId: string; title: string; content: string; metadata?: any };

/** Mandanten-Filter: eigener Mandant oder (ohne Mandanten) nur Zeilen ohne Mandant */
const tenantFilter = (column: any, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));

/**
 * Suchindex (FAQ-Antworten, semantische Suche, Suchfeld in der Kopfzeile) fuer EINEN Mandanten.
 * Frueher: ohne Mandantenfilter (Entwuerfe und Tickets aller Mandanten landeten im Index des
 * aufrufenden), jedes Mal alles geloescht und neu berechnet, und nirgends ausgeloest - der Index
 * war in allen Mandanten leer. Jetzt: nur Daten des Mandanten, unveraenderte Eintraege werden
 * uebersprungen (Fingerabdruck aus Titel, Inhalt und Metadaten), entfernte geloescht; eine
 * Quelle, die nicht lesbar ist, laesst ihren Index unveraendert.
 */
export async function runSemanticIndex(
  storage: IStorage,
  options?: IndexOptions & { tenantId?: string | null },
): Promise<IndexResult> {
  const tenantId = options?.tenantId !== undefined ? options.tenantId : getTenantIdFromContext();
  // Produkt-Cache und Einstellungen lesen den Mandanten aus dem Kontext - passend setzen
  return runWithTenantContext(tenantId, async () => {
    const sources = options?.sources?.length ? options.sources : DEFAULT_SOURCES;
    const result: IndexResult = {};
    const run = async (source: string, load: () => Promise<IndexDoc[]>) => {
      if (!sources.includes(source)) return;
      const sourceType = SOURCE_TYPE_MAP[source] || source;
      try {
        const docs = await load();
        result[source] = await syncSourceDocuments(storage, tenantId, sourceType, docs, options?.preferOpenAI);
      } catch (error) {
        result[source] = { total: 0, updated: 0, unchanged: 0, removed: 0, error: error instanceof Error ? error.message : String(error) };
      }
    };

    await run("products", async () => {
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) throw new Error("Shopware settings not configured");
      const client = new ShopwareClient(settings);
      if (!productCache.getStatus().isPopulated) await productCache.refresh(client);
      return productCache.getProducts().map(buildProductDocument);
    });

    await run("offers", async () => {
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) throw new Error("Shopware settings not configured");
      const statusMapping = (await storage.getSetting("b2b.offerStatusMapping", tenantId)) || getOfferStatusMapping();
      const client = new B2BSellersClient(settings, { statusMapping });
      return (await fetchAllOffers(client)).map(buildOfferContent);
    });

    await run("offer_drafts", async () => {
      const drafts = await db.select().from(offerDrafts).where(tenantFilter(offerDrafts.tenantId, tenantId));
      return drafts.map((draft) => buildDraftContent(draft, "offer_draft"));
    });

    await run("order_drafts", async () => {
      const drafts = await db.select().from(orderDrafts).where(tenantFilter(orderDrafts.tenantId, tenantId));
      return drafts.map((draft) => buildDraftContent(draft, "order_draft"));
    });

    await run("tickets", async () => {
      const allTickets = await db.select().from(tickets).where(tenantFilter(tickets.tenantId, tenantId));
      const commentsByTicket = new Map<string, string[]>();
      const ids = allTickets.map((ticket) => ticket.id);
      for (let i = 0; i < ids.length; i += 500) {
        const comments = await db.select().from(ticketComments).where(inArray(ticketComments.ticketId, ids.slice(i, i + 500)));
        for (const comment of comments) {
          if (!comment.ticketId) continue;
          const list = commentsByTicket.get(comment.ticketId) || [];
          list.push(comment.comment);
          commentsByTicket.set(comment.ticketId, list);
        }
      }
      return allTickets.map((ticket) => ({
        sourceType: "ticket",
        sourceId: ticket.id,
        title: `${ticket.ticketNumber} · ${ticket.title}`,
        content: compactContent([
          ticket.title,
          ticket.description,
          ticket.category,
          ticket.tags?.join(", "),
          ticket.customerName,
          ticket.customerEmail,
          (commentsByTicket.get(ticket.id) || []).join("\n"),
        ]),
        metadata: {
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          tags: ticket.tags,
          customerName: ticket.customerName,
          customerEmail: ticket.customerEmail,
        },
      }));
    });

    await run("ticket_templates", async () => {
      const templates = await db.select().from(ticketTemplates).where(tenantFilter(ticketTemplates.tenantId, tenantId));
      return templates.map((template) => ({
        sourceType: "ticket_template",
        sourceId: template.id,
        title: template.title,
        content: compactContent([template.title, template.content]),
        metadata: { category: template.category },
      }));
    });

    return result;
  });
}

/** Fingerabdruck fuer "unveraendert": Titel, Inhalt und Metadaten (z. B. Ticket-Status) */
export function documentFingerprint(doc: Pick<IndexDoc, "title" | "content" | "metadata">): string {
  return hashContent(JSON.stringify([doc.title, doc.content, doc.metadata ?? {}]));
}

/** Zugriff auf den Index einer Quelle (Produktion: Datenbank; Tests: im Speicher) */
export type IndexStore = {
  listExisting(
    tenantId: string | null,
    sourceType: string,
  ): Promise<Array<{ sourceId: string; contentHash: string; embeddingProvider: string; embeddingModel?: string | null }>>;
  upsert(rows: InsertSemanticDocument[], tenantId: string | null): Promise<void>;
  deleteIds(tenantId: string | null, sourceType: string, sourceIds: string[]): Promise<void>;
};

function dbIndexStore(storage: IStorage): IndexStore {
  return {
    listExisting: (tenantId, sourceType) =>
      db
        .select({
          sourceId: semanticDocuments.sourceId,
          contentHash: semanticDocuments.contentHash,
          embeddingProvider: semanticDocuments.embeddingProvider,
          embeddingModel: semanticDocuments.embeddingModel,
        })
        .from(semanticDocuments)
        .where(and(tenantFilter(semanticDocuments.tenantId, tenantId), eq(semanticDocuments.sourceType, sourceType))),
    upsert: (rows, tenantId) => storage.upsertSemanticDocuments(rows, tenantId),
    deleteIds: async (tenantId, sourceType, sourceIds) => {
      await db
        .delete(semanticDocuments)
        .where(
          and(
            tenantFilter(semanticDocuments.tenantId, tenantId),
            eq(semanticDocuments.sourceType, sourceType),
            inArray(semanticDocuments.sourceId, sourceIds),
          ),
        );
    },
  };
}

/** Index einer Quelle an die aktuellen Dokumente angleichen (nur dieser Mandant). */
export async function syncSourceDocuments(
  storage: IStorage,
  tenantId: string | null,
  sourceType: string,
  docs: IndexDoc[],
  preferOpenAI?: boolean,
  store: IndexStore = dbIndexStore(storage),
): Promise<SourceIndexResult> {
  const existing = await store.listExisting(tenantId, sourceType);
  const existingById = new Map(existing.map((row) => [row.sourceId, row]));

  const present = new Set<string>();
  const rows: InsertSemanticDocument[] = [];
  let unchanged = 0;
  for (const doc of docs) {
    if (!doc.content) continue;
    present.add(doc.sourceId);
    const fingerprint = documentFingerprint(doc);
    const prev = existingById.get(doc.sourceId);
    // unveraendert und passendes Embedding: nichts zu tun. Neu berechnen: OpenAI gewuenscht, aber lokal
    // berechnet; lokales Embedding einer aelteren Version (LOCAL_EMBEDDING_MODEL)
    const embeddingFits =
      prev?.embeddingProvider === "openai" || (!preferOpenAI && prev?.embeddingModel === LOCAL_EMBEDDING_MODEL);
    if (prev && prev.contentHash === fingerprint && embeddingFits) {
      unchanged += 1;
      continue;
    }
    const { embedding, provider, model } = await generateEmbedding(doc.content, storage, { preferOpenAI });
    rows.push({
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      title: doc.title,
      content: doc.content,
      metadata: doc.metadata ?? {},
      embedding,
      embeddingProvider: provider,
      embeddingModel: model,
      contentHash: fingerprint,
      tenantId,
    });
  }
  for (let i = 0; i < rows.length; i += 50) {
    await store.upsert(rows.slice(i, i + 50), tenantId);
  }

  const stale = existing.map((row) => row.sourceId).filter((id) => !present.has(id));
  for (let i = 0; i < stale.length; i += 500) {
    await store.deleteIds(tenantId, sourceType, stale.slice(i, i + 500));
  }
  return { total: present.size, updated: rows.length, unchanged, removed: stale.length };
}

async function fetchAllOffers(client: B2BSellersClient): Promise<Offer[]> {
  const offers: Offer[] = [];
  const limit = 100;
  let page = 1;
  let total = 0;
  do {
    const result = await client.fetchOffers({ page, limit });
    total = result.total;
    offers.push(...result.offers);
    if (result.offers.length < limit) break;
    page += 1;
  } while (offers.length < total);
  return offers;
}

// ---- Ausloesen: ein Lauf je Mandant gleichzeitig, Ergebnis als Status in den Einstellungen ----

export const SEMANTIC_INDEX_STATUS_KEY = "semantic_index_status";
export type SemanticIndexStatus = { finishedAt: string; durationMs: number; result: IndexResult };

const runningTenants = new Set<string>();
const lockKey = (tenantId: string | null) => tenantId ?? "__no_tenant__";

export function isSemanticIndexRunning(tenantId: string | null): boolean {
  return runningTenants.has(lockKey(tenantId));
}

/** Index fuer einen Mandanten aufbauen/aktualisieren; laeuft schon einer, passiert nichts (null). */
export async function runSemanticIndexForTenant(
  storage: IStorage,
  tenantId: string | null,
  options?: IndexOptions,
): Promise<SemanticIndexStatus | null> {
  const key = lockKey(tenantId);
  if (runningTenants.has(key)) return null;
  runningTenants.add(key);
  const startedAt = Date.now();
  try {
    const result = await runSemanticIndex(storage, { ...options, tenantId });
    const status: SemanticIndexStatus = { finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, result };
    await storage.saveSetting(SEMANTIC_INDEX_STATUS_KEY, status, tenantId);
    return status;
  } finally {
    runningTenants.delete(key);
  }
}

/** Eintraege im Index je Quelle (nur dieser Mandant) */
export async function getSemanticIndexCounts(tenantId: string | null): Promise<Record<string, number>> {
  const rows = await db
    .select({ sourceType: semanticDocuments.sourceType, count: sql<number>`count(*)::int` })
    .from(semanticDocuments)
    .where(tenantFilter(semanticDocuments.tenantId, tenantId))
    .groupBy(semanticDocuments.sourceType);
  return Object.fromEntries(rows.map((row) => [row.sourceType, Number(row.count)]));
}

/** Hintergrund-Job: alle Mandanten nacheinander (Fehler eines Mandanten halten die anderen nicht auf) */
export async function runSemanticIndexAllTenants(storage: IStorage, log: (msg: string) => void = console.log): Promise<void> {
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];
  for (const tenantId of tenantIds) {
    try {
      const status = await runSemanticIndexForTenant(storage, tenantId);
      if (!status) continue;
      const summary = Object.entries(status.result)
        .map(([source, r]) => `${source} ${r.total}${r.error ? " (Fehler)" : ""}`)
        .join(", ");
      log(`[SemanticIndex] Mandant ${tenantId ?? "-"}: ${summary} in ${status.durationMs} ms`);
    } catch (error) {
      moduleLog.error({ err: error }, `[SemanticIndex] Mandant fehlgeschlagen: ${tenantId}`);
    }
  }
}
