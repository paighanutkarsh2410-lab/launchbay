import { expect, type Page, test } from "@playwright/test";

// One service launched through the wizard, shared by the tests that follow it.
const service = `e2e-${Date.now().toString(36)}`;

test.describe.configure({ mode: "serial" });

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

test("mission control shows the platform at a glance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ship a service");
  await expect(page.getByText("Seven stages, fully automated")).toBeVisible();
  await expect(page.getByText(/Every launch passes \w+ guardrails/)).toBeVisible();
  await expect(page.getByText("Hardened pods")).toBeVisible();
});

test("a launch goes through every stage to a live service", async ({ page }) => {
  await page.goto("/launch");
  await page.getByRole("button", { name: /Python API/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();

  await page.getByLabel("Service name").fill(service);
  await expect(page.getByText(`${service} is available`)).toBeVisible();
  await page.getByLabel("Owner").fill("team-e2e");
  await page.getByLabel("Description").fill("Launched by the portal's smoke tests.");
  const bucket = page.getByRole("checkbox", { name: /Object storage/ });
  await bucket.click();
  await expect(bucket).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /Continue/ }).click();

  await page.getByRole("button", { name: `Launch ${service}` }).click();
  await expect(page).toHaveURL(new RegExp(`/services/${service}$`), { timeout: 20_000 });
  await expect(page.getByText(`${service} is live`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Cloud resources", { exact: false }).first()).toBeVisible();
});

test("the catalog and the command palette find the service", async ({ page }) => {
  await page.goto("/services");
  await expect(page.getByText(service).first()).toBeVisible();

  await page.goto("/");
  await page.keyboard.press("Control+k");
  const search = page.getByPlaceholder("Type a command or search…");
  await expect(search).toBeVisible();
  await search.fill(service);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/services/${service}$`));
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const path of ["/", "/services", "/launch"]) {
    test(`${path} fits the screen`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoSidewaysScroll(page);
    });
  }

  test("a service page fits the screen", async ({ page }) => {
    await page.goto(`/services/${service}`);
    await expect(page.getByText(`${service} is live`)).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
