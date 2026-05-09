import { test, expect } from '@playwright/test';
import {
  clearAll,
  insertApplication,
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
});

test.describe('Application Detail — Seeded Related Data', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('timeline renders seeded status updates', async ({ page }) => {
    const app = await insertApplication({ Status: 'PhoneScreen' });
    await insertStatusUpdate({
      ApplicationId: app._id,
      FromStatus: 'Applied',
      ToStatus: 'PhoneScreen',
      Note: 'Got a call back!',
    });

    await page.goto(`/tracker/${app._id}`);

    await expect(page.getByText('Got a call back!')).toBeVisible();
  });
});

test.describe('Application Detail — Delete', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('delete removes application and navigates away', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Doomed Job' });

    await page.goto(`/tracker/${app._id}`);

    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page).not.toHaveURL(new RegExp(`/tracker/${app._id}`));
  });

  test('cancelling delete keeps application', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Safe Job' });

    await page.goto(`/tracker/${app._id}`);

    page.on('dialog', (dialog) => dialog.dismiss());

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('heading', { name: 'Safe Job' })).toBeVisible();
  });
});
