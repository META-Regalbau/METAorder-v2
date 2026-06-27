export const SLA_THRESHOLDS = {
  http_req_failed: ["rate<0.01"],
  http_req_duration: ["p(95)<1200", "p(99)<2500"],
  cpq_validate_duration: ["p(95)<900", "p(99)<1500"],
  cpq_price_duration: ["p(95)<1200", "p(99)<2000"],
  cpq_submit_transfer_duration: ["p(95)<1800", "p(99)<3000"],
  checks: ["rate>0.99"],
};

export function createScenarioOptions(scenarios) {
  return {
    thresholds: SLA_THRESHOLDS,
    scenarios,
    summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  };
}
