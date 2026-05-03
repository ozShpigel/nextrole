export const STATUS_LABELS = {
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

export const STATUS_COLORS = {
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

export const INTERVIEW_TYPES = ['Phone', 'Technical', 'Final', 'HR'];

export const NOTE_CATEGORIES = ['Preparation', 'Research', 'Thoughts', 'FollowUp'];

export const NOTE_CATEGORY_LABELS = {
  Preparation: 'Preparation',
  Research: 'Research',
  Thoughts: 'Thoughts',
  FollowUp: 'Follow-up',
};

export const EVALUATOR_PLACEHOLDERS = ['{{USER_PROFILE}}', '{{PARSED_JOB}}'];

export const STATUS_INTRO_MAP = {
  DecidedToApply: ['elevatorPitch'],
  Applied: ['elevatorPitch'],
  PhoneScreen: ['elevatorPitch', 'professionalIntro'],
  TechnicalInterview: ['extendedIntro'],
  FinalRound: ['extendedIntro'],
};

export const INTRO_LABELS = {
  elevatorPitch: 'Elevator Pitch · 30s',
  professionalIntro: 'Professional Introduction · 1-2min',
  extendedIntro: 'Extended Introduction · 3-4min',
};

export const VERDICT_LABELS = {
  STRONG_YES: 'Strong Yes',
  YES: 'Yes',
  MAYBE: 'Maybe',
  NO: 'No',
  STRONG_NO: 'Strong No',
  INSUFFICIENT_DATA: 'Insufficient Data',
  MATCH_FAILED: 'Match Failed',
  ERROR: 'Error',
};
