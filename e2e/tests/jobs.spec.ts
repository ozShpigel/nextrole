import { test, expect } from '@playwright/test';
import { clearAll, insertRun, insertJob, type RunDoc, type JobDoc } from '../fixtures/helpers';

async function seedRunWithJobs(
  runOverrides: Partial<RunDoc> = {},
  jobOverridesList: Partial<JobDoc>[] = [],
): Promise<{ run: RunDoc; jobs: JobDoc[] }> {
  const run = await insertRun({ status: 'completed', ...runOverrides });
  const jobs: JobDoc[] = [];
  for (const overrides of jobOverridesList) {
    const job = await insertJob({ run_id: run.id, criteria_id: run.criteria_id, ...overrides });
    jobs.push(job);
  }
  return { run, jobs };
}

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

    const dismissButtons = page.getByRole('button', { name: 'Dismiss' });
    await dismissButtons.nth(1).click();

    await expect(page.getByText('Dismiss This Job')).toBeHidden();
    await expect(page.getByText('Keep This Job')).toBeVisible();
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

    await page.getByRole('button', { name: 'Save to Tracker' }).click();

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save to Tracker' })).toBeHidden();
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
