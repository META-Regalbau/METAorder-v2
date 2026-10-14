/**
 * Netto-Listenpreis eines Katalogartikels. `Product.price` ist im Spiegel und in der Shopware-
 * Abfrage der Bruttopreis (priceGross); Entwürfe rechnen und übergeben netto. Bis 14.10.2026 nahm
 * der Katalogabgleich `price` – Angebote aus Entwürfen gingen mit Bruttopreisen als Nettopreise an
 * Shopware (Angebote 1924, 1942).
 */
import type { Product } from "@shared/schema";

export function productNetPrice(product: Pick<Product, "price"> & { netPrice?: unknown; taxRate?: unknown }): number {
  const net = Number(product.netPrice);
  if (Number.isFinite(net) && net > 0) return net;
  const gross = Number(product.price);
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  const tax = Number(product.taxRate);
  return Number.isFinite(tax) && tax > 0 ? Math.round((gross / (1 + tax / 100)) * 100) / 100 : gross;
}
