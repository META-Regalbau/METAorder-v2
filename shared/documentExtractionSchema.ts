/**
 * Neues, kanonisches Extraktions-Schema für Bestellungen / Angebotsanfragen.
 *
 * Wird vom META-aware System-Prompt gefüllt. Bewusst snake_case, weil das
 * Schema 1:1 dem Prompt-Vertrag entspricht und so leichter validiert werden
 * kann (siehe documentExtractionTranslate.ts für die Brücke ins Legacy-Shape).
 */

export type DocumentExtractionType = "purchase_order" | "quote_request" | "unknown";

export interface DocumentExtractionDocument {
  type: DocumentExtractionType;
  number: string | null;
  date: string | null;
  delivery_date: string | null;
  currency: string;
  total_net: number | null;
  language: "de" | "en" | string;
  recipient_is_meta: boolean;
}

export interface DocumentExtractionBuyer {
  company: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  vat_id: string | null;
  customer_number: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
}

export interface DocumentExtractionDeliveryAddress {
  same_as_buyer: boolean;
  company: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  delivery_window: string | null;
}

export interface DocumentExtractionTerms {
  incoterms: string | null;
  payment: string | null;
  partial_delivery_allowed: boolean | null;
  notes: string | null;
}

export interface DocumentExtractionLineItemAttributes {
  color: string | null;
  surface: string | null;
  dimensions_raw: string | null;
  system: string | null;
}

export interface DocumentExtractionLineItem {
  position: number;
  quantity: number;
  unit: string;
  supplier_sku: string | null;
  buyer_sku: string | null;
  description: string;
  attributes: DocumentExtractionLineItemAttributes;
  unit_price_net: number | null;
  line_total_net: number | null;
  confidence_warnings: string[];
}

export type DocumentExtractionConfidence = "high" | "medium" | "low";

export interface DocumentExtractionMeta {
  overall_confidence: DocumentExtractionConfidence;
  warnings: string[];
  calculated_total_net: number | null;
  total_matches_calculated: boolean | null;
}

export interface DocumentExtraction {
  document: DocumentExtractionDocument;
  buyer: DocumentExtractionBuyer;
  delivery_address: DocumentExtractionDeliveryAddress;
  terms: DocumentExtractionTerms;
  line_items: DocumentExtractionLineItem[];
  extraction_meta: DocumentExtractionMeta;
}
