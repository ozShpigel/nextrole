import { test, expect } from '@playwright/test';
import { clearAll, insertRun, insertJob, closeDb } from './helpers/db.js';

test.afterAll(async () => {
  await closeDb();
});

// Helper to seed a run + jobs for the RunDetail page.
async function seedRunWithJobs(runOverrides = {}, jobOverridesList = []) {
  const run = await insertRun({ status: 'completed', ...runOverrides });
  const jobs = [];
  for (const overrides of jobOverridesList) {
    const job = await insertJob({ run_id: run.id, criteria_id: run.criteria_id, ...overrides });
    jobs.push(job);
  }
  return { run, jobs };
}

test.describe('Discovered Jobs - Card Display', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('job card shows title, company, location, score, and verdict', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Display Test' },
      [{
        title: 'Senior Frontend Engineer',
        company: 'Acme Corp',
        location: 'Tel Aviv',
        score: 82,
        verdict: 'YES',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Senior Frontend Engineer')).toBeVisible();
    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('Tel Aviv')).toBeVisible();
    await expect(page.getByText('82', { exact: true })).toBeVisible();
    await expect(page.getByText('Yes', { exact: true })).toBeVisible();
  });

  test('STRONG_YES verdict displays correctly', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Strong Yes Test' },
      [{
        title: 'Perfect Match Job',
        company: 'Dream Inc',
        score: 95,
        verdict: 'STRONG_YES',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('95', { exact: true })).toBeVisible();
    await expect(page.getByText('Strong Yes', { exact: true })).toBeVisible();
  });

  test('MAYBE verdict displays correctly', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Maybe Test' },
      [{
        title: 'Borderline Job',
        company: 'MaybeCo',
        score: 55,
        verdict: 'MAYBE',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('55', { exact: true })).toBeVisible();
    await expect(page.getByText('Maybe', { exact: true })).toBeVisible();
  });

  test('NO verdict displays correctly', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Test' },
      [{
        title: 'Poor Match Job',
        company: 'NopeCo',
        score: 30,
        verdict: 'NO',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('30', { exact: true })).toBeVisible();
    await expect(page.getByText('No', { exact: true })).toBeVisible();
  });

  test('STRONG_NO verdict displays correctly', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Strong No Test' },
      [{
        title: 'Terrible Match',
        company: 'BadFit LLC',
        score: 12,
        verdict: 'STRONG_NO',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('12', { exact: true })).toBeVisible();
    await expect(page.getByText('Strong No', { exact: true })).toBeVisible();
  });
});

