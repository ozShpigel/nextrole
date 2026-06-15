import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, matchApi, discoveryApi } from './api';
import type { TestPromptRequest, TestPromptResult, HistoryField, InterviewPrepHistoryField } from './types';

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

export function useTestPrompt() {
  return useMutation({
    mutationFn: (body: TestPromptRequest) =>
      matchApi('/test-prompt', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<TestPromptResult>,
  });
}

export function useRestoreHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ field, index }: { field: HistoryField; index: number }) =>
      matchApi(`/profile/history/${field}/restore`, {
        method: 'POST',
        body: JSON.stringify({ index }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['match', 'profile'] });
      queryClient.invalidateQueries({ queryKey: ['match', 'profile', 'history', variables.field] });
    },
  });
}

export function useSaveInterviewPrep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      matchApi('/interview-prep', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match', 'interview-prep'] });
    },
  });
}

export function useRestoreInterviewPrepHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ field, index }: { field: InterviewPrepHistoryField; index: number }) =>
      matchApi(`/interview-prep/history/${field}/restore`, {
        method: 'POST',
        body: JSON.stringify({ index }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['match', 'interview-prep'] });
      queryClient.invalidateQueries({ queryKey: ['match', 'interview-prep', 'history', variables.field] });
    },
  });
}

// Generates keyword cues for a saved self-presentation field. Cues are cached
// per saved version server-side, so the result is persisted on the interview-prep
// doc — invalidate it so a fresh load carries the cues. `force` re-generates
// even when a cached set already exists.
export function useGeneratePresentationCues() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ field, force }: { field: InterviewPrepHistoryField; force?: boolean }) =>
      matchApi('/interview-prep/cues', {
        method: 'POST',
        body: JSON.stringify({ field, force: force ?? false }),
      }) as Promise<{ cues: string[]; cached: boolean }>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match', 'interview-prep'] });
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
    onSuccess: (data, variables) => {
      // Patch the (large) list cache in place from the PUT response instead of
      // re-downloading it — keeps status changes instant on the tracker/board.
      const updatedAt = (data as { updatedAt?: string } | undefined)?.updatedAt;
      queryClient.setQueryData(['applications'], (old: unknown) =>
        Array.isArray(old)
          ? old.map((a) =>
              (a as { id: string }).id === variables.appId
                ? { ...a, status: variables.newStatus, updatedAt: updatedAt ?? (a as { updatedAt?: string }).updatedAt }
                : a,
            )
          : old,
      );
      // The detail view's timeline gains a row, so refetch just that one app
      // (small) — not the whole list.
      queryClient.invalidateQueries({ queryKey: ['applications', variables.appId] });
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

export function useGenerateWhyWorkHere() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      api(`/applications/${appId}/why-work-here`, { method: 'POST' }),
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
