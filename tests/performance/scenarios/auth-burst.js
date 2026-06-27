import http from "k6/http";
import { check, sleep } from "k6";
import { createScenarioOptions } from "../thresholds.js";
import { handleSummary } from "../reporters/json-summary.js";
import { BASE_URL, USERNAME, PASSWORD } from "./_shared.js";

export const options = createScenarioOptions({
  auth_burst: {
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 20,
    maxVUs: 60,
    stages: [
      { duration: "20s", target: 5 },
      { duration: "40s", target: 15 },
      { duration: "20s", target: 0 },
    ],
  },
});

export default function () {
  const loginResponse = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(loginResponse, {
    "auth login response acceptable": (res) => res.status === 200 || res.status === 401 || res.status === 429,
  });

  sleep(0.2);
}

export { handleSummary };
