export type ShippingLabelRecipient = {
  name?: string;
  company?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
};

export type CreateShippingLabelInput = {
  orderNumber?: string;
  shopwareOrderId?: string;
  carrierCode?: string;
  packageWeightKg?: number;
  packageCount?: number;
  recipient: ShippingLabelRecipient;
  shippingMethodId?: number | string;
  shippingMethodCode?: string;
  senderAddressId?: number | string;
  sandboxMode?: boolean;
};

export type CreateShippingLabelResult = {
  provider: string;
  carrierCode: string;
  trackingNumber: string;
  externalParcelId?: string;
  labelUrl?: string;
  labelPdf: Buffer;
  /** Sendcloud: Thermodrucker vs. Normaldrucker-PDF */
  labelFormat?: "label_printer" | "normal_printer";
  shippingMethodCode?: string;
  rawResponse?: Record<string, unknown>;
};

export type ShippingMethodOption = {
  id: string;
  code?: string;
  name: string;
  carrier?: string;
};

export interface ShippingLabelProvider {
  readonly name: string;
  createLabel(input: CreateShippingLabelInput): Promise<CreateShippingLabelResult>;
  voidLabel(externalParcelId: string): Promise<void>;
  fetchShippingMethods(): Promise<ShippingMethodOption[]>;
  downloadLabelPdf(externalParcelId: string): Promise<Buffer>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
