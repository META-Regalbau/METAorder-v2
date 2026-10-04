import { test } from "../fixtures/e2e.fixture";
import { expectNoCriticalA11yViolations } from "../fixtures/a11y";

test.describe("Sprint 8 - A11y Smoke", () => {
  test("Login-Seite ohne kritische Axe-Verstöße", async ({ page }) => {
    await page.goto("/");
    await expectNoCriticalA11yViolations(page);
  });

  // Haeufig genutzte Seiten nach der Anmeldung (Kopfzeile, Seitenleiste, Tabellen, Filter)
  for (const route of ["/", "/orders", "/offers", "/shipping", "/delayed", "/analytics", "/tickets", "/settings"]) {
    test(`${route} ohne kritische Axe-Verstöße`, async ({ page, loginAsAdmin }) => {
      await loginAsAdmin();
      await page.goto(route);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expectNoCriticalA11yViolations(page);
    });
  }
});
