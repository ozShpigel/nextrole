import { formatDateTime } from '../../utils/format';
import { NOTE_CATEGORY_LABELS } from '../../utils/constants';
import StatusBadge from '../../components/StatusBadge';

export default function Timeline({ statusUpdates, interviews, notes }) {
  const items = [
    ...(statusUpdates || []).map((s) => ({ date: s.timestamp, type: 'status', data: s })),
    ...(interviews || []).map((i) => ({ date: i.scheduledAt, type: 'interview', data: i })),
    ...(notes || []).map((n) => ({ date: n.createdAt, type: 'note', data: n })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (items.length === 0) return <p className="text-center py-12 text-muted-foreground text-[0.88rem]">No activity yet</p>;

  return (
    <>
      {items.map((item) => {
        if (item.type === 'status') {
          const s = item.data;
          return (
            <div className="group flex gap-4 py-[0.85rem] border-b border-border items-start transition-colors last:border-b-0" key={`s-${s.timestamp}`}>
              <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[0.8rem] shrink-0 transition-transform group-hover:scale-[1.08] bg-blue-bg text-blue">&#x1F4CA;</div>
              <div className="flex-1">
                <div className="text-[0.84rem] mt-[0.15rem]"><StatusBadge status={s.fromStatus} /> &larr; <StatusBadge status={s.toStatus} /></div>
                {s.note && <div className="text-[0.84rem] mt-[0.15rem] text-muted-foreground">{s.note}</div>}
                <div className="text-[0.73rem] text-muted-foreground">{formatDateTime(s.timestamp)}</div>
              </div>
            </div>
          );
        }
        if (item.type === 'interview') {
          const i = item.data;
          return (
            <div className="group flex gap-4 py-[0.85rem] border-b border-border items-start transition-colors last:border-b-0" key={`i-${i.id}`}>
              <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[0.8rem] shrink-0 transition-transform group-hover:scale-[1.08] bg-green-bg text-green">&#x1F3A4;</div>
              <div className="flex-1">
                <div className="text-[0.84rem] mt-[0.15rem]">Interview: {i.type} {i.interviewer ? `- ${i.interviewer}` : ''} {i.completed ? '✅' : ''}</div>
                <div className="text-[0.73rem] text-muted-foreground">{formatDateTime(i.scheduledAt)}</div>
              </div>
            </div>
          );
        }
        const n = item.data;
        return (
          <div className="group flex gap-4 py-[0.85rem] border-b border-border items-start transition-colors last:border-b-0" key={`n-${n.id}`}>
            <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[0.8rem] shrink-0 transition-transform group-hover:scale-[1.08] bg-yellow-bg text-yellow">&#x1F4DD;</div>
            <div className="flex-1">
              <div className="text-[0.84rem] mt-[0.15rem]">{n.content.substring(0, 100)}{n.content.length > 100 ? '...' : ''}</div>
              <div className="text-[0.73rem] text-muted-foreground">{formatDateTime(n.createdAt)} {n.category ? `| ${NOTE_CATEGORY_LABELS[n.category] || n.category}` : ''}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}
