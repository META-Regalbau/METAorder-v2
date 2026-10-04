// Shopware: Dokumente - Rechnung, Lieferschein, Proforma, Mahnung, PDF-Download/-Upload, Rechnungsversand.
import type { ShopwareClient } from "../shopware";
import type { OrderDocument } from "./types";
import { readEntityTechnicalName, normalizeOrderDocumentType, ZUGFERD_EMBEDDED_INVOICE_TYPE, isProformaOrVorkasse, toShopwareUuid } from "./mapping";
import { randomUUID } from "crypto";

export async function downloadDocumentPdf(this: ShopwareClient, documentId: string, deepLinkCode: string): Promise<Blob> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to download document: ${response.statusText} - ${errorText}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Error downloading document from Shopware:', error);
    throw error;
  }
}

export async function downloadDocumentPdfBuffer(this: ShopwareClient, documentId: string, deepLinkCode: string): Promise<Buffer> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to download document: ${response.statusText} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Error downloading document from Shopware:', error);
    throw error;
  }
}

/**
 * Bestell-Brutto (amountTotal) für eine konkrete Order-Version (Dokument-Snapshot).
 */
export async function fetchOrderAmountTotalForVersion(
  this: ShopwareClient,
  orderId: string,
  orderVersionId: string,
): Promise<number | null> {
  const vid = orderVersionId?.trim();
  if (!vid) return null;
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/order/${orderId}`,
      {
        method: 'GET',
        headers: {
          'Sw-Version-Id': vid,
        },
      },
    );
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const entity = json.data;
    if (!entity) return null;
    const total =
      entity.amountTotal ?? entity.attributes?.amountTotal ?? null;
    if (typeof total === 'number' && Number.isFinite(total)) {
      return Math.round(total * 100) / 100;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Dokumenttyp (technicalName, normalisiert) ueber die documentTypeId, sonst aus dem Praefix der
 * Dokumentnummer (RE-, VKRE, PF, LS-, GS-, ST-).
 */
function documentTypeOf(doc: any, documentTypes: Map<string, string>): string {
  const docNumber = doc.documentNumber || doc.attributes?.documentNumber || '';
  let docType = 'unknown';
  const docTypeId =
    doc.documentTypeId ??
    doc.attributes?.documentTypeId ??
    doc.relationships?.documentType?.data?.id;
  if (docTypeId && documentTypes.has(docTypeId)) {
    docType = documentTypes.get(docTypeId) || 'unknown';
  } else if (docNumber) {
    // Fallback: determine type from document number prefix
    const n = docNumber.trim().toUpperCase();
    if (n.startsWith('RE-')) {
      docType = 'invoice';
    } else if (n.startsWith('VKRE')) {
      docType = 'vorkasse_invoice';
    } else if (n.startsWith('PF')) {
      docType = 'proforma_invoice';
    } else if (n.startsWith('LS-')) {
      docType = 'delivery_note';
    } else if (n.startsWith('GS-')) {
      docType = 'credit_note';
    } else if (n.startsWith('ST-')) {
      docType = 'cancellation';
    }
  }
  return normalizeOrderDocumentType(docType);
}

/**
 * Dokumente (Typ, Nummer, Anlagezeit, verschickt) vieler Bestellungen gebatcht - statt
 * fetchOrderDocuments je Bestellung (dort zusaetzlich Betraege je Dokument-Version). Fuer das
 * Mahnwesen: Rechnungsnummer und -datum, die in der Listen-Abfrage fehlen koennen.
 * Je Bestellung in der Reihenfolge der Shopware-Antwort, wie fetchOrderDocuments.
 */
export async function fetchDocumentsByOrderIds(
  this: ShopwareClient,
  orderIds: string[],
): Promise<Map<string, OrderDocument[]>> {
  const result = new Map<string, OrderDocument[]>();
  const ids = Array.from(new Set((orderIds || []).filter(Boolean)));
  if (ids.length === 0) return result;

  // Alle Dokumenttypen einmalig (wenige Eintraege): id -> technicalName
  const documentTypes = new Map<string, string>();
  const typesResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/document-type`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 100, includes: { document_type: ['id', 'technicalName'] } }),
  });
  if (typesResponse.ok) {
    const typesData = await typesResponse.json();
    for (const item of typesData.data || []) documentTypes.set(item.id, readEntityTechnicalName(item));
  }

  const CHUNK = 200;
  const PAGE_LIMIT = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (let page = 1; ; page++) {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: PAGE_LIMIT,
          page,
          filter: [{ type: 'equalsAny', field: 'orderId', value: chunk }],
          includes: { document: ['id', 'orderId', 'documentTypeId', 'documentNumber', 'createdAt', 'sent'] },
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to retrieve documents: ${response.statusText} - ${errorText}`);
      }
      const documents = (await response.json()).data || [];
      for (const doc of documents) {
        const orderId = doc.orderId ?? doc.attributes?.orderId ?? doc.relationships?.order?.data?.id;
        if (!orderId) continue;
        const list = result.get(orderId) ?? [];
        list.push({
          id: doc.id,
          type: documentTypeOf(doc, documentTypes),
          number: doc.documentNumber || doc.attributes?.documentNumber || '',
          deepLinkCode: '',
          createdAt: doc.createdAt || doc.attributes?.createdAt,
          sent: Boolean(doc.sent ?? doc.attributes?.sent ?? false),
        });
        result.set(orderId, list);
      }
      if (documents.length < PAGE_LIMIT) break;
    }
  }
  return result;
}

export async function fetchOrderDocuments(this: ShopwareClient, orderId: string): Promise<OrderDocument[]> {
  try {
    // List documents for this order; request createdAt explicitly (Admin API document list)
    const docsResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'orderId',
              value: orderId,
            },
          ],
          includes: {
            document: [
              'id',
              'documentTypeId',
              'documentNumber',
              'deepLinkCode',
              'createdAt',
              'orderVersionId',
              'sent',
            ],
            document_type: ['id', 'technicalName'],
          },
          associations: {
            documentType: {},
          },
        }),
      }
    );

    if (!docsResponse.ok) {
      const errorText = await docsResponse.text();
      throw new Error(`Failed to retrieve documents: ${docsResponse.statusText} - ${errorText}`);
    }

    const docsData = await docsResponse.json();
    const documents = docsData.data || [];
    const included = docsData.included || [];

    const documentTypes = new Map<string, string>();
    for (const inc of included) {
      if (inc?.type === "document_type" && inc.id) {
        documentTypes.set(inc.id, readEntityTechnicalName(inc));
      }
    }

    // Collect all unique document type IDs
    const documentTypeIds = new Set<string>();
    for (const doc of documents) {
      const tid =
        doc.documentTypeId ??
        doc.attributes?.documentTypeId ??
        doc.relationships?.documentType?.data?.id;
      if (tid) {
        documentTypeIds.add(tid);
      }
    }

    // Fetch document types in a batch request (JSON:API liefert technicalName oft nur unter attributes)
    if (documentTypeIds.size > 0) {
      const typeFilters = Array.from(documentTypeIds).map(id => ({
        type: 'equals',
        field: 'id',
        value: id,
      }));

      const typesResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'multi',
                operator: 'or',
                queries: typeFilters,
              },
            ],
          }),
        }
      );

      if (typesResponse.ok) {
        const typesData = await typesResponse.json();
        for (const typeItem of typesData.data || []) {
          documentTypes.set(typeItem.id, readEntityTechnicalName(typeItem));
        }
      }
    }

    const typesWithOrderTotal = new Set([
      'invoice',
      'proforma_invoice',
      'vorkasse_invoice',
      'cancellation',
      'credit_note',
    ]);

    const versionAmountCache = new Map<string, number | null>();

    const rows: Array<OrderDocument & { orderVersionId: string | null }> = documents.map((doc: any) => {
      // Extract document number and deep link code from root level (Shopware 6 API)
      const docNumber = doc.documentNumber || doc.attributes?.documentNumber || '';
      // deepLinkCode is directly on the root object in Shopware 6
      const deepLink = doc.deepLinkCode || doc.attributes?.deepLinkCode || '';
      const orderVersionId =
        doc.orderVersionId ?? doc.attributes?.orderVersionId ?? null;

      const docType = documentTypeOf(doc, documentTypes);

      return {
        id: doc.id,
        type: docType,
        number: docNumber,
        deepLinkCode: deepLink,
        createdAt: doc.createdAt || doc.attributes?.createdAt,
        sent: Boolean(doc.sent ?? doc.attributes?.sent ?? false),
        orderVersionId,
      };
    });

    return await Promise.all(
      rows.map(async (row) => {
        const { orderVersionId, ...rest } = row;
        let amountGross: number | null = null;
        if (
          orderVersionId &&
          typeof orderVersionId === 'string' &&
          typesWithOrderTotal.has(rest.type)
        ) {
          if (!versionAmountCache.has(orderVersionId)) {
            versionAmountCache.set(
              orderVersionId,
              await this.fetchOrderAmountTotalForVersion(orderId, orderVersionId),
            );
          }
          amountGross = versionAmountCache.get(orderVersionId) ?? null;
        }
        const out: OrderDocument = { ...rest };
        if (amountGross != null) {
          out.amountGross = amountGross;
        }
        return out;
      }),
    );
  } catch (error) {
    console.error('Error fetching documents from Shopware:', error);
    throw error;
  }
}

export async function downloadInvoicePdf(this: ShopwareClient, orderId: string): Promise<Blob> {
  try {
    // Step 1: Get existing invoice documents for this order
    const docsResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'orderId',
              value: orderId,
            },
            {
              type: 'equalsAny',
              field: 'documentType.technicalName',
              value: ['invoice', ZUGFERD_EMBEDDED_INVOICE_TYPE],
            },
          ],
          limit: 1,
          associations: {
            documentMediaFile: {},
          },
        }),
      }
    );

    if (!docsResponse.ok) {
      const errorText = await docsResponse.text();
      throw new Error(`Failed to retrieve invoice document: ${docsResponse.statusText} - ${errorText}`);
    }

    const docsData = await docsResponse.json();
    if (!docsData.data || docsData.data.length === 0) {
      throw new Error('No invoice document found for this order. Please generate the invoice in Shopware first.');
    }

    const document = docsData.data[0];
    
    const documentId = document.id;
    // The deepLinkCode is in the extensions.foreignKeys object
    const foreignKeys = document.extensions?.foreignKeys;
    const deepLinkCode = foreignKeys?.deepLinkCode;

    console.log('Document ID:', documentId);
    console.log('Deep Link Code:', deepLinkCode);
    console.log('Foreign Keys object:', JSON.stringify(foreignKeys, null, 2));

    if (!documentId || !deepLinkCode) {
      console.error('Missing document fields - documentId:', documentId, 'deepLinkCode:', deepLinkCode);
      throw new Error(`Document ID or deep link code missing - documentId: ${documentId}, deepLinkCode: ${deepLinkCode}`);
    }

    console.log(`Downloading invoice: documentId=${documentId}, deepLinkCode=${deepLinkCode}`);

    // Step 2: Download the PDF using the correct Shopware 6 endpoint
    const downloadResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/pdf',
        },
      }
    );

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      throw new Error(`Failed to download invoice: ${downloadResponse.statusText} - ${errorText}`);
    }

    return await downloadResponse.blob();
  } catch (error) {
    console.error('Error downloading invoice from Shopware:', error);
    throw error;
  }
}

/**
 * Update order document numbers (invoice, delivery note, ERP) in Shopware custom fields
 */
export async function updateOrderDocumentNumbers(
  this: ShopwareClient,
  orderId: string,
  documents: {
    invoiceNumber?: string;
    vorkasseInvoiceNumber?: string;
    deliveryNoteNumber?: string;
    erpNumber?: string;
    proformaNumber?: string;
  }
): Promise<void> {
  try {
    // Build custom fields object
    const customFields: Record<string, any> = {};
    
    if (documents.invoiceNumber !== undefined) {
      customFields.custom_order_numbers_invoice = documents.invoiceNumber;
    }
    
    if (documents.vorkasseInvoiceNumber !== undefined) {
      customFields.custom_order_numbers_vorkasse = documents.vorkasseInvoiceNumber;
    }
    
    if (documents.deliveryNoteNumber !== undefined) {
      customFields.custom_order_numbers_deliveryNo = documents.deliveryNoteNumber;
    }
    
    if (documents.erpNumber !== undefined) {
      customFields.custom_order_numbers_order = documents.erpNumber;
    }
    
    if (documents.proformaNumber !== undefined) {
      customFields.custom_order_proforma_number = documents.proformaNumber;
    }

    // Update order with custom fields
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/order/${orderId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          customFields
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update document numbers: ${response.statusText} - ${errorText}`);
    }

    console.log(`Order ${orderId} document numbers updated in Shopware:`, documents);
  } catch (error) {
    console.error('Error updating order document numbers:', error);
    throw error;
  }
}

