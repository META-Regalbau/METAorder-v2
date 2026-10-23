/**
 * Gespeicherte Zugangsdaten (API-Keys, Secrets, Passwörter) nur an die gespeicherte
 * Gegenstelle schicken.
 *
 * Die Einstellungsformulare lassen das Secret-Feld leer, um das gespeicherte zu
 * behalten. Ohne diese Prüfung könnte jemand mit dem Recht „Einstellungen“ die
 * Adresse auf einen eigenen Server ändern, auf „Testen“ oder „Speichern“ klicken
 * und bekäme das gespeicherte Secret zugeschickt. Wer die Adresse ändert, muss
 * die Zugangsdaten deshalb neu eingeben.
 */

/** Vergleichbare Form einer Adresse: Protokoll, Host und Port (Pfad egal). */
function urlTarget(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return text.replace(/\/+$/, "").toLowerCase();
  }
}

/** true, wenn ein gespeichertes Secret für diese (neue) Adresse verwendet werden darf. */
export function mayReuseStoredSecretForUrl(requestedUrl: string | null | undefined, storedUrl: string | null | undefined): boolean {
  const requested = urlTarget(requestedUrl);
  const stored = urlTarget(storedUrl);
  return requested !== null && requested === stored;
}

/** Wie oben für Host + Port (SFTP). */
export function mayReuseStoredSecretForHost(
  requested: { host?: string | null; port?: number | null },
  stored: { host?: string | null; port?: number | null },
): boolean {
  const reqHost = (requested.host ?? "").trim().toLowerCase();
  const storedHost = (stored.host ?? "").trim().toLowerCase();
  return reqHost !== "" && reqHost === storedHost && (requested.port ?? 22) === (stored.port ?? 22);
}
