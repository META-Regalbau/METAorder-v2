import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { selectors } from "../config/selectors";

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/");
    await expect(this.page.locator(selectors.login.username)).toBeVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.locator(selectors.login.username).fill(username);
    await this.page.locator(selectors.login.password).fill(password);
    await Promise.all([
      this.page.waitForResponse((response) => response.url().includes("/api/auth/login")),
      this.page.locator(selectors.login.submit).click(),
    ]);
    await this.page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}
