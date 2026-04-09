import { STATUS_HE, STATUS_COLORS } from '../utils/constants';

export default function StatusBadge({ status }) {
  const cssClass = STATUS_COLORS[status] || 'analyzing';
  const label = STATUS_HE[status] || status;
  return <span className={`badge badge-${cssClass}`}>{label}</span>;
}