/**
 * Mark an existing document as sent / not sent (Shopware document.sent flag).
 * Used e.g. for ERP-imported invoices that exist in the shop but were never
 * dispatched from the shop ("Rechnung vorhanden, aber nicht verschickt").
 */
export async function setDocumentSent(this: ShopwareClient, documentId: string, sent: boolean): Promise<void> {
  const response = await this.makeAuthenticatedRequest(
    `${this.baseUrl}/api/document/${documentId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sent }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to set document ${documentId} sent=${sent}: ${response.statusText} - ${errorText}`
    );
  }
  console.log(`[Shopware API] Document ${documentId} marked sent=${sent}`);
}

/**
 * Check if a document of a specific type already exists for an order
 * Returns: { exists: boolean, documentNumber?: string, documentId?: string, conflict: boolean }
 * For invoice: only "real" invoices count (VKRE/PF are proforma/vorkasse and do not block creating the final invoice).
 */
export async function checkExistingDocument(
  this: ShopwareClient,
  orderId: string,
  documentType: 'invoice' | 'delivery_note',
  requestedNumber?: string
): Promise<{ exists: boolean; documentNumber?: string; documentId?: string; conflict: boolean }> {
  try {
    const documents = await this.fetchOrderDocuments(orderId);

    if (documentType === 'invoice') {
      // Only consider "real" invoices (exclude VKRE/PF proforma/vorkasse)
      const realInvoices = documents.filter(
        doc => (doc.type === 'invoice' || doc.type === 'proforma_invoice' || doc.type === 'vorkasse_invoice') && !isProformaOrVorkasse(doc.number)
      );
      const matching = requestedNumber ? realInvoices.find(d => d.number === requestedNumber) : undefined;
      const anyOtherReal = requestedNumber ? realInvoices.find(d => d.number !== requestedNumber) : undefined;

      return {
        exists: !!matching,
        documentNumber: matching?.number ?? anyOtherReal?.number,
        documentId: matching?.id ?? anyOtherReal?.id,
        conflict: !!requestedNumber && realInvoices.length > 0 && !matching,
      };
    }

    const existingDoc = documents.find(doc => doc.type === documentType);
    if (!existingDoc) {
      return { exists: false, conflict: false };
    }

    const conflict = requestedNumber && existingDoc.number && existingDoc.number !== requestedNumber;
    return {
      exists: true,
      documentNumber: existingDoc.number,
      documentId: existingDoc.id,
      conflict: !!conflict,
    };
  } catch (error: any) {
    console.error(`Error checking existing ${documentType} document:`, error);
    return { exists: false, conflict: false };
  }
}

