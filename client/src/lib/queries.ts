import { useQuery } from '@tanstack/react-query';
import { api, discoveryApi, matchApi } from './api';
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
    queryFn: () => discoveryApi(`/jobs${qs ? `?${qs}` : ''}`),
    staleTime: 30 * 1000,
  });
}

// Public client config (e.g. demo mode) — drives the read-only banner.
export function useConfig() {
  return useQuery<{ demoMode: boolean }>({
    queryKey: ['config'],
    queryFn: () => api('/config'),
    staleTime: Infinity,
  });
}

// True on the read-only demo instance. Mutating buttons render disabled with
// DEMO_DISABLED_TITLE instead of failing with a 403 alert after the click.
export function useDemoMode(): boolean {
  return useConfig().data?.demoMode ?? false;
}

export const DEMO_DISABLED_TITLE = 'Disabled in the read-only demo';

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
