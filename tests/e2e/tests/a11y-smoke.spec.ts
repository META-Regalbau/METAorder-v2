import { test } from "../fixtures/e2e.fixture";
import { expectNoCriticalA11yViolations } from "../fixtures/a11y";

test.describe("Sprint 8 - A11y Smoke", () => {
  test("Login-Seite ohne kritische Axe-Verstöße", async ({ page }) => {
    await page.goto("/");
    await expectNoCriticalA11yViolations(page);
  });
});
