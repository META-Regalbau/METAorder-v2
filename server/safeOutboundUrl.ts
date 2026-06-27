/**
 * SSRF-arme Prüfung für ausgehende HTTPS-GETs (z. B. Impressum-Fetch).
 * Entspricht der Logik aus webhookService.validateWebhookUrl.
 */

export function validateHttpsUrlForOutboundFetch(url: string): { ok: true; url: URL } | { ok: false; error: string } {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") {
      return { ok: false, error: "Only HTTPS URLs are allowed" };
    }

    if (parsed.username || parsed.password) {
      return { ok: false, error: "Credentials in URL are not allowed" };
    }

    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return { ok: false, error: "Localhost URLs are not allowed" };
    }

    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = parsed.hostname.match(ipv4Regex);
    if (match) {
      const [, a, b] = match;
      const first = parseInt(a, 10);
      const second = parseInt(b, 10);

      if (first === 10) {
        return { ok: false, error: "Private IP range (10.x.x.x) not allowed" };
      }
      if (first === 172 && second >= 16 && second <= 31) {
        return { ok: false, error: "Private IP range (172.16-31.x.x) not allowed" };
      }
      if (first === 192 && second === 168) {
        return { ok: false, error: "Private IP range (192.168.x.x) not allowed" };
      }
      if (first === 169 && second === 254) {
        return { ok: false, error: "Link-local IP range (169.254.x.x) not allowed" };
      }
      if (first === 127) {
        return { ok: false, error: "Loopback not allowed" };
      }
    }

    if (parsed.hostname.startsWith("[") || /:/.test(parsed.hostname)) {
      return { ok: false, error: "IPv6 URLs are not supported for this fetch" };
    }

    return { ok: true, url: parsed };
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }
}

const REGISTRABLE_HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/**
 * Baut https://hostname/path nur aus erlaubten Hostnamen (keine IP, keine Pfade im Host).
 */
export function buildSafeHttpsUrl(hostname: string, path: string): string | null {
  const h = hostname.trim().toLowerCase();
  if (!h || !REGISTRABLE_HOST_RE.test(h) || h.length > 200) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  const full = `https://${h}${p}`;
  const v = validateHttpsUrlForOutboundFetch(full);
  return v.ok ? full : null;
}
