import { test as base } from "@playwright/test";
import { E2E_ENV, requireE2EEnv } from "../config/env";
import { LoginPage } from "../pages/login.page";

type E2EFixtures = {
  loginAsAdmin: () => Promise<void>;
};

export const test = base.extend<E2EFixtures>({
  loginAsAdmin: async ({ page }, use) => {
    const loginAsAdmin = async () => {
      requireE2EEnv();
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(E2E_ENV.username, E2E_ENV.password);
    };

    await use(loginAsAdmin);
  },
});

export { expect } from "@playwright/test";
