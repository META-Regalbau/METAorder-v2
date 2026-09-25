/**
 * Zusatzfelder (Custom-Field-Set `wdu_configurator_permissions`) auf der
 * B2Bsellers-Mitarbeiter-Entität: Regalplaner-Berechtigungen je Mitarbeiter.
 */
export const EMPLOYEE_CONFIGURATOR_FIELDS = {
  adminMode: "wdu_allow_admin_mode",
  expertMode: "wdu_allow_expert_mode",
} as const;

export type EmployeeConfiguratorPermissions = {
  adminMode: boolean;
  expertMode: boolean;
};

/** Teilweise gesetzte Berechtigungen in das Shopware-customFields-Objekt übersetzen (nur übergebene Werte). */
export function employeeConfiguratorCustomFields(
  perms: Partial<EmployeeConfiguratorPermissions>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (perms.adminMode !== undefined) out[EMPLOYEE_CONFIGURATOR_FIELDS.adminMode] = perms.adminMode;
  if (perms.expertMode !== undefined) out[EMPLOYEE_CONFIGURATOR_FIELDS.expertMode] = perms.expertMode;
  return out;
}

/**
 * Standardrolle für neue Mitarbeiter, wenn keine gewählt wurde.
 *
 * Nicht einfach die erste Rolle nehmen: Alphabetisch erste Rolle war z. B.
 * „Buchhaltung“ ohne `viewListing` — der Mitarbeiter konnte sich anmelden, lief
 * aber auf jeder Produkt-/Kategorieseite in InsufficientEmployeePermissionException.
 * Bevorzugt wird eine Rolle, die Sortiment sehen und bestellen darf, danach
 * die mit den meisten Rechten; Name nur als letzter Tie-Breaker.
 */
export function pickDefaultEmployeeRole<T extends { id: string; name: string; privileges: string[] }>(
  roles: T[],
): T | null {
  const score = (r: T) =>
    (r.privileges.includes("viewListing") ? 100 : 0) +
    (r.privileges.includes("order") ? 10 : 0) +
    r.privileges.length;
  return (
    [...roles].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))[0] ?? null
  );
}

export type B2BEntityMapping = {
  company: string;
  employee: string;
  employeeRole: string;
  employeePermission: string;
  employeeCustomer: string;
  budget: string;
  budgetEmployee: string;
  customerPrice: string;
  productList: string;
  productListItem: string;
  productListType: string;
  customerProductNumber: string;
  productExplodedView: string;
  productExplodedViewItem: string;
  employeeOrder: string;
};

/** Legacy b2b-* names from early mapping drafts → B2Bsellers Suite Admin-API names. */
const LEGACY_B2B_ENTITY_ALIASES: Record<string, string> = {
  "b2b-offer-customer": "b2bsellers-offer-customer",
  "b2b-employee": "b2bsellers-employee",
  "b2b-employee-role": "b2bsellers-employee-role",
  "b2b-employee-permission": "b2bsellers-employee-permission",
  "b2b-employee-customer": "b2bsellers-employee-customer",
  "b2b-budget": "b2bsellers-budget",
  "b2b-budget-employee": "b2bsellers-budget-employee",
  "b2b-customer-product-number": "b2bsellers-customer-product-number",
  "b2b-product-exploded-view": "b2bsellers-product-exploded-view",
};

export const DEFAULT_B2B_ENTITY_MAPPING: B2BEntityMapping = {
  company: process.env.B2B_ENTITY_COMPANY || "b2bsellers-offer-customer",
  employee: process.env.B2B_ENTITY_EMPLOYEE || "b2bsellers-employee",
  employeeRole: process.env.B2B_ENTITY_EMPLOYEE_ROLE || "b2bsellers-employee-role",
  employeePermission: process.env.B2B_ENTITY_EMPLOYEE_PERMISSION || "b2bsellers-employee-permission",
  employeeCustomer: process.env.B2B_ENTITY_EMPLOYEE_CUSTOMER || "b2bsellers-employee-customer",
  budget: process.env.B2B_ENTITY_BUDGET || "b2bsellers-budget",
  budgetEmployee: process.env.B2B_ENTITY_BUDGET_EMPLOYEE || "b2bsellers-budget-employee",
  customerPrice: process.env.B2B_ENTITY_CUSTOMER_PRICE || "b2bsellers-customer-price",
  productList: process.env.B2B_ENTITY_PRODUCT_LIST || "b2b-product-list",
  productListItem: process.env.B2B_ENTITY_PRODUCT_LIST_ITEM || "b2b-product-list-item",
  productListType: process.env.B2B_ENTITY_PRODUCT_LIST_TYPE || "b2b-product-list-type",
  customerProductNumber: process.env.B2B_ENTITY_CUSTOMER_PRODUCT_NUMBER || "b2bsellers-customer-product-number",
  productExplodedView: process.env.B2B_ENTITY_PRODUCT_EXPLODED_VIEW || "b2bsellers-product-exploded-view",
  productExplodedViewItem: process.env.B2B_ENTITY_PRODUCT_EXPLODED_VIEW_ITEM || "b2b-product-exploded-view-item",
  employeeOrder: process.env.B2B_ENTITY_EMPLOYEE_ORDER || "b2bsellers-order-extension",
};

function normalizeEntityName(name: string): string {
  return LEGACY_B2B_ENTITY_ALIASES[name] ?? name;
}

export function mergeB2BEntityMapping(overrides?: Partial<B2BEntityMapping>): B2BEntityMapping {
  const merged = { ...DEFAULT_B2B_ENTITY_MAPPING, ...overrides };
  return Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [key, normalizeEntityName(value)]),
  ) as B2BEntityMapping;
}
