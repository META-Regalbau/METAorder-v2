/**
 * SFTP-Server (DMS-Übergabe Lobster → d.3): Einstellungsrouten + manueller Upload.
 *
 *   GET    /api/settings/sftp-servers                Liste (ohne Secrets)
 *   GET    /api/settings/sftp-servers/logs           Upload-Protokoll
 *   POST   /api/settings/sftp-servers                Anlegen
 *   PATCH  /api/settings/sftp-servers/:id            Ändern (Secrets: undefined = unverändert, "" = löschen)
 *   DELETE /api/settings/sftp-servers/:id            Löschen
 *   POST   /api/settings/sftp-servers/test           Verbindungstest mit unsaved Daten
 *   POST   /api/settings/sftp-servers/:id/test       Verbindungstest (gespeichert, Body überschreibt optional)
 *   POST   /api/order-drafts/:id/attachments/sftp-upload   Beilagen jetzt hochladen (manuell)
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { SftpServer } from "@shared/schema";
import { requireAuth, requireCsrf, requireManageOrderDrafts, requireManageSettings } from "./auth";
import { storage } from "./storage";
import {
  bodyToSftpServerValues,
  sftpServerBodySchema,
  sftpServerPatchSchema,
  toSftpServerApi,
  validateSftpAuth,
} from "./sftpServers";
import { testSftpServer, uploadDraftAttachmentsToSftp } from "./sftpUpload";
import { listDraftAttachmentsForApi } from "./draftAttachmentRoutes";

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

/** Testdaten aus Body (unverschlüsselt) über einen gespeicherten Server legen. */
function mergeForTest(base: SftpServer | null, body: unknown): SftpServer | { error: string } {
  const parsed = (base ? sftpServerPatchSchema : sftpServerBodySchema).safeParse(body ?? {});
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const values = bodyToSftpServerValues(parsed.data);
  // bodyToSftpServerValues verschlüsselt Secrets — für den Test ist das in Ordnung,
  // resolveSftpCredentials entschlüsselt wieder. Leere Strings im Body bedeuten "gespeichertes behalten".
  const b = parsed.data;
  const keepStored = <K extends "password" | "privateKey" | "passphrase">(key: K) => {
    if (b[key] === undefined || b[key] === null || (typeof b[key] === "string" && b[key]!.trim() === "")) {
      delete values[key];
    }
  };
  keepStored("password");
  keepStored("privateKey");
  keepStored("passphrase");
  const merged: SftpServer = {
    id: base?.id ?? "unsaved",
    tenantId: base?.tenantId ?? null,
    name: base?.name ?? "Test",
    host: base?.host ?? "",
    port: base?.port ?? 22,
    username: base?.username ?? "",
    authMethod: base?.authMethod ?? "password",
    password: base?.password ?? null,
    privateKey: base?.privateKey ?? null,
    passphrase: base?.passphrase ?? null,
    hostKeyFingerprint: base?.hostKeyFingerprint ?? null,
    remotePath: base?.remotePath ?? "/",
    filenameTemplate: base?.filenameTemplate ?? "{orderNumber}_{documentKind}_{originalName}",
    documentKinds: base?.documentKinds ?? ["delivery_note"],
    writeMetadataSidecar: base?.writeMetadataSidecar ?? 1,
    autoUploadOnOrderCreate: base?.autoUploadOnOrderCreate ?? 1,
    enabled: base?.enabled ?? 1,
    maxAttempts: base?.maxAttempts ?? 3,
    initialBackoffMs: base?.initialBackoffMs ?? 2000,
    backoffFactor: base?.backoffFactor ?? 2,
    timeoutMs: base?.timeoutMs ?? 20000,
    createdAt: base?.createdAt ?? new Date(),
    updatedAt: base?.updatedAt ?? new Date(),
    ...values,
  } as SftpServer;
  if (!merged.host || !merged.username) return { error: "Host und Benutzername sind erforderlich" };
  const authError = validateSftpAuth(merged);
  if (authError) return { error: authError };
  return merged;
}

const manualUploadBodySchema = z.object({
  serverIds: z.array(z.string().min(1)).optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
  force: z.boolean().optional(),
});

