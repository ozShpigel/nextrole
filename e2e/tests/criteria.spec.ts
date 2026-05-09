import { test, expect } from '@playwright/test';
import { clearAll, insertCriteria } from '../fixtures/helpers';

test.describe('Search Criteria — Empty State', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('shows empty state message and create button when no criteria exist', async ({ page }) => {
    await page.goto('/discovery');
    await expect(page.getByText('No search criteria')).toBeVisible();
    await expect(page.getByText('Define your first criteria to start automatically scanning jobs from LinkedIn and Indeed.')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Create New Criteria' })).toBeVisible();
  });

  test('stat strip shows 0 active criteria', async ({ page }) => {
    await page.goto('/discovery');
    await expect(page.getByText('Active Criteria')).toBeVisible();
    const statStrip = page.locator('.grid.grid-cols-3');
    await expect(statStrip).toBeVisible();
    await expect(statStrip.locator(':text("0")').first()).toBeVisible();
  });
});

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

    const statStrip = page.locator('.grid.grid-cols-3');
    await expect(statStrip.getByText('1').first()).toBeVisible();
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

test.describe('Search Criteria — Form Validation', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('create button is disabled when name is empty', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await page.getByPlaceholder('Senior Backend Engineer').fill('Software Engineer');

    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  });

  test('create button is disabled when job titles are empty', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Test Criteria');

    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  });

  test('create button is disabled when no sites are selected', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Test Criteria');
    await page.getByPlaceholder('Senior Backend Engineer').fill('Software Engineer');
    await page.getByRole('button', { name: 'LinkedIn' }).click();

    await expect(page.getByText('Select at least one site')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  });
});

test.describe('Search Criteria — Suggestion Chips', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('clicking a job title suggestion adds it to the textarea', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await page.getByRole('button', { name: '+ Software Engineer' }).click();

    await expect(page.getByPlaceholder('Senior Backend Engineer')).toHaveValue('Software Engineer');
    await expect(page.getByRole('button', { name: '+ Software Engineer' })).toBeHidden();
  });

  test('clicking a location suggestion adds it to the textarea', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await page.getByRole('button', { name: '+ Tel Aviv' }).click();

    await expect(page.getByPlaceholder('Tel Aviv')).toHaveValue('Tel Aviv');
  });

  test('clicking multiple suggestion chips appends each on a new line', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    await page.getByRole('button', { name: '+ Software Engineer' }).click();
    await page.getByRole('button', { name: '+ DevOps Engineer' }).click();

    await expect(page.getByPlaceholder('Senior Backend Engineer')).toHaveValue('Software Engineer\nDevOps Engineer');
  });
});

test.describe('Search Criteria — Edit', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('edit button opens form pre-filled with existing data', async ({ page }) => {
    await insertCriteria({
      name: 'Original Criteria',
      job_titles: ['Backend Developer', 'Full Stack Developer'],
      locations: ['Tel Aviv'],
      site_names: ['linkedin', 'indeed'],
      results_wanted: 25,
      hours_old: 168,
      country: 'Israel',
      min_score_to_save: 80,
    });

    await page.goto('/discovery');
    await page.getByRole('button', { name: 'Edit' }).click();

    await expect(page.getByText('Edit Criteria')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. "Senior Backend .NET"')).toHaveValue('Original Criteria');
    await expect(page.getByPlaceholder('Senior Backend Engineer')).toHaveValue('Backend Developer\nFull Stack Developer');
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

    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('To Be Deleted')).toBeHidden();
    await expect(page.getByText('No search criteria')).toBeVisible();
  });

  test('cancelling delete confirmation keeps the criteria', async ({ page }) => {
    await insertCriteria({ name: 'Keep Me' });

    await page.goto('/discovery');
    await expect(page.getByText('Keep Me')).toBeVisible();

    page.on('dialog', (dialog) => dialog.dismiss());

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Keep Me')).toBeVisible();
  });
});

test.describe('Search Criteria — Multiple Criteria Cards', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('displays multiple criteria cards in a grid', async ({ page }) => {
    await insertCriteria({ name: 'Frontend Jobs', job_titles: ['Frontend Developer'] });
    await insertCriteria({ name: 'Backend Jobs', job_titles: ['Backend Developer'] });

    await page.goto('/discovery');

    await expect(page.getByText('Frontend Jobs')).toBeVisible();
    await expect(page.getByText('Backend Jobs')).toBeVisible();

    const statStrip = page.locator('.grid.grid-cols-3');
    await expect(statStrip.getByText('2').first()).toBeVisible();
  });

  test('each criteria card has Run Search button', async ({ page }) => {
    await insertCriteria({ name: 'Criteria A' });
    await insertCriteria({ name: 'Criteria B' });

    await page.goto('/discovery');

    const runButtons = page.getByRole('button', { name: 'Run Search →' });
    await expect(runButtons).toHaveCount(2);
  });
});

test.describe('Search Criteria — Card Display', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('criteria card shows all relevant info', async ({ page }) => {
    await insertCriteria({
      name: 'Full Info Criteria',
      job_titles: ['ML Engineer', 'Data Scientist'],
      locations: ['Haifa', 'Remote'],
      site_names: ['linkedin', 'indeed'],
      min_score_to_save: 85,
    });

    await page.goto('/discovery');

    await expect(page.getByText('Full Info Criteria')).toBeVisible();
    await expect(page.getByText('ML Engineer')).toBeVisible();
    await expect(page.getByText('Data Scientist')).toBeVisible();
    await expect(page.getByText('Haifa · Remote')).toBeVisible();
    await expect(page.getByText('linkedin · indeed')).toBeVisible();
    await expect(page.getByText('85')).toBeVisible();
    await expect(page.getByText('/100')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Search →' })).toBeVisible();
  });
});
