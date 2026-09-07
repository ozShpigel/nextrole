export const STATUS_LABELS: Record<string, string> = {
  Analyzing: 'Analyzing',
  DecidedToApply: 'Decided to Apply',
  Applied: 'Applied',
  PhoneScreen: 'Phone Screen',
  TechnicalInterview: 'Technical Interview',
  FinalRound: 'Final Round',
  OfferReceived: 'Offer Received',
  Accepted: 'Accepted',
  Rejected: 'Rejected',
  Withdrawn: 'Withdrawn',
};

export const STATUS_COLORS: Record<string, string> = {
  Analyzing: 'analyzing',
  DecidedToApply: 'decidedtoapply',
  Applied: 'applied',
  PhoneScreen: 'phonescreen',
  TechnicalInterview: 'technicalinterview',
  FinalRound: 'finalround',
  OfferReceived: 'offerreceived',
  Accepted: 'accepted',
  Rejected: 'rejected',
  Withdrawn: 'withdrawn',
};

// Statuses where an active interview process is underway. The decision to
// apply already happened at Matches (the hover/expand AnalysisCard there) —
// re-showing the same rationale/flags/company-info on the Tracker before this
// point just repeats something already seen once, so the detail page's full
// AI Analysis / Why Work Here / Company Info only unlock from here on.
export const INTERVIEWING_STATUSES = new Set(['PhoneScreen', 'TechnicalInterview', 'FinalRound', 'OfferReceived', 'Accepted']);

export const INTERVIEW_TYPES = ['Phone', 'Technical', 'Final', 'HR'] as const;

export const NOTE_CATEGORIES = ['Preparation', 'Research', 'Thoughts', 'FollowUp'] as const;

export const NOTE_CATEGORY_LABELS: Record<string, string> = {
  Preparation: 'Preparation',
  Research: 'Research',
  Thoughts: 'Thoughts',
  FollowUp: 'Follow-up',
};

