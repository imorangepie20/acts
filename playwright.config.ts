import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:3710", trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
    },
  ],
  webServer: {
    command: "pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start",
    url: "http://localhost:3710",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
