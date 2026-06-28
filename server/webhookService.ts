import { randomUUID } from "crypto";
import type { WebhookEventType, InsertWebhookLog } from "@shared/schema";
import { storage } from "./storage";
import crypto from "crypto";
import { getTenantIdFromContext } from "./tenantContext";

// Webhook payload types for different events
export type TicketCreatedPayload = {
  id: string;
  ticketNumber: string;
  title: string;
  priority: string;
  status: string;
  assignedToUserId?: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type TicketUpdatedPayload = {
  id: string;
  ticketNumber: string;
  changes: {
    field: string;
    oldValue?: any;
    newValue?: any;
  }[];
  updatedBy: string;
  updatedAt: string;
};

export type TicketCommentedPayload = {
  ticketId: string;
  ticketNumber: string;
  commentId: string;
  comment: string;
  isInternal: boolean;
  userId: string | null;
  username: string;
  authorType?: "user" | "customer";
  createdAt: string;
};

export type TicketAssignedPayload = {
  ticketId: string;
  ticketNumber: string;
  previousAssignee?: string | null;
  newAssignee: string;
  assignedBy: string;
  assignedAt: string;
};

export type OrderReadyToShipPayload = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  items: {
    productName: string;
    quantity: number;
  }[];
  readyAt: string;
};

export type DocumentCreatedPayload = {
  documentType: "invoice" | "delivery_note" | "proforma_invoice";
  orderId: string;
  orderNumber: string;
  documentNumber: string;
  pdfUrl?: string;
  createdAt: string;
};

/** Outbound n8n / Integration: neuer Angebots- oder Bestellentwurf */
export type CommercialDraftCreatedPayload = {
  draftId: string;
  draftKind: "offer" | "order";
  draftStatus: string;
  intent: string;
  intentConfidence: number;
  overallConfidence: number | null;
  shopwareCustomerId: string | null;
  messageId: string | null;
  source: "email_inbound" | "manual_upload";
  createdAt: string;
};

/** Zusätzlich, wenn der Entwurf zur manuellen Prüfung markiert ist */
export type CommercialDraftReviewRequiredPayload = CommercialDraftCreatedPayload;

export type CommercialAutoOfferCreatedPayload = {
  draftId: string;
  offerId: string;
  messageId: string | null;
  createdAt: string;
};

export type CommercialAutoOrderCreatedPayload = {
  draftId: string;
  orderId: string;
  messageId: string | null;
  createdAt: string;
};

export type B2bApprovalRequiredPayload = {
  referenceId: string;
  referenceType: string;
  customerId?: string | null;
  totalPrice?: number | null;
  createdAt: string;
};

export type B2bApprovalDecidedPayload = {
  referenceId: string;
  referenceType: string;
  decision: "approved" | "rejected";
  actorUserId: string | null;
  decidedAt: string;
};

export type WebhookPayload =
  | TicketCreatedPayload
  | TicketUpdatedPayload
  | TicketCommentedPayload
  | TicketAssignedPayload
  | OrderReadyToShipPayload
  | DocumentCreatedPayload
  | CommercialDraftCreatedPayload
  | CommercialDraftReviewRequiredPayload
  | CommercialAutoOfferCreatedPayload
  | CommercialAutoOrderCreatedPayload
  | B2bApprovalRequiredPayload
  | B2bApprovalDecidedPayload;

