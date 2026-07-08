import { test, expect } from "@playwright/test";

test("run designFlow → timeline fills, graph renders, detail opens", async ({ page }) => {
  await page.goto("/");
  // trigger a run through the API the UI uses
  await page.evaluate(async () => {
    await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "designFlow", input: { message: "add /healthz" } }) });
  });
  // timeline shows the first workflow step
  await expect(page.getByText(/fetchFigma|classify|analyze/i).first()).toBeVisible({ timeout: 5000 });
  // graph canvas rendered (React Flow root)
  await expect(page.locator(".react-flow")).toBeVisible();
  // clicking a timeline row opens detail
  await page.locator("li").first().click();
  await expect(page.locator("pre").first()).toBeVisible();
});
