import type { B2BSellersAdminClient } from "./b2bSellersAdmin";
import type { ShopwareClient } from "./shopware";
import type { B2BPortalUserType, CreateB2BPortalUserInput } from "./b2bPortalUserService";

export type PortalUserVerifyCheckStatus = "pass" | "fail" | "warn" | "skip";

export type PortalUserVerifyCheck = {
  id: string;
  label: string;
  status: PortalUserVerifyCheckStatus;
  message: string;
};

export type PortalUserLoginVerifyResult = {
  attempted: boolean;
  success: boolean;
  message: string;
};

export type PortalUserVerifyResult = {
  email: string;
  type: B2BPortalUserType;
  overall: "pass" | "fail" | "warn";
  checks: PortalUserVerifyCheck[];
  login: PortalUserLoginVerifyResult;
};

function overallFromChecks(checks: PortalUserVerifyCheck[]): "pass" | "fail" | "warn" {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function employeeLinkCustomerId(input: CreateB2BPortalUserInput, customerId: string): string | null {
  if (input.type === "sales_rep") return input.metaCompanyCustomerId?.trim() || null;
  return customerId;
}

export async function verifyB2BPortalUser(
  deps: {
    shopwareClient: ShopwareClient;
    b2bClient: B2BSellersAdminClient;
  },
  input: CreateB2BPortalUserInput & { customerId?: string },
  options: { password?: string; testLogin?: boolean } = {},
): Promise<PortalUserVerifyResult> {
  const email = input.email.trim().toLowerCase();
  const checks: PortalUserVerifyCheck[] = [];
  const password = options.password?.trim() || input.password?.trim() || "";
  const shouldTestLogin = Boolean(options.testLogin && password.length >= 6);
  const employeeEarly = await deps.b2bClient.findEmployeeByEmail(email);

  const customer =
    input.customerId != null
      ? await deps.shopwareClient.getPortalCustomerById(String(input.customerId))
      : await deps.shopwareClient.getPortalCustomerByEmail(email);

  if (!customer) {
    if (input.type === "sales_rep" && employeeEarly) {
      checks.push({
        id: "customer_exists",
        label: "Shopware-Kunde",
        status: "skip",
        message: "Kein eigener Kunden-Datensatz — Vertrieb läuft über B2B-Mitarbeiter",
      });
    } else {
      checks.push({
        id: "customer_exists",
        label: "Shopware-Kunde",
        status: "fail",
        message: "Kein Kunde mit dieser E-Mail gefunden",
      });
      return {
        email,
        type: input.type,
        overall: "fail",
        checks,
        login: { attempted: false, success: false, message: "Login-Test übersprungen (Kunde fehlt)" },
      };
    }
  } else {
    checks.push({
      id: "customer_exists",
      label: "Shopware-Kunde",
      status: "pass",
      message: `Kunde ${customer.id} vorhanden`,
    });

    checks.push({
      id: "customer_active",
      label: "Kunde aktiv",
      status: customer.active ? "pass" : "fail",
      message: customer.active ? "Konto ist aktiv" : "Konto ist deaktiviert",
    });

    checks.push({
      id: "account_type",
      label: "Kontotyp Business",
      status: customer.accountType === "business" ? "pass" : "warn",
      message:
        customer.accountType === "business"
          ? "Business-Konto"
          : `Kontotyp ist „${customer.accountType || "unbekannt"}“ (erwartet: business)`,
    });

    if (input.salesChannelId?.trim()) {
      const matches = customer.salesChannelId === input.salesChannelId.trim();
      checks.push({
        id: "sales_channel",
        label: "Verkaufskanal",
        status: matches ? "pass" : "warn",
        message: matches
          ? "Verkaufskanal stimmt überein"
          : `Kunde: ${customer.salesChannelId || "—"}, erwartet: ${input.salesChannelId} (bei Vertrieb optional)`,
      });
    }

    if (input.groupId?.trim()) {
      const matches = customer.groupId === input.groupId.trim();
      checks.push({
        id: "customer_group",
        label: "Kundengruppe",
        status: matches ? "pass" : "warn",
        message: matches
          ? "Kundengruppe stimmt überein"
          : `Kunde: ${customer.groupId || "—"}, erwartet: ${input.groupId}`,
      });
    }

    if (input.type === "sales_rep") {
      const isSalesRep = Boolean(customer.customFields?.b2b_sales_representative);
      checks.push({
        id: "sales_rep_flag",
        label: "Vertriebsmitarbeiter-Kennzeichnung",
        status: isSalesRep ? "pass" : "warn",
        message: isSalesRep
          ? "Custom Field b2b_sales_representative ist gesetzt"
          : "Custom Field b2b_sales_representative fehlt (Vertriebsportal ggf. eingeschränkt)",
      });
    }
  }

  const employee = employeeEarly;
  if (!employee && input.type === "sales_rep") {
    checks.push({
      id: "employee_exists",
      label: "B2B-Mitarbeiter",
      status: "fail",
      message:
        "Kein B2B-Mitarbeiter — Vertriebs-Supervisor melden sich ausschließlich über Mitarbeiter-Konten an",
    });
  } else if (!employee) {
    checks.push({
      id: "employee_exists",
      label: "B2B-Mitarbeiter",
      status: "fail",
      message:
        "Kein B2B-Mitarbeiter — Login im Portal erfolgt über Mitarbeiter-Konten, nicht über den Firmen-Stammkunden",
    });
  } else {
    checks.push({
      id: "employee_exists",
      label: "B2B-Mitarbeiter",
      status: "pass",
      message: `Mitarbeiter ${employee.id} vorhanden`,
    });
    checks.push({
      id: "employee_active",
      label: "Mitarbeiter aktiv",
      status: employee.active ? "pass" : "fail",
      message: employee.active ? "Mitarbeiter-Konto ist aktiv" : "Mitarbeiter-Konto ist deaktiviert",
    });

    const linkCustomerId = employeeLinkCustomerId(input, customer?.id || input.customerId || "");
    if (linkCustomerId) {
      const linked = await deps.b2bClient.hasEmployeeCustomerLink(employee.id, linkCustomerId);
      checks.push({
        id: "employee_company_link",
        label: "Firmen-Zuordnung",
        status: linked ? "pass" : "fail",
        message: linked
          ? "Mitarbeiter ist der Firma zugeordnet"
          : "Mitarbeiter ist nicht mit der erwarteten Firma verknüpft",
      });
    }
  }

  let login: PortalUserLoginVerifyResult = {
    attempted: false,
    success: false,
    message: shouldTestLogin ? "" : "Passwort fehlt — Login-Test übersprungen",
  };

  if (shouldTestLogin && input.salesChannelId?.trim()) {
    login.attempted = true;
    const loginResult = await deps.shopwareClient.testStorefrontLogin({
      email,
      password,
      salesChannelId: input.salesChannelId.trim(),
    });
    login.success = loginResult.success;
    login.message = loginResult.message;
    checks.push({
      id: "store_login",
      label: "Storefront-Login",
      status: loginResult.success ? "pass" : "fail",
      message: loginResult.message,
    });
  } else if (shouldTestLogin) {
    login = {
      attempted: false,
      success: false,
      message: "Verkaufskanal fehlt — Login-Test übersprungen",
    };
  }

  return {
    email,
    type: input.type,
    overall: overallFromChecks(checks),
    checks,
    login,
  };
}
