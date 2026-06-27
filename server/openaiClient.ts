import OpenAI from "openai";
import { decrypt } from "./encryption";

/**
 * Dual OpenAI Integration Support
 * 
 * This module supports TWO OpenAI integration modes:
 * 
 * 1. Replit OpenAI Integration (Test Environment):
 *    - Uses AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY
 *    - No API key required - charges billed to Replit credits
 *    - Automatically detected when running on Replit
 * 
 * 2. Standard OpenAI API (Production Server):
 *    - Uses user-provided API key from encrypted settings
 *    - Required when deploying to own server
 *    - API key stored encrypted in database
 */

export interface OpenAIConfig {
  mode: 'replit' | 'standard';
  client: OpenAI;
}

/**
 * Check if Replit OpenAI Integration is available
 */
export function isReplitOpenAIAvailable(): boolean {
  return !!(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && 
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
  );
}

/**
 * Get OpenAI client - automatically selects between Replit and Standard integration
 * 
 * Priority:
 * 1. If Replit OpenAI env vars exist → Use Replit Integration
 * 2. Otherwise → Use provided API key (Standard OpenAI)
 * 
 * @param standardApiKey - Encrypted API key from settings (optional if using Replit)
 * @returns OpenAI client configuration
 */
export function getOpenAIClient(standardApiKey?: string): OpenAIConfig {
  // Check for Replit OpenAI Integration first (Test Environment)
  if (isReplitOpenAIAvailable()) {
    console.log('[OpenAI] Using Replit AI Integration (Test Mode)');
    return {
      mode: 'replit',
      client: new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      }),
    };
  }

  // Fall back to Standard OpenAI API (Production Server)
  if (!standardApiKey) {
    throw new Error('OpenAI API key not configured and Replit Integration not available');
  }

  console.log('[OpenAI] Using Standard OpenAI API (Production Mode)');
  const decryptedKey = decrypt(standardApiKey);
  
  return {
    mode: 'standard',
    client: new OpenAI({
      apiKey: decryptedKey,
    }),
  };
}

/**
 * Get OpenAI client for features requiring AI (tickets, etc.)
 * Uses the same dual-integration approach
 */
export async function getOpenAIClientFromSettings(
  getSettingFn: (key: string) => Promise<any>
): Promise<OpenAIConfig | null> {
  // Check for Replit OpenAI Integration first
  if (isReplitOpenAIAvailable()) {
    console.log('[OpenAI] Using Replit AI Integration (Test Mode)');
    return {
      mode: 'replit',
      client: new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      }),
    };
  }

  // Fall back to Standard OpenAI API
  const openaiSettings = await getSettingFn('openai_settings');
  if (!openaiSettings || !openaiSettings.enabled || !openaiSettings.apiKey) {
    return null;
  }

  console.log('[OpenAI] Using Standard OpenAI API (Production Mode)');
  const decryptedKey = decrypt(openaiSettings.apiKey);
  
  return {
    mode: 'standard',
    client: new OpenAI({
      apiKey: decryptedKey,
    }),
  };
}
