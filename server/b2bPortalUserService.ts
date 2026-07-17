import type { B2BSellersAdminClient } from "./b2bSellersAdmin";
import type { ShopwareClient } from "./shopware";
import { storage } from "./storage";
import { verifyB2BPortalUser, type PortalUserVerifyResult } from "./b2bPortalUserVerify";

export type B2BPortalUserSettings = {
  sendEmails: boolean;
};

export const DEFAULT_B2B_PORTAL_USER_SETTINGS: B2BPortalUserSettings = {
  sendEmails: false,
};

export async function getB2BPortalUserSettings(): Promise<B2BPortalUserSettings> {
  const stored = (await storage.getSetting("b2b.portalUserSettings")) as Partial<B2BPortalUserSettings> | undefined;
  return {
    ...DEFAULT_B2B_PORTAL_USER_SETTINGS,
    ...(stored && typeof stored.sendEmails === "boolean" ? { sendEmails: stored.sendEmails } : {}),
  };
}

export async function saveB2BPortalUserSettings(settings: B2BPortalUserSettings): Promise<B2BPortalUserSettings> {
  const normalized = {
    sendEmails: Boolean(settings.sendEmails),
  };
  await storage.saveSetting("b2b.portalUserSettings", normalized);
  return normalized;
}

export type { PortalUserVerifyResult } from "./b2bPortalUserVerify";
export { verifyB2BPortalUser } from "./b2bPortalUserVerify";

export type B2BPortalUserType = "company" | "dealer" | "sales_rep";

export type B2BPortalAddress = {
  company?: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
};

export type CreateB2BPortalUserInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  type: B2BPortalUserType;
  isSupervisor?: boolean;
  groupId: string;
  salesChannelId: string;
  address: B2BPortalAddress;
  metaCompanyCustomerId?: string;
  supervisorRoleId?: string;
};

export type CreateB2BPortalUserRowResult = {
  rowNumber?: number;
  firstName: string;
  lastName: string;
  email: string;
  type: B2BPortalUserType;
  isSupervisor: boolean;
  status: "would_create" | "created" | "skipped_duplicate" | "would_update" | "updated" | "error";
  customerId?: string;
  employeeId?: string;
  message?: string;
  verify?: PortalUserVerifyResult;
};

export type CreateB2BPortalUserBatchResult = {
  mode: "apply" | "dry-run";
  totalRows: number;
  created: number;
  wouldCreate: number;
  updated: number;
  wouldUpdate: number;
  skippedDuplicate: number;
  errors: number;
  rows: CreateB2BPortalUserRowResult[];
};

export const DEFAULT_META_ADDRESS: B2BPortalAddress = {
  company: "META",
  street: "Hüstener Straße 58",
  zipCode: "59759",
  city: "Arnsberg",
  country: "DE",
};

const TYPE_ALIASES: Record<string, B2BPortalUserType> = {
  company: "company",
  unternehmen: "company",
  unternehmensaccount: "company",
  "unternehmens-account": "company",
  dealer: "dealer",
  haendler: "dealer",
  händler: "dealer",
  "b2b haendler": "dealer",
  "b2b händler": "dealer",
  "b2b-haendler": "dealer",
  "b2b-händler": "dealer",
  sales_rep: "sales_rep",
  vertrieb: "sales_rep",
  vertriebsmitarbeiter: "sales_rep",
  "vertriebs-mitarbeiter": "sales_rep",
  employee: "sales_rep",
};

export function parsePortalUserType(raw: unknown): B2BPortalUserType | null {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  return TYPE_ALIASES[normalized] ?? null;
}

export function parseSupervisorFlag(raw: unknown): boolean {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return ["ja", "yes", "true", "1", "y", "supervisor"].includes(normalized);
}

