import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["crew-feature.spec.ts", "crew-needs.spec.ts"],
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4199",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: "./node_modules/.bin/vite --config crew-feature.vite.config.ts --host 127.0.0.1 --port 4199 --strictPort",
    url: "http://127.0.0.1:4199",
    env: { R2_API_URL: "http://127.0.0.1:5319" },
    reuseExistingServer: false,
  },
});
