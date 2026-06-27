import http from "k6/http";
import { check } from "k6";

export const BASE_URL = __ENV.K6_BASE_URL || "http://127.0.0.1:5000";
export const USERNAME = __ENV.K6_USERNAME || "admin";
export const PASSWORD = __ENV.K6_PASSWORD || "admin123";

export function loginAndGetCsrf() {
  const loginResponse = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(loginResponse, { "login status is 2xx": (res) => res.status >= 200 && res.status < 300 });

  const csrfCookie = loginResponse.cookies.csrf_token?.[0]?.value;
  return {
    headers: {
      "Content-Type": "application/json",
      ...(csrfCookie ? { "X-CSRF-Token": csrfCookie } : {}),
    },
  };
}

export const DEFAULT_CPQ_PAYLOAD = {
  systemId: __ENV.K6_CPQ_SYSTEM_ID || "TODO_VERIFY_CPQ_SYSTEM_ID",
  context: { customerGroup: "b2b_standard" },
  configuration: {
    frame: {
      heightMm: 2000,
      depthMm: 600,
      widthMm: 1000,
      anchoringIncluded: true,
    },
    shelves: [
      {
        material: "stahl_verzinkt",
        maxFachlastKg: 150,
        depthMm: 600,
        widthMm: 1000,
        count: 4,
      },
    ],
    accessories: [],
    application: "werkstatt",
  },
};