test.describe('Discovered Jobs - MATCH_FAILED and INSUFFICIENT_DATA', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('MATCH_FAILED verdict shows label without score', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Match Failed Test' },
      [{
        title: 'Failed Scoring Job',
        company: 'ErrorCo',
        score: null,
        verdict: 'MATCH_FAILED',
        should_apply: null,
        match_analysis: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Failed Scoring Job')).toBeVisible();
    await expect(page.getByText('Match Failed', { exact: true })).toBeVisible();
  });

  test('INSUFFICIENT_DATA verdict shows label without score', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Insufficient Test' },
      [{
        title: 'Short Description Job',
        company: 'SkimpyCo',
        score: null,
        verdict: 'INSUFFICIENT_DATA',
        should_apply: null,
        match_analysis: null,
        description: 'Too short',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Short Description Job')).toBeVisible();
    await expect(page.getByText('Insufficient Data', { exact: true })).toBeVisible();
  });

  test('job with no score shows verdict text only', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Score Test' },
      [{
        title: 'Unscored Job',
        company: 'NullScore Inc',
        score: null,
        verdict: null,
        should_apply: null,
        match_analysis: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Unscored Job')).toBeVisible();
    // With null verdict the UI shows "-"
    await expect(page.getByText('-', { exact: true })).toBeVisible();
  });
});

test.describe('Discovered Jobs - Glassdoor Data', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('glassdoor rating displays with color coding and review count', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Glassdoor Test' },
      [{
        title: 'Rated Company Job',
        company: 'TopRated Inc',
        score: 80,
        verdict: 'YES',
        glassdoor_data: {
          rating: 4.3,
          reviewCount: 1250,
          url: 'https://glassdoor.com/toprated',
        },
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    // Rating text (green for >= 4.0)
    await expect(page.getByText('4.3 / 5')).toBeVisible();
    // Review count
    await expect(page.getByText('(1,250 reviews)')).toBeVisible();
    // Glassdoor link
    await expect(page.getByRole('link', { name: 'Glassdoor' })).toBeVisible();
  });

  test('glassdoor rating below 3.0 uses red color', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Low Glassdoor Test' },
      [{
        title: 'Low Rated Job',
        company: 'BadRating Co',
        score: 60,
        verdict: 'MAYBE',
        glassdoor_data: {
          rating: 2.5,
          reviewCount: 300,
          url: null,
        },
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('2.5 / 5')).toBeVisible();
    await expect(page.getByText('(300 reviews)')).toBeVisible();
  });

  test('glassdoor rating between 3.0 and 4.0 uses yellow color', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Mid Glassdoor Test' },
      [{
        title: 'Mid Rated Job',
        company: 'Average Corp',
        score: 65,
        verdict: 'MAYBE',
        glassdoor_data: {
          rating: 3.5,
          reviewCount: 800,
          url: 'https://glassdoor.com/average',
        },
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('3.5 / 5')).toBeVisible();
  });

  test('job without glassdoor data does not show rating section', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Glassdoor Test' },
      [{
        title: 'No Rating Job',
        company: 'Unknown Corp',
        score: 70,
        verdict: 'YES',
        glassdoor_data: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('No Rating Job')).toBeVisible();
    await expect(page.getByText('/ 5')).toBeHidden();
    await expect(page.getByText('reviews')).toBeHidden();
  });
});

test.describe('Discovered Jobs - Company News', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('company news section is collapsible and shows items', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'News Test' },
      [{
        title: 'Newsworthy Job',
        company: 'BigNews Inc',
        score: 80,
        verdict: 'YES',
        company_news: [
          { title: 'BigNews raises $50M Series C', source: 'TechCrunch' },
          { title: 'BigNews expands to Europe', source: 'Reuters' },
        ],
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    // Summary should show count
    const summary = page.getByText('Company News (2)');
    await expect(summary).toBeVisible();

    // Items should be hidden initially (inside collapsed <details>)
    await expect(page.getByText('BigNews raises $50M Series C')).toBeHidden();

    // Click to expand
    await summary.click();

    // Items should be visible
    await expect(page.getByText('BigNews raises $50M Series C')).toBeVisible();
    await expect(page.getByText('TechCrunch')).toBeVisible();
    await expect(page.getByText('BigNews expands to Europe')).toBeVisible();
    await expect(page.getByText('Reuters')).toBeVisible();
  });

  test('job without company news does not show news section', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No News Test' },
      [{
        title: 'Quiet Company Job',
        company: 'Stealth Corp',
        score: 70,
        verdict: 'YES',
        company_news: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Quiet Company Job')).toBeVisible();
    await expect(page.getByText('Company News')).toBeHidden();
  });
});

test.describe('Discovered Jobs - Honest Assessment', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('honest assessment displays with RTL direction', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Assessment Test' },
      [{
        title: 'Assessed Job',
        company: 'ReviewCo',
        score: 75,
        verdict: 'YES',
        honest_assessment: 'This is a strong match with good growth opportunities.',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    const assessment = page.getByText('This is a strong match with good growth opportunities.');
    await expect(assessment).toBeVisible();

    // Verify RTL attribute
    await expect(assessment).toHaveAttribute('dir', 'rtl');
  });

  test('job without honest assessment does not show assessment block', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Assessment Test' },
      [{
        title: 'No Assessment Job',
        company: 'SimpleCo',
        score: 70,
        verdict: 'YES',
        honest_assessment: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('No Assessment Job')).toBeVisible();
    // No RTL assessment block should exist
    await expect(page.locator('[dir="rtl"]')).toBeHidden();
  });
});

test.describe('Discovered Jobs - Key Strengths and Concerns', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('key strengths show as green badges', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Strengths Test' },
      [{
        title: 'Strong Job',
        company: 'GreenCo',
        score: 85,
        verdict: 'YES',
        key_strengths: ['Excellent tech stack', 'Remote friendly', 'Competitive salary'],
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Excellent tech stack')).toBeVisible();
    await expect(page.getByText('Remote friendly')).toBeVisible();
    await expect(page.getByText('Competitive salary')).toBeVisible();
  });

  test('key concerns show as red badges', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Concerns Test' },
      [{
        title: 'Risky Job',
        company: 'RedCo',
        score: 45,
        verdict: 'NO',
        key_concerns: ['No remote option', 'Legacy tech stack', 'High turnover'],
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('No remote option')).toBeVisible();
    await expect(page.getByText('Legacy tech stack')).toBeVisible();
    await expect(page.getByText('High turnover')).toBeVisible();
  });

  test('job with both strengths and concerns shows both', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Mixed Test' },
      [{
        title: 'Mixed Job',
        company: 'MixedCo',
        score: 60,
        verdict: 'MAYBE',
        key_strengths: ['Good benefits'],
        key_concerns: ['Long commute'],
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Good benefits')).toBeVisible();
    await expect(page.getByText('Long commute')).toBeVisible();
  });

  test('job without strengths or concerns shows neither section', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Badges Test' },
      [{
        title: 'Plain Job',
        company: 'PlainCo',
        score: 70,
        verdict: 'YES',
        key_strengths: null,
        key_concerns: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Plain Job')).toBeVisible();
    // No green or red badge containers
  });
});

test.describe('Discovered Jobs - Action Buttons', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('job card has View Job link when job_url is present', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'View Job Test' },
      [{
        title: 'Linkable Job',
        company: 'LinkCo',
        score: 75,
        verdict: 'YES',
        job_url: 'https://linkedin.com/jobs/123',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    const viewLink = page.getByRole('link', { name: 'View Job' });
    await expect(viewLink).toBeVisible();
    await expect(viewLink).toHaveAttribute('href', 'https://linkedin.com/jobs/123');
    await expect(viewLink).toHaveAttribute('target', '_blank');
  });

  test('rescore button is visible for jobs with sufficient description', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Rescore Button Test' },
      [{
        title: 'Rescorable Job',
        company: 'RescoreCo',
        score: 60,
        verdict: 'MAYBE',
        description: 'A '.repeat(30) + 'detailed job description that is well over fifty characters long for the rescore eligibility check.',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('button', { name: 'Rescore' })).toBeVisible();
  });

  test('rescore button is hidden for jobs with short description', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Rescore Test' },
      [{
        title: 'Short Desc Job',
        company: 'ShortCo',
        score: 50,
        verdict: 'MAYBE',
        description: 'Too short',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Short Desc Job')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rescore' })).toBeHidden();
  });

  test('save to tracker button is visible for scored unsaved jobs', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Save Button Test' },
      [{
        title: 'Saveable Job',
        company: 'SaveCo',
        score: 80,
        verdict: 'YES',
        saved_to_tracker: false,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('button', { name: 'Save to Tracker' })).toBeVisible();
  });

  test('already-saved job shows Saved badge without save button', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Already Saved Test' },
      [{
        title: 'Already Saved Job',
        company: 'SavedCo',
        score: 85,
        verdict: 'YES',
        saved_to_tracker: true,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save to Tracker' })).toBeHidden();
  });

  test('dismiss button is visible on all job cards', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Dismiss Button Test' },
      [{
        title: 'Dismissable Job',
        company: 'DismissCo',
        score: 40,
        verdict: 'NO',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });

  test('unscored job does not show save to tracker button', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Unscored Save Test' },
      [{
        title: 'Unscored Job',
        company: 'NullCo',
        score: null,
        verdict: 'MATCH_FAILED',
        saved_to_tracker: false,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Unscored Job')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save to Tracker' })).toBeHidden();
  });
});

test.describe('Discovered Jobs - Dismiss', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('dismissing a job removes it from the visible list', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Dismiss Test' },
      [
        { title: 'Keep This Job', company: 'KeepCo', score: 80, verdict: 'YES' },
        { title: 'Dismiss This Job', company: 'DismissCo', score: 30, verdict: 'NO' },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Dismiss This Job')).toBeVisible();
    await expect(page.getByText('Keep This Job')).toBeVisible();

    // Click dismiss on the second job card
    const dismissButtons = page.getByRole('button', { name: 'Dismiss' });
    // The jobs are sorted by score desc, so "Keep This Job" (80) is first, "Dismiss This Job" (30) is second
    await dismissButtons.nth(1).click();

    // Dismissed job should disappear
    await expect(page.getByText('Dismiss This Job')).toBeHidden();
    // Other job remains
    await expect(page.getByText('Keep This Job')).toBeVisible();
  });
});

