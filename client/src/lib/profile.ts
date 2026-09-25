import type { NormalizedProfile, StructuredProfile } from './types';

export const EMPTY_PROFILE: StructuredProfile = {
  fullName: '', email: '', phone: '', location: '', linkedIn: '',
  summary: '', seniority: '', domains: [], experience: [], skills: [],
  education: [], militaryService: [], sideProjects: [], spokenLanguages: [],
  redFlags: [], rawExperienceText: '',
};

// Normalize a profile loaded from the API into a fully-populated shape so
// controlled inputs never see undefined.
export function hydrateProfile(p?: StructuredProfile | null): StructuredProfile {
  return {
    ...EMPTY_PROFILE,
    ...(p ?? {}),
    skills: p?.skills ?? [],
    experience: p?.experience ?? [],
    domains: p?.domains ?? [],
    education: p?.education ?? [],
    militaryService: p?.militaryService ?? [],
    sideProjects: p?.sideProjects ?? [],
    spokenLanguages: p?.spokenLanguages ?? [],
    redFlags: p?.redFlags ?? [],
  };
}

// Merge a freshly-parsed (pasted-text or uploaded-file) NormalizedProfile on
// top of the current profile. Contact fields only overwrite when the source
// actually stated them; everything else is a full replace since a fresh
// parse supersedes whatever was there before.
export function mergeNormalizedProfile(profile: StructuredProfile, n: NormalizedProfile): StructuredProfile {
  return {
    ...profile,
    fullName: n.fullName || profile.fullName,
    email: n.email || profile.email,
    phone: n.phone || profile.phone,
    location: n.location || profile.location,
    linkedIn: n.linkedIn || profile.linkedIn,
    summary: n.summary ?? '',
    seniority: n.seniority ?? '',
    domains: n.domains ?? [],
    functions: n.functions ?? [],
    experience: n.experience ?? [],
    skills: n.skills ?? [],
    education: n.education ?? [],
    militaryService: n.militaryService ?? [],
    sideProjects: n.sideProjects ?? [],
    spokenLanguages: n.spokenLanguages ?? [],
  };
}

// Merge the SHORT first read of an upload (the server's essentials read) —
// only what retrieval needs, while the full read is still running.
//
// Never a replace, unlike mergeNormalizedProfile: this read is deliberately
// partial, so a field it leaves empty means "not part of this read", not "the
// CV says nothing". A returning user's profile keeps everything this read does
// not carry — and keeps its detailed experience, since this read has titles
// only — until the full read replaces it. If the full read then fails, nothing
// has been lost.
export function mergeEssentials(profile: StructuredProfile, e: NormalizedProfile): StructuredProfile {
  const has = <T,>(xs: T[] | undefined | null): xs is T[] => !!xs && xs.length > 0;
  return {
    ...profile,
    location: e.location || profile.location,
    summary: e.summary || profile.summary,
    seniority: e.seniority || profile.seniority,
    domains: has(e.domains) ? e.domains : profile.domains,
    functions: has(e.functions) ? e.functions : profile.functions,
    skills: has(e.skills) ? e.skills : profile.skills,
    experience: has(profile.experience) ? profile.experience : (e.experience ?? []),
  };
}
