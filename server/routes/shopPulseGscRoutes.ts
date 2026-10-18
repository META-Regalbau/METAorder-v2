// Shop-Puls Stufe 2 (S2-5), Search Console (nur Administratoren): Einstellungen (Schalter, Property,
// Dienstkonto-JSON verschlüsselt; das JSON wird nie zurückgegeben) und der KI-Vorschlag für Meta-Title und
// -Description zu einer Meldung „viele Impressionen, wenig Klicks“. Der Vorschlag wird nur angezeigt, METAorder
// schreibt nichts in den Shop.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAdministrator, requireAuth, requireCsrf } from "../auth/auth";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { chatCompletion, parseLlmJsonResponse } from "../ai/llmChat";
import type { ShopPulseGscOverview, ShopPulseMetaSuggestionResult } from "@shared/shopPulse";
import { checkGscSetup, getGscSettings, gscAccess, GscNotConfiguredError, saveGscSettings } from "../shopPulse/gscClient";
import { gscDataEnd } from "../shopPulse/detectors/gsc";
import { addDays } from "../shopPulse/pulseOrders";
import { extractPageMeta, suggestPageMeta } from "../shopPulse/gscMeta";
import * as repo from "../shopPulse/shopPulseRepository";
import { storefrontAccess } from "../shopPulse/shopPulseScheduler";
import { ShopBusyError } from "../shopContent/shopWatch";

const moduleLog = logger.child({ component: "routes/shopPulseGscRoutes" });

const tenantOf = (req: Request) => ((req as any).tenantId as string | undefined) ?? null;
const userName = (req: Request) => String((req as any).user?.username ?? "admin").slice(0, 120);

const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    property: z.string().trim().max(300).optional(),
    /** "" = Dienstkonto löschen, fehlt = behalten */
    serviceAccountJson: z.string().max(20_000).optional(),
  })
  .strict();

async function overview(tenantId: string | null): Promise<ShopPulseGscOverview> {
  const s = await getGscSettings(storage, tenantId);
  const setup = checkGscSetup(s);
  let email: string | null = null;
  try {
    email = s.serviceAccountJson ? (String(JSON.parse(s.serviceAccountJson).client_email ?? "") || null) : null;
  } catch {
    email = null;
  }
  return { enabled: s.enabled, property: s.property, serviceAccountEmail: email, hasServiceAccount: !!s.serviceAccountJson, problem: setup.ok ? null : setup.reason };
}

export function registerShopPulseGscRoutes(app: Express): void {
  app.get("/api/shop-pulse/search-console", requireAuth, requireAdministrator, async (req: Request, res: Response) => {
    try {
      res.json(await overview(tenantOf(req)));
    } catch (error) {
      moduleLog.error({ err: error }, "Search Console: Einstellungen laden fehlgeschlagen");
      res.status(500).json({ error: "Failed to load Search Console settings" });
    }
  });

  app.put("/api/shop-pulse/search-console/settings", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Search Console settings" });
    const json = parsed.data.serviceAccountJson?.trim();
    if (json) {
      try {
        const c = JSON.parse(json);
        if (typeof c?.client_email !== "string" || typeof c?.private_key !== "string") throw new Error("shape");
      } catch {
        return res.status(400).json({ error: "Invalid service account JSON" });
      }
    }
    const tenantId = tenantOf(req);
    try {
      await saveGscSettings(storage, tenantId, parsed.data);
      moduleLog.info({ tenantId, by: userName(req), enabled: parsed.data.enabled, serviceAccount: json === undefined ? "unchanged" : json ? "set" : "removed" }, "Search Console: Einstellungen gespeichert");
      res.json(await overview(tenantId));
    } catch (error) {
      moduleLog.error({ err: error, tenantId }, "Search Console: Einstellungen speichern fehlgeschlagen");
      res.status(500).json({ error: "Failed to save Search Console settings" });
    }
  });

  /**
   * KI-Vorschlag zu einer offenen Meldung „viele Impressionen, wenig Klicks“: Seite einmal abrufen (unter der
   * Sperre des Shop-Wächters), Suchanfragen der Seite aus der Search Console, KI mit den Prüfregeln der
   * Artikel-Meta-Texte. Nichts wird gespeichert oder in den Shop geschrieben.
   */
  app.post("/api/shop-pulse/search-console/meta-suggestion", requireAuth, requireAdministrator, requireCsrf, async (req: Request, res: Response) => {
    const parsed = z.object({ signalId: z.string().min(1).max(64) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid meta suggestion request" });
    const tenantId = tenantOf(req);
    try {
      const signal = (await repo.listOpenSignals(tenantId)).find((s) => s.id === parsed.data.signalId && s.code === "gscLowCtr");
      if (!signal) return res.status(404).json({ error: "Shop pulse signal not found" });
      const path = String(signal.evidence.page ?? signal.params.page ?? "");
      const pageUrl = String(signal.evidence.url ?? "");
      const property = await gscAccess(storage, tenantId).property();
      const end = gscDataEnd(new Date());
      const queries = pageUrl
        ? (await property.searchAnalytics({ startDate: addDays(end, -27), endDate: end, dimensions: ["query"], page: pageUrl, rowLimit: 20 })).sort((a, b) => b.impressions - a.impressions).map((r) => r.keys[0] ?? "")
        : [];
      const page = await storefrontAccess(storage, tenantId).withShop(async (shop) => {
        const res = await (shop.fetchImpl ?? fetch)(`${shop.storefront.replace(/\/+$/, "")}${path}`, { redirect: "follow" } as any);
        if (!res.ok) throw new Error(`Seite ${path}: HTTP ${res.status}`);
        return extractPageMeta(await res.text());
      });
      const getSetting = (key: string) => storage.getSetting(key, tenantId);
      const r = await suggestPageMeta(
        (messages) => chatCompletion(getSetting, { tier: "smart", temperature: 0.4, max_tokens: 800, response_json: true, messages }),
        parseLlmJsonResponse,
        { url: pageUrl || path, page, queries },
      );
      moduleLog.info({ tenantId, page: path, ok: !!r.suggestion, rejected: r.rejected, by: userName(req) }, "Search Console: Meta-Vorschlag erzeugt");
      const result: ShopPulseMetaSuggestionResult = { page: path, current: { title: page.title, description: page.description }, queries: queries.slice(0, 10), suggestion: r.suggestion, rejected: r.rejected };
      res.json(result);
    } catch (error) {
      if (error instanceof GscNotConfiguredError) return res.status(409).json({ error: "Search Console not configured" });
      if (error instanceof ShopBusyError) return res.status(409).json({ error: "Shop is busy, try again shortly" });
      moduleLog.error({ err: error, tenantId }, "Search Console: Meta-Vorschlag fehlgeschlagen");
      res.status(500).json({ error: "Failed to create meta suggestion" });
    }
  });
}
