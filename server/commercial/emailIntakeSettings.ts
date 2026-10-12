import type { IStorage } from "../storage";
import {
  EMAIL_INTAKE_SETTING_KEY,
  graphBaseForMailbox,
  intakeMessageFilter,
  normalizeEmailIntakeSettings,
  receivedAfterFor,
  type EmailIntakeSettings,
  type EmailIntakeWorkflowConfig,
  type EmailIntakeWorkflowMailbox,
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

/** Was n8n zu Beginn jedes Laufs braucht: je aktivem Postfach Abruf und Ablage */
export function workflowConfigFromSettings(settings: EmailIntakeSettings, now = new Date()): EmailIntakeWorkflowConfig {
  const receivedAfter = receivedAfterFor(settings.processSince, now);
  const mailboxes: EmailIntakeWorkflowMailbox[] = settings.mailboxes
    .filter((m) => m.enabled)
    .map((m) => ({
      graphBase: graphBaseForMailbox(m.address),
      mailbox: m.address.trim() || null,
      mode: m.mode,
      processedFolderName: settings.processedFolderName,
      maxPerRun: settings.maxPerRun,
      receivedAfter,
      messageFilter: intakeMessageFilter(receivedAfter),
    }));
  const first = mailboxes[0];
  return {
    enabled: settings.enabled && mailboxes.length > 0,
    mailboxes,
    graphBase: first?.graphBase ?? graphBaseForMailbox(""),
    mailbox: first?.mailbox ?? null,
    processedFolderName: settings.processedFolderName,
    maxPerRun: settings.maxPerRun,
    receivedAfter,
  };
}

/** Adressen der Postfächer (gehören nie zu den Zuständigen eines Tickets) */
export function intakeMailboxAddresses(settings: EmailIntakeSettings): string[] {
  return settings.mailboxes.map((m) => m.address.trim()).filter(Boolean);
}
