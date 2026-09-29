# Coming-soon feature gating

Status: Part 1 shipped (#148); Part 2 built (branch `feature-gating-ui`) (2026-09-29). From the owner's task description,
reviewed against the code. Out of scope entirely: Telegram alerts, and "notify
me" (no interest endpoint and no `featureInterest` collection).

## Goal

NextRole is public and free. Some features will be paid later: for now they
are **visible but locked** ("Coming soon"), **enforced server-side**, and the
owner's own account can still use the ones it needs. No billing, no admin
dashboard, no per-user plans, and no new libraries (not
`Microsoft.FeatureManagement`).

| Feature | What it is | Now |
|---|---|---|
| `AutoUpdate` | Board cards move automatically from recruiting mail (the mailbot) | Locked, owner allowed |
| `AutoApply` | One-click apply | Locked, not implemented |
| `PracticeInterview` | The practice (mock) interview, `/practice-interview` | Locked, owner allowed; **hidden whole, past sessions included** |
| `InterviewInsights` | AI insights on the Prep tab | Free, gated only so a config change can lock it |

Everything else stays free and ungated: matching and scoring, the manual
board, Google sign-in, and the question bank with its filters and search.

## Part 1 — access (backend, PR 1)

### Config

```json
"Features": {
  "Status": {
    "AutoUpdate": "ComingSoon",
    "AutoApply": "ComingSoon",
    "PracticeInterview": "Free",
    "InterviewInsights": "Free"
  },
  "AllowedUsers": {
    "AutoUpdate": [ "11111111-1111-1111-1111-111111111111" ],
    "PracticeInterview": [ "11111111-1111-1111-1111-111111111111" ]
  }
}
```

- **`1111…` is the local and dev id, not the owner's production id.** It is
  `Identity:FixedUserId`'s default, so local runs and e2e keep every
  feature.
- **Production is Cookie mode**, and the owner's account there came from the
  one-shot claim, whose Guid the repo does not record. It is read once with
  `deploy/mongo/find-owner-id.js` and set in the box's `.env.api`, for
  example `Features__AllowedUsers__AutoUpdate__0=<guid>`. That overrides the
  array's first entry.
- **`PracticeInterview` stays `Free` in PR 1**, and turns `ComingSoon` in
  PR 2 with the locked UI. Otherwise the server gate ships first, and users
  click an unlocked button into a 403.

### Code

- `FeatureStatus { Free, ComingSoon, Paid }` and `FeatureOptions` (`Status`,
  `AllowedUsers` as `Dictionary<string, Guid[]>`), bound with the Options
  pattern like `IdentityOptions`.
- `IFeatureAccess.CanUseAsync(string feature, Guid userId)`, and its
  implementation `ConfigFeatureAccess` over `IOptionsMonitor<FeatureOptions>`,
  registered as a singleton. The async signature is the seam for a
  subscription-based implementation later.
  - **Unknown feature → locked** (`TryGetValue`; the enum's default is
    `Free`, so a missing key must not read as free).
  - `Free` → allowed; otherwise allowed only if the user is on that feature's
    list.
- Feature names are constants (`Features.AutoUpdate`, …), not scattered
  strings: a typo is then a compile error, not a silent lock.
- `userId` is a `Guid` (`IUserContext.UserId`), as everywhere downstream.

### Endpoints

- `GET /api/features` returns `{ feature: bool }` for the current user, for
  every feature in `Status`.
- **`client/nginx.conf` gets a `location /api/features` block.** It only
  passes the `/api` prefixes it lists, and returns a JSON 404 for anything
  else.

### Gates (403 when denied)

| Feature | Gated at | Why there |
|---|---|---|
| `AutoUpdate` | `POST /api/emails/parse` | The mailbot's Claude email read, the one step only auto-update takes. Cards move through `PUT /api/applications/{id}/status`, the same endpoint as a manual drag, which must stay free. The UI never calls `/api/emails/parse` (checked). |
| `PracticeInterview` | every `/api/mock-interview/*` endpoint | The turn and debrief calls are the app's most expensive (multi-turn Claude). The sessions list is gated too: the feature is hidden whole, including past sessions. |
| `InterviewInsights` | every `/api/interview-insights/*` endpoint | `Free` today, so nothing changes; a config change locks it. |
| `AutoApply` | nothing | Not implemented; no endpoint exists. |

### The mailbot

It already acts for exactly one user: whoever's session token it holds,
issued once for the owner by `deploy/mint-mailbot-session.sh`. So "the owner
only, for now" is what it does today, with no change. With the parse gate,
it stops working if that user is ever removed from `AutoUpdate`, and it
reports the 403 as a failed run, not as success (checked: a non-success
parse response throws `EmailParseException`, and any per-email error makes
the run exit non-zero). **Serving several users**
means per-user Gmail grants: the parked `gmailGrants` design, out of scope
here.

### Tests

- `ConfigFeatureAccess`:
  - unknown feature → false;
  - `Free` → true;
  - `ComingSoon` and on the list → true;
  - `ComingSoon` and not on the list → false;
  - on another feature's list only → false.
- The endpoints:
  - `/api/features` reflects the caller;
  - each gated endpoint gives 403 for a user who isn't allowed and passes for
    one who is.
- Mutation checks, as in earlier phases:
  - drop the unknown-feature rule;
  - drop the list check;
  - remove the gate from one endpoint.

## Part 2 — the locked UI (client, PR 2)

`PracticeInterview` becomes `ComingSoon` in this PR, together with the UI.

- **One `ComingSoonDialog`** (prop `feature`): a one-sentence description of
  the feature and a close button. No "notify me".
  - It is a portaled shadcn `Dialog`, so it uses shadcn semantic tokens, not
    `--ed-*` (docs/design-system.md: `--ed-*` resolves only inside
    `.editorial`).
- **The locked control:**
  - `aria-disabled="true"`, not `disabled`, so it stays focusable and
    clickable, and opens the dialog;
  - lucide's `Lock` icon, not the 🔒 emoji (the app's icons are lucide);
  - a "Coming soon" pill that reuses `StatusBadge`'s neutral outline style
    (13px, weight 500, `--ed-rule`, `--ed-ink-soft`). Not shadcn's `Badge`,
    which is 12px and semibold. Neutral, never accent (AGENTS.md: accent is
    only for the primary action or the active state).