/**
 * Wait for document PDF generation to complete (polls Shopware API)
 * Shopware uses async message queues for PDF generation
 */
export async function waitForDocumentPdfGeneration(this: ShopwareClient, documentId: string, maxAttempts = 15): Promise<boolean> {
  const pollInterval = 2000; // 2 seconds
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Fetch the document with associations to check if PDF exists
      const docResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/document/${documentId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (docResponse.ok) {
        const docData = await docResponse.json();
        const document = docData.data;
        
        // Check if PDF has been generated (documentMediaFileId exists)
        if (document?.documentMediaFileId) {
          console.log(`[PDF Generation] ✓ PDF generated successfully after ${attempt * 2} seconds`);
          return true;
        }
      }

      // Wait before next attempt
      if (attempt < maxAttempts) {
        console.log(`[PDF Generation] Waiting for PDF generation... (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    } catch (error) {
      console.error(`[PDF Generation] Error checking document status:`, error);
    }
  }

  console.warn(`[PDF Generation] ⚠ PDF generation timeout after ${maxAttempts * 2} seconds. Document created but PDF may still be processing in background.`);
  return false;
}

/**
 * Create an invoice document for an order with ERP invoice number and order number.
 * Mit options.eInvoice wird die Rechnung als ZUGFeRD-PDF (E-Rechnung, Shopware 6.7+)
 * erzeugt; fehlt der Dokumenttyp im Shop, wird die klassische PDF-Rechnung erstellt.
 */
export async function createInvoice(
  this: ShopwareClient,
  orderId: string,
  erpInvoiceNumber?: string,
  erpOrderNumber?: string,
  documentDate?: string,
  sent: boolean = true,
  options: { eInvoice?: boolean } = {}
): Promise<{ documentId: string; invoiceNumber: string; documentType: string; pdfReady: boolean }> {
  try {
    console.log(`[Shopware API] Creating invoice for order ${orderId} with ERP invoice number: ${erpInvoiceNumber}`);

    const wantedTypes = options.eInvoice ? [ZUGFERD_EMBEDDED_INVOICE_TYPE, 'invoice'] : ['invoice'];

    // First, get document type ID for invoice
    const docTypeResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document-type`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equalsAny',
              field: 'technicalName',
              value: wantedTypes,
            },
          ],
        }),
      }
    );

    if (!docTypeResponse.ok) {
      const errorText = await docTypeResponse.text();
      throw new Error(`Failed to get invoice document type: ${docTypeResponse.statusText} - ${errorText}`);
    }

    const docTypeData = await docTypeResponse.json();
    const availableTypes = new Set<string>(
      (docTypeData.data || []).map((item: any) => readEntityTechnicalName(item)),
    );
    const documentType = wantedTypes.find(name => availableTypes.has(name));

    if (!documentType) {
      throw new Error('Invoice document type not found in Shopware');
    }
    if (options.eInvoice && documentType !== ZUGFERD_EMBEDDED_INVOICE_TYPE) {
      console.warn(
        `[Shopware API] Dokumenttyp ${ZUGFERD_EMBEDDED_INVOICE_TYPE} fehlt im Shop (Shopware < 6.7?) – erstelle klassische PDF-Rechnung.`,
      );
    }

    // Create invoice document using Shopware 6 document API
    // Build config object dynamically to avoid sending undefined values
    const config: any = {
      documentNumber: erpInvoiceNumber || undefined,
      // Optional: override the invoice document date (e.g. original ERP/SAP Fakturadatum)
      documentDate: documentDate || undefined,
    };
    
    // Remove undefined values
    Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);
    
    const requestBody: any = {
      orderId,
      fileType: 'pdf',
      static: false,
      referencedDocumentId: null,
      // ERP-Importe koennen als "nicht verschickt" (sent=false) angelegt werden,
      // da der Versand ueber SAP und nicht ueber den Shop erfolgt.
      sent,
    };
    
    // Only add config if it has values
    if (Object.keys(config).length > 0) {
      requestBody.config = config;
    }
    
    console.log('[Shopware API] Creating invoice with request body:', JSON.stringify(requestBody, null, 2));
    
    const createResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order/document/${documentType}/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([requestBody]),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[Shopware API] Invoice creation failed:', {
        status: createResponse.status,
        statusText: createResponse.statusText,
        body: errorText,
      });
      
      // Try to parse Shopware error response to extract meaningful error message
      let errorMessage = errorText;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.errors && errorData.errors.length > 0) {
          // Extract error detail from Shopware API error format
          const firstError = errorData.errors[0];
          errorMessage = firstError.detail || firstError.title || errorText;
        }
      } catch (e) {
        // If not JSON, use raw error text
        errorMessage = errorText;
      }
      
      throw new Error(`Failed to create invoice: ${errorMessage}`);
    }

    const responseText = await createResponse.text();
    console.log('[Shopware API] Invoice creation response:', responseText);
    
    const parsedResponse = JSON.parse(responseText);
    // Shopware liefert je nach Version entweder ein Array [{documentId,...}]
    // oder ein Objekt { data: [{documentId,...}], errors: [] }.
    const createData = Array.isArray(parsedResponse)
      ? parsedResponse[0]
      : Array.isArray(parsedResponse?.data)
        ? parsedResponse.data[0]
        : parsedResponse?.data ?? parsedResponse;
    if (!createData) {
      // Shopware 6.7 meldet Fehler pro Bestellung (z. B. fehlende ZUGFeRD-Pflichtangaben) in "errors".
      const errorsByOrder = parsedResponse?.errors;
      const firstError = Array.isArray(errorsByOrder)
        ? errorsByOrder[0]
        : errorsByOrder && typeof errorsByOrder === 'object'
          ? (Object.values(errorsByOrder).flat()[0] as any)
          : undefined;
      const detail = firstError?.detail || firstError?.title || firstError?.message;
      throw new Error(detail ? String(detail) : 'No document created - Shopware returned empty response');
    }
    const documentId = createData.documentId || createData.id || createData.data?.id;
    const invoiceNumber = createData.documentNumber || erpInvoiceNumber || '';

    console.log(`[Shopware API] Invoice created successfully: ${invoiceNumber} (Document ID: ${documentId})`);

    // Wait for PDF generation to complete (Shopware uses async message queues)
    let pdfReady = false;
    if (documentId) {
      console.log(`[PDF Generation] Waiting for invoice PDF generation...`);
      pdfReady = await this.waitForDocumentPdfGeneration(documentId);
    }

    return {
      documentId,
      invoiceNumber,
      documentType,
      pdfReady,
    };
  } catch (error: any) {
    console.error('Error creating invoice in Shopware:', error);
    throw error;
  }
}

