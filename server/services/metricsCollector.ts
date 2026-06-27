type CpqEndpoint = "validate" | "price" | "submit" | "adapter_submit_transfer";

type CpqPoint = {
  endpoint: CpqEndpoint;
  tenantId: string | null;
  statusCode: number;
  durationMs: number;
  at: string;
};

type HttpPoint = {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  at: string;
};

const MAX_POINTS = 500;

class MetricsCollectorService {
  private readonly cpqPoints: CpqPoint[] = [];
  private readonly httpPoints: HttpPoint[] = [];

  collectCpqMetric(point: Omit<CpqPoint, "at">): void {
    this.cpqPoints.push({ ...point, at: new Date().toISOString() });
    if (this.cpqPoints.length > MAX_POINTS) this.cpqPoints.shift();
  }

  collectHttpMetric(point: Omit<HttpPoint, "at">): void {
    this.httpPoints.push({ ...point, at: new Date().toISOString() });
    if (this.httpPoints.length > MAX_POINTS) this.httpPoints.shift();
  }

  getSnapshot() {
    return {
      generatedAt: new Date().toISOString(),
      cpq: {
        lastPoints: this.cpqPoints.slice(-100),
        totals: summarizeCpq(this.cpqPoints),
      },
      http: {
        lastPoints: this.httpPoints.slice(-100),
        totals: summarizeHttp(this.httpPoints),
      },
    };
  }
}

function summarizeCpq(points: CpqPoint[]) {
  const total = points.length;
  const errors = points.filter((point) => point.statusCode >= 400).length;
  const p95 = percentile(
    points.map((point) => point.durationMs),
    0.95
  );
  return {
    total,
    errors,
    errorRate: total ? Number((errors / total).toFixed(4)) : 0,
    p95LatencyMs: p95,
  };
}

function summarizeHttp(points: HttpPoint[]) {
  const total = points.length;
  const errors = points.filter((point) => point.statusCode >= 500).length;
  const p95 = percentile(
    points.map((point) => point.durationMs),
    0.95
  );
  return {
    total,
    serverErrors: errors,
    serverErrorRate: total ? Number((errors / total).toFixed(4)) : 0,
    p95LatencyMs: p95,
  };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return Number(sorted[index].toFixed(2));
}

export const metricsCollectorService = new MetricsCollectorService();
