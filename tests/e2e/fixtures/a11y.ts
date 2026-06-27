import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function expectNoCriticalA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((violation) => violation.impact === "critical");
  expect(
    critical,
    `Kritische A11y-Verstöße gefunden: ${critical.map((v) => v.id).join(", ")}`
  ).toEqual([]);
}
