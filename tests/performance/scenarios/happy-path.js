import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { createScenarioOptions } from "../thresholds.js";
import { handleSummary } from "../reporters/json-summary.js";
import { BASE_URL, loginAndGetCsrf } from "./_shared.js";

export const options = createScenarioOptions({
  happy_path: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "30s", target: 5 },
      { duration: "60s", target: 10 },
      { duration: "30s", target: 0 },
    ],
    gracefulRampDown: "10s",
  },
});

const cpqValidateDuration = new Trend("cpq_validate_duration");

export default function () {
  const auth = loginAndGetCsrf();

  const health = http.get(`${BASE_URL}/healthz`);
  check(health, { "healthz is 200": (res) => res.status === 200 });

  const me = http.get(`${BASE_URL}/api/auth/me`);
  check(me, { "auth/me is 200": (res) => res.status === 200 });

  const cpqValidate = http.post(
    `${BASE_URL}/api/cpq-core/validate`,
    JSON.stringify({
      context: { customerGroup: "b2b_standard" },
      configuration: {
        frame: { heightMm: 2000, depthMm: 600, widthMm: 1000, anchoringIncluded: true },
        shelves: [{ material: "stahl_verzinkt", maxFachlastKg: 150, depthMm: 600, widthMm: 1000, count: 4 }],
        accessories: [],
        application: "werkstatt",
      },
    }),
    auth
  );
  cpqValidateDuration.add(cpqValidate.timings.duration);
  check(cpqValidate, {
    "cpq-core validate accepted": (res) => res.status === 200 || res.status === 400,
  });

  sleep(1);
}

export { handleSummary };
