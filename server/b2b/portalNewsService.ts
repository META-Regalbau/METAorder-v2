/**
 * Portal-Neuigkeiten: Ablauf je Mail und das Schreiben der Seite.
 *
 * Eingang (n8n, Ordner im Postfach) → KI schreibt den Beitrag → mit „Automatisch veröffentlichen“ sofort auf
 * die Seite, sonst Entwurf. Entwurf bleibt es auch, wenn die KI fehlt oder die Mail kein Changelog ist.
 * Jede Änderung an einem veröffentlichten Beitrag (Bearbeiten, Ausblenden, Löschen) schreibt die Seite neu.
 */
import { randomUUID } from "crypto";
import type { IStorage } from "../storage";
import { storage as defaultStorage } from "../storage";
import { parseEmailBufferAutodetect } from "../email/emailParser";
import { deriveUploadMessageId } from "../commercial/commercialEmailUploadIngest";
import { acquireIntakeLock, releaseIntakeLock } from "../commercial/emailIntakeUpload";
import { graphBaseForMailbox, receivedAfterFor } from "@shared/emailIntake";
import {
  PORTAL_NEWS_CATEGORIES,
  PORTAL_NEWS_PAGE_STATE_KEY,
  PORTAL_NEWS_SETTING_KEY,
  normalizePortalNewsSettings,
  portalNewsMessageFilter,
  type PortalNewsContent,
  type PortalNewsEvent,
  type PortalNewsIntakeResponse,
  type PortalNewsPageInfo,
  type PortalNewsPageState,
  type PortalNewsPost,
  type PortalNewsPostDetail,
  type PortalNewsSection,
  type PortalNewsSettings,
  type PortalNewsStatus,
  type PortalNewsWorkflowConfig,
} from "@shared/portalNews";
import type { PortalNewsPostRow } from "@shared/schema";
import { portalNewsRepo, type PortalNewsRepo } from "./portalNewsRepo";
import { extractPortalNews, type NewsLlm } from "./portalNewsExtraction";
import { portalNewsPageHtml } from "./portalNewsPageHtml";
import { PORTAL_NEWS_CMS_PAGE_ID, portalNewsShopApiFor, type PortalNewsShopApi } from "./portalNewsShop";
import { logger } from "../lib/logger";

const log = logger.child({ component: "b2b/portalNewsService" });

/** Darunter wird ein KI-Beitrag nicht automatisch veröffentlicht */
const SURE_CHANGELOG_CONFIDENCE = 0.6;

export class PortalNewsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ---------- Einstellungen ----------

export async function getPortalNewsSettings(
  storage: Pick<IStorage, "getSetting"> = defaultStorage,
  tenantId?: string | null,
): Promise<PortalNewsSettings> {
  return normalizePortalNewsSettings(await storage.getSetting(PORTAL_NEWS_SETTING_KEY, tenantId));
}

export async function savePortalNewsSettings(
  settings: PortalNewsSettings,
  tenantId: string | null,
  storage: Pick<IStorage, "saveSetting"> = defaultStorage,
): Promise<void> {
  await storage.saveSetting(PORTAL_NEWS_SETTING_KEY, settings, tenantId);
}

export function portalNewsWorkflowConfig(settings: PortalNewsSettings, now = new Date()): PortalNewsWorkflowConfig {
  const receivedAfter = receivedAfterFor(settings.processSince, now);
  return {
    enabled: settings.enabled,
    graphBase: graphBaseForMailbox(settings.mailbox),
    mailbox: settings.mailbox.trim() || null,
    sourceFolderName: settings.sourceFolderName,
    maxPerRun: settings.maxPerRun,
    receivedAfter,
    messageFilter: portalNewsMessageFilter(receivedAfter),
    categories: PORTAL_NEWS_CATEGORIES,
  };
}

// ---------- Kontext ----------

export type ShopApiFactory = (tenantId: string | null) => Promise<PortalNewsShopApi>;

