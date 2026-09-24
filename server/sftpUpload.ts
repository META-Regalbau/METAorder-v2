/**
 * Upload von Entwurfs-Beilagen (Kundenlieferschein u. a.) an konfigurierte SFTP-Server.
 *
 * Ablauf (Trigger: Bestellanlage aus dem Entwurf oder manuell aus dem Review-Modal):
 *   1. Alle aktiven SFTP-Server des Mandanten laden (bei Auto-Trigger nur die mit
 *      `autoUploadOnOrderCreate`).
 *   2. Beilagen filtern: Belegart in `documentKinds` des Servers, `exportStatus = pending`
 *      (bei `force` auch bereits exportierte).
 *   3. Je Server: Verbindung aufbauen, Zielordner anlegen, Datei als `.part` hochladen und
 *      umbenennen (Lobster sieht nie halbe Dateien), danach optional die JSON-Sidecar mit den
 *      Zuordnungsdaten (Bestellnummer, Kundennummer, Kundenbestellnummer, LS-Nr., Kommission).
 *   4. Wiederholungen mit exponentiellem Backoff (max_attempts / initial_backoff_ms /
 *      backoff_factor), jeder Versuch landet in `sftp_upload_logs`.
 *   5. Erfolgreiche Beilagen: `exportStatus = exported`, `exportReference = sftp:<Server>:<Pfad>`.
 *
 * Läuft bei der Bestellanlage fire-and-forget — die Bestellung wartet nicht auf den Upload.
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import SftpClient from "ssh2-sftp-client";
import type { ConnectConfig } from "ssh2";
import type { DraftAttachment, OrderDraft, SftpServer, SftpUploadDocumentKind } from "@shared/schema";
import type { IStorage } from "./storage";
import { resolveSftpCredentials } from "./sftpServers";
import { attachmentKindLabelDe } from "./commercialAttachmentClassifier";
import { applyDraftAttachmentExportUpdate } from "./draftAttachmentRoutes";
import { getUploadsRoot } from "./uploadsRoot";
import { ShopwareClient } from "./shopware";

export type SftpUploadTrigger = "order_created" | "manual" | "test";

export type SftpUploadResult = {
  serverId: string;
  serverName: string;
  attachmentId: string;
  fileName: string;
  remotePath: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  attempts: number;
};

export type SftpUploadSummary = {
  requestId: string;
  uploaded: number;
  failed: number;
  skipped: number;
  results: SftpUploadResult[];
  attachments: DraftAttachment[];
};

type OrderMeta = {
  shopwareOrderId: string | null;
  orderNumber: string | null;
  customerNumber: string | null;
  customerName: string | null;
};

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

function normalizeFingerprint(input: string): { kind: "sha256" | "md5" | "raw"; value: string } {
  const s = input.trim();
  const m = /^SHA256:(.+)$/i.exec(s);
  if (m) return { kind: "sha256", value: m[1].replace(/=+$/, "") };
  const md5 = /^MD5:(.+)$/i.exec(s);
  if (md5) return { kind: "md5", value: md5[1].replace(/:/g, "").toLowerCase() };
  return { kind: "raw", value: s.replace(/:/g, "").toLowerCase() };
}

/** Host-Key-Prüfung: erwartet `SHA256:<base64>` (ssh-keyscan | ssh-keygen -lf), Hex oder MD5. */
function buildHostVerifier(expected: string): Pick<ConnectConfig, "hostHash" | "hostVerifier"> {
  const fp = normalizeFingerprint(expected);
  if (fp.kind === "md5") {
    return { hostHash: "md5", hostVerifier: (hex: string) => hex.toLowerCase() === fp.value };
  }
  return {
    hostHash: "sha256",
    hostVerifier: (hex: string) => {
      const hexLower = hex.toLowerCase();
      if (fp.kind === "raw") return hexLower === fp.value;
      const b64 = Buffer.from(hexLower, "hex").toString("base64").replace(/=+$/, "");
      return b64 === fp.value;
    },
  };
}

