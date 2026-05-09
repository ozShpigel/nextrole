import { test, expect } from '@playwright/test';
import { clearAll, insertRun } from '../fixtures/helpers';

test.describe('Discovery Runs - Empty State', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('shows empty search history message when no runs exist', async ({ page }) => {
    await page.goto('/discovery');

    await expect(page.getByText('No searches yet')).toBeVisible();
    await expect(page.getByText('Run your first criteria to start collecting jobs.')).toBeVisible();

    const statStrip = page.locator('.grid.grid-cols-3');
    await expect(statStrip.getByText('Search History')).toBeVisible();
    await expect(statStrip.locator(':text("0")').first()).toBeVisible();
  });

  test('last search stat shows dash when no runs exist', async ({ page }) => {
    await page.goto('/discovery');

    await expect(page.getByText('Last Search')).toBeVisible();
    await expect(page.locator('.grid.grid-cols-3').getByText('—')).toBeVisible();
  });
});

test.describe('Discovery Runs - Timeline Display', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('completed run appears in timeline with correct status and stats', async ({ page }) => {
    await insertRun({
      criteria_name: 'Backend Search',
      status: 'completed',
      jobs_scraped: 12,
      jobs_scored: 10,
      jobs_saved: 4,
      jobs_skipped_duplicate: 2,
      started_at: new Date(),
      completed_at: new Date(),
    });

    await page.goto('/discovery');

    await expect(page.getByText('Backend Search')).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByText('12', { exact: true })).toBeVisible();
    await expect(page.getByText('scraped', { exact: true })).toBeVisible();
    await expect(page.getByText('10', { exact: true })).toBeVisible();
    await expect(page.getByText('scored', { exact: true })).toBeVisible();
    await expect(page.getByText('4', { exact: true })).toBeVisible();
    await expect(page.getByText('saved', { exact: true })).toBeVisible();
    await expect(page.getByText('2', { exact: true })).toBeVisible();
    await expect(page.getByText('duplicates', { exact: true })).toBeVisible();
  });

  test('failed run shows Failed status', async ({ page }) => {
    await insertRun({
      criteria_name: 'Failed Search',
      status: 'failed',
      error: 'Rate limit exceeded',
      jobs_scraped: 3,
      jobs_scored: 0,
      jobs_saved: 0,
      jobs_skipped_duplicate: 0,
    });

    await page.goto('/discovery');

    await expect(page.getByText('Failed Search')).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  });

  test('active run (scraping) shows abort button', async ({ page }) => {
    await insertRun({
      criteria_name: 'Active Search',
      status: 'scraping',
      jobs_scraped: 0,
      jobs_scored: 0,
      jobs_saved: 0,
      jobs_skipped_duplicate: 0,
      completed_at: null,
    });

    await page.goto('/discovery');

    await expect(page.getByText('Active Search')).toBeVisible();
    await expect(page.getByText('Scraping')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abort search' })).toBeVisible();
  });

  test('scoring run shows abort button', async ({ page }) => {
    await insertRun({
      criteria_name: 'Scoring Search',
      status: 'scoring',
      completed_at: null,
    });

    await page.goto('/discovery');

    await expect(page.getByText('Scoring', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abort search' })).toBeVisible();
  });

  test('pending run shows abort button', async ({ page }) => {
    await insertRun({
      criteria_name: 'Pending Search',
      status: 'pending',
      completed_at: null,
    });

    await page.goto('/discovery');

    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abort search' })).toBeVisible();
  });

  test('completed run does not show abort button', async ({ page }) => {
    await insertRun({
      criteria_name: 'Done Search',
      status: 'completed',
    });

    await page.goto('/discovery');

    await expect(page.getByRole('button', { name: 'Abort search' })).toBeHidden();
  });

  test('multiple runs appear in timeline', async ({ page }) => {
    const older = new Date(Date.now() - 3600000);
    const newer = new Date();

    await insertRun({
      criteria_name: 'Older Run',
      started_at: older,
      completed_at: older,
    });
    await insertRun({
      criteria_name: 'Newer Run',
      started_at: newer,
      completed_at: newer,
    });

    await page.goto('/discovery');

    await expect(page.getByText('Older Run')).toBeVisible();
    await expect(page.getByText('Newer Run')).toBeVisible();

    const statStrip = page.locator('.grid.grid-cols-3');
    await expect(statStrip.getByText('2')).toBeVisible();
  });

  test('run card shows timestamp', async ({ page }) => {
    const when = new Date('2026-05-01T14:30:00Z');
    await insertRun({
      criteria_name: 'Timed Run',
      status: 'completed',
      started_at: when,
    });

    await page.goto('/discovery');

    await expect(page.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/)).toBeVisible();
  });
});

