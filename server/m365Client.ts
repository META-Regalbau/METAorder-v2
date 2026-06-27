import jwt from "jsonwebtoken";
import type { M365Settings } from "@shared/schema";
import type { IStorage } from "./storage";
import { decrypt, encrypt } from "./encryption";

export const DEFAULT_M365_SETTINGS: M365Settings = {
  enabled: false,
  clientId: "",
  clientSecret: "",
  redirectUri: "https://example.com/api/auth/m365/callback",
  enableGraph: true,
  enableImapSmtp: true,
  authFlow: "auth_code",
};

const AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";

const DEFAULT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.Send",
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
];

export async function getM365Settings(storage: IStorage) {
  const stored = await storage.getSetting("m365_settings");
  return {
    ...DEFAULT_M365_SETTINGS,
    ...stored,
    clientSecret: stored?.clientSecret ? decrypt(stored.clientSecret) : "",
  } as M365Settings;
}

export async function saveM365Settings(storage: IStorage, settings: M365Settings) {
  const payload = {
    ...settings,
    clientSecret: settings.clientSecret ? encrypt(settings.clientSecret) : settings.clientSecret,
  };
  await storage.saveSetting("m365_settings", payload);
}

export function buildM365AuthUrl(settings: M365Settings, state: string) {
  const scope = DEFAULT_SCOPES.join(" ");
  const params = new URLSearchParams({
    client_id: settings.clientId,
    response_type: "code",
    redirect_uri: settings.redirectUri,
    response_mode: "query",
    scope,
    state,
    prompt: "consent",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

export async function startDeviceCode(settings: M365Settings) {
  const scope = DEFAULT_SCOPES.join(" ");
  const body = new URLSearchParams({
    client_id: settings.clientId,
    scope,
  });

  const response = await fetch(`${AUTH_BASE}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`M365 device code start failed: ${text}`);
  }

  return response.json() as Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
    message?: string;
  }>;
}

export async function exchangeDeviceCodeForToken(settings: M365Settings, deviceCode: string) {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
  });

  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json().catch(async () => {
    const text = await response.text();
    return { error: "unknown_error", error_description: text };
  });

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function exchangeCodeForToken(settings: M365Settings, code: string) {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: settings.redirectUri,
    scope: DEFAULT_SCOPES.join(" "),
  });

  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`M365 token exchange failed: ${text}`);
  }

  return response.json();
}

export async function refreshAccessToken(settings: M365Settings, refreshToken: string) {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret || "",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: settings.redirectUri,
    scope: DEFAULT_SCOPES.join(" "),
  });

  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`M365 refresh failed: ${text}`);
  }

  return response.json();
}

export function decodeIdToken(idToken?: string) {
  if (!idToken) return null;
  return jwt.decode(idToken) as {
    tid?: string;
    preferred_username?: string;
    email?: string;
    name?: string;
  } | null;
}

export async function graphGet(accessToken: string, path: string) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph GET failed: ${text}`);
  }
  return response.json();
}

export async function graphPost(accessToken: string, path: string, payload: any) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph POST failed: ${text}`);
  }
  return response.json();
}

export async function graphPatch(accessToken: string, path: string, payload: any) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph PATCH failed: ${text}`);
  }
  return response.text();
}
