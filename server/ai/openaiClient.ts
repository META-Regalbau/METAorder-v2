import OpenAI from "openai";
import { decrypt } from "../lib/encryption";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "ai/openaiClient" });

/**
 * OpenAI-Client: entweder aus der Umgebung oder mit dem verschluesselten Key aus den Einstellungen.
 *
 * 1. Umgebung (hat Vorrang, z. B. fuer lokale Skripte/Tests):
 *    AI_INTEGRATIONS_OPENAI_BASE_URL und AI_INTEGRATIONS_OPENAI_API_KEY - beide muessen gesetzt sein.
 *    (Die Namen stammen aus der frueheren Replit-Integration und bleiben aus Kompatibilitaet.)
 * 2. Einstellungen: verschluesselter API-Key aus openai_settings (Normalfall in Produktion).
 */

export interface OpenAIConfig {
  mode: 'env' | 'standard';
  client: OpenAI;
}

/**
 * Ist OpenAI per Umgebung konfiguriert (AI_INTEGRATIONS_OPENAI_BASE_URL + _API_KEY)?
 */
export function isEnvOpenAIConfigured(): boolean {
  return !!(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && 
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  );
}

/**
 * OpenAI-Client - Umgebung vor Einstellungen.
 *
 * @param standardApiKey - verschluesselter API-Key aus den Einstellungen (entbehrlich, wenn per Umgebung konfiguriert)
 * @returns OpenAI client configuration
 */
export function getOpenAIClient(standardApiKey?: string): OpenAIConfig {
  if (isEnvOpenAIConfigured()) {
    moduleLog.info("[OpenAI] OpenAI aus der Umgebung (AI_INTEGRATIONS_OPENAI_*)");
    return {
      mode: 'env',
      client: new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      }),
    };
  }

  if (!standardApiKey) {
    throw new Error('OpenAI API key not configured (weder in den Einstellungen noch per AI_INTEGRATIONS_OPENAI_*)');
  }

  moduleLog.info("[OpenAI] OpenAI-Key aus den Einstellungen");
  const decryptedKey = decrypt(standardApiKey);
  
  return {
    mode: 'standard',
    client: new OpenAI({
      apiKey: decryptedKey,
    }),
  };
}

/**
 * OpenAI-Client fuer KI-Funktionen (Tickets usw.) - gleiche Reihenfolge wie getOpenAIClient.
 */
export async function getOpenAIClientFromSettings(
  getSettingFn: (key: string) => Promise<any>
): Promise<OpenAIConfig | null> {
  if (isEnvOpenAIConfigured()) {
    moduleLog.info("[OpenAI] OpenAI aus der Umgebung (AI_INTEGRATIONS_OPENAI_*)");
    return {
      mode: 'env',
      client: new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      }),
    };
  }

  const openaiSettings = await getSettingFn('openai_settings');
  if (!openaiSettings || !openaiSettings.enabled || !openaiSettings.apiKey) {
    return null;
  }

  moduleLog.info("[OpenAI] OpenAI-Key aus den Einstellungen");
  const decryptedKey = decrypt(openaiSettings.apiKey);
  
  return {
    mode: 'standard',
    client: new OpenAI({
      apiKey: decryptedKey,
    }),
  };
}