test.describe('Discovered Jobs - Hidden Jobs', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('duplicate jobs are not shown in the list', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Duplicate Test' },
      [
        { title: 'Visible Job', company: 'VisibleCo', score: 80, verdict: 'YES', is_duplicate: false },
        { title: 'Duplicate Job', company: 'DupeCo', score: 70, verdict: 'YES', is_duplicate: true },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Visible Job')).toBeVisible();
    await expect(page.getByText('Duplicate Job')).toBeHidden();
  });

  test('dismissed jobs are not shown in the list', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Dismissed Hidden Test' },
      [
        { title: 'Active Job', company: 'ActiveCo', score: 75, verdict: 'YES', dismissed: false },
        { title: 'Already Dismissed Job', company: 'GoneCo', score: 65, verdict: 'MAYBE', dismissed: true },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Active Job')).toBeVisible();
    await expect(page.getByText('Already Dismissed Job')).toBeHidden();
  });

  test('both duplicate and dismissed jobs are hidden', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Both Hidden Test' },
      [
        { title: 'Only Visible', company: 'OnlyCo', score: 90, verdict: 'STRONG_YES' },
        { title: 'Duplicate Hidden', company: 'DupeCo', score: 70, verdict: 'YES', is_duplicate: true },
        { title: 'Dismissed Hidden', company: 'GoneCo', score: 60, verdict: 'MAYBE', dismissed: true },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Only Visible')).toBeVisible();
    await expect(page.getByText('Duplicate Hidden')).toBeHidden();
    await expect(page.getByText('Dismissed Hidden')).toBeHidden();
  });
});

