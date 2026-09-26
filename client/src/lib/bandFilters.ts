import type { DiscoveredJobSummary } from './types';

// The Matches filters, applied to the unscored band in the browser.
//
// The scored list is filtered by the server (GET /api/pool/jobs), but the band
// arrives whole from /api/match/pool-band, so without this the chips narrowed
// the scored cards and left every unscored one on the board — a Seniority
// filter that appeared to work while the unscored half ignored it. Same
// meanings as the server's browse filters.
//
// The freshness window is here too: the band arrives at any age (the server
// asks for 0), so "Any" can bring old postings back, and the chosen window --
// 30 days by default -- is applied the way the server applies it to the scored
// list (GreenhouseJobRepository.PostedWithin).
// "Any" still stops at four months -- the same cap as the server
// (PoolBrowseQuery.MaxAgeDays). An evergreen posting open for a year is not a
// job worth showing, and the close diff never catches it.
export const MAX_AGE_DAYS = 120;

export interface BandFilters {
  daysBack?: number;
  levels: ReadonlySet<string>;
  isRemote?: boolean;
  location?: string;
  text?: string;
}

function contains(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

// Remote is the stored flag where a source has one (LinkedIn), else the
// arrangement the extraction writes into the location, "London, UK (remote)".
function isRemoteJob(job: DiscoveredJobSummary): boolean {
  if (typeof job.is_remote === 'boolean') return job.is_remote;
  return contains(job.location, 'remote');
}

// The posting's own date, the update date only when there is none, and an
// unknown age passes -- the same rule as the server.
function withinDays(job: DiscoveredJobSummary, days: number): boolean {
  const iso = job.date_posted ?? job.date_updated;
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return true;
  return Date.now() - t <= days * 86400000;
}

export function matchesBandFilters(job: DiscoveredJobSummary, f: BandFilters): boolean {
  const window = f.daysBack && f.daysBack > 0 ? Math.min(f.daysBack, MAX_AGE_DAYS) : MAX_AGE_DAYS;
  if (!withinDays(job, window)) return false;
  // Matches the server exactly: with any chip selected, a posting whose band
  // was not extracted does not match, as `$in` does not match a null.
  if (f.levels.size > 0 && !(job.actual_job_level && f.levels.has(job.actual_job_level))) return false;
  if (f.isRemote !== undefined && isRemoteJob(job) !== f.isRemote) return false;
  const location = f.location?.trim();
  if (location && !contains(job.location, location)) return false;
  const text = f.text?.trim();
  if (text && !(contains(job.title, text) || contains(job.company, text) || contains(job.description, text))) {
    return false;
  }
  return true;
}