export function buildSftpConnectConfig(server: SftpServer): ConnectConfig & { retries: number } {
  const creds = resolveSftpCredentials(server);
  const cfg: ConnectConfig & { retries: number } = {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    readyTimeout: server.timeoutMs || 20000,
    keepaliveInterval: 10000,
    retries: 0, // eigene Wiederholungslogik
  };
  if (server.authMethod === "key") {
    if (!creds.privateKey) throw new Error("Kein Private Key hinterlegt");
    cfg.privateKey = creds.privateKey;
    if (creds.passphrase) cfg.passphrase = creds.passphrase;
  } else {
    if (!creds.password) throw new Error("Kein Passwort hinterlegt");
    cfg.password = creds.password;
  }
  if (server.hostKeyFingerprint) Object.assign(cfg, buildHostVerifier(server.hostKeyFingerprint));
  return cfg;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: Zeitüberschreitung nach ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function joinRemote(dir: string, file: string): string {
  const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  return `${base}/${file}`;
}

/** Verbindungstest: Login + Verzeichnisliste des Zielpfads. */
export async function testSftpServer(server: SftpServer): Promise<{
  ok: boolean;
  message: string;
  pathExists?: boolean;
  entries?: number;
  durationMs: number;
}> {
  const started = Date.now();
  const client = new SftpClient();
  try {
    const cfg = buildSftpConnectConfig(server);
    await client.connect(cfg);
    const remote = server.remotePath || "/";
    const exists = await withTimeout(client.exists(remote), server.timeoutMs || 20000, "exists");
    if (!exists) {
      return {
        ok: true,
        pathExists: false,
        message: `Verbindung OK — Zielpfad ${remote} existiert noch nicht (wird beim ersten Upload angelegt)`,
        durationMs: Date.now() - started,
      };
    }
    if (exists !== "d") {
      return { ok: false, pathExists: true, message: `Zielpfad ${remote} ist kein Verzeichnis`, durationMs: Date.now() - started };
    }
    const list = await withTimeout(client.list(remote), server.timeoutMs || 20000, "list");
    return {
      ok: true,
      pathExists: true,
      entries: list.length,
      message: `Verbindung OK — ${list.length} Einträge in ${remote}`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, message: describeSftpError(error), durationMs: Date.now() - started };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function describeSftpError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const msg = error.message || error.name;
  const code = (error as { code?: string }).code;
  if (code === "ENOTFOUND") return `Host nicht gefunden (${msg})`;
  if (code === "ECONNREFUSED") return `Verbindung abgelehnt (${msg})`;
  if (/All configured authentication methods failed/i.test(msg)) return "Authentifizierung fehlgeschlagen (Benutzer/Passwort/Key prüfen)";
  if (/Host denied|verification failed|Host key/i.test(msg)) return `Host-Key stimmt nicht mit dem hinterlegten Fingerprint überein (${msg})`;
  if (/Timed out/i.test(msg)) return `Zeitüberschreitung beim Verbindungsaufbau (${msg})`;
  return msg;
}

// ---------------------------------------------------------------------------
// Dateiname & Sidecar
// ---------------------------------------------------------------------------

function sanitizeSegment(value: string | null | undefined): string {
  return (value ?? "")
    .toString()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
}

export function renderSftpFilename(params: {
  template: string;
  attachment: DraftAttachment;
  draft: Pick<OrderDraft, "id" | "buyerDocumentNumber" | "extractedData">;
  order: OrderMeta;
}): string {
  const { template, attachment, draft, order } = params;
  const ext = path.extname(attachment.fileName || "") || (attachment.mimeType === "application/pdf" ? ".pdf" : "");
  const originalName = path.basename(attachment.fileName || "datei", ext);
  const docRefs = (draft.extractedData as { documentReferences?: { commission?: string; customerReference?: string } } | null)?.documentReferences;
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const values: Record<string, string> = {
    orderNumber: sanitizeSegment(order.orderNumber),
    customerNumber: sanitizeSegment(order.customerNumber),
    buyerDocumentNumber: sanitizeSegment(draft.buyerDocumentNumber),
    deliveryNoteNumber: sanitizeSegment(attachment.references?.deliveryNoteNumber),
    invoiceNumber: sanitizeSegment(attachment.references?.invoiceNumber),
    commission: sanitizeSegment(attachment.references?.commission ?? docRefs?.commission),
    customerReference: sanitizeSegment(docRefs?.customerReference),
    documentKind: sanitizeSegment(attachment.documentKind),
    draftId: sanitizeSegment(draft.id),
    attachmentId: sanitizeSegment(attachment.id),
    date,
    originalName: sanitizeSegment(originalName) || "datei",
    ext: ext.replace(/^\./, ""),
  };
  let name = template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? "");
  name = name
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "");
  if (!name || name === ext.replace(/^\./, "")) name = `${values.documentKind}_${values.attachmentId}`;
  if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name = `${name}${ext}`;
  return name.slice(0, 200);
}

