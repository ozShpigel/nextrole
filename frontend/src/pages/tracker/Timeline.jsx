import { formatDateTime } from '../../utils/format';
import { NOTE_CATEGORIES_HE } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';

export default function Timeline({ statusUpdates, interviews, notes }) {
  const items = [];

  (statusUpdates || []).forEach((s) => items.push({
    date: s.timestamp,
    type: 'status',
    node: (
      <div className="timeline-item" key={`s-${s.timestamp}`}>
        <div className="timeline-icon status">&#x1F4CA;</div>
        <div className="timeline-content">
          <div className="timeline-text"><StatusBadge status={s.fromStatus} /> &larr; <StatusBadge status={s.toStatus} /></div>
          {s.note && <div className="timeline-text text-dim">{s.note}</div>}
          <div className="timeline-date">{formatDateTime(s.timestamp)}</div>
        </div>
      </div>
    ),
  }));

  (interviews || []).forEach((i) => items.push({
    date: i.scheduledAt,
    type: 'interview',
    node: (
      <div className="timeline-item" key={`i-${i.id}`}>
        <div className="timeline-icon interview">&#x1F3A4;</div>
        <div className="timeline-content">
          <div className="timeline-text">ראיון {i.type} {i.interviewer ? `- ${i.interviewer}` : ''} {i.completed ? '\u2705' : ''}</div>
          <div className="timeline-date">{formatDateTime(i.scheduledAt)}</div>
        </div>
      </div>
    ),
  }));

  (notes || []).forEach((n) => items.push({
    date: n.createdAt,
    type: 'note',
    node: (
      <div className="timeline-item" key={`n-${n.id}`}>
        <div className="timeline-icon note">&#x1F4DD;</div>
        <div className="timeline-content">
          <div className="timeline-text">{n.content.substring(0, 100)}{n.content.length > 100 ? '...' : ''}</div>
          <div className="timeline-date">{formatDateTime(n.createdAt)} {n.category ? `| ${NOTE_CATEGORIES_HE[n.category] || n.category}` : ''}</div>
        </div>
      </div>
    ),
  }));

  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (items.length === 0) return <p className="empty-state">אין פעילות עדיין</p>;

  return <>{items.map((item, idx) => <div key={idx}>{item.node}</div>)}</>;
}
