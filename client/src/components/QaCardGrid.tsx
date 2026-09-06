import { useEffect, useRef, useState } from 'react';
import { Pencil, Check, Trash2, ArrowUp, ArrowDown, ChevronDown, Plus, Search, X } from 'lucide-react';
import type { QaEntry } from '../lib/types';
import { AutoGrowTextarea } from './AutoGrowTextarea';

const ED_BTN = 'rounded-full border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;

const INPUT_CLASS =
  'w-full p-[0.6rem_0.85rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] font-medium outline-none transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] bg-[var(--ed-paper)]';
const TEXTAREA_CLASS =
  'w-full p-[0.75rem_0.95rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] outline-none leading-[1.7] whitespace-pre-wrap transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] bg-[var(--ed-paper)]';
const ICON_BTN =
  'h-7 w-7 p-0 inline-flex items-center justify-center rounded-full text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)] disabled:opacity-40 disabled:pointer-events-none';

const GENERAL_LABEL = 'General';
const ALL_LABEL = 'All';

let rowSeq = 0;
const nextRowId = () => `qa-row-${++rowSeq}`;

/* One chip per existing topic (single-select — a question has one topic;
 * click again to clear), plus a "+ Topic" affordance that opens a small
 * inline input for a new topic. */
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
                ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
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

type Row = { entry: QaEntry; id: string; index: number };

/* One row in the list: a collapsed question (+ topic label), or — while
 * editing — a form (question, answer, topic chips, reorder/delete). Expanded
 * state shows the answer inline, with a row-level Edit action, no hover
 * required. */