/**
 * Create a delivery note document for an order
 */
export async function createDeliveryNote(
  this: ShopwareClient,
  orderId: string,
  deliveryNoteNumber?: string,
  erpOrderNumber?: string
): Promise<{ documentId: string; deliveryNoteNumber: string }> {
  try {
    console.log(`[Shopware API] Creating delivery note for order ${orderId} with delivery note number: ${deliveryNoteNumber}`);

    // First, get document type ID for delivery_note
    const docTypeResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document-type`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'technicalName',
              value: 'delivery_note',
            },
          ],
        }),
      }
    );

    if (!docTypeResponse.ok) {
      const errorText = await docTypeResponse.text();
      throw new Error(`Failed to get delivery note document type: ${docTypeResponse.statusText} - ${errorText}`);
    }

    const docTypeData = await docTypeResponse.json();
    const deliveryNoteDocType = docTypeData.data?.[0];
    
    if (!deliveryNoteDocType) {
      throw new Error('Delivery note document type not found in Shopware');
    }

    // Create delivery note document using Shopware 6 document API
    // Build config object dynamically to avoid sending undefined values
    const config: any = {
      documentNumber: deliveryNoteNumber || undefined,
    };
    
    // Remove undefined values
    Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);
    
    const requestBody: any = {
      orderId,
      fileType: 'pdf',
      static: false,
      referencedDocumentId: null,
      sent: true,
    };
    
    // Only add config if it has values
    if (Object.keys(config).length > 0) {
      requestBody.config = config;
    }
    
    console.log('[Shopware API] Creating delivery note with request body:', JSON.stringify(requestBody, null, 2));
    
    const createResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order/document/delivery_note/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([requestBody]),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[Shopware API] Delivery note creation failed:', {
        status: createResponse.status,
        statusText: createResponse.statusText,
        body: errorText,
      });
      
      // Try to parse Shopware error response to extract meaningful error message
      let errorMessage = errorText;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.errors && errorData.errors.length > 0) {
          // Extract error detail from Shopware API error format
          const firstError = errorData.errors[0];
          errorMessage = firstError.detail || firstError.title || errorText;
        }
      } catch (e) {
        // If not JSON, use raw error text
        errorMessage = errorText;
      }
      
      throw new Error(`Failed to create delivery note: ${errorMessage}`);
    }

    const responseText = await createResponse.text();
    console.log('[Shopware API] Delivery note creation response:', responseText);
    
    const responseArray = JSON.parse(responseText);
    const [createData] = responseArray;
    if (!createData) {
      throw new Error('No document created - Shopware returned empty response array');
    }
    const documentId = createData.documentId || createData.data?.id;
    const finalDeliveryNoteNumber = createData.documentNumber || deliveryNoteNumber || '';

    console.log(`[Shopware API] Delivery note created successfully: ${finalDeliveryNoteNumber} (Document ID: ${documentId})`);

    // Wait for PDF generation to complete (Shopware uses async message queues)
    if (documentId) {
      console.log(`[PDF Generation] Waiting for delivery note PDF generation...`);
      await this.waitForDocumentPdfGeneration(documentId);
    }

    return {
      documentId,
      deliveryNoteNumber: finalDeliveryNoteNumber,
    };
  } catch (error: any) {
    console.error('Error creating delivery note in Shopware:', error);
    throw error;
  }
}

/**
 * Create a proforma invoice document for an order
 * Uses Shopware's own number range (no documentNumber provided)
 */
export async function createProformaInvoice(
  this: ShopwareClient,
  orderId: string,
  buyerReference?: string,
  customerComment?: string,
  documentNumber?: string
): Promise<{ documentId: string; invoiceNumber: string }> {
  try {
    console.log(`[Shopware API] Creating proforma invoice for order ${orderId}`);

    // First, check if proforma_invoice document type exists in Shopware
    let docTypeTechnicalName = 'proforma_invoice';
    let docTypeResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document-type`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'technicalName',
              value: 'proforma_invoice',
            },
          ],
        }),
      }
    );

    let docTypeData = await docTypeResponse.json();
    let proformaDocType = docTypeData.data?.[0];
    
    // Fallback: If proforma_invoice doesn't exist, use regular invoice
    if (!proformaDocType) {
      console.log('[Shopware API] proforma_invoice document type not found, falling back to invoice');
      docTypeTechnicalName = 'invoice';
      
      docTypeResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'technicalName',
                value: 'invoice',
              },
            ],
          }),
        }
      );
      
      docTypeData = await docTypeResponse.json();
      proformaDocType = docTypeData.data?.[0];
      
      if (!proformaDocType) {
        throw new Error('Invoice document type not found in Shopware');
      }
    }

    // Create proforma invoice document using Shopware 6 document API
    // IMPORTANT: NO documentNumber provided - Shopware will use its own number range
    const config: any = {
      custom: {
        proforma: true, // Mark as proforma for template
      },
    };
    
    // Add additional custom fields
    if (buyerReference) {
      config.custom.buyerReference = buyerReference;
    }
    if (customerComment) {
      config.custom.customerComment = customerComment;
    }
    if (documentNumber) {
      config.documentNumber = documentNumber;
    }
    
    const requestBody: any = {
      orderId,
      fileType: 'pdf',
      static: false,
      referencedDocumentId: null,
      sent: true,
      config,
    };
    
    console.log('[Shopware API] Creating proforma invoice with request body:', JSON.stringify(requestBody, null, 2));
    
    // Use appropriate endpoint based on document type
    const endpoint = docTypeTechnicalName === 'proforma_invoice' 
      ? `${this.baseUrl}/api/_action/order/document/proforma_invoice/create`
      : `${this.baseUrl}/api/_action/order/document/invoice/create`;
    
    const createResponse = await this.makeAuthenticatedRequest(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([requestBody]),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[Shopware API] Proforma invoice creation failed:', {
        status: createResponse.status,
        statusText: createResponse.statusText,
        body: errorText,
      });
      
      // Try to parse Shopware error response
      let errorMessage = errorText;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.errors && errorData.errors.length > 0) {
          const firstError = errorData.errors[0];
          errorMessage = firstError.detail || firstError.title || errorText;
        }
      } catch (e) {
        errorMessage = errorText;
      }
      
      throw new Error(`Failed to create proforma invoice: ${errorMessage}`);
    }

    const responseText = await createResponse.text();
    console.log('[Shopware API] Proforma invoice creation response:', responseText);
    
    const responseJson = JSON.parse(responseText);
    const responseArray = Array.isArray(responseJson)
      ? responseJson
      : Array.isArray(responseJson?.data)
        ? responseJson.data
        : [];
    const [createData] = responseArray;
    if (!createData) {
      throw new Error('No document created - Shopware returned empty response');
    }
    const documentId = createData.documentId || createData.data?.id;
    const invoiceNumber = createData.documentNumber || documentNumber || '';

    console.log(`[Shopware API] Proforma invoice created successfully: ${invoiceNumber} (Document ID: ${documentId})`);

    // Wait for PDF generation to complete
    if (documentId) {
      console.log(`[PDF Generation] Waiting for proforma invoice PDF generation...`);
      await this.waitForDocumentPdfGeneration(documentId);
    }

    return {
      documentId,
      invoiceNumber,
    };
  } catch (error: any) {
    console.error('Error creating proforma invoice in Shopware:', error);
    throw error;
  }
}

