/**
 * Öffentliche Passwort-Anforderung für das Händlerportal – Unit-Tests.
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processPortalPasswordRequest,
  rateLimitPortalPasswordAccount,
  rateLimitPortalPasswordIp,
  resetPortalPasswordRateLimitsForTests,
  type PortalPasswordRequestDeps,
} from "../../server/b2b/portalPasswordRequest";

type Link = { id: string; employeeId: string; customerId: string; roleId: string | null; admin: boolean; active: boolean };
type Customer = { id: string; customerNumber: string; company: string | null; salesChannelId: string | null; salesRepresentative: boolean };
type Employee = { id: string; email: string; firstName: string; lastName: string; boundSalesChannelId: string | null };

function makeDeps(options: { customers?: Customer[]; employees?: Employee[]; links?: Link[]; recoveryError?: Error }) {
  const requestEmployeePasswordRecovery = vi.fn(async () => {
    if (options.recoveryError) throw options.recoveryError;
  });
  const deps: PortalPasswordRequestDeps = {
    client: {
      findCustomersByNumber: vi.fn(async () => options.customers ?? []),
      findEmployeesByEmail: vi.fn(async () => (options.employees ?? []) as any),
      findEmployeeCustomerLink: vi.fn(
        async (employeeId: string, customerId: string) =>
          options.links?.find((l) => l.employeeId === employeeId && l.customerId === customerId) ?? null,
      ),
      requestEmployeePasswordRecovery,
    },
    storefrontUrl: "https://portal.example.test",
  };
  return { deps, requestEmployeePasswordRecovery };
}

const PORTAL_DE = "sc-portal-de";
const CUSTOMER: Customer = { id: "c1", customerNumber: "10012345", company: "Händler GmbH", salesChannelId: "sc-portal-at", salesRepresentative: false };
const EMPLOYEE: Employee = { id: "e1", email: "einkauf@haendler.de", firstName: "Erika", lastName: "Muster", boundSalesChannelId: PORTAL_DE };
const LINK: Link = { id: "l1", employeeId: "e1", customerId: "c1", roleId: null, admin: true, active: true };

describe("processPortalPasswordRequest", () => {
  it("löst bei passender Kundennummer + E-Mail die Wiederherstellungsmail im gebundenen Kanal aus", async () => {
    const { deps, requestEmployeePasswordRecovery } = makeDeps({ customers: [CUSTOMER], employees: [EMPLOYEE], links: [LINK] });
    const result = await processPortalPasswordRequest(deps, { customerNumber: " 10012345 ", email: " Einkauf@Haendler.de " });
    expect(result).toEqual({ outcome: "sent", employeeId: "e1", customerId: "c1" });
    expect(requestEmployeePasswordRecovery).toHaveBeenCalledWith({
      salesChannelId: PORTAL_DE,
      email: "einkauf@haendler.de",
      storefrontUrl: "https://portal.example.test",
    });
    expect(deps.client.findCustomersByNumber).toHaveBeenCalledWith("10012345");
  });

  it("nimmt den Kanal des Kunden, wenn der Mitarbeiter an keinen gebunden ist", async () => {
    const { deps, requestEmployeePasswordRecovery } = makeDeps({
      customers: [CUSTOMER],
      employees: [{ ...EMPLOYEE, boundSalesChannelId: null }],
      links: [LINK],
    });
    await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(requestEmployeePasswordRecovery).toHaveBeenCalledWith(expect.objectContaining({ salesChannelId: "sc-portal-at" }));
  });

  it("meldet no_sales_channel ohne Kanal und mail_failed bei Shopware-Fehler", async () => {
    const noChannel = makeDeps({
      customers: [{ ...CUSTOMER, salesChannelId: null }],
      employees: [{ ...EMPLOYEE, boundSalesChannelId: null }],
      links: [LINK],
    });
    expect((await processPortalPasswordRequest(noChannel.deps, { customerNumber: "10012345", email: EMPLOYEE.email })).outcome).toBe(
      "no_sales_channel",
    );
    expect(noChannel.requestEmployeePasswordRecovery).not.toHaveBeenCalled();

    const failing = makeDeps({ customers: [CUSTOMER], employees: [EMPLOYEE], links: [LINK], recoveryError: new Error("Shopware 500") });
    expect(await processPortalPasswordRequest(failing.deps, { customerNumber: "10012345", email: EMPLOYEE.email })).toMatchObject({
      outcome: "mail_failed",
      employeeId: "e1",
      error: "Shopware 500",
    });
  });

  it("verschickt nichts, wenn die Kundennummer unbekannt ist", async () => {
    const { deps, requestEmployeePasswordRecovery } = makeDeps({ customers: [], employees: [EMPLOYEE] });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "999", email: EMPLOYEE.email });
    expect(result.outcome).toBe("customer_not_found");
    expect(requestEmployeePasswordRecovery).not.toHaveBeenCalled();
  });

  it("verschickt nichts, wenn die E-Mail zu einem anderen Kunden gehört", async () => {
    const { deps, requestEmployeePasswordRecovery } = makeDeps({
      customers: [CUSTOMER],
      employees: [EMPLOYEE],
      links: [{ ...LINK, customerId: "other" }],
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result.outcome).toBe("not_linked");
    expect(requestEmployeePasswordRecovery).not.toHaveBeenCalled();
  });

  it("verschickt nichts für deaktivierte Zugänge", async () => {
    const { deps, requestEmployeePasswordRecovery } = makeDeps({
      customers: [CUSTOMER],
      employees: [EMPLOYEE],
      links: [{ ...LINK, active: false }],
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result.outcome).toBe("link_inactive");
    expect(requestEmployeePasswordRecovery).not.toHaveBeenCalled();
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
    expect(salesRep.requestEmployeePasswordRecovery).not.toHaveBeenCalled();
  });

  it("findet den Zugang auch, wenn die Kundennummer in mehreren Verkaufskanälen vorkommt", async () => {
    const { deps, requestEmployeePasswordRecovery } = makeDeps({
      customers: [{ ...CUSTOMER, id: "c-at" }, CUSTOMER],
      employees: [EMPLOYEE],
      links: [LINK],
    });
    const result = await processPortalPasswordRequest(deps, { customerNumber: "10012345", email: EMPLOYEE.email });
    expect(result).toMatchObject({ outcome: "sent", customerId: "c1" });
    expect(requestEmployeePasswordRecovery).toHaveBeenCalledTimes(1);
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
