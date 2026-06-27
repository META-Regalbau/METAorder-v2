import { test, expect } from "../fixtures/e2e.fixture";
import { selectors } from "../config/selectors";
import { OffersPage } from "../pages/offers.page";
import { expectNoCriticalA11yViolations } from "../fixtures/a11y";

test.describe("Sprint 8 - Offers Flow", () => {
  test("öffnet Angebotsseite und filtert robust", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    const offersPage = new OffersPage(page);
    await offersPage.goto();

    const searchField = page.locator("[data-testid='input-search-offers']");
    await expect(searchField).toBeVisible();
    await searchField.fill("demo");
    await page.locator("[data-testid='button-refresh-offers']").click();
    await expect(page.locator(selectors.offers.heading)).toBeVisible();

    await expectNoCriticalA11yViolations(page);
  });
});
