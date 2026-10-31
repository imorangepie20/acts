import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { "server-only": path.resolve(__dirname, "tests/server-only-stub.ts") } },
  test: {
    environment: "node",
    // fixed 32-byte test key (base64), never used outside tests
    env: { PAYROLL_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=" },
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: "tests/global-setup.ts",
    fileParallelism: false,
  },
});
