import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { createScenarioOptions } from "../thresholds.js";
import { handleSummary } from "../reporters/json-summary.js";
import { BASE_URL, DEFAULT_CPQ_PAYLOAD, loginAndGetCsrf } from "./_shared.js";

const cpqPriceDuration = new Trend("cpq_price_duration");
const cpqSubmitTransferDuration = new Trend("cpq_submit_transfer_duration");

export const options = createScenarioOptions({
  cpq_core: {
    executor: "constant-vus",
    vus: Number(__ENV.K6_CPQ_VUS || 5),
    duration: __ENV.K6_CPQ_DURATION || "2m",
  },
});

export default function () {
  const auth = loginAndGetCsrf();

  const priceResponse = http.post(
    `${BASE_URL}/api/cpq-core/price`,
    JSON.stringify(DEFAULT_CPQ_PAYLOAD),
    auth
  );
  cpqPriceDuration.add(priceResponse.timings.duration);
  check(priceResponse, {
    "cpq price status is expected": (res) => res.status === 200 || res.status === 400 || res.status === 404,
  });

  const submitTransferResponse = http.post(
    `${BASE_URL}/api/cpq-core/adapter/submit-transfer`,
    JSON.stringify({
      ...DEFAULT_CPQ_PAYLOAD,
      cartTransfer: {
        cart_items: [
          {
            product_id: "TODO_VERIFY_PRODUCT_ID",
            product_number: "TODO_VERIFY_PRODUCT_NUMBER",
            quantity: 1,
          },
        ],
        create_offer: false,
      },
    }),
    auth
  );
  cpqSubmitTransferDuration.add(submitTransferResponse.timings.duration);
  check(submitTransferResponse, {
    "cpq transfer status is expected": (res) =>
      res.status === 200 || res.status === 400 || res.status === 404,
  });

  sleep(1);
}

export { handleSummary };
