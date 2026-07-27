import { test, expect } from '@playwright/test';

// Single-purpose recording clip: Interview Prep.
//
// Opens the seeded fictional candidate's interview-prep playbook (persona +
// prep content seeded by server/api/src/Seeder/Program.cs, no advisor call
// involved — a fast recording, no timing-trim needed). Shows the
// Self-Presentation section's HR/Recruiter text, then jumps to the Question
// Rubric and expands two prepared answers — a natural interaction for this
// page. Short and silent, matching the docs/demos pattern (see
// docs/demos/README.md). No captions: the README heading is the caption.
//
// The seeded sample profile mixes Hebrew/English content elsewhere in the app
// (rendered dir="auto"/"rtl" by design — see AGENTS.md); this particular
// seeded prep content happens to be English, which is equally expected.
test('interview prep shows self-presentation and question rubric', async ({ page }) => {
  await page.goto('/interview-prep');

  await expect(page.getByText(/backend-leaning full-stack engineer/)).toBeVisible();
  await page.waitForTimeout(1500); // let the page's entrance animation settle, read the text

  // Jump to the Question Rubric section (the sticky section nav button, not
  // the "Save question rubric" button further down the page).
  await page.getByRole('button', { name: '02Question rubric' }).click();
  await page.waitForTimeout(1200); // smooth scrollIntoView

  // Expand two prepared answers.
  await page.getByRole('button', { name: /disagreed with a teammate/i }).click();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: /Where do you see yourself/i }).click();
  await page.waitForTimeout(1700);
});
