import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The smoke tests drive the real portal against a real API in demo mode: no GitHub, cluster or
// cloud needed. Both run on their own ports, so a Launchbay already running on 5173/8000 is untouched.
const API_PORT = 8100;
const PORTAL_PORT = 5174;
const python = process.env.LAUNCHBAY_PYTHON ?? "python";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORTAL_PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: "../../services/api",
      url: `http://127.0.0.1:${API_PORT}/api/healthz`,
      reuseExistingServer: false,
      env: {
        LAUNCHBAY_DATABASE_URL: `sqlite+aiosqlite:///${join(tmpdir(), `launchbay-e2e-${Date.now()}.db`).replace(/\\/g, "/")}`,
        LAUNCHBAY_PROVIDER: "demo",
        LAUNCHBAY_DEMO_SPEED: "10", // ten times faster than a real launch
        LAUNCHBAY_CLOUD: "simulated",
        LAUNCHBAY_EXPLAINER: "rules",
      },
    },
    {
      command: `npm run dev -- --port ${PORTAL_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${PORTAL_PORT}`,
      reuseExistingServer: false,
      env: { LAUNCHBAY_API: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
