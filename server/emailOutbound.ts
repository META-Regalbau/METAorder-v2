import nodemailer from "nodemailer";
import type { EmailOutboundSettings } from "@shared/schema";
import type { IStorage } from "./storage";
import { decrypt, encrypt } from "./encryption";
import { getM365Settings, refreshAccessToken, graphPost } from "./m365Client";

export type EmailOutboundStatus = {
  enabled: boolean;
  hasPassword: boolean;
};

const DEFAULT_OUTBOUND_SETTINGS: EmailOutboundSettings = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  user: "",
  password: "",
  fromAddress: "",
  fromName: "",
  replyTo: "",
  m365ConnectionId: "",
};

export async function getEmailOutboundSettings(storage: IStorage) {
  const stored = await storage.getSetting("email_outbound_settings");
  const hasPassword = Boolean(stored?.password);
  return {
    settings: {
      ...DEFAULT_OUTBOUND_SETTINGS,
      ...stored,
      password: stored?.password ? decrypt(stored.password) : "",
    } as EmailOutboundSettings,
    hasPassword,
  };
}

export async function saveEmailOutboundSettings(storage: IStorage, settings: EmailOutboundSettings) {
  const payload = {
    ...settings,
    password: settings.password ? encrypt(settings.password) : settings.password,
  };
  await storage.saveSetting("email_outbound_settings", payload);
}

export async function sendEmail(
  storage: IStorage,
  params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType?: string;
    }>;
  }
) {
  const { settings } = await getEmailOutboundSettings(storage);
  if (!settings.enabled) {
    throw new Error("Outbound email disabled");
  }

  if (settings.m365ConnectionId) {
    const connection = await storage.getM365Connection(settings.m365ConnectionId);
    if (!connection) {
      throw new Error("M365 connection not found");
    }
    const m365Settings = await getM365Settings(storage);
    let accessToken = connection.accessToken;

    const expiresAt = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
    if (expiresAt > 0 && expiresAt < Date.now() + 60 * 1000 && connection.refreshToken) {
      const refreshed = await refreshAccessToken(m365Settings, connection.refreshToken);
      accessToken = refreshed.access_token;
      const nextExpiresAt = refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000)
        : connection.expiresAt;
      await storage.updateM365Connection(connection.id, {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || connection.refreshToken,
        expiresAt: nextExpiresAt,
        scopes: refreshed.scope ? refreshed.scope.split(" ") : connection.scopes,
      });
    }

    if (m365Settings.enableGraph) {
      await graphPost(accessToken, "/me/sendMail", {
        message: {
          subject: params.subject,
          body: {
            contentType: params.html ? "HTML" : "Text",
            content: params.html || params.text,
          },
          attachments: params.attachments?.length
            ? params.attachments.map((attachment) => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: attachment.filename,
                contentType: attachment.contentType || "application/octet-stream",
                contentBytes: attachment.content.toString("base64"),
              }))
            : undefined,
          toRecipients: [
            {
              emailAddress: { address: params.to },
            },
          ],
          internetMessageHeaders: [
            ...(params.inReplyTo
              ? [{ name: "In-Reply-To", value: params.inReplyTo }]
              : []),
            ...(params.references?.length
              ? [{ name: "References", value: params.references.join(" ") }]
              : []),
          ],
        },
        saveToSentItems: true,
      });

      return `<m365-graph:${connection.email}:${Date.now()}>`;
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: {
        type: "OAuth2",
        user: connection.email,
        accessToken,
      },
    });

    const response = await transporter.sendMail({
      from: connection.email,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
      replyTo: settings.replyTo || undefined,
      inReplyTo: params.inReplyTo || undefined,
      references: params.references || undefined,
    });

    return response.messageId || `<m365-smtp:${connection.email}:${Date.now()}>`;
  }

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user
      ? {
          user: settings.user,
          pass: settings.password,
        }
      : undefined,
  });

  const response = await transporter.sendMail({
    from: settings.fromName
      ? `${settings.fromName} <${settings.fromAddress}>`
      : settings.fromAddress,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
    replyTo: settings.replyTo || undefined,
    inReplyTo: params.inReplyTo || undefined,
    references: params.references || undefined,
  });

  return response.messageId;
}
