/** Normalize raw barcode/QR payload from the camera scanner. */
export function normalizeScanCode(raw: string): string {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

/** True when the page can reliably request camera access (HTTPS or localhost). */
export function isSecureCameraContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