function validatePortalUserInput(
  input: CreateB2BPortalUserInput,
  options: { requirePassword: boolean } = { requirePassword: true },
): string | null {
  if (!input.firstName.trim()) return "Vorname fehlt";
  if (!input.lastName.trim()) return "Nachname fehlt";
  if (!input.email.trim()) return "E-Mail fehlt";
  if (options.requirePassword && (!input.password || input.password.length < 6)) {
    return "Passwort muss mindestens 6 Zeichen haben";
  }
  if (input.password && input.password.length > 0 && input.password.length < 6) {
    return "Passwort muss mindestens 6 Zeichen haben";
  }
  if (!input.groupId.trim()) return "Kundengruppe fehlt";
  if (!input.salesChannelId.trim()) return "Verkaufskanal fehlt";
  if (!input.address.street.trim() || !input.address.zipCode.trim() || !input.address.city.trim()) {
    return "Adresse unvollständig";
  }
  if (input.type === "sales_rep" && !input.metaCompanyCustomerId?.trim()) {
    return "META-Firma fehlt für Vertriebsmitarbeiter";
  }
  if (input.type === "sales_rep" && input.isSupervisor && !input.supervisorRoleId?.trim()) {
    return "Supervisor-Rolle fehlt";
  }
  return null;
}

async function resolveAdminEmployeeRoleId(b2bClient: B2BSellersAdminClient): Promise<string | null> {
  const roles = await b2bClient.fetchRoles();
  const adminRole =
    roles.find((role) => /admin|administrator|verwaltung/i.test(role.name)) ??
    roles.find((role) => role.technicalName && /admin/i.test(role.technicalName)) ??
    roles[0];
  return adminRole?.id ?? null;
}

function portalEmployeeLinkCustomerId(input: CreateB2BPortalUserInput, customerId: string): string {
  if (input.type === "sales_rep") {
    return input.metaCompanyCustomerId!.trim();
  }
  return customerId;
}

function customerCustomFieldsForType(type: B2BPortalUserType): Record<string, unknown> | undefined {
  if (type === "sales_rep") {
    return { b2b_sales_representative: true };
  }
  return undefined;
}

