/**
 * Portal-Neuigkeiten: die Erlebniswelt im Shop. METAorder legt sie einmal an (feste IDs) und ersetzt danach
 * nur noch den Inhalt des HTML-Blocks – die Seite wird nie gelöscht, damit die Zuordnung zur Portal-Kategorie,
 * die der Admin von Hand macht, erhalten bleibt.
 */
import type { ShopwareSettings } from "@shared/schema";
import { portalNewsEntityId } from "../shopContent/shopEntityIds";
import { shopApi, type ShopApi } from "../shopContent/shopProducts";

export const PORTAL_NEWS_CMS_PAGE_ID = portalNewsEntityId("cms");
export const PORTAL_NEWS_CMS_PAGE_NAME = "METAorder Portal – Neuigkeiten";
const SECTION_ID = portalNewsEntityId("section");
const BLOCK_ID = portalNewsEntityId("block");
const SLOT_ID = portalNewsEntityId("slot");

const ALL_DEVICES = { mobile: true, tablet: true, desktop: true };
const NO_MARGINS = { marginTop: "0", marginBottom: "0", marginLeft: "0", marginRight: "0" };

export function portalNewsSection(html: string) {
  return {
    id: SECTION_ID,
    type: "default",
    position: 0,
    sizingMode: "boxed",
    mobileBehavior: "wrap",
    visibility: ALL_DEVICES,
    blocks: [
      {
        id: BLOCK_ID,
        type: "html",
        position: 0,
        sectionPosition: "main",
        ...NO_MARGINS,
        visibility: ALL_DEVICES,
        slots: [{ id: SLOT_ID, type: "html", slot: "content", config: { content: { source: "static", value: html } } }],
      },
    ],
  };
}

export type PortalNewsShopApi = {
  /** Erlebniswelt und HTML-Feld vorhanden? */
  pageState(): Promise<{ exists: boolean; hasSlot: boolean }>;
  /** Seite anlegen bzw. den Inhalt ersetzen */
  writePage(html: string): Promise<"created" | "updated" | "repaired">;
  /** Kategorien, denen die Seite zugeordnet ist */
  assignedCategories(): Promise<Array<{ id: string; name: string }>>;
};

export function createPortalNewsShopApi(api: ShopApi): PortalNewsShopApi {
  const pageState = async () => {
    const page = (
      await api("POST", "search/cms-page", {
        ids: [PORTAL_NEWS_CMS_PAGE_ID],
        associations: { sections: { associations: { blocks: { associations: { slots: {} } } } } },
        includes: { cms_page: ["id", "sections"], cms_section: ["blocks"], cms_block: ["slots"], cms_slot: ["id"] },
      })
    )?.data?.[0];
    if (!page) return { exists: false, hasSlot: false };
    const slotIds = ((page.sections ?? []) as any[]).flatMap((s) => (s.blocks ?? []).flatMap((b: any) => (b.slots ?? []).map((x: any) => x.id)));
    return { exists: true, hasSlot: slotIds.includes(SLOT_ID) };
  };

  return {
    pageState,
    async writePage(html) {
      const state = await pageState();
      if (!state.exists) {
        await api("POST", "cms-page", { id: PORTAL_NEWS_CMS_PAGE_ID, name: PORTAL_NEWS_CMS_PAGE_NAME, type: "page", sections: [portalNewsSection(html)] });
        return "created";
      }
      if (!state.hasSlot) {
        // Block wurde im Admin gelöscht: eigenen Abschnitt wieder einhängen (Rest der Seite bleibt)
        await api("PATCH", `cms-page/${PORTAL_NEWS_CMS_PAGE_ID}`, { sections: [portalNewsSection(html)] });
        return "repaired";
      }
      await api("PATCH", `cms-slot/${SLOT_ID}`, { config: { content: { source: "static", value: html } } });
      return "updated";
    },
    async assignedCategories() {
      const rows = (
        await api("POST", "search/category", {
          limit: 20,
          filter: [{ type: "equals", field: "cmsPageId", value: PORTAL_NEWS_CMS_PAGE_ID }],
          includes: { category: ["id", "name", "translated"] },
        })
      )?.data ?? [];
      return (rows as any[]).map((c) => ({ id: c.id as string, name: (c.translated?.name ?? c.name ?? "") as string }));
    },
  };
}

export function portalNewsShopApiFor(settings: ShopwareSettings): PortalNewsShopApi {
  return createPortalNewsShopApi(shopApi(settings).api);
}
