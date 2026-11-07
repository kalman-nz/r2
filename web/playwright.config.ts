import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT || "4179";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "crew-feature.spec.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: `./node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
