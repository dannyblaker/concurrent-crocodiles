import { expect, test } from "./fixtures";

const themeAttr = "html[data-theme]";
const theme = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);
const pageBackground = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("first visit", () => {
  test.use({ colorScheme: "dark" });

  test("follows a dark OS preference", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("first visit on a light desktop", () => {
  test.use({ colorScheme: "light" });

  test("follows a light OS preference", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "light");
  });
});

test.describe("switching", () => {
  test.use({ colorScheme: "dark" });

  test("the top bar button flips the theme and repaints the page", async ({ page }) => {
    await page.goto("/");
    const dark = await pageBackground(page);

    await page.getByRole("button", { name: /toggle light or dark theme/i }).first().click();
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "light");
    expect(await pageBackground(page)).not.toBe(dark);

    await page.getByRole("button", { name: /toggle light or dark theme/i }).first().click();
    expect(await pageBackground(page)).toBe(dark);
  });

  test("the m key flips it too", async ({ page }) => {
    await page.goto("/");
    await page.locator("body").click();
    await page.keyboard.press("m");
    expect(await theme(page)).toBe("light");
    await page.keyboard.press("m");
    expect(await theme(page)).toBe("dark");
  });

  test("m does nothing while typing in a field", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(/Add task/).fill("meeting notes");
    expect(await theme(page)).toBe("dark");
    expect(await page.getByPlaceholder(/Add task/).inputValue()).toBe("meeting notes");
  });
});

test.describe("persistence", () => {
  test.use({ colorScheme: "dark" });

  test("survives a reload and is applied before the first paint", async ({ page }) => {
    // record what the theme was at DOMContentLoaded — i.e. after the inline
    // <head> script but before React hydrates. If the boot script were missing
    // this would read "dark" and the page would visibly flash.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __themeAtParse?: string }).__themeAtParse =
          document.documentElement.dataset.theme;
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /toggle light or dark theme/i }).first().click();
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "light");

    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { __themeAtParse?: string }).__themeAtParse)
    ).toBe("light");
    expect(await theme(page)).toBe("light");
  });

  test("is per-device, not part of the plan that gets shared", async ({ page, planServer }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /toggle light or dark theme/i }).first().click();
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "light");
    expect(JSON.stringify(planServer.current())).not.toContain("light");
  });
});

/**
 * The canvas the flowchart floats on is a second per-device preference, stamped
 * before first paint by the same script and stored by the same means.
 */
test.describe("the canvas", () => {
  const canvasAttr = "html[data-canvas]";
  const canvas = (page: import("@playwright/test").Page) =>
    page.evaluate(() => document.documentElement.dataset.canvas);

  test("is plain until you say otherwise", async ({ page }) => {
    await page.goto("/");
    expect(await canvas(page)).toBe("plain");
    // the water is a real element, not a background on the board, and it stays out of sight
    await expect(page.locator(".croc-surface")).toBeHidden();
  });

  test("the w key and the top bar button both flip it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /animated water/i }).first().click();
    await expect(page.locator(canvasAttr)).toHaveAttribute("data-canvas", "water");
    await expect(page.locator(".croc-surface")).toBeVisible();

    await page.locator("body").click();
    await page.keyboard.press("w");
    await expect(page.locator(canvasAttr)).toHaveAttribute("data-canvas", "plain");
  });

  test("survives a reload, and is applied before the first paint", async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __canvasAtParse?: string }).__canvasAtParse =
          document.documentElement.dataset.canvas;
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: /animated water/i }).first().click();
    await expect(page.locator(canvasAttr)).toHaveAttribute("data-canvas", "water");

    await page.reload();
    expect(
      await page.evaluate(
        () => (window as unknown as { __canvasAtParse?: string }).__canvasAtParse
      )
    ).toBe("water");
    expect(await canvas(page)).toBe("water");
  });

  test("is per-device, not part of the plan that gets shared", async ({ page, planServer }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /animated water/i }).first().click();
    await expect(page.locator(canvasAttr)).toHaveAttribute("data-canvas", "water");
    expect(JSON.stringify(planServer.current())).not.toContain("water");
  });
});

test.describe("the share page", () => {
  test.use({ colorScheme: "light" });

  test("carries the visitor's own preference and can switch", async ({ page, planServer }) => {
    await page.goto(`/share/${planServer.current().shareToken}`);
    await expect(page.getByText("live · read-only")).toBeVisible();
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
    await expect(page.locator(themeAttr)).toHaveAttribute("data-theme", "dark");
  });
});
