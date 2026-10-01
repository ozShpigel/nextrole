import { test, expect } from '@playwright/test';

// Single-purpose recording clip: Matches.
//
// The ranked grid renders, the top match opens into the split view, and the
// detail pane scrolls through its AI Analysis: score, verdict, the three
// sub-scores and the recommendation. Real seeded fictional data from
// server/api/src/Seeder/Program.cs (16 scored postings). Short and silent,
// matching the docs/demos pattern (see docs/demos/README.md). No captions:
// the README heading is the caption.
//
// The pane is scrolled with the wheel over it, never by clicking something
// below the fold: a click scrolls the window, which slides the list under the
// nav mid-clip.
test('matches shows ranked scored jobs and an AI analysis breakdown on select', async ({ page }) => {
  await page.goto('/search');

  await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible();
  await expect(page.getByText('Meridian Robotics').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1800); // let the grid's entrance and score rings settle

  // Open the top-scoring match.
  await page.getByText('Senior Backend Engineer').first().click();
  await expect(page.getByRole('heading', { name: 'AI Analysis' })).toBeVisible();
  await page.waitForTimeout(1500);

  // Read down the analysis inside the detail pane.
  await page.mouse.move(830, 520);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 45);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(2200);
});
