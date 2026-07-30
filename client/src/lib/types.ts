// The professional profile is the user-editable INPUT; prompts and scoring
// config are read-only server configuration (appsettings / env), not data.
// Experience & skills are LLM-normalized from pasted free text; strengths and
// core values are explicit manual inputs. `content` is the server-rendered
// projection the scoring prompts consume (read-only on the client).
export interface ExperienceItem {
  title: string;
  company: string;
  dates: string;
  highlights: string[];
}

export interface SkillGroups {
  languages: string[];
  frameworks: string[];
  infrastructure: string[];
  databases: string[];
  other: string[];
}

// The raw uploaded résumé file (PDF or TXT) — separate from the parsed
// StructuredProfile fields it produced. null fields = none uploaded yet.
export interface ResumeFileMeta {
  fileName: string;
  contentType: string;
  uploadedAt: string;
  textContent: string | null; // populated only for .txt uploads
  pageCount: number | null; // PDF only — powers the Resume tab's custom pager
}

export interface StructuredProfile {
  // Contact fields — used only for the Generate Pack résumé header.
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  summary: string;
  seniority?: string | null;
  domains: string[];
  experience: ExperienceItem[];
  skills: SkillGroups;
  // One entry per degree/certification, e.g. "B.Sc. Computer Science, Open University, 2015".
  education: string[];
  strengths: string[];
  coreValues: string[];
  rawExperienceText: string;
}

// Output of POST /api/match/profile/normalize (experience/skills/education;
// strengths/core values are never auto-generated).
export interface NormalizedProfile {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  summary: string;
  seniority?: string | null;
  domains: string[];
  experience: ExperienceItem[];
  skills: SkillGroups;
  education: string[];
}

export interface ProfileResponse {
  content?: string;
  structured?: StructuredProfile;
  updated_at?: string;
}

// Manual scoring — score a pasted job description on demand via POST /api/match.
// Request fields are camelCase (MatchRequest's default serialization); the
// response mirrors MatchResponse.cs (also camelCase).
export interface ManualMatchRequest {
  jobDescription: string;
  title?: string;
  company?: string;
  location?: string;
}

export interface MatchResponse {
  jobTitle?: string | null;
  company?: string | null;
  overallScore?: number | null;
  verdict: string;
  breakdown?: Record<string, unknown>;
  recommendation?: { shouldApply?: boolean; [key: string]: unknown };
  honestAssessment?: string;
  companyNewsAnalysis?: { greenSignals?: string[]; redSignals?: string[]; summary?: string } | null;
  employeeReviewsAnalysis?: { greenSignals?: string[]; redSignals?: string[]; summary?: string } | null;
  analystSnapshotInput?: string | null;
  analystSnapshotOutput?: string | null;
  evaluatorSnapshotInput?: string | null;
  evaluatorSnapshotOutput?: string | null;
}

// Semantic search (RAG) — POST /api/search on the scraper: the profile is
// embedded and matched against stored jobs via Atlas $vectorSearch, then one
// Claude call ranks the top-N as a career-advisor brief. Nothing is persisted.
export interface SemanticSearchRequest {
  limit: number;
  days_back: number;
  location?: string | null;
  is_remote?: boolean | null;
  job_levels?: string[] | null;
  sites?: string[] | null;
  // Focus on one HyDE facet by name; null/omitted = fused search (default).
  facet?: string | null;
}

// A $vectorSearch hit — a discovered_jobs doc (snake_case, embedding stripped).
export interface SearchHit {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  job_url?: string | null;
  date_posted?: string | null;
  site?: string;
  job_level?: string | null;
  is_remote?: boolean | null;
  similarity?: number;
  saved_to_tracker?: boolean;
  is_duplicate?: boolean;
  // Per-facet $vectorSearch position, e.g. { "backend-dotnet": 2 } — set by
  // the fusion step; single-facet searches carry just that facet's rank.
  facet_ranks?: Record<string, number>;
}

// GET /api/match/profile/search-query — the cached HyDE facets. The Search
// page shows facet names as focus chips; content is the ideal-posting text.
export interface SearchQueryFacet {
  name: string;
  content: string;
}

export interface SearchQueryResponse {
  facets: SearchQueryFacet[];
  cached?: boolean;
}

export interface AdvisorJobBrief {
  jobId: string;
  rank: number;
  verdict: 'apply' | 'maybe' | 'skip' | string;
  rationale: string; // Hebrew
  greenFlags: string[];
  redFlags: string[];
}

export interface AdvisorBrief {
  overallRecommendation: string; // Hebrew
  rankings: AdvisorJobBrief[];
}

