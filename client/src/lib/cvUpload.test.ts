import { describe, expect, it, vi, beforeEach } from 'vitest';
import { matchApi } from './api';
import { getCvUpload, isCvUploadInProgress, isScoringHeld, startCvUpload } from './cvUpload';
import { mergeEssentials } from './profile';
import type { NormalizedProfile, StructuredProfile } from './types';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, matchApi: vi.fn() };
});

const ESSENTIALS = 'POST /profile/normalize-file?scope=essentials';
const FULL = 'POST /profile/normalize-file';

type Route = unknown | Promise<unknown> | Error;

function mockRoutes(routes: Record<string, Route>) {
  vi.mocked(matchApi).mockImplementation((path: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${path}`;
    if (!(key in routes)) return Promise.reject(new Error(`Unmocked matchApi() call: ${key}`));
    const value = routes[key];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

const calls = (key: string) =>
  vi.mocked(matchApi).mock.calls.filter(([path, opts]) => `${opts?.method ?? 'GET'} ${path}` === key);

const saved = () => calls('PUT /profile').map(([, o]) => JSON.parse(o?.body as string) as StructuredProfile);

const pdf = () => new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const essentialsRead: NormalizedProfile = {
  summary: 'Infra engineer.', location: 'Tel Aviv, Israel', seniority: 'Senior', domains: [],
  functions: ['infrastructure'], skills: [{ category: 'Platform', items: ['Kubernetes'] }],
  experience: [{ title: 'Platform Developer', company: 'Payoneer', dates: '2023', highlights: [] }],
  education: [], militaryService: [], sideProjects: [], spokenLanguages: [],
};

const fullRead: NormalizedProfile = {
  ...essentialsRead,
  experience: [{ title: 'Platform Developer', company: 'Payoneer', dates: '2023', highlights: ['Owned the NuGet automation'] }],
  education: [{ institution: 'HIT', detail: 'B.Sc.' }],
};

beforeEach(() => vi.clearAllMocks());

describe('startCvUpload', () => {
  it('saves the essentials first, then the full read', async () => {
    const full = deferred<NormalizedProfile>();
    mockRoutes({ [ESSENTIALS]: essentialsRead, [FULL]: full.promise, 'GET /profile': { structured: {} }, 'PUT /profile': {} });
    const file = pdf();

    const done = startCvUpload(file);
    await vi.waitFor(() => expect(getCvUpload()?.phase).toBe('matching'));
    // What Landing shows back before handing over.
    expect(getCvUpload()?.found?.functions).toEqual(['infrastructure']);
    // The board can fill from this; scoring still waits.
    expect(isScoringHeld(getCvUpload())).toBe(true);
    expect(saved()).toHaveLength(1);

    full.resolve(fullRead);
    await done;

    expect(getCvUpload()?.phase).toBe('done');
    expect(saved()).toHaveLength(2);
    expect(saved()[1].experience[0].highlights).toEqual(['Owned the NuGet automation']);
  });

  it('reads a file once per read, however many times it is started', async () => {
    // The CV upload is the mutation that once ran twice per upload under
    // StrictMode: two Claude PDF reads and two profile saves.
    mockRoutes({ [ESSENTIALS]: essentialsRead, [FULL]: fullRead, 'GET /profile': { structured: {} }, 'PUT /profile': {} });
    const file = pdf();

    await Promise.all([startCvUpload(file), startCvUpload(file)]);

    expect(calls(ESSENTIALS)).toHaveLength(1);
    expect(calls(FULL)).toHaveLength(1);
  });

  it('never lets the essentials erase a returning user’s profile', async () => {
    // A partial read saved over a full profile would wipe highlights and
    // education — and if the full read then failed, they would be gone.
    const existing = {
      summary: 'Old summary', experience: [{ title: 'Old role', company: 'Acme', dates: '2020', highlights: ['Old win'] }],
      education: [{ institution: 'HIT', detail: 'B.Sc.' }], skills: [],
    };
    mockRoutes({ [ESSENTIALS]: essentialsRead, [FULL]: new Error('full read failed'), 'GET /profile': { structured: existing }, 'PUT /profile': {} });

    await startCvUpload(pdf());

    const [afterEssentials] = saved();
    expect(afterEssentials.education).toEqual([{ institution: 'HIT', detail: 'B.Sc.' }]);
    expect(afterEssentials.experience[0].highlights).toEqual(['Old win']);
    expect(afterEssentials.functions).toEqual(['infrastructure']);   // the new part did land
  });

  it('carries on when only the essentials fail', async () => {
    mockRoutes({ [ESSENTIALS]: new Error('essentials failed'), [FULL]: fullRead, 'GET /profile': { structured: {} }, 'PUT /profile': {} });

    await startCvUpload(pdf());

    expect(getCvUpload()?.phase).toBe('done');
    expect(saved()).toHaveLength(1);
  });

  it('reports an error when the full read fails', async () => {
    mockRoutes({ [ESSENTIALS]: essentialsRead, [FULL]: new Error('unreadable PDF'), 'GET /profile': { structured: {} }, 'PUT /profile': {} });

    await startCvUpload(pdf());

    expect(getCvUpload()?.phase).toBe('error');
    expect(getCvUpload()?.error).toContain('unreadable PDF');
  });

  it('does not wait on an essentials read that never answers', async () => {
    mockRoutes({ [ESSENTIALS]: new Promise(() => {}), [FULL]: fullRead, 'GET /profile': { structured: {} }, 'PUT /profile': {} });

    await startCvUpload(pdf());

    expect(getCvUpload()?.phase).toBe('done');
  });

  it('skips the essentials save when the full read lands first', async () => {
    const essentials = deferred<NormalizedProfile>();
    mockRoutes({ [ESSENTIALS]: essentials.promise, [FULL]: fullRead, 'GET /profile': { structured: {} }, 'PUT /profile': {} });

    const done = startCvUpload(pdf());
    await vi.waitFor(() => expect(calls(FULL)).toHaveLength(1));
    essentials.resolve(essentialsRead);
    await done;

    expect(saved()).toHaveLength(1);
    expect(saved()[0].education).toEqual([{ institution: 'HIT', detail: 'B.Sc.' }]);
  });
});

describe('mergeEssentials', () => {
  it('fills an empty profile, experience included', () => {
    const merged = mergeEssentials({ experience: [], skills: [] } as unknown as StructuredProfile, essentialsRead);
    expect(merged.experience[0].title).toBe('Platform Developer');
    expect(merged.location).toBe('Tel Aviv, Israel');
  });
});

describe('phase helpers', () => {
  const file = pdf();
  it.each([
    ['reading', true, true],
    ['matching', false, true],
    ['done', false, false],
    ['error', false, false],
  ] as const)('%s: in progress %s, scoring held %s', (phase, inProgress, held) => {
    expect(isCvUploadInProgress({ file, phase })).toBe(inProgress);
    expect(isScoringHeld({ file, phase })).toBe(held);
  });

  it('holds nothing with no upload at all', () => {
    expect(isCvUploadInProgress(null)).toBe(false);
    expect(isScoringHeld(null)).toBe(false);
  });
});
