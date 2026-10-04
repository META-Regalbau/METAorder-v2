// Typen der Shopware-Anbindung (aus server/shopware/shopware.ts ausgelagert).



/** Ein Eintrag im Shopware-Produkt-`price`-Array (inkl. optional regulationPrice). */
export type ShopwarePriceEntry = Record<string, unknown>;

/** Eine Staffel/erweiterter Preis aus `product.prices`. */
export interface ShopwareAdvancedPrice {
  quantityStart: number;
  quantityEnd: number | null;
  gross: number | null;
  net: number | null;
  ruleId: string | null;
  /** Name der Preislisten-Regel (z. B. "Standard Preise Shop"). null = nicht auflösbar. */
  ruleName: string | null;
}

/** Sichtbarkeit eines Produkts in einem Verkaufskanal (Shopware product_visibility). */
export interface ShopwareChannelVisibility {
  salesChannelId: string;
  /** 30 = sichtbar, 20 = Produktlisten ausgeblendet, 10 = Produktlisten + Suche ausgeblendet. */
  visibility: number;
}

/** Angereicherte Produktzeile für die Produkt-Übersicht. */
export interface ShopwareProductOverview {
  id: string;
  productNumber: string;
  name: string;
  active: boolean | null;
  stock: number | null;
  ean?: string;
  manufacturerNumber?: string;
  manufacturerName?: string;
  priceGross: number;
  priceNet: number;
  /** Netto-Einkaufspreis (purchasePrices). null = kein EK hinterlegt. */
  purchasePriceNet: number | null;
  purchasePriceGross: number | null;
  taxRate: number;
  currency: "EUR";
  /** Zugeordnete Verkaufskanal-IDs (aus visibilities). Namensauflösung im Aufrufer. */
  salesChannelIds: string[];
  /**
   * Sichtbarkeit je Verkaufskanal (Shopware product_visibility.visibility):
   * 30 = sichtbar, 20 = in Produktlisten ausgeblendet, 10 = in Produktlisten und Suche ausgeblendet.
   * Kanäle ohne Eintrag fehlen hier (entspricht 0 / nicht zugewiesen).
   * Optional, weil ältere Spiegel-Payloads das Feld noch nicht enthalten.
   */
  salesChannelVisibilities?: ShopwareChannelVisibility[];
  advancedPrices: ShopwareAdvancedPrice[];
  categories: string[];
  /** Tag-Namen des Produkts (Shopware tags-Association). */
  tags: string[];
  /** Shopware product_delivery_time.id */
  deliveryTimeId: string | null;
  /** Anzeigename der Lieferzeit (Shopware translated.name oder name). */
  deliveryTimeName: string | null;
  deliveryTimeMin: number | null;
  deliveryTimeMax: number | null;
  deliveryTimeUnit: string | null;
  hasDeliveryTime: boolean;
  /** Wiederauffüllzeit in Tagen (Shopware restockTime). */
  restockTime: number | null;
  /** Varianten-Optionen (Größe/Farbe) — bei Child-Varianten gesetzt. */
  options?: Array<{ group: string; option: string }>;
  /** Eigenschaften (Fallback für Größe/Farbe bei einfachen Produkten). */
  properties?: Array<{ groupName: string; optionName: string }>;
  customFields?: Record<string, unknown>;
  /**
   * Aufgelöste Anzeigenamen für Customfield-Werte, die Shopware-Entity-IDs sind
   * (z. B. property_group_option / media → translated.name / Dateiname).
   */
  customFieldsDisplay?: Record<string, string>;
  propertyCount: number;
  parentId: string | null;
  childCount: number | null;
  createdAt?: string;
  updatedAt?: string;
  /** Zeitpunkt der letzten erkannten Preisänderung (aus dem Mirror-Sync). Nur gesetzt, wenn aus dem Spiegel geladen. */
  lastPriceChangeAt?: string | null;
  /**
   * Felder, die für die Anzeige vom Elternprodukt übernommen wurden
   * (Shopware-Vererbung, wenn Variante keine eigenen Werte hat).
   */
  inheritedFields?: string[];
}

export interface ProductPriceResetRow {
  id: string;
  price: ShopwarePriceEntry[];
}

/**
 * Kundenindividueller Preis aus dem "B2Bsellers Suite"-Plugin.
 * Entität: `b2bsellers_customer_price` (ältere Versionen: `b2b_customer_price`).
 */
export interface ShopwareCustomerPrice {
  id: string;
  productId: string | null;
  productNumber: string | null;
  productName: string | null;
  customerId: string | null;
  customerNumber: string | null;
  /** Mengenstaffel von (Stückzahl). */
  from: number | null;
  /** Mengenstaffel bis (Stückzahl). null = unbegrenzt. */
  to: number | null;
  priceNet: number | null;
  pseudoPriceNet: number | null;
  currencyIsoCode: string | null;
  validFrom: string | null;
  validUntil: string | null;
  /** Verkaufskanal des zugehörigen Shopware-Kunden (bound sales channel). */
  salesChannelId?: string | null;
  /** Aufgelöster Verkaufskanal-Name (für die Anzeige). */
  salesChannelName?: string | null;
}

export type EnrichedShopwareCustomerPrice = ShopwareCustomerPrice & {
  /** Listenpreis netto = Shopware purchasePrices (Einkaufspreis). */
  listPriceNet: number | null;
  /** Katalog-Verkaufspreis netto (Shopware price). */
  catalogPriceNet: number | null;
  discountPercent: number | null;
};

export type ProductCrmSellingContext = {
  catalogPriceNet: number | null;
  advancedPrices: ShopwareAdvancedPrice[];
};

export type ProductAdvancedPricingDetails = {
  productId: string;
  productNumber: string;
  name: string;
  priceNet: number;
  priceGross: number;
  /** Listenpreis netto = Shopware purchasePrices (Einkaufspreis). */
  listPriceNet: number | null;
  taxRate: number;
  currency: string;
  maxDiscountPercent: number | null;
  advancedPrices: Array<ShopwareAdvancedPrice & { discountPercent: number | null }>;
};

export type OrderDocument = {
  id: string;
  type: string;
  number: string;
  deepLinkCode: string;
  createdAt?: string;
  /** Shopware document.sent: true wenn das Dokument bereits per Mail verschickt wurde */
  sent?: boolean;
  /** Brutto-Bestellsumme zum Zeitpunkt des Dokuments (über orderVersionId), sofern ermittelbar */
  amountGross?: number | null;
};

export type ParsedProductDeliveryTime = {
  deliveryTimeId: string | null;
  deliveryTimeName: string | null;
  deliveryTimeMin: number | null;
  deliveryTimeMax: number | null;
  deliveryTimeUnit: string | null;
  hasDeliveryTime: boolean;
};
