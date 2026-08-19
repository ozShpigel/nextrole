import { test, expect } from '@playwright/test';

// Single-purpose recording clip: Matches.
//
// Matches are scored at ingest time, not on demand — there's no "run a
// search" step to record here (that on-demand advisor flow was retired; see
// docs/scoring-and-search.md). This clip just shows the already-scored,
// ranked grid rendering, then clicks the top match to reveal its AI Analysis
// breakdown and expands one dimension. Real seeded fictional data from
// server/api/src/Seeder/Program.cs (16 scored postings). Short and silent,
// matching the docs/demos pattern (see docs/demos/README.md). No captions:
// the README heading is the caption.
test('matches shows ranked scored jobs and an AI analysis breakdown on select', async ({ page }) => {
  await page.goto('/search');

  await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible();
  await expect(page.getByText('Meridian Robotics')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1300); // let the card grid's entrance animation settle, read the scores

  // Open the top-scoring match.
  await page.getByText('Meridian Robotics').click();
  await expect(page.getByRole('heading', { name: 'AI Analysis' })).toBeVisible();
  await page.waitForTimeout(900);

  // Expand one dimension's strengths/gaps.
  await page.getByRole('button', { name: /Technical/ }).click();
  await page.waitForTimeout(1800);
});
