import { test, expect } from '@playwright/test';
import { clearAll, insertRun } from '../fixtures/helpers';

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

    await page.getByRole('button', { name: 'Abort search' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Abort' }).click();

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

    await page.getByRole('button', { name: 'Abort search' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

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
