export function handleSummary(data) {
  return {
    "tests/performance/reports/summary.json": JSON.stringify(data, null, 2),
    stdout: createConsoleSummary(data),
  };
}

function createConsoleSummary(data) {
  const failedRate = data.metrics.http_req_failed?.values?.rate ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.["p(95)"] ?? 0;
  const p99 = data.metrics.http_req_duration?.values?.["p(99)"] ?? 0;

  return [
    "=== METAorder Sprint 8 Performance Summary ===",
    `http_req_failed(rate): ${failedRate.toFixed(4)}`,
    `http_req_duration p95: ${p95.toFixed(2)} ms`,
    `http_req_duration p99: ${p99.toFixed(2)} ms`,
  ].join("\n");
}