export interface SemanticSearchResponse {
  jobs: SearchHit[];
  advisor: AdvisorBrief | null;
}

// Interview prep — standalone authored content (self-presentation, Q&A rubric,
// project pitches). Stored alongside the profile but exposed via its own endpoints.
export interface QaEntry {
  question: string;
  answer: string;
  // Interviewer-type tags from the fixed QA_CATEGORIES set; server drops unknowns.
  categories?: string[];
  // Free-text grouping label (e.g. a project name); ''/absent = ungrouped.
  topic?: string;
}

export const QA_CATEGORIES = ['HR', 'Technical', 'Behavioral'] as const;
export type QaCategory = (typeof QA_CATEGORIES)[number];

// A real (tracked) interview — as opposed to a mock/practice session above.
// Shared between the tracker's Interviews list/modal and Interview Insights.
export interface Interview {
  id: string;
  applicationId: string;
  type: string;
  scheduledAt: string;
  endsAt?: string | null;
  interviewer?: string | null;
  topics?: string | null;
  notes?: string | null;
  completed: boolean;
  createdAt: string;
  // Structured retro, captured when `completed` flips to true. `retroRating`
  // presence is the "has a retro" signal — the rest is optional.
  retroRating?: number | null;
  retroWentWell?: string | null;
  retroToImprove?: string | null;
  retroCategories?: string[];
}

// Interview Insights — cross-application retro log + a persisted, free-form
// observation summary. Deliberately decoupled from the interview-prep Q&A
// rubric — no adopt action, pure read.
export interface InterviewRetroListItem {
  interview: Interview;
  applicationId: string;
  company?: string | null;
  jobTitle?: string | null;
}

export interface InterviewInsight {
  summary: string;
  generatedAt: string;
  retroCount: number; // how many retros contributed to this summary
}

export interface InterviewInsightResponse {
  insight: InterviewInsight | null; // null = never generated yet
  newRetroCount: number;            // retros added since `insight.generatedAt`
  totalRetroCount: number;
  insufficientData: boolean;        // totalRetroCount < 2
}

// Generate Pack — an AI-tailored résumé for one specific application. Reorders/
// re-emphasizes the candidate's real profile toward the job description; the
// PDF itself is rendered server-side on demand (GET /applications/{id}/pack/pdf),
// not stored — this type is just the reviewable structured content.
export interface TailoredExperienceItem {
  title: string;
  company: string;
  dates: string;
  highlights: string[];
}

export interface ResumePack {
  tailoredSummary: string;
  experience: TailoredExperienceItem[];
  highlightedSkills: string[];
  generatedAt: string;
}

export interface InterviewPrepResponse {
  self_presentation_hr?: string;
  self_presentation_technical?: string;
  presenting_work_project?: string;
  presenting_personal_project?: string;
  qa_rubric?: QaEntry[];
  self_presentation_hr_cues?: string[];
  self_presentation_technical_cues?: string[];
  updated_at?: string;
}

export type InterviewPrepHistoryField =
  | 'self_presentation_hr'
  | 'self_presentation_technical'
  | 'presenting_work_project'
  | 'presenting_personal_project'
  | 'qa_rubric';

// Mock interview — AI plays the interviewer (HR or technical), the client holds
// the transcript and posts it each turn to a stateless endpoint.
export type MockPersona = 'hr' | 'technical';
export type MockLanguage = 'he' | 'en';
export type MockMode = 'generic' | 'bound';

export interface MockTurn {
  role: 'interviewer' | 'candidate';
  text: string;
  nudge?: string | null;
  isFollowUp?: boolean;
}

export interface MockTurnResponse {
  nudge: string;
  nextQuestion: string;
  isFollowUp: boolean;
  done: boolean;
}

export interface MockScores {
  structure: number;
  relevance: number;
  specificity: number;
  clarity: number;
}

export interface MockRewrite {
  question: string;
  suggestedAnswer: string;
}

export interface MockDebrief {
  scores: MockScores;
  highlights: string[];
  improvements: string[];
  rewrites: MockRewrite[];
}

export interface MockSessionListItem {
  id: string;
  persona: MockPersona;
  mode: MockMode;
  company?: string | null;
  jobTitle?: string | null;
  language: MockLanguage;
  scores?: MockScores | null;
  answerCount: number;
  createdAt: string;
  completedAt?: string | null;
}

export interface MockSession {
  id: string;
  persona: MockPersona;
  mode: MockMode;
  applicationId?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  language: MockLanguage;
  turns: MockTurn[];
  debrief?: MockDebrief | null;
  createdAt: string;
  completedAt?: string | null;
}