async function buildPortalEmployeePayload(
  shopwareClient: ShopwareClient,
  input: CreateB2BPortalUserInput,
  options: { roleId?: string | null },
): Promise<Record<string, unknown>> {
  const [languageId, salutationId] = await Promise.all([
    shopwareClient.getDefaultLanguageId(),
    shopwareClient.getDefaultSalutationId(),
  ]);
  if (!languageId) {
    throw new Error("Standard-Sprache in Shopware nicht gefunden");
  }
  if (!salutationId?.trim()) {
    throw new Error("Standard-Anrede in Shopware nicht gefunden");
  }

  const employeePayload: Record<string, unknown> = {
    email: input.email.trim().toLowerCase(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    languageId,
    salutationId,
    active: true,
  };

  if (options.roleId?.trim()) {
    employeePayload.roleId = options.roleId;
    employeePayload.employeeRoleId = options.roleId;
  }

  return employeePayload;
}

async function resolvePortalEmployeeRoleId(
  b2bClient: B2BSellersAdminClient,
  input: CreateB2BPortalUserInput,
): Promise<string | null> {
  if (input.type === "sales_rep" && input.isSupervisor && input.supervisorRoleId?.trim()) {
    return input.supervisorRoleId.trim();
  }
  if (input.type === "company" || input.type === "dealer") {
    return resolveAdminEmployeeRoleId(b2bClient);
  }
  return null;
}

export type ResolvedPortalCustomer = {
  id: string;
  /** Vertriebsmitarbeiter ohne eigenen Kunden-Datensatz — nur Employee pflegen */
  employeeOnly?: boolean;
};

export async function findPortalCustomerRecord(
  deps: {
    shopwareClient: ShopwareClient;
  },
  email: string,
): Promise<{ id: string } | null> {
  const customer = await deps.shopwareClient.findCustomerByEmail(email.trim().toLowerCase());
  if (!customer) return null;
  const id = String(customer.id || customer.attributes?.id || "");
  return id ? { id } : null;
}

/** Für Updates: Kunde per E-Mail oder bestehender B2B-Mitarbeiter. */
export async function resolveExistingPortalCustomer(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  email: string,
  context?: { type?: B2BPortalUserType; metaCompanyCustomerId?: string },
): Promise<ResolvedPortalCustomer | null> {
  const normalized = email.trim().toLowerCase();
  const customer = await deps.shopwareClient.findCustomerByEmail(normalized);
  if (customer) {
    const id = String(customer.id || customer.attributes?.id || "");
    return id ? { id } : null;
  }

  const employee = await deps.b2bClient.findEmployeeByEmail(normalized);
  if (!employee) return null;

  if (context?.type === "sales_rep") {
    const metaCompanyId = context.metaCompanyCustomerId?.trim();
    if (metaCompanyId) {
      return { id: metaCompanyId, employeeOnly: true };
    }
  }

  const linkedCustomerIds = await deps.b2bClient.findCustomerIdsForEmployee(employee.id);
  for (const customerId of linkedCustomerIds) {
    const snapshot = await deps.shopwareClient.getPortalCustomerById(customerId);
    if (snapshot?.email === normalized) {
      return { id: customerId };
    }
  }

  if (linkedCustomerIds.length > 0) {
    return { id: linkedCustomerIds[0], employeeOnly: context?.type === "sales_rep" };
  }

  return { id: employee.id, employeeOnly: true };
}

async function ensurePortalCustomerRecord(
  deps: {
    shopwareClient: ShopwareClient;
  },
  input: CreateB2BPortalUserInput,
  options: { sendEmails?: boolean },
): Promise<{ id: string; created: boolean }> {
  const existing = await findPortalCustomerRecord(deps, input.email);
  if (existing) {
    return { id: existing.id, created: false };
  }

  const customer = await deps.shopwareClient.createB2BPortalCustomer(
    {
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.address.company,
      groupId: input.groupId,
      salesChannelId: input.salesChannelId,
      customFields: customerCustomFieldsForType(input.type),
      billingAddress: {
        firstName: input.firstName,
        lastName: input.lastName,
        street: input.address.street,
        zipCode: input.address.zipCode,
        city: input.address.city,
        country: input.address.country,
        company: input.address.company,
      },
      active: true,
    },
    { sendEmails: options.sendEmails },
  );

  return { id: customer.id, created: true };
}

function portalCustomerUpdateCustomerId(
  input: CreateB2BPortalUserInput,
  existingCustomer: ResolvedPortalCustomer,
): string {
  if (input.type === "sales_rep") {
    return input.metaCompanyCustomerId?.trim() || existingCustomer.id;
  }
  return existingCustomer.id;
}

function shouldSkipShopwareCustomerUpdate(
  input: CreateB2BPortalUserInput,
  existingCustomer: ResolvedPortalCustomer,
  hasEmployee: boolean,
): boolean {
  if (input.type === "sales_rep") return true;
  if (existingCustomer.employeeOnly) return true;
  if (hasEmployee) return true;
  return false;
}

async function applyPortalCustomerUpdates(
  shopwareClient: ShopwareClient,
  input: CreateB2BPortalUserInput,
  existingCustomer: ResolvedPortalCustomer,
  hasEmployee: boolean,
  sendEmails?: boolean,
): Promise<void> {
  if (shouldSkipShopwareCustomerUpdate(input, existingCustomer, hasEmployee)) {
    return;
  }

  await shopwareClient.updateB2BPortalCustomer(
    existingCustomer.id,
    {
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.address.company,
      groupId: input.groupId,
      salesChannelId: input.salesChannelId,
      customFields: customerCustomFieldsForType(input.type),
      billingAddress: {
        firstName: input.firstName,
        lastName: input.lastName,
        street: input.address.street,
        zipCode: input.address.zipCode,
        city: input.address.city,
        country: input.address.country,
        company: input.address.company,
      },
    },
    { sendEmails },
  );
}

async function syncPortalEmployee(
  b2bClient: B2BSellersAdminClient,
  shopwareClient: ShopwareClient,
  input: CreateB2BPortalUserInput,
  options: { customerId: string; createIfMissing: boolean; sendEmails?: boolean },
): Promise<{ employeeId: string }> {
  const existing = await b2bClient.findEmployeeByEmail(input.email);
  const roleId = await resolvePortalEmployeeRoleId(b2bClient, input);
  const employeePayload = await buildPortalEmployeePayload(shopwareClient, input, { roleId });
  const skipTriggerFlow = !options.sendEmails;

  if (input.type === "sales_rep" && input.isSupervisor && input.supervisorRoleId?.trim()) {
    employeePayload.roleId = input.supervisorRoleId.trim();
    employeePayload.employeeRoleId = input.supervisorRoleId.trim();
  } else if (existing?.roleId) {
    delete employeePayload.roleId;
    delete employeePayload.employeeRoleId;
  }

  if (input.password?.trim()) {
    employeePayload.password = input.password;
  }

  let employeeId: string;
  if (existing) {
    const { email: _email, ...employeeUpdatePayload } = employeePayload;
    await b2bClient.patchEntity("employee", existing.id, employeeUpdatePayload, { skipTriggerFlow });
    employeeId = existing.id;
  } else if (options.createIfMissing) {
    if (!input.password?.trim()) {
      throw new Error("Passwort erforderlich, um fehlenden B2B-Mitarbeiter anzulegen");
    }
    employeePayload.password = input.password;
    const created = await b2bClient.createEntity("employee", employeePayload, { skipTriggerFlow });
    employeeId = created.id;
  } else {
    throw new Error("Kein B2B-Mitarbeiter zu dieser E-Mail gefunden");
  }

  const linkCustomerId = portalEmployeeLinkCustomerId(input, options.customerId);
  await b2bClient.ensureEmployeeCustomerLink(employeeId, linkCustomerId, { skipTriggerFlow });

  return { employeeId };
}

async function runPortalUserVerify(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  input: CreateB2BPortalUserInput,
  options: { customerId?: string; enabled?: boolean },
): Promise<PortalUserVerifyResult | undefined> {
  if (options.enabled === false) return undefined;
  return verifyB2BPortalUser(
    deps,
    { ...input, customerId: options.customerId },
    { testLogin: Boolean(input.password?.trim()) },
  );
}

export async function updateB2BPortalUser(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  input: CreateB2BPortalUserInput,
  existingCustomer: ResolvedPortalCustomer,
  options: { apply: boolean; rowNumber?: number; verifyLogin?: boolean; sendEmails?: boolean },
): Promise<CreateB2BPortalUserRowResult> {
  const baseResult: CreateB2BPortalUserRowResult = {
    rowNumber: options.rowNumber,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    type: input.type,
    isSupervisor: Boolean(input.isSupervisor),
    status: "error",
    customerId: existingCustomer.employeeOnly ? undefined : String(existingCustomer.id),
  };

  const validationError = validatePortalUserInput(input, { requirePassword: false });
  if (validationError) {
    return { ...baseResult, status: "error", message: validationError };
  }

  if (!options.apply) {
    return { ...baseResult, status: "would_update", message: "Würde aktualisiert werden" };
  }

  try {
    const normalizedEmail = input.email.trim().toLowerCase();
    const existingEmployee = await deps.b2bClient.findEmployeeByEmail(normalizedEmail);
    let customerRecord = await findPortalCustomerRecord(deps, input.email);
    let createdMissingCustomer = false;

    if (!customerRecord && input.type !== "sales_rep") {
      if (!input.password?.trim()) {
        return {
          ...baseResult,
          status: "error",
          message:
            "Shopware-Kunde fehlt — Passwort angeben, um den fehlenden Kunden-Datensatz anzulegen (z. B. nach Löschen in Shopware)",
        };
      }
      const ensured = await ensurePortalCustomerRecord(deps, input, { sendEmails: options.sendEmails });
      customerRecord = { id: ensured.id };
      createdMissingCustomer = ensured.created;
    }

    const linkedCustomerId = customerRecord
      ? customerRecord.id
      : portalCustomerUpdateCustomerId(input, existingCustomer);

    const employee = await syncPortalEmployee(deps.b2bClient, deps.shopwareClient, input, {
      customerId: linkedCustomerId,
      createIfMissing: true,
      sendEmails: options.sendEmails,
    });

    if (customerRecord) {
      await applyPortalCustomerUpdates(
        deps.shopwareClient,
        input,
        { id: customerRecord.id },
        Boolean(existingEmployee),
        options.sendEmails,
      );
    }

    const verifyCustomerId =
      customerRecord?.id ||
      (input.type === "sales_rep"
        ? (await findPortalCustomerRecord(deps, input.email))?.id || existingCustomer.id
        : existingCustomer.id);

    const verify = await runPortalUserVerify(deps, input, {
      customerId: verifyCustomerId ? String(verifyCustomerId) : undefined,
      enabled: options.verifyLogin,
    });

    let message = createdMissingCustomer
      ? "Fehlender Shopware-Kunde angelegt und Mitarbeiter aktualisiert"
      : input.type === "sales_rep"
        ? "Mitarbeiter aktualisiert (Vertrieb — Login über B2B-Employee)"
        : existingEmployee
          ? "Mitarbeiter aktualisiert (Kunden-Stammdaten wo möglich)"
          : "Erfolgreich aktualisiert";
    if (verify?.overall === "fail") {
      message = `Aktualisiert, Login-Prüfung fehlgeschlagen: ${verify.login.message || verify.checks.find((c) => c.status === "fail")?.message || "Unbekannt"}`;
    } else if (verify?.overall === "warn") {
      message = "Aktualisiert (Login-Prüfung mit Hinweisen)";
    } else if (verify?.overall === "pass") {
      message = "Aktualisiert und Login geprüft";
    }

    return {
      ...baseResult,
      status: "updated",
      customerId: customerRecord?.id || baseResult.customerId,
      employeeId: employee.employeeId,
      message,
      verify,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...baseResult, status: "error", message };
  }
}

export async function upsertB2BPortalUser(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  input: CreateB2BPortalUserInput,
  options: { apply: boolean; updateExisting: boolean; rowNumber?: number; verifyLogin?: boolean; sendEmails?: boolean },
): Promise<CreateB2BPortalUserRowResult> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const customerRecord = await findPortalCustomerRecord(deps, input.email);
  const existingEmployee = await deps.b2bClient.findEmployeeByEmail(normalizedEmail);

  if (options.updateExisting && (customerRecord || existingEmployee)) {
    const resolved =
      customerRecord != null
        ? { id: customerRecord.id }
        : await resolveExistingPortalCustomer(deps, input.email, {
            type: input.type,
            metaCompanyCustomerId: input.metaCompanyCustomerId,
          });
    if (resolved) {
      return updateB2BPortalUser(deps, input, resolved, options);
    }
  }

  if (customerRecord) {
    const baseResult: CreateB2BPortalUserRowResult = {
      rowNumber: options.rowNumber,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: normalizedEmail,
      type: input.type,
      isSupervisor: Boolean(input.isSupervisor),
      status: "skipped_duplicate",
      customerId: customerRecord.id,
      message: options.updateExisting
        ? "E-Mail ist bereits als Shopware-Kunde vergeben"
        : "E-Mail existiert bereits — „Bestehende Nutzer aktualisieren“ aktivieren",
    };
    return baseResult;
  }

  if (existingEmployee && !options.updateExisting) {
    const baseResult: CreateB2BPortalUserRowResult = {
      rowNumber: options.rowNumber,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: normalizedEmail,
      type: input.type,
      isSupervisor: Boolean(input.isSupervisor),
      status: "error",
      message:
        "B2B-Mitarbeiter existiert bereits in Shopware (z. B. vom ersten Import). „Bestehende Nutzer aktualisieren“ aktivieren und Passwort setzen — oder Mitarbeiter in Shopware löschen.",
    };
    if (!options.apply) {
      return {
        ...baseResult,
        status: "would_update",
        message: "Würde bestehenden Mitarbeiter aktualisieren (Kunde ggf. nachanlegen)",
      };
    }
    return baseResult;
  }

  return createB2BPortalUser(deps, input, options);
}

