import { test, expect } from '@playwright/test';

// Single-purpose recording clip: Application Tracking (the Active board).
//
// Active — not the older /tracker Dashboard — is the primary day-to-day
// pipeline view reachable from the nav today ("Apps" was removed 2026-08-11;
// see ActivePage.tsx). Real seeded fictional data from
// server/api/src/Seeder/Program.cs: four kanban columns (Added / Ready /
// Applied / Interviewing) tracking real applications end to end. Clicking a
// card still opens the full Application Detail page with its AI Analysis
// score breakdown (technical / execution / sustainability) — Stratus Cloud
// has hand-authored, résumé-grounded reasoning there, not generic tier text,
// so a reviewer who opens it sees something that actually engages with the
// résumé. Short and silent, matching the docs/demos pattern (see
// docs/demos/README.md). No captions: the README heading is the caption.
test('active board tracks the pipeline, and a card opens its AI analysis breakdown', async ({ page }) => {
  await page.goto('/active');

  // Wait for real board content, not just the H1 — the heading renders
  // immediately even while the column data is still loading, so gating on
  // it alone left the clip mostly blank through a slow first-request cold
  // start against a freshly-spun-up recording server.
  await expect(page.getByText('Stratus Cloud')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1300); // let the column entrance animation settle, read the board

  // Open a card with a rich, hand-authored AI Analysis breakdown.
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
