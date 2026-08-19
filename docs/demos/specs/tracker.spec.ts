import { test, expect } from '@playwright/test';

// Single-purpose recording clip: Application Tracker.
//
// Real seeded fictional data from server/api/src/Seeder/Program.cs (6 tracked
// applications) — unlike search.spec.ts there's no advisor call involved, so
// this is a fast, snappy recording with no timing-trim needed. Shows the
// Tracker dashboard's stats row, then the Recent Activity list, then clicks
// into the most recently created application (Stratus Cloud / Backend
// Engineer — first in the list) to reveal the "AI Analysis" score breakdown
// and expand one dimension. Short and silent, matching the docs/demos pattern
// (see docs/demos/README.md). No captions: the README heading is the caption.
//
// The Dashboard also renders an "Upcoming Interviews" section between the
// stats row and Recent Activity — all fictional (invented company/interviewer
// names from the Seeder, confirmed by reading Program.cs before writing this
// spec), so there's nothing sensitive about it passing through frame during
// the scroll below. The clip's path still stays deliberately simple: stats ->
// Recent Activity -> application detail -> AI Analysis, matching the feature
// this clip illustrates.
test('tracker shows stats, recent activity, and an AI analysis breakdown', async ({ page }) => {
  await page.goto('/tracker');

  await expect(page.getByText('Recent Activity')).toBeVisible();
  await page.waitForTimeout(1300); // let stat cards + row entrance animation settle, read the numbers

  // Scroll to bring the full Recent Activity list into frame.
  await page.mouse.wheel(0, 380);
  await page.waitForTimeout(1300);

  // Click into the app with a real seeded AI Analysis breakdown (Stratus
  // Cloud / Backend Engineer). "Backend Engineer" alone is no longer unique
  // (Harborlight Logistics uses it too), so target the company name instead
  // — rendered as "— Stratus Cloud" (the em dash is baked into the same text
  // node), so this can't be an exact match.
  await page.getByText('Stratus Cloud').click();

  await expect(page.getByRole('heading', { name: 'AI Analysis' })).toBeVisible();
  await page.waitForTimeout(1000);

  // Scroll so the dimension cards (and the expanded panel below them) stay
  // fully in frame — the detail page starts scrolled to top on navigation.
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(500);

  // Expand one dimension's strengths/gaps.
  await page.getByRole('button', { name: /Technical/ }).click();
  await page.waitForTimeout(1800);
});