function buildSidecar(params: {
  tenantId: string | null;
  draft: OrderDraft;
  attachment: DraftAttachment;
  remoteFileName: string;
  order: OrderMeta;
  serverName: string;
}): Record<string, unknown> {
  const { draft, attachment, order } = params;
  const docRefs = (draft.extractedData as { documentReferences?: Record<string, unknown> } | null)?.documentReferences ?? {};
  return {
    type: "metaorder.draft_attachment",
    version: 1,
    uploadedAt: new Date().toISOString(),
    tenantId: params.tenantId,
    target: params.serverName,
    draft: { id: draft.id, kind: "order", status: draft.status, buyerDocumentNumber: draft.buyerDocumentNumber ?? null },
    order: {
      shopwareOrderId: order.shopwareOrderId,
      orderNumber: order.orderNumber,
      customerNumber: order.customerNumber,
      customerName: order.customerName,
      shopwareCustomerId: draft.shopwareCustomerId ?? null,
    },
    document: {
      attachmentId: attachment.id,
      kind: attachment.documentKind,
      kindLabel: attachmentKindLabelDe(attachment.documentKind),
      fileName: params.remoteFileName,
      originalFileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      sourceMessageId: attachment.sourceMessageId ?? null,
      references: {
        deliveryNoteNumber: attachment.references?.deliveryNoteNumber ?? null,
        orderNumber: attachment.references?.orderNumber ?? null,
        invoiceNumber: attachment.references?.invoiceNumber ?? null,
        commission: attachment.references?.commission ?? null,
        documentDate: attachment.references?.documentDate ?? null,
      },
    },
    documentReferences: {
      customerReference: (docRefs.customerReference as string | undefined) ?? null,
      commission: (docRefs.commission as string | undefined) ?? null,
      supplierOfferNumber: (docRefs.supplierOfferNumber as string | undefined) ?? null,
    },
  };
}

function isInsideUploads(filePath: string): boolean {
  const root = path.resolve(getUploadsRoot());
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

// ---------------------------------------------------------------------------
// Upload-Ablauf
// ---------------------------------------------------------------------------

async function loadOrderMeta(storage: IStorage, draft: OrderDraft, tenantId: string | null): Promise<OrderMeta> {
  const meta: OrderMeta = { shopwareOrderId: draft.shopwareOrderId ?? null, orderNumber: null, customerNumber: null, customerName: null };
  if (!draft.shopwareOrderId) return meta;
  try {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) return meta;
    const order = await new ShopwareClient(settings).fetchOrderById(draft.shopwareOrderId, null);
    if (order) {
      meta.orderNumber = order.orderNumber || null;
      meta.customerNumber = order.customerNumber || null;
      meta.customerName = order.customerName || null;
    }
  } catch (error) {
    console.warn("[SFTP] Bestelldaten für Dateinamen nicht ladbar:", error instanceof Error ? error.message : error);
  }
  return meta;
}