// In-memory cache for webhook configs (60 second TTL), pro Mandant getrennt.
// Key = tenantId aus dem AsyncLocalStorage-Kontext (oder "__global__" als Fallback).
const configCacheByTenant = new Map<string, { configs: any[]; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 60 seconds

function webhookConfigCacheKey(): string {
  return getTenantIdFromContext() ?? "__global__";
}

/**
 * Webhook Service - handles triggering webhooks with retry logic
 */
class WebhookService {
  private queue: Promise<void> = Promise.resolve();
  private concurrency = 5;
  private activeRequests = 0;

  /**
   * Invalidate config cache (call after updating webhook configs)
   */
  invalidateCache() {
    configCacheByTenant.clear();
  }

  /**
   * Get webhook configurations (cached, pro Mandant)
   */
  private async getConfigs() {
    const now = Date.now();
    const key = webhookConfigCacheKey();
    const cached = configCacheByTenant.get(key);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.configs;
    }

    const configs = await storage.getAllWebhookConfigs();
    configCacheByTenant.set(key, { configs, timestamp: now });
    return configs;
  }

  /**
   * Validate webhook URL to prevent SSRF attacks
   */
  private validateWebhookUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);

      // Only allow HTTPS
      if (parsed.protocol !== "https:") {
        return { valid: false, error: "Only HTTPS URLs are allowed" };
      }

      // Block localhost
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return { valid: false, error: "Localhost URLs are not allowed" };
      }

      // Block private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x)
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = parsed.hostname.match(ipv4Regex);
      if (match) {
        const [, a, b] = match;
        const first = parseInt(a);
        const second = parseInt(b);

        if (first === 10) {
          return { valid: false, error: "Private IP range (10.x.x.x) not allowed" };
        }
        if (first === 172 && second >= 16 && second <= 31) {
          return { valid: false, error: "Private IP range (172.16-31.x.x) not allowed" };
        }
        if (first === 192 && second === 168) {
          return { valid: false, error: "Private IP range (192.168.x.x) not allowed" };
        }
        if (first === 169 && second === 254) {
          return { valid: false, error: "Link-local IP range (169.254.x.x) not allowed" };
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: "Invalid URL format" };
    }
  }

  /**
   * Trigger a webhook event
   */
  async trigger(
    eventType: WebhookEventType,
    payload: WebhookPayload,
    metadata?: Record<string, any>
  ): Promise<string> {
    const requestId = randomUUID();

    // Fire and forget - don't block the caller
    this.enqueue(eventType, payload, metadata, requestId);

    return requestId;
  }

  /**
   * Enqueue webhook dispatch with concurrency control
   */
  private async enqueue(
    eventType: WebhookEventType,
    payload: WebhookPayload,
    metadata: Record<string, any> = {},
    requestId: string
  ) {
    // Wait if we're at max concurrency
    while (this.activeRequests >= this.concurrency) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.activeRequests++;

    try {
      await this.dispatch(eventType, payload, metadata, requestId);
    } catch (error) {
      console.error(`[WebhookService] Dispatch error for ${eventType}:`, error);
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Dispatch webhook with retry logic
   */
  private async dispatch(
    eventType: WebhookEventType,
    payload: WebhookPayload,
    metadata: Record<string, any>,
    requestId: string
  ) {
    // Get webhook config for this event type
    const configs = await this.getConfigs();
    const config = configs.find((c) => c.eventType === eventType);

    if (!config || !config.enabled || !config.targetUrl) {
      console.log(`[WebhookService] No active webhook for ${eventType}`);
      return;
    }

    // Validate URL to prevent SSRF
    const urlValidation = this.validateWebhookUrl(config.targetUrl);
    if (!urlValidation.valid) {
      console.error(
        `[WebhookService] Invalid webhook URL for ${eventType}: ${urlValidation.error}`
      );
      await storage.createWebhookLog({
        requestId,
        eventType,
        targetUrl: config.targetUrl,
        status: "skipped",
        responseStatus: null,
        responseBody: null,
        errorMessage: `URL validation failed: ${urlValidation.error}`,
        attempt: 1,
        durationMs: 0,
        payload: this.trimPayload({
          eventType,
          occurredAt: new Date().toISOString(),
          data: payload,
        }),
      });
      return;
    }

    const {
      targetUrl,
      secret,
      maxAttempts = 3,
      initialBackoffMs = 1000,
      backoffFactor = 2.0,
      timeoutMs = 10000,
    } = config;

    // Prepare payload with metadata
    const webhookPayload = {
      eventType,
      occurredAt: new Date().toISOString(),
      metadata,
      data: payload,
    };

    // Attempt delivery with retries
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startTime = Date.now();

      try {
        const response = await this.sendRequest(
          targetUrl,
          webhookPayload,
          secret,
          timeoutMs
        );

        const durationMs = Date.now() - startTime;

        // Log successful delivery
        await storage.createWebhookLog({
          requestId,
          eventType,
          targetUrl,
          status: "success",
          responseStatus: response.status,
          responseBody: response.body ? response.body.substring(0, 1000) : null, // Truncate to 1000 chars
          errorMessage: null,
          attempt,
          durationMs,
          payload: this.trimPayload(webhookPayload),
        });

        console.log(
          `[WebhookService] Successfully delivered ${eventType} to ${targetUrl} (attempt ${attempt}/${maxAttempts})`
        );
        return; // Success - exit retry loop
      } catch (error: any) {
        const durationMs = Date.now() - startTime;
        const isLastAttempt = attempt === maxAttempts;
        const isPermanentError = error.status && error.status >= 400 && error.status < 500;

        // Log failed attempt
        await storage.createWebhookLog({
          requestId,
          eventType,
          targetUrl,
          status: isLastAttempt ? "failed" : "pending",
          responseStatus: error.status || null,
          responseBody: error.body ? error.body.substring(0, 1000) : null,
          errorMessage: error.message || "Unknown error",
          attempt,
          durationMs,
          payload: this.trimPayload(webhookPayload),
        });

        // Don't retry on permanent errors (4xx)
        if (isPermanentError && error.status !== 429) {
          console.error(
            `[WebhookService] Permanent error (${error.status}) for ${eventType} - not retrying`
          );
          return;
        }

        // If not last attempt, wait with exponential backoff
        if (!isLastAttempt) {
          const backoffMs = initialBackoffMs * Math.pow(backoffFactor, attempt - 1);
          console.log(
            `[WebhookService] Retry ${attempt}/${maxAttempts} for ${eventType} failed, waiting ${backoffMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          console.error(
            `[WebhookService] All ${maxAttempts} attempts failed for ${eventType}`
          );
        }
      }
    }
  }

  /**
   * Send HTTP request to webhook URL
   */
  private async sendRequest(
    url: string,
    payload: any,
    secret: string | null,
    timeoutMs: number
  ): Promise<{ status: number; body: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "METAorder-Webhook/1.0",
      };

      // Add HMAC signature if secret is configured
      if (secret) {
        const timestamp = Date.now().toString();
        const signature = this.generateSignature(payload, secret, timestamp);
        headers["X-METAorder-Signature"] = signature;
        headers["X-METAorder-Timestamp"] = timestamp;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const body = await response.text().catch(() => null);

      if (!response.ok) {
        throw {
          status: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`,
          body,
        };
      }

      return {
        status: response.status,
        body,
      };
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw {
          status: null,
          message: `Request timeout after ${timeoutMs}ms`,
          body: null,
        };
      }
      throw {
        status: error.status || null,
        message: error.message || "Network error",
        body: error.body || null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload
   */
  private generateSignature(payload: any, secret: string, timestamp: string): string {
    const data = `${timestamp}.${JSON.stringify(payload)}`;
    return crypto.createHmac("sha256", secret).update(data).digest("hex");
  }

  /**
   * Trim payload to reduce storage size (keep only essential fields)
   */
  private trimPayload(payload: any): any {
    // Store only event type and entity ID, not full payload
    return {
      eventType: payload.eventType,
      entityId: payload.data?.id || payload.data?.ticketId || payload.data?.orderId || null,
      occurredAt: payload.occurredAt,
    };
  }

  /**
   * Test webhook by sending a sample payload
   */
  async test(eventType: WebhookEventType, url?: string): Promise<{
    success: boolean;
    status?: number;
    message: string;
    duration?: number;
  }> {
    const requestId = randomUUID();
    const configs = await this.getConfigs();
    const config = configs.find((c) => c.eventType === eventType);

    if (!config && !url) {
      return {
        success: false,
        message: "No webhook configured for this event type",
      };
    }

    const targetUrl = url || config?.targetUrl;
    if (!targetUrl) {
      return {
        success: false,
        message: "No URL provided",
      };
    }

    // Create test payload
    const testPayload = this.getTestPayload(eventType);
    const webhookPayload = {
      eventType,
      occurredAt: new Date().toISOString(),
      metadata: { test: true },
      data: testPayload,
    };

    const startTime = Date.now();

    try {
      const response = await this.sendRequest(
        targetUrl,
        webhookPayload,
        config?.secret || null,
        config?.timeoutMs || 10000
      );

      const duration = Date.now() - startTime;

      // Log successful test
      await storage.createWebhookLog({
        requestId,
        eventType,
        targetUrl,
        status: "success",
        responseStatus: response.status,
        responseBody: response.body?.substring(0, 1000) || null,
        errorMessage: null,
        attempt: 1,
        durationMs: duration,
        payload: this.trimPayload(webhookPayload),
      });

      return {
        success: true,
        status: response.status,
        message: `Test webhook sent successfully (${response.status})`,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Log failed test
      await storage.createWebhookLog({
        requestId,
        eventType,
        targetUrl,
        status: "failed",
        responseStatus: error.status || null,
        responseBody: error.body?.substring(0, 1000) || null,
        errorMessage: error.message || "Test webhook failed",
        attempt: 1,
        durationMs: duration,
        payload: this.trimPayload(webhookPayload),
      });

      return {
        success: false,
        status: error.status,
        message: error.message || "Test webhook failed",
        duration,
      };
    }
  }

  /**
   * Get sample test payload for event type
   */
  private getTestPayload(eventType: WebhookEventType): any {
    switch (eventType) {
      case "ticket.created":
        return {
          id: "test-ticket-id",
          ticketNumber: "T-1000",
          title: "Test Ticket",
          priority: "normal",
          status: "open",
          createdByUserId: "test-user",
          createdAt: new Date(),
        };

      case "ticket.updated":
        return {
          id: "test-ticket-id",
          ticketNumber: "T-1000",
          changes: [
            {
              field: "status",
              oldValue: "open",
              newValue: "in_progress",
            },
          ],
          updatedBy: "test-user",
          updatedAt: new Date(),
        };

      case "ticket.commented":
        return {
          ticketId: "test-ticket-id",
          ticketNumber: "T-1000",
          commentId: "test-comment-id",
          comment: "This is a test comment",
          isInternal: false,
          userId: "test-user",
          username: "Test User",
          createdAt: new Date(),
        };

      case "ticket.assigned":
        return {
          ticketId: "test-ticket-id",
          ticketNumber: "T-1000",
          previousAssignee: null,
          newAssignee: "test-user",
          assignedBy: "admin",
          assignedAt: new Date(),
        };

      case "order.ready_to_ship":
        return {
          orderId: "test-order-id",
          orderNumber: "10001",
          customerName: "Test Customer",
          customerEmail: "test@example.com",
          totalAmount: 99.99,
          items: [
            {
              productName: "Test Product",
              quantity: 2,
            },
          ],
          readyAt: new Date(),
        };

      case "document.created":
        return {
          documentType: "invoice",
          orderId: "test-order-id",
          orderNumber: "10001",
          documentNumber: "INV-2025-001",
          createdAt: new Date(),
        };

      case "commercial.draft_created":
      case "commercial.draft_review_required":
        return {
          draftId: "test-draft-id",
          draftKind: "offer",
          draftStatus: "review_required",
          intent: "quote_request",
          intentConfidence: 0.82,
          overallConfidence: 88,
          shopwareCustomerId: null,
          messageId: "msg-1",
          source: "manual_upload",
          createdAt: new Date().toISOString(),
        };

      case "commercial.auto_offer_created":
        return {
          draftId: "test-draft-id",
          offerId: "test-offer-id",
          messageId: null,
          createdAt: new Date().toISOString(),
        };

      case "commercial.auto_order_created":
        return {
          draftId: "test-draft-id",
          orderId: "test-order-id",
          messageId: null,
          createdAt: new Date().toISOString(),
        };

      case "b2b.approval_required":
        return {
          referenceId: "test-employee-order-id",
          referenceType: "employee_order",
          customerId: "test-customer-id",
          totalPrice: 1500,
          createdAt: new Date().toISOString(),
        };

      case "b2b.approval_decided":
        return {
          referenceId: "test-employee-order-id",
          referenceType: "employee_order",
          decision: "approved",
          actorUserId: "test-user",
          decidedAt: new Date().toISOString(),
        };

      default:
        return { test: true };
    }
  }
}

// Export singleton instance
export const webhookService = new WebhookService();
