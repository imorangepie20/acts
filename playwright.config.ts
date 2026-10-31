import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env")) process.loadEnvFile(".env");

const settingsSpecs = /(admin|vouchers-approval|closing|payroll)\.spec\.ts$/;
// Template showcase specs (components/dashboards/apps pages): flaky, so they live in their own project.
const showcaseSpecs = /(components|dashboards|apps)-[^/]*\.spec\.ts$/;
const admin = { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:3710", trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      retries: 1,
      testIgnore: [/auth\.setup\.ts/, settingsSpecs, showcaseSpecs],
      dependencies: ["setup"],
      use: admin,
    },
    {
      name: "showcase",
      retries: 1,
      testMatch: showcaseSpecs,
      dependencies: ["setup"],
      use: admin,
    },
    {
      // Specs that change company settings (approval on/off) would race the others, so they run
      // after everything else, and one file at a time (a project cannot cap its own workers, so
      // the two files are chained as two projects).
      name: "settings-serial",
      // payroll.spec.ts writes employees, a 2026-01 run and its voucher (shared state).
      testMatch: /(admin|payroll)\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["chromium"],
      use: admin,
    },
    {
      name: "settings-serial-approval",
      testMatch: /vouchers-approval\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["settings-serial"],
      use: admin,
    },
    {
      // Month close/reopen (fiscal year 2000) runs last: a voucher written by another spec while a
      // month is closed, or a pending voucher left by the approval spec, would interfere.
      name: "settings-serial-closing",
      testMatch: /closing\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["settings-serial-approval"],
      use: admin,
    },
  ],
  webServer: {
    command: "pnpm db:migrate && pnpm db:seed && pnpm build && pnpm start",
    url: "http://localhost:3710",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
