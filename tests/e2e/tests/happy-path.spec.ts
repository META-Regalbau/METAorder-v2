import { test, expect } from "../fixtures/e2e.fixture";
import { selectors } from "../config/selectors";
import { CpqConfiguratorPage } from "../pages/cpq-configurator.page";
import { OffersPage } from "../pages/offers.page";
import { expectNoCriticalA11yViolations } from "../fixtures/a11y";

test.describe("Sprint 8 - Happy Path", () => {
  test("Login -> CPQ -> Angebotsbereich", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await expect(page.locator(selectors.nav.configurator)).toBeVisible();

    const cpqPage = new CpqConfiguratorPage(page);
    await cpqPage.goto();
    await cpqPage.selectFirstSystem();
    await cpqPage.nextStep(4);

    await expect(page.locator(selectors.cpq.validateCore)).toBeVisible();
    await page.locator(selectors.cpq.validateCore).click();
    await expect(page.getByText(/Klasse [ABC]/).first()).toBeVisible();

    await expect(page.locator(selectors.cpq.priceCore)).toBeVisible();
    await page.locator(selectors.cpq.priceCore).click();
    await expect(page.getByText(/Preisvorschau:/)).toBeVisible();

    const createOfferButton = page.locator(selectors.cpq.createOfferDraft);
    if (await createOfferButton.count()) {
      await expect(createOfferButton).toBeVisible();
    }
    if ((await createOfferButton.count()) > 0 && await createOfferButton.isEnabled()) {
      await createOfferButton.click();
      await expect(page).toHaveURL(/\/offers/);
      const offersPage = new OffersPage(page);
      await offersPage.goto();
      await expectNoCriticalA11yViolations(page);
    } else {
      await expect(page.getByText(/Keine Stückliste|keine aktiven Produkt-Mappings|Bitte im CPQ Admin/i).first()).toBeVisible();
    }
  });
});
