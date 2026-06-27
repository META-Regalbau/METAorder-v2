import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  cpqConfigurationSchema,
  cpqConstraintRuleSchema,
  cpqSubmitRequestSchema,
  cpqSubmitTransferRequestSchema,
  cpqValidateRequestSchema,
  evaluateCpqRules,
} from "./index";
import {
  CPQ_REVIEW_QUEUE_STATUS_VALUES,
  type CpqReviewQueueStatus,
} from "@shared/schema";
import { cpqStorage } from "../cpq/cpqStorage";
import { prepareCpqCartTransfer } from "../cpq/cpqCartTransfer";
import type { CartItem } from "../cpq/cpqCrossSelling";
import type { requireAuth, requireManageCPQ, requireViewCPQ } from "../auth";
import {
  getCpqCoreMetricsSnapshot,
  getCpqKpiReport,
  runCpqDataQualityCheck,
  trackCpqCoreMetric,
  trackCpqKpi,
} from "./cpqObservability";
import { metricsCollectorService } from "../services/metricsCollector";

const validateBodySchema = cpqValidateRequestSchema;
const submitBodySchema = cpqSubmitRequestSchema;
const submitTransferBodySchema = cpqSubmitTransferRequestSchema;

const reviewQueueStatusSchema = z.enum(CPQ_REVIEW_QUEUE_STATUS_VALUES);

const updateReviewStatusBodySchema = z.object({
  status: reviewQueueStatusSchema,
  reviewNotes: z.string().max(4000).optional(),
});

function estimateBaseNet(configuration: z.infer<typeof cpqConfigurationSchema>): number {
  const shelfCost = configuration.shelves.reduce(
    (sum, shelf) => sum + (shelf.count ?? 1) * shelf.maxFachlastKg * 0.4,
    0
  );
  const accessoryCost = configuration.accessories.reduce(
    (sum, accessory) => sum + (accessory.count ?? 1) * 25,
    0
  );
  const frameCost = Math.max(200, configuration.frame.heightMm * 0.08 + configuration.frame.depthMm * 0.05);

  return Number((shelfCost + accessoryCost + frameCost).toFixed(2));
}

const DEFAULT_CPQ_CORE_RULES: z.infer<typeof cpqConstraintRuleSchema>[] = [
  { ruleId: "GEO-01", category: "geometry", severity: "hard", messageDe: "Boden tiefer als Rahmen", isActive: true, sortOrder: 10 },
  { ruleId: "GEO-02", category: "geometry", severity: "hard", messageDe: "Bodenbreite muss Rahmenbreite entsprechen", isActive: true, sortOrder: 20 },
  { ruleId: "GEO-04", category: "geometry", severity: "trigger", messageDe: "Sonderhoehe erfordert technische Pruefung", isActive: true, sortOrder: 30 },
  { ruleId: "GEO-06", category: "geometry", severity: "hard", messageDe: "Verankerung ist erforderlich", isActive: true, sortOrder: 40 },
  { ruleId: "OBF-03", category: "oberflaeche", severity: "trigger", messageDe: "Sonderfarbe aktiv", isActive: true, sortOrder: 50 },
  { ruleId: "BODEN-03", category: "boden", severity: "default", messageDe: "Default fuer Werkstatt: Stahl verzinkt", isActive: true, sortOrder: 60 },
];

function resolveRules(rules: z.infer<typeof cpqConstraintRuleSchema>[] | undefined) {
  return rules && rules.length > 0 ? rules : DEFAULT_CPQ_CORE_RULES;
}

function deriveReviewDecision(classification: "A" | "B" | "C") {
  const requiresReview = classification === "C";
  return {
    status: requiresReview ? "review_required" : "accepted",
    requiresReview,
    reviewStatus: requiresReview ? "pending" : "not_required",
  } as const;
}

function buildBlockedReviewTransfer() {
  return {
    status: "blocked" as const,
    reason: "review_required" as const,
    nextAction: "review_queue" as const,
    reviewHint:
      "Diese Konfiguration wurde als Klasse C eingestuft. Der Checkout bleibt gesperrt, bis die technische Pruefung in METAorder abgeschlossen ist.",
  };
}

function buildValidationSummary(validation: ReturnType<typeof evaluateCpqRules>) {
  const decision = deriveReviewDecision(validation.classification);
  return {
    ...validation,
    status: validation.valid ? decision.status : "invalid",
    requiresReview: validation.valid ? decision.requiresReview : false,
    reviewStatus: validation.valid ? decision.reviewStatus : "not_required",
  };
}

