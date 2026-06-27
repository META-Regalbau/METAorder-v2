import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { AddressObject } from "mailparser";
import type { EmailInboundSettings } from "@shared/schema";
import type { IStorage } from "./storage";
import { objectStorageService } from "./objectStorage";
import { getUploadsRoot } from "./uploadsRoot";
import { getAISettings } from "./aiConfig";
import { classifyIncomingEmail } from "./emailClassifier";
import { getEmailRoutingSettings, routeIncomingEmail } from "./emailRouting";
import { decrypt, encrypt } from "./encryption";
import { getM365Settings, refreshAccessToken, graphGet, graphPatch } from "./m365Client";
import {
  filterCommercialDocumentPartsFromMailparserAttachments,
  buildCombinedCommercialDocumentTextForIntent,
  isCommercialInboundDocumentAttachment,
} from "./commercialInboundPdfContext";
import { getEmailOutboundSettings, sendEmail } from "./emailOutbound";
import { notifyNewTicket } from "./notifications";
import { processCommercialDocumentFromEmail, isLikelyCommercialInquiry } from "./commercialAgentOrchestrator";
import { collectSignatureImageCandidates } from "./commercialSignatureImageCandidates";

const DEFAULT_INBOUND_SETTINGS: EmailInboundSettings = {
  enabled: false,
  host: "",
  port: 993,
  secure: true,
  user: "",
  password: "",
  mailbox: "INBOX",
  pollIntervalSeconds: 60,
  markAsSeen: true,
  maxMessages: 25,
  allowAttachments: true,
};

const getFirstAddress = (address?: AddressObject | AddressObject[]) => {
  const list = Array.isArray(address)
    ? address.flatMap((item) => item?.value ?? [])
    : address?.value ?? [];
  return list[0];
};

let lastRunAt = 0;
let isRunning = false;

export async function getEmailInboundSettings(storage: IStorage) {
  const stored = await storage.getSetting("email_inbound_settings");
  const hasPassword = Boolean(stored?.password);
  return {
    settings: {
      ...DEFAULT_INBOUND_SETTINGS,
      ...stored,
      password: stored?.password ? decrypt(stored.password) : "",
    } as EmailInboundSettings,
    hasPassword,
  };
}

export async function saveEmailInboundSettings(storage: IStorage, settings: EmailInboundSettings) {
  const payload = {
    ...settings,
    password: settings.password ? encrypt(settings.password) : settings.password,
  };
  await storage.saveSetting("email_inbound_settings", payload);
}

function normalizeMessageId(messageId?: string | null) {
  if (!messageId) return "";
  return messageId.replace(/[<>]/g, "").trim();
}

