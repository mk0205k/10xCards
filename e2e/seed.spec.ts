import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("sign-in persists the session across reload", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  test.skip(!email || !password, "E2E_USER_EMAIL and E2E_USER_PASSWORD required");

  await page.goto("/auth/signin");

  await page.getByRole("textbox", { name: "Email" }).fill(email!);
  await page.getByRole("textbox", { name: "Hasło" }).fill(password!);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  await page.waitForURL("**/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.context().clearCookies();
});

// Reference exemplar from .claude/skills/10x-e2e/references/seed-test-pattern.md.
// The role names below ("New deck", "Deck name", "Create", "Delete deck", "Confirm")
// do not exist in this app — kept as a pattern template only. Skipped, do not enable.
test.skip("created deck persists after page reload", async ({ page }) => {
  const deckName = `Test Deck ${Date.now()}`;
  await page.goto("/");

  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByRole("textbox", { name: "Deck name" }).fill(deckName);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("heading", { name: deckName })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: deckName })).toBeVisible();

  await page.getByRole("button", { name: "Delete deck" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
});
