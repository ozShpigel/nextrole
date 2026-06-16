import { test, expect } from '@playwright/test';
import { clearAll } from '../fixtures/helpers';

// The /score page's "Score Job" action posts to POST /api/match, which on the
// real backend triggers two paid Claude calls (analyst + evaluator). To keep
// these tests free, we intercept that one request with page.route() and return
// a canned MatchResponse — the browser never reaches the backend, so no AI call
// happens. The *save* path (POST /api/applications) is left un-mocked: it's a
// plain MongoDB write against the test DB, so it costs nothing and we still get
// real end-to-end coverage of score → render → save → view-in-tracker.

const MOCK_MATCH = {
  jobTitle: 'Senior Backend Engineer',
  company: 'Acme Inc.',
  overallScore: 78,
  verdict: 'YES',
  breakdown: {
    technicalFit: { score: 28, maxScore: 35, components: [], strengths: ['Strong Node.js match'], gaps: [] },
    engineeringExecutionFit: { score: 24, maxScore: 30, components: [], strengths: ['Healthy practices'], concerns: [] },
    sustainabilityPaceFit: { score: 26, maxScore: 35, components: [], positiveSignals: ['Sustainable pace'], concerns: [] },
  },
  recommendation: {
    shouldApply: true,
    keyReasons: ['Strong technical fit'],
    questionsToAsk: [],
    redFlags: [],
    greenFlags: ['Great stack match'],
  },
  honestAssessment: 'A solid match overall.',
  companyNewsAnalysis: null,
  analystSnapshotInput: 'analyst-in',
  analystSnapshotOutput: 'analyst-out',
  evaluatorSnapshotInput: 'eval-in',
  evaluatorSnapshotOutput: 'eval-out',
};

const LONG_DESCRIPTION =
  'We are hiring a Senior Backend Engineer to design and operate our core services. ' +
  'Strong Node.js and cloud experience required. Healthy engineering culture and sustainable pace.';

// Intercept only the exact scoring endpoint (not /api/match/* or /api/applications).
async function mockScoring(page: import('@playwright/test').Page) {
  await page.route('**/api/match', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MATCH),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe('Manual Score — /score', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('Score Job is disabled until the description is long enough', async ({ page }) => {
    await page.goto('/score');

    const scoreButton = page.getByRole('button', { name: 'Score Job' });
    await expect(scoreButton).toBeDisabled();

    await page.getByLabel('Job Description').fill('too short');
    await expect(scoreButton).toBeDisabled();

    await page.getByLabel('Job Description').fill(LONG_DESCRIPTION);
    await expect(scoreButton).toBeEnabled();
  });

  test('scoring renders the analysis without a real AI call', async ({ page }) => {
    await mockScoring(page);
    await page.goto('/score');

    await page.getByLabel('Job Title').fill('Senior Backend Engineer');
    await page.getByLabel('Company').fill('Acme Inc.');
    await page.getByLabel('Job Description').fill(LONG_DESCRIPTION);

    await page.getByRole('button', { name: 'Score Job' }).click();

    // AnalysisCard rendered from the mocked response.
    await expect(page.getByRole('heading', { name: 'AI Analysis' })).toBeVisible();
    await expect(page.getByText('78', { exact: true })).toBeVisible();
    await expect(page.getByText('Worth Applying')).toBeVisible();
  });

  test('saving a scored job persists it to the tracker', async ({ page }) => {
    await mockScoring(page);
    await page.goto('/score');

    await page.getByLabel('Job Title').fill('Senior Backend Engineer');
    await page.getByLabel('Company').fill('Acme Inc.');
    await page.getByLabel('Job Description').fill(LONG_DESCRIPTION);

    await page.getByRole('button', { name: 'Score Job' }).click();
    await expect(page.getByRole('heading', { name: 'AI Analysis' })).toBeVisible();

    // Real save — POST /api/applications writes to the test DB (no AI cost).
    await page.getByRole('button', { name: 'Save to Tracker' }).click();
    await expect(page.getByText('Saved to your tracker.')).toBeVisible();

    // Follow the link and confirm the application really persisted.
    await page.getByRole('link', { name: 'View in Tracker' }).click();
    await expect(page).toHaveURL(/\/tracker\/[0-9a-fA-F-]+$/);
    await expect(page.getByRole('heading', { name: 'Senior Backend Engineer' })).toBeVisible();
  });
});
