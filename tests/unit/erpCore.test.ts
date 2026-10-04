/**
 * ERP-Kern-Tests: Logik, Tenant-Pflicht, DATEV-Sanitizing, Bestandsbuchung, Sicherheitsregeln.
 * Ausführung: npx tsx scripts/testErpCore.ts  bzw. npm run test:erp
 */

import {
  applyPickedQuantityDelta,
  applyStockMovementBalance,
  assertPaymentWithinOpen,
  aggregateStockForProduct,
  availableQuantity,
  buildDatevRow,
  isBelowReorder,
  isSafeUploadBasename,
  mergeErpPermissions,
  mrpShortfall,
  nextOpenAmount,
  pickStockStatus,
  requireTenantId,
  sanitizeDatevField,
  shouldBookProductionReceipt,
  shouldRestockOnReturnStatus,
} from "../server/erp/erpLogic";
import { isOrderEligibleForShippingPick } from "../shared/orderShippingEligibility";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  const msg = message ?? `Expected ${String(expected)}, got ${String(actual)}`;
  assert(actual === expected, msg);
}

function assertThrows(fn: () => void, expectedMessage: string) {
  try {
    fn();
    throw new Error(`expected throw: ${expectedMessage}`);
  } catch (e: any) {
    assertEqual(e.message, expectedMessage, `throw message for ${expectedMessage}`);
  }
}

console.log("=== ERP Core Tests ===\n");

// Tenant Pflicht
try {
  requireTenantId(null);
  throw new Error("should have thrown");
} catch (e: any) {
  assertEqual(e.message, "TENANT_REQUIRED", "null tenant");
}
try {
  requireTenantId("  ");
  throw new Error("should have thrown");
} catch (e: any) {
  assertEqual(e.message, "TENANT_REQUIRED", "blank tenant");
}
assertEqual(requireTenantId("tenant-a"), "tenant-a", "valid tenant");
console.log("  requireTenantId: OK");

// Bestand / Reorder
assertEqual(availableQuantity(10, 3), 7);
assert(isBelowReorder(5, 2, 4) === true, "below reorder");
assert(isBelowReorder(10, 1, 4) === false, "above reorder");
console.log("  stock helpers: OK");

// Bewegungen
{
  const receipt = applyStockMovementBalance({
    currentQty: 10,
    currentReserved: 2,
    quantity: 5,
    movementType: "receipt",
  });
  assertEqual(receipt.quantity, 15);
  assertEqual(receipt.reservedQuantity, 2);

  const issue = applyStockMovementBalance({
    currentQty: 10,
    currentReserved: 2,
    quantity: -3,
    movementType: "issue",
  });
  assertEqual(issue.quantity, 7);

  const reserve = applyStockMovementBalance({
    currentQty: 10,
    currentReserved: 2,
    quantity: 4,
    movementType: "reservation",
  });
  assertEqual(reserve.reservedQuantity, 6);
  assertEqual(reserve.quantity, 10);

  const release = applyStockMovementBalance({
    currentQty: 10,
    currentReserved: 5,
    quantity: 2,
    movementType: "release",
  });
  assertEqual(release.reservedQuantity, 3);
}
console.log("  applyStockMovementBalance: OK");

// Zahlungen / OP
{
  const paid = nextOpenAmount(100, 100);
  assertEqual(paid.openAmount, 0);
  assertEqual(paid.status, "paid");

  const partial = nextOpenAmount(100, 40);
  assertEqual(partial.openAmount, 60);
  assertEqual(partial.status, "partial");

  const credit = nextOpenAmount(-50, 20);
  assertEqual(credit.openAmount, -30);
  assertEqual(credit.status, "partial");
}
console.log("  nextOpenAmount: OK");

// Überzahlung ablehnen
assertThrows(() => assertPaymentWithinOpen(50, 51), "Payment exceeds open amount");
assertThrows(() => assertPaymentWithinOpen(50, 0), "Payment amount must be positive");
assertPaymentWithinOpen(50, 50);
assertPaymentWithinOpen(-80, 40);
console.log("  assertPaymentWithinOpen: OK");