function selectAttachments(
  attachments: DraftAttachment[],
  server: SftpServer,
  options: { attachmentIds?: string[]; force?: boolean }
): { candidates: DraftAttachment[]; skipped: DraftAttachment[] } {
  const kinds = new Set<string>(Array.isArray(server.documentKinds) ? server.documentKinds : ["delivery_note"]);
  const wanted = options.attachmentIds ? new Set(options.attachmentIds) : null;
  const candidates: DraftAttachment[] = [];
  const skipped: DraftAttachment[] = [];
  for (const a of attachments) {
    if (wanted && !wanted.has(a.id)) continue;
    const kindOk = kinds.has(a.documentKind as SftpUploadDocumentKind);
    const statusOk = options.force || a.exportStatus === "pending";
    if (kindOk && statusOk) candidates.push(a);
    else if (wanted) skipped.push(a);
  }
  return { candidates, skipped };
}

type ServerRun = {
  server: SftpServer;
  results: Map<string, SftpUploadResult>;
};

async function uploadToServer(params: {
  storage: IStorage;
  tenantId: string | null;
  requestId: string;
  trigger: SftpUploadTrigger;
  draft: OrderDraft;
  order: OrderMeta;
  server: SftpServer;
  attachments: DraftAttachment[];
}): Promise<ServerRun> {
  const { storage, tenantId, requestId, trigger, draft, order, server } = params;
  const results = new Map<string, SftpUploadResult>();
  const pending = new Map<string, DraftAttachment>(params.attachments.map((a) => [a.id, a]));
  const maxAttempts = Math.max(1, server.maxAttempts || 3);
  const remoteDir = server.remotePath || "/";

  const log = async (entry: {
    attachment: DraftAttachment | null;
    remotePath: string | null;
    status: "success" | "failed" | "pending" | "skipped";
    attempt: number;
    durationMs: number;
    errorMessage?: string | null;
  }) => {
    try {
      await storage.createSftpUploadLog(
        {
          requestId,
          serverId: server.id,
          serverName: server.name,
          trigger,
          draftKind: "order",
          draftId: draft.id,
          attachmentId: entry.attachment?.id ?? null,
          fileName: entry.attachment?.fileName ?? null,
          remotePath: entry.remotePath,
          status: entry.status,
          errorMessage: entry.errorMessage ?? null,
          attempt: entry.attempt,
          durationMs: entry.durationMs,
          payload: {
            orderNumber: order.orderNumber,
            buyerDocumentNumber: draft.buyerDocumentNumber ?? null,
            documentKind: entry.attachment?.documentKind ?? null,
            size: entry.attachment?.size ?? null,
          },
        },
        tenantId
      );
    } catch (logError) {
      console.error("[SFTP] Log konnte nicht geschrieben werden:", logError);
    }
  };

  for (let attempt = 1; attempt <= maxAttempts && pending.size > 0; attempt++) {
    const client = new SftpClient();
    const startedConnect = Date.now();
    let connected = false;
    try {
      await client.connect(buildSftpConnectConfig(server));
      connected = true;
      const exists = await client.exists(remoteDir);
      if (!exists) await client.mkdir(remoteDir, true);
      else if (exists !== "d") throw new Error(`Zielpfad ${remoteDir} ist kein Verzeichnis`);
    } catch (error) {
      const message = describeSftpError(error);
      const isLast = attempt === maxAttempts;
      const durationMs = Date.now() - startedConnect;
      // Verbindungsfehler betrifft alle offenen Dateien
      for (const attachment of pending.values()) {
        await log({ attachment, remotePath: remoteDir, status: isLast ? "failed" : "pending", attempt, durationMs, errorMessage: message });
        results.set(attachment.id, {
          serverId: server.id,
          serverName: server.name,
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          remotePath: remoteDir,
          status: "failed",
          error: message,
          attempts: attempt,
        });
      }
      if (connected) await client.end().catch(() => undefined);
      if (!isLast) await sleepBackoff(server, attempt);
      continue;
    }

    for (const attachment of Array.from(pending.values())) {
      const started = Date.now();
      const remoteFileName = renderSftpFilename({ template: server.filenameTemplate, attachment, draft, order });
      const finalPath = joinRemote(remoteDir, remoteFileName);
      const partPath = `${finalPath}.part`;
      try {
        if (!isInsideUploads(attachment.filePath)) throw new Error("Dateipfad außerhalb des Upload-Verzeichnisses");
        const buffer = await fs.readFile(attachment.filePath);
        const opTimeout = Math.max(server.timeoutMs || 20000, 60000);
        await withTimeout(client.put(buffer, partPath), opTimeout, "put");
        try {
          await withTimeout(client.posixRename(partPath, finalPath), opTimeout, "rename");
        } catch {
          // Server ohne posix-rename@openssh.com: vorhandene Datei entfernen, dann Standard-Rename
          await client.delete(finalPath, true).catch(() => undefined);
          await withTimeout(client.rename(partPath, finalPath), opTimeout, "rename");
        }
        if (server.writeMetadataSidecar === 1) {
          const sidecar = buildSidecar({ tenantId, draft, attachment, remoteFileName, order, serverName: server.name });
          const sidecarPath = `${finalPath}.json`;
          await withTimeout(client.put(Buffer.from(JSON.stringify(sidecar, null, 2), "utf8"), `${sidecarPath}.part`), opTimeout, "put sidecar");
          try {
            await withTimeout(client.posixRename(`${sidecarPath}.part`, sidecarPath), opTimeout, "rename sidecar");
          } catch {
            await client.delete(sidecarPath, true).catch(() => undefined);
            await withTimeout(client.rename(`${sidecarPath}.part`, sidecarPath), opTimeout, "rename sidecar");
          }
        }
        const durationMs = Date.now() - started;
        await log({ attachment, remotePath: finalPath, status: "success", attempt, durationMs });
        results.set(attachment.id, {
          serverId: server.id,
          serverName: server.name,
          attachmentId: attachment.id,
          fileName: remoteFileName,
          remotePath: finalPath,
          status: "success",
          attempts: attempt,
        });
        pending.delete(attachment.id);
        console.log(`[SFTP] ${server.name}: ${attachment.fileName} → ${finalPath} (${durationMs} ms)`);
      } catch (error) {
        const message = describeSftpError(error);
        const isLast = attempt === maxAttempts;
        const durationMs = Date.now() - started;
        await client.delete(partPath, true).catch(() => undefined);
        await log({ attachment, remotePath: finalPath, status: isLast ? "failed" : "pending", attempt, durationMs, errorMessage: message });
        results.set(attachment.id, {
          serverId: server.id,
          serverName: server.name,
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          remotePath: finalPath,
          status: "failed",
          error: message,
          attempts: attempt,
        });
        // Datei fehlt lokal → Wiederholen sinnlos
        if ((error as { code?: string }).code === "ENOENT") {
          pending.delete(attachment.id);
          results.set(attachment.id, { ...results.get(attachment.id)!, error: "Datei liegt nicht mehr im Upload-Verzeichnis" });
        }
      }
    }

    await client.end().catch(() => undefined);
    if (pending.size > 0 && attempt < maxAttempts) await sleepBackoff(server, attempt);
  }

  return { server, results };
}

