import { defineConfig } from '@playwright/test';

// Recording config for docs/demos — NOT the test suite in /e2e.
//
// /e2e/playwright.config.ts drops job-tracker-test/jobmatch-test on every run
// (see e2e/global-setup.ts) and asserts behavior. This config instead points
// the three dev servers at the PERSISTENT seeded demo-recording databases
// (never dropped — see docs/demos/README.md for the seed commands) with
// DemoMode=true, so a recorded clip looks exactly like what a real public-demo
// visitor sees. No globalSetup/globalTeardown: nothing here is ever reset.
const API_PORT = 5002;
const SCRAPER_PORT = 8000;
const FRONTEND_PORT = 5173;

const demoDbEnv = {
  MongoDB__DatabaseName: 'job-tracker-demo-recording',
  MongoDB__ProfileDatabase: 'jobmatch-demo-recording',
};

export default defineConfig({
  testDir: './specs',
  outputDir: './output/test-results',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['line']],

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    // Fixed viewport == recorded video size below: no letterboxing.
    viewport: { width: 1280, height: 800 },
    video: {
      mode: 'on',
      size: { width: 1280, height: 800 },
    },
    trace: 'off',
    screenshot: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  webServer: [
    {
      command: 'dotnet run --project ../../server/api/src/Api/ApplicationTracker.Api.csproj',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        DemoMode: 'true',
        ...demoDbEnv,
      },
      timeout: 30_000,
    },
    {
      command: 'python -m uvicorn app.main:app --host 0.0.0.0 --port 8000',
      cwd: '../../server/scraper',
      port: SCRAPER_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        MONGODB_DATABASE_NAME: 'job-tracker-demo-recording',
        API_BASE_URL: `http://localhost:${API_PORT}`,
        DEMO_MODE: 'true',
      },
      timeout: 15_000,
    },
    {
      command: 'npx vite --port 5173',
      cwd: '../../client',
      port: FRONTEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
  ],
});
