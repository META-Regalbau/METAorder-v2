/**
 * Kundenmails B1: schlanker Client für die Brevo-API v3 (https://developers.brevo.com). Nur die Aufrufe, die
 * METAorder braucht: Konto, Absender, Vorlagen, Kontakte (Import, Sperrliste), Listen/Ordner, Kontaktfelder,
 * Kampagnen und Webhooks. fetchImpl ist für Tests austauschbar.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const BREVO_API_BASE = "https://api.brevo.com/v3";

export class BrevoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "BrevoApiError";
  }
}

export type BrevoContactPage = {
  contacts: Array<{ id: number; email: string; emailBlacklisted: boolean; modifiedAt: string | null }>;
  count: number;
};

export type BrevoClient = ReturnType<typeof brevoClient>;

export function brevoClient(apiKey: string, fetchImpl: FetchLike = fetch, base = BREVO_API_BASE) {
  async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "api-key": apiKey, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const message = typeof json?.message === "string" ? json.message : text.slice(0, 300) || res.statusText;
      throw new BrevoApiError(res.status, typeof json?.code === "string" ? json.code : null, `Brevo ${method} ${path.split("?")[0]}: ${res.status} ${message}`);
    }
    return json as T;
  }

  return {
    call,

    async account(): Promise<{ email: string; companyName: string; plans: string[] }> {
      const a = await call("GET", "/account");
      const plans = Array.isArray(a?.plan) ? a.plan.map((p: any) => [p?.type, p?.credits != null ? `${p.credits} ${p.creditsType ?? ""}`.trim() : ""].filter(Boolean).join(" ")) : [];
      return { email: String(a?.email ?? ""), companyName: String(a?.companyName ?? ""), plans };
    },

    async senders(): Promise<Array<{ id: number; name: string; email: string; active: boolean }>> {
      const r = await call("GET", "/senders");
      return (Array.isArray(r?.senders) ? r.senders : []).map((s: any) => ({ id: Number(s.id), name: String(s.name ?? ""), email: String(s.email ?? ""), active: s.active !== false }));
    },

    /** aktive Vorlagen (Kampagnen nutzen dieselben Vorlagen wie der Transaktionsversand) */
    async templates(): Promise<Array<{ id: number; name: string; subject: string }>> {
      const out: Array<{ id: number; name: string; subject: string }> = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const r = await call("GET", `/smtp/templates?templateStatus=true&limit=100&offset=${offset}&sort=desc`);
        const list = Array.isArray(r?.templates) ? r.templates : [];
        for (const t of list) out.push({ id: Number(t.id), name: String(t.name ?? ""), subject: String(t.subject ?? "") });
        if (list.length < 100) break;
      }
      return out;
    },

    /** Kontakte seit modifiedSince (aufsteigend), je Seite höchstens 1000 */
    async contacts(offset: number, modifiedSince: string | null): Promise<BrevoContactPage> {
      const q = new URLSearchParams({ limit: "1000", offset: String(offset), sort: "asc" });
      if (modifiedSince) q.set("modifiedSince", modifiedSince);
      const r = await call("GET", `/contacts?${q}`);
      return {
        count: Number(r?.count ?? 0) || 0,
        contacts: (Array.isArray(r?.contacts) ? r.contacts : []).map((c: any) => ({
          id: Number(c.id),
          email: String(c.email ?? "").toLowerCase(),
          emailBlacklisted: c.emailBlacklisted === true,
          modifiedAt: typeof c.modifiedAt === "string" ? c.modifiedAt : null,
        })),
      };
    },

    /**
     * Sperr- und Abmeldeverlauf eines Kontakts (GET /contacts/{email}). Brevo liefert Statistik standardmäßig nur
     * für 90 Tage, deshalb mit Zeitraum ab 2015. null = Kontakt gibt es nicht.
     */
    async contactHistory(email: string, today: Date): Promise<{
      emailBlacklisted: boolean;
      userUnsubscriptions: Date[];
      adminUnsubscriptions: Date[];
      complaints: Date[];
      hardBounces: Date[];
    } | null> {
      const base = `/contacts/${encodeURIComponent(email)}?identifierType=email_id`;
      let r: any;
      try {
        try {
          r = await call("GET", `${base}&startDate=2015-01-01&endDate=${today.toISOString().slice(0, 10)}`);
        } catch (err) {
          if (!(err instanceof BrevoApiError) || err.status !== 400) throw err;
          r = await call("GET", base); // Zeitraum abgelehnt: dann die letzten 90 Tage
        }
      } catch (err) {
        if (err instanceof BrevoApiError && err.status === 404) return null;
        throw err;
      }
      const times = (list: unknown) =>
        (Array.isArray(list) ? list : [])
          .map((e: any) => new Date(String(e?.eventTime ?? "")))
          .filter((d) => !Number.isNaN(d.getTime()));
      const st = r?.statistics ?? {};
      return {
        emailBlacklisted: r?.emailBlacklisted === true,
        userUnsubscriptions: times(st?.unsubscriptions?.userUnsubscription),
        adminUnsubscriptions: times(st?.unsubscriptions?.adminUnsubscription),
        complaints: times(st?.complaints),
        hardBounces: times(st?.hardBounces),
      };
    },

    /** Kontakt auf die Sperrliste (legt ihn an, falls es ihn noch nicht gibt) */
    async blocklist(email: string): Promise<void> {
      try {
        await call("PUT", `/contacts/${encodeURIComponent(email)}?identifierType=email_id`, { emailBlacklisted: true });
      } catch (err) {
        if (!(err instanceof BrevoApiError) || err.status !== 404) throw err;
        await call("POST", "/contacts", { email, emailBlacklisted: true, updateEnabled: true });
      }
    },

    async attributes(): Promise<Array<{ name: string; category: string; type: string | null }>> {
      const r = await call("GET", "/contacts/attributes");
      return (Array.isArray(r?.attributes) ? r.attributes : []).map((a: any) => ({ name: String(a.name ?? ""), category: String(a.category ?? ""), type: a.type ? String(a.type) : null }));
    },

    async createAttribute(name: string, type: "text" | "date" | "float" | "boolean"): Promise<void> {
      await call("POST", `/contacts/attributes/normal/${encodeURIComponent(name)}`, { type });
    },

    async folders(): Promise<Array<{ id: number; name: string }>> {
      const out: Array<{ id: number; name: string }> = [];
      for (let offset = 0; offset < 2000; offset += 50) {
        const r = await call("GET", `/contacts/folders?limit=50&offset=${offset}`);
        const list = Array.isArray(r?.folders) ? r.folders : [];
        for (const f of list) out.push({ id: Number(f.id), name: String(f.name ?? "") });
        if (list.length < 50) break;
      }
      return out;
    },

    async createFolder(name: string): Promise<number> {
      const r = await call("POST", "/contacts/folders", { name });
      return Number(r?.id);
    },

    async createList(name: string, folderId: number): Promise<number> {
      const r = await call("POST", "/contacts/lists", { name, folderId });
      return Number(r?.id);
    },

    /** Kontakte importieren bzw. aktualisieren und in die Liste aufnehmen; liefert die Prozess-ID */
    async importContacts(listId: number, contacts: Array<{ email: string; attributes: Record<string, string | number | null> }>): Promise<number> {
      const r = await call("POST", "/contacts/import", {
        jsonBody: contacts,
        listIds: [listId],
        updateExistingContacts: true,
        emptyContactsAttributes: false,
        disableNotification: true,
      });
      return Number(r?.processId);
    },

    async processStatus(processId: number): Promise<string> {
      const r = await call("GET", `/processes/${processId}`);
      return String(r?.status ?? "");
    },

    /**
     * Kampagne anlegen. Kein Tag: Kleinere Brevo-Tarife lehnen Kampagnen-Tags mit 405 ab (live 20.10.2026).
     * Lehnt Brevo die UTM-Kennung ab, geht es einmal ohne sie weiter.
     */
    async createCampaign(input: {
      name: string;
      subject: string;
      senderId: number;
      templateId: number;
      listId: number;
      replyTo?: string;
      utmCampaign?: string;
    }): Promise<number> {
      const body = (withUtm: boolean) => ({
        name: input.name,
        subject: input.subject,
        sender: { id: input.senderId },
        templateId: input.templateId,
        recipients: { listIds: [input.listId] },
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(withUtm && input.utmCampaign ? { utmCampaign: input.utmCampaign } : {}),
      });
      try {
        const r = await call("POST", "/emailCampaigns", body(true));
        return Number(r?.id);
      } catch (err) {
        if (!input.utmCampaign || !(err instanceof BrevoApiError) || ![400, 403, 405].includes(err.status) || !/utm/i.test(err.message)) throw err;
        const r = await call("POST", "/emailCampaigns", body(false));
        return Number(r?.id);
      }
    },

    async sendCampaignNow(campaignId: number): Promise<void> {
      await call("POST", `/emailCampaigns/${campaignId}/sendNow`);
    },

    /** Marketing-Webhook mit eigenen Kopfzeilen (Mandant + Token) anlegen; liefert die ID */
    async createWebhook(url: string, headers: Record<string, string>, events: string[]): Promise<number> {
      const r = await call("POST", "/webhooks", {
        url,
        description: "METAorder Kundenmails",
        type: "marketing",
        events,
        headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
      });
      return Number(r?.id);
    },

    async deleteWebhook(id: number): Promise<void> {
      try {
        await call("DELETE", `/webhooks/${id}`);
      } catch (err) {
        if (!(err instanceof BrevoApiError) || err.status !== 404) throw err;
      }
    },
  };
}

/** Text für Oberfläche und Protokoll ohne Schlüssel */
export function brevoErrorText(err: unknown): string {
  if (err instanceof BrevoApiError) return err.message.slice(0, 300);
  if (err instanceof Error) return err.message.slice(0, 300);
  return String(err).slice(0, 300);
}
