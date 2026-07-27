import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { resolve, dirname, basename } from 'path';

// Single-purpose recording clip: Search Matches.
//
// Runs one semantic search against the seeded fictional job pool
// (server/scraper/app/services/demo_seed.py) and lets the ranked results —
// similarity scores, verdicts, rationale — render, then a brief scroll so the
// list reads on camera. Short and silent, matching the docs/demos pattern
// (see docs/demos/README.md). No captions: the README heading is the caption.
//
// The advisor pass is real (one Claude call, plus real outbound news/Glassdoor
// enrichment per company) — the UI's own copy warns "the advisor pass takes up
// to a minute." That wait is static (a disabled button, no spinner animation),
// so recording it in full would mostly be dead air. Rather than fake the
// latency away, this spec logs a few timestamps to output/search.timing.json;
// record.sh uses them to cut the static middle of the wait down to a ~1s tail
// (still real — the last moment of "Matching & advising…" right before results
// land) before encoding. Everything shown in the final clip actually happened.
test('search matches renders ranked results with scores and verdicts', async ({ page }, testInfo) => {
  test.setTimeout(240_000);

  const t0 = Date.now();
  const timing: Record<string, number> = {};

  await page.goto('/search');

  // Keep the advisor call small and fast: 3 ranked results is plenty to show
  // scores/verdicts without stretching the (real) wait any longer than it
  // has to be.
  const limitInput = page.getByLabel('Max results');
  await limitInput.fill('3');

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  timing.clickedAtMs = Date.now() - t0;

  await expect(page.getByText('Ranked matches')).toBeVisible({ timeout: 180_000 });
  timing.resultsVisibleAtMs = Date.now() - t0;

  // Let the staggered result-card entrance animation finish.
  await page.waitForTimeout(700);

  // A brief, smooth scroll through the ranked list.
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(900);

  timing.endedAtMs = Date.now() - t0;

  const clipName = basename(testInfo.file, '.spec.ts');
  const outDir = resolve(dirname(testInfo.file), '..', 'output');
  writeFileSync(resolve(outDir, `${clipName}.timing.json`), JSON.stringify(timing));
});
