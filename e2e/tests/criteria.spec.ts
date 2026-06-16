import { test, expect } from '@playwright/test';
import { clearAll, insertCriteria } from '../fixtures/helpers';

test.describe('Search Criteria — Create', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('creates criteria via form with all fields', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await expect(page.getByText('New Search Criteria')).toBeVisible();

    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('My Backend Search');
    await page.getByPlaceholder('Senior Backend Engineer').fill('Senior Backend Engineer\nPlatform Engineer');
    await page.getByPlaceholder('Tel Aviv').fill('Tel Aviv\nHerzliya');

    await page.getByRole('button', { name: 'Indeed' }).click();

    await page.getByText('Results per Title').locator('..').locator('select').selectOption('25');
    await page.getByText('Hours Old').locator('..').locator('select').selectOption('168');
    await page.getByText('Country', { exact: true }).locator('..').locator('input').fill('USA');
    await page.getByText('Remote', { exact: true }).locator('..').locator('select').selectOption('true');
    await page.getByText('Min Score to Save').locator('..').locator('input').fill('80');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('New Search Criteria')).toBeHidden();
    await expect(page.getByText('My Backend Search')).toBeVisible();

    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
    await expect(page.getByText('Platform Engineer')).toBeVisible();
    await expect(page.getByText('linkedin · indeed')).toBeVisible();
    await expect(page.getByText('Tel Aviv · Herzliya')).toBeVisible();
    await expect(page.getByText('80')).toBeVisible();
  });

  test('creates criteria with minimal fields (name + job titles)', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Minimal Criteria');
    await page.getByPlaceholder('Senior Backend Engineer').fill('Software Engineer');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('New Search Criteria')).toBeHidden();
    await expect(page.getByText('Minimal Criteria')).toBeVisible();
    await expect(page.getByText('Software Engineer')).toBeVisible();
  });

  test('cancel button closes the form without creating', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await expect(page.getByText('New Search Criteria')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('New Search Criteria')).toBeHidden();

    await expect(page.getByText('No search criteria')).toBeVisible();
  });
});

test.describe('Search Criteria — Edit', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('editing a criteria updates the card', async ({ page }) => {
    await insertCriteria({
      name: 'Original Criteria',
      job_titles: ['Backend Developer'],
      locations: ['Tel Aviv'],
      site_names: ['linkedin'],
      min_score_to_save: 70,
    });

    await page.goto('/discovery');
    await expect(page.getByText('Original Criteria')).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Updated Criteria');
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(page.getByText('Edit Criteria')).toBeHidden();
    await expect(page.getByText('Updated Criteria')).toBeVisible();
    await expect(page.getByText('Original Criteria')).toBeHidden();
  });
});

test.describe('Search Criteria — Delete', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('delete removes the criteria card after confirmation', async ({ page }) => {
    await insertCriteria({ name: 'To Be Deleted' });

    await page.goto('/discovery');
    await expect(page.getByText('To Be Deleted')).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('To Be Deleted')).toBeHidden();
    await expect(page.getByText('No search criteria')).toBeVisible();
  });

  test('cancelling delete confirmation keeps the criteria', async ({ page }) => {
    await insertCriteria({ name: 'Keep Me' });

    await page.goto('/discovery');
    await expect(page.getByText('Keep Me')).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Keep Me')).toBeVisible();
  });
});
