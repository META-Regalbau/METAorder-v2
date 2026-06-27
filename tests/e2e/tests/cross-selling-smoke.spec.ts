import { test, expect } from "../fixtures/e2e.fixture";

test.describe("Cross-Selling Admin Smoke", () => {
  test("Login -> Cross-Selling-Regeln Seite", async ({ page, loginAsAdmin }) => {
    await loginAsAdmin();
    await page.goto("/cross-selling-rules");
    await expect(page.getByTestId("page-rules")).toBeVisible();
    await expect(page.getByTestId("text-page-title")).toBeVisible();
  });
});