/**
 * Create a dunning document for an order
 */
export async function createDunningDocument(
  this: ShopwareClient,
  orderId: string,
  documentTypeTechnicalName: string,
  stage: number
): Promise<{ documentId: string; documentNumber: string }> {
  try {
    console.log(`[Shopware API] Creating dunning document (${documentTypeTechnicalName}) for order ${orderId} (stage ${stage})`);

    const docTypeResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document-type`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: [
            {
              type: 'equals',
              field: 'technicalName',
              value: documentTypeTechnicalName,
            },
          ],
        }),
      }
    );

    if (!docTypeResponse.ok) {
      const errorText = await docTypeResponse.text();
      throw new Error(`Failed to get document type ${documentTypeTechnicalName}: ${docTypeResponse.statusText} - ${errorText}`);
    }

    const docTypeData = await docTypeResponse.json();
    const docType = docTypeData.data?.[0];
    if (!docType) {
      throw new Error(`Document type ${documentTypeTechnicalName} not found in Shopware`);
    }

    const config: any = {
      custom: {
        stage,
      },
    };

    const requestBody: any = {
      orderId,
      fileType: 'pdf',
      static: false,
      referencedDocumentId: null,
      sent: true,
      config,
    };

    console.log('[Shopware API] Creating dunning document with request body:', JSON.stringify(requestBody, null, 2));

    const createResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order/document/${documentTypeTechnicalName}/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([requestBody]),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('[Shopware API] Dunning document creation failed:', {
        status: createResponse.status,
        statusText: createResponse.statusText,
        body: errorText,
      });
      throw new Error(`Failed to create dunning document: ${errorText}`);
    }

    const responseText = await createResponse.text();
    console.log('[Shopware API] Dunning document creation response:', responseText);

    const responseJson = JSON.parse(responseText);
    const responseArray = Array.isArray(responseJson)
      ? responseJson
      : Array.isArray(responseJson?.data)
        ? responseJson.data
        : [];
    const [createData] = responseArray;
    if (!createData) {
      throw new Error('No document created - Shopware returned empty response');
    }

    const documentId = createData.documentId || createData.data?.id;
    const documentNumber = createData.documentNumber || '';

    console.log(`[Shopware API] Dunning document created successfully: ${documentNumber} (Document ID: ${documentId})`);

    if (documentId) {
      console.log(`[PDF Generation] Waiting for dunning document PDF generation...`);
      await this.waitForDocumentPdfGeneration(documentId);
    }

    return {
      documentId,
      documentNumber,
    };
  } catch (error: any) {
    console.error('Error creating dunning document in Shopware:', error);
    throw error;
  }
}

/**
 * Upload a PDF to Shopware media and attach it to an order as document so it appears in the order.
 * Step 1: Create media entity. Step 2: Upload binary. Step 3: Create document linked to order + media.
 */
export async function uploadOrderDocumentPdf(
  this: ShopwareClient,
  orderId: string,
  pdfBuffer: Buffer,
  fileName: string,
  options?: { preferredTechnicalName?: string; documentNumber?: string },
): Promise<{ documentId?: string; documentNumber?: string }> {
  const mediaId = toShopwareUuid(randomUUID());
  console.log(`[Shopware API] uploadOrderDocumentPdf: orderId=${orderId}, fileName=${fileName}, mediaId=${mediaId}`);
  try {
    const mediaPayload: Record<string, unknown> = { id: mediaId };
    const mediaFolderId = await this.getDefaultMediaFolderId();
    if (mediaFolderId) mediaPayload.mediaFolderId = mediaFolderId;

    const createRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mediaPayload),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("[Shopware API] Media create failed:", createRes.status, errText);
      throw new Error(`Failed to create media: ${createRes.statusText} - ${errText}`);
    }
    console.log("[Shopware API] Media entity created");

    const uploadUrl = `${this.baseUrl}/api/_action/media/${mediaId}/upload?extension=pdf&fileName=${encodeURIComponent(fileName)}`;
    const uploadRes = await this.makeAuthenticatedRequest(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBuffer,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[Shopware API] Media upload failed:", uploadRes.status, errText);
      throw new Error(`Failed to upload media: ${uploadRes.statusText} - ${errText}`);
    }
    console.log("[Shopware API] PDF binary uploaded");

    const documentTypeId = await this.getDocumentTypeIdForOrderDocument(
      options?.preferredTechnicalName ?? "dunning",
    );
    if (!documentTypeId) {
      console.warn("[Shopware API] No document type dunning/invoice/delivery_note found, PDF is in Media only");
      return {};
    }
    console.log("[Shopware API] Document type id:", documentTypeId);

    const orderVersionId = await this.getOrderVersionId(orderId);
    console.log("[Shopware API] Order versionId:", orderVersionId ?? "(null)");
    const documentId = toShopwareUuid(randomUUID());
    const deepLinkCode = randomUUID().replace(/-/g, "").slice(0, 32);

    const documentPayload = {
      id: documentId,
      orderId,
      orderVersionId: orderVersionId ?? orderId,
      documentTypeId,
      documentMediaFileId: mediaId,
      config: options?.documentNumber ? { documentNumber: options.documentNumber } : {},
      sent: true,
      static: true,
      deepLinkCode,
    };

    const docRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/document`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(documentPayload),
    });
    if (!docRes.ok) {
      const errText = await docRes.text();
      console.error("[Shopware API] Document create failed:", docRes.status, errText);
      return {};
    }
    console.log("[Shopware API] Document created, documentId=", documentId);
    return {
      documentId,
      documentNumber:
        options?.documentNumber?.trim() || fileName.replace(/\.pdf$/i, ""),
    };
  } catch (error: any) {
    console.error("[Shopware API] uploadOrderDocumentPdf failed:", error?.message || error);
    throw error;
  }
}

