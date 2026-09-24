/**
 * SFTP-Server (DMS-Übergabe Lobster → d.3): Secrets verschlüsseln/entschlüsseln,
 * API-Form ohne Geheimnisse, Body-Validierung für die Einstellungsrouten.
 *
 * Passwort, Private Key und Passphrase liegen AES-GCM-verschlüsselt in `sftp_servers`
 * (server/encryption.ts). Nach außen gehen nur `hasPassword` / `hasPrivateKey` / `hasPassphrase`.
 */

import { z } from "zod";
import {
  DEFAULT_SFTP_FILENAME_TEMPLATE,
  SFTP_AUTH_METHODS,
  SFTP_UPLOAD_DOCUMENT_KINDS,
  type InsertSftpServer,
  type SftpServer,
} from "@shared/schema";
import { decrypt, encrypt } from "./encryption";

export type SftpServerApi = Omit<SftpServer, "password" | "privateKey" | "passphrase" | "enabled" | "writeMetadataSidecar" | "autoUploadOnOrderCreate"> & {
  enabled: boolean;
  writeMetadataSidecar: boolean;
  autoUploadOnOrderCreate: boolean;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
};

export function toSftpServerApi(server: SftpServer): SftpServerApi {
  const { password, privateKey, passphrase, enabled, writeMetadataSidecar, autoUploadOnOrderCreate, ...rest } = server;
  return {
    ...rest,
    documentKinds: Array.isArray(server.documentKinds) ? server.documentKinds : ["delivery_note"],
    backoffFactor: Number(server.backoffFactor),
    enabled: enabled === 1,
    writeMetadataSidecar: writeMetadataSidecar === 1,
    autoUploadOnOrderCreate: autoUploadOnOrderCreate === 1,
    hasPassword: !!password,
    hasPrivateKey: !!privateKey,
    hasPassphrase: !!passphrase,
  };
}

/** Entschlüsselte Zugangsdaten — nur serverintern (Verbindungsaufbau). */
export type SftpCredentials = {
  password: string | null;
  privateKey: string | null;
  passphrase: string | null;
};

export function resolveSftpCredentials(server: Pick<SftpServer, "password" | "privateKey" | "passphrase">): SftpCredentials {
  return {
    password: server.password ? decrypt(server.password) : null,
    privateKey: server.privateKey ? decrypt(server.privateKey) : null,
    passphrase: server.passphrase ? decrypt(server.passphrase) : null,
  };
}

/**
 * Request-Body (Anlegen/Ändern). Booleans statt 0/1; Secrets optional:
 *   undefined → unverändert, "" oder null → löschen, sonst → neu setzen (verschlüsselt).
 */
export const sftpServerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(255),
  authMethod: z.enum(SFTP_AUTH_METHODS).default("password"),
  password: z.string().max(4096).nullable().optional(),
  privateKey: z.string().max(65536).nullable().optional(),
  passphrase: z.string().max(4096).nullable().optional(),
  hostKeyFingerprint: z.string().trim().max(200).nullable().optional(),
  remotePath: z.string().trim().min(1).max(1024).default("/"),
  filenameTemplate: z.string().trim().min(1).max(300).default(DEFAULT_SFTP_FILENAME_TEMPLATE),
  documentKinds: z.array(z.enum(SFTP_UPLOAD_DOCUMENT_KINDS)).min(1).default(["delivery_note"]),
  writeMetadataSidecar: z.boolean().default(true),
  autoUploadOnOrderCreate: z.boolean().default(true),
  enabled: z.boolean().default(true),
  maxAttempts: z.coerce.number().int().min(1).max(5).default(3),
  initialBackoffMs: z.coerce.number().int().min(500).max(60000).default(2000),
  backoffFactor: z.coerce.number().min(1).max(5).default(2),
  timeoutMs: z.coerce.number().int().min(1000).max(120000).default(20000),
});

export type SftpServerBody = z.infer<typeof sftpServerBodySchema>;
export const sftpServerPatchSchema = sftpServerBodySchema.partial();
export type SftpServerPatch = z.infer<typeof sftpServerPatchSchema>;

function encryptSecret(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return encrypt(trimmed);
}

/** Body → Insert-/Update-Form (Ints, verschlüsselte Secrets). */
export function bodyToSftpServerValues(body: SftpServerPatch): Partial<InsertSftpServer> {
  const out: Partial<InsertSftpServer> = {};
  if (body.name !== undefined) out.name = body.name;
  if (body.host !== undefined) out.host = body.host;
  if (body.port !== undefined) out.port = body.port;
  if (body.username !== undefined) out.username = body.username;
  if (body.authMethod !== undefined) out.authMethod = body.authMethod;
  if (body.hostKeyFingerprint !== undefined) out.hostKeyFingerprint = body.hostKeyFingerprint?.trim() || null;
  if (body.remotePath !== undefined) out.remotePath = normalizeRemotePath(body.remotePath);
  if (body.filenameTemplate !== undefined) out.filenameTemplate = body.filenameTemplate;
  if (body.documentKinds !== undefined) out.documentKinds = Array.from(new Set(body.documentKinds));
  if (body.writeMetadataSidecar !== undefined) out.writeMetadataSidecar = body.writeMetadataSidecar ? 1 : 0;
  if (body.autoUploadOnOrderCreate !== undefined) out.autoUploadOnOrderCreate = body.autoUploadOnOrderCreate ? 1 : 0;
  if (body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  if (body.maxAttempts !== undefined) out.maxAttempts = body.maxAttempts;
  if (body.initialBackoffMs !== undefined) out.initialBackoffMs = body.initialBackoffMs;
  if (body.backoffFactor !== undefined) out.backoffFactor = body.backoffFactor;
  if (body.timeoutMs !== undefined) out.timeoutMs = body.timeoutMs;
  const password = encryptSecret(body.password);
  if (password !== undefined) out.password = password;
  const privateKey = encryptSecret(body.privateKey);
  if (privateKey !== undefined) out.privateKey = privateKey;
  const passphrase = encryptSecret(body.passphrase);
  if (passphrase !== undefined) out.passphrase = passphrase;
  return out;
}

/** Führender Slash, kein abschließender (außer Wurzel); keine Pfad-Rücksprünge. */
export function normalizeRemotePath(input: string): string {
  let p = (input || "/").trim().replace(/\\/g, "/");
  if (!p.startsWith("/") && !p.startsWith("~")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.split("/").some((seg) => seg === "..")) throw new Error("Pfad darf kein '..' enthalten");
  return p || "/";
}

/** Prüft, ob die Zugangsdaten zur Auth-Methode vollständig sind (nach Merge mit Bestand). */
export function validateSftpAuth(server: Pick<SftpServer, "authMethod" | "password" | "privateKey">): string | null {
  if (server.authMethod === "key" && !server.privateKey) return "Für die Schlüssel-Authentifizierung ist ein Private Key erforderlich";
  if (server.authMethod === "password" && !server.password) return "Für die Passwort-Authentifizierung ist ein Passwort erforderlich";
  return null;
}
