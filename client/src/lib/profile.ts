import type { NormalizedProfile, StructuredProfile } from './types';

export const EMPTY_PROFILE: StructuredProfile = {
  fullName: '', email: '', phone: '', location: '', linkedIn: '',
  summary: '', seniority: '', domains: [], experience: [], skills: [],
  education: [], militaryService: [], sideProjects: [], spokenLanguages: [],
  strengths: [], coreValues: [], redFlags: [], rawExperienceText: '',
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
    strengths: p?.strengths ?? [],
    coreValues: p?.coreValues ?? [],
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
    experience: n.experience ?? [],
    skills: n.skills ?? [],
    education: n.education ?? [],
    militaryService: n.militaryService ?? [],
    sideProjects: n.sideProjects ?? [],
    spokenLanguages: n.spokenLanguages ?? [],
  };
}
