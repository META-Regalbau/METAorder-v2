/**
 * Portal-Registrierungen: Plan („was passiert im Shop“) und Ausführung.
 *
 * Der Plan entsteht aus Anmeldedaten, gefundenem Portal-Kunden und vorhandenem Mitarbeiter; er ist
 * rein und testbar. Die Ausführung prüft den Mitarbeiter direkt vor dem Schreiben erneut (jemand
 * könnte ihn inzwischen angelegt oder einem anderen Kunden zugeordnet haben).
 *
 * Wichtig: Ein Mitarbeiter, der schon an einem ANDEREN Kunden hängt, wird nie umgehängt
 * (ensureEmployeeCustomerLink würde seine übrigen Verknüpfungen löschen) – das entscheidet ein Mensch.
 */
import { isOwnOperatorEmail } from "../commercial/draftCustomerEmailResolution";
import type {
  PortalCustomerChange,
  PortalCustomerSnapshot,
  PortalRegistrationBlocker,
  PortalRegistrationData,
  PortalRegistrationEvent,
  PortalRegistrationPlan,
  PortalRegistrationSettings,
} from "@shared/portalRegistrations";
import type { PortalEmployeeInfo, PortalRegistrationShopApi } from "./portalRegistrationShop";

const normId = (id: string | null | undefined) => (id ?? "").replace(/-/g, "").toLowerCase();

export function buildRegistrationPlan(
  data: PortalRegistrationData,
  customer: PortalCustomerSnapshot,
  employee: PortalEmployeeInfo | null,
  settings: Pick<PortalRegistrationSettings, "customerUpdate">,
  /** Vom Bearbeiter abgewählte Änderungen bleiben abgewählt */
  previous?: PortalRegistrationPlan | null,
): PortalRegistrationPlan {
  const blockers: PortalRegistrationBlocker[] = [];
  const email = data.contact.email?.trim().toLowerCase() ?? "";
  if (!email) blockers.push("missing_email");
  else if (isOwnOperatorEmail(email)) blockers.push("internal_email");

  const firstName = data.contact.firstName?.trim() || employee?.firstName?.trim() || "";
  const lastName = data.contact.lastName?.trim() || employee?.lastName?.trim() || "";
  if (!firstName || !lastName) blockers.push("missing_name");

  const linkedHere = Boolean(employee?.customerIds.some((id) => normId(id) === normId(customer.id)));
  if (employee && employee.customerIds.length > 0 && !linkedHere) blockers.push("employee_other_customer");
  if (!customer.salesChannelId) blockers.push("no_sales_channel");

  const wasDeselected = (field: PortalCustomerChange["field"]) =>
    Boolean(previous?.customerChanges.some((c) => c.field === field && !c.apply) && normId(previous?.customerId) === normId(customer.id));
  const changes: PortalCustomerChange[] = [];
  const push = (change: Omit<PortalCustomerChange, "apply">) => changes.push({ ...change, apply: !wasDeselected(change.field) });
  if (!customer.active) push({ field: "active", from: "inaktiv", to: "aktiv" });
  if (customer.platformAccess === false) push({ field: "platformAccess", from: "aus", to: "an" });
  if (settings.customerUpdate === "fill_empty") {
    if (data.vatId && customer.vatIds.length === 0) push({ field: "vatId", from: null, to: data.vatId });
    const phone = data.phone ?? data.contact.phone;
    if (phone && !customer.address.phone && customer.address.id) push({ field: "phone", from: null, to: phone });
  }

  return {
    customerId: customer.id,
    customerNumber: customer.customerNumber,
    company: customer.company,
    salesChannelId: customer.salesChannelId,
    employee: {
      action: employee ? "update" : "create",
      existingId: employee?.id ?? null,
      email,
      firstName,
      lastName,
      salutation: data.contact.salutation,
      phone: data.contact.phone ?? null,
      expertMode: data.expertMode === true ? true : null,
      adminMode: data.adminMode === true ? true : null,
    },
    link: { action: linkedHere ? "update" : "create" },
    customerChanges: changes,
    sendPasswordReset: true,
    blockers,
  };
}

export type ExecutionResult = {
  ok: boolean;
  employeeId: string | null;
  passwordResetSent: boolean;
  events: PortalRegistrationEvent[];
  /** Grund, wenn der Plan nicht mehr gilt oder der Shop einen Fehler meldet */
  error: string | null;
  /** Plan passt nicht mehr (z. B. Mitarbeiter hängt jetzt an einem anderen Kunden) → Prüfung */
  needsReview: boolean;
};

const ev = (type: PortalRegistrationEvent["type"], message: string, userName?: string | null): PortalRegistrationEvent => ({
  at: new Date().toISOString(),
  type,
  message,
  userName: userName ?? null,
});

