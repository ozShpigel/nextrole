import type { DiscoveredJobSummary } from './types';

// The Matches filters, applied to the unscored band in the browser.
//
// The scored list is filtered by the server (GET /api/pool/jobs), but the band
// arrives whole from /api/match/pool-band, so without this the chips narrowed
// the scored cards and left every unscored one on the board — a Seniority
// filter that appeared to work while the unscored half ignored it. Same
// meanings as the server's browse filters.
//
// The freshness window is deliberately not here: on the Greenhouse source the
// server does not apply it either (GreenhouseJobRepository.BrowseAsync).
export interface BandFilters {
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

export function matchesBandFilters(job: DiscoveredJobSummary, f: BandFilters): boolean {
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