// Doppelbuchungs-Schutz
assert(shouldRestockOnReturnStatus("approved", "received") === true, "restock ok");
assert(shouldRestockOnReturnStatus("received", "received") === false, "no double restock");
assert(shouldRestockOnReturnStatus("refunded", "received") === false, "no restock after refund");
assert(shouldBookProductionReceipt("in_progress", "completed") === true, "receipt ok");
assert(shouldBookProductionReceipt("completed", "completed") === false, "no double receipt");
console.log("  double-booking guards: OK");

// DATEV CSV Injection
assertEqual(sanitizeDatevField("=CMD()"), "'=CMD()");
assertEqual(sanitizeDatevField("normal;name"), "normal name");
assertEqual(sanitizeDatevField("ok"), "ok");
assertEqual(sanitizeDatevField("+1-555"), "'+1-555");
assertEqual(sanitizeDatevField("@SUM"), "'@SUM");
{
  const row = buildDatevRow({
    amount: 119.5,
    type: "receivable",
    currency: "EUR",
    documentDate: new Date("2026-07-25T12:00:00Z"),
    documentNumber: "=1+1",
    partnerName: "Firma;Evil",
    status: "open",
  });
  assert(row.includes("'=1+1"), "documentNumber sanitized");
  assert(row.includes("Firma Evil"), "semicolon removed");
  assert(!row.includes("Firma;Evil"), "raw semicolon gone");
  assert(row.startsWith("119,50;S;EUR;"), "amount/format");
}
console.log("  DATEV sanitize: OK");

// MRP
assertEqual(mrpShortfall(20, 5), 15);
assertEqual(mrpShortfall(5, 10), 0);
console.log("  mrpShortfall: OK");

// Upload basename safety (Path Traversal)
assert(isSafeUploadBasename("a1b2c3d4-e5f6-7890-abcd-ef1234567890") === true, "uuid ok");
assert(isSafeUploadBasename("../etc/passwd") === false, "traversal blocked");
assert(isSafeUploadBasename("abc") === false, "too short");
assert(isSafeUploadBasename("evil/name") === false, "slash blocked");
assert(isSafeUploadBasename("evil\\name") === false, "backslash blocked");
console.log("  isSafeUploadBasename: OK");

// Permission merge
{
  const merged = mergeErpPermissions({ viewOrders: true }, false);
  assertEqual(merged.viewOrders, true);
  assertEqual(merged.viewInventory, false);
  assertEqual(merged.manageInventory, false);
  const admin = mergeErpPermissions({ viewOrders: true }, true);
  assertEqual(admin.viewInventory, true);
  assertEqual(admin.manageShippingLabels, true);
  const keep = mergeErpPermissions({ viewInventory: true, manageInventory: false }, true);
  assertEqual(keep.viewInventory, true, "existing true kept");
  assertEqual(keep.manageInventory, false, "existing false kept");
}
console.log("  mergeErpPermissions: OK");

assert(isOrderEligibleForShippingPick({ status: "open", paymentStatus: "paid" }) === true, "open+paid ok");
assert(isOrderEligibleForShippingPick({ status: "in_progress", paymentStatus: "authorized" }) === true, "progress+auth ok");
assert(isOrderEligibleForShippingPick({ status: "open", paymentStatus: "open" }) === false, "unpaid blocked");
assert(isOrderEligibleForShippingPick({ status: "completed", paymentStatus: "paid" }) === false, "completed blocked");
console.log("  isOrderEligibleForShippingPick: OK");

{
  assertEqual(applyPickedQuantityDelta(0, 5, 1).next, 1);
  assertEqual(applyPickedQuantityDelta(5, 5, 1).next, 5);
  assertEqual(applyPickedQuantityDelta(5, 5, 1).completedLine, true);
  assertEqual(applyPickedQuantityDelta(1, 5, -1).next, 0);
  assertEqual(applyPickedQuantityDelta(0, 5, -1).next, 0);
  console.log("  applyPickedQuantityDelta: OK");
}

{
  assertEqual(pickStockStatus(5, 3), "ok");
  assertEqual(pickStockStatus(2, 5), "short");
  assertEqual(pickStockStatus(0, 1), "out");
  assertEqual(aggregateStockForProduct([{ quantity: 3, reservedQuantity: 1 }, { quantity: 2, reservedQuantity: 0 }]).available, 4);
  console.log("  pickStockStatus: OK");
}

console.log("\n=== All ERP core tests passed ===");
