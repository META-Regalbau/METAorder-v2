import type { IStorage } from "../storage";
import {
  EMAIL_INTAKE_SETTING_KEY,
  graphBaseForMailbox,
  normalizeEmailIntakeSettings,
  receivedAfterFor,
  type EmailIntakeSettings,
  type EmailIntakeWorkflowConfig,
} from "@shared/emailIntake";

/** Einstellungen des E-Mail-Eingangs je Mandant (Mandant aus dem Anfragekontext) */
export async function getEmailIntakeSettings(storage: IStorage, tenantId?: string | null): Promise<EmailIntakeSettings> {
  return normalizeEmailIntakeSettings(await storage.getSetting(EMAIL_INTAKE_SETTING_KEY, tenantId));
}

export async function saveEmailIntakeSettings(
  storage: IStorage,
  settings: EmailIntakeSettings,
  tenantId?: string | null,
): Promise<void> {
  await storage.saveSetting(EMAIL_INTAKE_SETTING_KEY, settings, tenantId);
}

/** Was n8n zu Beginn jedes Laufs braucht */
export function workflowConfigFromSettings(settings: EmailIntakeSettings, now = new Date()): EmailIntakeWorkflowConfig {
  return {
    enabled: settings.enabled,
    graphBase: graphBaseForMailbox(settings.mailbox),
    mailbox: settings.mailbox.trim() || null,
    processedFolderName: settings.processedFolderName,
    maxPerRun: settings.maxPerRun,
    receivedAfter: receivedAfterFor(settings.processSince, now),
  };
}
