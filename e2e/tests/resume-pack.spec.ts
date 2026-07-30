import { test, expect } from '@playwright/test';
import { clearAll, insertApplication } from '../fixtures/helpers';

test.describe('Generate Pack — tailored résumé', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  // Real (billed) call to POST /api/applications/{id}/pack — not mockable
  // from Playwright since the Claude call happens server-side. Generous
  // timeout for real latency, same shape as the Interview Insights spec.
  test('generating a pack flips the row to Review Pack and the content persists across reload', async ({ page }) => {
    test.setTimeout(120_000);

    const app = await insertApplication({
      JobTitle: 'Backend Engineer',
      Company: 'PackCo',
      Status: 'DecidedToApply',
      JobDescription: 'We need a backend engineer experienced with distributed systems, cloud infrastructure, and CI/CD automation.',
    });

    await page.goto('/tracker');
    await page.getByRole('button', { name: 'Applications' }).click();

    const generateButton = page.getByRole('button', { name: `Generate résumé pack for ${app.Company}` });
    await expect(generateButton).toBeVisible();
    await generateButton.click();

    // Real Claude latency — the row flips once the pack is persisted.
    const reviewButton = page.getByRole('button', { name: `Review résumé pack for ${app.Company}` });
    await expect(reviewButton).toBeVisible({ timeout: 90_000 });

    await reviewButton.click();
    await expect(page.getByRole('heading', { name: 'Résumé pack' })).toBeVisible();
    // Deterministic structural markers — independent of what Claude actually
    // wrote, so this doesn't depend on AI output content.
    await expect(page.getByText(/generated/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /download pdf/i })).toHaveAttribute(
      'href', new RegExp(`/applications/${app._id}/pack/pdf$`),
    );
    await page.keyboard.press('Escape');

    // Persistence check — a fresh page load re-fetches the list and should
    // show Review Pack immediately, no regenerate needed.
    await page.reload();
    await page.getByRole('button', { name: 'Applications' }).click();
    await expect(page.getByRole('button', { name: `Review résumé pack for ${app.Company}` })).toBeVisible();
  });

  test('the pack action only appears in the To Apply section, not Applied rows', async ({ page }) => {
    await insertApplication({ JobTitle: 'Watched Role', Company: 'ToApplyCo', Status: 'Analyzing' });
    await insertApplication({ JobTitle: 'Sent Role', Company: 'AppliedCo', Status: 'Applied' });

    await page.goto('/tracker');
    await page.getByRole('button', { name: 'Applications' }).click();

    await expect(page.getByRole('button', { name: 'Generate résumé pack for ToApplyCo' })).toBeVisible();
    await expect(page.getByRole('button', { name: /résumé pack for AppliedCo/ })).toHaveCount(0);
  });
});
