/**
 * Reine ERP-Hilfslogik (ohne DB) — testbar und sicherheitsrelevant.
 */

export function requireTenantId(tenantId: string | null | undefined): string {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error("TENANT_REQUIRED");
  }
  return tenantId.trim();
}

export function availableQuantity(quantity: number, reservedQuantity: number): number {
  return quantity - reservedQuantity;
}

export function isBelowReorder(
  quantity: number,
  reservedQuantity: number,
  reorderPoint: number,
): boolean {
  return availableQuantity(quantity, reservedQuantity) <= reorderPoint;
}

export function nextOpenAmount(currentOpen: number, paymentAmount: number): {
  openAmount: number;
  status: "open" | "partial" | "paid";
} {
  const sign = currentOpen >= 0 ? 1 : -1;
  const remaining = Math.abs(currentOpen) - Math.abs(paymentAmount);
  const openAmount = remaining <= 0.0001 ? 0 : remaining * sign;
  const status = openAmount === 0 ? "paid" : remaining < Math.abs(currentOpen) ? "partial" : "open";
  return { openAmount, status };
}

/** Zahlung darf den offenen Betrag nicht überschreiten. */
export function assertPaymentWithinOpen(currentOpen: number, paymentAmount: number): void {
  if (!(paymentAmount > 0)) {
    throw new Error("Payment amount must be positive");
  }
  if (Math.abs(paymentAmount) - Math.abs(currentOpen) > 0.0001) {
    throw new Error("Payment exceeds open amount");
  }
}

/** Doppelbuchung: Restock nur beim Übergang nach „received“. */
export function shouldRestockOnReturnStatus(previousStatus: string, nextStatus: string): boolean {
  if (nextStatus !== "received") return false;
  return previousStatus !== "received" && previousStatus !== "refunded";
}

/** Doppelbuchung: Fertigware nur einmal beim Abschluss. */
export function shouldBookProductionReceipt(previousStatus: string, nextStatus: string): boolean {
  return nextStatus === "completed" && previousStatus !== "completed";
}

/** CSV-Injection-Schutz für DATEV-Felder (Excel: =, +, -, @, Tab, CR). */
export function sanitizeDatevField(value: string): string {
  const cleaned = String(value ?? "")
    .replace(/[\r\n;]/g, " ")
    .trim();
  if (/^[=+\-@\t]/.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}

export function buildDatevRow(item: {
  amount: number;
  type: string;
  currency?: string | null;
  documentDate?: Date | string | null;
  documentNumber: string;
  partnerName?: string | null;
  partnerId?: string | null;
  status: string;
}): string {
  const sollHaben = item.type === "receivable" ? "S" : "H";
  const dateRaw = item.documentDate ? new Date(item.documentDate) : null;
  const date =
    dateRaw && !Number.isNaN(dateRaw.getTime())
      ? dateRaw.toISOString().slice(0, 10).replace(/-/g, "")
      : "";
  return [
    Math.abs(item.amount).toFixed(2).replace(".", ","),
    sollHaben,
    sanitizeDatevField(item.currency || "EUR"),
    date,
    sanitizeDatevField(item.documentNumber),
    sanitizeDatevField(item.partnerName || item.partnerId || ""),
    item.type === "receivable" ? "1400" : "1600",
    "8400",
    sanitizeDatevField(item.status),
  ].join(";");
}

export function applyStockMovementBalance(args: {
  currentQty: number;
  currentReserved: number;
  quantity: number;
  movementType: string;
}): { quantity: number; reservedQuantity: number } {
  let quantity = args.currentQty;
  let reservedQuantity = args.currentReserved;
  if (args.movementType === "reservation") {
    reservedQuantity = reservedQuantity + Math.abs(args.quantity);
  } else if (args.movementType === "release") {
    reservedQuantity = Math.max(0, reservedQuantity - Math.abs(args.quantity));
  } else {
    quantity = quantity + args.quantity;
  }
  return { quantity, reservedQuantity };
}

export function mrpShortfall(required: number, available: number): number {
  return Math.max(0, required - available);
}

/** Picklisten-Scan: Menge um ±1, Clamp 0…soll. */
export function applyPickedQuantityDelta(
  current: number,
  quantity: number,
  delta: 1 | -1 = 1,
): { next: number; completedLine: boolean } {
  const cur = Number.isFinite(current) ? Math.max(0, current) : 0;
  const qty = Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  const next = Math.max(0, Math.min(qty, cur + delta));
  return { next, completedLine: qty > 0 && next >= qty };
}

/** Lagerhinweis für Pick: verfügbar vs. benötigte Menge. */
export type PickStockStatus = "ok" | "short" | "out";

export function pickStockStatus(available: number, needed: number): PickStockStatus {
  const av = Number.isFinite(available) ? available : 0;
  const need = Number.isFinite(needed) ? Math.max(0, needed) : 0;
  if (av <= 0) return "out";
  if (av < need) return "short";
  return "ok";
}

/** Mehrere Lagerort-Zeilen je SKU zu einer Summe zusammenfassen. */
export function aggregateStockForProduct(
  rows: Array<{ quantity: number; reservedQuantity: number }>,
): { quantity: number; reservedQuantity: number; available: number } {
  let quantity = 0;
  let reservedQuantity = 0;
  for (const r of rows) {
    quantity += Number(r.quantity) || 0;
    reservedQuantity += Number(r.reservedQuantity) || 0;
  }
  return {
    quantity,
    reservedQuantity,
    available: availableQuantity(quantity, reservedQuantity),
  };
}

export function isSafeUploadBasename(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id);
}

export const ERP_PERMISSION_DEFAULTS = {
  manageAccounting: false,
  viewInventory: false,
  manageInventory: false,
  viewPurchasing: false,
  managePurchasing: false,
  viewReturns: false,
  manageReturns: false,
  viewProduction: false,
  manageProduction: false,
  manageShippingLabels: false,
} as const;

export function mergeErpPermissions(
  existing: Record<string, boolean> | null | undefined,
  admin = false,
): Record<string, boolean> {
  const base = { ...(existing || {}) };
  for (const [key, def] of Object.entries(ERP_PERMISSION_DEFAULTS)) {
    if (base[key] === undefined) {
      base[key] = admin ? true : def;
    }
  }
  return base;
}