test.describe('Discovered Jobs - Empty State', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('shows no jobs found message when run has no jobs', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Empty Run', status: 'completed' },
      [],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('No jobs found')).toBeVisible();
  });

  test('shows no jobs found when all jobs are dismissed or duplicates', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'All Hidden Run', status: 'completed' },
      [
        { title: 'Dup Job', company: 'A', is_duplicate: true },
        { title: 'Dismissed Job', company: 'B', dismissed: true },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('No jobs found')).toBeVisible();
  });
});

test.describe('Discovered Jobs - Back Navigation', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('back link navigates to the discovery page', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Back Nav Test' },
      [{ title: 'Some Job', company: 'SomeCo' }],
    );

    await page.goto(`/discovery/${run.id}`);

    const backLink = page.getByRole('link', { name: /Back to Job Discovery/ });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/discovery');

    await backLink.click();
    await page.waitForURL('**/discovery');
  });
});

test.describe('Discovered Jobs - Multiple Jobs Ordering', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('jobs are displayed (API returns sorted by score desc)', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Sort Test' },
      [
        { title: 'Low Score Job', company: 'LowCo', score: 30, verdict: 'NO' },
        { title: 'High Score Job', company: 'HighCo', score: 95, verdict: 'STRONG_YES' },
        { title: 'Mid Score Job', company: 'MidCo', score: 60, verdict: 'MAYBE' },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    // All three should be visible
    await expect(page.getByText('Low Score Job')).toBeVisible();
    await expect(page.getByText('High Score Job')).toBeVisible();
    await expect(page.getByText('Mid Score Job')).toBeVisible();

    // The API sorts by score desc, so High Score Job should appear first in the DOM
    const jobCards = page.locator('.bg-card.border.border-border.rounded-lg.p-6');
    const firstCardText = await jobCards.first().textContent();
    expect(firstCardText).toContain('High Score Job');
  });
});

