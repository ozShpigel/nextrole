import { useRef, useState } from 'react';
import { ChevronDown, Pencil, Check, Trash2, ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { QA_CATEGORIES, type QaCategory, type QaEntry } from '../lib/types';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { CategoryToggleChips } from './CategoryToggleChips';

const ED_BTN = 'rounded-full border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;

const INPUT_CLASS =
  'w-full p-[0.6rem_0.85rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] font-medium outline-none transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] bg-[var(--ed-paper)]';
const TEXTAREA_CLASS =
  'w-full p-[0.75rem_0.95rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] outline-none leading-[1.7] whitespace-pre-wrap transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] bg-[var(--ed-paper)]';
const ICON_BTN =
  'h-7 w-7 p-0 inline-flex items-center justify-center rounded-full text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)] disabled:opacity-40 disabled:pointer-events-none';

// Tone per fixed category, mapped onto the editorial palette.
const CATEGORY_TONE: Record<QaCategory, string> = {
  HR: '--ed-gold',
  Technical: '--ed-accent',
  Behavioral: '--ed-yes',
};

const GENERAL_LABEL = 'General';

let rowSeq = 0;
const nextRowId = () => `qa-row-${++rowSeq}`;

/* Topic chips sit beside the category chips: one chip per existing topic
 * (single-select — a question has one topic; click again to clear), plus a
 * "+ Topic" affordance that opens a small inline input for a new topic. */
function TopicChips({ topics, value, onChange }: { topics: string[]; value: string; onChange: (next: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // Ensure the current value shows as a chip even if it's brand new.
  const options = [...topics];
  if (value && !options.some((t) => t.toLowerCase() === value.toLowerCase())) options.push(value);

  function commitDraft(): void {
    const topic = draft.trim();
    if (topic) onChange(topic);
    setDraft('');
    setAdding(false);
  }

  return (
    <>
      {options.map((topic) => {
        const selected = value.toLowerCase() === topic.toLowerCase();
        return (
          <button
            key={topic.toLowerCase()}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? '' : topic)}
            dir="auto"
            className={`rounded-full border px-2 py-[0.2rem] text-[0.64rem] font-semibold uppercase tracking-[0.1em] transition-all ${
              selected
                ? 'border-[var(--ed-ink)] bg-[var(--ed-ink)] text-[var(--ed-paper)]'
                : 'border-[var(--ed-rule)] text-[var(--ed-ink-faint)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
            }`}
          >
            {topic}
          </button>
        );
      })}
      {adding ? (
        <input
          autoFocus
          className="h-[1.6rem] w-[160px] px-2 border border-[var(--ed-ink)] text-[0.72rem] text-[var(--ed-ink)] outline-none bg-[var(--ed-paper)]"
          placeholder="New topic…"
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onBlur={commitDraft}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commitDraft(); }
            if (ev.key === 'Escape') { setDraft(''); setAdding(false); }
          }}
          dir="auto"
          aria-label="New topic"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add topic"
          className="rounded-full border border-dashed border-[var(--ed-rule)] px-2 py-[0.2rem] text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-faint)] transition-all hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]"
        >
          + Topic
        </button>
      )}
    </>
  );
}

/* Non-interactive mini chips shown on a collapsed row. Rows without categories
 * show nothing — the (0) counts on the filter chips already surface those. */
