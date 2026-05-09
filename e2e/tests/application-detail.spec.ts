import { test, expect } from '@playwright/test';
import {
  clearAll,
  insertApplication,
  insertInterview,
  insertNote,
  insertStatusUpdate,
} from '../fixtures/helpers';

test.describe('Application Detail — Salary Persistence', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('saving salary persists on blur', async ({ page }) => {
    const app = await insertApplication();

    await page.goto(`/tracker/${app._id}`);

    const salaryInput = page.getByPlaceholder('e.g. 25-30K/mo');
    await salaryInput.fill('30K/mo');
    await salaryInput.blur();

    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
    await expect(page.getByPlaceholder('e.g. 25-30K/mo')).toHaveValue('30K/mo');
  });

  test('shows pre-filled salary from database', async ({ page }) => {
    const app = await insertApplication({ salary: '25-28K' });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByPlaceholder('e.g. 25-30K/mo')).toHaveValue('25-28K');
  });
});

test.describe('Application Detail — Seeded Related Data', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('shows interviews seeded in database with correct count', async ({ page }) => {
    const app = await insertApplication();
    await insertInterview({ applicationId: app._id, type: 'Phone' });
    await insertInterview({ applicationId: app._id, type: 'Technical' });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByText('Interviews (2)')).toBeVisible();
  });

  test('shows notes seeded in database with correct count', async ({ page }) => {
    const app = await insertApplication();
    await insertNote({ applicationId: app._id, content: 'Research note', category: 'Research' });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByText('Notes (1)')).toBeVisible();
  });

  test('timeline renders seeded status updates', async ({ page }) => {
    const app = await insertApplication({ status: 'PhoneScreen' });
    await insertStatusUpdate({
      applicationId: app._id,
      fromStatus: 'Applied',
      toStatus: 'PhoneScreen',
      note: 'Got a call back!',
    });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByText('Got a call back!')).toBeVisible();
  });

  test('shows glassdoor rating from seeded data', async ({ page }) => {
    const app = await insertApplication({
      glassdoorData: JSON.stringify({ rating: 4.2, reviewCount: 1500, url: null }),
    });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByText('Glassdoor 4.2 / 5')).toBeVisible();
    await expect(page.getByText('(1,500 reviews)')).toBeVisible();
  });

  test('shows company news from seeded data', async ({ page }) => {
    const app = await insertApplication({
      companyNews: JSON.stringify([
        { title: 'Company raises $50M Series B', source: 'TechCrunch' },
      ]),
    });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByText('Company raises $50M Series B')).toBeVisible();
  });
});

test.describe('Application Detail — Delete', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('delete removes application and navigates away', async ({ page }) => {
    const app = await insertApplication({ jobTitle: 'Doomed Job' });

    await page.goto(`/tracker/${app._id}`);

    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page).not.toHaveURL(new RegExp(`/tracker/${app._id}`));
  });

  test('cancelling delete keeps application', async ({ page }) => {
    const app = await insertApplication({ jobTitle: 'Safe Job' });

    await page.goto(`/tracker/${app._id}`);

    page.on('dialog', (dialog) => dialog.dismiss());

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('heading', { name: 'Safe Job' })).toBeVisible();
  });
});