export async function createB2BPortalUser(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  input: CreateB2BPortalUserInput,
  options: { apply: boolean; rowNumber?: number; verifyLogin?: boolean; sendEmails?: boolean },
): Promise<CreateB2BPortalUserRowResult> {
  const baseResult: CreateB2BPortalUserRowResult = {
    rowNumber: options.rowNumber,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    type: input.type,
    isSupervisor: Boolean(input.isSupervisor),
    status: "error",
  };

  const validationError = validatePortalUserInput(input);
  if (validationError) {
    return { ...baseResult, status: "error", message: validationError };
  }

  const existingCustomer = await findPortalCustomerRecord(deps, input.email);
  if (existingCustomer) {
    return {
      ...baseResult,
      status: "skipped_duplicate",
      customerId: existingCustomer.id,
      message: "E-Mail ist bereits als Shopware-Kunde vergeben",
    };
  }

  if (!options.apply) {
    return { ...baseResult, status: "would_create", message: "Würde angelegt werden" };
  }

  try {
    const customer = await deps.shopwareClient.createB2BPortalCustomer({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.address.company,
      groupId: input.groupId,
      salesChannelId: input.salesChannelId,
      customFields: customerCustomFieldsForType(input.type),
      billingAddress: {
        firstName: input.firstName,
        lastName: input.lastName,
        street: input.address.street,
        zipCode: input.address.zipCode,
        city: input.address.city,
        country: input.address.country,
        company: input.address.company,
      },
      active: true,
    }, { sendEmails: options.sendEmails });

    const employee = await syncPortalEmployee(deps.b2bClient, deps.shopwareClient, input, {
      customerId: customer.id,
      createIfMissing: true,
      sendEmails: options.sendEmails,
    });

    const verify = await runPortalUserVerify(deps, input, {
      customerId: customer.id,
      enabled: options.verifyLogin,
    });

    let message = "Erfolgreich angelegt";
    if (verify?.overall === "fail") {
      message = `Angelegt, Login-Prüfung fehlgeschlagen: ${verify.login.message || verify.checks.find((c) => c.status === "fail")?.message || "Unbekannt"}`;
    } else if (verify?.overall === "warn") {
      message = "Angelegt (Login-Prüfung mit Hinweisen)";
    } else if (verify?.overall === "pass") {
      message = "Angelegt und Login geprüft";
    }

    return {
      ...baseResult,
      status: "created",
      customerId: customer.id,
      employeeId: employee.employeeId,
      message,
      verify,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...baseResult, status: "error", message };
  }
}

