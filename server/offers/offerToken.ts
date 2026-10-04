import { createHash, randomBytes } from "crypto";

export function hashOfferPublicToken(plainToken: string): string {
  return createHash("sha256").update(plainToken, "utf8").digest("hex");
}

/** URL-sicherer Klartext-Token (wird nur einmal beim Erzeugen zurückgegeben) */
export function generateOfferPlainToken(): string {
  return randomBytes(32).toString("base64url");
}