const CHANGE_LABEL: Record<PortalCustomerChange["field"], string> = {
  active: "Kunde aktiviert",
  platformAccess: "B2B-Plattformzugang freigeschaltet",
  vatId: "USt-IdNr. ergänzt",
  phone: "Telefon ergänzt",
};

export async function executeRegistrationPlan(
  api: PortalRegistrationShopApi,
  plan: PortalRegistrationPlan,
  options: { storefrontUrl: string; userName?: string | null },
): Promise<ExecutionResult> {
  const events: PortalRegistrationEvent[] = [];
  const result = (partial: Partial<ExecutionResult>): ExecutionResult => ({
    ok: false,
    employeeId: null,
    passwordResetSent: false,
    events,
    error: null,
    needsReview: false,
    ...partial,
  });

  if (plan.blockers.length > 0) {
    return result({ needsReview: true, error: `Plan nicht ausführbar: ${plan.blockers.join(", ")}` });
  }
  const customer = await api.getCustomer(plan.customerId);
  if (!customer) return result({ needsReview: true, error: "Kunde nicht mehr im Shop gefunden" });
  if (!customer.salesChannelId) return result({ needsReview: true, error: "Kunde hat keinen Verkaufskanal" });

  // Direkt vor dem Schreiben erneut nachsehen
  const employee = await api.findEmployee(plan.employee.email);
  const linkedHere = Boolean(employee?.customerIds.some((id) => normId(id) === normId(customer.id)));
  if (employee && employee.customerIds.length > 0 && !linkedHere) {
    return result({
      needsReview: true,
      error: `${plan.employee.email} ist bereits Mitarbeiter eines anderen Kunden`,
    });
  }

  let employeeId: string;
  if (employee) {
    await api.updateEmployee(employee.id, {
      firstName: employee.firstName ? undefined : plan.employee.firstName,
      lastName: employee.lastName ? undefined : plan.employee.lastName,
      expertMode: plan.employee.expertMode,
      adminMode: plan.employee.adminMode,
    });
    employeeId = employee.id;
    const extras = [plan.employee.expertMode ? "Expertenmodus an" : null, plan.employee.adminMode ? "Adminmodus an" : null].filter(Boolean);
    events.push(
      ev("employee_updated", `Mitarbeiter ${plan.employee.email} war schon vorhanden${extras.length ? ` – ${extras.join(", ")}` : ""}`, options.userName),
    );
  } else {
    employeeId = await api.createEmployee({
      email: plan.employee.email,
      firstName: plan.employee.firstName,
      lastName: plan.employee.lastName,
      salutation: plan.employee.salutation,
      phone: plan.employee.phone,
      expertMode: plan.employee.expertMode,
      adminMode: plan.employee.adminMode,
    });
    events.push(
      ev(
        "employee_created",
        `Admin-Mitarbeiter ${plan.employee.firstName} ${plan.employee.lastName} <${plan.employee.email}> angelegt` +
          (plan.employee.expertMode ? " (Expertenmodus an)" : ""),
        options.userName,
      ),
    );
  }

  const link = await api.ensureAdminLink(employeeId, customer.id);
  if (link.created) events.push(ev("employee_updated", `Als Administrator mit Kunde ${customer.customerNumber ?? customer.id} verknüpft`, options.userName));

  const apply = plan.customerChanges.filter((c) => c.apply);
  if (apply.length) {
    await api.updateCustomer(customer, {
      active: apply.some((c) => c.field === "active") ? true : undefined,
      platformAccess: apply.some((c) => c.field === "platformAccess") ? true : undefined,
      vatId: apply.find((c) => c.field === "vatId")?.to,
      phone: apply.find((c) => c.field === "phone")?.to,
    });
    events.push(ev("customer_updated", `Kunde ${customer.customerNumber ?? ""}: ${apply.map((c) => CHANGE_LABEL[c.field]).join(", ")}`, options.userName));
  }

  if (!plan.sendPasswordReset) return result({ ok: true, employeeId });
  try {
    await api.requestPasswordReset({ salesChannelId: customer.salesChannelId, email: plan.employee.email, storefrontUrl: options.storefrontUrl });
    events.push(ev("password_reset_sent", `Passwort-Mail an ${plan.employee.email} ausgelöst (Link 2 Stunden gültig)`, options.userName));
    return result({ ok: true, employeeId, passwordResetSent: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.push(ev("password_reset_failed", `Passwort-Mail nicht ausgelöst: ${message.slice(0, 300)}`, options.userName));
    return result({ ok: false, employeeId, error: `Passwort-Mail nicht ausgelöst: ${message.slice(0, 300)}` });
  }
}
