import { useSyncExternalStore } from 'react';
import { matchApi } from './api';
import { hydrateProfile, mergeEssentials, mergeNormalizedProfile } from './profile';
import { queryClient } from './queryClient';
import type { NormalizedProfile, ProfileResponse, StructuredProfile } from './types';

/**
 * The résumé upload, run outside any page so it outlives the one that started it.
 *
 * **Two reads in parallel.** The full read returns every achievement of every
 * role word for word, and that output is the whole ~20s wait. Retrieval needs a
 * fraction of it, so a short essentials read runs alongside (server:
 * NormalizedProfileEssentials) and is saved the moment it lands. The phases:
 *
 *   reading   — nothing saved yet. The reader stays on Landing, which shows it.
 *   matching  — essentials saved: the board can fill (retrieval), but scoring
 *               waits, because the Evaluator and ClaimGrounding check claims
 *               against the WHOLE profile.
 *   done      — the full read is saved; scoring runs.
 *   error     — the full read failed. The essentials failing alone is not an
 *               error: the full read covers it, a few seconds later.
 *
 * **Started from an event handler, never an effect.** The CV upload is the
 * mutation AGENTS.md records running twice under StrictMode — two Claude PDF
 * reads and two profile saves per upload. A click fires once, and the File
 * guard below makes a repeated call for the same file a no-op.
 */
export type CvUploadPhase = 'reading' | 'matching' | 'done' | 'error';

export interface CvUploadState {
  file: File;
  phase: CvUploadPhase;
  error?: string;
  /**
   * What the first read to be saved found — the essentials, or the full read
   * when it landed first. Landing shows it back ("Infra Engineer · Senior",
   * top skills) before handing over to Matches: real data, not a fake step.
   */
  found?: NormalizedProfile;
}

let current: CvUploadState | null = null;
const listeners = new Set<() => void>();

function set(next: CvUploadState): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Nothing saved yet: there is no profile to retrieve against. */
export function isCvUploadInProgress(state: CvUploadState | null): boolean {
  return state?.phase === 'reading';
}

/** Scoring must wait: the full profile is not saved yet. */
export function isScoringHeld(state: CvUploadState | null): boolean {
  return state?.phase === 'reading' || state?.phase === 'matching';
}

function read(file: File, essentials: boolean): Promise<NormalizedProfile> {
  const fd = new FormData();
  fd.append('file', file);
  // Two literal paths rather than one template: nginx-routes.test.ts reads the
  // literal first argument of every matchApi() call to check nginx proxies it.
  return (essentials
    ? matchApi('/profile/normalize-file?scope=essentials', { method: 'POST', body: fd })
    : matchApi('/profile/normalize-file', { method: 'POST', body: fd })) as Promise<NormalizedProfile>;
}

async function save(merge: (profile: StructuredProfile) => StructuredProfile): Promise<void> {
  const profileRes = await matchApi('/profile') as ProfileResponse;
  await matchApi('/profile', { method: 'PUT', body: JSON.stringify(merge(hydrateProfile(profileRes?.structured))) });
  // Everything that reads the profile — the onboarding gate, Matches' band —
  // sees the new one before it asks again.
  await queryClient.invalidateQueries({ queryKey: ['match', 'profile'] });
}

export async function startCvUpload(file: File): Promise<void> {
  if (current?.file === file) return;
  set({ file, phase: 'reading' });

  const essentialsRead = read(file, true);
  const fullRead = read(file, false);
  let fullArrived = false;
  // Set only once the essentials SAVE has started — the one thing the full
  // save must wait for. Not the essentials READ: if that hangs, the full save
  // must not hang with it.
  let essentialsSaving: Promise<void> | null = null;

  // Never throws: the essentials are a head start, not a requirement.
  void essentialsRead.then(
    (essentials) => {
      // The full read already landed: saving the partial one now would only
      // be overwritten, and could race the full save.
      if (fullArrived) return;
      essentialsSaving = save((p) => mergeEssentials(p, essentials)).then(
        () => {
          if (current?.file === file && current.phase === 'reading') set({ file, phase: 'matching', found: essentials });
        },
        () => { /* fall through to the full read */ },
      );
    },
    () => { /* fall through to the full read */ },
  );

  try {
    const full = await fullRead;
    fullArrived = true;
    // One save at a time, in order: a partial save already under way lands
    // first and the full one replaces it — never the other way round.
    if (essentialsSaving) await essentialsSaving;
    await save((p) => mergeNormalizedProfile(p, full));
    set({ file, phase: 'done', found: current?.found ?? full });
  } catch (e) {
    set({ file, phase: 'error', error: (e as Error).message });
  }
}

/** The current upload, outside React. */
export function getCvUpload(): CvUploadState | null {
  return current;
}

export function useCvUpload(): CvUploadState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
