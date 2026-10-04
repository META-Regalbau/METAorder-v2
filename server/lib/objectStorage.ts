import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Response } from "express";
import { randomUUID } from "crypto";

/**
 * Objektspeicher fuer Ticket-Anhaenge: S3-kompatibel (z. B. MinIO, siehe docs/docker.md)
 * oder - ohne S3_* - nicht konfiguriert (Anhaenge dann lokal unter uploads/).
 */
type StorageBackend = "none" | "s3";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private backend: StorageBackend;
  private bucketName: string;
  private keyPrefix: string;
  private s3Client: S3Client | null = null;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const s3Bucket = process.env.S3_BUCKET?.trim();
    const ak = process.env.S3_ACCESS_KEY_ID?.trim();
    const sk = process.env.S3_SECRET_ACCESS_KEY?.trim();

    if (endpoint && s3Bucket && ak && sk) {
      this.backend = "s3";
      this.bucketName = s3Bucket;
      this.keyPrefix = (process.env.S3_OBJECT_PREFIX || "").replace(/^\/+|\/+$/g, "");
      const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
      this.s3Client = new S3Client({
        endpoint,
        region: process.env.S3_REGION?.trim() || "us-east-1",
        credentials: { accessKeyId: ak, secretAccessKey: sk },
        forcePathStyle,
      });
      console.log(
        `[ObjectStorage] S3-compatible storage (z. B. MinIO): ${endpoint} bucket=${s3Bucket} pathStyle=${forcePathStyle}`
      );
      return;
    }

    if (process.env.PRIVATE_OBJECT_DIR) {
      // Frueher: Google Cloud Storage ueber den Replit-Sidecar - ausserhalb von Replit nie nutzbar.
      console.warn(
        "[ObjectStorage] PRIVATE_OBJECT_DIR wird nicht mehr unterstützt (Google Cloud Storage über Replit). Für einen Objektspeicher S3_* setzen (siehe docs/docker.md)."
      );
    }

    this.backend = "none";
    this.bucketName = "";
    this.keyPrefix = "";
    console.warn(
      "[ObjectStorage] Nicht konfiguriert — Ticket-Anhänge nur lokal unter uploads/ticket-attachments. Für MinIO: S3_* setzen (siehe docs/docker.md)."
    );
  }

  private sanitizeFilename(value: string) {
    return value
      .replace(/[\\/]+/g, "_")
      .replace(/\.\.+/g, ".")
      .replace(/[^a-zA-Z0-9.\-_]/g, "_");
  }

  isConfigured(): boolean {
    return this.backend !== "none";
  }

  private buildObjectKey(filename: string): string {
    const objectId = randomUUID();
    const sanitizedFilename = this.sanitizeFilename(filename);
    const leaf = `${objectId}-${sanitizedFilename}`;
    const parts = [this.keyPrefix, "ticket-attachments", leaf].filter((p) => p.length > 0);
    return parts.join("/");
  }

  async uploadFromBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<{ objectKey: string; publicUrl: string }> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    const objectKey = this.buildObjectKey(filename);

    await this.s3Client!.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
        Metadata: {
          originalfilename: this.sanitizeFilename(filename).slice(0, 1024),
          uploadedat: new Date().toISOString(),
        },
      })
    );
    return {
      objectKey,
      publicUrl: `/api/object-storage/${objectKey}`,
    };
  }

  async getUploadUrl(filename: string): Promise<{ uploadUrl: string; objectKey: string }> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    const objectKey = this.buildObjectKey(filename);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
    });
    const signedUrl = await getSignedUrl(this.s3Client!, command, { expiresIn: 900 });
    return { uploadUrl: signedUrl, objectKey };
  }

  async downloadToResponse(objectKey: string, res: Response): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    try {
      const out = await this.s3Client!.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: objectKey })
      );
      if (!out.Body) {
        throw new ObjectNotFoundError();
      }

      res.set({
        "Content-Type": out.ContentType || "application/octet-stream",
        ...(out.ContentLength != null && { "Content-Length": String(out.ContentLength) }),
        "Cache-Control": "private, max-age=3600",
      });

      const stream = out.Body as NodeJS.ReadableStream;
      stream.on("error", (err) => {
        console.error("[ObjectStorage] S3 stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error: any) {
      if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
        throw new ObjectNotFoundError();
      }
      throw error;
    }
  }

  async downloadAsBuffer(objectKey: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    const out = await this.s3Client!.send(
      new GetObjectCommand({ Bucket: this.bucketName, Key: objectKey })
    );
    if (!out.Body) {
      throw new ObjectNotFoundError();
    }
    const chunks: Buffer[] = [];
    for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: out.ContentType || "application/octet-stream",
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    try {
      await this.s3Client!.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: objectKey })
      );
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404) return;
      throw e;
    }
  }
}

export const objectStorageService = new ObjectStorageService();