test.describe('Discovery Runs - Abort', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('aborting an active run changes its status to failed', async ({ page }) => {
    await insertRun({
      criteria_name: 'Abort Me',
      status: 'scraping',
      completed_at: null,
    });

    await page.goto('/discovery');

    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: 'Abort search' }).click();

    await expect(page.getByText('Failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abort search' })).toBeHidden();
  });

  test('cancelling abort confirmation keeps the run active', async ({ page }) => {
    await insertRun({
      criteria_name: 'Keep Running',
      status: 'scraping',
      completed_at: null,
    });

    await page.goto('/discovery');

    page.on('dialog', (dialog) => dialog.dismiss());

    await page.getByRole('button', { name: 'Abort search' }).click();

    await expect(page.getByText('Scraping')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abort search' })).toBeVisible();
  });
});

test.describe('Discovery Runs - Navigation', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('clicking a run card navigates to the run detail page', async ({ page }) => {
    const run = await insertRun({
      criteria_name: 'Detail Test Run',
      status: 'completed',
    });

    await page.goto('/discovery');

    await page.getByText('Detail Test Run').click();

    await page.waitForURL(`**/discovery/${run.id}`);
    await expect(page).toHaveURL(new RegExp(`/discovery/${run.id}`));
  });
});

test.describe('Discovery Runs - Run Detail Header', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('run detail page shows run info card with status and stats', async ({ page }) => {
    const run = await insertRun({
      criteria_name: 'Detail Header Run',
      status: 'completed',
      jobs_scraped: 15,
      jobs_scored: 12,
      jobs_saved: 5,
      jobs_skipped_duplicate: 3,
    });

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByRole('heading', { name: 'Detail Header Run' })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByText('Scraped: 15', { exact: true })).toBeVisible();
    await expect(page.getByText('Scored: 12', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved: 5', { exact: true })).toBeVisible();
    await expect(page.getByText('Duplicates: 3', { exact: true })).toBeVisible();
  });

  test('failed run detail shows error message', async ({ page }) => {
    const run = await insertRun({
      criteria_name: 'Error Run',
      status: 'failed',
      error: 'Connection timeout after 30s',
    });

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Connection timeout after 30s')).toBeVisible();
  });

  test('active run detail shows processing message', async ({ page }) => {
    const run = await insertRun({
      criteria_name: 'Active Run',
      status: 'scoring',
      completed_at: null,
    });

    await page.goto(`/discovery/${run.id}`);

    await expect(page.getByText('Processing... the page will update automatically')).toBeVisible();
  });

  test('run detail page shows back link to discovery', async ({ page }) => {
    const run = await insertRun({
      criteria_name: 'Nav Test Run',
      status: 'completed',
    });

    await page.goto(`/discovery/${run.id}`);

    const backLink = page.getByRole('link', { name: /Back to Job Discovery/ });
    await expect(backLink).toBeVisible();

    await backLink.click();
    await page.waitForURL('**/discovery');
    await expect(page).toHaveURL(/\/discovery$/);
  });
});
