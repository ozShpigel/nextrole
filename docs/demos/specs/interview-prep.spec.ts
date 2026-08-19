import { test, expect } from '@playwright/test';

// Single-purpose recording clip: Interview Prep.
//
// Interview Prep is a one-question-at-a-time card carousel (QaCardGrid) with
// topic filter chips, not the older two-section scrollable page — filters to
// one topic, clears back to all, then steps through a couple of cards. Real
// seeded fictional data from server/api/src/Seeder/Program.cs (7 questions,
// several with topics). Short and silent, matching the docs/demos pattern
// (see docs/demos/README.md). No captions: the README heading is the
// caption.
//
// "Start a practice interview" is disabled in this DemoMode recording config
// (same read-only gate a real public-demo visitor sees) — this clip stays on
// the Question Rubric card itself rather than trying to click it.
test('interview prep filters by topic and steps through prepared questions', async ({ page }) => {
  await page.goto('/interview-prep');

  await expect(page.getByRole('heading', { name: 'Interview Questions' })).toBeVisible();
  await page.waitForTimeout(1300); // let the entrance animation settle, read the first card

  // Filter to one topic.
  await page.getByRole('button', { name: /Checkout platform migration/i }).click();
  await page.waitForTimeout(1500);

  // Back to all questions.
  await page.getByRole('button', { name: /^All \(/ }).click();
  await page.waitForTimeout(800);

  // Step forward through a couple of cards (hover reveals the nav button).
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.waitForTimeout(1700);
});