export async function createB2BPortalUsersBatch(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  rows: CreateB2BPortalUserInput[],
  options: { apply: boolean; updateExisting?: boolean; verifyLogin?: boolean; sendEmails?: boolean },
): Promise<CreateB2BPortalUserBatchResult> {
  const results: CreateB2BPortalUserRowResult[] = [];
  let created = 0;
  let wouldCreate = 0;
  let updated = 0;
  let wouldUpdate = 0;
  let skippedDuplicate = 0;
  let errors = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const result = await upsertB2BPortalUser(deps, row, {
      apply: options.apply,
      updateExisting: Boolean(options.updateExisting),
      rowNumber: index + 1,
      verifyLogin: options.verifyLogin ?? options.apply,
      sendEmails: options.sendEmails,
    });
    results.push(result);

    if (result.status === "created") created += 1;
    else if (result.status === "would_create") wouldCreate += 1;
    else if (result.status === "updated") updated += 1;
    else if (result.status === "would_update") wouldUpdate += 1;
    else if (result.status === "skipped_duplicate") skippedDuplicate += 1;
    else if (result.status === "error") errors += 1;
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    totalRows: rows.length,
    created,
    wouldCreate,
    updated,
    wouldUpdate,
    skippedDuplicate,
    errors,
    rows: results,
  };
}
