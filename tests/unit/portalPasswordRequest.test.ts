/**
 * Öffentliche Passwort-Anforderung für das Händlerportal – Unit-Tests.
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPortalPasswordMail,
  generatePortalPassword,
  processPortalPasswordRequest,
  rateLimitPortalPasswordAccount,
  rateLimitPortalPasswordIp,
  resetPortalPasswordRateLimitsForTests,
  type PortalPasswordRequestDeps,
} from "../../server/b2b/portalPasswordRequest";

type Link = { id: string; employeeId: string; customerId: string; roleId: string | null; admin: boolean; active: boolean };

function makeDeps(options: {
  customers?: Array<{ id: string; customerNumber: string; company: string | null; salesRepresentative: boolean }>;
  employees?: Array<{ id: string; email: string; firstName: string; lastName: string }>;
  links?: Link[];
  mailReady?: boolean;
  sendMailError?: Error;
}) {
  const setEmployeePassword = vi.fn(async () => {});
  const sendMail = vi.fn(async () => {
    if (options.sendMailError) throw options.sendMailError;
    return "msg-id";
  });
  const deps: PortalPasswordRequestDeps = {
    client: {
      findCustomersByNumber: vi.fn(async () => options.customers ?? []),
      findEmployeesByEmail: vi.fn(async () => (options.employees ?? []) as any),
      findEmployeeCustomerLink: vi.fn(
        async (employeeId: string, customerId: string) =>
          options.links?.find((l) => l.employeeId === employeeId && l.customerId === customerId) ?? null,
      ),
      setEmployeePassword,
    },
    sendMail,
    mailReady: async () => options.mailReady ?? true,
    loginUrl: "https://portal.example.test",
    generatePassword: () => "Abcdefgh2345",
  };
  return { deps, setEmployeePassword, sendMail };
}

const CUSTOMER = { id: "c1", customerNumber: "10012345", company: "Händler GmbH", salesRepresentative: false };
const EMPLOYEE = { id: "e1", email: "einkauf@haendler.de", firstName: "Erika", lastName: "Muster" };
const LINK: Link = { id: "l1", employeeId: "e1", customerId: "c1", roleId: null, admin: true, active: true };

describe("processPortalPasswordRequest", () => {
  it("setzt bei passender Kundennummer + E-Mail ein neues Passwort und verschickt es", async () => {
    const { deps, setEmployeePassword, sendMail } = makeDeps({ customers: [CUSTOMER], employees: [EMPLOYEE], links: [LINK] });
    const result = await processPortalPasswordRequest(deps, { customerNumber: " 10012345 ", email: " Einkauf@Haendler.de " });
    expect(result).toEqual({ outcome: "sent", employeeId: "e1", customerId: "c1" });
    expect(setEmployeePassword).toHaveBeenCalledWith("e1", "Abcdefgh2345");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = (sendMail.mock.calls[0] as any[])[0];
    expect(mail.to).toBe("einkauf@haendler.de");
    expect(mail.text).toContain("Abcdefgh2345");
    expect(mail.text).toContain("ändern Sie dieses Passwort");
    expect(deps.client.findCustomersByNumber).toHaveBeenCalledWith("10012345");
  });

  it("ändert kein Passwort, wenn der Mailversand nicht eingerichtet ist", async () => {
    const { deps, setEmployeePassword, sendMail } = makeDeps({
      customers: [CUSTOMER],
      employees: [EMPLOYEE],
      links: [LINK],
      mailReady: false,
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result.outcome).toBe("mail_disabled");
    expect(setEmployeePassword).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("meldet einen fehlgeschlagenen Versand als mail_failed statt zu werfen", async () => {
    const { deps } = makeDeps({
      customers: [CUSTOMER],
      employees: [EMPLOYEE],
      links: [LINK],
      sendMailError: new Error("SMTP down"),
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result).toMatchObject({ outcome: "mail_failed", employeeId: "e1", error: "SMTP down" });
  });

  it("verschickt nichts, wenn die Kundennummer unbekannt ist", async () => {
    const { deps, setEmployeePassword, sendMail } = makeDeps({ customers: [], employees: [EMPLOYEE] });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "999", email: EMPLOYEE.email });
    expect(result.outcome).toBe("customer_not_found");
    expect(setEmployeePassword).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("verschickt nichts, wenn die E-Mail zu einem anderen Kunden gehört", async () => {
    const { deps, setEmployeePassword } = makeDeps({
      customers: [CUSTOMER],
      employees: [EMPLOYEE],
      links: [{ ...LINK, customerId: "other" }],
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result.outcome).toBe("not_linked");
    expect(setEmployeePassword).not.toHaveBeenCalled();
  });

  it("verschickt nichts für deaktivierte Zugänge", async () => {
    const { deps, setEmployeePassword } = makeDeps({
      customers: [CUSTOMER],
      employees: [EMPLOYEE],
      links: [{ ...LINK, active: false }],
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result.outcome).toBe("link_inactive");
    expect(setEmployeePassword).not.toHaveBeenCalled();
  });

  it("schließt META-eigene Adressen und Vertriebszugänge aus", async () => {
    const meta = makeDeps({ customers: [CUSTOMER], employees: [{ ...EMPLOYEE, email: "x@meta-online.com" }], links: [LINK] });
    expect((await processPortalPasswordRequest(meta.deps, { customerNumber: "10012345", email: "x@meta-online.com" })).outcome).toBe(
      "excluded",
    );
    expect(meta.deps.client.findCustomersByNumber).not.toHaveBeenCalled();

    const salesRep = makeDeps({ customers: [{ ...CUSTOMER, salesRepresentative: true }], employees: [EMPLOYEE], links: [LINK] });
    expect((await processPortalPasswordRequest(salesRep.deps, { customerNumber: "10012345", email: EMPLOYEE.email })).outcome).toBe(
      "excluded",
    );
    expect(salesRep.setEmployeePassword).not.toHaveBeenCalled();
  });

  it("findet den Zugang auch, wenn die Kundennummer in mehreren Verkaufskanälen vorkommt", async () => {
    const { deps, setEmployeePassword } = makeDeps({
      customers: [{ ...CUSTOMER, id: "c-at" }, CUSTOMER],
      employees: [EMPLOYEE],
      links: [LINK],
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result).toMatchObject({ outcome: "sent", customerId: "c1" });
    expect(setEmployeePassword).toHaveBeenCalledTimes(1);
  });
});

describe("buildPortalPasswordMail", () => {
  it("enthält Zugangsdaten, Portal-Link und den Änderungshinweis auf Deutsch und Englisch, HTML maskiert", () => {
    const mail = buildPortalPasswordMail({
      firstName: "<b>Erika</b>",
      lastName: "Muster",
      email: "einkauf@haendler.de",
      customerNumber: "10012345",
      password: "Abcdefgh2345",
      loginUrl: "https://portal.example.test",
    });
    expect(mail.subject).toContain("Händlerportal");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("10012345");
      expect(body).toContain("Abcdefgh2345");
      expect(body).toContain("https://portal.example.test");
      expect(body).toContain("ändern Sie dieses Passwort");
      expect(body).toContain("change this password");
    }
    expect(mail.html).not.toContain("<b>Erika</b>");
    expect(mail.html).toContain("&lt;b&gt;Erika&lt;/b&gt;");
  });
});

describe("generatePortalPassword", () => {
  it("erzeugt 12 Zeichen mit Groß-, Kleinbuchstaben und Ziffern ohne verwechselbare Zeichen", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePortalPassword();
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).not.toMatch(/[0O1lI]/);
    }
  });
});

describe("Ratenbegrenzung", () => {
  beforeEach(() => resetPortalPasswordRateLimitsForTests());

  it("erlaubt pro Zugang eine Anforderung je 15 Minuten", () => {
    const now = 1_000_000;
    expect(rateLimitPortalPasswordAccount("10012345", "a@b.de", now)).toBe(true);
    expect(rateLimitPortalPasswordAccount(" 10012345", "A@B.de ", now + 1000)).toBe(false);
    expect(rateLimitPortalPasswordAccount("10012345", "a@b.de", now + 16 * 60_000)).toBe(true);
  });

  it("begrenzt Anfragen pro IP auf 5 je 15 Minuten", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rateLimitPortalPasswordIp("1.2.3.4", now)).toBe(true);
    expect(rateLimitPortalPasswordIp("1.2.3.4", now)).toBe(false);
    expect(rateLimitPortalPasswordIp("5.6.7.8", now)).toBe(true);
  });
});
