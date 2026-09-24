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
  /**
   * true, wenn eine META-Adresse als EMPFÄNGER im Beleg steht. Bei Kundenbestellungen an
   * META ist das der Normalfall — kein Warnsignal. Für die Frage „ist META hier der
   * Käufer (Lieferanten-AB)?" siehe `buyer_is_meta`.
   */
  recipient_is_meta: boolean;
  /**
   * true, wenn der Käufer (buyer) selbst ein META-Unternehmen ist — also der Beleg eine
   * Lieferanten-Auftragsbestätigung oder interne Bestellung ist. Wird deterministisch
   * nach der Extraktion gesetzt (documentExtractionTranslate.ts), nicht vom Modell.
   */
  buyer_is_meta?: boolean;
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
  /** META-Artikelnummer (bevorzugt EAN 4026212…), siehe Prioritätsregeln im Prompt. */
  supplier_sku: string | null;
  /** Kundeneigene Artikelnummer (aus „Unsere Art.-Nr." o. ä.). */
  buyer_sku: string | null;
  /**
   * Weitere META-seitige Nummern derselben Position (z. B. ERP-/IFS-Nummer „200188545",
   * sechsstellige Kurznummer), die nicht als supplier_sku gewählt wurden.
   */
  alternative_skus?: string[];
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

/**
 * Belegspezifische Pflichtangaben, die später auf Lieferschein, AB und ins DMS gehören.
 * Bewusst eigene Felder statt Freitext in `terms.notes`, damit nachgelagerte Systeme
 * (Lobster/d.3, Lieferschein-Druck) sie ohne Parsen übernehmen können.
 */
export interface DocumentExtractionReferences {
  /** „Nummer beim Kunden", „Kundenreferenz", „Ihre Referenz", Projekt-/Vorgangsnummer des Kunden */
  customer_reference: string | null;
  /** „Kommission", „Kom.", „Kommissionsnummer" */
  commission: string | null;
  /** META-Angebotsnummer, auf die sich die Bestellung bezieht („lt. Angebot 11156331.1", „AN280209") */
  supplier_offer_number?: string | null;
  /** Ansprechpartner am LIEFERORT (nicht der Einkäufer) */
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  delivery_contact_email: string | null;
  /** Anweisungen, die auf dem Lieferschein/bei Anlieferung zu beachten sind */
  delivery_note_instructions: string | null;
  /** Adresse, an die die Auftragsbestätigung gehen soll (falls abweichend vom Absender) */
  order_confirmation_email: string | null;
  /** Adresse, an die die Rechnung gehen soll */
  invoice_email: string | null;
}

export interface DocumentExtraction {
  document: DocumentExtractionDocument;
  buyer: DocumentExtractionBuyer;
  delivery_address: DocumentExtractionDeliveryAddress;
  terms: DocumentExtractionTerms;
  references?: DocumentExtractionReferences;
  line_items: DocumentExtractionLineItem[];
  extraction_meta: DocumentExtractionMeta;
}

export const EMPTY_DOCUMENT_EXTRACTION_REFERENCES: DocumentExtractionReferences = {
  customer_reference: null,
  commission: null,
  supplier_offer_number: null,
  delivery_contact_name: null,
  delivery_contact_phone: null,
  delivery_contact_email: null,
  delivery_note_instructions: null,
  order_confirmation_email: null,
  invoice_email: null,
};
