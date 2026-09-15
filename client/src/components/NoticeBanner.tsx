import { useDismissNotice, useNotices, type Notice } from '../lib/queries';

// Copy lives here rather than on the server: the server records what happened,
// the client says it, so wording stays where the design tokens are.
function describe(notice: Notice): { title: string; detail: string } | null {
  if (notice.kind !== 'singleton_parked') return null;

  const parked = (notice.data.parked ?? '').split(',').filter(Boolean);
  const names: Record<string, string> = {
    profile: 'profile',
    resumeFile: 'résumé',
    interviewInsights: 'interview notes',
  };
  const listed = parked.map((p) => names[p] ?? p);
  const readable =
    listed.length <= 1
      ? listed[0] ?? 'document'
      : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]}`;

  return {
    title: `We kept your account's ${readable}.`,
    // The honest version: say where the other one went. A parked document
    // nobody can find again is a deletion with a nicer name.
    detail:
      parked.length === 1
        ? `You had another one in the session you signed in from. It hasn't been deleted — ask to have it restored if it was the one you wanted.`
        : `You had others in the session you signed in from. They haven't been deleted — ask to have them restored if they were the ones you wanted.`,
  };
}

/**
 * Account-level notices, shown in the app shell on every page.
 *
 * Not a toast: the only notice today is raised during the sign-in redirect, so
 * the page that would have shown a toast is the one being navigated away from.
 * It has to survive that, the reload after it, and the user opening the site
 * on a different device tomorrow — which is why it is stored server-side and
 * dismissed server-side too.
 */
export function NoticeBanner() {
  const { data: notices } = useNotices();
  const dismiss = useDismissNotice();

  if (!notices?.length) return null;

  return (
    <div data-notice-banner>
      {notices.map((notice) => {
        const copy = describe(notice);
        if (!copy) return null;
        return (
          <div
            key={notice.id}
            role="status"
            className="border-b border-[var(--ed-rule)] bg-[var(--ed-paper-raised)] px-8 py-3 flex items-start gap-4 max-sm:px-4"
          >
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
              <span className="text-[var(--ed-ink)]">{copy.title}</span>{' '}
              <span className="text-[var(--ed-ink-soft)]">{copy.detail}</span>
            </div>
            <button
              type="button"
              onClick={() => dismiss.mutate(notice.id)}
              disabled={dismiss.isPending}
              className="shrink-0 text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-[var(--ed-ink-faint)] transition-colors hover:text-[var(--ed-ink)] disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
}
