import { test as setup } from "@playwright/test";

const STORAGE_STATE_PATH = "playwright/.auth/user.json";

setup("authenticate", async ({ page, context }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL and E2E_USER_PASSWORD must be set. Copy .env.e2e.example to .env.e2e and fill it in.",
    );
  }

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321";
  const { hostname } = new URL(baseURL);

  await context.addCookies([
    {
      name: "PARAGLIDE_LOCALE",
      value: "pl",
      domain: hostname,
      path: "/",
    },
  ]);

  await page.goto("/auth/signin");

  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Hasło" }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  await page.waitForURL("**/dashboard");

  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
