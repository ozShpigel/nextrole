import { test, expect } from '@playwright/test';
import { clearAll, insertCriteria, closeDb } from './helpers/db.js';

test.afterAll(async () => {
  await closeDb();
});

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
    // The count is rendered in a separate element before the label
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

    // Open the form
    await page.getByRole('button', { name: '+ New Criteria' }).click();
    await expect(page.getByText('New Search Criteria')).toBeVisible();

    // Fill name
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('My Backend Search');

    // Fill job titles (textarea, one per line)
    await page.getByPlaceholder('Senior Backend Engineer').fill('Senior Backend Engineer\nPlatform Engineer');

    // Fill locations
    await page.getByPlaceholder('Tel Aviv').fill('Tel Aviv\nHerzliya');

    // Sites: LinkedIn is selected by default. Select Indeed too.
    await page.getByRole('button', { name: 'Indeed' }).click();

    // Set results per title
    await page.getByText('Results per Title').locator('..').locator('select').selectOption('25');

    // Set hours old
    await page.getByText('Hours Old').locator('..').locator('select').selectOption('168');

    // Set country (text input, default "Israel")
    await page.getByText('Country', { exact: true }).locator('..').locator('input').fill('USA');

    // Set remote
    await page.getByText('Remote', { exact: true }).locator('..').locator('select').selectOption('true');

    // Set min score
    await page.getByText('Min Score to Save').locator('..').locator('input').fill('80');

    // Submit
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for the form to disappear and the criteria card to appear
    await expect(page.getByText('New Search Criteria')).toBeHidden();
    await expect(page.getByText('My Backend Search')).toBeVisible();

    // Verify job title tags on the card
    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
    await expect(page.getByText('Platform Engineer')).toBeVisible();

    // Verify sites display
    await expect(page.getByText('linkedin · indeed')).toBeVisible();

    // Verify locations display
    await expect(page.getByText('Tel Aviv · Herzliya')).toBeVisible();

    // Verify threshold
    await expect(page.getByText('80')).toBeVisible();

    // Stat strip should reflect 1 criteria
    const statStrip = page.locator('.grid.grid-cols-3');
    await expect(statStrip.getByText('1').first()).toBeVisible();
  });

  test('creates criteria with minimal fields (name + job titles)', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    // Fill only required fields
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Minimal Criteria');
    await page.getByPlaceholder('Senior Backend Engineer').fill('Software Engineer');

    // Submit — LinkedIn is selected by default, so this should succeed
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

    // Still empty state
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

    // Fill job titles but leave name empty
    await page.getByPlaceholder('Senior Backend Engineer').fill('Software Engineer');

    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  });

  test('create button is disabled when job titles are empty', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    // Fill name but leave titles empty
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Test Criteria');

    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  });

  test('create button is disabled when no sites are selected', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    // Fill required fields
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Test Criteria');
    await page.getByPlaceholder('Senior Backend Engineer').fill('Software Engineer');

    // Deselect LinkedIn (the only default-selected site)
    await page.getByRole('button', { name: 'LinkedIn' }).click();

    // Validation message should appear
    await expect(page.getByText('Select at least one site')).toBeVisible();

    // Create button should be disabled
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

    // Click a suggestion chip for job titles
    await page.getByRole('button', { name: '+ Software Engineer' }).click();

    // Verify the textarea now contains the suggestion
    await expect(page.getByPlaceholder('Senior Backend Engineer')).toHaveValue('Software Engineer');

    // The chip should disappear after being added
    await expect(page.getByRole('button', { name: '+ Software Engineer' })).toBeHidden();
  });

  test('clicking a location suggestion adds it to the textarea', async ({ page }) => {
    await page.goto('/discovery');

    await page.getByRole('button', { name: '+ New Criteria' }).click();

    // Click a location suggestion
    await page.getByRole('button', { name: '+ Tel Aviv' }).click();

    // Verify the textarea now contains the suggestion
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

    // Click edit on the criteria card
    await page.getByRole('button', { name: 'Edit' }).click();

    // Form should show "Edit Criteria" heading
    await expect(page.getByText('Edit Criteria')).toBeVisible();

    // Fields should be pre-filled
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

    // Edit
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByPlaceholder('e.g. "Senior Backend .NET"').fill('Updated Criteria');
    await page.getByRole('button', { name: 'Update' }).click();

    // Form should close
    await expect(page.getByText('Edit Criteria')).toBeHidden();

    // Updated name should appear
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

    // Set up dialog handler for confirm()
    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: 'Delete' }).click();

    // Criteria should be gone; empty state should show
    await expect(page.getByText('To Be Deleted')).toBeHidden();
    await expect(page.getByText('No search criteria')).toBeVisible();
  });

  test('cancelling delete confirmation keeps the criteria', async ({ page }) => {
    await insertCriteria({ name: 'Keep Me' });

    await page.goto('/discovery');
    await expect(page.getByText('Keep Me')).toBeVisible();

    // Dismiss the confirm dialog
    page.on('dialog', (dialog) => dialog.dismiss());

    await page.getByRole('button', { name: 'Delete' }).click();

    // Criteria should still be there
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

    // Stat strip should show 2
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

    // Name
    await expect(page.getByText('Full Info Criteria')).toBeVisible();

    // Job title tags
    await expect(page.getByText('ML Engineer')).toBeVisible();
    await expect(page.getByText('Data Scientist')).toBeVisible();

    // Locations
    await expect(page.getByText('Haifa · Remote')).toBeVisible();

    // Sites
    await expect(page.getByText('linkedin · indeed')).toBeVisible();

    // Threshold
    await expect(page.getByText('85')).toBeVisible();
    await expect(page.getByText('/100')).toBeVisible();

    // Edit and Delete buttons
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Search →' })).toBeVisible();
  });
});
