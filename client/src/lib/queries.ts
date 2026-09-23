import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, matchApi, poolApi } from './api';
import type {
  ProfileResponse,
  InterviewPrepResponse,
  MockSessionListItem,
  MockSession,
  ScoredJobsQuery,
  ScoredJobsResponse,
  InterviewRetroListItem,
  InterviewInsightResponse,
  ResumePack,
  ResumeFileMeta,
  MessageItem,
  PoolScanResult,
  PoolBandResult,
} from './types';

// The Matches page's primary data source — every discovered job is scored at
// ingest time now, so this is a filtered/sorted browse over already-scored
// jobs, not an on-demand search. Short staleTime: scoring happens on a cron,
// so results only change between discovery runs, but a save/dismiss should
// still feel responsive on refetch.
export function useScoredJobs(query: ScoredJobsQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return useQuery<ScoredJobsResponse>({
    queryKey: ['discovery', 'jobs', query],
    queryFn: () => poolApi(`/jobs${qs ? `?${qs}` : ''}`),
    staleTime: 30 * 1000,
  });
}

// The match tab's scan: narrow the shared pool against this user's profile,
// score whatever has never been scored for them, persist it. Ingest scores
// nothing, so this is what puts anything on the board at all.
//
// A query rather than a mutation even though it writes. Two reasons, and the
// second is why the first matters: React Query dedupes concurrent queries by
// key, so StrictMode\x27s double-mount fires ONE scan instead of two; and a
// mutation fired from a mount effect settles against the observer that started
// it, which in StrictMode is the mount React then throws away - leaving the
// rendered component showing "Scoring..." forever over a request that finished.
//
// staleTime Infinity + gcTime 0: never re-scans while the page stays open
// (a scan costs Claude calls), always re-scans on a fresh visit.
export function usePoolScan(enabled: boolean) {
  return useQuery<PoolScanResult>({
    queryKey: ['match', 'pool-scan'],
    queryFn: () => matchApi('/pool-scan', { method: 'POST' }),
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

// The board's first paint: the retrieved band, scored or not.
//
// Cheap and safe to refetch — one embedding plus a vector search, no Claude
// call — which is the whole point of separating it from the scan. A short
// staleTime rather than Infinity, because scoring writes rows this read merges
// in, so the board needs to pick them up.
export function usePoolBand(enabled: boolean) {
  return useQuery<PoolBandResult>({
    queryKey: ['match', 'pool-band'],
    queryFn: () => matchApi('/pool-band'),
    enabled,
    staleTime: 15 * 1000,
    retry: false,
  });
}

// Score specific postings, as the reader scrolls into unscored cards.
//
// A mutation, unlike the scan: it is fired from an interaction rather than a
// mount, so the StrictMode double-mount problem that forced usePoolScan to be
// a query does not apply here. Concurrency is handled server-side by an
// in-flight id set, so several batches may be outstanding at once.
export function useScoreJobs() {
  const qc = useQueryClient();
  return useMutation<PoolScanResult, Error, string[]>({
    mutationFn: (jobIds) => matchApi('/score-jobs', {
      method: 'POST',
      body: JSON.stringify({ jobIds }),
    }),
    onSuccess: (result) => {
      // Only when something actually landed: a no-op response must not make
      // the board flicker.
      if (result.scored > 0) {
        qc.invalidateQueries({ queryKey: ['match', 'pool-band'] });
        qc.invalidateQueries({ queryKey: ['discovery', 'jobs'] });
      }
    },
  });
}

export interface Notice {
  id: string;
  kind: string;
  data: Record<string, string>;
  createdAt: string;
}

// Things that happened to the account while the user was not looking. Read on
// every page load by the app shell, not by one page: the only notice today is
// raised during a sign-in redirect, so there is no page alive to receive a
// toast, and the whole point is that someone who does not know to look still
// finds out.
export function useNotices() {
  return useQuery<Notice[]>({
    queryKey: ['notices'],
    queryFn: () => api('/notices'),
    retry: false,
  });
}

export function useDismissNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/notices/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notices'] }),
  });
}

// Google sign-in status. `available` is false whenever sign-in cannot work on
// this instance — no OAuth credentials configured, or Fixed identity mode,
// where the user comes from configuration and no cookie is ever issued. The
// client has no other way to tell those deployments apart, and offering a
// sign-in link that 404s is worse than offering none.
export function useAuthStatus() {
  return useQuery<{ signedIn: boolean; email: string | null; available: boolean }>({
    queryKey: ['auth', 'me'],
    queryFn: () => api('/auth/me'),
    staleTime: Infinity,
    retry: false,
  });
}