- `useFeatures()` in `lib/queries.ts`, next to `useAuthStatus`, calling
  `GET /api/features`.

### Board (`ActivePage`, `/active`)

- **Board header, next to "Import Job":**
  - allowed users see a quiet "Auto-update on" label;
  - everyone else sees the locked control.
  - No toggle: there is no per-user on/off setting behind it yet, and a
    switch that switches nothing is worse than none.
- **Ready cards.** Today they have one button, "I applied →", which only
  moves the card. It becomes three:
  1. "Apply on job site ↗": opens the job URL in a new tab
     (`rel="noopener noreferrer"`), shown when the job has a real URL (the
     existing `hasRealJobUrl`).
  2. "Mark as applied": the current button's behaviour, renamed.
  3. The locked "One-click apply" (`AutoApply`).
- Dragging a card by hand is unchanged for everyone.

### Prep (`/interview-prep`)

- **"Start a practice interview":** a real link for allowed users, the locked
  control otherwise.
- **`/practice-interview` itself is guarded**, so a direct URL shows the
  locked state instead of the page. Past sessions are part of the page, so
  they are hidden with it (decided: hide the whole feature).
- **Unchanged:** "Interview insights" (its server gate is a no-op while it is
  `Free`), and the question bank with its filters, search and save.

### Tests

- Vitest:
  - a locked control opens the dialog, and an unlocked one renders the real
    control;
  - the three Ready-card actions.
- Existing tests that depend on labels: `InterviewPrepPage.test.tsx`
  ("Interview Questions", "save interview questions") is untouched, and no
  test clicks "I applied" or "Start a practice interview" (checked).
  `e2e/tests/interview-insights.spec.ts` still reaches insights through a nav
  menu that no longer exists. That is already stale and outside this change.

## Deploy steps

1. **Merge PR 1.** Then on the box, look up the owner's Guid:
   `sh mongosh.sh find-owner-id.js .env.api`.
2. **Add it to `.env.api`** as `Features__AllowedUsers__AutoUpdate__0` and
   `Features__AllowedUsers__PracticeInterview__0`, then recreate the API.
   Until this is done, the owner's mailbot gets a 403 from `/emails/parse`.
   **So step 2 must happen before the next 02:00 mailbot run**, or that run
   fails, visibly (a non-zero exit, as it is for any parse error). The emails
   are not marked processed, since an email counts as processed only once it
   is stored, and the next run looks back 2 days (`Gmail:LookbackDays`). So
   one missed run recovers on its own. Two in a row need the per-company
   re-sync.
3. **Merge PR 2.**

## Not in this change

- Telegram alerts.
- "Notify me": the interest endpoint, its collection, and a sign-in prompt in
  the dialog.
- Billing, plans and an admin page.
- A per-user daily cap on the practice interview. It comes with the PR that
  unlocks it for everyone, since it is the most expensive action.
- A multi-user mailbot.
- A real auto-update switch.
