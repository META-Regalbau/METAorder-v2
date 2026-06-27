import { ShopwareClient, getRealInvoiceDocument } from "./shopware";
import type { IStorage } from "./storage";
import type { Order } from "@shared/schema";

/**
 * ERP Automation Service
 * 
 * Polls Shopware orders every 3 minutes and triggers automated actions
 * based on CustomField updates from the ERP system:
 * 
 * 1. custom_order_numbers_invoice → Create invoice with ERP number
 * 2. custom_order_numbers_deliveryNo + invoice exists → Set shipped + send invoice
 */
export class ErpAutomationService {
  private storage: IStorage;
  private shopwareClient: ShopwareClient | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // Polling interval: 3 minutes (180000ms)
  private readonly POLL_INTERVAL_MS = 180000;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Start the polling service
   */
  async start(shopwareUrl: string, apiKey: string, apiSecret: string): Promise<void> {
    console.log('[ERP Automation] Starting polling service...');
    
    this.shopwareClient = new ShopwareClient({
      shopwareUrl,
      apiKey,
      apiSecret,
    });

    // Run immediately on start
    await this.processOrders();

    // Then run every 3 minutes
    this.pollingInterval = setInterval(async () => {
      await this.processOrders();
    }, this.POLL_INTERVAL_MS);

    console.log(`[ERP Automation] Polling service started (interval: ${this.POLL_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop the polling service
   */
  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[ERP Automation] Polling service stopped');
    }
  }

  /**
   * Process all orders and trigger automation actions
   */
  private async processOrders(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      console.log('[ERP Automation] Already processing, skipping this run');
      return;
    }

    if (!this.shopwareClient) {
      console.warn('[ERP Automation] Shopware client not initialized, skipping');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    console.log('[ERP Automation] ======= Starting automation run =======');

    try {
      // Fetch all orders from Shopware
      const orders = await this.shopwareClient.fetchOrders();
      console.log(`[ERP Automation] Fetched ${orders.length} orders from Shopware`);

      let processedCount = 0;
      let actionCount = 0;

      // Process each order
      for (const order of orders) {
        try {
          const actions = await this.processOrder(order);
          if (actions > 0) {
            processedCount++;
            actionCount += actions;
          }
        } catch (error) {
          console.error(`[ERP Automation] Error processing order ${order.orderNumber}:`, error);
          // Continue with next order
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[ERP Automation] ======= Run complete: ${processedCount} orders processed, ${actionCount} actions triggered (${duration}ms) =======`);
    } catch (error) {
      console.error('[ERP Automation] Error in polling run:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single order and trigger actions based on CustomFields
   * Returns the number of actions triggered
   */
  private async processOrder(order: Order): Promise<number> {
    if (!this.shopwareClient) {
      return 0;
    }

    let actionsTriggered = 0;

    // Extract ERP CustomFields
    const erpInvoiceNumber = order.customFields?.custom_order_numbers_invoice as string | undefined;
    const erpDeliveryNote = order.customFields?.custom_order_numbers_deliveryNo as string | undefined;
    const erpOrderNumber = order.customFields?.custom_order_numbers_order as string | undefined;

    // ACTION 1: Create invoice when ERP invoice number is set
    if (erpInvoiceNumber) {
      const hasBeenProcessed = await this.hasAutomationRun(order.id, 'invoice_number', 'create_invoice');
      
      if (hasBeenProcessed) {
        console.log(`[ERP Automation] ⊘ Skipping order ${order.orderNumber}: Invoice already processed previously`);
      } else {
        console.log(`[ERP Automation] Triggering invoice creation for order ${order.orderNumber} (ERP Invoice: ${erpInvoiceNumber})`);
        
        try {
          // Create invoice in Shopware
          const { documentId, invoiceNumber } = await this.shopwareClient.createInvoice(
            order.id,
            erpInvoiceNumber,
            erpOrderNumber
          );

          // Log success
          await this.storage.createErpAutomationRun({
            orderId: order.id,
            orderNumber: order.orderNumber,
            trigger: 'invoice_number',
            action: 'create_invoice',
            status: 'success',
            metadata: {
              erpInvoiceNumber,
              erpOrderNumber,
              shopwareInvoiceId: documentId,
            },
          });

          actionsTriggered++;
          console.log(`[ERP Automation] ✓ Invoice created for order ${order.orderNumber}: ${invoiceNumber}`);
        } catch (error) {
          // Log failure
          await this.storage.createErpAutomationRun({
            orderId: order.id,
            orderNumber: order.orderNumber,
            trigger: 'invoice_number',
            action: 'create_invoice',
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            metadata: {
              erpInvoiceNumber,
              erpOrderNumber,
            },
          });

          console.error(`[ERP Automation] ✗ Failed to create invoice for order ${order.orderNumber}:`, error);
        }
      }
    }

    // ACTION 2: Set shipped and send invoice when delivery note is set AND invoice exists
    if (erpDeliveryNote) {
      const hasBeenProcessed = await this.hasAutomationRun(order.id, 'delivery_note', 'set_shipped');
      
      if (hasBeenProcessed) {
        console.log(`[ERP Automation] ⊘ Skipping order ${order.orderNumber}: Shipping already processed previously`);
      } else {
        console.log(`[ERP Automation] Triggering shipping workflow for order ${order.orderNumber} (Delivery Note: ${erpDeliveryNote})`);
        
        try {
          // Check if invoice exists (prefer real invoice over VKRE/PF)
          const documents = await this.shopwareClient.fetchOrderDocuments(order.id);
          const invoice = getRealInvoiceDocument(documents);

          if (!invoice) {
            // Skip: No invoice exists yet
            await this.storage.createErpAutomationRun({
              orderId: order.id,
              orderNumber: order.orderNumber,
              trigger: 'delivery_note',
              action: 'set_shipped',
              status: 'skipped',
              metadata: {
                erpDeliveryNoteNumber: erpDeliveryNote,
                skippedReason: 'No invoice exists for this order yet',
              },
            });

            console.log(`[ERP Automation] ⊘ Skipped shipping workflow for order ${order.orderNumber}: No invoice exists`);
          } else {
            // Set order to shipped
            await this.shopwareClient.setOrderShipped(order.id);

            // Send invoice email
            await this.shopwareClient.sendInvoiceEmail(order.id, invoice.id);

            // Log success
            await this.storage.createErpAutomationRun({
              orderId: order.id,
              orderNumber: order.orderNumber,
              trigger: 'delivery_note',
              action: 'set_shipped',
              status: 'success',
              metadata: {
                erpDeliveryNoteNumber: erpDeliveryNote,
                shopwareInvoiceId: invoice.id,
                emailSent: true,
              },
            });

            actionsTriggered++;
            console.log(`[ERP Automation] ✓ Order ${order.orderNumber} set to shipped and invoice sent`);
          }
        } catch (error) {
          // Log failure
          await this.storage.createErpAutomationRun({
            orderId: order.id,
            orderNumber: order.orderNumber,
            trigger: 'delivery_note',
            action: 'set_shipped',
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : String(error),
            metadata: {
              erpDeliveryNoteNumber: erpDeliveryNote,
            },
          });

          console.error(`[ERP Automation] ✗ Failed to set order ${order.orderNumber} to shipped:`, error);
        }
      }
    }

    return actionsTriggered;
  }

  /**
   * Check if an automation has already run for this order/trigger/action combination
   */
  private async hasAutomationRun(
    orderId: string,
    trigger: string,
    action: string
  ): Promise<boolean> {
    const latestRun = await this.storage.getLatestAutomationRun(orderId, trigger);
    
    if (!latestRun) {
      return false;
    }

    // Check if this specific action was successful or skipped
    return latestRun.action === action && (latestRun.status === 'success' || latestRun.status === 'skipped');
  }

  /**
   * Manual trigger for testing (process all orders immediately)
   */
  async triggerManual(): Promise<void> {
    console.log('[ERP Automation] Manual trigger requested');
    await this.processOrders();
  }
}
