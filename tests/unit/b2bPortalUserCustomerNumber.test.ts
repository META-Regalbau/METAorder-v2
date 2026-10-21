import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  buildPortalUserInputsFromImport,
  parseB2BPortalUserRowsFromBuffer,
} from "../../server/b2b/b2bUserImport";
import { createB2BPortalUser, type CreateB2BPortalUserInput } from "../../server/b2b/b2bPortalUserService";

const PORTAL_CHANNEL = "0190aaaa0000700080000000000000aa";
const SHOP_CHANNEL = "0190bbbb0000700080000000000000bb";

function sheetBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "B2B Nutzer");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function baseInput(overrides: Partial<CreateB2BPortalUserInput> = {}): CreateB2BPortalUserInput {
  return {
    firstName: "Erika",
    lastName: "Musterfrau",
    email: "erika@example.com",
    password: "geheim123",
    type: "company",
    groupId: "group-1",
    salesChannelId: PORTAL_CHANNEL,
    address: { company: "Muster GmbH", street: "Weg 1", zipCode: "59759", city: "Arnsberg", country: "DE" },
    ...overrides,
  };
}

function fakeClients(existingByNumber: Array<{ id: string; email: string | null; salesChannelId: string | null }>) {
  const shopwareClient = {
    findCustomerByEmail: vi.fn(async () => null),
    findCustomersByNumber: vi.fn(async () => existingByNumber),
    createB2BPortalCustomer: vi.fn(async () => ({ id: "new-customer", email: "erika@example.com" })),
    getDefaultLanguageId: vi.fn(async () => "lang-1"),
    getDefaultSalutationId: vi.fn(async () => "sal-1"),
  };
  const b2bClient = {
    findEmployeeByEmail: vi.fn(async () => null),
    createEntity: vi.fn(async () => ({ id: "new-employee" })),
    ensureEmployeeCustomerLink: vi.fn(async () => undefined),
  };
  return { shopwareClient, b2bClient, deps: { shopwareClient, b2bClient } as any };
}

describe("Excel-Import: Kundennummer", () => {
  it("liest die Spalte Kundennummer (auch als Zahl) und gibt sie an die Anlage weiter", () => {
    const parsed = parseB2BPortalUserRowsFromBuffer(
      sheetBuffer([
        ["Vorname", "Nachname", "E-Mail", "Typ", "Supervisor", "Kundennummer"],
        ["Erika", "Musterfrau", "erika@example.com", "Unternehmen", "", 12345],
        ["Hans", "Haendler", "hans@example.com", "Händler", "", ""],
      ]),
    );
    expect(parsed.parseErrors).toEqual([]);
    expect(parsed.rows.map((r) => r.customerNumber)).toEqual(["12345", undefined]);

    const inputs = buildPortalUserInputsFromImport(parsed, {
      password: "geheim123",
      defaultType: "company",
      defaultSupervisor: false,
      groupIdByType: { company: "g1", dealer: "g2", sales_rep: "g3" },
      salesChannelId: PORTAL_CHANNEL,
      address: baseInput().address,
    });
    expect(inputs.map((i) => i.customerNumber)).toEqual(["12345", undefined]);
  });

  it("meldet doppelte Kundennummern in der Datei", () => {
    const parsed = parseB2BPortalUserRowsFromBuffer(
      sheetBuffer([
        ["Vorname", "Nachname", "E-Mail", "Kundennummer"],
        ["Erika", "Musterfrau", "erika@example.com", "12345"],
        ["Hans", "Haendler", "hans@example.com", "12345"],
      ]),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.parseErrors).toEqual([{ rowNumber: 3, message: "Kundennummer ist in der Datei doppelt vorhanden" }]);
  });
});

describe("Anlage mit vorgegebener Kundennummer", () => {
  it("übergibt die Kundennummer an Shopware", async () => {
    const { shopwareClient, deps } = fakeClients([]);
    const result = await createB2BPortalUser(deps, baseInput({ customerNumber: " 12345 " }), {
      apply: true,
      verifyLogin: false,
    });
    expect(result.status).toBe("created");
    expect(shopwareClient.findCustomersByNumber).toHaveBeenCalledWith("12345");
    expect(shopwareClient.createB2BPortalCustomer.mock.calls[0][0]).toMatchObject({ customerNumber: " 12345 " });
  });

  it("ohne Kundennummer wird nicht gesucht (Nummernkreis)", async () => {
    const { shopwareClient, deps } = fakeClients([]);
    const result = await createB2BPortalUser(deps, baseInput(), { apply: true, verifyLogin: false });
    expect(result.status).toBe("created");
    expect(shopwareClient.findCustomersByNumber).not.toHaveBeenCalled();
    expect(shopwareClient.createB2BPortalCustomer.mock.calls[0][0]).toMatchObject({ customerNumber: undefined });
  });

  it("lehnt eine im selben Verkaufskanal vergebene Nummer ab — auch in der Vorschau", async () => {
    const taken = [{ id: "other", email: "andere@example.com", salesChannelId: PORTAL_CHANNEL }];
    for (const apply of [false, true]) {
      const { shopwareClient, deps } = fakeClients(taken);
      const result = await createB2BPortalUser(deps, baseInput({ customerNumber: "12345" }), {
        apply,
        verifyLogin: false,
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("Kundennummer 12345 ist in diesem Verkaufskanal bereits vergeben");
      expect(shopwareClient.createB2BPortalCustomer).not.toHaveBeenCalled();
    }
  });

  it("erlaubt dieselbe Nummer in einem anderen Verkaufskanal (Shop-Konto des Händlers)", async () => {
    const { deps } = fakeClients([{ id: "shop", email: "erika@example.com", salesChannelId: SHOP_CHANNEL }]);
    const result = await createB2BPortalUser(deps, baseInput({ customerNumber: "12345" }), {
      apply: true,
      verifyLogin: false,
    });
    expect(result.status).toBe("created");
  });
});