async function persistSubmittedConfiguration(
  body: z.infer<typeof submitBodySchema>,
  tenantId: string
) {
  const system = await cpqStorage.getSystem(body.systemId, tenantId);
  if (!system) {
    return { error: "System not found for tenant" as const };
  }

  const validation = evaluateCpqRules({
    context: body.context,
    configuration: body.configuration,
    rules: resolveRules(body.rules),
  });
  if (!validation.valid) {
    return { error: "Configuration invalid" as const, validation };
  }

  const decision = deriveReviewDecision(validation.classification);
  const totalPrice = estimateBaseNet(body.configuration);

  const saved = await cpqStorage.createConfiguration(
    {
      systemId: body.systemId,
      customerId: body.customerId ?? null,
      name: body.name ?? `CPQ ${new Date().toISOString()}`,
      configData: {
        ...body.configuration,
        context: body.context,
        classification: validation.classification,
        disclaimers: validation.disclaimers,
      },
      validationStatus: decision.requiresReview ? "warnings" : "valid",
      reviewRequired: decision.requiresReview,
      reviewStatus: decision.reviewStatus,
      reviewRequestedAt: decision.requiresReview ? new Date() : null,
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      totalPrice: String(totalPrice),
    },
    tenantId
  );

  return { validation, decision, saved };
}

function getTenantIdOrRespond(req: Request, res: Response): string | null {
  const tenantId = req.tenantId ?? null;
  if (!tenantId) {
    res.status(400).json({ error: "Tenant not selected" });
    return null;
  }
  return tenantId;
}