export const defaultShopApiFactory: ShopApiFactory = async (tenantId) => {
  const shopSettings = await defaultStorage.getShopwareSettings(tenantId);
  if (!shopSettings) throw new PortalNewsError("Shopware ist für diesen Mandanten nicht eingerichtet", "shopware_not_configured", 503);
  return portalNewsShopApiFor(shopSettings);
};

export type ServiceContext = {
  tenantId: string | null;
  settings: PortalNewsSettings;
  userName?: string | null;
  storage?: Pick<IStorage, "getSetting" | "saveSetting">;
  repo?: PortalNewsRepo;
  shopApi?: ShopApiFactory;
  llm?: NewsLlm;
};

const repoOf = (ctx: ServiceContext) => ctx.repo ?? portalNewsRepo;
const storageOf = (ctx: ServiceContext) => ctx.storage ?? defaultStorage;

function event(type: string, message: string, by?: string | null): PortalNewsEvent {
  return { at: new Date().toISOString(), type, message, by: by ?? null };
}

/** Kalendertag in Deutschland (JJJJ-MM-TT) */
export function berlinDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------- Darstellung ----------

export function toPost(row: PortalNewsPostRow): PortalNewsPost {
  return {
    id: row.id,
    status: row.status as PortalNewsStatus,
    source: row.source as PortalNewsPost["source"],
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    receivedAt: row.receivedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
    postDate: row.postDate,
    title: row.title,
    summary: row.summary,
    sections: (row.sections ?? []) as PortalNewsSection[],
    tags: (row.tags ?? []) as string[],
  };
}

export function toDetail(row: PortalNewsPostRow): PortalNewsPostDetail {
  return { ...toPost(row), bodyText: row.bodyText, events: (row.events ?? []) as PortalNewsEvent[] };
}

// ---------- Seite ----------

async function readPageState(ctx: ServiceContext): Promise<PortalNewsPageState> {
  const stored = (await storageOf(ctx).getSetting(PORTAL_NEWS_PAGE_STATE_KEY, ctx.tenantId)) as Partial<PortalNewsPageState> | null;
  return {
    writtenAt: stored?.writtenAt ?? null,
    postCount: stored?.postCount ?? 0,
    lastError: stored?.lastError ?? null,
    lastErrorAt: stored?.lastErrorAt ?? null,
  };
}

/** HTML der Seite aus den veröffentlichten Beiträgen (auch für die Vorschau) */
export async function renderPortalNewsPage(ctx: ServiceContext): Promise<{ html: string; postCount: number }> {
  const rows = await repoOf(ctx).list(ctx.tenantId, "published");
  const html = portalNewsPageHtml({
    title: ctx.settings.pageTitle,
    intro: ctx.settings.pageIntro,
    posts: rows.map((r) => ({ id: r.id, ...toContent(r) })),
  });
  return { html, postCount: rows.length };
}

const writeQueues = new Map<string, Promise<unknown>>();

/**
 * Seite im Shop neu schreiben. Je Mandant nacheinander (zwei Mails gleichzeitig würden sich sonst
 * gegenseitig überschreiben); Fehler landen im Seitenstand und werden weitergereicht.
 */