function CategoryStamps({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;
  return (
    <span className="flex items-center gap-[0.3rem] shrink-0">
      {categories.map((cat) => {
        const tone = CATEGORY_TONE[cat as QaCategory] ?? '--ed-ink-faint';
        return (
          <span
            key={cat}
            className="rounded-full border px-[0.4rem] py-[0.1rem] text-[0.58rem] font-semibold uppercase tracking-[0.12em]"
            style={{ borderColor: `color-mix(in oklab, var(${tone}) 45%, transparent)`, color: `var(${tone})` }}
          >
            {cat}
          </span>
        );
      })}
    </span>
  );
}

type Row = { entry: QaEntry; id: string; index: number };
type Group = { key: string; label: string; rows: Row[] };

/* Group rows by trimmed topic (case-insensitive key, first-seen casing), in
 * first-appearance order; topic-less rows collect in a trailing General group. */
function groupRows(rows: Row[]): Group[] {
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  const general: Group = { key: '', label: GENERAL_LABEL, rows: [] };
  for (const row of rows) {
    const topic = (row.entry.topic ?? '').trim();
    if (!topic) {
      general.rows.push(row);
      continue;
    }
    const key = topic.toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: topic, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  if (general.rows.length > 0) groups.push(general);
  return groups;
}

/**
 * Rehearsal-first Q&A rubric: topic-grouped, one-open-at-a-time accordion with
 * category filter chips and a read-first expanded view (per-question Edit).
 *
 * Controlled: edits flow through onChange into the page's `qa` state on every
 * keystroke — collapsing/filtering only hides inputs, never discards data.
 * Persistence stays with the section-level Save row.
 */
export function QaRubricAccordion({ entries, onChange }: { entries: QaEntry[]; onChange: (next: QaEntry[]) => void }) {
  const [ids, setIds] = useState<string[]>(() => entries.map(nextRowId));
  const [prevEntries, setPrevEntries] = useState(entries);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | QaCategory>('all');
  // Topic filter key: 'all' = no topic filter, '' = the General (topic-less)
  // group, otherwise a lowercased topic key. Combines (AND) with the category filter.
  const [topicFilter, setTopicFilter] = useState<'all' | string>('all');
  // The array we last emitted through onChange; anything else arriving via
  // props is an external replacement (initial load, history restore, discard).
  const lastEmitted = useRef<QaEntry[] | null>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());

  if (entries !== prevEntries) {
    setPrevEntries(entries);
    if (entries !== lastEmitted.current) {
      setIds(entries.map(nextRowId));
      setOpenId(null);
      setEditingId(null);
    }
  }

  function emit(nextEntries: QaEntry[], nextIds: string[]): void {
    lastEmitted.current = nextEntries;
    setPrevEntries(nextEntries);
    setIds(nextIds);
    onChange(nextEntries);
  }

  const rows: Row[] = entries.map((entry, index) => ({ entry, id: ids[index] ?? `qa-fallback-${index}`, index }));
  const topics: string[] = [];
  for (const r of rows) {
    const t = (r.entry.topic ?? '').trim();
    if (t && !topics.some((x) => x.toLowerCase() === t.toLowerCase())) topics.push(t);
  }
  const topicKeyOf = (e: QaEntry) => (e.topic ?? '').trim().toLowerCase();
  const matchesFilter = (e: QaEntry) =>
    (filter === 'all' || (e.categories ?? []).includes(filter)) &&
    (topicFilter === 'all' || topicKeyOf(e) === topicFilter);
  const groups = groupRows(rows)
    .map((g) => ({ ...g, rows: g.rows.filter((r) => matchesFilter(r.entry)) }))
    .filter((g) => g.rows.length > 0);

  function update(index: number, patch: Partial<QaEntry>): void {
    emit(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)), ids);
  }

  function remove(row: Row): void {
    emit(entries.filter((_, i) => i !== row.index), ids.filter((_, i) => i !== row.index));
    if (openId === row.id) {
      setOpenId(null);
      setEditingId(null);
    }
  }

  /* Swap with the adjacent sibling in the same topic group (flat-array swap). */
  function move(row: Row, dir: -1 | 1): void {
    const key = (row.entry.topic ?? '').trim().toLowerCase();
    const siblings = rows.filter((r) => (r.entry.topic ?? '').trim().toLowerCase() === key);
    const pos = siblings.findIndex((r) => r.id === row.id);
    const target = siblings[pos + dir];
    if (!target) return;
    const nextEntries = [...entries];
    const nextIds = [...ids];
    [nextEntries[row.index], nextEntries[target.index]] = [nextEntries[target.index], nextEntries[row.index]];
    [nextIds[row.index], nextIds[target.index]] = [nextIds[target.index], nextIds[row.index]];
    emit(nextEntries, nextIds);
  }

  function add(): void {
    const id = nextRowId();
    // Pre-tag with the active filters so the new row stays visible.
    const topic = topicFilter !== 'all' ? (topics.find((t) => t.toLowerCase() === topicFilter) ?? '') : '';
    emit(
      [...entries, { question: '', answer: '', categories: filter !== 'all' ? [filter] : [], topic }],
      [...ids, id],
    );
    setOpenId(id);
    setEditingId(id);
    // Scroll after the new row renders; jsdom has no scrollIntoView.
    requestAnimationFrame(() => {
      const el = rowEls.current.get(id);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function toggleOpen(id: string): void {
    setOpenId((cur) => (cur === id ? null : id));
    setEditingId(null);
  }

  function applyFilter(next: 'all' | QaCategory): void {
    setFilter(next);
    const open = rows.find((r) => r.id === openId);
    if (open && next !== 'all' && !(open.entry.categories ?? []).includes(next)) {
      setOpenId(null);
      setEditingId(null);
    }
  }

  /* Toggle semantics: clicking the active topic chip clears the topic filter. */
  function applyTopicFilter(key: string): void {
    const next = topicFilter === key ? 'all' : key;
    setTopicFilter(next);
    const open = rows.find((r) => r.id === openId);
    if (open && next !== 'all' && topicKeyOf(open.entry) !== next) {
      setOpenId(null);
      setEditingId(null);
    }
  }

  const countFor = (cat: QaCategory) => entries.filter((e) => (e.categories ?? []).includes(cat)).length;
  const countForTopic = (key: string) => entries.filter((e) => topicKeyOf(e) === key).length;
  const generalCount = countForTopic('');
  const canReorder = filter === 'all';

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">
          No questions yet. Add prepared answers to common interview questions like "Where do you see yourself in 5 years?".
        </p>
      ) : (
        <div className="flex items-center gap-[0.4rem] flex-wrap">
          <span className="flex items-center gap-[0.4rem] flex-wrap" role="group" aria-label="Filter questions by category">
            {(['all', ...QA_CATEGORIES] as const).map((cat) => {
              const selected = filter === cat;
              const label = cat === 'all' ? `All (${entries.length})` : `${cat} (${countFor(cat)})`;
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => applyFilter(cat)}
                  className={`rounded-full border px-2.5 py-[0.28rem] text-[0.66rem] font-semibold uppercase tracking-[0.1em] transition-all ${
                    selected
                      ? 'border-[var(--ed-ink)] bg-[var(--ed-ink)] text-[var(--ed-paper)]'
                      : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </span>
          {topics.length > 0 && (
            <>
              <span className="h-4 border-l border-[var(--ed-rule)] mx-[0.2rem]" aria-hidden="true" />
              <span className="flex items-center gap-[0.4rem] flex-wrap" role="group" aria-label="Filter questions by topic">
                {[...topics.map((t) => ({ key: t.toLowerCase(), label: t })), ...(generalCount > 0 ? [{ key: '', label: GENERAL_LABEL }] : [])].map(
                  ({ key, label }) => {
                    const selected = topicFilter === key;
                    return (
                      <button
                        key={key || GENERAL_LABEL}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => applyTopicFilter(key)}
                        dir="auto"
                        className={`rounded-full border px-2.5 py-[0.28rem] text-[0.66rem] font-semibold uppercase tracking-[0.1em] transition-all ${
                          selected
                            ? 'border-[var(--ed-ink)] bg-[var(--ed-ink)] text-[var(--ed-paper)]'
                            : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
                        }`}
                      >
                        {label} ({countForTopic(key)})
                      </button>
                    );
                  },
                )}
              </span>
            </>
          )}
        </div>
      )}

      {entries.length > 0 && groups.length === 0 && (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">No questions match the current filter.</p>
      )}

      {groups.map((group) => (
        <div key={group.key || GENERAL_LABEL}>
          <div className="flex items-center gap-3 mb-2">
            <span dir="auto" className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-[var(--ed-ink-soft)]">
              {group.label}
            </span>
            <span className="flex-1 border-t border-[var(--ed-rule)]" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            {group.rows.map((row) => {
              const open = openId === row.id;
              const editing = open && editingId === row.id;
              const siblings = rows.filter(
                (r) => (r.entry.topic ?? '').trim().toLowerCase() === (row.entry.topic ?? '').trim().toLowerCase(),
              );
              const pos = siblings.findIndex((r) => r.id === row.id);
              return (
                <div
                  key={row.id}
                  ref={(el) => { if (el) rowEls.current.set(row.id, el); else rowEls.current.delete(row.id); }}
                  className="border border-[var(--ed-rule)] -mt-px first:mt-0 bg-[var(--ed-panel)]"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleOpen(row.id)}
                    className="w-full flex items-center gap-3 p-[0.7rem_1rem] text-left transition-colors hover:bg-[var(--ed-paper)]"
                  >
                    <span className="shrink-0 text-[0.68rem] font-semibold tabular-nums text-[var(--ed-ink-faint)]">
                      {String(row.index + 1).padStart(2, '0')}
                    </span>
                    {/* text-start follows the auto-detected direction, so Hebrew questions align right */}
                    <span dir="auto" className="flex-1 min-w-0 text-[0.88rem] font-medium text-[var(--ed-ink)] truncate text-start">
                      {row.entry.question.trim() || <span className="italic text-[var(--ed-ink-faint)]">(Untitled question)</span>}
                    </span>
                    <CategoryStamps categories={row.entry.categories ?? []} />
                    <ChevronDown
                      size={15}
                      className={`shrink-0 text-[var(--ed-ink-faint)] transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {open && !editing && (
                    <div className="px-[1rem] pb-[0.9rem] border-t border-dashed border-[var(--ed-rule)]">
                      {row.entry.answer.trim() ? (
                        <p dir="auto" className="pt-3 text-[0.88rem] leading-[1.75] text-[var(--ed-ink)] whitespace-pre-wrap">
                          {row.entry.answer}
                        </p>
                      ) : (
                        <p className="pt-3 text-[0.82rem] text-[var(--ed-ink-faint)] italic">No answer yet — hit Edit to write one.</p>
                      )}
                      <div className="flex justify-end mt-3 pt-2 border-t border-dashed border-[var(--ed-rule)]">
                        <button
                          type="button"
                          onClick={() => setEditingId(row.id)}
                          className={`${ED_GHOST} inline-flex items-center gap-[0.35rem]`}
                        >
                          <Pencil size={12} /> Edit
                        </button>
                      </div>
                    </div>
                  )}

                  {editing && (
                    <div className="px-[1rem] pb-[0.9rem] pt-3 border-t border-dashed border-[var(--ed-rule)] flex flex-col gap-2">
                      <input
                        className={INPUT_CLASS}
                        placeholder="Question (e.g. Where do you see yourself in 5 years?)"
                        value={row.entry.question}
                        onChange={(ev) => update(row.index, { question: ev.target.value })}
                        dir="auto"
                        aria-label="Question"
                      />
                      <AutoGrowTextarea
                        className={TEXTAREA_CLASS}
                        style={{ minHeight: '120px' }}
                        placeholder="Your prepared answer / rubric for answering this question"
                        value={row.entry.answer}
                        onChange={(ev) => update(row.index, { answer: ev.target.value })}
                        dir="auto"
                        spellCheck={false}
                        aria-label="Answer"
                      />
                      <div className="flex items-center gap-[0.4rem] flex-wrap">
                        <CategoryToggleChips
                          value={row.entry.categories ?? []}
                          onChange={(next) => update(row.index, { categories: next })}
                        />
                        <span className="h-4 border-l border-[var(--ed-rule)] mx-[0.2rem]" aria-hidden="true" />
                        <TopicChips
                          topics={topics}
                          value={(row.entry.topic ?? '').trim()}
                          onChange={(t) => update(row.index, { topic: t })}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1 pt-2 border-t border-dashed border-[var(--ed-rule)]">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => move(row, -1)}
                            disabled={!canReorder || pos === 0}
                            aria-label="Move up"
                            title={canReorder ? undefined : 'Reorder under All'}
                            className={ICON_BTN}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(row, 1)}
                            disabled={!canReorder || pos === siblings.length - 1}
                            aria-label="Move down"
                            title={canReorder ? undefined : 'Reorder under All'}
                            className={ICON_BTN}
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(row)}
                            aria-label="Remove question"
                            className={`${ICON_BTN} hover:text-[var(--ed-no)]`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {/* "Done" only exits edit mode — saving stays with the section Save row. */}
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className={`${ED_GHOST} inline-flex items-center gap-[0.35rem]`}
                        >
                          <Check size={12} /> Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div>
        <button type="button" onClick={add} className={`${ED_GHOST} inline-flex items-center gap-[0.4rem]`}>
          <Plus size={14} /> Add question
        </button>
      </div>
    </div>
  );
}
