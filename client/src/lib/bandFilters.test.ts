import { describe, expect, it } from 'vitest';
import { matchesBandFilters } from './bandFilters';
import type { DiscoveredJobSummary } from './types';

const job = (over: Partial<DiscoveredJobSummary> = {}): DiscoveredJobSummary => ({
  id: '1',
  title: 'Senior Software Engineer - Full-Stack',
  company: 'Deliveroo',
  location: 'London, United Kingdom (hybrid)',
  description: 'Go, Ruby, or Python',
  actual_job_level: 'mid-senior level',
  ...over,
});

const none = { levels: new Set<string>() };

describe('matchesBandFilters', () => {
  it('passes everything when no filter is set', () => {
    expect(matchesBandFilters(job(), none)).toBe(true);
  });

  it('keeps only the selected seniority bands', () => {
    const levels = new Set(['mid-senior level']);
    expect(matchesBandFilters(job(), { levels })).toBe(true);
    expect(matchesBandFilters(job({ title: 'Software Engineer, New Grad', actual_job_level: 'entry level' }), { levels })).toBe(false);
  });

  it('treats an unextracted band the way the server does', () => {
    expect(matchesBandFilters(job({ actual_job_level: null }), { levels: new Set(['mid-senior level']) })).toBe(false);
  });

  it('reads remote from the location when the source has no flag', () => {
    expect(matchesBandFilters(job(), { ...none, isRemote: true })).toBe(false);
    expect(matchesBandFilters(job({ location: 'London, UK (remote)' }), { ...none, isRemote: true })).toBe(true);
    expect(matchesBandFilters(job({ is_remote: false, location: 'Remote' }), { ...none, isRemote: true })).toBe(false);
  });

  it('matches location and text case-insensitively', () => {
    expect(matchesBandFilters(job(), { ...none, location: 'london' })).toBe(true);
    expect(matchesBandFilters(job(), { ...none, location: 'Cardiff' })).toBe(false);
    expect(matchesBandFilters(job(), { ...none, text: 'python' })).toBe(true);
    expect(matchesBandFilters(job(), { ...none, text: 'kotlin' })).toBe(false);
  });
});

describe('matchesBandFilters: the freshness window', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

  it('keeps a posting published inside the window and drops an older one', () => {
    expect(matchesBandFilters(job({ date_posted: daysAgo(10) }), { ...none, daysBack: 30 })).toBe(true);
    expect(matchesBandFilters(job({ date_posted: daysAgo(90) }), { ...none, daysBack: 30 })).toBe(false);
  });

  it('uses the update date only when there is no posting date', () => {
    // An old posting recently edited is still old.
    expect(matchesBandFilters(job({ date_posted: daysAgo(90), date_updated: daysAgo(1) }), { ...none, daysBack: 30 })).toBe(false);
    expect(matchesBandFilters(job({ date_posted: null, date_updated: daysAgo(5) }), { ...none, daysBack: 30 })).toBe(true);
  });

  it('never hides a posting of unknown age, and Any (0) shows every age', () => {
    expect(matchesBandFilters(job({ date_posted: null, date_updated: null }), { ...none, daysBack: 30 })).toBe(true);
    expect(matchesBandFilters(job({ date_posted: daysAgo(700) }), { ...none, daysBack: 0 })).toBe(true);
  });
});