function trimBody(text: string) {
  const withoutTags = text.replace(/<[^>]+>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim().slice(0, 12000);
}

type MailparserLikeAttachment = {
  content?: unknown;
  filename?: string;
  contentType?: string;
  size?: number;
};

function sanitizeInboundFilename(value: string) {
  return value
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .slice(0, 180);
}

/** Sichtbarer Ticket-Text: reiner Mail-Body oft leer bei „nur Anhang“ — Dateinamen ergänzen. */
function enrichBodyWithAttachmentNote(body: string, attachmentNames: string[]): string {
  const trimmed = (body || "").trim();
  const unique = [...new Set(attachmentNames.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return trimmed || "(leer)";
  }
  const list = unique.join(", ");
  const note = `Anhänge: ${list}`;
  if (!trimmed || trimmed === "(leer)") return note;
  if (trimmed.includes("Anhänge:") && list.split(", ").every((f) => trimmed.includes(f))) return trimmed;
  return `${trimmed}\n\n${note}`;
}

function attachmentFilenameHintsFromMailparser(
  attachments: MailparserLikeAttachment[] | undefined
): string[] {
  if (!attachments?.length) return [];
  return attachments
    .filter((a) => Buffer.isBuffer(a.content))
    .map((a) => (a.filename || "").trim() || "Anhang")
    .slice(0, 30);
}

async function saveInboundTicketAttachmentToDisk(
  buffer: Buffer,
  originalFilename: string
): Promise<{ absolutePath: string; storedDiskName: string }> {
  const dir = path.join(getUploadsRoot(), "ticket-attachments");
  await fs.mkdir(dir, { recursive: true });
  const safe = sanitizeInboundFilename(originalFilename) || "attachment";
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const storedDiskName = `${uniqueSuffix}-${safe}`;
  const absolutePath = path.join(dir, storedDiskName);
  await fs.writeFile(absolutePath, buffer);
  return { absolutePath, storedDiskName };
}

/** Microsoft Graph: Listen-Antwort liefert oft keinen vollständigen body — Felder gezielt anfordern. */
function graphMessageBodyPlain(message: Record<string, unknown>): string {
  const body = message.body as { content?: string } | undefined;
  const uniqueBody = message.uniqueBody as { content?: string } | undefined;
  const html = body?.content || uniqueBody?.content || "";
  const preview = typeof message.bodyPreview === "string" ? message.bodyPreview : "";
  return trimBody(html || preview);
}

async function fetchGraphAttachmentFilenames(
  accessToken: string,
  graphMessageId: string
): Promise<string[]> {
  try {
    const data = (await graphGet(
      accessToken,
      `/me/messages/${encodeURIComponent(graphMessageId)}/attachments?$select=name`
    )) as { value?: Array<{ name?: string }> };
    return (data.value || [])
      .map((a) => (typeof a.name === "string" && a.name.trim() ? a.name.trim() : "Anhang"))
      .slice(0, 30);
  } catch (e) {
    console.warn("[EmailInbound] Graph-Anhangsnamen konnten nicht geladen werden:", e);
    return [];
  }
}

/** Alle Datei-Anhänge einer Graph-Nachricht (wie mailparser: content = Buffer). */
async function fetchGraphFileAttachments(
  accessToken: string,
  graphMessageId: string
): Promise<MailparserLikeAttachment[]> {
  try {
    const data = (await graphGet(
      accessToken,
      `/me/messages/${encodeURIComponent(graphMessageId)}/attachments`
    )) as { value?: Array<Record<string, unknown>> };
    const out: MailparserLikeAttachment[] = [];
    for (const att of data.value || []) {
      const odataType = String(att["@odata.type"] || "");
      if (!odataType.includes("fileAttachment")) continue;
      const name = typeof att.name === "string" ? att.name : "attachment";
      const b64 = att.contentBytes;
      if (typeof b64 !== "string" || !b64) continue;
      const buffer = Buffer.from(b64, "base64");
      const contentType =
        typeof att.contentType === "string" ? att.contentType : "application/octet-stream";
      out.push({
        content: buffer,
        filename: name,
        contentType,
        size: buffer.length,
      });
    }
    return out;
  } catch (e) {
    console.error("[EmailInbound] Graph-Anhänge konnten nicht geladen werden:", e);
    return [];
  }
}

/**
 * Anhänge ins Ticket (falls vorhanden); Commercial Agent für PDF/Word/Bild/E-Mail-Dateien
 * sowie E-Mail-only-Fallback bei handelsrelevantem Text ohne nutzbaren Anhang.
 */
async function processInboundMailAttachments(options: {
  storage: IStorage;
  attachments: MailparserLikeAttachment[];
  messageId: string;
  subject: string;
  body: string;
  ticketId: string | null | undefined;
  commercialTenantId: string | null;
  systemUserId: string | null;
  allowAttachments: boolean;
  /** Rohes HTML derselben Nachricht (CID-Signatur) */
  mailHtml?: string | null;
  fromDisplayName?: string;
}): Promise<void> {
  const {
    storage,
    attachments,
    messageId,
    subject,
    body,
    ticketId,
    commercialTenantId,
    systemUserId,
    allowAttachments,
    mailHtml,
    fromDisplayName,
  } = options;
  if (!allowAttachments || !ticketId || !systemUserId) return;

  const signatureImageBuffers = collectSignatureImageCandidates(attachments, mailHtml ?? undefined);

  const commercialParts = filterCommercialDocumentPartsFromMailparserAttachments(attachments);
  const aiInbound = await getAISettings(storage);
  const combinedIntent =
    commercialParts.length > 0
      ? (
          await buildCombinedCommercialDocumentTextForIntent(commercialParts, {
            ocrEnabled: aiInbound.ocrEnabled,
          })
        ).trim()
      : "";
  const intentDocumentTextPreview = combinedIntent || undefined;
  const objectOk = objectStorageService.isConfigured();

  let ranCommercialDocumentAgent = false;

  for (const attachment of attachments) {
    const buf = attachment.content;
    if (!Buffer.isBuffer(buf)) continue;

    if (objectOk) {
      try {
        const upload = await objectStorageService.uploadFromBuffer(
          buf,
          attachment.filename || "attachment",
          attachment.contentType || "application/octet-stream"
        );
        await storage.createTicketAttachment({
          ticketId,
          fileName: attachment.filename || "attachment",
          fileSize: attachment.size || buf.length,
          mimeType: attachment.contentType || "application/octet-stream",
          filePath: `obj:${upload.objectKey}`,
          uploadedByUserId: systemUserId,
        });
      } catch (e) {
        console.error("[EmailInbound] Ticket-Anhang-Upload fehlgeschlagen:", e);
      }
    } else {
      try {
        const { absolutePath } = await saveInboundTicketAttachmentToDisk(
          buf,
          attachment.filename || "attachment"
        );
        await storage.createTicketAttachment({
          ticketId,
          fileName: attachment.filename || "attachment",
          fileSize: attachment.size || buf.length,
          mimeType: attachment.contentType || "application/octet-stream",
          filePath: absolutePath,
          uploadedByUserId: systemUserId,
        });
      } catch (e) {
        console.error("[EmailInbound] Ticket-Anhang lokal (uploads/ticket-attachments) fehlgeschlagen:", e);
      }
    }

    const fn = (attachment.filename || "").toLowerCase();
    const ct = (attachment.contentType || "").toLowerCase();
    if (isCommercialInboundDocumentAttachment(fn, ct)) {
      ranCommercialDocumentAgent = true;
      processCommercialDocumentFromEmail({
        storage,
        tenantId: commercialTenantId,
        messageId,
        filename: attachment.filename || "attachment",
        buffer: buf,
        mimeType: attachment.contentType || "application/octet-stream",
        subject,
        emailBody: body,
        ticketId,
        systemUserId,
        intentDocumentTextPreview,
        primaryContainsEmailBody: false,
        fromDisplayName,
        signatureImageBuffers: signatureImageBuffers.length ? signatureImageBuffers : undefined,
      }).catch((err) => {
        console.error("[EmailInbound] Commercial agent document processing failed:", err);
      });
    }
  }

  if (!ranCommercialDocumentAgent && isLikelyCommercialInquiry(subject, body)) {
    const composed = [
      subject.trim() && `Betreff: ${subject.trim()}`,
      body.trim() && `E-Mail-Text:\n${body.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 120_000);
    processCommercialDocumentFromEmail({
      storage,
      tenantId: commercialTenantId,
      messageId,
      filename: "email-inquiry.txt",
      buffer: Buffer.from(composed || "(leer)", "utf8"),
      mimeType: "text/plain",
      subject,
      emailBody: body,
      ticketId,
      systemUserId,
      intentDocumentTextPreview: undefined,
      primaryContainsEmailBody: true,
      fromDisplayName,
      signatureImageBuffers: signatureImageBuffers.length ? signatureImageBuffers : undefined,
    }).catch((err) => {
      console.error("[EmailInbound] Commercial agent email-only processing failed:", err);
    });
  }
}

function buildAutoReplyText(ticketNumber: string) {
  return [
    "Vielen Dank für Ihre Nachricht.",
    "Wir haben Ihr Anliegen erhalten und melden uns schnellstmöglich bei Ihnen.",
    "",
    `Ihre Ticketnummer: ${ticketNumber}`,
    "",
    "Freundliche Grüße",
    "Ihr Support-Team",
  ].join("\n");
}

async function findThreadTicket(
  storage: IStorage,
  inReplyTo?: string | null,
  references?: string[] | null
) {
  const candidates = [inReplyTo, ...(references || [])]
    .map(normalizeMessageId)
    .filter(Boolean);

  for (const messageId of candidates) {
    const match = await storage.getTicketEmailMessageByMessageId(messageId);
    if (match?.ticketId) {
      return match.ticketId;
    }
  }
  return null;
}

async function getSystemUserId(storage: IStorage) {
  const serviceUser = await storage.getUserByUsername("n8n-service");
  if (serviceUser) return serviceUser.id;
  const users = await storage.getAllUsers();
  return users[0]?.id || null;
}

async function getValidAccessToken(storage: IStorage, connectionId: string) {
  const connection = await storage.getM365Connection(connectionId);
  if (!connection) return null;
  const settings = await getM365Settings(storage);
  if (!settings.enabled || !settings.clientId) return null;

  const expiresAt = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
  const needsRefresh = expiresAt > 0 && expiresAt < Date.now() + 60 * 1000;

  if (!needsRefresh) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    return connection.accessToken;
  }

  try {
    const refreshed = await refreshAccessToken(settings, connection.refreshToken);
    const nextExpiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : connection.expiresAt;
    await storage.updateM365Connection(connection.id, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || connection.refreshToken,
      expiresAt: nextExpiresAt,
      scopes: refreshed.scope ? refreshed.scope.split(" ") : connection.scopes,
    });
    return refreshed.access_token;
  } catch (error) {
    console.error("[EmailInbound] M365 token refresh failed:", error);
    return connection.accessToken;
  }
}

export async function pollInboundEmails(storage: IStorage) {
  if (isRunning) return;

  const { settings } = await getEmailInboundSettings(storage);
  const m365Settings = await getM365Settings(storage);
  const shouldRunImap = settings.enabled && settings.host && settings.user && settings.password;
  const shouldRunM365Graph = m365Settings.enabled && m365Settings.enableGraph;
  const shouldRunM365Imap = m365Settings.enabled && m365Settings.enableImapSmtp && !m365Settings.enableGraph;
  if (!shouldRunImap && !shouldRunM365Graph && !shouldRunM365Imap) {
    return;
  }

  const now = Date.now();
  if (now - lastRunAt < settings.pollIntervalSeconds * 1000) {
    return;
  }

  isRunning = true;
  lastRunAt = now;

  try {
    const routingSettings = await getEmailRoutingSettings(storage);
    const systemUserId = await getSystemUserId(storage);
    const users = await storage.getAllUsers();
    const skillCatalog = users.flatMap((user) => user.skills || []).filter(Boolean);
    let processed = 0;

    if (shouldRunM365Graph) {
      const connections = await storage.getM365Connections();
      for (const connection of connections) {
        if (!connection.accessToken) continue;
        const accessToken = await getValidAccessToken(storage, connection.id);
        if (!accessToken) continue;

        const graphSelect =
          "id,internetMessageId,subject,from,body,bodyPreview,uniqueBody,hasAttachments,inReplyTo,references";
        const messages = await graphGet(
          accessToken,
          `/me/messages?$filter=isRead eq false&$top=${settings.maxMessages}&$select=${graphSelect}`
        );

        for (const message of messages.value || []) {
          const messageId = normalizeMessageId(message.internetMessageId);
          if (!messageId) continue;
          const existing = await storage.getTicketEmailMessageByMessageId(messageId);
          if (existing) continue;

          const subject = message.subject || "Ohne Betreff";
          const fromEmail = message.from?.emailAddress?.address || "";
          const fromName = message.from?.emailAddress?.name || "";
          const graphMsg = message as Record<string, unknown>;
          let bodyPlain = graphMessageBodyPlain(graphMsg);
          if (!bodyPlain.trim() && graphMsg.hasAttachments) {
            try {
              const full = (await graphGet(
                accessToken,
                `/me/messages/${encodeURIComponent(String(message.id))}?$select=body,uniqueBody,bodyPreview`
              )) as Record<string, unknown>;
              Object.assign(graphMsg, full);
              bodyPlain = graphMessageBodyPlain(graphMsg);
            } catch (e) {
              console.warn("[EmailInbound] Graph: Nachrichtenkörper nachladen fehlgeschlagen:", e);
            }
          }
          let graphAttachmentNames: string[] = [];
          if (settings.allowAttachments && graphMsg.hasAttachments) {
            graphAttachmentNames = await fetchGraphAttachmentFilenames(
              accessToken,
              String(message.id)
            );
          }
          const body = enrichBodyWithAttachmentNote(bodyPlain, graphAttachmentNames);

          const classification = await classifyIncomingEmail(
            storage,
            { subject, body, from: fromEmail },
            routingSettings,
            skillCatalog
          );

          const routing = await routeIncomingEmail(
            storage,
            { subject, body, from: fromEmail },
            classification,
            routingSettings
          );

          const references = message.references
            ? Array.isArray(message.references)
              ? message.references
              : [message.references]
            : [];

          const ticketId = await findThreadTicket(
            storage,
            message.inReplyTo || null,
            references
          );

          let createdTicketId = ticketId;
          let commentId: string | undefined;

          if (!ticketId) {
            const fallbackAssignee = routing.assigneeUserId || systemUserId || null;
            const newTicket = await storage.createTicket({
              title: subject,
              description: body || "(leer)",
              status: "open",
              priority: routing.priority,
              category: routing.category,
              assignedToUserId: fallbackAssignee,
              createdByUserId: systemUserId,
              customerEmail: fromEmail || null,
              customerName: fromName || null,
              emailFrom: fromEmail || null,
              emailSubject: subject,
            });
            createdTicketId = newTicket.id;
            notifyNewTicket(storage, {
              id: newTicket.id,
              ticketNumber: newTicket.ticketNumber,
              title: newTicket.title,
              assignedToUserId: newTicket.assignedToUserId || null,
            }).catch((error) => {
              console.error("[EmailInbound] Push notify failed:", error);
            });

            try {
              const { settings: outboundSettings } = await getEmailOutboundSettings(storage);
              if (outboundSettings.enabled && newTicket.customerEmail) {
                const ticketNumber = newTicket.ticketNumber || newTicket.id;
                const autoReplyText = buildAutoReplyText(ticketNumber);
                const replySubject = subject.toLowerCase().startsWith("re:")
                  ? subject
                  : `Re: ${subject}`;
                const replyMessageId = await sendEmail(storage, {
                  to: newTicket.customerEmail,
                  subject: replySubject,
                  text: autoReplyText,
                  html: `<p>${autoReplyText.replace(/\n/g, "<br/>")}</p>`,
                  inReplyTo: messageId,
                  references: references.length > 0 ? [...references, messageId] : [messageId],
                });

                await storage.createTicketEmailMessage({
                  ticketId: newTicket.id,
                  commentId: null,
                  messageId: normalizeMessageId(replyMessageId),
                  inReplyTo: messageId || null,
                  references: references.length > 0 ? [...references, messageId] : [messageId],
                  direction: "outbound",
                  source: outboundSettings.m365ConnectionId ? "graph" : "smtp",
                  subject: replySubject,
                  from: outboundSettings.fromAddress || null,
                  to: newTicket.customerEmail,
                });
              }
            } catch (error) {
              console.error("[EmailInbound] Failed sending auto-reply:", error);
            }
          } else {
            const comment = await storage.createTicketComment({
              ticketId,
              userId: null,
              authorType: "customer",
              customerEmail: fromEmail || null,
              customerName: fromName || null,
              comment: body || "(leer)",
              isInternal: 0,
            });
            commentId = comment.id;
            const existingTicket = await storage.getTicket(ticketId);
            if (existingTicket && !["resolved", "closed"].includes(existingTicket.status)) {
              await storage.updateTicket(ticketId, { status: "waiting_for_internal" });
            }
          }

          await storage.createTicketEmailMessage({
            ticketId: createdTicketId || null,
            commentId: commentId || null,
            messageId,
            inReplyTo: normalizeMessageId(message.inReplyTo) || null,
            references: references.length > 0 ? references : null,
            direction: "inbound",
            source: "graph",
            subject,
            from: fromEmail || fromName || null,
            to: connection.email,
          });

          if (settings.allowAttachments && createdTicketId && systemUserId) {
            let graphCommercialTenantId: string | null = null;
            try {
              const tkt = await storage.getTicket(createdTicketId);
              graphCommercialTenantId = tkt?.tenantId ?? null;
            } catch {
              graphCommercialTenantId = null;
            }
            const graphAttachments = message.hasAttachments
              ? await fetchGraphFileAttachments(accessToken, message.id)
              : [];
            const graphBodyRaw = (message as { body?: { contentType?: string; content?: string } }).body;
            const graphMailHtml =
              graphBodyRaw?.contentType?.toLowerCase().includes("html") && graphBodyRaw.content
                ? graphBodyRaw.content
                : null;
            await processInboundMailAttachments({
              storage,
              attachments: graphAttachments,
              messageId,
              subject,
              body,
              ticketId: createdTicketId,
              commercialTenantId: graphCommercialTenantId,
              systemUserId,
              allowAttachments: true,
              mailHtml: graphMailHtml,
              fromDisplayName: fromName || undefined,
            });
          }

          if (settings.markAsSeen) {
            await graphPatch(accessToken, `/me/messages/${message.id}`, { isRead: true });
          }
          processed += 1;
        }

        await storage.updateM365Connection(connection.id, { lastSyncAt: new Date() });
      }
    }

    if (shouldRunM365Imap) {
      const connections = await storage.getM365Connections();
      for (const connection of connections) {
        const accessToken = await getValidAccessToken(storage, connection.id);
        if (!accessToken) continue;

        const client = new ImapFlow({
          host: "outlook.office365.com",
          port: 993,
          secure: true,
          auth: {
            user: connection.email,
            accessToken,
          },
        });

        try {
          await client.connect();
          await client.mailboxOpen(settings.mailbox || "INBOX");

          const messageIds = await client.search({ seen: false });
          if (!messageIds || messageIds.length === 0) {
            await client.logout();
            continue;
          }
          const selectedIds = messageIds.slice(-settings.maxMessages);

          for (const uid of selectedIds) {
            const message = await client.fetchOne(uid, { source: true });
            if (!message || !("source" in message) || !message.source) continue;

            const parsed = await simpleParser(message.source);
            const messageId = normalizeMessageId(parsed.messageId);
            if (!messageId) continue;

            const existing = await storage.getTicketEmailMessageByMessageId(messageId);
            if (existing) continue;

            const fromAddress = getFirstAddress(parsed.from);
            const fromEmail = fromAddress?.address || "";
            const fromName = fromAddress?.name || "";
            const subject = parsed.subject || "Ohne Betreff";
            const rawBody = trimBody(parsed.text || parsed.html || "");
            const hintNames = attachmentFilenameHintsFromMailparser(
              parsed.attachments as MailparserLikeAttachment[] | undefined
            );
            const body = enrichBodyWithAttachmentNote(rawBody, hintNames);

            const classification = await classifyIncomingEmail(
              storage,
              { subject, body, from: fromEmail },
              routingSettings,
              skillCatalog
            );

            const routing = await routeIncomingEmail(
              storage,
              { subject, body, from: fromEmail },
              classification,
              routingSettings
            );

            const references = Array.isArray(parsed.references)
              ? parsed.references
              : parsed.references
                ? [parsed.references]
                : [];

            const ticketId = await findThreadTicket(
              storage,
              parsed.inReplyTo as string | undefined,
              references
            );

            let createdTicketId = ticketId;
            let commentId: string | undefined;

            if (!ticketId) {
              const fallbackAssignee = routing.assigneeUserId || systemUserId || null;
              const newTicket = await storage.createTicket({
                title: subject,
                description: body || "(leer)",
                status: "open",
                priority: routing.priority,
                category: routing.category,
                assignedToUserId: fallbackAssignee,
                createdByUserId: systemUserId,
                customerEmail: fromEmail || null,
                customerName: fromName || null,
                emailFrom: fromEmail || null,
                emailSubject: subject,
              });
              createdTicketId = newTicket.id;
              notifyNewTicket(storage, {
                id: newTicket.id,
                ticketNumber: newTicket.ticketNumber,
                title: newTicket.title,
                assignedToUserId: newTicket.assignedToUserId || null,
              }).catch((error) => {
                console.error("[EmailInbound] Push notify failed:", error);
              });

              try {
                const { settings: outboundSettings } = await getEmailOutboundSettings(storage);
                if (outboundSettings.enabled && newTicket.customerEmail) {
                  const ticketNumber = newTicket.ticketNumber || newTicket.id;
                  const autoReplyText = buildAutoReplyText(ticketNumber);
                  const replySubject = subject.toLowerCase().startsWith("re:")
                    ? subject
                    : `Re: ${subject}`;
                  const replyMessageId = await sendEmail(storage, {
                    to: newTicket.customerEmail,
                    subject: replySubject,
                    text: autoReplyText,
                    html: `<p>${autoReplyText.replace(/\n/g, "<br/>")}</p>`,
                    inReplyTo: messageId,
                    references: references.length > 0 ? [...references, messageId] : [messageId],
                  });

                  await storage.createTicketEmailMessage({
                    ticketId: newTicket.id,
                    commentId: null,
                    messageId: normalizeMessageId(replyMessageId),
                    inReplyTo: messageId || null,
                    references: references.length > 0 ? [...references, messageId] : [messageId],
                    direction: "outbound",
                    source: outboundSettings.m365ConnectionId ? "graph" : "smtp",
                    subject: replySubject,
                    from: outboundSettings.fromAddress || null,
                    to: newTicket.customerEmail,
                  });
                }
              } catch (error) {
                console.error("[EmailInbound] Failed sending auto-reply:", error);
              }
            } else {
              const comment = await storage.createTicketComment({
                ticketId,
                userId: null,
                authorType: "customer",
                customerEmail: fromEmail || null,
                customerName: fromName || null,
                comment: body || "(leer)",
                isInternal: 0,
              });
              commentId = comment.id;
              const existingTicket = await storage.getTicket(ticketId);
              if (existingTicket && !["resolved", "closed"].includes(existingTicket.status)) {
                await storage.updateTicket(ticketId, { status: "waiting_for_internal" });
              }
            }

            await storage.createTicketEmailMessage({
              ticketId: createdTicketId || null,
              commentId: commentId || null,
              messageId,
              inReplyTo: normalizeMessageId(parsed.inReplyTo as string | undefined) || null,
              references: references.length > 0 ? references : null,
              direction: "inbound",
              source: "imap",
              subject,
              from: fromEmail || fromName || null,
              to: connection.email,
            });

            if (settings.allowAttachments && createdTicketId && systemUserId) {
              let m365ImapCommercialTenantId: string | null = null;
              try {
                const tkt = await storage.getTicket(createdTicketId);
                m365ImapCommercialTenantId = tkt?.tenantId ?? null;
              } catch {
                m365ImapCommercialTenantId = null;
              }
              await processInboundMailAttachments({
                storage,
                attachments: (parsed.attachments as MailparserLikeAttachment[]) || [],
                messageId,
                subject,
                body,
                ticketId: createdTicketId,
                commercialTenantId: m365ImapCommercialTenantId,
                systemUserId,
                allowAttachments: true,
                mailHtml: typeof parsed.html === "string" ? parsed.html : null,
                fromDisplayName: fromName || undefined,
              });
            }

            if (settings.markAsSeen) {
              await client.messageFlagsAdd(uid, ["\\Seen"]);
            }

            processed += 1;
          }
        } catch (error) {
          console.error("[EmailInbound] M365 IMAP polling failed:", error);
        } finally {
          await storage.updateM365Connection(connection.id, { lastSyncAt: new Date() });
          try {
            await client.logout();
          } catch {
            // ignore
          }
        }
      }
    }

    if (shouldRunImap) {
      const client = new ImapFlow({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: {
          user: settings.user,
          pass: settings.password,
        },
      });

      await client.connect();
      await client.mailboxOpen(settings.mailbox || "INBOX");

      const messageIds = await client.search({ seen: false });
      if (!messageIds || messageIds.length === 0) {
        await client.logout();
        return;
      }
      const selectedIds = messageIds.slice(-settings.maxMessages);

    for (const uid of selectedIds) {
      const message = await client.fetchOne(uid, { source: true });
      if (!message || !("source" in message) || !message.source) continue;

      const parsed = await simpleParser(message.source);
      const messageId = normalizeMessageId(parsed.messageId);

      if (!messageId) continue;
      const existing = await storage.getTicketEmailMessageByMessageId(messageId);
      if (existing) continue;

      const fromAddress = getFirstAddress(parsed.from);
      const fromEmail = fromAddress?.address || "";
      const fromName = fromAddress?.name || "";
      const toAddress = getFirstAddress(parsed.to)?.address || "";
      const subject = parsed.subject || "Ohne Betreff";
      const rawBodyImap = trimBody(parsed.text || parsed.html || "");
      const hintNamesImap = attachmentFilenameHintsFromMailparser(
        parsed.attachments as MailparserLikeAttachment[] | undefined
      );
      const body = enrichBodyWithAttachmentNote(rawBodyImap, hintNamesImap);

      const classification = await classifyIncomingEmail(
        storage,
        { subject, body, from: fromEmail },
        routingSettings,
        skillCatalog
      );

      const routing = await routeIncomingEmail(
        storage,
        { subject, body, from: fromEmail },
        classification,
        routingSettings
      );

      const references = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [];

      const ticketId = await findThreadTicket(
        storage,
        parsed.inReplyTo as string | undefined,
        references
      );

      let createdTicketId = ticketId;
      let commentId: string | undefined;

      if (!ticketId) {
        const fallbackAssignee = routing.assigneeUserId || systemUserId || null;
        const newTicket = await storage.createTicket({
          title: subject,
          description: body || "(leer)",
          status: "open",
          priority: routing.priority,
          category: routing.category,
          assignedToUserId: fallbackAssignee,
          createdByUserId: systemUserId,
          customerEmail: fromEmail || null,
          customerName: fromName || null,
          emailFrom: fromEmail || null,
          emailSubject: subject,
        });
        createdTicketId = newTicket.id;
        notifyNewTicket(storage, {
          id: newTicket.id,
          ticketNumber: newTicket.ticketNumber,
          title: newTicket.title,
          assignedToUserId: newTicket.assignedToUserId || null,
        }).catch((error) => {
          console.error("[EmailInbound] Push notify failed:", error);
        });

        try {
          const { settings: outboundSettings } = await getEmailOutboundSettings(storage);
          if (outboundSettings.enabled && newTicket.customerEmail) {
            const ticketNumber = newTicket.ticketNumber || newTicket.id;
            const autoReplyText = buildAutoReplyText(ticketNumber);
            const replySubject = subject.toLowerCase().startsWith("re:")
              ? subject
              : `Re: ${subject}`;
            const replyMessageId = await sendEmail(storage, {
              to: newTicket.customerEmail,
              subject: replySubject,
              text: autoReplyText,
              html: `<p>${autoReplyText.replace(/\n/g, "<br/>")}</p>`,
              inReplyTo: messageId,
              references: references.length > 0 ? [...references, messageId] : [messageId],
            });

            await storage.createTicketEmailMessage({
              ticketId: newTicket.id,
              commentId: null,
              messageId: normalizeMessageId(replyMessageId),
              inReplyTo: messageId || null,
              references: references.length > 0 ? [...references, messageId] : [messageId],
              direction: "outbound",
              source: outboundSettings.m365ConnectionId ? "graph" : "smtp",
              subject: replySubject,
              from: outboundSettings.fromAddress || null,
              to: newTicket.customerEmail,
            });
          }
        } catch (error) {
          console.error("[EmailInbound] Failed sending auto-reply:", error);
        }
      } else {
        const comment = await storage.createTicketComment({
          ticketId,
          userId: null,
          authorType: "customer",
          customerEmail: fromEmail || null,
          customerName: fromName || null,
          comment: body || "(leer)",
          isInternal: 0,
        });
        commentId = comment.id;
        const existingTicket = await storage.getTicket(ticketId);
        if (existingTicket && !["resolved", "closed"].includes(existingTicket.status)) {
          await storage.updateTicket(ticketId, { status: "waiting_for_internal" });
        }
      }

      await storage.createTicketEmailMessage({
        ticketId: createdTicketId || null,
        commentId: commentId || null,
        messageId,
        inReplyTo: normalizeMessageId(parsed.inReplyTo as string | undefined) || null,
        references: references.length > 0 ? references : null,
        direction: "inbound",
        source: "imap",
        subject,
        from: fromEmail || fromName || null,
        to: toAddress || null,
      });

      if (settings.allowAttachments && createdTicketId && systemUserId) {
        let commercialTenantId: string | null = null;
        try {
          const tkt = await storage.getTicket(createdTicketId);
          commercialTenantId = tkt?.tenantId ?? null;
        } catch {
          commercialTenantId = null;
        }
        await processInboundMailAttachments({
          storage,
          attachments: (parsed.attachments as MailparserLikeAttachment[]) || [],
          messageId,
          subject,
          body,
          ticketId: createdTicketId,
          commercialTenantId,
          systemUserId,
          allowAttachments: true,
          mailHtml: typeof parsed.html === "string" ? parsed.html : null,
          fromDisplayName: fromName || undefined,
        });
      }

      if (settings.markAsSeen) {
        await client.messageFlagsAdd(uid, ["\\Seen"]);
      }

      processed += 1;
    }

      await client.logout();
    }

    if (processed > 0) {
      console.log(`[EmailInbound] Processed ${processed} messages from ${settings.mailbox}`);
    }
  } catch (error) {
    console.error("[EmailInbound] Polling failed:", error);
  } finally {
    isRunning = false;
  }
}
