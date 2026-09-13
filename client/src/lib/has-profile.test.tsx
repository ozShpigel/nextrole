import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { matchApi } from './api';
import { useHasProfile } from './queries';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, matchApi: vi.fn() };
});

/**
 * What GET /api/match/profile ACTUALLY returns to a visitor who has never
 * uploaded anything, copied from the live API rather than imagined:
 *
 *   content: "<professional_profile>\n\n</professional_profile>"   (47 chars)
 *
 * `content` is the rendered, prompt-facing string, and rendering an empty
 * profile still produces its wrapper. Testing it for emptiness — which
 * OnboardingGate did, and which useHasProfile inherited — makes every visitor
 * look like a returning one. The nav offered five links that bounce straight
 * back, "Browse your matches" promised a board with nothing on it, and the
 * onboarding redirect never fired.
 *
 * This constant is the regression. A hand-written mock returning content: ""
 * passes the broken implementation, which is exactly what happened.
 */
const EMPTY_PROFILE_CONTENT = '<professional_profile>\n\n</professional_profile>';

function mock(profile: unknown, resumeFile: unknown | Error) {
  vi.mocked(matchApi).mockImplementation((path: string) => {
    if (path === '/profile') return Promise.resolve(profile);
    if (path === '/profile/resume-file') {
      return resumeFile instanceof Error ? Promise.reject(resumeFile) : Promise.resolve(resumeFile);
    }
    return Promise.reject(new Error(`Unmocked matchApi(): ${path}`));
  });
}

const notFound = () => Object.assign(new Error('not found'), { status: 404 });

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function settled(expected: boolean) {
  const { result } = renderHook(() => useHasProfile(), { wrapper });
  await waitFor(() => expect(result.current).not.toBeUndefined());
  expect(result.current).toBe(expected);
}

beforeEach(() => vi.clearAllMocks());

describe('useHasProfile', () => {
  it('is false for the empty profile the API really returns', async () => {
    mock({ content: EMPTY_PROFILE_CONTENT, structured: { experience: [], skills: [] } }, notFound());
    await settled(false);
  });

  it('is true once the profile has experience', async () => {
    mock(
      { content: '…', structured: { experience: [{ title: 'Engineer' }], skills: [] } },
      notFound(),
    );
    await settled(true);
  });

  it('is true once the profile has skills', async () => {
    mock(
      { content: '…', structured: { experience: [], skills: [{ category: 'Languages', items: ['Go'] }] } },
      notFound(),
    );
    await settled(true);
  });

  it('is true when a résumé file exists even if the parse came back thin', async () => {
    mock({ content: EMPTY_PROFILE_CONTENT, structured: { experience: [], skills: [] } }, { fileName: 'cv.pdf' });
    await settled(true);
  });

  it('is undefined while loading, so the nav arrives once instead of flashing', () => {
    mock(new Promise(() => {}), new Promise(() => {}));
    const { result } = renderHook(() => useHasProfile(), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it('is undefined on error, so a blip cannot lock a real user out', async () => {
    vi.mocked(matchApi).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useHasProfile(), { wrapper });
    await waitFor(() => expect(vi.mocked(matchApi)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBeUndefined();
  });
});
