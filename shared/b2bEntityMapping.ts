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
