import { db } from "./db";
import { generateEmbedding, hashContent } from "./semanticEmbeddings";
import { productCache } from "./productCache";
import { ShopwareClient } from "./shopware";
import { B2BSellersClient, getOfferStatusMapping } from "./b2bSellersClient";
import type { IStorage } from "./storage";
import {
  offerDrafts,
  orderDrafts,
  tickets,
  ticketComments,
  ticketTemplates,
  type InsertSemanticDocument,
  type Product,
  type Offer,
} from "@shared/schema";

type IndexOptions = {
  sources?: string[];
  preferOpenAI?: boolean;
};

type IndexResult = Record<string, number>;

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

export async function runSemanticIndex(storage: IStorage, options?: IndexOptions): Promise<IndexResult> {
  const sources = options?.sources?.length ? options.sources : DEFAULT_SOURCES;
  const result: IndexResult = {};

  await storage.deleteSemanticDocumentsBySourceTypes(
    sources.map((source) => SOURCE_TYPE_MAP[source] || source)
  );

  if (sources.includes("products")) {
    const settings = await storage.getShopwareSettings();
    if (settings) {
      const client = new ShopwareClient(settings);
      const cacheStatus = productCache.getStatus();
      if (!cacheStatus.isPopulated) {
        await productCache.refresh(client);
      }
      const products = productCache.getProducts();
      result.products = await indexBatch(
        storage,
        products.map(buildProductDocument),
        options?.preferOpenAI
      );
    } else {
      result.products = 0;
    }
  }

  if (sources.includes("offers")) {
    const settings = await storage.getShopwareSettings();
    if (settings) {
      const statusMapping = (await storage.getSetting("b2b.offerStatusMapping")) || getOfferStatusMapping();
      const client = new B2BSellersClient(settings, { statusMapping });
      const offers = await fetchAllOffers(client);
      result.offers = await indexBatch(
        storage,
        offers.map(buildOfferContent),
        options?.preferOpenAI
      );
    } else {
      result.offers = 0;
    }
  }

  if (sources.includes("offer_drafts")) {
    const drafts = await db.select().from(offerDrafts);
    result.offer_drafts = await indexBatch(
      storage,
      drafts.map((draft) => buildDraftContent(draft, "offer_draft")),
      options?.preferOpenAI
    );
  }

  if (sources.includes("order_drafts")) {
    const drafts = await db.select().from(orderDrafts);
    result.order_drafts = await indexBatch(
      storage,
      drafts.map((draft) => buildDraftContent(draft, "order_draft")),
      options?.preferOpenAI
    );
  }

  if (sources.includes("tickets")) {
    const allTickets = await db.select().from(tickets);
    const comments = await db.select().from(ticketComments);
    const commentsByTicket = new Map<string, string[]>();
    comments.forEach((comment) => {
      if (!comment.ticketId) return;
      const list = commentsByTicket.get(comment.ticketId) || [];
      list.push(comment.comment);
      commentsByTicket.set(comment.ticketId, list);
    });

    const docs = allTickets.map((ticket) => {
      const commentText = (commentsByTicket.get(ticket.id) || []).join("\n");
      const content = compactContent([
        ticket.title,
        ticket.description,
        ticket.category,
        ticket.tags?.join(", "),
        ticket.customerName,
        ticket.customerEmail,
        commentText,
      ]);
      return {
        sourceType: "ticket",
        sourceId: ticket.id,
        title: `${ticket.ticketNumber} · ${ticket.title}`,
        content,
        metadata: {
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          tags: ticket.tags,
          customerName: ticket.customerName,
          customerEmail: ticket.customerEmail,
        },
      };
    });
    result.tickets = await indexBatch(storage, docs, options?.preferOpenAI);
  }

  if (sources.includes("ticket_templates")) {
    const templates = await db.select().from(ticketTemplates);
    const docs = templates.map((template) => ({
      sourceType: "ticket_template",
      sourceId: template.id,
      title: template.title,
      content: compactContent([template.title, template.content]),
      metadata: {
        category: template.category,
      },
    }));
    result.ticket_templates = await indexBatch(storage, docs, options?.preferOpenAI);
  }

  return result;
}

async function indexBatch(
  storage: IStorage,
  docs: Array<{ sourceType: string; sourceId: string; title: string; content: string; metadata?: any }>,
  preferOpenAI?: boolean
): Promise<number> {
  const rows: InsertSemanticDocument[] = [];
  for (const doc of docs) {
    if (!doc.content) continue;
    const { embedding, provider, model } = await generateEmbedding(doc.content, storage, {
      preferOpenAI,
    });
    rows.push({
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      title: doc.title,
      content: doc.content,
      metadata: doc.metadata ?? {},
      embedding,
      embeddingProvider: provider,
      embeddingModel: model,
      contentHash: hashContent(doc.content),
    });
  }

  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    await storage.upsertSemanticDocuments(rows.slice(i, i + batchSize));
  }
  return rows.length;
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
