import { AsyncLocalStorage } from "node:async_hooks";

type TenantContext = {
  tenantId: string | null;
};

const tenantContext = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext(tenantId: string | null, fn: () => void) {
  tenantContext.run({ tenantId }, fn);
}

export function getTenantIdFromContext(): string | null {
  return tenantContext.getStore()?.tenantId ?? null;
}