// Has this visitor uploaded a CV yet? One definition, because three places
// now branch on it — the onboarding gate that redirects, the nav that hides
// its links, and the landing page that hides "Browse your matches" — and
// three copies of "what counts as a profile" would drift.
//
// `undefined` while either query is still loading or has errored, so callers
// can tell "no profile" from "don't know yet" and neither flashes a nav in and
// out on first paint nor locks a real user out on a transient blip. Everything
// here fails OPEN on that distinction: only a confirmed, loaded empty state
// counts as a new visitor.
//
// Read from `structured`, NOT from `content`. `content` is the rendered,
// prompt-facing string, and rendering an empty profile still produces the
// wrapper — a brand-new visitor gets back a 47-character
// <professional_profile> element with two blank lines inside it, whose
// .trim() is perfectly truthy. The check this replaced tested exactly that, so every
// visitor looked like a returning one: the nav offered five links that bounce,
// and the onboarding redirect never fired at all.
//
// Experience-or-skills is the server's own test for the same question
// (PoolScanService: "no profile, nothing to score against"), so the client and
// the scan agree on who is new rather than each deciding for itself.
export function useHasProfile(): boolean | undefined {
  const profileQuery = useProfile();
  const resumeQuery = useResumeFile();
  if (profileQuery.isLoading || resumeQuery.isLoading) return undefined;
  if (profileQuery.isError || resumeQuery.isError) return undefined;
  // An uploaded résumé counts on its own: they have onboarded even if the
  // parse came back thin.
  if (resumeQuery.data) return true;
  const structured = profileQuery.data?.structured;
  return !!(structured?.experience?.length || structured?.skills?.length);
}

// staleTime on both: the App-level onboarding gate calls these on every
// route, not just Settings, so without one they'd refetch far more often
// than profile/résumé data (which only changes on an explicit edit) needs.
export function useProfile() {
  return useQuery<ProfileResponse>({
    queryKey: ['match', 'profile'],
    queryFn: () => matchApi('/profile'),
    staleTime: 5 * 60 * 1000,
  });
}

// The currently-stored uploaded résumé file, if any. 404 means "none
// uploaded yet" — a normal state, not an error, so it's mapped to null
// rather than left to bubble up as a query error.
export function useResumeFile() {
  return useQuery<ResumeFileMeta | null>({
    queryKey: ['match', 'profile', 'resume-file'],
    queryFn: async () => {
      try {
        return await matchApi('/profile/resume-file');
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}


export function useInterviewPrep() {
  return useQuery<InterviewPrepResponse>({
    queryKey: ['match', 'interview-prep'],
    queryFn: () => matchApi('/interview-prep'),
  });
}

export function useMockSessions() {
  return useQuery<MockSessionListItem[]>({
    queryKey: ['mock-interview', 'sessions'],
    queryFn: () => api('/mock-interview/sessions'),
  });
}

export function useMockSession(id: string, enabled: boolean) {
  return useQuery<MockSession>({
    queryKey: ['mock-interview', 'sessions', id],
    queryFn: () => api(`/mock-interview/sessions/${id}`),
    enabled,
  });
}

export function useApplicationDetail(id: string) {
  return useQuery({
    queryKey: ['applications', id],
    queryFn: () => api(`/applications/${id}`),
  });
}

// The tailored résumé pack for one application, if generated. Only enabled
// when the Review Pack view is actually open — the list already carries
// hasPack/packGeneratedAt so this fetch isn't needed just to render the row.
export function usePack(appId: string, enabled: boolean) {
  return useQuery<ResumePack>({
    queryKey: ['applications', appId, 'pack'],
    queryFn: () => api(`/applications/${appId}/pack`),
    enabled,
  });
}

export function useApplications() {
  return useQuery({
    queryKey: ['applications'],
    queryFn: () => api('/applications'),
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => api('/stats'),
  });
}

export function useUpcomingInterviews() {
  return useQuery({
    queryKey: ['interviews', 'upcoming'],
    queryFn: () => api('/interviews/upcoming'),
  });
}

// Cross-application retro log, most recent completed interview first.
export function useInterviewRetros() {
  return useQuery<InterviewRetroListItem[]>({
    queryKey: ['interview-insights', 'retros'],
    queryFn: () => api('/interview-insights/retros'),
  });
}

// The persisted, standing observation summary (if any) plus its staleness
// relative to the current retro set.
export function useInterviewInsight() {
  return useQuery<InterviewInsightResponse>({
    queryKey: ['interview-insights', 'insight'],
    queryFn: () => api('/interview-insights'),
  });
}

// Mailbot-parsed emails, most recent first — powers the Messages tab.
export function useMessages() {
  return useQuery<MessageItem[]>({
    queryKey: ['messages'],
    queryFn: () => api('/messages'),
  });
}
