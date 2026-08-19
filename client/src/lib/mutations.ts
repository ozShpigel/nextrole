import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, matchApi, discoveryApi } from './api';
import type {
  InterviewPrepHistoryField,
  MockTurn,
  MockTurnResponse,
  MockDebrief,
  MockSession,
  ManualMatchRequest,
  MatchResponse,
  NormalizedProfile,
  InterviewInsightResponse,
  ResumePack,
  TailoredExperienceItem,
  SkillCategory,
  SideProjectItem,
  ImportJobsResponse,
  MessageItem,
} from './types';

export function useSaveJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      discoveryApi(`/jobs/${jobId}/save`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
      // The save creates a tracker application — without this, a recently
      // cached tracker list (staleTime 30s) keeps hiding the new entry.
      queryClient.invalidateQueries({ queryKey: ['applications'] });
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

// Import Job: one or more pasted LinkedIn URLs, fetched + scored + saved to
// the tracker in one call (up to 5 — matches the Evaluator batch cap).
export function useImportJobs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (urls: string[]) =>
      discoveryApi('/jobs/import', {
        method: 'POST',
        body: JSON.stringify({ urls }),
      }) as Promise<ImportJobsResponse>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
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

// Score a pasted job description on demand (live path — analyst + evaluator).
// Same endpoint the discovery "Discover now" flow uses per job.
export function useScoreJob() {
  return useMutation({
    mutationFn: (body: ManualMatchRequest) =>
      matchApi('', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<MatchResponse>,
  });
}

// Normalize pasted free-text experience/skills into structured fields. Doesn't
// persist itself — SettingsPage merges the result and calls useSaveProfile
// immediately after (no review step in the UI).
export function useNormalizeProfile() {
  return useMutation({
    mutationFn: (text: string) =>
      matchApi('/profile/normalize', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }) as Promise<NormalizedProfile>,
  });
}

// Same normalization, but from an uploaded résumé file (PDF or TXT) — the API
// also persists the raw file itself (ResumeFile) as a side effect, so this
// mutation is no longer purely ephemeral analysis (see the demo-allowlist
// note in Program.cs). The client merges the result and auto-saves.
export function useNormalizeProfileFile() {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return matchApi('/profile/normalize-file', {
        method: 'POST',
        body: fd,
      }) as Promise<NormalizedProfile>;
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

// ── Mock interview ──────────────────────────────────────────────────────────
interface MockTurnRequest {
  persona: string;
  language: string;
  questionTarget?: number;
  applicationId?: string | null;
  transcript: MockTurn[];
}

// Stateless turn engine — post the full transcript, get the interviewer's reply.
export function useMockTurn() {
  return useMutation({
    mutationFn: (body: MockTurnRequest) =>
      api('/mock-interview/turn', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<MockTurnResponse>,
  });
}

export function useMockDebrief() {
  return useMutation({
    mutationFn: (body: MockTurnRequest) =>
      api('/mock-interview/debrief', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<MockDebrief>,
  });
}

export function useSaveMockSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/mock-interview/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<MockSession>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mock-interview', 'sessions'] });
    },
  });
}

export function useDeleteMockSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/mock-interview/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mock-interview', 'sessions'] });
    },
  });
}

// Closed loop — append a debrief rewrite into the interview-prep Q&A rubric.
export function useAdoptRubric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ question, answer, categories }: { question: string; answer: string; categories?: string[] }) =>
      api('/mock-interview/adopt-rubric', {
        method: 'POST',
        body: JSON.stringify({ question, answer, categories }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['match', 'interview-prep'] });
    },
  });
}

// Interview Insights — regenerates the persisted observation summary from all
// current retros. This now persists (unlike the old ephemeral synthesis), so
// on success it writes the fresh result straight into the query cache —
// no need to invalidate/refetch, the page reflects it immediately.
export function useSynthesizeInsights() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/interview-insights/synthesize', { method: 'POST' }) as Promise<InterviewInsightResponse>,
    onSuccess: (data) => {
      queryClient.setQueryData(['interview-insights', 'insight'], data);
    },
  });
}