async function sleepBackoff(server: SftpServer, attempt: number): Promise<void> {
  const base = server.initialBackoffMs || 2000;
  const factor = Number(server.backoffFactor) || 2;
  const ms = Math.min(base * Math.pow(factor, attempt - 1), 120000);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Beilagen eines Bestellentwurfs an die SFTP-Server des Mandanten hochladen.
 * `serverIds` schränkt auf bestimmte Server ein (manuell); `attachmentIds` auf bestimmte Beilagen.
 */
export async function uploadDraftAttachmentsToSftp(params: {
  storage: IStorage;
  draftId: string;
  tenantId: string | null;
  trigger: SftpUploadTrigger;
  serverIds?: string[];
  attachmentIds?: string[];
  force?: boolean;
}): Promise<SftpUploadSummary> {
  const { storage, draftId, tenantId, trigger } = params;
  const requestId = crypto.randomUUID();
  const empty: SftpUploadSummary = { requestId, uploaded: 0, failed: 0, skipped: 0, results: [], attachments: [] };

  const draft = await storage.getOrderDraft(draftId, tenantId);
  if (!draft) return empty;
  const attachments = draft.attachments ?? [];
  empty.attachments = attachments;
  if (attachments.length === 0) return empty;

  const allServers = await storage.getSftpServers(tenantId);
  const servers = allServers.filter((s) => {
    if (s.enabled !== 1) return false;
    if (params.serverIds && !params.serverIds.includes(s.id)) return false;
    if (trigger === "order_created" && s.autoUploadOnOrderCreate !== 1) return false;
    return true;
  });
  if (servers.length === 0) return empty;

  const order = await loadOrderMeta(storage, draft, tenantId);
  const results: SftpUploadResult[] = [];
  const succeededBy = new Map<string, string[]>(); // attachmentId → exportReferences

  for (const server of servers) {
    const { candidates, skipped } = selectAttachments(attachments, server, { attachmentIds: params.attachmentIds, force: params.force });
    for (const a of skipped) {
      results.push({
        serverId: server.id,
        serverName: server.name,
        attachmentId: a.id,
        fileName: a.fileName,
        remotePath: server.remotePath,
        status: "skipped",
        error: a.exportStatus !== "pending" && !params.force ? "bereits exportiert" : "Belegart nicht für diesen Server konfiguriert",
        attempts: 0,
      });
    }
    if (candidates.length === 0) continue;
    const run = await uploadToServer({ storage, tenantId, requestId, trigger, draft, order, server, attachments: candidates });
    for (const r of run.results.values()) {
      results.push(r);
      if (r.status === "success") {
        const refs = succeededBy.get(r.attachmentId) ?? [];
        refs.push(`sftp:${server.name}:${r.remotePath}`);
        succeededBy.set(r.attachmentId, refs);
      }
    }
  }

  let nextAttachments: DraftAttachment[] = attachments;
  if (succeededBy.size > 0) {
    // Status auf dem frischen Stand setzen (Lobster-PATCH könnte zwischenzeitlich gelaufen sein)
    const fresh = await storage.getOrderDraft(draftId, tenantId);
    nextAttachments = fresh?.attachments ?? attachments;
    for (const [attachmentId, refs] of succeededBy) {
      const updated = applyDraftAttachmentExportUpdate(nextAttachments, attachmentId, {
        exportStatus: "exported",
        exportReference: refs.join(";").slice(0, 200),
      });
      if (updated) nextAttachments = updated;
    }
    const saved = await storage.updateOrderDraft(draftId, { attachments: nextAttachments }, tenantId);
    if (saved?.attachments) nextAttachments = saved.attachments;
  }

  return {
    requestId,
    uploaded: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
    attachments: nextAttachments,
  };
}

/** Gibt es für den Mandanten mindestens einen aktiven SFTP-Server? (Review-Modal: Button anzeigen) */
export async function hasEnabledSftpServers(storage: IStorage, tenantId: string | null): Promise<boolean> {
  try {
    const servers = await storage.getSftpServers(tenantId);
    return servers.some((s) => s.enabled === 1);
  } catch {
    return false;
  }
}

/** Fire-and-forget nach der Bestellanlage: Fehler landen nur im Log, nie beim Aufrufer. */
export function scheduleSftpUploadAfterOrderCreate(storage: IStorage, draftId: string, tenantId: string | null): void {
  setImmediate(() => {
    uploadDraftAttachmentsToSftp({ storage, draftId, tenantId, trigger: "order_created" })
      .then((summary) => {
        if (summary.uploaded > 0 || summary.failed > 0) {
          console.log(`[SFTP] Entwurf ${draftId}: ${summary.uploaded} hochgeladen, ${summary.failed} fehlgeschlagen`);
        }
      })
      .catch((error) => console.error(`[SFTP] Upload nach Bestellanlage fehlgeschlagen (Entwurf ${draftId}):`, error));
  });
}
