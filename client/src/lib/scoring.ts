export const EVALUATOR_PLACEHOLDERS = ['{{USER_PROFILE}}'] as const;

export const VERDICT_LABELS: Record<string, string> = {
  STRONG_YES: 'Strong Yes',
  YES: 'Yes',
  MAYBE: 'Maybe',
  NO: 'No',
  STRONG_NO: 'Strong No',
  INSUFFICIENT_DATA: 'Insufficient Data',
  MATCH_FAILED: 'Match Failed',
  ERROR: 'Error',
};
