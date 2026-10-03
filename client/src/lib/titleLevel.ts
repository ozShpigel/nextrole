// Seniority and AI roles, read from the job title -- the browser's copy of the
// server's TitleLevel (server/api/src/Core/Matching/TitleLevel.cs), for the
// unscored band, which is filtered here (bandFilters.ts).
//
// The patterns must stay identical to the server's: the scored cards are
// filtered by the server and the unscored ones by this, so a difference shows
// as a chip that filters half the board. TitleLevelTests checks this file
// holds each server pattern verbatim -- change both, or that test fails.

export type TitleLevel = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'director';

// The order decides a title's one level: the first whose words appear wins.
const ORDERED: [TitleLevel, RegExp][] = [
  ['intern', new RegExp(String.raw`\b(intern|interns|internship|student)\b`, 'i')],
  ['director', new RegExp(String.raw`\b(director|vp|vice president|head of|chief|cto|ciso|cpo|ceo|coo|cfo)\b`, 'i')],
  ['staff', new RegExp(String.raw`\b(staff|principal|distinguished|lead|leader|architect)\b`, 'i')],
  ['senior', new RegExp(String.raw`\b(senior|sr)\b`, 'i')],
  ['junior', new RegExp(String.raw`\b(junior|jr|associate|graduate|new grad|entry level|entry-level)\b`, 'i')],
];

const AI = new RegExp(
  String.raw`\b(ai|a\.i\.|ml|llm|llms|genai|gen ai|generative|machine learning|deep learning|nlp|computer vision|applied scientist|research scientist|mlops)\b`,
  'i',
);

export const TITLE_LEVELS: { value: TitleLevel; label: string }[] = [
  { value: 'intern', label: 'Internships' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid Level' },
  { value: 'senior', label: 'Senior Level' },
  { value: 'staff', label: 'Staff+' },
  { value: 'director', label: 'Director+' },
];

export function titleLevel(title: string | null | undefined): TitleLevel {
  if (!title) return 'mid';
  return ORDERED.find(([, re]) => re.test(title))?.[0] ?? 'mid';
}

export function isAiRole(title: string | null | undefined): boolean {
  return !!title && AI.test(title);
}
