import { defineConfig } from '@playwright/test';

const API_PORT = 5002;
const SCRAPER_PORT = 5001;
const FRONTEND_PORT = 5173;

const testDbEnv = {
  MongoDB__DatabaseName: 'job-tracker-test',
  MongoDB__Database: 'jobmatch-test',
  MongoDB__ProfileDatabase: 'jobmatch-test',
};

export default defineConfig({
  globalSetup: '../e2e/global-setup.js',
  testDir: '../e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  webServer: [
    {
      command: 'dotnet run --project ../API/src/Api/ApplicationTracker.Api.csproj',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        ...testDbEnv,
      },
      timeout: 30_000,
    },
    {
      command: 'python -m uvicorn app.main:app --host 0.0.0.0 --port 5001',
      cwd: '../Scraper',
      port: SCRAPER_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        MONGODB_DATABASE_NAME: 'job-tracker-test',
        API_BASE_URL: `http://localhost:${API_PORT}`,
      },
      timeout: 15_000,
    },
    {
      command: 'npx vite --port 5173',
      port: FRONTEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
  ],
});
