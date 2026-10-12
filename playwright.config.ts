import { defineConfig } from "@playwright/test";

// End-to-end tests run against a built app (`next start`) connected to a local Supabase
// stack. See tests/e2e/README.md. Never point these at a production project.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
});
