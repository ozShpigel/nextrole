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

export const INTERVIEW_TYPES = ['Phone', 'Technical', 'Final', 'HR'] as const;

export const NOTE_CATEGORIES = ['Preparation', 'Research', 'Thoughts', 'FollowUp'] as const;

export const NOTE_CATEGORY_LABELS: Record<string, string> = {
  Preparation: 'Preparation',
  Research: 'Research',
  Thoughts: 'Thoughts',
  FollowUp: 'Follow-up',
};

export const STATUS_INTRO_MAP: Record<string, string[]> = {
  DecidedToApply: ['elevatorPitch'],
  Applied: ['elevatorPitch'],
  PhoneScreen: ['elevatorPitch', 'professionalIntro'],
  TechnicalInterview: ['extendedIntro'],
  FinalRound: ['extendedIntro'],
};

export const INTRO_LABELS: Record<string, string> = {
  elevatorPitch: 'Elevator Pitch · 30s',
  professionalIntro: 'Professional Introduction · 1-2min',
  extendedIntro: 'Extended Introduction · 3-4min',
};
