# Tracker — list projection & Applications tab

- `GET /api/applications` returns a lightweight `ApplicationListItem` projection (only the fields the tracker/dashboard render) — the full `Application` document is fetched per-application via `GET /api/applications/{id}`.
- The projection also carries the soonest upcoming, not-completed interview's `NextInterviewAt` / `NextInterviewEndsAt` / `NextInterviewer` (computed via one extra query in `GetAllListItemsAsync`); the list card's "Next" column shows it (accent, rendered `start–end · interviewer` when an end time/name exist) when present, else the last-activity date.
- Status updates patch the React Query list cache optimistically (`setQueryData`) instead of refetching the list.
- The Applications tab (`components/ApplicationList.tsx`) buckets the list into sections by status: **In Motion** (interview-stage feature cards) → **To Apply** (Analyzing/DecidedToApply — the user's own queue) → **No Reply Yet** (Applied + unknown-status catch-all; freshest first, capped at 6 with a "Show all" toggle, and rows silent 30+ days fold into a collapsed muted "Probably ghosted" `<details>` — presentation only) → **The Archive** (Rejected/Withdrawn, collapsed).
- The App shell scrolls to top on PUSH/REPLACE navigations (`ScrollToTop` in `App.tsx`; browser back is untouched) so deep-list → detail navigation lands at the top.
