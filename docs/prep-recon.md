# Prep-tab / Active-board / Translation Recon

Read-only findings only — no recommendations, no proposed changes. Secrets, credentials, connection strings, and personal data are elided as `<REDACTED>`. Anything not found is marked "does not exist".

---

## 1. Prep tab

**Route mount** — `client/src/main.tsx`:
```
<Route path="/interview-prep" element={<InterviewPrepPage />} />
```
Nav link (`client/src/App.tsx` line 79): `<NavLink to="/interview-prep" className={navLinkClass}>Prep</NavLink>`.

**Page component** — `client/src/pages/InterviewPrepPage.tsx` (174 lines, verbatim):

```tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useInterviewPrep, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import { useSaveInterviewPrep } from '../lib/mutations';
import type { InterviewPrepResponse, QaEntry } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { QaCardGrid } from '../components/QaCardGrid';
import {
  SaveResult,
  type SaveResultData,
} from '../components/settings-shared';

const ED_BTN = 'rounded-full border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;
const ED_DANGER = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10`;

function SectionHeader({ name }: { name: string }) {
  return (
    <div className="pb-3 mb-5 border-b border-[var(--ed-rule-strong)]">
      <h2 className="text-[16px] font-medium text-[var(--ed-ink)]">{name}</h2>
    </div>
  );
}