export function useUpdateAppStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    // jobUrl is optional and only acted on when newStatus is Withdrawn — same
    // best-effort "clear saved_to_tracker so it doesn't stay permanently
    // hidden from Search/re-add" as useDeleteApplication below, since
    // withdrawing (the common "x" close-out action) is a status change, not
    // a delete, and previously left the originating discovered job stuck
    // showing "Added" forever.
    mutationFn: async ({ appId, newStatus, note, jobUrl }: { appId: string; newStatus: string; note?: string; jobUrl?: string | null }) => {
      const result = await api(`/applications/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ newStatus, note }),
      });
      if (newStatus === 'Withdrawn' && jobUrl) {
        try {
          await discoveryApi('/jobs/unsave', { method: 'POST', body: JSON.stringify({ job_url: jobUrl }) });
        } catch {
          // Best-effort — the status change already succeeded either way.
        }
      }
      return result;
    },
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

// Generate (or regenerate) the tailored résumé pack for one application.
// Writes the result straight into the pack's own query cache (no refetch,
// same pattern as useSynthesizeInsights) and patches the list cache's
// hasPack/packGeneratedAt so the row flips to "Review Pack" immediately.
export function useGeneratePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      api(`/applications/${appId}/pack`, { method: 'POST' }) as Promise<ResumePack>,
    onSuccess: (data, appId) => {
      queryClient.setQueryData(['applications', appId, 'pack'], data);
      queryClient.setQueryData(['applications'], (old: unknown) =>
        Array.isArray(old)
          ? old.map((a) =>
              (a as { id: string }).id === appId
                ? { ...a, hasPack: true, packGeneratedAt: data.generatedAt }
                : a,
            )
          : old,
      );
      queryClient.setQueryData(['applications', appId], (old: unknown) =>
        old && typeof old === 'object'
          ? { ...old, hasPack: true, packGeneratedAt: data.generatedAt }
          : old,
      );
    },
  });
}

// Manually edit an already-generated résumé pack — no AI call, so (unlike
// useGeneratePack) this never touches hasPack/packGeneratedAt on the list
// cache; only the pack's own cache entry changes.
export function useUpdatePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, ...body }: {
      appId: string;
      tailoredSummary: string;
      experience: TailoredExperienceItem[];
      highlightedSkills: SkillCategory[];
      sideProjects: SideProjectItem[];
    }) =>
      api(`/applications/${appId}/pack`, { method: 'PUT', body: JSON.stringify(body) }) as Promise<ResumePack>,
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['applications', variables.appId, 'pack'], data);
    },
  });
}

export function useDeleteApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    // jobUrl is optional (older applications may predate JobUrl being
    // populated) — when present, also clears the originating discovered
    // job's saved_to_tracker flag so it doesn't stay permanently hidden
    // from Search/re-add. The API has no reference back to the scraper's
    // discovered_jobs doc, so this is a second, best-effort client call
    // rather than something the API delete can cascade itself.
    mutationFn: async ({ id, jobUrl }: { id: string; jobUrl?: string | null }) => {
      await api(`/applications/${id}`, { method: 'DELETE' });
      if (jobUrl) {
        try {
          await discoveryApi('/jobs/unsave', { method: 'POST', body: JSON.stringify({ job_url: jobUrl }) });
        } catch {
          // Best-effort — the application delete already succeeded either way.
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
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
    onSuccess: () => {
      // Invalidating the ['applications'] prefix covers both the detail query
      // (['applications', appId]) and the plain list, whose projection
      // includes each app's next-interview date/time/interviewer (read by
      // ActivePage's board).
      queryClient.invalidateQueries({ queryKey: ['applications'] });
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
      // Retro fields ride this same PUT — keep Interview Insights' retro log
      // and staleness ("N new retros since this insight") fresh.
      queryClient.invalidateQueries({ queryKey: ['interview-insights', 'retros'] });
      queryClient.invalidateQueries({ queryKey: ['interview-insights', 'insight'] });
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

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api(`/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

// Fire-and-forget: flips the row's dot instantly rather than waiting on a
// refetch, and swallows failures — a missed read-receipt isn't worth
// surfacing an error for. Deliberately does NOT invalidate/refetch on
// error: doing so reverted the optimistic isRead flip, which re-triggered
// MessagesPage's effect (keyed on selected message id + isRead) into
// mutating again — an infinite retry loop that read as the page
// flickering on any persistent failure (e.g. the read-only demo, before
// this endpoint was allowlisted there too).
export function useMarkMessageRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api(`/messages/${messageId}/read`, { method: 'PATCH' }),
    onMutate: (messageId: string) => {
      queryClient.setQueryData<MessageItem[]>(['messages'], (prev) =>
        prev?.map((m) => (m.id === messageId ? { ...m, isRead: true } : m)),
      );
    },
  });
}
