import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const useChrome =
  process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app");
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4311",
    ...devices["Desktop Chrome"],
    ...(useChrome ? { channel: "chrome" } : {}),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4311/api/health",
    reuseExistingServer: false,
    timeout: 45000,
    env: {
      PORT: "4311",
      CARDIO_DATA_DIR: path.join(tmpdir(), "cardio-e2e-" + Date.now()),
    },
  },
});
