/**
 * Größengrenze für POST /api/commercial-drafts/upload: n8n-E-Mail-Eingang (Integrations-Schlüssel)
 * bis 36 MB, Browser bis 10 MB; darüber 413 mit Code statt eines unbehandelten MulterError (500).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  EMAIL_INTAKE_MAX_UPLOAD_BYTES,
  MANUAL_MAX_UPLOAD_BYTES,
  commercialDraftSingleUpload,
} from "../../server/routes/commercialDraftUploadLimit";

let server: Server;
let baseUrl: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-upload-limit-"));
  const app = express();
  app.post(
    "/upload",
    (req, _res, next) => {
      (req as { integrationKeyAuth?: boolean }).integrationKeyAuth = req.headers["x-intake"] === "1";
      next();
    },
    commercialDraftSingleUpload({ storage: multer.diskStorage({ destination: dir }) }, "file"),
    (req, res) => res.json({ size: req.file?.size ?? null }),
  );
  // wie in server/index.ts: was hier ankommt, wäre ein 500
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "unbehandelt" });
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function upload(bytes: number, intake: boolean) {
  const form = new FormData();
  form.append("file", new Blob([Buffer.alloc(bytes, 0x61)], { type: "message/rfc822" }), "mail.eml");
  const res = await fetch(`${baseUrl}/upload`, { method: "POST", body: form, headers: intake ? { "x-intake": "1" } : {} });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("Upload-Grenze Entwürfe", () => {
  it("n8n: Mail über 10 MB geht durch, über 36 MB → 413 email_intake_mail_too_large", async () => {
    expect(await upload(12 * 1024 * 1024, true)).toEqual({ status: 200, body: { size: 12 * 1024 * 1024 } });
    const tooLarge = await upload(EMAIL_INTAKE_MAX_UPLOAD_BYTES + 1, true);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toMatchObject({ code: "email_intake_mail_too_large", maxBytes: EMAIL_INTAKE_MAX_UPLOAD_BYTES });
    expect(tooLarge.body.error).toMatch(/größer als 36 MB/);
  }, 30_000);

  it("Browser: Grenze bleibt 10 MB, darüber 413 upload_file_too_large", async () => {
    expect((await upload(MANUAL_MAX_UPLOAD_BYTES - 1024, false)).status).toBe(200);
    const tooLarge = await upload(MANUAL_MAX_UPLOAD_BYTES + 1, false);
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toMatchObject({ code: "upload_file_too_large", error: "Die Datei ist größer als 10 MB." });
  }, 30_000);

  it("abgebrochene Uploads hinterlassen keine Teildatei", async () => {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
    await upload(MANUAL_MAX_UPLOAD_BYTES + 1, false);
    await upload(EMAIL_INTAKE_MAX_UPLOAD_BYTES + 1, true);
    expect(fs.readdirSync(dir)).toEqual([]);
  }, 30_000);
});
