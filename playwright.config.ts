import { defineConfig, devices } from "@playwright/test";
const base = process.env.VITE_BASE_PATH || "/";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:4173${base}`, trace: "retain-on-failure" },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
