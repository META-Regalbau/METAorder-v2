import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { selectors } from "../config/selectors";

export class CpqConfiguratorPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/configurator");
    await expect(this.page.locator(selectors.cpq.heading)).toBeVisible();
  }

  systemCards(): Locator {
    return this.page.locator("[data-testid^='cpq-system-card-']");
  }

  async selectFirstSystem(): Promise<void> {
    const cards = this.systemCards();
    await expect(cards.first(), "Kein CPQ-System gefunden. TODO verify: CPQ Seed-/Stammdaten prüfen.").toBeVisible();
    await cards.first().click();
  }

  async nextStep(times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await this.page.locator(selectors.cpq.nextStep).click();
    }
  }
}
