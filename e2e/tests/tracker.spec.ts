import { test, expect } from '@playwright/test';
import { clearAll, insertApplication } from '../fixtures/helpers';

test.describe('Tracker — Dashboard Data Flow', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('dashboard shows seeded applications in recent activity', async ({ page }) => {
    await insertApplication({ JobTitle: 'Frontend Dev', Company: 'Acme Inc' });
    await insertApplication({ JobTitle: 'Backend Dev', Company: 'Beta Corp' });

    await page.goto('/tracker');

    await expect(page.getByText('Frontend Dev')).toBeVisible();
    await expect(page.getByText('Backend Dev')).toBeVisible();
  });

  test('clicking a recent activity item navigates to detail', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Clickable App', Company: 'NavCo' });

    await page.goto('/tracker');

    await page.getByText('Clickable App').click();
    await expect(page).toHaveURL(new RegExp(`/tracker/${app._id}`));
  });
});

test.describe('Tracker — Application List Data Flow', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('lists seeded applications with scores and status', async ({ page }) => {
    await insertApplication({ JobTitle: 'ML Engineer', Company: 'DataCo', Status: 'PhoneScreen', MatchScore: 90 });
    await insertApplication({ JobTitle: 'DevOps Lead', Company: 'CloudInc', Status: 'Applied', MatchScore: 65 });

    await page.goto('/tracker');
    await page.getByRole('button', { name: 'Applications' }).click();

    await expect(page.getByText('ML Engineer')).toBeVisible();
    await expect(page.getByText('DataCo')).toBeVisible();
    await expect(page.getByText('90')).toBeVisible();

    await expect(page.getByText('DevOps Lead')).toBeVisible();
    await expect(page.getByText('CloudInc')).toBeVisible();
    await expect(page.getByText('65')).toBeVisible();
  });

  test('clicking a row navigates to application detail', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Nav Test Job', Company: 'NavCorp' });

    await page.goto('/tracker');
    await page.getByRole('button', { name: 'Applications' }).click();

    await page.getByText('Nav Test Job').click();
    await expect(page).toHaveURL(new RegExp(`/tracker/${app._id}`));
  });

  test('delete removes application and shows empty state', async ({ page }) => {
    await insertApplication({ JobTitle: 'Delete Me', Company: 'GoneCo' });

    await page.goto('/tracker');
    await page.getByRole('button', { name: 'Applications' }).click();
    await expect(page.getByText('Delete Me')).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete Me')).toBeHidden();
    await expect(page.getByText('No applications yet')).toBeVisible();
  });
});

test.describe('Tracker — Add Application', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('submitting the form persists application and switches to list', async ({ page }) => {
    await page.goto('/tracker');
    await page.getByRole('button', { name: 'Add Application' }).click();

    await page.getByPlaceholder('Senior Backend Engineer').fill('New Test Position');
    await page.getByPlaceholder('Company name').fill('NewCo');

    await page.locator('form').getByRole('button', { name: 'Add Application' }).click();

    await expect(page.getByText('New Test Position')).toBeVisible();
    await expect(page.getByText('NewCo')).toBeVisible();
  });
});