export async function getDefaultMediaFolderId(this: ShopwareClient): Promise<string | null> {
  try {
    const res = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/media-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.data?.[0]?.id ?? data?.data?.[0]?.attributes?.id;
    return id ?? null;
  } catch {
    return null;
  }
}

export async function getDocumentTypeIdForOrderDocument(this: ShopwareClient, preferredTechnicalName: string): Promise<string | null> {
  const names = [preferredTechnicalName, "invoice", "delivery_note"].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  for (const name of names) {
    const res = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/document-type`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ type: "equals", field: "technicalName", value: name }],
      }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const id = data?.data?.[0]?.id;
    if (id) return id;
  }
  return null;
}

/**
 * Ermittelt den SalesChannel, aus dem Rechnungsmails versendet werden sollen.
 * Aufloesung: ENV SHOPWARE_INVOICE_SALES_CHANNEL_ID -> Name "META Regalbau DE"
 * -> bekannte Default-ID. Liefert die Entitaet inkl. domains-Association.
 */
export async function getInvoiceSenderSalesChannel(this: ShopwareClient): Promise<any | null> {
  if (this.invoiceSenderChannelCache) return this.invoiceSenderChannelCache;

  const envId = process.env.SHOPWARE_INVOICE_SALES_CHANNEL_ID?.trim();
  const targetName = (process.env.SHOPWARE_INVOICE_SALES_CHANNEL_NAME || 'META Regalbau DE').trim();
  const fallbackId = '018ec134507f703b82a76467791e7e61'; // META Regalbau DE

  const fetchById = async (id: string): Promise<any | null> => {
    const res = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/sales-channel`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: [{ type: 'equals', field: 'id', value: id }],
          associations: { domains: {} },
          limit: 1,
        }),
      },
    );
    if (!res.ok) return null;
    const d = await res.json();
    return d?.data?.[0] ?? null;
  };

  let channel: any | null = null;
  if (envId) channel = await fetchById(envId);

  if (!channel) {
    const res = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/sales-channel`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: [{ type: 'equals', field: 'name', value: targetName }],
          associations: { domains: {} },
          limit: 1,
        }),
      },
    );
    if (res.ok) {
      const d = await res.json();
      channel = d?.data?.[0] ?? null;
    }
  }

  if (!channel) channel = await fetchById(fallbackId);

  if (channel) this.invoiceSenderChannelCache = channel;
  return channel;
}

/**
 * Laedt den fuer den Mailversand noetigen Kontext einer Bestellung:
 * SalesChannel, Sprache und Empfaenger (Kunden-E-Mail/Name) sowie die
 * Order-/SalesChannel-Entitaeten als mailTemplateData fuer das Twig-Rendering.
 *
 * Wichtig: Der Versand erfolgt grundsaetzlich aus dem DE-Channel
 * (META Regalbau DE), nicht aus dem Bestell-Channel. Dadurch ist der Absender
 * immer "META Regalbau DE" (Template-senderName = {{ salesChannel.name }}).
 */
export async function getInvoiceMailContext(this: ShopwareClient, orderId: string): Promise<{
  order: any;
  salesChannel: any;
  salesChannelId: string;
  languageId?: string;
  recipientEmail?: string;
  recipientName?: string;
}> {
  const response = await this.makeAuthenticatedRequest(
    `${this.baseUrl}/api/search/order`,
    {
      method: 'POST',
      body: JSON.stringify({
        filter: [{ type: 'equals', field: 'id', value: orderId }],
        associations: {
          // salutation wird vom Twig-Rechnungstemplate genutzt
          // (order.orderCustomer.salutation.translated.letterName)
          orderCustomer: { associations: { salutation: {} } },
          // domains wird im a11y-Block des Templates referenziert
          // (salesChannel.domains|first.url)
          salesChannel: { associations: { domains: {} } },
          billingAddress: {},
          deliveries: {},
          lineItems: {},
          transactions: {},
          currency: {},
          language: {},
          addresses: {},
        },
        limit: 1,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load order for mail: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const order = data?.data?.[0];
  if (!order) {
    throw new Error(`Order ${orderId} not found while preparing invoice mail`);
  }

  const oc = order.orderCustomer ?? {};
  const recipientEmail: string | undefined = oc.email ?? undefined;
  const recipientName =
    [oc.firstName, oc.lastName].filter(Boolean).join(' ').trim() || recipientEmail;

  // Rechnungsmails werden ausschliesslich aus dem DE-Channel verschickt.
  const senderChannel = await this.getInvoiceSenderSalesChannel();
  const sendSalesChannel = senderChannel ?? order.salesChannel ?? null;
  const sendSalesChannelId = senderChannel?.id ?? order.salesChannelId;
  const sendLanguageId = senderChannel?.languageId ?? order.languageId;

  if (!senderChannel) {
    console.warn(
      '[Shopware API] DE-Versand-SalesChannel (META Regalbau DE) nicht gefunden – ' +
        `falle auf Bestell-Channel ${order.salesChannelId} zurueck.`,
    );
  }

  return {
    // Bestelldaten bleiben aus der echten Bestellung; nur der Absende-Channel
    // wird auf DE gesetzt (mailTemplateData.salesChannel => senderName = DE).
    order,
    salesChannel: sendSalesChannel,
    salesChannelId: sendSalesChannelId,
    languageId: sendLanguageId,
    recipientEmail,
    recipientName,
  };
}

/**
 * Sucht die in Shopware hinterlegte Rechnungs-Mailvorlage (mail_template_type
 * "document_invoice"). Bevorzugt die dem SalesChannel zugewiesene Vorlage,
 * sonst die System-Default-Vorlage. Robuste Fallbacks fuer abweichende
 * technicalNames.
 */
export async function getInvoiceMailTemplate(
  this: ShopwareClient,
  salesChannelId?: string,
  languageId?: string,
): Promise<{
  id?: string;
  subject: string;
  contentHtml: string;
  contentPlain: string;
  senderName: string;
} | null> {
  const extraHeaders: Record<string, string> = {};
  if (languageId) extraHeaders['sw-language-id'] = languageId;

  // Hinweis: mail_template hat in dieser Shopware-Version KEINE "salesChannels"-
  // Association (führt zu 500). Daher nur ueber den mail_template_type selektieren.
  const queryTemplates = async (technicalName: string): Promise<any[]> => {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/mail-template`,
      {
        method: 'POST',
        headers: extraHeaders,
        body: JSON.stringify({
          filter: [
            { type: 'equals', field: 'mailTemplateType.technicalName', value: technicalName },
          ],
          associations: { mailTemplateType: {} },
          limit: 50,
        }),
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `[Shopware API] mail-template lookup (${technicalName}) failed: ${response.status} - ${errorText}`,
      );
      return [];
    }
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data : [];
  };

  // 1) Bekannte technicalNames fuer Rechnungs-Mailvorlagen (versionsabhaengig).
  let templates: any[] = [];
  for (const tn of ['invoice_mail', 'document_invoice']) {
    templates = await queryTemplates(tn);
    if (templates.length > 0) break;
  }

  // 2) Fallback: passenden mail_template_type per Heuristik ermitteln.
  if (templates.length === 0) {
    const typesResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/mail-template-type`,
      { method: 'POST', body: JSON.stringify({ limit: 500 }) }
    );
    if (typesResponse.ok) {
      const typesData = await typesResponse.json();
      const types: any[] = Array.isArray(typesData?.data) ? typesData.data : [];
      const match = types.find((t) => {
        const tn = String(t?.technicalName ?? '').toLowerCase();
        return (
          tn.includes('invoice') &&
          !tn.includes('credit') &&
          !tn.includes('cancel') &&
          !tn.includes('storno')
        );
      });
      if (match?.technicalName) {
        templates = await queryTemplates(match.technicalName);
      }
    }
  }

  if (templates.length === 0) return null;

  // Mehrere Vorlagen gleichen Typs moeglich (z. B. zusaetzliche "Reminder"-Vorlage).
  // Reminder/Mahnungs-Vorlagen aussortieren, damit die echte Rechnungsmail genutzt wird.
  const looksLikeReminder = (tpl: any) => {
    const s = `${tpl?.subject ?? tpl?.translated?.subject ?? ''} ${
        tpl?.name ?? tpl?.translated?.name ?? ''
      }`.toLowerCase();
    return (
      s.includes('reminder') ||
      s.includes('erinner') ||
      s.includes('mahn') ||
      s.includes('payment reminder')
    );
  };

  const preferred = templates.filter((t) => !looksLikeReminder(t));
  const chosen = preferred[0] ?? templates[0];

  const t = chosen.translated ?? {};
  return {
    id: chosen.id,
    subject: chosen.subject ?? t.subject ?? '',
    contentHtml: chosen.contentHtml ?? t.contentHtml ?? '',
    contentPlain: chosen.contentPlain ?? t.contentPlain ?? '',
    senderName: chosen.senderName ?? t.senderName ?? '',
  };
}

/**
 * Verschickt die Rechnung per Mail an den Kunden ueber die native
 * Shopware-Funktion (POST /api/_action/mail-template/send). Das angehaengte
 * Dokument wird als PDF mitgesendet. Die "echte" Markierung document.sent=true
 * erfolgt anschliessend ueber setDocumentSent() im aufrufenden Service.
 */
export async function sendInvoiceEmail(this: ShopwareClient, orderId: string, documentId: string, overrideEmail?: string): Promise<void> {
  try {
    console.log(
      `[Shopware API] Sending invoice email for order ${orderId}, document ${documentId}`,
    );

    const ctx = await this.getInvoiceMailContext(orderId);
    const recipientEmail = overrideEmail?.trim() || ctx.recipientEmail;
    const recipientName = overrideEmail?.trim() ? overrideEmail.trim() : ctx.recipientName;
    if (!recipientEmail) {
      throw new Error(`Keine Kunden-E-Mail fuer Bestellung ${orderId} gefunden`);
    }
    if (!ctx.salesChannelId) {
      throw new Error(`Bestellung ${orderId} hat keinen SalesChannel`);
    }

    const template = await this.getInvoiceMailTemplate(ctx.salesChannelId, ctx.languageId);
    if (!template) {
      throw new Error(
        'Keine Rechnungs-Mailvorlage (mail_template_type "invoice_mail"/"document_invoice") in Shopware gefunden. ' +
          'Bitte in Shopware unter Einstellungen → E-Mail-Vorlagen eine Rechnungsvorlage anlegen.',
      );
    }

    const extraHeaders: Record<string, string> = {};
    if (ctx.languageId) extraHeaders['sw-language-id'] = ctx.languageId;

    // Absenderadresse fuer Rechnungsmails fix auf shop@meta-online.com
    // (ueberschreibt die SalesChannel-Adresse; Absendername bleibt via Template
    // {{ salesChannel.name }} = "META Regalbau DE"). Per ENV ueberschreibbar.
    const senderEmail =
      process.env.SHOPWARE_INVOICE_SENDER_EMAIL?.trim() || 'shop@meta-online.com';

    const payload: Record<string, unknown> = {
      recipients: { [recipientEmail]: recipientName ?? recipientEmail },
      senderEmail,
      salesChannelId: ctx.salesChannelId,
      contentHtml: template.contentHtml,
      contentPlain: template.contentPlain,
      subject: template.subject,
      senderName: template.senderName,
      mediaIds: [],
      documentIds: [documentId],
      mailTemplateData: {
        order: ctx.order,
        salesChannel: ctx.salesChannel,
        // a11yDocuments wird vom Rechnungstemplate referenziert
        // ({% if a11yDocuments %}/{% for a11y in a11yDocuments %}). Fehlt die
        // Variable, scheitert das Twig-Rendering und Shopware liefert size:0
        // zurueck (Mail wird NICHT erzeugt/versendet, ohne Fehlerstatus).
        a11yDocuments: [],
      },
    };
    if (template.id) payload.templateId = template.id;

    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/mail-template/send`,
      {
        method: 'POST',
        headers: extraHeaders,
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send invoice email: ${response.statusText} - ${errorText}`);
    }

    // Shopware antwortet mit { size: <Laenge des erzeugten Mailbodys> }.
    // size === 0 bedeutet: das Twig-Rendering ist fehlgeschlagen und es wurde
    // KEINE Mail erzeugt/versendet (z. B. fehlende Template-Variablen). Das
    // muss als Fehler behandelt werden, sonst entsteht ein False-Positive.
    let mailSize: number | null = null;
    try {
      const result = await response.json();
      if (result && typeof result.size === 'number') mailSize = result.size;
    } catch {
      // Body nicht parsebar -> size unbekannt, weiter unten als Fehler behandeln.
    }

    if (mailSize === 0) {
      throw new Error(
        `Shopware hat keine Mail erzeugt (size=0). Das Rendering der Rechnungs-Mailvorlage ` +
          `ist vermutlich fehlgeschlagen (fehlende Template-Variablen/Associations). ` +
          `Es wurde KEINE Mail versendet.`,
      );
    }

    console.log(
      `[Shopware API] Invoice email sent for order ${orderId} from ${senderEmail} to ${recipientEmail} (size=${mailSize ?? 'unbekannt'})`,
    );
  } catch (error) {
    console.error('Error sending invoice email:', error);
    throw error;
  }
}

/**
 * Liest den aktuellen sent-Status eines einzelnen Dokuments direkt aus
 * Shopware (Verifikation nach dem Versand).
 */
export async function getDocumentSentStatus(this: ShopwareClient, documentId: string): Promise<boolean | null> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: [{ type: 'equals', field: 'id', value: documentId }],
          includes: { document: ['id', 'sent'] },
          limit: 1,
        }),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const doc = data?.data?.[0];
    if (!doc) return null;
    const sent = doc.sent ?? doc.attributes?.sent;
    return sent === true;
  } catch (error) {
    console.warn(`[Shopware API] Could not read sent status for document ${documentId}:`, error);
    return null;
  }
}
