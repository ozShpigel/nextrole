import { useQuery } from '@tanstack/react-query';
import { api, matchApi, discoveryApi } from './api';
import type { ProfileResponse, ProfileHistoryResponse, HistoryField } from './types';

export function useDiscoveryHealth() {
  return useQuery({
    queryKey: ['discovery', 'health'],
    queryFn: () => discoveryApi('/health'),
    retry: 5,
    retryDelay: 22000,
    staleTime: Infinity,
  });
}

export function useDiscoveryCriteria(enabled: boolean) {
  return useQuery({
    queryKey: ['discovery', 'criteria'],
    queryFn: () => discoveryApi('/criteria'),
    enabled,
  });
}

export function useDiscoveryRuns(enabled: boolean) {
  return useQuery({
    queryKey: ['discovery', 'runs'],
    queryFn: () => discoveryApi('/runs'),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as Array<{ status: string }> | undefined;
      if (!data) return false;
      const hasActive = data.some((run) =>
        ['pending', 'scraping', 'scoring'].includes(run.status),
      );
      return hasActive ? 5000 : false;
    },
  });
}

export function useRunDetail(runId: string) {
  return useQuery({
    queryKey: ['discovery', 'runs', runId],
    queryFn: () => discoveryApi(`/runs/${runId}`),
    refetchInterval: (query) => {
      const data = query.state.data as { status: string } | undefined;
      if (!data) return false;
      const isActive = ['pending', 'scraping', 'scoring'].includes(data.status);
      return isActive ? 5000 : false;
    },
  });
}

export function useRunJobs(runId: string, isActive: boolean) {
  return useQuery({
    queryKey: ['discovery', 'runs', runId, 'jobs'],
    queryFn: () => discoveryApi(`/runs/${runId}/jobs`),
    refetchInterval: isActive ? 5000 : false,
  });
}

export function useProfile() {
  return useQuery<ProfileResponse>({
    queryKey: ['match', 'profile'],
    queryFn: () => matchApi('/profile'),
  });
}

export function useProfileHistory(field: HistoryField, enabled: boolean) {
  return useQuery<ProfileHistoryResponse>({
    queryKey: ['match', 'profile', 'history', field],
    queryFn: () => matchApi(`/profile/history/${field}`),
    enabled,
  });
}

export function useApplicationDetail(id: string) {
  return useQuery({
    queryKey: ['applications', id],
    queryFn: () => api(`/applications/${id}`),
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
