import { test, expect } from "../fixtures/e2e.fixture";
import { selectors } from "../config/selectors";
import { LoginPage } from "../pages/login.page";
import { E2E_ENV } from "../config/env";

test.describe("Sprint 8 - Auth Flow", () => {
  test("geschützte Route leitet auf Login", async ({ page }) => {
    await page.goto("/offers");
    await expect(page.locator(selectors.login.username)).toBeVisible();
    await expect(page.locator(selectors.login.password)).toBeVisible();
  });

  test("ungültiger Login bleibt auf Login-Seite", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(E2E_ENV.username, `${E2E_ENV.password}-invalid`);
    await expect(page.locator(selectors.login.username)).toBeVisible();
  });
});
