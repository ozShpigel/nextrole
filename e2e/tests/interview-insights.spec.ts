import { test, expect, type Page } from '@playwright/test';
import {
  clearAll,
  insertApplication,
  insertInterview,
} from '../fixtures/helpers';

// The Edit Interview dialog (Type, Date, Interviewer, Topics, Notes,
// Completed) has no internal scroll container and is fixed-positioned, so on
// the default 720px-tall viewport its lower fields (incl. the Completed
// checkbox) sit outside the viewport and Playwright can't scroll a fixed
// element into view. A taller viewport avoids that instead of fighting it.
test.use({ viewport: { width: 1280, height: 1400 } });

// Opens the "Interview" nav dropdown and clicks "Interview Insights" — the
// page has no direct nav link, only the dropdown item (App.tsx's INTERVIEW_GROUP).
async function gotoInsightsViaNav(page: Page): Promise<void> {
  const nav = page.locator('nav[data-app-nav]');
  await nav.getByRole('button', { name: 'Interview', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Interview Insights' }).click();
  await expect(page).toHaveURL(/\/interview-insights$/);
}

test.describe('Interview Insights — retro capture (happy path)', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('completing an interview prompts a retro; the retro shows in the log; one retro is insufficient for an insight', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Backend Engineer', Company: 'TestCorp' });
    await insertInterview({ ApplicationId: app._id, Completed: false });

    await page.goto(`/tracker/${app._id}`);

    await page.getByRole('button', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByRole('heading', { name: 'Edit Interview' })).toBeVisible();

    await editDialog.getByRole('checkbox', { name: /completed/i }).check();
    await editDialog.getByRole('button', { name: 'Save' }).click();

    // Completed flipped false→true — the retro modal replaces the edit dialog.
    const retroDialog = page.getByRole('dialog');
    await expect(retroDialog.getByRole('heading', { name: 'How did it go?' })).toBeVisible();

    await retroDialog.getByRole('button', { name: '4', exact: true }).click();
    await retroDialog.getByLabel('What went well').fill('Explained the caching layer clearly');
    await retroDialog.getByLabel('What to improve').fill('Rushed the system design estimate');
    await retroDialog.getByRole('button', { name: 'Technical' }).click();
    await retroDialog.getByRole('button', { name: 'Save retro' }).click();

    // Retro modal closes; the interview card now reflects Completed.
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(/Interview: Technical.*✅/).first()).toBeVisible();

    // Navigate to Interview Insights via the "Interview" nav dropdown.
    await gotoInsightsViaNav(page);

    await expect(page.getByText('Explained the caching layer clearly')).toBeVisible();
    await expect(page.getByText('Rushed the system design estimate')).toBeVisible();

    // Only one retro exists — insufficientData is computed server-side from the
    // current retro count, so no Claude call happens and the button stays
    // disabled. Fully deterministic, no AI involved.
    await expect(page.getByText(/Not enough retros yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate insight' })).toBeDisabled();
  });
});

test.describe('Interview Insights — skip path', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('Skip on the retro modal still marks the interview completed but leaves no retro', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Frontend Engineer', Company: 'SkipCo' });
    await insertInterview({ ApplicationId: app._id, Completed: false });

    await page.goto(`/tracker/${app._id}`);

    await page.getByRole('button', { name: 'Edit' }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByRole('checkbox', { name: /completed/i }).check();
    await editDialog.getByRole('button', { name: 'Save' }).click();

    const retroDialog = page.getByRole('dialog');
    await expect(retroDialog.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
    await retroDialog.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(/Interview: Technical.*✅/).first()).toBeVisible();

    // RetroRating stayed null (Skip omits retro fields) — the retro log stays empty.
    await gotoInsightsViaNav(page);
    await expect(page.getByText(/No retros yet/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate insight' })).toBeDisabled();
  });
});

test.describe('Interview Insights — no-flip path', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test('saving without flipping Completed to true never shows the retro modal', async ({ page }) => {
    const app = await insertApplication({ JobTitle: 'Platform Engineer', Company: 'NoFlipCo' });
    await insertInterview({ ApplicationId: app._id, Completed: false });

    await page.goto(`/tracker/${app._id}`);

    // Edit and save without touching the Completed checkbox.
    await page.getByRole('button', { name: 'Edit' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Name').fill('Jamie Recruiter');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('How did it go?')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(/Jamie Recruiter/).first()).toBeVisible();

    // Edit an already-completed interview and save again — still no retro modal.
    const app2 = await insertApplication({ JobTitle: 'SRE', Company: 'AlreadyDoneCo' });
    await insertInterview({ ApplicationId: app2._id, Completed: true });

    await page.goto(`/tracker/${app2._id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: /completed/i })).toBeChecked();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('How did it go?')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});

test.describe('Interview Insights — generating and persisting an insight', () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  // Real (billed) call to POST /api/interview-insights/synthesize — not
  // mockable from Playwright since the Claude call happens server-side. Kept
  // to a single generate click with a generous timeout for real latency.
  // Interview Insights is deliberately decoupled from the interview-prep Q&A
  // rubric — there's no adopt action to test here, only that the generated
  // insight actually persists (the point of this redesign) across a reload.
  test('generating an insight persists it — a page reload still shows it without regenerating', async ({ page }) => {
    test.setTimeout(120_000);

    const app1 = await insertApplication({ JobTitle: 'Staff Engineer', Company: 'Acme' });
    const app2 = await insertApplication({ JobTitle: 'Senior Engineer', Company: 'Globex' });
    await insertInterview({
      ApplicationId: app1._id,
      Completed: true,
      RetroRating: 3,
      RetroWentWell: 'Communicated trade-offs clearly',
      RetroToImprove: 'Struggled with system design scale estimation',
      RetroCategories: ['Technical'],
    });
    await insertInterview({
      ApplicationId: app2._id,
      Completed: true,
      RetroRating: 2,
      RetroWentWell: 'Stayed calm under pressure',
      RetroToImprove: 'Struggled with system design scale estimation',
      RetroCategories: ['Technical'],
    });

    await page.goto('/interview-insights');
    await expect(page.getByText('Struggled with system design scale estimation').first()).toBeVisible();
    await expect(page.getByText('No insight yet.')).toBeVisible();

    const generateButton = page.getByRole('button', { name: 'Generate insight' });
    await expect(generateButton).toBeEnabled();
    await generateButton.click();

    // Real Claude latency. The meta line is a deterministic marker independent
    // of what Claude actually wrote — it renders whenever an insight was
    // persisted, regardless of content, so this doesn't depend on AI output.
    await expect(page.getByText(/Generated from \d+ retros?/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.getByText('No insight yet.')).toHaveCount(0);

    // Persistence check — a fresh page load re-fetches GET /interview-insights
    // and should show the same persisted summary immediately, no regenerate needed.
    await page.reload();
    await expect(page.getByText(/Generated from \d+ retros?/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });
});