export function registerSftpRoutes(app: Express): void {
  app.get("/api/settings/sftp-servers", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const servers = await storage.getSftpServers(req.tenantId ?? null);
      res.json(servers.map(toSftpServerApi));
    } catch (error) {
      console.error("[SFTP] Liste fehlgeschlagen:", error);
      res.status(500).json({ error: "SFTP-Server konnten nicht geladen werden" });
    }
  });

  app.get("/api/settings/sftp-servers/logs", requireAuth, requireManageSettings, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const serverId = typeof req.query.serverId === "string" ? req.query.serverId : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const draftId = typeof req.query.draftId === "string" ? req.query.draftId : undefined;
      const result = await storage.getSftpUploadLogs({ serverId, status, draftId, limit, offset }, req.tenantId ?? null);
      res.json(result);
    } catch (error) {
      console.error("[SFTP] Protokoll fehlgeschlagen:", error);
      res.status(500).json({ error: "Upload-Protokoll konnte nicht geladen werden" });
    }
  });

  app.post("/api/settings/sftp-servers", requireAuth, requireManageSettings, requireCsrf, async (req: Request, res: Response) => {
    try {
      const parsed = sftpServerBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
      let values;
      try {
        values = bodyToSftpServerValues(parsed.data);
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Ungültige Eingabe" });
      }
      const authError = validateSftpAuth({
        authMethod: values.authMethod ?? "password",
        password: values.password ?? null,
        privateKey: values.privateKey ?? null,
      });
      if (authError) return res.status(400).json({ error: authError });
      const existing = await storage.getSftpServers(req.tenantId ?? null);
      if (existing.some((s) => s.name.toLowerCase() === parsed.data.name.toLowerCase())) {
        return res.status(409).json({ error: "Ein SFTP-Server mit dieser Bezeichnung existiert bereits" });
      }
      const created = await storage.createSftpServer(values as Parameters<typeof storage.createSftpServer>[0], req.tenantId ?? null);
      res.status(201).json(toSftpServerApi(created));
    } catch (error) {
      console.error("[SFTP] Anlegen fehlgeschlagen:", error);
      res.status(500).json({ error: "SFTP-Server konnte nicht angelegt werden" });
    }
  });

  app.patch("/api/settings/sftp-servers/:id", requireAuth, requireManageSettings, requireCsrf, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getSftpServer(req.params.id, req.tenantId ?? null);
      if (!existing) return res.status(404).json({ error: "SFTP-Server nicht gefunden" });
      const parsed = sftpServerPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
      let values;
      try {
        values = bodyToSftpServerValues(parsed.data);
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Ungültige Eingabe" });
      }
      const merged = { ...existing, ...values };
      const authError = validateSftpAuth(merged);
      if (authError) return res.status(400).json({ error: authError });
      if (values.name && values.name.toLowerCase() !== existing.name.toLowerCase()) {
        const all = await storage.getSftpServers(req.tenantId ?? null);
        if (all.some((s) => s.id !== existing.id && s.name.toLowerCase() === values.name!.toLowerCase())) {
          return res.status(409).json({ error: "Ein SFTP-Server mit dieser Bezeichnung existiert bereits" });
        }
      }
      const updated = await storage.updateSftpServer(existing.id, values, req.tenantId ?? null);
      if (!updated) return res.status(404).json({ error: "SFTP-Server nicht gefunden" });
      res.json(toSftpServerApi(updated));
    } catch (error) {
      console.error("[SFTP] Ändern fehlgeschlagen:", error);
      res.status(500).json({ error: "SFTP-Server konnte nicht gespeichert werden" });
    }
  });

  app.delete("/api/settings/sftp-servers/:id", requireAuth, requireManageSettings, requireCsrf, async (req: Request, res: Response) => {
    try {
      const ok = await storage.deleteSftpServer(req.params.id, req.tenantId ?? null);
      if (!ok) return res.status(404).json({ error: "SFTP-Server nicht gefunden" });
      res.json({ success: true });
    } catch (error) {
      console.error("[SFTP] Löschen fehlgeschlagen:", error);
      res.status(500).json({ error: "SFTP-Server konnte nicht gelöscht werden" });
    }
  });

  const handleTest = async (req: Request, res: Response) => {
    try {
      const base = req.params.id ? await storage.getSftpServer(req.params.id, req.tenantId ?? null) : null;
      if (req.params.id && !base) return res.status(404).json({ error: "SFTP-Server nicht gefunden" });
      const merged = mergeForTest(base ?? null, req.body);
      if ("error" in merged) return res.status(400).json({ ok: false, message: merged.error, error: merged.error });
      const result = await testSftpServer(merged);
      res.json(result);
    } catch (error) {
      console.error("[SFTP] Verbindungstest fehlgeschlagen:", error);
      res.status(500).json({ ok: false, message: error instanceof Error ? error.message : "Verbindungstest fehlgeschlagen" });
    }
  };
  app.post("/api/settings/sftp-servers/test", requireAuth, requireManageSettings, requireCsrf, handleTest);
  app.post("/api/settings/sftp-servers/:id/test", requireAuth, requireManageSettings, requireCsrf, handleTest);

  // Manueller Upload aus dem Review-Modal (z. B. nach fehlgeschlagenem Auto-Upload oder Neuanlage des Servers)
  app.post("/api/order-drafts/:id/attachments/sftp-upload", requireAuth, requireManageOrderDrafts, requireCsrf, async (req: Request, res: Response) => {
    try {
      const draft = await storage.getOrderDraft(req.params.id, req.tenantId ?? null);
      if (!draft) return res.status(404).json({ error: "Order draft not found" });
      const parsed = manualUploadBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: zodMessage(parsed.error) });
      const servers = (await storage.getSftpServers(req.tenantId ?? null)).filter((s) => s.enabled === 1);
      if (servers.length === 0) return res.status(400).json({ error: "Kein aktiver SFTP-Server konfiguriert" });
      const summary = await uploadDraftAttachmentsToSftp({
        storage,
        draftId: draft.id,
        tenantId: req.tenantId ?? null,
        trigger: "manual",
        serverIds: parsed.data.serverIds,
        attachmentIds: parsed.data.attachmentIds,
        force: parsed.data.force ?? true,
      });
      res.json({
        requestId: summary.requestId,
        uploaded: summary.uploaded,
        failed: summary.failed,
        skipped: summary.skipped,
        results: summary.results,
        attachments: listDraftAttachmentsForApi(summary.attachments),
      });
    } catch (error) {
      console.error("[SFTP] Manueller Upload fehlgeschlagen:", error);
      res.status(500).json({ error: "SFTP-Upload fehlgeschlagen" });
    }
  });
}
