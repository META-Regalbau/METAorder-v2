import { Storage, type File } from "@google-cloud/storage";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Response } from "express";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

type StorageBackend = "none" | "gcs" | "s3";

let gcsStorageSingleton: Storage | null = null;

function getGcsStorage(): Storage {
  if (!gcsStorageSingleton) {
    gcsStorageSingleton = new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: {
            type: "json",
            subject_token_field_name: "access_token",
          },
        },
        universe_domain: "googleapis.com",
      } as any,
      projectId: "",
    });
  }
  return gcsStorageSingleton;
}

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

    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (privateObjectDir) {
      this.backend = "gcs";
      const { bucketName, objectName } = this.parseObjectPath(privateObjectDir);
      this.bucketName = bucketName;
      this.keyPrefix = objectName.replace(/^\/+|\/+$/g, "");
      console.log(
        `[ObjectStorage] Google Cloud Storage: bucket=${bucketName} prefix=${this.keyPrefix || "(keiner)"}`
      );
      return;
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

  private parseObjectPath(path: string): { bucketName: string; objectName: string } {
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }
    const pathParts = path.split("/");
    if (pathParts.length < 2) {
      throw new Error("Invalid path: must contain at least a bucket name");
    }

    const bucketName = pathParts[1];
    const objectName = pathParts.slice(2).join("/");

    return { bucketName, objectName };
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

    if (this.backend === "s3") {
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

    const bucket = getGcsStorage().bucket(this.bucketName);
    const file = bucket.file(objectKey);

    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        originalFilename: filename,
        uploadedAt: new Date().toISOString(),
      },
    });

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

    if (this.backend === "s3") {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });
      const signedUrl = await getSignedUrl(this.s3Client!, command, { expiresIn: 900 });
      return { uploadUrl: signedUrl, objectKey };
    }

    const request = {
      bucket_name: this.bucketName,
      object_name: objectKey,
      method: "PUT" as const,
      expires_at: new Date(Date.now() + 900 * 1000).toISOString(),
    };

    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `Signed URL failed (${response.status}). GCS/Replit-Sidecar oder S3/MinIO (S3_ENDPOINT) nutzen.`
      );
    }

    const { signed_url: signedURL } = await response.json();
    return { uploadUrl: signedURL, objectKey };
  }

  async getFile(objectKey: string): Promise<File> {
    if (this.backend === "s3") {
      throw new Error("getFile is GCS-only; use downloadToResponse for S3");
    }
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    const bucket = getGcsStorage().bucket(this.bucketName);
    const file = bucket.file(objectKey);

    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }

    return file;
  }

  async downloadToResponse(objectKey: string, res: Response): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    if (this.backend === "s3") {
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
      return;
    }

    try {
      const file = await this.getFile(objectKey);
      const [metadata] = await file.getMetadata();

      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size?.toString(),
        "Cache-Control": "private, max-age=3600",
      });

      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("[ObjectStorage] Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw error;
      }
      console.error("[ObjectStorage] Error downloading file:", error);
      throw new Error("Error downloading file");
    }
  }

  async downloadAsBuffer(objectKey: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    if (this.backend === "s3") {
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

    const file = await this.getFile(objectKey);
    const [metadata] = await file.getMetadata();
    const [buffer] = await file.download();

    return {
      buffer,
      contentType: metadata.contentType || "application/octet-stream",
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Object storage not configured");
    }

    if (this.backend === "s3") {
      try {
        await this.s3Client!.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: objectKey })
        );
      } catch (e: any) {
        if (e?.$metadata?.httpStatusCode === 404) return;
        throw e;
      }
      return;
    }

    try {
      const bucket = getGcsStorage().bucket(this.bucketName);
      const file = bucket.file(objectKey);
      await file.delete();
    } catch (error: any) {
      if (error.code === 404) {
        return;
      }
      throw error;
    }
  }
}

export const objectStorageService = new ObjectStorageService();
