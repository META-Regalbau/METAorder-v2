/**
 * Hilfsfunktionen für die Anhangs-Endpunkte der Entwürfe (routes.ts):
 * Listen-Form ohne Dateipfad, Datei-Auslieferung, Export-Status-Update (Lobster → d.3).
 */

import fs from "fs/promises";
import path from "path";
import type { Response } from "express";
import type { DraftAttachment } from "@shared/schema";
import { attachmentKindLabelDe } from "./commercialAttachmentClassifier";
import { getUploadsRoot } from "./uploadsRoot";

export type DraftAttachmentApi = Omit<DraftAttachment, "filePath"> & { documentKindLabel: string };

/** Dateipfad bleibt serverintern — Clients holen die Datei über den file-Endpunkt. */
export function listDraftAttachmentsForApi(attachments: DraftAttachment[] | null | undefined): DraftAttachmentApi[] {
  return (attachments ?? []).map((a) => {
    const { filePath: _omit, ...rest } = a;
    return { ...rest, documentKindLabel: attachmentKindLabelDe(a.documentKind) };
  });
}

function isInsideUploads(filePath: string): boolean {
  const root = path.resolve(getUploadsRoot());
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export async function sendDraftAttachmentFile(
  res: Response,
  attachments: DraftAttachment[] | null | undefined,
  attachmentId: string
): Promise<void> {
  const attachment = (attachments ?? []).find((a) => a.id === attachmentId);
  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  if (!isInsideUploads(attachment.filePath)) {
    res.status(403).json({ error: "Attachment path not allowed" });
    return;
  }
  try {
    await fs.access(attachment.filePath);
  } catch {
    res.status(410).json({ error: "Attachment file no longer available" });
    return;
  }
  res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  await new Promise<void>((resolve) => {
    res.sendFile(path.resolve(attachment.filePath), (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: "Failed to send attachment" });
      resolve();
    });
  });
}

export type DraftAttachmentExportUpdate = {
  exportStatus: DraftAttachment["exportStatus"];
  exportReference?: string | null;
};

export function parseDraftAttachmentExportUpdate(body: unknown): DraftAttachmentExportUpdate | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const status = b.exportStatus;
  if (status !== "pending" && status !== "exported" && status !== "skipped") {
    return { error: "exportStatus muss pending, exported oder skipped sein" };
  }
  const ref = b.exportReference;
  if (ref != null && typeof ref !== "string") return { error: "exportReference muss ein String sein" };
  return { exportStatus: status, exportReference: typeof ref === "string" ? ref.slice(0, 200) : undefined };
}

export function applyDraftAttachmentExportUpdate(
  attachments: DraftAttachment[] | null | undefined,
  attachmentId: string,
  update: DraftAttachmentExportUpdate
): DraftAttachment[] | null {
  const list = attachments ?? [];
  if (!list.some((a) => a.id === attachmentId)) return null;
  return list.map((a) =>
    a.id === attachmentId
      ? {
          ...a,
          exportStatus: update.exportStatus,
          exportedAt: update.exportStatus === "exported" ? new Date().toISOString() : a.exportedAt ?? null,
          exportReference: update.exportReference !== undefined ? update.exportReference : a.exportReference ?? null,
        }
      : a
  );
}