export function writePortalNewsPage(ctx: ServiceContext): Promise<{ action: string; postCount: number }> {
  const key = ctx.tenantId ?? "-";
  const run = async () => {
    const { html, postCount } = await renderPortalNewsPage(ctx);
    const state = await readPageState(ctx);
    try {
      const shop = await (ctx.shopApi ?? defaultShopApiFactory)(ctx.tenantId);
      const action = await shop.writePage(html);
      await storageOf(ctx).saveSetting(PORTAL_NEWS_PAGE_STATE_KEY, { ...state, writtenAt: new Date().toISOString(), postCount, lastError: null, lastErrorAt: null }, ctx.tenantId);
      log.info({ event: "portal_news.page_written", action, postCount, tenantId: ctx.tenantId }, `[PortalNews] Seite ${action} (${postCount} Beiträge)`);
      return { action, postCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await storageOf(ctx).saveSetting(PORTAL_NEWS_PAGE_STATE_KEY, { ...state, lastError: message.slice(0, 2000), lastErrorAt: new Date().toISOString() }, ctx.tenantId);
      log.error({ err, event: "portal_news.page_failed", tenantId: ctx.tenantId }, "[PortalNews] Seite konnte nicht geschrieben werden");
      throw err instanceof PortalNewsError ? err : new PortalNewsError(`Seite konnte nicht in den Shop geschrieben werden: ${message.slice(0, 300)}`, "portal_news_page_failed", 502);
    }
  };
  const next = (writeQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
  writeQueues.set(key, next);
  return next;
}

export async function portalNewsPageInfo(ctx: ServiceContext): Promise<PortalNewsPageInfo> {
  const state = await readPageState(ctx);
  try {
    const shop = await (ctx.shopApi ?? defaultShopApiFactory)(ctx.tenantId);
    const [page, categories] = await Promise.all([shop.pageState(), shop.assignedCategories()]);
    return { ...state, cmsPageId: PORTAL_NEWS_CMS_PAGE_ID, exists: page.exists, categories };
  } catch (err) {
    log.warn({ err, tenantId: ctx.tenantId }, "[PortalNews] Seitenstand im Shop nicht lesbar");
    return { ...state, cmsPageId: PORTAL_NEWS_CMS_PAGE_ID, exists: false, categories: [], lastError: state.lastError ?? (err instanceof Error ? err.message : String(err)) };
  }
}

// ---------- Eingang ----------

function toContent(row: PortalNewsPostRow): PortalNewsContent {
  return {
    postDate: row.postDate,
    title: row.title,
    summary: row.summary,
    sections: (row.sections ?? []) as PortalNewsSection[],
    tags: (row.tags ?? []) as string[],
  };
}

const categoryFor = (status: PortalNewsStatus) =>
  status === "published" ? PORTAL_NEWS_CATEGORIES.published : status === "failed" ? PORTAL_NEWS_CATEGORIES.failed : PORTAL_NEWS_CATEGORIES.draft;

/** KI-Beitrag aus der Mail; veröffentlicht, wenn die Automatik an ist und das Ergebnis sicher ist */
async function evaluate(ctx: ServiceContext, row: PortalNewsPostRow, opts: { allowAutoPublish: boolean }): Promise<PortalNewsPostRow> {
  const extraction = await extractPortalNews(
    storageOf(ctx),
    { from: row.fromName || row.fromEmail || "", subject: row.subject, body: row.bodyText, receivedDate: berlinDate(row.receivedAt) },
    ctx.llm,
  );
  const sure = extraction.source === "ai" && extraction.isChangelog && extraction.confidence >= SURE_CHANGELOG_CONFIDENCE;
  const publish = opts.allowAutoPublish && ctx.settings.autoPublish && sure;
  const note = publish
    ? null
    : extraction.source !== "ai"
      ? extraction.reason
      : !extraction.isChangelog
        ? `Kein Changelog erkannt${extraction.reason ? `: ${extraction.reason}` : ""}`
        : !sure
          ? `KI unsicher (${Math.round(extraction.confidence * 100)} %)${extraction.reason ? `: ${extraction.reason}` : ""}`
          : null;
  const updated = await repoOf(ctx).update(
    ctx.tenantId,
    row.id,
    {
      ...extraction.content,
      source: extraction.source,
      status: publish ? "published" : "draft",
      publishedAt: publish ? new Date() : null,
      note: note?.slice(0, 1000) ?? null,
    },
    [event(publish ? "published" : "draft", publish ? "Beitrag erstellt und veröffentlicht" : `Beitrag als Entwurf erstellt${note ? ` – ${note}` : ""}`, "Automatik")],
  );
  if (!updated) throw new PortalNewsError("Beitrag nicht gefunden", "portal_news_not_found", 404);
  return updated;
}

/** Nach dem Veröffentlichen die Seite schreiben; ein Shop-Fehler macht den Beitrag nicht ungeschehen */
async function writePageQuietly(ctx: ServiceContext, postId: string): Promise<void> {
  try {
    await writePortalNewsPage(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repoOf(ctx).update(ctx.tenantId, postId, {}, [event("page_failed", `Seite im Shop nicht aktualisiert: ${message.slice(0, 300)}`)]);
  }
}

export async function ingestNewsMail(
  ctx: ServiceContext,
  input: { buffer: Buffer; graphMessageId?: string | null; mailbox?: string | null; subjectHint?: string | null; receivedAt?: Date | null },
): Promise<PortalNewsIntakeResponse> {
  const messageId = deriveUploadMessageId(input.buffer);
  const existing = await repoOf(ctx).findByMessageId(ctx.tenantId, messageId);
  if (existing) return { outcome: "duplicate", postId: existing.id, categories: [categoryFor(existing.status as PortalNewsStatus)] };
  const lockKey = `portal-news:${ctx.tenantId}:${messageId}`;
  if (!acquireIntakeLock(lockKey)) throw new PortalNewsError("Diese Mail wird gerade schon verarbeitet", "portal_news_in_progress", 409);
  try {
    const parsed = await parseEmailBufferAutodetect(input.buffer);
    const subject = (parsed.subject || input.subjectHint || "").trim();
    const body = (parsed.body || "").trim();
    // Absender = wer die Mail geschickt hat (Carolin/Sebastian). Nicht auspacken: Changelogs kommen meist
    // weitergeleitet, der innerste Absender ist dann der Dienstleister (Version 662: „Anton von WIRDUZEN“).
    const from = (parsed.from || "").trim();
    const fromEmail = from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]?.toLowerCase() ?? null;
    const receivedAt = input.receivedAt && !Number.isNaN(input.receivedAt.getTime()) ? input.receivedAt : new Date();

    const row = await repoOf(ctx).insert({
      tenantId: ctx.tenantId,
      messageId,
      graphMessageId: input.graphMessageId ?? null,
      mailbox: input.mailbox ?? null,
      subject: subject.slice(0, 500),
      fromEmail,
      fromName: from.replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "").slice(0, 300) || null,
      receivedAt,
      bodyText: body.slice(0, 100_000),
      status: "draft",
      source: "rules",
      postDate: berlinDate(receivedAt),
      title: subject.slice(0, 200),
      events: [event("received", `Mail „${subject.slice(0, 120)}“ eingegangen`)],
    });
    if (!row) {
      const again = await repoOf(ctx).findByMessageId(ctx.tenantId, messageId);
      return { outcome: "duplicate", postId: again?.id ?? null, categories: [categoryFor((again?.status ?? "draft") as PortalNewsStatus)] };
    }
    try {
      const done = await evaluate(ctx, row, { allowAutoPublish: true });
      if (done.status === "published") await writePageQuietly(ctx, done.id);
      log.info({ event: "portal_news.received", postId: row.id, status: done.status, tenantId: ctx.tenantId }, `[PortalNews] ${done.status}: ${subject}`);
      return { outcome: done.status === "published" ? "published" : "draft", postId: row.id, categories: [categoryFor(done.status as PortalNewsStatus)] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await repoOf(ctx).update(ctx.tenantId, row.id, { status: "failed", note: message.slice(0, 1000) }, [event("failed", `Verarbeitung gescheitert: ${message.slice(0, 300)}`)]);
      log.error({ err, event: "portal_news.failed", postId: row.id }, "[PortalNews] Verarbeitung gescheitert");
      return { outcome: "failed", postId: row.id, categories: [PORTAL_NEWS_CATEGORIES.failed] };
    }
  } finally {
    releaseIntakeLock(lockKey);
  }
}

/** Mailtext von Hand einfügen (ohne n8n); wird immer ein Entwurf, der Admin veröffentlicht selbst */
export async function createNewsFromText(ctx: ServiceContext, input: { subject: string; text: string }): Promise<PortalNewsPostRow> {
  const now = new Date();
  const row = await repoOf(ctx).insert({
    tenantId: ctx.tenantId,
    messageId: `manual:${randomUUID()}`,
    subject: input.subject.slice(0, 500),
    receivedAt: now,
    bodyText: input.text.slice(0, 100_000),
    status: "draft",
    source: "manual",
    postDate: berlinDate(now),
    title: input.subject.slice(0, 200),
    events: [event("received", "Text von Hand eingefügt", ctx.userName)],
  });
  if (!row) throw new PortalNewsError("Beitrag konnte nicht angelegt werden", "portal_news_insert_failed", 500);
  return evaluate(ctx, row, { allowAutoPublish: false });
}

// ---------- Bearbeiten ----------

async function mustGet(ctx: ServiceContext, id: string): Promise<PortalNewsPostRow> {
  const row = await repoOf(ctx).get(ctx.tenantId, id);
  if (!row) throw new PortalNewsError("Beitrag nicht gefunden", "portal_news_not_found", 404);
  return row;
}

export async function updateNewsContent(ctx: ServiceContext, id: string, content: PortalNewsContent): Promise<PortalNewsPostRow> {
  const wasPublished = (await mustGet(ctx, id)).status === "published";
  const updated = await repoOf(ctx).update(ctx.tenantId, id, { ...content }, [event("edited", "Beitrag bearbeitet", ctx.userName)]);
  if (!updated) throw new PortalNewsError("Beitrag nicht gefunden", "portal_news_not_found", 404);
  if (wasPublished) await writePortalNewsPage(ctx);
  return updated;
}

/** Veröffentlichen bzw. ausblenden; schreibt die Seite neu */
export async function setNewsStatus(ctx: ServiceContext, id: string, status: "published" | "hidden"): Promise<PortalNewsPostRow> {
  const row = await mustGet(ctx, id);
  if (row.status === status) return row;
  const wasPublished = row.status === "published";
  if (status === "published" && (!row.title.trim() || !((row.sections ?? []) as PortalNewsSection[]).length)) {
    throw new PortalNewsError("Beitrag braucht Titel und mindestens einen Punkt", "portal_news_incomplete");
  }
  const updated = await repoOf(ctx).update(
    ctx.tenantId,
    id,
    { status, note: null, ...(status === "published" ? { publishedAt: new Date() } : {}) },
    [event(status, status === "published" ? "Veröffentlicht" : "Ausgeblendet", ctx.userName)],
  );
  if (!updated) throw new PortalNewsError("Beitrag nicht gefunden", "portal_news_not_found", 404);
  if (status === "published" || wasPublished) await writePortalNewsPage(ctx);
  return updated;
}

export async function deleteNews(ctx: ServiceContext, id: string): Promise<void> {
  const row = await mustGet(ctx, id);
  await repoOf(ctx).remove(ctx.tenantId, id);
  if (row.status === "published") await writePortalNewsPage(ctx);
}

/** KI noch einmal über die Mail laufen lassen (z. B. nach Einrichten der KI); Ergebnis wird Entwurf */
export async function rewriteNews(ctx: ServiceContext, id: string): Promise<PortalNewsPostRow> {
  const row = await mustGet(ctx, id);
  if (!row.bodyText.trim()) throw new PortalNewsError("Kein Mailtext vorhanden", "portal_news_no_text");
  const wasPublished = row.status === "published";
  const updated = await evaluate(ctx, row, { allowAutoPublish: false });
  if (wasPublished) await writePortalNewsPage(ctx);
  return updated;
}