export function registerCpqCoreRoutes(
  app: Express,
  auth: {
    requireAuth: typeof requireAuth;
    requireViewCPQ: typeof requireViewCPQ;
    requireManageCPQ: typeof requireManageCPQ;
  }
): void {
  const { requireAuth, requireViewCPQ, requireManageCPQ } = auth;

  app.post("/api/cpq-core/validate", requireAuth, requireViewCPQ, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    let errorMessage: string | undefined;
    let classification: "A" | "B" | "C" | undefined;
    try {
      const body = validateBodySchema.parse(req.body);
      const result = evaluateCpqRules({
        context: body.context,
        configuration: body.configuration,
        rules: resolveRules(body.rules),
      });
      classification = result.classification;
      res.json(buildValidationSummary(result));
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        errorMessage = error.errors[0]?.message ?? "Invalid payload";
        return res.status(400).json({ error: error.errors[0]?.message ?? "Invalid payload" });
      }
      const message = error instanceof Error ? error.message : "Failed to validate configuration";
      errorMessage = message;
      res.status(500).json({ error: message });
    } finally {
      const statusCode = res.statusCode || 500;
      const tenantId = req.tenantId ?? null;
      trackCpqCoreMetric({
        endpoint: "validate",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
        errorMessage: statusCode >= 400 ? errorMessage : null,
      });
      metricsCollectorService.collectCpqMetric({
        endpoint: "validate",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
      });
      trackCpqKpi({
        endpoint: "validate",
        tenantId,
        classification,
      });
    }
  });

  app.post("/api/cpq-core/price", requireAuth, requireViewCPQ, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    let errorMessage: string | undefined;
    let classification: "A" | "B" | "C" | undefined;
    try {
      const body = validateBodySchema.parse(req.body);
      const validation = evaluateCpqRules({
        context: body.context,
        configuration: body.configuration,
        rules: resolveRules(body.rules),
      });
      classification = validation.classification;
      const validationSummary = buildValidationSummary(validation);
      const baseNet = estimateBaseNet(body.configuration);

      const surchargePercent = validation.classification === "C" ? 0.25 : validation.classification === "B" ? 0.1 : 0;
      const surchargeNet = Number((baseNet * surchargePercent).toFixed(2));
      const net = Number((baseNet + surchargeNet).toFixed(2));
      const gross = Number((net * 1.19).toFixed(2));

      res.json({
        ...validationSummary,
        classification: validation.classification,
        surcharges: surchargePercent
          ? [
              {
                attribute: "classification",
                value: validation.classification,
                type: "percent",
                amount: surchargePercent * 100,
              },
            ]
          : [],
        totals: { net, gross },
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        errorMessage = error.errors[0]?.message ?? "Invalid payload";
        return res.status(400).json({ error: error.errors[0]?.message ?? "Invalid payload" });
      }
      const message = error instanceof Error ? error.message : "Failed to price configuration";
      errorMessage = message;
      res.status(500).json({ error: message });
    } finally {
      const statusCode = res.statusCode || 500;
      const tenantId = req.tenantId ?? null;
      trackCpqCoreMetric({
        endpoint: "price",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
        errorMessage: statusCode >= 400 ? errorMessage : null,
      });
      metricsCollectorService.collectCpqMetric({
        endpoint: "price",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
      });
      trackCpqKpi({
        endpoint: "price",
        tenantId,
        classification,
      });
    }
  });

  app.post("/api/cpq-core/submit", requireAuth, requireViewCPQ, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    let errorMessage: string | undefined;
    let classification: "A" | "B" | "C" | undefined;
    let submitStatus: "accepted" | "review_required" | undefined;
    try {
      const body = submitBodySchema.parse(req.body);
      const tenantId = getTenantIdOrRespond(req, res);
      if (!tenantId) return;

      const savedResult = await persistSubmittedConfiguration(body, tenantId);
      if ("error" in savedResult) {
        if (savedResult.error === "System not found for tenant") {
          return res.status(404).json({ error: savedResult.error });
        }
        return res.status(400).json({
          error: savedResult.error,
          validation: savedResult.validation,
        });
      }

      res.json({
        configurationId: savedResult.saved.id,
        classification: savedResult.validation.classification,
        status: savedResult.decision.status,
        requiresReview: savedResult.decision.requiresReview,
        reviewStatus: savedResult.decision.reviewStatus,
        disclaimers: savedResult.validation.disclaimers,
      });
      classification = savedResult.validation.classification;
      submitStatus = savedResult.decision.status;
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        errorMessage = error.errors[0]?.message ?? "Invalid payload";
        return res.status(400).json({ error: error.errors[0]?.message ?? "Invalid payload" });
      }
      const message = error instanceof Error ? error.message : "Failed to submit configuration";
      errorMessage = message;
      res.status(500).json({ error: message });
    } finally {
      const statusCode = res.statusCode || 500;
      const tenantId = req.tenantId ?? null;
      trackCpqCoreMetric({
        endpoint: "submit",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
        errorMessage: statusCode >= 400 ? errorMessage : null,
      });
      metricsCollectorService.collectCpqMetric({
        endpoint: "submit",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
      });
      trackCpqKpi({
        endpoint: "submit",
        tenantId,
        classification,
        submitStatus,
      });
    }
  });

  app.post("/api/cpq-core/adapter/submit-transfer", requireAuth, requireViewCPQ, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    let errorMessage: string | undefined;
    let classification: "A" | "B" | "C" | undefined;
    let transferStatus: "prepared" | "blocked" | "skipped" | undefined;
    try {
      const body = submitTransferBodySchema.parse(req.body);
      const tenantId = getTenantIdOrRespond(req, res);
      if (!tenantId) return;

      const savedResult = await persistSubmittedConfiguration(body, tenantId);
      if ("error" in savedResult) {
        if (savedResult.error === "System not found for tenant") {
          return res.status(404).json({ error: savedResult.error });
        }
        return res.status(400).json({
          error: savedResult.error,
          validation: savedResult.validation,
        });
      }

      const rawCartItems = body.cartTransfer?.cart_items;
      if (!rawCartItems || rawCartItems.length === 0) {
        classification = savedResult.validation.classification;
        transferStatus = "skipped";
        return res.json({
          configurationId: savedResult.saved.id,
          classification: savedResult.validation.classification,
          status: savedResult.decision.status,
          requiresReview: savedResult.decision.requiresReview,
          reviewStatus: savedResult.decision.reviewStatus,
          transfer: { status: "skipped", reason: "no_cart_items" },
        });
      }
      const cartItems: CartItem[] = rawCartItems.map((item) => ({
        product_id: item.product_id,
        product_number: item.product_number,
        quantity: item.quantity ?? 1,
      }));

      if (savedResult.decision.requiresReview) {
        classification = savedResult.validation.classification;
        transferStatus = "blocked";
        return res.json({
          configurationId: savedResult.saved.id,
          classification: savedResult.validation.classification,
          status: savedResult.decision.status,
          requiresReview: true,
          reviewStatus: savedResult.decision.reviewStatus,
          transfer: buildBlockedReviewTransfer(),
        });
      }

      const transfer = await prepareCpqCartTransfer({
        cartItems,
        tenantId,
        customerId: body.cartTransfer?.customer_id,
        salesChannelId: body.cartTransfer?.sales_channel_id,
        createOffer: body.cartTransfer?.create_offer,
      });

      res.json({
        configurationId: savedResult.saved.id,
        classification: savedResult.validation.classification,
        status: savedResult.decision.status,
        requiresReview: savedResult.decision.requiresReview,
        reviewStatus: savedResult.decision.reviewStatus,
        transfer: {
          status: "prepared",
          ...transfer,
        },
      });
      classification = savedResult.validation.classification;
      transferStatus = "prepared";
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        errorMessage = error.errors[0]?.message ?? "Invalid payload";
        return res.status(400).json({ error: error.errors[0]?.message ?? "Invalid payload" });
      }
      const err = error as Error & { details?: unknown };
      if (err.details) {
        errorMessage = err.message || "Warenkorb entspricht nicht den CPQ-Regeln";
        return res.status(400).json({
          error: err.message || "Warenkorb entspricht nicht den CPQ-Regeln",
          validation: err.details,
        });
      }
      const message = error instanceof Error ? error.message : "Failed to submit adapter flow";
      if (message.includes("Shopware-Einstellungen")) {
        errorMessage = message;
        return res.status(400).json({ error: message });
      }
      errorMessage = message;
      res.status(500).json({ error: message });
    } finally {
      const statusCode = res.statusCode || 500;
      const tenantId = req.tenantId ?? null;
      trackCpqCoreMetric({
        endpoint: "adapter_submit_transfer",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
        errorMessage: statusCode >= 400 ? errorMessage : null,
      });
      metricsCollectorService.collectCpqMetric({
        endpoint: "adapter_submit_transfer",
        tenantId,
        statusCode,
        durationMs: Date.now() - startedAt,
      });
      trackCpqKpi({
        endpoint: "adapter_submit_transfer",
        tenantId,
        classification,
        transferStatus,
      });
    }
  });

  app.get("/api/cpq-core/monitoring/snapshot", requireAuth, requireViewCPQ, (req: Request, res: Response) => {
    const tenantId = getTenantIdOrRespond(req, res);
    if (!tenantId) return;
    res.json(getCpqCoreMetricsSnapshot(tenantId));
  });

  app.get("/api/cpq-core/kpis/report", requireAuth, requireViewCPQ, (req: Request, res: Response) => {
    const tenantId = getTenantIdOrRespond(req, res);
    if (!tenantId) return;
    res.json(getCpqKpiReport(tenantId));
  });

  app.get("/api/cpq-core/monitoring/collector", requireAuth, requireViewCPQ, (req: Request, res: Response) => {
    const tenantId = getTenantIdOrRespond(req, res);
    if (!tenantId) return;
    res.json({
      tenantId,
      ...metricsCollectorService.getSnapshot(),
    });
  });

  app.get("/api/cpq-core/data-quality/check", requireAuth, requireManageCPQ, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdOrRespond(req, res);
      if (!tenantId) return;
      const report = await runCpqDataQualityCheck(tenantId, cpqStorage);
      res.json(report);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to run data quality check";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/cpq-core/review-queue", requireAuth, requireViewCPQ, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdOrRespond(req, res);
      if (!tenantId) return;

      const parsedStatus = reviewQueueStatusSchema.safeParse(req.query.status);
      if (req.query.status != null && !parsedStatus.success) {
        return res.status(400).json({ error: "Invalid status filter" });
      }
      const items = await cpqStorage.listReviewQueue(
        parsedStatus.success ? parsedStatus.data : undefined,
        tenantId
      );
      res.json(items);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load review queue";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/cpq-core/review-queue/:id", requireAuth, requireViewCPQ, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdOrRespond(req, res);
      if (!tenantId) return;

      const item = await cpqStorage.getReviewItem(req.params.id, tenantId);
      if (!item) {
        return res.status(404).json({ error: "Review item not found" });
      }
      res.json(item);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load review item";
      res.status(500).json({ error: message });
    }
  });

  app.put(
    "/api/cpq-core/review-queue/:id/status",
    requireAuth,
    requireManageCPQ,
    async (req: Request, res: Response) => {
      try {
        const tenantId = getTenantIdOrRespond(req, res);
        if (!tenantId) return;

        const body = updateReviewStatusBodySchema.parse(req.body);
        const normalizedReviewNotes = body.reviewNotes?.trim();
        const reviewedBy = (req.user as { id?: string; username?: string } | undefined)?.id
          ?? (req.user as { username?: string } | undefined)?.username
          ?? null;

        const updated = await cpqStorage.updateReviewStatus(
          req.params.id,
          {
            status: body.status as CpqReviewQueueStatus,
            reviewNotes: normalizedReviewNotes?.length ? normalizedReviewNotes : null,
            reviewedBy,
          },
          tenantId
        );

        if (!updated) {
          return res.status(404).json({ error: "Review item not found" });
        }

        res.json(updated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors[0]?.message ?? "Invalid payload" });
        }
        const message = error instanceof Error ? error.message : "Failed to update review status";
        res.status(500).json({ error: message });
      }
    }
  );
}
