/**
 * Zentrale Prüfung gegen die aus docker-compose.yml bekannten Dev-Default-Secrets.
 *
 * docker-compose.yml setzt SESSION_SECRET/ENCRYPTION_KEY/N8N_SERVICE_PASSWORD immer
 * mit einem Fallback-Wert (`${VAR:-bekannter-default}`), auch wenn keine Host-.env
 * existiert — die Variable ist im Container also NIE leer. Eine Prüfung auf "ist die
 * Variable gesetzt" greift deshalb nie. Hier wird stattdessen gegen die exakten,
 * öffentlich in diesem Repo sichtbaren Default-Strings geprüft.
 *
 * ALLOW_DEV_SECRETS=true (Default für die lokale docker-compose.yml) schaltet den
 * harten Stopp auf eine Warnung zurück — für lokale Entwicklung/Testing gedacht.
 * Echte Deployments (z. B. deploy/mittwald/) setzen diese Variable nicht.
 */

const KNOWN_INSECURE_DEFAULTS = new Set([
  "bitte-in-produktion-setzen",
  "metaorder-dev-encryption-key-change-in-prod",
  "metaorder-dev-n8n-service-change-in-prod",
  "dev-secret-change-in-production",
  "dev-customer-jwt-secret-change-in-production",
  "replace-with-long-random-secret",
  "change-me-n8n-admin",
  "metaorder-dev-n8n-encryption-key-change-in-prod",
  "metaorder-minio-change-me",
]);

function allowDevSecrets(): boolean {
  return (process.env.ALLOW_DEV_SECRETS || "").trim().toLowerCase() === "true";
}

/**
 * Wirft (stoppt den Prozess), wenn `value` fehlt oder einem bekannten Dev-Default
 * entspricht — außer `ALLOW_DEV_SECRETS=true` ist gesetzt, dann nur eine Konsolen-Warnung.
 */
export function assertSecureSecret(envVarName: string, value: string | undefined): string {
  const trimmed = (value || "").trim();
  const isInsecure = !trimmed || KNOWN_INSECURE_DEFAULTS.has(trimmed);
  if (!isInsecure) return trimmed;

  const message = trimmed
    ? `[SECURITY] ${envVarName} ist auf einen bekannten, in docker-compose.yml öffentlich sichtbaren Default-Wert gesetzt. Bitte einen eigenen, zufälligen Wert setzen.`
    : `[SECURITY] ${envVarName} ist nicht gesetzt und es gibt keinen sicheren Fallback.`;

  if (allowDevSecrets()) {
    console.warn(`${message} (ALLOW_DEV_SECRETS=true — Start wird trotzdem fortgesetzt, nur für lokale Entwicklung/Testing gedacht.)`);
    return trimmed || envVarName;
  }

  throw new Error(`${message} Für lokale Entwicklung/Testing kann ALLOW_DEV_SECRETS=true gesetzt werden.`);
}

export function isKnownInsecureDefault(value: string | undefined): boolean {
  const trimmed = (value || "").trim();
  return !trimmed || KNOWN_INSECURE_DEFAULTS.has(trimmed);
}
