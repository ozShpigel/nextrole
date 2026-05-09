export interface ProfileResponse {
  content?: string;
  analyst_prompt?: string;
  analyst_prompt_is_override?: boolean;
  evaluator_prompt?: string;
  evaluator_prompt_is_override?: boolean;
  elevator_pitch?: string;
  professional_intro?: string;
  extended_intro?: string;
  scoring_config?: Record<string, unknown>;
  updated_at?: string;
}

export type ConfigValue = string | number | boolean;
