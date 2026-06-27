import { test, expect } from "../fixtures/e2e.fixture";

test.describe("Sprint 8 - Public Offer Guardrail", () => {
  test("ungültiger Angebotstoken zeigt Fehlerzustand statt Blank Page", async ({ page }) => {
    await page.goto("/angebot/invalid-token-for-e2e");
    await expect(page.getByText(/ungültig|invalid|nicht gefunden|abgelaufen/i)).toBeVisible();
  });
});