export default function InterviewPrepPage() {
  const demoMode = useDemoMode();
  const query = useInterviewPrep();
  const saveMutation = useSaveInterviewPrep();
  const [initialized, setInitialized] = useState(false);

  const [qa, setQa] = useState<QaEntry[]>([]);
  const [originalQa, setOriginalQa] = useState<QaEntry[]>([]);

  const [savingQa, setSavingQa] = useState(false);
  const [qaResult, setQaResult] = useState<SaveResultData | null>(null);

  function applyData(data: InterviewPrepResponse): void {
    const r = data?.qa_rubric ?? [];
    setQa(r); setOriginalQa(r);
  }

  useEffect(() => {
    if (query.data && !initialized) {
      applyData(query.data as InterviewPrepResponse);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, initialized]);

  const isQaDirty = JSON.stringify(qa) !== JSON.stringify(originalQa);

  async function saveSection(
    body: Record<string, unknown>,
    setSaving: React.Dispatch<React.SetStateAction<boolean>>,
    setResult: React.Dispatch<React.SetStateAction<SaveResultData | null>>,
    onSuccess: (data: InterviewPrepResponse) => void,
    label: string,
  ): Promise<void> {
    setSaving(true);
    setResult(null);
    try {
      const data = await saveMutation.mutateAsync(body) as InterviewPrepResponse;
      onSuccess(data);
      setResult({ type: 'success', message: `${label} saved successfully` });
    } catch (e) {
      setResult({ type: 'error', message: `Error saving: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  const saveQa = () => saveSection(
    { qa_rubric: qa },
    setSavingQa, setQaResult,
    (data) => {
      const r = data?.qa_rubric ?? [];
      setQa(r); setOriginalQa(r);
    },
    'Interview questions',
  );

  if (query.isLoading) return <InterviewPrepLoadingSkeleton />;

  const error = query.error?.message ?? null;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
      <header className="mb-9 pb-4 border-b border-[var(--ed-rule)]">
        <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)]">
          Interview <span className="italic font-medium text-[var(--ed-accent)]">Prep</span>
        </h1>
        <div className="mt-5 flex items-center gap-5 flex-wrap">
          {demoMode ? (
            <button type="button" disabled title={DEMO_DISABLED_TITLE} className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem]`}>
              <MessageSquare size={15} /> Start a practice interview
            </button>
          ) : (
            <Link to="/practice-interview" className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem]`}>
              <MessageSquare size={15} /> Start a practice interview
            </Link>
          )}
          <Link to="/interview-insights" className="inline-flex items-center gap-[0.4rem] text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)]">
            <Sparkles size={13} /> Interview Insights
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-8">
          <SaveResult result={{ type: 'error', message: `Failed to load: ${error}` }} />
        </div>
      )}

      <section className="mb-16">
        <SectionHeader name="Interview Questions" />
        <QaCardGrid entries={qa} onChange={(next) => { setQa(next); setQaResult(null); }} />
        <div className="flex justify-end items-center gap-[0.6rem] mt-5 pt-[1.1rem] border-t border-dashed border-[var(--ed-rule)]">
          {isQaDirty && (
            <button type="button" className={ED_DANGER} onClick={() => { setQa(originalQa); setQaResult(null); }}>
              Discard changes
            </button>
          )}
          <button type="button" className={ED_PRIMARY} onClick={saveQa} disabled={!isQaDirty || savingQa}>
            {savingQa ? 'Saving…' : 'Save interview questions'}
          </button>
        </div>
        {qaResult && <SaveResult result={qaResult} />}
      </section>
    </div>
    </div>
  );
}

function InterviewPrepLoadingSkeleton() { /* Skeleton placeholders only, no data logic */ }
```

Note: this page is a single-section (Q&A rubric only) editor. `docs/interview-prep.md` describes an older/aspirational three-section page (self-presentation, rubric, projects) with a sticky scroll-spy nav and a component `QaRubricAccordion.tsx` — that component **does not exist** in the current tree (only found inside stale `.claude/worktrees/*` copies), so that doc is stale relative to the live code; the live rubric UI is `QaCardGrid.tsx`.

**Children used by the page:**
- `Skeleton` (`client/src/components/ui/skeleton.tsx`) — generic shadcn skeleton, no fetch/data logic.
- `QaCardGrid` (`client/src/components/QaCardGrid.tsx`, 426 lines). Structural outline:
  - `TopicChips({topics, value, onChange})` — one chip per existing topic (single-select) plus a "+ Topic" inline-input affordance.
  - `QaCard({row, editing, pos, siblingsCount, topics, onEdit, onDone, onUpdate, onMove, onRemove})` — one question/answer card; editing mode shows question input, `AutoGrowTextarea` for the answer, `TopicChips`, move-up/move-down/delete/Done controls; non-editing mode shows the static question+answer with an Edit button.
  - `CardHoverNavButton({direction, label, onClick})` — floating prev/next chevron overlay.
  - `export function QaCardGrid({entries, onChange})` — single-card "rehearsal" view with prev/next through the (optionally topic-filtered) list, topic filter chips (`All` / each topic / `General`), `add()` (appends `{question:'', answer:'', categories:[], topic}` and opens it in edit mode), `remove()`, `move()` (swaps with same-topic sibling), `selectTopicFilter()`. All edits mutate local state and call `onChange(next)` — nothing is persisted here.
- `SaveResult` / `SaveResultData` (`client/src/components/settings-shared.tsx`) — a colored success/error banner.

**Fetch hook** — `client/src/lib/queries.ts`:
```ts
export function useInterviewPrep() {
  return useQuery<InterviewPrepResponse>({
    queryKey: ['match', 'interview-prep'],
    queryFn: () => matchApi('/interview-prep'),
  });
}
```
`matchApi` prefixes `/api/match`, so this hits `GET /api/match/interview-prep`.

**Save mutation** — `client/src/lib/mutations.ts`:
```ts
export function useSaveInterviewPrep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      matchApi('/interview-prep', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match', 'interview-prep'] });
    },
  });
}
```

**Server endpoints** — `server/api/src/Api/Endpoints/MatchEndpoints.cs` (interview-prep block, lines 512–684): `GET /api/match/interview-prep`, `PUT /api/match/interview-prep`, `GET/POST /api/match/interview-prep/history/{field}[/restore]` (code comment marks this "Unused" — dead History UI, same as the profile history endpoints), and `POST /api/match/interview-prep/cues`.

Controller action (PUT) body-to-domain mapping:
```csharp
var qa = request.QaRubric?
    .Select(e => new QaEntry
    {
        Question = e.Question,
        Answer = e.Answer,
        Categories = e.Categories ?? new List<string>(),
        Topic = e.Topic ?? "",
    })
    .ToList();
await provider.UpsertInterviewPrepAsync(
    request.SelfPresentationHr, request.SelfPresentationTechnical,
    request.PresentingWorkProject, request.PresentingPersonalProject, qa, ct);
```

**Service method** — `IProfileProvider.GetInterviewPrepAsync` / `UpsertInterviewPrepAsync`, implemented in `server/api/src/Infrastructure/Profile/MongoProfileProvider.cs` (lines 361–660). Key mechanics:
- Collection: `"profile"` (constant `CollectionName`), single document with `_id`/`"id"` = `"default"` (constant `DocId`).
- Sub-object key: `interview_prep` (`InterviewPrepKey`); history key: `history_interview_prep` (`InterviewPrepHistoryKey`).
- `UpsertInterviewPrepAsync` uses per-field carry-forward: any `null` argument keeps the existing stored value (`CarryOrOverwrite`); a non-null `qaRubric` replaces the whole array via `BuildQaRubricBson`, else the existing `qa_rubric` array is carried forward untouched.
- Keyword-cue cache (`self_presentation_hr_cues` / `self_presentation_technical_cues`) is carried forward only when the corresponding presentation text is unchanged (`CarryCues`), otherwise dropped.
- Every changed field is snapshotted into `history_interview_prep.<field>` (newest first) before being overwritten — backs the (currently unused) history/restore endpoints.
- Limits: `QaRubricMaxEntries = 200`, `InterviewPrepMaxFieldLength = 50_000` chars, `QaTopicMaxLength = 200` chars. `BuildQaRubricBson` silently drops fully-empty rows (`question.Trim()==""` and `answer.Trim()==""`).

**MongoDB document / C# POCO for a prep question** — `QaEntry`, defined in `server/api/src/Core/Profile/IProfileProvider.cs`:
```csharp
public sealed record QaEntry
{
    public string Question { get; init; } = "";
    public string Answer { get; init; } = "";
    // Interviewer-type tags from a fixed set (HR / Technical / Behavioral) — a
    // question may carry several. Normalized in BuildQaRubricBson.
    public IReadOnlyList<string> Categories { get; init; } = Array.Empty<string>();
    // Optional free-text grouping label (e.g. a project name); "" = ungrouped.
    public string Topic { get; init; } = "";
}
```
None of the fields are nullable — `""` / empty list are the "absent" sentinels. Stored as a plain BSON sub-array element under `profile.interview_prep.qa_rubric[]` with keys `question` (string), `answer` (string), `categories` (BSON array of strings), `topic` (string) — no schema/validator beyond the C# read/write code (`ReadQaRubric`/`BuildQaRubricBson`).

Client type (`client/src/lib/types.ts`):
```ts
export interface QaEntry {
  question: string;
  answer: string;
  categories?: string[];
  topic?: string;
}
```

**Container doc** — `InterviewPrepDocument` (`IProfileProvider.cs`):
```csharp
public sealed record InterviewPrepDocument
{
    public string SelfPresentationHr { get; init; } = "";
    public string SelfPresentationTechnical { get; init; } = "";
    public string PresentingWorkProject { get; init; } = "";
    public string PresentingPersonalProject { get; init; } = "";
    public IReadOnlyList<QaEntry> QaRubric { get; init; } = Array.Empty<QaEntry>();
    public IReadOnlyList<string> SelfPresentationHrCues { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> SelfPresentationTechnicalCues { get; init; } = Array.Empty<string>();
    public DateTime? UpdatedAt { get; init; }
}
```

**How the category is stored** — two distinct, unrelated fields:
- `categories`: a multi-select from a **fixed vocabulary enforced in code, not a C# enum type** — stored as a BSON string array, normalized server-side by `InterviewCategories` (`IProfileProvider.cs`):
  ```csharp
  public static class InterviewCategories
  {
      public static readonly IReadOnlyList<string> Allowed = new[] { "HR", "Technical", "Behavioral" };
      public static IReadOnlyList<string> Normalize(IReadOnlyList<string>? categories) { /* trim, case-insensitive match, canonical casing, drop unknowns, de-dupe, preserve Allowed's order */ }
  }
  ```
  Exact stored values: `"HR"`, `"Technical"`, `"Behavioral"` — any other string is silently dropped. Shared with `Interview.RetroCategories` (Interview Insights retros).
- `topic`: a **free-text string**, trimmed server-side, capped at 200 chars, case-insensitively grouped/filtered client-side; empty string = ungrouped, and the client renders that group under the literal UI label `"General"` (`GENERAL_LABEL` constant in `QaCardGrid.tsx`) — `"General"` is never itself a stored value, it's computed purely from an empty/whitespace `topic`.

So UI labels like **LD**, **NR**, **Self Presentation**, **Personal Project** are not part of any fixed set the server recognizes — they're arbitrary values of the free-text `topic` field (or, for "Self Presentation"/"Personal Project", they read like section headers from the older 3-section `docs/interview-prep.md` design, not values found in current `qa_rubric` topic data). Only `HR` / `Technical` / `Behavioral` are enforced/fixed.

**Add Question / Edit flows:**
- Both happen entirely in client-side React state inside `QaCardGrid` (`add()`, `update()`, `move()`, `remove()`) — **no network call per-add/per-edit**. `add()` appends a local row `{ question: '', answer: '', categories: [], topic }` and opens it in edit mode.
- Persistence is one explicit action: the page's "Save interview questions" button (`InterviewPrepPage.saveQa`) → `useSaveInterviewPrep().mutateAsync({ qa_rubric: qa })` → `PUT /api/match/interview-prep` with body:
  ```json
  { "qa_rubric": [ { "question": "...", "answer": "...", "categories": ["HR"], "topic": "..." } ] }
  ```
  (Only `qa_rubric` is sent from this page; other `InterviewPrepRequest` fields are omitted/`null`, so carry-forward keeps them unchanged.)
- One other write path into the same rubric: `POST /api/mock-interview/adopt-rubric` (`MockInterviewEndpoints.cs`, body `{question, answer, categories?, topic?}` via `AdoptRubricRequest`) appends one entry and calls `provider.UpsertInterviewPrepAsync(null, null, null, null, rubric, ct)` directly (bypassing the page's Save button) — used by the mock-interview debrief's "adopt rewrite" action.

---

## 2. Active board — job detail

**Route mount** — `client/src/main.tsx`:
```
<Route path="/tracker/:id" element={<ApplicationDetailPage />} />
<Route path="/tracker/:id/pack" element={<ResumePackPage />} />
```
Not linked from `App.tsx` nav directly — reached from row clicks on the Active/Tracker list pages.

**Component** — `client/src/pages/ApplicationDetailPage.tsx` (470 lines; default-exported function is `ApplicationDetail`). Structural outline:
- `SectionHead({title, action})` — small heading + rule.
- Local interfaces `Note`, `StatusUpdate`, `Application` (client shape of the GET response, including `matchAnalysis: string | null`, `analystSnapshotInput/Output`, `evaluatorSnapshotInput/Output`), `ApplicationDetailData`.
- `export default function ApplicationDetail()` — `useParams<{id}>()`, `useApplicationDetail(id)`, `useGeneratePackMutation`; two-column layout: left rail (`CompanyAvatar`, `StatusBadge`, score/verdict, Generate/Review Pack button, Practice Interview link, Add Note button, `CollapsibleSection` wrapping `NoteList`); right pane renders, in order: `<AnalysisCard matchAnalysisJson={app.matchAnalysis} />`, `WhyWorkHereBlock`, `CompanySummaryBlock`, `CompanyEnrichment`. A `NoteModal` renders conditionally on `modal.type === 'note'`.
- `daysAgo()` / `DaysInStage({updatedAt})` — helper + presentational component.
- `CompanySummaryBlock({appId, initialSummary})` — local state + `useGenerateCompanySummary()` mutation, Generate/Regenerate button.
- `WhyWorkHereBlock({appId, initialAnswer})` — local state + `useGenerateWhyWorkHere()` mutation, Generate/Regenerate + copy-to-clipboard.
- `CompanyEnrichment({companyNewsJson, glassdoorDataJson})` — `JSON.parse`s both fields defensively, renders Glassdoor rating/sub-ratings/news list.
- `ApplicationDetailLoadingSkeleton()` — pure skeleton markup.

Score/verdict hero + analysis mount point (verbatim, lines 140–187):
```tsx
<h2 className="font-medium text-[28px] leading-[1.15] tracking-[-0.01em] text-[var(--ed-ink)] mt-1">{app.jobTitle}</h2>
<DaysInStage updatedAt={app.updatedAt} />
<div className="mt-4 flex items-baseline gap-2">
  <span className="text-[28px] font-medium leading-none tabular-nums" style={{ color: edVerdictColor(app.matchVerdict) }}>{app.matchScore ?? '-'}</span>
  <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--ed-ink-faint)]">{app.matchVerdict || ''}</span>
</div>
...
<div className="flex flex-col gap-9 min-w-0">
  <AnalysisCard matchAnalysisJson={app.matchAnalysis} />
  <WhyWorkHereBlock appId={app.id} initialAnswer={app.whyWorkHere} />
  <CompanySummaryBlock appId={app.id} initialSummary={app.companySummary} />
  <CompanyEnrichment companyNewsJson={app.companyNews} glassdoorDataJson={app.glassdoorData} />
</div>
```

**Children:**
- `AnalysisCard` (`client/src/components/AnalysisCard.tsx`, 316 lines) — renders Key Reasons / Questions to Ask / Worth Clarifying / Stacked Gaps / three sub-scores / verdict. Structural outline: exports `edScoreColor`, `edVerdictColor`; local `ScoreNumber`, `DIMS` (technicalFit/engineeringExecutionFit/sustainabilityPaceFit dimension defs), `SignalRows`; default export `AnalysisCard({matchAnalysisJson})` `JSON.parse`s the prop (accepts string or already-parsed object) into a local `MatchAnalysis` shape and renders: hero score+verdict, `hardBlockers` ("Hard Blockers"), `mustClarify` (rendered under the label **"Worth Clarifying"**), the 3 dimension score buttons + expandable strengths/gaps panel, `stackedGaps` (rendered under **"Stacked Gaps (`n`)"**), a "Recommendation" block with **"Key Reasons"** (`rec.keyReasons`) and **"Questions to Ask"** (`rec.questionsToAsk`) and Green/Red flags, then Company News Signals, Employee Review Signals, and Honest Assessment. A comment at line 110 explains RTL choice: `// dir="auto" (not a hardcoded "rtl"): this renders both recommendation...`.
- `CollapsibleSection` (`client/src/components/CollapsibleSection.tsx`, 37 lines).
- `NoteList` / `NoteModal` (`client/src/components/Notes.tsx`, 117 lines).
- `StatusBadge` (`client/src/components/Status.tsx`, 141 lines — only `StatusBadge` is used here; `StatusModal` in the same file is not).
- `CompanyAvatar` (`client/src/components/CompanyAvatar.tsx`, 35 lines).
- `Skeleton` (shadcn, generic).

**Fetch hook** — `client/src/lib/queries.ts`:
```ts
export function useApplicationDetail(id: string) {
  return useQuery({
    queryKey: ['applications', id],
    queryFn: () => api(`/applications/${id}`),
  });
}
```
Hits `GET /api/applications/{id}`.

**C# POCO holding the AI analysis fields** — `server/api/src/Core/Matching/MatchResponse.cs`:
```csharp
public sealed record MatchResponse
{
    public int? OverallScore { get; init; }
    public string Verdict { get; init; } = "INSUFFICIENT_DATA";
    public Breakdown Breakdown { get; init; } = new();          // 3 sub-scores
    public Recommendation Recommendation { get; init; } = new(); // KeyReasons, QuestionsToAsk
    public string[] MustClarify { get; init; } = [];             // "Worth Clarifying"
    public string[] StackedGaps { get; init; } = [];             // "Stacked Gaps"
    public HardBlocker[] HardBlockers { get; init; } = [];
    public string HonestAssessment { get; init; } = "";
    public CompanyNewsAnalysis? CompanyNewsAnalysis { get; init; }
    public EmployeeReviewsAnalysis? EmployeeReviewsAnalysis { get; init; }
    public string[] QuickHighlights { get; init; } = [];
    // + AnalystSnapshotInput/Output, EvaluatorSnapshotInput/Output, JobTitle, Company
}
public sealed record Breakdown
{
    public TechnicalFitScore TechnicalFit { get; init; } = new();
    public EngineeringExecutionFitScore EngineeringExecutionFit { get; init; } = new();
    public SustainabilityPaceFitScore SustainabilityPaceFit { get; init; } = new();
}
public sealed record Recommendation
{
    public bool ShouldApply { get; init; }
    public string[] KeyReasons { get; init; } = [];
    public string[] QuestionsToAsk { get; init; } = [];
    public string[] RedFlags { get; init; } = [];
    public string[] GreenFlags { get; init; } = [];
}
```
(`TechnicalFitScore`/`EngineeringExecutionFitScore`/`SustainabilityPaceFitScore`/`ScoreComponent`/`ReviewAdjustment`/`HardBlocker`/`CompanyNewsAnalysis`/`EmployeeReviewsAnalysis` exist as further records in the same file — all fields nullable `int?`/`string`/array-with-empty-default, no required non-nullable members beyond record defaults.)

**Persistence:** the rendered analysis lives on the `Application` document itself (collection **`applications`**), field:
```csharp
public string? MatchAnalysis { get; init; }
```
A JSON string (serialized `MatchResponse`) — confirmed by `AnalysisCard` doing `JSON.parse(matchAnalysisJson)` and by `ApplicationEndpoints.cs`'s `MatchAnalysisUpdateRequest.MatchAnalysis` being a raw string set via `existing with { MatchAnalysis = request.MatchAnalysis, ... }`.

Separately, the **raw Claude prompt/response text** (Analyst + Evaluator input/output — audit trail, not the rendered analysis) is stored in a second, content-addressed collection: `matchSnapshots` (POCO `server/api/src/Core/Models/MatchSnapshot.cs`):
```csharp
public sealed record MatchSnapshot
{
    [BsonId]
    public required string Id { get; init; } // SHA-256 hex of the four fields below
    public string? AnalystInput { get; init; }
    public string? AnalystOutput { get; init; }
    public string? EvaluatorInput { get; init; }
    public string? EvaluatorOutput { get; init; }
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
```
`Application.SnapshotId` references it. Write path: `POST /api/applications` (`ApplicationEndpoints.cs` lines 14–69) — `snapshots.UpsertAsync(...)` content-addresses the four raw-text fields into `matchSnapshots`, clears `[BsonIgnore]` transient fields off `application`, sets `SnapshotId`, then `repo.CreateAsync(application, ct)` persists the `Application` (including its `MatchAnalysis` JSON) into `applications`. A later patch path, `PUT /api/applications/{id}/match-analysis` (lines 221–239), lets the scraper's background on-demand-enrichment task overwrite just `MatchAnalysis` in place once a fuller narrative finishes, without touching anything else.

So it is **both**: the rendered analysis (`MatchAnalysis`) lives on the `applications` document; the raw model I/O lives in the separate `matchSnapshots` collection, joined by `SnapshotId`.

**Is it re-read/re-rendered, or shown once at scoring time?** Re-read from the database on every page load:
1. `ApplicationDetailPage` calls `useApplicationDetail(id)` → `GET /api/applications/{id}` on every mount (React Query, no `staleTime` override, default fetch-on-mount).
2. Server handler (`ApplicationEndpoints.cs` lines 81–110) does `appRepo.GetByIdAsync(id, ct)` — a fresh Mongo read — and returns `{ application, interviews, notes, statusUpdates, hasPack, packGeneratedAt }`, where `application.matchAnalysis` is whatever was last written (at creation, or later overwritten by the enrichment PUT).
3. Client passes `app.matchAnalysis` straight into `<AnalysisCard matchAnalysisJson={app.matchAnalysis} />`, which `JSON.parse`s it fresh on every render.

There is no separate "just-scored" in-memory path feeding the detail page — it only ever knows the analysis via this GET, so a later background enrichment overwrite becomes visible the next time this page is loaded/refetched, not pushed to an already-open tab.

---

## 3. Translation plumbing (for a future Hebrew translate step)

### `IClaudeClient` abstraction, implementations, DI registration

**Interface** — `server/api/src/Core/AI/IClaudeClient.cs`, namespace `ApplicationTracker.Core.AI`:
```csharp
public interface IClaudeClient
{
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CompanyProfile? companyProfile = null, CancellationToken cancellationToken = default);

    // Explicit-override variants: the prompt and per-role config are supplied
    // directly instead of being read from configuration. The parameterless
    // variants above delegate to these with the configured prompt/config.
    Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(string jobDescription, string analystPrompt, RoleScoringConfig analystConfig, CancellationToken cancellationToken = default);
    Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(string profile, ParsedJob parsedJob, string evaluatorPrompt, RoleScoringConfig evaluatorConfig, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CompanyProfile? companyProfile = null, CancellationToken cancellationToken = default);

    Task<(List<MatchBatchResult> Results, ClaudeCallSnapshot Snapshot, string? Source)> EvaluateMatchBatchAsync(string profile, IReadOnlyList<EvaluationBatchItem> jobs, CancellationToken cancellationToken = default);
    Task<(List<ParseBatchResult> Results, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionBatchAsync(IReadOnlyList<MatchBatchItem> jobs, CancellationToken cancellationToken = default);

    Task<NarrativeEnrichResponse> EnrichNarrativeAsync(NarrativeEnrichRequest request, CancellationToken cancellationToken = default);
    Task<TitleTriageResponse> TriageTitlesAsync(TitleTriageRequest request, CancellationToken cancellationToken = default);
    Task<SeniorityClassifyResponse> ClassifySeniorityAsync(SeniorityClassifyRequest request, CancellationToken cancellationToken = default);

    Task<EmailParseResult?> ParseEmailAsync(string subject, string from, string body, List<string> knownCompanies, DateTime? referenceDate = null, CancellationToken cancellationToken = default);
    Task<string> SummarizeCompanyAsync(string companyName, CancellationToken cancellationToken = default);

    Task<ApplicationTracker.Core.Profile.NormalizedProfile> NormalizeProfileAsync(string text, CancellationToken cancellationToken = default);
    Task<ApplicationTracker.Core.Profile.NormalizedProfile> NormalizeProfileFromPdfAsync(byte[] pdfBytes, CancellationToken cancellationToken = default);

    Task<string> GenerateWhyWorkHereAsync(Application app, string profile, InterviewPrepDocument prep, CancellationToken cancellationToken = default);
    Task<List<string>> GeneratePresentationCuesAsync(string presentationText, CancellationToken cancellationToken = default);

    Task<MockTurnResult> GenerateMockInterviewTurnAsync(MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default);
    Task<MockInterviewDebrief> GenerateMockInterviewDebriefAsync(MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default);
    Task<InterviewInsightsSynthesis> GenerateInterviewInsightAsync(IReadOnlyList<Interview> retros, CancellationToken cancellationToken = default);
    Task<ResumePackSynthesis> GenerateResumePackAsync(Application app, string profile, CancellationToken cancellationToken = default);
}
```

**Implementations**: exactly one — `ClaudeClient` in `server/api/src/Infrastructure/AI/ClaudeClient.cs`, namespace `ApplicationTracker.Infrastructure.AI`, `public sealed class ClaudeClient : IClaudeClient`. No other class implements `IClaudeClient` anywhere in `server/api/src`.

**DI registration** — `server/api/src/Api/Extensions/ServiceExtensions.cs`, in `AddApplicationServices`:
```csharp
services.AddHttpClient("anthropic", c => c.Timeout = TimeSpan.FromSeconds(300));
// ClaudeClient is a singleton but needs the current request's X-Source
// header (per-caller API key selection, see ClaudeClient.ResolveClient) —
// IHttpContextAccessor is the standard way to reach that from a singleton.
services.AddHttpContextAccessor();
services.AddSingleton<IClaudeClient, ClaudeClient>();
services.AddScoped<IJobMatchService, JobMatchService>();
```
There is no `Startup.cs` — `Program.cs` calls `builder.Services.AddApplicationServices(builder.Configuration)`, which executes the above.

### `ClaudeClient` public method signatures (bodies omitted)

`server/api/src/Infrastructure/AI/ClaudeClient.cs` (1115 lines total):
```csharp
public sealed class ClaudeClient : IClaudeClient
{
    public ClaudeClient(
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor httpContextAccessor,
        PromptBuilder promptBuilder,
        IProfileProvider profileProvider,
        PromptOptions prompts,
        ScoringConfig scoring,
        ILogger<ClaudeClient> logger);

    public Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(
        string jobDescription, CancellationToken cancellationToken = default);

    public Task<(ParsedJob Parsed, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionAsync(
        string jobDescription, string analystPrompt, RoleScoringConfig analystConfig, CancellationToken cancellationToken = default);

    public Task<(List<ParseBatchResult> Results, ClaudeCallSnapshot Snapshot)> ParseJobDescriptionBatchAsync(
        IReadOnlyList<MatchBatchItem> jobs, CancellationToken cancellationToken = default);

    public Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(
        string profile, ParsedJob parsedJob, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CompanyProfile? companyProfile = null, CancellationToken cancellationToken = default);

    public Task<(MatchResponse Response, ClaudeCallSnapshot Snapshot)> EvaluateMatchAsync(
        string profile, ParsedJob parsedJob, string evaluatorPrompt, RoleScoringConfig evaluatorConfig, List<CompanyNewsItem>? companyNews = null, GlassdoorData? glassdoorData = null, CompanyProfile? companyProfile = null, CancellationToken cancellationToken = default);

    public Task<(List<MatchBatchResult> Results, ClaudeCallSnapshot Snapshot, string? Source)> EvaluateMatchBatchAsync(
        string profile, IReadOnlyList<EvaluationBatchItem> jobs, CancellationToken cancellationToken = default);

    public Task<NarrativeEnrichResponse> EnrichNarrativeAsync(
        NarrativeEnrichRequest request, CancellationToken cancellationToken = default);

    public Task<EmailParseResult?> ParseEmailAsync(
        string subject, string from, string body, List<string> knownCompanies, DateTime? referenceDate = null, CancellationToken cancellationToken = default);

    public Task<string> SummarizeCompanyAsync(string companyName, CancellationToken cancellationToken = default);

    public Task<string> GenerateWhyWorkHereAsync(
        Application app, string profile, InterviewPrepDocument prep, CancellationToken cancellationToken = default);

    public Task<List<string>> GeneratePresentationCuesAsync(
        string presentationText, CancellationToken cancellationToken = default);

    public Task<TitleTriageResponse> TriageTitlesAsync(
        TitleTriageRequest request, CancellationToken cancellationToken = default);

    public Task<SeniorityClassifyResponse> ClassifySeniorityAsync(
        SeniorityClassifyRequest request, CancellationToken cancellationToken = default);

    public Task<NormalizedProfile> NormalizeProfileAsync(
        string text, CancellationToken cancellationToken = default);

    public Task<NormalizedProfile> NormalizeProfileFromPdfAsync(
        byte[] pdfBytes, CancellationToken cancellationToken = default);

    public Task<MockTurnResult> GenerateMockInterviewTurnAsync(
        MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default);

    public Task<MockInterviewDebrief> GenerateMockInterviewDebriefAsync(
        MockInterviewContext context, IReadOnlyList<MockInterviewTurn> transcript, CancellationToken cancellationToken = default);

    public Task<InterviewInsightsSynthesis> GenerateInterviewInsightAsync(
        IReadOnlyList<Interview> retros, CancellationToken cancellationToken = default);

    public Task<ResumePackSynthesis> GenerateResumePackAsync(
        Application app, string profile, CancellationToken cancellationToken = default);
}
```
(All other members — `ResolveClient`, `CurrentSource`, `CallClaudeAsync<T>`, `BuildParameters`, `ExtractJson`, `ParseTolerant`, `BuildNode`, `SnakeToCamel`, `SerializeCallInput`, nested batch envelope records, and two lenient JSON converters — are `private`/`internal`.)

### Options-pattern config: appsettings.json shape and C# classes

**`server/api/src/Api/appsettings.json`** (verbatim; secrets blank in the checked-in file):
```json
{
  "MongoDB": {
    "ConnectionString": "",
    "DatabaseName": "job-tracker",
    "Database": "jobmatch"
  },
  "Anthropic": {
    "ApiKey": "<REDACTED>",
    "ApiKeys": {
      "mailbot": "<REDACTED>",
      "ingest": "<REDACTED>"
    }
  },
  "Profile": {
    "FilePath": "Data/sample-profile.json"
  },
  "Scoring": {
    "Analyst": {
      "Model": "claude-haiku-4-5-20251001",
      "Temperature": 0,
      "MaxTokens": 4096,
      "ThinkingEnabled": false,
      "ThinkingBudget": 2048
    },
    "Evaluator": {
      "Model": "claude-haiku-4-5-20251001",
      "Temperature": 0,
      "MaxTokens": 8192,
      "ThinkingEnabled": false,
      "ThinkingBudget": 2048
    },
    "MinScoreToSave": 70,
    "VerdictBands": {
      "StrongYes": 85,
      "Yes": 68,
      "Maybe": 50,
      "No": 25
    }
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
```
There is no `Prompts` section checked into `appsettings.json` — only `Scoring` is present there; prompt-related overrides come from environment variables (`Prompts__Analyzer`, `Prompts__Evaluator`, `Prompts__HebrewOutput`) at deploy time.

**`PromptOptions`** — `server/api/src/Infrastructure/AI/PromptOptions.cs` (verbatim, 20 lines):
```csharp
namespace ApplicationTracker.Infrastructure.AI;

// Read-only configuration for the scoring system prompts. Bound from
// the "Prompts" config section via the Options pattern. The canonical text lives
// in PromptSeeds (code) and is used as the default; appsettings / environment
// variables (Prompts__Analyzer, Prompts__Evaluator) only
// override per-deploy. Admin-only: there is no UI/endpoint to edit these at runtime.
public sealed class PromptOptions
{
    public string Analyzer { get; set; } = PromptSeeds.Analyst;
    public string Evaluator { get; set; } = PromptSeeds.Evaluator;

    // Controls the {{OUTPUT_LANGUAGE}} token substituted into every
    // narrative-generating prompt (Evaluator, NarrativeEnrichment,
    // CompanySummary, PresentationCues, WhyWorkHere, TitleTriage,
    // InterviewInsights). Default false = English everywhere. Set true
    // (Prompts__HebrewOutput=true) only on the deployment that wants Hebrew
    // narrative output.
    public bool HebrewOutput { get; set; } = false;
}
```
Only `Analyzer` and `Evaluator` prompts are override-able via config (`services.Configure<PromptOptions>(configuration.GetSection("Prompts"))`). Every other agent's prompt (TitleTriage, SeniorityClassification, EmailParser, CompanySummary, WhyWorkHere, PresentationCues, NormalizeProfile, MockInterviewTurn/Debrief, InterviewInsights, ResumePack, NarrativeEnrichment) reads directly from the static `PromptSeeds` class (`server/api/src/Infrastructure/AI/PromptSeeds.cs`) with no appsettings override — `HebrewOutput` / `{{OUTPUT_LANGUAGE}}` substitution is the only config-driven lever those get.

**`ScoringConfig` / `RoleScoringConfig` / `VerdictBands`** — `server/api/src/Core/Profile/ScoringConfig.cs` (verbatim, structure; explanatory comments on each property elided for brevity):
```csharp
namespace ApplicationTracker.Core.Profile;

public sealed record RoleScoringConfig
{
    public string Model { get; init; } = "claude-haiku-4-5-20251001";
    public decimal Temperature { get; init; } = 0.5m;
    public int MaxTokens { get; init; } = 4096;
    public bool ThinkingEnabled { get; init; }
    public int ThinkingBudget { get; init; } = 2048;
}

public sealed record VerdictBands
{
    public int StrongYes { get; init; } = 85;
    public int Yes { get; init; } = 68;
    public int Maybe { get; init; } = 50;
    public int No { get; init; } = 25;
}

public sealed record ScoringConfig
{
    public RoleScoringConfig Analyst { get; init; } = new() { Model = "claude-haiku-4-5-20251001", Temperature = 0m, MaxTokens = 2048 };
    public RoleScoringConfig Evaluator { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 8192, Temperature = 0m };
    public RoleScoringConfig EvaluatorBatch { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 16000, Temperature = 0m };
    public RoleScoringConfig AnalystBatch { get; init; } = new() { Model = "claude-haiku-4-5-20251001", Temperature = 0m, MaxTokens = 4096 };
    public RoleScoringConfig NarrativeEnrichment { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 4096 };
    public RoleScoringConfig InterviewInsights { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 4096, Temperature = 0.4m };
    public RoleScoringConfig ResumePack { get; init; } = new() { Model = "claude-haiku-4-5-20251001", MaxTokens = 4096, Temperature = 0.3m };
    public int MinScoreToSave { get; init; } = 70;
    public VerdictBands VerdictBands { get; init; } = new();
}
```

Binding (`ServiceExtensions.cs`):
```csharp
services.Configure<PromptOptions>(configuration.GetSection("Prompts"));
services.Configure<ScoringConfig>(configuration.GetSection("Scoring"));
services.AddSingleton(sp => sp.GetRequiredService<IOptions<PromptOptions>>().Value);
services.AddSingleton(sp => sp.GetRequiredService<IOptions<ScoringConfig>>().Value);
```
Both are exposed as plain singletons (not just `IOptions<T>`) so `ClaudeClient`'s constructor can take `PromptOptions prompts` / `ScoringConfig scoring` directly.

### What it would take to add one more distinct model call

Using an existing narrow, batch-free agent (e.g. `SummarizeCompanyAsync` / `TriageTitlesAsync`) as the template, in order:

1. **`server/api/src/Infrastructure/AI/PromptSeeds.cs`** — add a new static prompt-text constant for the new agent's system prompt.
2. **`server/api/src/Core/Profile/ScoringConfig.cs`** — add a new `RoleScoringConfig` property if the call's model/temperature/max-tokens should be independently tunable (most agents get one; a few hardcode the model inline instead).
3. **`server/api/src/Api/appsettings.json`** — optionally add an entry under `"Scoring"` to override the new `RoleScoringConfig`'s defaults (not required — C# defaults act as a backstop).
4. **`server/api/src/Core/AI/IClaudeClient.cs`** — add the new method's signature.
5. **`server/api/src/Infrastructure/AI/ClaudeClient.cs`** — implement the method: build `MessageParameters` (system prompt + XML-wrapped untrusted user data, per house convention), call `ResolveClient().Messages.GetClaudeMessageAsync(...)` (or the shared `CallClaudeAsync<T>` retry helper), parse/return the result. New request/response record types would live under `server/api/src/Core/AI/` or a relevant `Core` subfolder.
6. **A new or existing file under `server/api/src/Api/Endpoints/`** (following e.g. `InterviewInsightsEndpoints.cs`'s pattern) — add a `MapXEndpoints(this WebApplication app)` extension with the HTTP route, injecting `IClaudeClient`.
7. **`server/api/src/Api/Program.cs`** — (a) call the new `app.MapXEndpoints()` alongside existing `app.MapApplicationEndpoints()` / `app.MapInterviewInsightsEndpoints()` calls; (b) optionally register a new named rate-limit bucket via `options.AddFixedWindowLimiter("x", cfg => {...})`, then `.RequireRateLimiting("x")` on the new endpoint (existing agents each have their own bucket: `match`, `discovery`, `mock`, `insights`, `pack`).
8. **`server/api/src/Api/Program.cs`** (DemoMode block) — if the new endpoint is mutating (POST/PUT/PATCH/DELETE), it 403s under `DemoMode` unless added to the allowlist regex, per AGENTS.md's convention.

Files that would NOT need touching for a pure server-side addition: `ServiceExtensions.cs` (no new DI registration needed) and `PromptOptions.cs` (only touched if the new prompt needs an appsettings-overridable text, which currently only `Analyzer`/`Evaluator` have).

---

## 4. Client styling

**Styling approach: Tailwind v4.** Evidence:
- `client/package.json`: `"tailwindcss": "^4.2.4"`, `"@tailwindcss/vite": "^4.2.4"`, `"tw-animate-css": "^1.4.0"`, `"tailwind-merge": "^3.5.0"`, `"class-variance-authority"`, `"clsx"`.
- `client/src/index.css` line 1: `@import "tailwindcss";` (v4's CSS-first config, no `tailwind.config.js`) plus `@import "tw-animate-css";` and `@import "shadcn/tailwind.css";`.
- shadcn/ui components live under `client/src/components/ui/*`, styled via Tailwind utility classes + `cva`/`cn`.
- No CSS Modules exist in `client/src` (only under `node_modules`). No hand-rolled `.css` files besides `client/src/index.css`.
- `components.json` present (shadcn CLI config).

**Design tokens / theme file: `client/src/index.css`** (318 lines). Structural outline:
- L1–3: Tailwind/tw-animate/shadcn imports
- L5: `@custom-variant dark`
- L7–51: `@theme inline { ... }` — maps shadcn semantic tokens (`--color-*`, `--radius-*`) to CSS vars, defines `--font-sans` / `--font-serif`
- L53–87: `:root { ... }` — light-mode shadcn token values (oklch)
- L89–122: `.dark { ... }` — dark-mode shadcn token values
- L124–133: `@layer base` — global border/background/foreground, `overflow-x: hidden`, anchor reset
- L135–319: app-specific "Forest Ledger" `.editorial` sub-theme — `--ed-*` tokens (light L143–159, dark override L160–173), ambient grain/aurora decorative layers, scrollbar theming, entry/fill/confirm animations, `prefers-reduced-motion` guards

Full token declarations (`@theme`, `:root`, `.dark`, `.editorial`/`.dark .editorial`):
```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
  --font-sans: "Instrument Sans", "Heebo", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Schibsted Grotesk", "Heebo", ui-sans-serif, system-ui, sans-serif;
}

:root {
  --radius: 0.8rem;
  --background: oklch(0.988 0.004 120);
  --foreground: oklch(0.26 0.022 165);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.26 0.022 165);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.26 0.022 165);
  --primary: oklch(0.44 0.1 160);
  --primary-foreground: oklch(0.99 0.005 150);
  --secondary: oklch(0.955 0.009 150);
  --secondary-foreground: oklch(0.3 0.03 165);
  --muted: oklch(0.955 0.009 150);
  --muted-foreground: oklch(0.5 0.02 165);
  --accent: oklch(0.95 0.014 155);
  --accent-foreground: oklch(0.3 0.04 162);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.915 0.01 140);
  --input: oklch(0.915 0.01 140);
  --ring: oklch(0.6 0.11 160);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.17 0.012 165);
  --foreground: oklch(0.96 0.008 150);
  --card: oklch(0.22 0.015 165);
  --card-foreground: oklch(0.96 0.008 150);
  --popover: oklch(0.22 0.015 165);
  --popover-foreground: oklch(0.96 0.008 150);
  --primary: oklch(0.79 0.15 158);
  --primary-foreground: oklch(0.2 0.03 165);
  --secondary: oklch(0.27 0.016 165);
  --secondary-foreground: oklch(0.96 0.008 150);
  --muted: oklch(0.27 0.016 165);
  --muted-foreground: oklch(0.72 0.015 160);
  --accent: oklch(0.28 0.02 162);
  --accent-foreground: oklch(0.96 0.008 150);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.65 0.11 160);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

.editorial {
  --ed-paper:        #f7f6f2;   /* warm porcelain canvas    */
  --ed-panel:        #ffffff;   /* raised card surface      */
  --ed-ink:          #1d2b25;   /* forest near-black        */
  --ed-ink-soft:     #4b5a52;   /* muted body ink           */
  --ed-ink-faint:    #7e8b83;   /* captions, metadata       */
  --ed-rule:         #e2e4dd;   /* hairline rule            */
  --ed-rule-strong:  #14382a;   /* heavy masthead rule      */
  --ed-accent:       #6b6152;   /* bone accent, darkened for contrast on porcelain */
  --ed-accent-deep:  #514a3d;
  --ed-yes:          #35935e;   /* success green            */
  --ed-no:           #c94a3d;   /* warm signal red          */
  --ed-gold:         #a1780f;   /* amber caution            */

  background-color: var(--ed-paper);
  color: var(--ed-ink);
}
.dark .editorial {
  --ed-paper:        #000000;   /* true black noir */
  --ed-panel:        #0a0a0a;
  --ed-ink:          #ffffff;
  --ed-ink-soft:     #a3a3a8;   /* neutral gray, no green cast */
  --ed-ink-faint:    #6b6b70;
  --ed-rule:         rgba(255, 255, 255, 0.1);
  --ed-rule-strong:  rgba(255, 255, 255, 0.22);
  --ed-accent:       #e8e3d9;   /* bone accent               */
  --ed-accent-deep:  #d8d0c0;
  --ed-yes:          #6fbe8d;   /* unchanged — semantic, not part of the noir shift */
  --ed-no:           #ec8878;
  --ed-gold:         #d5ab4d;   /* kept distinct from accent — still means "caution" */
}
```
Remaining lines (L124–133, L175–319) are non-token: base-layer resets, decorative gradient/noise overlays (`.editorial-grain`, `.home-atmosphere`), scrollbar styling, keyframe animations (`ed-rise`, `ed-fill`, `ed-confirm`, `nr-aurora-drift`), each with a `prefers-reduced-motion: reduce` override.

**Responsive handling: yes, extensive, all via Tailwind breakpoint utilities** (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`, and Tailwind v4's `max-sm:`/`max-md:` downward variants). No `@media` queries exist in `.tsx` files; the only raw `@media` rules anywhere are the two `prefers-reduced-motion` blocks in `index.css` (L258, L316) — not layout breakpoints. No `useMediaQuery` hook or `matchMedia`-driven layout branching exists (one `window.matchMedia('(prefers-reduced-motion: reduce)')` call in `client/src/components/Stats.tsx:18`, gating an animation only, not layout). No separate "mobile" component/page exists. Representative examples:
- `client/src/App.tsx:61` — `"w-full px-8 flex items-center gap-4 md:gap-10 h-14"`
- `client/src/pages/ActivePage.tsx:261` — `"grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 items-start"`
- `client/src/pages/ApplicationDetailPage.tsx:131` — `"grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start"`
- `client/src/components/ApplicationList.tsx:53-54` — column templates swap entirely at `md:`, header row is `hidden md:grid`
- `client/src/pages/SettingsPage.tsx:162,170` — `max-sm:px-5 max-sm:pt-10 max-sm:pb-16`, `max-sm:grid-cols-1 max-sm:gap-8`
- `client/src/pages/SearchPage.tsx:735` — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` with conditional `2xl:grid-cols-5`
- `client/src/pages/LandingPage.tsx:144,146,208` — `max-sm:gap-3`, `max-sm:w-6 max-sm:h-6`, `max-md:flex-col`
- shadcn primitives (`sheet.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `calendar.tsx`) also carry their stock `sm:` responsive classes.

**RTL handling: yes, present throughout, via the `dir` attribute.** Grep for `dir=` returns 17 files. Pattern:
- `dir="auto"` is used pervasively on any node rendering AI-generated or user-authored free text (summaries, notes, transcripts, Q&A, interview text) — e.g. `AnalysisCard.tsx:117,121,127,261,269,289,300,309`, `InterviewInsightsPage.tsx:52,57,95`, `ApplicationDetailPage.tsx:239,286`, `MessagesPage.tsx:106,114`, `MockInterviewPage.tsx:87,100,114,115`, `Notes.tsx:108`, `Interviews.tsx:53,54,169,173,179`, `QaCardGrid.tsx`, `ResumePackEditModal.tsx`, `ScoreJobModal.tsx`, `ImportJobModal.tsx`, `InterviewRetroModal.tsx`, `SettingsPage.tsx:190,501,515`, `settings-shared.tsx:53`, `Status.tsx:126,132`.
- A comment at `AnalysisCard.tsx:110` explains the choice explicitly: `// dir="auto" (not a hardcoded "rtl"): this renders both recommendation...`
- `ChipInput.tsx` and `MockInterviewPage.tsx` (`Transcript` component, L351/L561) take `dir` as a **prop** (`dir?: 'auto' | 'ltr' | 'rtl'`, default `'auto'`, per `ChipInput.tsx:8,22`) rather than hardcoding it.
- Logical CSS properties (`ps-`/`pe-`/`ms-`/`me-`/`border-s`) appear in only 3 spots, all in `AnalysisCard.tsx` (lines 261, 269, 309: `ps-5`, `ps-4`, `border-s-2`) — everywhere else uses physical `pl-`/`pr-`/`ml-`/`mr-` (e.g. `ApplicationDetailPage.tsx:286` `pl-16`), consistent with the AGENTS.md rule below, with these three lines as exceptions.

**UI rules, quoted verbatim from `AGENTS.md`:**
```
## UI rules

NextRole is a scanning tool, not a reading surface. The match score
carries the visual weight; typography stays quiet.

- Dark is the only theme. Don't add a light mode or a theme toggle.
- Flat surfaces only. Exception: `.editorial-grain`/`.home-atmosphere` are intentional ambient layers on Landing/Home. Everywhere else: no gradients, no shadows, no glow.
- Use tokens from `client/src/index.css` only. Never hardcode hex.
- `--ed-accent` marks the primary action or the active state of a control. One per view.
- The score ramp is for any 0-100 or rated score (match score, interview score, per-dimension sub-scores). Never for status or category.
- Error and destructive states keep their color (`--ed-no`). Everything else that isn't a primary action or a score stays neutral.
- Two font weights: 400, 500.
- Display face (`--font-serif`, Schibsted Grotesk) is for the wordmark and empty-state copy only. Page titles and section headers use sans with weight.
- Type scale: 40 / 16 / 13. No other sizes.
- RTL: mixed Hebrew content (AI summaries, interview text) gets `dir="rtl"`/`dir="auto"` on those nodes — see `docs/design-system.md`. Physical `pl-`/`pr-`/`ml-`/`mr-` elsewhere, not logical properties.
```
(Note: `index.css` also defines both `:root` and `.dark` shadcn tokens — the file supports a light theme structurally — but the stated rule is that no light mode/toggle is exposed in the product.)

---

## 5. Access

**How `private.nextrole.cloud` is gated:** two layers, neither of which is Caddy — Caddy is a pure hostname router with no auth directives.

`deploy/Caddyfile` (full file, 8 lines):
```
nextrole.cloud, www.nextrole.cloud {
    reverse_proxy demo-client:80
}

private.nextrole.cloud {
    reverse_proxy client:80
}
```

Basic Auth lives inside the private client container's nginx config, `client/nginx.private.conf` (baked into the `frontend-private` image via `client/Dockerfile.private`, a separate Dockerfile from the public demo's so the public build can never pick up an auth-gated config):
```nginx
auth_basic "NextRole — Private";
auth_basic_user_file /etc/nginx/.htpasswd;
```
The password file is supplied at deploy time — `deploy/compose.yml` mounts it into the `client` service only:
```yaml
  client:
    image: ghcr.io/ozshpigel/frontend-private:latest
    ...
    volumes:
      - ./.htpasswd:/etc/secrets/.htpasswd:ro
```
Generated per `deploy/README.md` step 5 with `docker run --rm httpd:alpine htpasswd -nbB <user> <pass>`, not committed. `client/docker-entrypoint.d/40-copy-htpasswd.sh` copies `/etc/secrets/.htpasswd` → `/etc/nginx/.htpasswd` with `chmod 644` so nginx's unprivileged worker can read it. No username/password/hash exists anywhere in the repo — the `.htpasswd` file lives only on the server, outside version control.

**App-level check in addition to Basic Auth:** the private nginx config also injects a shared-secret header server-side: `set $api_key ${API_KEY};` then `proxy_set_header X-Api-Key $api_key;` on every proxied `/api/*` location. Per `docs/demo-mode.md`: *"api-private has its own separate gate (a shared-secret X-Api-Key, originally set up for the mailbot cron)... nginx injects the key server-side rather than shipping the secret in the JS bundle."* This corresponds to the API's own `ApiKey` gate: *"set `ApiKey` on the API → every request must send a matching `X-Api-Key` header or 401 (constant-time compare; `/health` + `/api/config` + OPTIONS stay open; middleware in `Program.cs`)... **Never set `ApiKey` on the demo.**"* Access is: Basic Auth (browser) → nginx injects `X-Api-Key` → API's own middleware enforces it. No `<REDACTED>` needed since no live credential value is checked into the repo (`.env.api`'s `ApiKey=` line in `deploy/.env.example` is blank).

Note: a second, apparently stale private nginx template exists at `deploy/nginx/private.conf.template` — nearly identical Basic Auth block, but references `https://*.onrender.com` in its CSP `connect-src` and has a hardcoded `resolver 127.0.0.11` — inconsistent with `deploy/README.md`'s statement that the resolver is templated via `${DNS_RESOLVER}` and with the Hetzner-only deployment; it also proxies fewer routes than the currently-used `client/nginx.private.conf` (missing `/api/config`, `/api/mock-interview`, `/api/interview-insights`). The file actually consumed by the build (`client/Dockerfile.private` → `COPY client/nginx.private.conf /etc/nginx/templates/default.conf.template`) is `client/nginx.private.conf`, not the one under `deploy/nginx/`.

**Demo/private database split:** a **runtime env-var switch** (connection string + database name) — not a compile-time flag, not a shared DB with a filter column. Per `docs/demo-mode.md`: *"`DemoMode` only gates writes + the banner — which data shows is decided by the connection string + DB-name env vars, not the flag."* Evidence, `deploy/.env.example` (secret values redacted; variable/section **names** shown in full):
```
# .env.api  (prod)
Anthropic__ApiKey=<REDACTED>
Anthropic__ApiKeys__ingest=<REDACTED>
Anthropic__ApiKeys__mailbot=<REDACTED>
ApiKey=<REDACTED>
MongoDB__ConnectionString=<REDACTED>
MongoDB__DatabaseName=
MongoDB__ProfileDatabase=

# .env.scraper (prod)
MONGODB_CONNECTION_STRING=<REDACTED>
MONGODB_DATABASE_NAME=
MongoDB__ProfileDatabase=
OPENAI_API_KEY=<REDACTED>

# .env.demo-api
Anthropic__ApiKey=<REDACTED>
CorsOrigins=https://nextrole.cloud
DemoMode=true
MongoDB__ConnectionString=<REDACTED>
MongoDB__DatabaseName=
MongoDB__ProfileDatabase=

# .env.demo-scraper
DEMO_MODE=true
MONGODB_CONNECTION_STRING=<REDACTED>
MONGODB_DATABASE_NAME=
MongoDB__ProfileDatabase=
OPENAI_API_KEY=<REDACTED>
```
`deploy/compose.yml` wires each environment to its own env file — `api`/`scraper`/`client` use `.env.api`/`.env.scraper`/`.env.client`; `demo-api`/`demo-scraper`/`demo-client` use `.env.demo-api`/`.env.demo-scraper`/`.env.demo-client` — two fully separate service sets sharing images but not config, each holding its own `MongoDB__ConnectionString`/`MongoDB__DatabaseName` (API, .NET double-underscore convention) or `MONGODB_CONNECTION_STRING`/`MONGODB_DATABASE_NAME` (scraper, Python env-var convention).

Default/fallback names (used when the env var is unset, e.g. local dev), `server/api/src/Api/appsettings.json`:
```json
"MongoDB": {
  "ConnectionString": "",
  "DatabaseName": "job-tracker",
  "Database": "jobmatch"
}
```
`deploy/README.md`'s table states the split plainly: `nextrole.cloud` → no auth → "demo DB"; `private.nextrole.cloud` → Basic Auth → "prod DB" — confirming the switch is per-instance connection string/DB name, not a shared-DB flag filter.

`DemoMode=true` / `DEMO_MODE=true` is the separate write-gating flag (allowlist middleware in `Program.cs`/`main.py`), orthogonal to which database is targeted — the DB pointer and the write-gate flag are two independent env vars, both set per-instance in the same env file.
