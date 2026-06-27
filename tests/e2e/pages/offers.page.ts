import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { selectors } from "../config/selectors";

export class OffersPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/offers");
    await expect(this.page.locator(selectors.offers.heading)).toBeVisible();
  }
}
