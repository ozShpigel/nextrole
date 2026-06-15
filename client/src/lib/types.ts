export interface ProfileResponse {
  content?: string;
  analyst_prompt?: string;
  analyst_prompt_is_override?: boolean;
  evaluator_prompt?: string;
  evaluator_prompt_is_override?: boolean;
  scoring_config?: Record<string, unknown>;
  updated_at?: string;
}

export type ConfigValue = string | number | boolean;

// Dry-run "Test prompt" — request fields are snake_case (match the C# DTO's
// JsonPropertyName); result fields are camelCase (default serialization).
export interface TestPromptRequest {
  target: 'analyst' | 'evaluator';
  job_description: string;
  analyst_prompt?: string;
  evaluator_prompt?: string;
  profile?: string;
  scoring_config?: Record<string, unknown>;
}

export interface TestPromptStageResult {
  stage: 'parse' | 'evaluate';
  deserializedCleanly: boolean;
  rawOutput?: string;
  input?: string;
  error?: string;
}

export interface TestPromptResult {
  success: boolean;
  stages: TestPromptStageResult[];
  parsed?: Record<string, unknown> | null;
  evaluation?: Record<string, unknown> | null;
  overallScore?: number | null;
  verdict?: string | null;
}

// Version history. Field is one of: content | analyst_prompt | evaluator_prompt | scoring_config
export type HistoryField = 'content' | 'analyst_prompt' | 'evaluator_prompt' | 'scoring_config';

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
