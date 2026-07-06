/**
 * Zentrale Feature-Flags für das Frontend.
 *
 * Flags werden über Vite-Env-Variablen (VITE_*) gesteuert und sind zur Build-Zeit
 * bekannt. Standardwerte sind bewusst konservativ gewählt.
 */

function readBoolEnv(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * 3D-Vorschau (Three.js/GLB) im CPQ-Konfigurator und in der Angebots-Ansicht.
 * Default: aus – wird aktiviert, sobald GLB/Geometrie-Daten flächendeckend gepflegt sind.
 */
export const CPQ_3D_PREVIEW: boolean = readBoolEnv(
  import.meta.env.VITE_CPQ_3D_PREVIEW,
  false,
);