function QaListRow({
  row, editing, expanded, pos, siblingsCount, topics, refCallback,
  onToggleExpand, onEdit, onDone, onUpdate, onMove, onRemove,
}: {
  row: Row;
  editing: boolean;
  expanded: boolean;
  pos: number;
  siblingsCount: number;
  topics: string[];
  refCallback: (el: HTMLDivElement | null) => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDone: () => void;
  onUpdate: (patch: Partial<QaEntry>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const topic = (row.entry.topic ?? '').trim();

  if (editing) {
    return (
      <div ref={refCallback} className="border border-[var(--ed-accent)] bg-[var(--ed-panel)] p-[1rem] flex flex-col gap-2">
        <input
          className={INPUT_CLASS}
          placeholder="Question (e.g. Where do you see yourself in 5 years?)"
          value={row.entry.question}
          onChange={(ev) => onUpdate({ question: ev.target.value })}
          dir="auto"
          aria-label="Question"
        />
        <AutoGrowTextarea
          className={TEXTAREA_CLASS}
          style={{ minHeight: '120px' }}
          placeholder="Your prepared answer / rubric for answering this question"
          value={row.entry.answer}
          onChange={(ev) => onUpdate({ answer: ev.target.value })}
          dir="auto"
          spellCheck={false}
          aria-label="Answer"
        />
        <div className="flex items-center gap-[0.4rem] flex-wrap">
          <TopicChips topics={topics} value={(row.entry.topic ?? '').trim()} onChange={(t) => onUpdate({ topic: t })} />
        </div>
        <div className="flex items-center justify-between mt-1 pt-2 border-t border-dashed border-[var(--ed-rule)]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={pos === 0}
              aria-label="Move up"
              className={ICON_BTN}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={pos === siblingsCount - 1}
              aria-label="Move down"
              className={ICON_BTN}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove question"
              className={`${ICON_BTN} hover:text-[var(--ed-no)]`}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <button type="button" onClick={onDone} className={`${ED_GHOST} inline-flex items-center gap-[0.35rem]`}>
            <Check size={12} /> Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={refCallback} className="border border-[var(--ed-rule)] bg-[var(--ed-panel)]">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2.5 px-[0.9rem] py-[0.8rem] text-start transition-colors hover:bg-[var(--ed-paper)]/60"
      >
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 text-[var(--ed-ink-faint)] transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
        <span className="flex-1 min-w-0 flex flex-col gap-[0.15rem]">
          {topic && (
            <span dir="auto" className="text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-faint)]">
              {topic}
            </span>
          )}
          <span dir="auto" className="text-[0.88rem] font-medium leading-snug text-[var(--ed-ink)] truncate">
            {row.entry.question.trim() || <span className="italic font-normal text-[var(--ed-ink-faint)]">(Untitled question)</span>}
          </span>
        </span>
      </button>
      {expanded && (
        <div className="px-[0.9rem] pb-[0.9rem] pt-[0.7rem] pl-[2.65rem] border-t border-dashed border-[var(--ed-rule)] flex flex-col gap-[0.65rem]">
          {row.entry.answer.trim() ? (
            <p dir="auto" className="text-[0.85rem] leading-[1.7] text-[var(--ed-ink-soft)] whitespace-pre-wrap text-start">
              {row.entry.answer}
            </p>
          ) : (
            <p className="text-[0.8rem] text-[var(--ed-ink-faint)] italic">No answer yet — hit Edit to write one.</p>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={onEdit} className={`${ED_GHOST} inline-flex items-center gap-[0.35rem]`}>
              <Pencil size={12} /> Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Rehearsal-first Q&A rubric: a scannable list of every question in the
 * (topic- and search-filtered) set, collapsed to one line by default —
 * tap/click a row to reveal its answer inline. Free-form topics (e.g. a
 * project, or "Self presentation") double as the only categorization —
 * click "+ Topic" on any question to tag it, and a filter chip for that
 * topic appears automatically.
 *
 * Controlled: edits flow through onChange into the page's `qa` state on every
 * keystroke — filtering only hides rows, never discards data. Persistence
 * stays with the section-level Save row.
 */
export function QaCardGrid({ entries, onChange }: { entries: QaEntry[]; onChange: (next: QaEntry[]) => void }) {
  const [ids, setIds] = useState<string[]>(() => entries.map(nextRowId));
  const [prevEntries, setPrevEntries] = useState(entries);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  // 'all' = no filter, '' = the General (topic-less) group, otherwise a
  // lowercased topic key.
  const [topicFilter, setTopicFilter] = useState<'all' | string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  // The array we last emitted through onChange; anything else arriving via
  // props is an external replacement (initial load, history restore, discard).
  const lastEmitted = useRef<QaEntry[] | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  if (entries !== prevEntries) {
    setPrevEntries(entries);
    if (entries !== lastEmitted.current) {
      setIds(entries.map(nextRowId));
      setEditingId(null);
      setExpandedIds(new Set());
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
  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = (e: QaEntry) =>
    !query || e.question.toLowerCase().includes(query) || e.answer.toLowerCase().includes(query);
  const filteredRows = rows.filter(
    (r) => (topicFilter === 'all' || topicKeyOf(r.entry) === topicFilter) && matchesQuery(r.entry),
  );

  // A filter change (topic or search) can hide the row currently being
  // edited — close the form rather than keep it open off-screen.
  if (editingId !== null && !filteredRows.some((r) => r.id === editingId)) {
    setEditingId(null);
  }

  useEffect(() => {
    if (!scrollToId) return;
    const el = rowRefs.current.get(scrollToId);
    el?.scrollIntoView?.({ block: 'nearest' });
    setScrollToId(null);
  }, [scrollToId]);

  function update(index: number, patch: Partial<QaEntry>): void {
    emit(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)), ids);
  }

  function remove(row: Row): void {
    emit(entries.filter((_, i) => i !== row.index), ids.filter((_, i) => i !== row.index));
    if (editingId === row.id) setEditingId(null);
    setExpandedIds((prev) => {
      if (!prev.has(row.id)) return prev;
      const next = new Set(prev);
      next.delete(row.id);
      return next;
    });
  }

  /* Swap with the adjacent sibling in the same topic group (flat-array swap).
   * Always safe: the visible topic filter (if any) already matches this
   * row's topic, so it never hides a same-topic sibling from view. */
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
    // Pre-tag with the active topic filter so the new row stays visible;
    // clear any active search so it isn't immediately hidden while empty.
    const topic = topicFilter !== 'all' ? (topics.find((t) => t.toLowerCase() === topicFilter) ?? '') : '';
    emit(
      [...entries, { question: '', answer: '', categories: [], topic }],
      [...ids, id],
    );
    setEditingId(id);
    setExpandedIds((prev) => new Set(prev).add(id));
    setSearchQuery('');
    setScrollToId(id);
  }

  function startEdit(id: string): void {
    setEditingId(id);
    setExpandedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function toggleExpand(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* Toggle semantics: clicking the active topic chip clears the topic filter
   * (falls back to 'all'); the 'all' chip itself is a direct selection. */
  function selectTopicFilter(key: 'all' | string): void {
    const next = key === 'all' ? 'all' : topicFilter === key ? 'all' : key;
    setTopicFilter(next);
  }

  function clearFilters(): void {
    setTopicFilter('all');
    setSearchQuery('');
  }

  const countForTopic = (key: string) => entries.filter((e) => topicKeyOf(e) === key).length;
  const generalCount = countForTopic('');

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">
          No questions yet. Add prepared answers to common interview questions like "Where do you see yourself in 5 years?".
        </p>
      ) : (
        <>
          <div
            className="flex items-center gap-[0.3rem] md:gap-[0.4rem] flex-wrap"
            role="group"
            aria-label="Filter questions by topic"
          >
            {[
              { key: 'all', label: ALL_LABEL, count: entries.length },
              ...topics.map((t) => ({ key: t.toLowerCase(), label: t, count: countForTopic(t.toLowerCase()) })),
              ...(generalCount > 0 ? [{ key: '', label: GENERAL_LABEL, count: generalCount }] : []),
            ].map(({ key, label, count }) => {
              const selected = key === 'all' ? topicFilter === 'all' : topicFilter === key;
              return (
                <button
                  key={key || GENERAL_LABEL}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectTopicFilter(key)}
                  dir="auto"
                  className={`rounded-full border px-2 py-[0.2rem] text-[0.6rem] tracking-[0.06em] md:px-2.5 md:py-[0.28rem] md:text-[0.66rem] md:tracking-[0.1em] font-semibold uppercase tabular-nums transition-all ${
                    selected
                      ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
                      : 'border-[var(--ed-rule)] text-[var(--ed-ink-faint)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
                  }`}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ed-ink-faint)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(ev) => setSearchQuery(ev.target.value)}
              placeholder="Search questions and answers…"
              aria-label="Search questions"
              dir="auto"
              className={`${INPUT_CLASS} pl-9 pr-9`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </>
      )}

      {entries.length > 0 && filteredRows.length === 0 && (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">
          No questions match {query ? 'your search' : 'the current filter'}.{' '}
          <button
            type="button"
            onClick={clearFilters}
            className="not-italic underline underline-offset-2 hover:text-[var(--ed-ink)] transition-colors"
          >
            Clear filters
          </button>
        </p>
      )}

      {filteredRows.length > 0 && (
        <div className="flex flex-col gap-2">
          {filteredRows.map((row) => {
            const editing = editingId === row.id;
            const key = topicKeyOf(row.entry);
            const siblings = rows.filter((r) => topicKeyOf(r.entry) === key);
            const pos = siblings.findIndex((r) => r.id === row.id);
            return (
              <QaListRow
                key={row.id}
                row={row}
                editing={editing}
                expanded={expandedIds.has(row.id)}
                pos={pos}
                siblingsCount={siblings.length}
                topics={topics}
                refCallback={(el) => {
                  if (el) rowRefs.current.set(row.id, el);
                  else rowRefs.current.delete(row.id);
                }}
                onToggleExpand={() => toggleExpand(row.id)}
                onEdit={() => startEdit(row.id)}
                onDone={() => setEditingId(null)}
                onUpdate={(patch) => update(row.index, patch)}
                onMove={(dir) => move(row, dir)}
                onRemove={() => remove(row)}
              />
            );
          })}
        </div>
      )}

      <div>
        <button type="button" onClick={add} className={`${ED_GHOST} inline-flex items-center gap-[0.4rem]`}>
          <Plus size={14} /> Add question
        </button>
      </div>
    </div>
  );
}
