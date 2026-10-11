/** Freemail-Anbieter: Die Domain sagt nichts über die Firma (Web-Prüfung, Kundenabgleich über die Domain). */
export const FREEMAIL_DOMAINS = new Set(
  [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "gmx.de",
    "gmx.net",
    "gmx.at",
    "web.de",
    "t-online.de",
    "yahoo.com",
    "yahoo.de",
    "icloud.com",
    "me.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "mailbox.org",
    "posteo.de",
    "mail.de",
    "yandex.com",
    "yandex.ru",
    "zoho.com",
  ].map((d) => d.toLowerCase())
);

export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
