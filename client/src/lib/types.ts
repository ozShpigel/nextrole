// The professional profile is the only user-editable field; prompts and scoring
// config are now read-only server configuration (appsettings / env), not data.
export interface ProfileResponse {
  content?: string;
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
  analystSnapshotInput?: string | null;
  analystSnapshotOutput?: string | null;
  evaluatorSnapshotInput?: string | null;
  evaluatorSnapshotOutput?: string | null;
}

// Version history. The profile `content` is the only versioned profile field.
export type HistoryField = 'content';

export interface ProfileHistoryEntry {
  index: number;
  savedAt?: string | null;
  preview: string;
  length: number;
}

export interface ProfileHistoryResponse {
  entries: ProfileHistoryEntry[];
}

// Interview prep — standalone authored content (self-presentation, Q&A rubric,
// project pitches). Stored alongside the profile but exposed via its own endpoints.
export interface QaEntry {
  question: string;
  answer: string;
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
