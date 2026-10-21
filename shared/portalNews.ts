/**
 * Portal-Neuigkeiten: Changelog-Mails (von Carolin/Sebastian) werden per Outlook-Regel in einen Ordner
 * im Postfach verschoben. n8n holt sie dort ab und schickt sie an METAorder. Die KI schreibt daraus einen
 * Beitrag für interne Mitarbeiter (was ist neu, was ändert sich), METAorder schreibt alle veröffentlichten
 * Beiträge auf eine Erlebniswelt im Shop. Die Seite einer Kategorie im Portal zuordnen macht der Admin
 * von Hand (B2Bsellers bildet die Sichtbarkeit im Standard nicht ab) – METAorder fasst nur den Inhalt an.
 */
import { z } from "zod";

export const PORTAL_NEWS_SETTING_KEY = "portal_news_settings";
/** Stand der Shop-Seite (zuletzt geschrieben, Fehler) */
export const PORTAL_NEWS_PAGE_STATE_KEY = "portal_news_page_state";

export const portalNewsSettingsSchema = z.object({
  /** Aus: der Workflow holt keine Mails */
  enabled: z.boolean(),
  /** Postfach mit dem Ordner (z. B. osteiling@…); leer = Postfach des n8n-Outlook-Zugangs */
  mailbox: z.string().trim().max(254),
  /** Unterordner des Posteingangs, in den die Outlook-Regel die Changelog-Mails verschiebt */
  sourceFolderName: z.string().trim().min(1).max(120),
  maxPerRun: z.number().int().min(1).max(20),
  /** Nur Mails ab diesem Tag (JJJJ-MM-TT); leer = die letzten 2 Tage */
  processSince: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  /** Neue Beiträge sofort auf die Seite schreiben; aus = Entwurf, Veröffentlichen von Hand */
  autoPublish: z.boolean(),
  /** Überschrift und Einleitung oben auf der Seite */
  pageTitle: z.string().trim().min(1).max(120),
  pageIntro: z.string().trim().max(600),
});

export type PortalNewsSettings = z.infer<typeof portalNewsSettingsSchema>;

export const DEFAULT_PORTAL_NEWS_SETTINGS: PortalNewsSettings = {
  // Aus, bis Postfach und Startdatum eingetragen sind
  enabled: false,
  mailbox: "",
  sourceFolderName: "METAorder Neuigkeiten",
  maxPerRun: 5,
  processSince: "",
  autoPublish: true,
  pageTitle: "Neuigkeiten",
  pageIntro: "Was sich in Shop, Portal und unseren Systemen geändert hat – die neuesten Änderungen stehen oben.",
};

/** Gespeicherten Wert mit Standardwerten auffüllen; Unbrauchbares fällt auf den Standard zurück. */
export function normalizePortalNewsSettings(stored: unknown): PortalNewsSettings {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: PortalNewsSettings = { ...DEFAULT_PORTAL_NEWS_SETTINGS };
  for (const key of Object.keys(DEFAULT_PORTAL_NEWS_SETTINGS) as Array<keyof PortalNewsSettings>) {
    if (!(key in raw)) continue;
    const field = portalNewsSettingsSchema.shape[key].safeParse(raw[key]);
    if (field.success) (out as Record<string, unknown>)[key] = field.data;
  }
  return out;
}

/** Outlook-Kategorien, die n8n an die Mail hängt; erledigte Mails bleiben im Ordner liegen */
export const PORTAL_NEWS_CATEGORIES = {
  published: "METAorder: Neuigkeit veröffentlicht",
  draft: "METAorder: Neuigkeit prüfen",
  failed: "METAorder: Fehler",
} as const;

export function portalNewsMessageFilter(receivedAfter: string): string {
  const notCategorized = Object.values(PORTAL_NEWS_CATEGORIES)
    .map((c) => `not(categories/any(c:c eq '${c.replace(/'/g, "''")}'))`)
    .join(" and ");
  return `receivedDateTime ge ${receivedAfter} and ${notCategorized}`;
}

export const PORTAL_NEWS_STATUSES = [
  /** Steht auf der Seite */
  "published",
  /** Wartet auf Prüfung (Automatik aus, KI nicht verfügbar oder kein Changelog erkannt) */
  "draft",
  /** Von Hand ausgeblendet */
  "hidden",
  /** Verarbeitung gescheitert */
  "failed",
] as const;
export type PortalNewsStatus = (typeof PORTAL_NEWS_STATUSES)[number];

export const portalNewsSectionSchema = z.object({
  /** z. B. „Neu“, „Verbessert“, „Behoben“ oder ein Bereich wie „Händlerportal“ */
  heading: z.string().trim().max(120),
  items: z.array(z.string().trim().min(1).max(1000)).max(40),
});
export type PortalNewsSection = z.infer<typeof portalNewsSectionSchema>;

/** Inhalt eines Beitrags (KI-Vorschlag, vom Admin änderbar) */
export const portalNewsContentSchema = z.object({
  /** Datum über dem Beitrag (JJJJ-MM-TT) */
  postDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000),
  sections: z.array(portalNewsSectionSchema).max(12),
  /** Kurze Schlagwörter (Bereiche), höchstens 4 */
  tags: z.array(z.string().trim().min(1).max(40)).max(4),
});
export type PortalNewsContent = z.infer<typeof portalNewsContentSchema>;

export type PortalNewsEvent = { at: string; type: string; message: string; by?: string | null };

export type PortalNewsPost = PortalNewsContent & {
  id: string;
  status: PortalNewsStatus;
  source: "ai" | "rules" | "manual";
  subject: string;
  fromEmail: string | null;
  fromName: string | null;
  receivedAt: string;
  publishedAt: string | null;
  /** Warum der Beitrag ein Entwurf blieb bzw. was schiefging */
  note: string | null;
  updatedAt: string;
};

export type PortalNewsPostDetail = PortalNewsPost & {
  bodyText: string;
  events: PortalNewsEvent[];
};

export type PortalNewsPageState = {
  /** Zuletzt erfolgreich in den Shop geschrieben */
  writtenAt: string | null;
  /** Anzahl Beiträge auf der Seite beim letzten Schreiben */
  postCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type PortalNewsPageInfo = PortalNewsPageState & {
  cmsPageId: string;
  /** Erlebniswelt im Shop vorhanden */
  exists: boolean;
  /** Kategorien, denen die Erlebniswelt zugeordnet ist (Zuordnung macht der Admin selbst) */
  categories: Array<{ id: string; name: string }>;
};

export type PortalNewsIntakeResponse = {
  outcome: "published" | "draft" | "duplicate" | "failed";
  postId: string | null;
  categories: string[];
};

export type PortalNewsWorkflowConfig = {
  enabled: boolean;
  graphBase: string;
  mailbox: string | null;
  sourceFolderName: string;
  maxPerRun: number;
  receivedAfter: string;
  messageFilter: string;
  categories: typeof PORTAL_NEWS_CATEGORIES;
};
