/**
 * Angebote aus Entwürfen gingen mit Bruttopreisen als Nettopreise an Shopware (Live 13.10.2026,
 * Angebote 1924 und 1942): Der Katalogabgleich übernahm product.price (brutto) als Katalogpreis,
 * der Vorschlagspreis daraus ging als unitPriceNet in die Anlage.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { productNetPrice } from "../../server/products/productNetPrice";
import { repairGrossOfferPrices } from "../../server/commercial/offerDraftCatalogPrices";

describe("Netto-Listenpreis", () => {
  it("netPrice hat Vorrang, sonst brutto durch Steuersatz", () => {
    assert.equal(productNetPrice({ price: 545.02, netPrice: 458, taxRate: 19 }), 458);
    assert.equal(productNetPrice({ price: 545.02, taxRate: 19 }), 458);
    assert.equal(productNetPrice({ price: 100 }), 100);
    assert.equal(productNetPrice({ price: 0 }), 0);
  });
});

describe("Bruttopreise in Angebotsentwürfen korrigieren", () => {
  const listNet: Record<string, number> = { "4026212325843": 458, "4026212325881": 407, "4026212358629": 669 };
  const lookup = (item: { matchedProduct?: { productNumber?: string } | null }) => listNet[item.matchedProduct?.productNumber ?? ""] ?? null;

  it("Angebot 1942: Katalog- und Vorschlagspreis auf netto, Rabatt bleibt", () => {
    const items = [
      { matchedProduct: { productNumber: "4026212325843", catalogPrice: 545.02, suggestedPrice: 534.1196, suggestedDiscount: 2 } },
      { matchedProduct: { productNumber: "4026212325881", catalogPrice: 484.33, suggestedPrice: 460.1135, suggestedDiscount: 5 } },
    ];
    assert.equal(repairGrossOfferPrices(items, lookup), 2);
    assert.deepEqual(items.map((i) => [i.matchedProduct.catalogPrice, i.matchedProduct.suggestedPrice]), [[458, 448.84], [407, 386.65]]);
  });

  it("schon netto, von Hand gesetzter Preis, unbekannter Artikel: unverändert", () => {
    const items = [
      { matchedProduct: { productNumber: "4026212358629", catalogPrice: 669, suggestedPrice: 669 } },
      { matchedProduct: { productNumber: "4026212358629", catalogPrice: 796.11, suggestedPrice: 796.11, manualUnitPriceNet: 700 } },
      { matchedProduct: { productNumber: "unbekannt", catalogPrice: 999, suggestedPrice: 999 } },
      { matchedProduct: null },
    ];
    assert.equal(repairGrossOfferPrices(items, lookup), 0);
    assert.equal(items[1].matchedProduct!.catalogPrice, 796.11);
  });

  it("zweimal ausgeführt: keine weitere Änderung", () => {
    const items = [{ matchedProduct: { productNumber: "4026212358629", catalogPrice: 796.11, suggestedPrice: 796.11, price: 796.11 } }];
    assert.equal(repairGrossOfferPrices(items, lookup), 1);
    assert.equal(repairGrossOfferPrices(items, lookup), 0);
    assert.deepEqual(items[0].matchedProduct, { productNumber: "4026212358629", catalogPrice: 669, suggestedPrice: 669, price: 669 });
  });
});

describe("Netto-Listenpreis ohne geladenen Produkt-Cache", () => {
  it("kommt aus dem Produktspiegel der Datenbank", async () => {
    const { catalogListNetLookup } = await import("../../server/commercial/offerDraftCatalogPrices");
    const items = [{ matchedProduct: { id: "x-1", productNumber: "4026212325843", catalogPrice: 545.02 } }];
    const storage = {
      getShopwareProductMirrorsByNumbers: async (numbers: string[]) =>
        numbers.includes("4026212325843")
          ? [{ active: true, payload: { id: "p1", productNumber: "4026212325843", name: "META CLIP S3 Grundregal", priceGross: 545.02, priceNet: 458 } }]
          : [],
    };
    const lookup = await catalogListNetLookup(items, storage as never, "t1");
    assert.equal(lookup(items[0]), 458);
    assert.equal(repairGrossOfferPrices(items, lookup), 1);
    assert.equal(items[0].matchedProduct.catalogPrice, 458);
  });
});
