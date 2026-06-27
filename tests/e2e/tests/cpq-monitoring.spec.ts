import { test, expect } from "../fixtures/e2e.fixture";

test.describe("Sprint 8 - CPQ Monitoring", () => {
  test("CPQ Monitoring-Endpunkte liefern Snapshot", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();

    const snapshotResponse = await page.request.get("/api/cpq-core/monitoring/snapshot");
    expect(snapshotResponse.ok()).toBeTruthy();
    const snapshotBody = await snapshotResponse.json();
    expect(snapshotBody).toHaveProperty("endpoints");

    const kpiResponse = await page.request.get("/api/cpq-core/kpis/report");
    expect(kpiResponse.ok()).toBeTruthy();
    const kpiBody = await kpiResponse.json();
    expect(kpiBody).toHaveProperty("counters");

    const collectorResponse = await page.request.get("/api/cpq-core/monitoring/collector");
    expect(collectorResponse.ok()).toBeTruthy();
    const collectorBody = await collectorResponse.json();
    expect(collectorBody).toHaveProperty("cpq");
  });
});
