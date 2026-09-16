import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /*
   * One, not "half the cores", which is what Playwright picks on its own. Every
   * worker is a Chromium holding the whole app, and four of them running
   * alongside the dev server were enough to take a machine down. One worker
   * gets through the suite in well under a minute anyway. Raise it with
   * E2E_WORKERS if your machine has the room.
   */
  workers: process.env.CI ? 1 : Number(process.env.E2E_WORKERS ?? 1),
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    /*
     * The board can float on animated water, and the suite is not here to test it:
     * eight browsers repainting a pool each made pointer timing flaky enough to
     * fail drags that pass on their own. Reduced motion stops the drift and
     * changes nothing else — same markup, same canvas, same everything the tests
     * actually assert. The tests that *are* about the water live in theme.spec.
     */
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The suite stubs /api/plan in the browser, so no run ever touches the
    // real data/plan.json — the route itself is covered in tests/api-plan.
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