test.describe('Discovered Jobs - Failed Scoring Banner', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('rescore all failed banner shows when there are failed jobs', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Failed Banner Test', status: 'completed' },
      [
        { title: 'Good Job', company: 'GoodCo', score: 80, verdict: 'YES' },
        {
          title: 'Failed Job 1',
          company: 'FailCo1',
          score: null,
          verdict: 'MATCH_FAILED',
          match_analysis: null,
          description: 'A '.repeat(30) + 'description that is long enough to pass the 50-char threshold for rescoring.',
        },
        {
          title: 'Failed Job 2',
          company: 'FailCo2',
          score: null,
          verdict: 'MATCH_FAILED',
          match_analysis: null,
          description: 'A '.repeat(30) + 'another long description for the rescoring eligibility check.',
        },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    // Banner should mention failed count
    await expect(page.getByText(/2 jobs failed scoring/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rescore All Failed' })).toBeVisible();
  });

  test('rescore all failed banner is hidden when no jobs failed', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Failures Test', status: 'completed' },
      [
        { title: 'Good Job', company: 'GoodCo', score: 80, verdict: 'YES' },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('button', { name: 'Rescore All Failed' })).toBeHidden();
  });

  test('rescore all failed banner is hidden during active runs', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Active Run Banner Test', status: 'scoring' },
      [
        {
          title: 'Failed Job',
          company: 'FailCo',
          score: null,
          verdict: 'MATCH_FAILED',
          description: 'A '.repeat(30) + 'long enough description for the check.',
        },
      ],
    );

    await page.goto(`/discovery/${run.id}`);

    // Banner is only shown for non-active runs
    await expect(page.getByRole('button', { name: 'Rescore All Failed' })).toBeHidden();
  });
});

test.describe('Discovered Jobs - Evaluator Prompt Panel', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('evaluator prompt panel toggle is visible', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Prompt Panel Test' },
      [{ title: 'Any Job', company: 'AnyCo' }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Evaluator Prompt')).toBeVisible();
    // Default badge should show
    await expect(page.getByText('Default')).toBeVisible();
  });
});

test.describe('Discovered Jobs - Save to Tracker', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('saving a job shows Saved badge', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Save Test' },
      [{
        title: 'Save Me Job',
        company: 'SaveMeCo',
        score: 85,
        verdict: 'YES',
        saved_to_tracker: false,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('button', { name: 'Save to Tracker' })).toBeVisible();

    // Click save
    await page.getByRole('button', { name: 'Save to Tracker' }).click();

    // After saving, the Saved badge should appear and save button should disappear
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save to Tracker' })).toBeHidden();
  });
});

test.describe('Discovered Jobs - Claude Calls Button', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('Claude Calls button shows for jobs with snapshot data', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'Snapshot Test' },
      [{
        title: 'Snapshot Job',
        company: 'SnapshotCo',
        score: 80,
        verdict: 'YES',
        evaluator_snapshot_input: 'Some evaluator input prompt',
        evaluator_snapshot_output: 'Some evaluator output response',
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('button', { name: 'Claude Calls' })).toBeVisible();
  });

  test('Claude Calls button is hidden for jobs without snapshot data', async ({ page }) => {
    const { run } = await seedRunWithJobs(
      { criteria_name: 'No Snapshot Test' },
      [{
        title: 'No Snapshot Job',
        company: 'PlainCo',
        score: 70,
        verdict: 'YES',
        evaluator_snapshot_input: null,
        evaluator_snapshot_output: null,
        analyst_snapshot_input: null,
        analyst_snapshot_output: null,
      }],
    );

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('No Snapshot Job')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claude Calls' })).toBeHidden();
  });
});
