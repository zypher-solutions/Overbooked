import { defineConfig } from "@playwright/test";

// app keys (.env.local) and test logins (.env.test, here or one folder up) are gitignored
try { process.loadEnvFile(".env.local"); } catch {}
for (const f of [".env.test", "../.env.test"]) { try { process.loadEnvFile(f); break; } catch {} }

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
