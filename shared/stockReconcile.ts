/**
 * Bestandsabgleich ERP <-> Shopware: welche Zeilen als Abweichung gelten. Der Server filtert
 * damit `onlyDiffs`, die Lagerseite den Abgleich-Reiter aus der vollstaendigen Liste - beide gleich.
 */
export function isStockReconcileDiff(row: { delta: number }): boolean {
  return row.delta !== 0;
}
