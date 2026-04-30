import { STATUS_LABELS } from '../utils/constants';

const STATUS_BADGE_STYLES = {
  Analyzing:            'bg-yellow-bg text-yellow border-[rgba(166,139,43,0.12)]',
  DecidedToApply:       'bg-purple-bg text-purple border-[rgba(139,111,192,0.12)]',
  Applied:              'bg-blue-bg text-blue border-[rgba(74,130,197,0.12)]',
  PhoneScreen:          'bg-green-bg text-green border-[rgba(45,143,94,0.12)]',
  TechnicalInterview:   'bg-green-bg text-green border-[rgba(45,143,94,0.12)]',
  FinalRound:           'bg-green-bg text-green border-[rgba(45,143,94,0.12)]',
  OfferReceived:        'bg-[rgba(45,143,94,0.07)] text-[#2d8f5e] border-[rgba(45,143,94,0.12)]',
  Accepted:             'bg-green-bg text-green border-[rgba(45,143,94,0.15)]',
  Rejected:             'bg-red-bg text-red border-[rgba(196,84,84,0.12)]',
  Withdrawn:            'bg-[rgba(120,120,120,0.06)] text-[#888] border-[rgba(120,120,120,0.1)]',
};

export default function StatusBadge({ status }) {
  const colorClasses = STATUS_BADGE_STYLES[status] || STATUS_BADGE_STYLES.Analyzing;
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`inline-block py-1 px-[0.65rem] rounded-sm text-[0.72rem] font-semibold tracking-[0.02em] border ${colorClasses}`}>
      {label}
    </span>
  );
}
