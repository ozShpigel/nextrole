import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, matchApi, discoveryApi } from './api';

export function useTriggerRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (criteriaId: string) =>
      discoveryApi(`/run/${criteriaId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['discovery', 'criteria'] });
    },
  });
}

export function useDeleteCriteria() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      discoveryApi(`/criteria/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery', 'criteria'] });
    },
  });
}

export function useAbortRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      discoveryApi(`/runs/${runId}/abort`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery', 'runs'] });
    },
  });
}

export function useSaveCriteria() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: Record<string, unknown> }) => {
      if (id) {
        return discoveryApi(`/criteria/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      }
      return discoveryApi('/criteria', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery', 'criteria'] });
    },
  });
}

export function useSaveJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      discoveryApi(`/jobs/${jobId}/save`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });
}

export function useDismissJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      discoveryApi(`/jobs/${jobId}/dismiss`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });
}

export function useRescoreJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      discoveryApi(`/jobs/${jobId}/rescore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      matchApi('/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match', 'profile'] });
    },
  });
}

export function useUpdateAppStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, newStatus, note }: { appId: string; newStatus: string; note?: string }) =>
      api(`/applications/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ newStatus, note }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['applications', variables.appId] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

export function useDeleteApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/applications/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

export function useAddApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/applications', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

export function useUpdateSalary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, salary }: { appId: string; salary: string | null }) =>
      api(`/applications/${appId}/salary`, {
        method: 'PUT',
        body: JSON.stringify({ salary }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['applications', variables.appId] });
    },
  });
}

export function useGenerateCompanySummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      api(`/applications/${appId}/company-summary`, { method: 'POST' }),
    onSuccess: (_data, appId) => {
      queryClient.invalidateQueries({ queryKey: ['applications', appId] });
    },
  });
}

export function useAddInterview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, body }: { appId: string; body: Record<string, unknown> }) =>
      api(`/applications/${appId}/interviews`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['applications', variables.appId] });
    },
  });
}

export function useUpdateInterview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ interviewId, body }: { interviewId: string; body: Record<string, unknown> }) =>
      api(`/interviews/${interviewId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

export function useDeleteInterview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (interviewId: string) =>
      api(`/interviews/${interviewId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

export function useAddNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, body }: { appId: string; body: Record<string, unknown> }) =>
      api(`/applications/${appId}/notes`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['applications', variables.appId] });
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api(`/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}
