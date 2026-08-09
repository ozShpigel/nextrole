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
  pageWidth?: number | null; // PDF only, in points — real single-page aspect ratio
  pageHeight?: number | null;
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
  // One entry per stated military/national service role, e.g. "Team Lead, 8200, 2010-2013".
  militaryService: string[];
  // One entry per personal/side project, e.g. "NextRole — AI-assisted job search platform".
  sideProjects: string[];
  // Spoken/human languages (not programming languages — see skills.languages), e.g. "Hebrew (native)".
  spokenLanguages: string[];
  strengths: string[];
  coreValues: string[];
  rawExperienceText: string;
}

// Output of POST /api/match/profile/normalize (experience/skills/education/
// militaryService/sideProjects/spokenLanguages; strengths/core values are
// never auto-generated).
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
  militaryService: string[];
  sideProjects: string[];
  spokenLanguages: string[];
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

// Matches page — GET /api/discovery/jobs on the scraper: every discovered job
// is scored at ingest time now (batched Evaluator calls), so "search" is
// really "filter/sort what's already scored". Replaces the retired RAG
// semantic-search path.
export interface CompanyProfileInfo {
  industry?: string | null;
  description?: string | null;
  numEmployees?: string | null;
  revenue?: string | null;
  url?: string | null;
}

// A discovered_jobs doc (snake_case, as stored) — score/verdict/match_analysis
// are populated by the batched ingest-time scoring path; null when a job is
// still unscored (score-call failed) rather than "not yet searched".
export interface DiscoveredJobSummary {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  job_url?: string | null;
  date_posted?: string | null;
  site?: string;
  job_level?: string | null;
  actual_job_level?: string | null;
  is_remote?: boolean | null;
  company_logo?: string | null;
  company_profile?: CompanyProfileInfo | null;
  score?: number | null;
  verdict?: string | null;
  should_apply?: boolean | null;
  match_analysis?: MatchResponse | null;
  saved_to_tracker?: boolean;
  is_duplicate?: boolean;
  dismissed?: boolean;
  discovered_at?: string;
}

export interface ScoredJobsQuery {
  min_score?: number;
  verdict?: string; // comma-separated, e.g. "STRONG_YES,YES"
  days_back?: number;
  criteria_id?: string;
  location?: string; // free-text substring, case-insensitive
  is_remote?: boolean;
  actual_job_level?: string; // comma-separated
  include_dismissed?: boolean;
  include_saved?: boolean;
  limit?: number;
  offset?: number;
}

export interface ScoredJobsResponse {
  jobs: DiscoveredJobSummary[];
  total: number;
  limit: number;
  offset: number;
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

// Messages — mailbot-parsed emails, persisted so the Messages tab can show the
// thread behind each status update. ApplicationId is null when the parser
// recognized the email but couldn't tie it to a tracked application.
export type MessageUpdateType =
  | 'ApplicationReceived'
  | 'InterviewScheduled'
  | 'Rejected'
  | 'OfferReceived'
  | 'FollowUp'
  | string;

export interface MessageItem {
  id: string;
  applicationId: string | null;
  company: string;
  jobTitle?: string | null;
  subject: string;
  from: string;
  updateType: MessageUpdateType;
  snippet: string;
  receivedAt: string;
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
  // AI-selected subset of the profile's side projects, tailored to this posting.
  // Education/militaryService/spokenLanguages render straight from the profile in
  // the PDF and are intentionally not part of this pack.
  sideProjects?: string[];
  generatedAt: string;
  pageCount?: number | null;
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
