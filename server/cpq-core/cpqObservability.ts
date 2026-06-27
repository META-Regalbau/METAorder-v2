type CpqCoreEndpointKey = "validate" | "price" | "submit" | "adapter_submit_transfer";

type EndpointMetricBucket = {
  requests: number;
  success: number;
  errors: number;
  clientErrors: number;
  serverErrors: number;
  totalLatencyMs: number;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  lastLatencyMs: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastSeenAt: string | null;
};

type KpiBucket = {
  configuratorUsage: number;
  validateCalls: number;
  priceCalls: number;
  submitCalls: number;
  submitAccepted: number;
  submitReviewRequired: number;
  adapterSubmitTransferCalls: number;
  transferPrepared: number;
  transferBlocked: number;
  transferSkipped: number;
  classificationA: number;
  classificationB: number;
  classificationC: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

type TrackMetricParams = {
  endpoint: CpqCoreEndpointKey;
  tenantId?: string | null;
  statusCode: number;
  durationMs: number;
  errorMessage?: string | null;
};

type TrackKpiParams = {
  endpoint: CpqCoreEndpointKey;
  tenantId?: string | null;
  classification?: "A" | "B" | "C";
  submitStatus?: "accepted" | "review_required";
  transferStatus?: "prepared" | "blocked" | "skipped";
};

const CPQ_CORE_ENDPOINTS: CpqCoreEndpointKey[] = [
  "validate",
  "price",
  "submit",
  "adapter_submit_transfer",
];

const DEFAULT_TENANT_KEY = "__global__";
const metricsByTenant = new Map<string, Record<CpqCoreEndpointKey, EndpointMetricBucket>>();
const kpisByTenant = new Map<string, KpiBucket>();

function resolveTenantKey(tenantId?: string | null): string {
  const normalized = typeof tenantId === "string" ? tenantId.trim() : "";
  return normalized.length ? normalized : DEFAULT_TENANT_KEY;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createMetricBucket(): EndpointMetricBucket {
  return {
    requests: 0,
    success: 0,
    errors: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatencyMs: 0,
    minLatencyMs: null,
    maxLatencyMs: null,
    lastLatencyMs: null,
    lastStatusCode: null,
    lastError: null,
    lastSeenAt: null,
  };
}

function createMetricsRecord(): Record<CpqCoreEndpointKey, EndpointMetricBucket> {
  return {
    validate: createMetricBucket(),
    price: createMetricBucket(),
    submit: createMetricBucket(),
    adapter_submit_transfer: createMetricBucket(),
  };
}

function createKpiBucket(): KpiBucket {
  return {
    configuratorUsage: 0,
    validateCalls: 0,
    priceCalls: 0,
    submitCalls: 0,
    submitAccepted: 0,
    submitReviewRequired: 0,
    adapterSubmitTransferCalls: 0,
    transferPrepared: 0,
    transferBlocked: 0,
    transferSkipped: 0,
    classificationA: 0,
    classificationB: 0,
    classificationC: 0,
    firstSeenAt: null,
    lastSeenAt: null,
  };
}

function getTenantMetrics(tenantId?: string | null): Record<CpqCoreEndpointKey, EndpointMetricBucket> {
  const key = resolveTenantKey(tenantId);
  let record = metricsByTenant.get(key);
  if (!record) {
    record = createMetricsRecord();
    metricsByTenant.set(key, record);
  }
  return record;
}

function getTenantKpis(tenantId?: string | null): KpiBucket {
  const key = resolveTenantKey(tenantId);
  let bucket = kpisByTenant.get(key);
  if (!bucket) {
    bucket = createKpiBucket();
    kpisByTenant.set(key, bucket);
  }
  return bucket;
}

function aggregateMetricsRecord(record: Record<CpqCoreEndpointKey, EndpointMetricBucket>) {
  const totals = {
    requests: 0,
    success: 0,
    errors: 0,
    clientErrors: 0,
    serverErrors: 0,
    totalLatencyMs: 0,
    avgLatencyMs: 0,
  };

  for (const key of CPQ_CORE_ENDPOINTS) {
    const bucket = record[key];
    totals.requests += bucket.requests;
    totals.success += bucket.success;
    totals.errors += bucket.errors;
    totals.clientErrors += bucket.clientErrors;
    totals.serverErrors += bucket.serverErrors;
    totals.totalLatencyMs += bucket.totalLatencyMs;
  }

  totals.avgLatencyMs = totals.requests > 0 ? Number((totals.totalLatencyMs / totals.requests).toFixed(2)) : 0;
  return totals;
}

function toEndpointSnapshot(record: Record<CpqCoreEndpointKey, EndpointMetricBucket>) {
  return {
    validate: formatBucket(record.validate),
    price: formatBucket(record.price),
    submit: formatBucket(record.submit),
    adapterSubmitTransfer: formatBucket(record.adapter_submit_transfer),
  };
}

function formatBucket(bucket: EndpointMetricBucket) {
  const avgLatencyMs = bucket.requests > 0 ? Number((bucket.totalLatencyMs / bucket.requests).toFixed(2)) : 0;
  const successRate = bucket.requests > 0 ? Number((bucket.success / bucket.requests).toFixed(4)) : 0;
  return {
    requests: bucket.requests,
    success: bucket.success,
    errors: bucket.errors,
    clientErrors: bucket.clientErrors,
    serverErrors: bucket.serverErrors,
    avgLatencyMs,
    minLatencyMs: bucket.minLatencyMs,
    maxLatencyMs: bucket.maxLatencyMs,
    lastLatencyMs: bucket.lastLatencyMs,
    successRate,
    lastStatusCode: bucket.lastStatusCode,
    lastError: bucket.lastError,
    lastSeenAt: bucket.lastSeenAt,
  };
}

function applyClassificationKpi(bucket: KpiBucket, classification?: "A" | "B" | "C"): void {
  if (!classification) return;
  if (classification === "A") bucket.classificationA += 1;
  if (classification === "B") bucket.classificationB += 1;
  if (classification === "C") bucket.classificationC += 1;
}

export function trackCpqCoreMetric(params: TrackMetricParams): void {
  const { endpoint, tenantId, statusCode, durationMs, errorMessage } = params;
  const record = getTenantMetrics(tenantId);
  const bucket = record[endpoint];
  bucket.requests += 1;
  bucket.totalLatencyMs += durationMs;
  bucket.minLatencyMs = bucket.minLatencyMs === null ? durationMs : Math.min(bucket.minLatencyMs, durationMs);
  bucket.maxLatencyMs = bucket.maxLatencyMs === null ? durationMs : Math.max(bucket.maxLatencyMs, durationMs);
  bucket.lastLatencyMs = durationMs;
  bucket.lastStatusCode = statusCode;
  bucket.lastSeenAt = nowIso();

  if (statusCode >= 200 && statusCode < 400) {
    bucket.success += 1;
    bucket.lastError = null;
  } else {
    bucket.errors += 1;
    if (statusCode >= 500) {
      bucket.serverErrors += 1;
    } else {
      bucket.clientErrors += 1;
    }
    bucket.lastError = errorMessage?.slice(0, 500) || `HTTP ${statusCode}`;
  }

  console.log(
    JSON.stringify({
      event: "cpq_core_endpoint_metric",
      endpoint,
      tenantId: tenantId ?? null,
      statusCode,
      durationMs,
      success: statusCode >= 200 && statusCode < 400,
      errorMessage: errorMessage ?? null,
      at: nowIso(),
    })
  );
}

export function trackCpqKpi(params: TrackKpiParams): void {
  const { endpoint, tenantId, classification, submitStatus, transferStatus } = params;
  const bucket = getTenantKpis(tenantId);
  const seenAt = nowIso();
  if (!bucket.firstSeenAt) bucket.firstSeenAt = seenAt;
  bucket.lastSeenAt = seenAt;

  if (endpoint === "validate") {
    bucket.validateCalls += 1;
    bucket.configuratorUsage += 1;
  }
  if (endpoint === "price") {
    bucket.priceCalls += 1;
    bucket.configuratorUsage += 1;
  }
  if (endpoint === "submit") {
    bucket.submitCalls += 1;
    bucket.configuratorUsage += 1;
    if (submitStatus === "accepted") bucket.submitAccepted += 1;
    if (submitStatus === "review_required") bucket.submitReviewRequired += 1;
  }
  if (endpoint === "adapter_submit_transfer") {
    bucket.adapterSubmitTransferCalls += 1;
    if (transferStatus === "prepared") bucket.transferPrepared += 1;
    if (transferStatus === "blocked") bucket.transferBlocked += 1;
    if (transferStatus === "skipped") bucket.transferSkipped += 1;
  }

  applyClassificationKpi(bucket, classification);
}

function safeRatio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

export function getCpqCoreMetricsSnapshot(tenantId?: string | null) {
  const record = getTenantMetrics(tenantId);
  return {
    tenantId: tenantId ?? null,
    generatedAt: nowIso(),
    endpoints: toEndpointSnapshot(record),
    totals: aggregateMetricsRecord(record),
  };
}

export function getCpqKpiReport(tenantId?: string | null) {
  const bucket = getTenantKpis(tenantId);
  const classifiedTotal = bucket.classificationA + bucket.classificationB + bucket.classificationC;

  return {
    tenantId: tenantId ?? null,
    generatedAt: nowIso(),
    counters: {
      configuratorUsage: bucket.configuratorUsage,
      validateCalls: bucket.validateCalls,
      priceCalls: bucket.priceCalls,
      submitCalls: bucket.submitCalls,
      submitAccepted: bucket.submitAccepted,
      submitReviewRequired: bucket.submitReviewRequired,
      adapterSubmitTransferCalls: bucket.adapterSubmitTransferCalls,
      transferPrepared: bucket.transferPrepared,
      transferBlocked: bucket.transferBlocked,
      transferSkipped: bucket.transferSkipped,
      classificationA: bucket.classificationA,
      classificationB: bucket.classificationB,
      classificationC: bucket.classificationC,
    },
    ratios: {
      classCShare: safeRatio(bucket.classificationC, classifiedTotal),
      submitToReviewRequiredQuote: safeRatio(bucket.submitReviewRequired, bucket.submitCalls),
      submitConversionRate: safeRatio(bucket.submitCalls, bucket.configuratorUsage),
      transferBlockedShare: safeRatio(bucket.transferBlocked, bucket.adapterSubmitTransferCalls),
    },
    timespan: {
      firstSeenAt: bucket.firstSeenAt,
      lastSeenAt: bucket.lastSeenAt,
    },
  };
}

export type CpqDataQualityIssueSeverity = "error" | "warning";

export type CpqDataQualityIssue = {
  severity: CpqDataQualityIssueSeverity;
  code: string;
  message: string;
  systemId?: string;
};

type CpqStorageLike = {
  getSystems(tenantId?: string | null): Promise<Array<{ id: string; name: string; slug: string }>>;
  getComponentTypesBySystem(systemId: string): Promise<Array<{ id: string }>>;
  getProductMappingsBySystem(
    systemId: string,
    tenantId?: string | null
  ): Promise<Array<{ componentTypeId: string; shopwareProductNumber: string; status: string }>>;
  getRulesBySystem(
    systemId: string,
    tenantId?: string | null
  ): Promise<Array<{ status: string; condition: unknown; action: unknown }>>;
  getConfigurationsBySystem(
    systemId: string,
    tenantId?: string | null
  ): Promise<Array<{ configData: Record<string, unknown> | null }>>;
};

export async function runCpqDataQualityCheck(
  tenantId: string,
  storage: CpqStorageLike
): Promise<{
  tenantId: string;
  generatedAt: string;
  summary: { systemsChecked: number; errors: number; warnings: number };
  issues: CpqDataQualityIssue[];
}> {
  const systems = await storage.getSystems(tenantId);
  const issues: CpqDataQualityIssue[] = [];

  for (const system of systems) {
    const [componentTypes, mappings, rules, configurations] = await Promise.all([
      storage.getComponentTypesBySystem(system.id),
      storage.getProductMappingsBySystem(system.id, tenantId),
      storage.getRulesBySystem(system.id, tenantId),
      storage.getConfigurationsBySystem(system.id, tenantId),
    ]);

    if (!componentTypes.length) {
      issues.push({
        severity: "error",
        code: "SYSTEM_WITHOUT_COMPONENT_TYPES",
        message: `System ${system.name} (${system.id}) hat keine Komponententypen.`,
        systemId: system.id,
      });
    }

    const activeMappings = mappings.filter((mapping) => mapping.status === "active");
    if (!activeMappings.length) {
      issues.push({
        severity: "warning",
        code: "SYSTEM_WITHOUT_ACTIVE_MAPPINGS",
        message: `System ${system.name} (${system.id}) hat keine aktiven Produkt-Mappings.`,
        systemId: system.id,
      });
    }

    const componentTypeIds = new Set(componentTypes.map((componentType) => componentType.id));
    for (const mapping of mappings) {
      if (!componentTypeIds.has(mapping.componentTypeId)) {
        issues.push({
          severity: "error",
          code: "MAPPING_WITH_UNKNOWN_COMPONENT_TYPE",
          message: `Mapping mit Produktnummer ${mapping.shopwareProductNumber} verweist auf unbekannten Komponententyp.`,
          systemId: system.id,
        });
      }
    }

    const productNumberCounter = new Map<string, number>();
    for (const mapping of activeMappings) {
      const key = mapping.shopwareProductNumber.trim().toLowerCase();
      productNumberCounter.set(key, (productNumberCounter.get(key) ?? 0) + 1);
    }
    for (const [productNumber, count] of productNumberCounter.entries()) {
      if (count > 1) {
        issues.push({
          severity: "warning",
          code: "DUPLICATE_ACTIVE_PRODUCT_MAPPING",
          message: `Produktnummer ${productNumber} ist ${count}x aktiv gemappt (System ${system.id}).`,
          systemId: system.id,
        });
      }
    }

    for (const rule of rules) {
      const isActive = rule.status === "active";
      const conditionMissing = !rule.condition || typeof rule.condition !== "object";
      const actionMissing = !rule.action || typeof rule.action !== "object";
      if (isActive && conditionMissing && actionMissing) {
        issues.push({
          severity: "warning",
          code: "ACTIVE_RULE_WITHOUT_PAYLOAD",
          message: `Mindestens eine aktive Regel in ${system.name} hat weder condition noch action.`,
          systemId: system.id,
        });
        break;
      }
    }

    for (const configuration of configurations) {
      const config = configuration.configData;
      if (!config || typeof config !== "object") {
        issues.push({
          severity: "error",
          code: "CONFIGURATION_WITHOUT_CONFIG_DATA",
          message: `Mindestens eine Konfiguration in ${system.name} hat kein gueltiges configData-Objekt.`,
          systemId: system.id,
        });
        break;
      }

      const frame = config.frame as { heightMm?: number; depthMm?: number; widthMm?: number } | undefined;
      const shelves = config.shelves as unknown;
      const hasInvalidFrame =
        !frame ||
        typeof frame.heightMm !== "number" ||
        typeof frame.depthMm !== "number" ||
        typeof frame.widthMm !== "number" ||
        frame.heightMm <= 0 ||
        frame.depthMm <= 0 ||
        frame.widthMm <= 0;
      if (hasInvalidFrame) {
        issues.push({
          severity: "warning",
          code: "CONFIGURATION_WITH_INVALID_FRAME",
          message: `Mindestens eine Konfiguration in ${system.name} enthaelt unvollstaendige frame-Daten.`,
          systemId: system.id,
        });
        break;
      }
      if (!Array.isArray(shelves)) {
        issues.push({
          severity: "warning",
          code: "CONFIGURATION_WITH_INVALID_SHELVES",
          message: `Mindestens eine Konfiguration in ${system.name} enthaelt kein gueltiges shelves-Array.`,
          systemId: system.id,
        });
        break;
      }
    }
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;

  return {
    tenantId,
    generatedAt: nowIso(),
    summary: {
      systemsChecked: systems.length,
      errors,
      warnings,
    },
    issues,
  };
}
