// Read-only: would a UK candidate see every UK posting in Matches, or only
// those spelled like their own profile location?
// Run on the box, in /srv/nextrole:  sh mongosh.sh measure-uk-locations.js
// Writes nothing.
//
// It mirrors GreenhouseJobRepository.MatchesLocation exactly: the profile's
// term is its last comma part ("London, UK" -> "UK"), with UK <-> United
// Kingdom as the only aliases, matched as a plain substring of the posting's
// location (extracted.location, else the board's own). Failing that, the
// posting's whole location as words inside the profile's location ("London"
// inside "London, UK"). A posting with no location passes.
//
// With places.tsv next to mongosh.sh (copied from
// server/api/src/Infrastructure/Greenhouse/Data/), it also computes the
// country rule MatchesLocation adds (docs/plans/country-location-match.md):
// both sides resolved to countries, the profile's named countries first, each
// place in a posting's list read the same way -- and prints both rules.
//
// What counts as a UK posting here is a broad regex plus a city list -- this
// script's own judgement, not the product's, so the misses it prints are
// worth reading rather than trusting as a number. City names that are also
// US places (York, Birmingham, Bath) are left out: they read New York and
// Birmingham, Alabama as UK (measured 2026-09-29).

const PROFILES = [
  "London, UK",
  "London, United Kingdom",
  "London, England",
  "London",
  "Manchester, UK",
  "Open to relocation to London, UK",
];

const UK = new RegExp(
  "\\b(united kingdom|uk|u\\.k\\.|great britain|britain|gb|gbr|england|scotland|wales|northern ireland|" +
  "london|manchester|cambridge|oxford|edinburgh|glasgow|bristol|leeds|belfast|reading|cardiff|" +
  "newcastle|nottingham|sheffield|liverpool|brighton|guildford|milton keynes|slough|bracknell|" +
  "berkshire|surrey|feltham|harpenden|addlestone|basingstoke|swindon|aberdeen|dundee|coventry)\\b", "i");

const name = process.env.MongoDB__Database || "job-tracker";
const d = db.getSiblingDB(name);

const locOf = j => (j.extracted && j.extracted.location) || j.location || "";
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function aliases(term) {
  const t = term.toLowerCase();
  const out = [term];
  if (t === "united kingdom") out.push("UK");
  if (t === "uk") out.push("United Kingdom");
  return out;
}

function containsAsWords(haystack, needle) {
  if (!haystack || !needle.trim()) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle.trim())}(?![\\p{L}\\p{N}])`, "iu").test(haystack);
}

function matches(location, profile) {
  const parts = profile.split(",").map(s => s.trim()).filter(Boolean);
  const term = parts.length ? parts[parts.length - 1] : null;
  if (!term) return true;
  if (!location.trim()) return true;                                     // unstated passes
  if (aliases(term).some(a => location.toLowerCase().includes(a.toLowerCase()))) return true;
  return containsAsWords(profile, location);
}

// ---- the country rule (Places.cs), when the table is here ----
let table = null;
try {
  table = new Map();
  for (const line of require("fs").readFileSync("/places.tsv", "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const tab = line.indexOf("\t");
    table.set(line.slice(0, tab), line.slice(tab + 1).split(","));
  }
} catch (e) { table = null; }

const SEPARATORS = /[,;/|()\[\]&]| [-–—] | or | and /i;
const keyOf = p => p.trim().toLowerCase().replace(/[‘’]/g, "'").split(" ").filter(Boolean).join(" ");
function namedFirst(text) {
  const all = new Set(), named = new Set();
  let agreed = null;
  if (!text || !text.trim()) return all;
  for (const piece of text.split(SEPARATORS).concat([text])) {
    const c = piece === undefined ? null : table.get(keyOf(piece));
    if (!c) continue;
    c.forEach(x => all.add(x));
    if (c.length === 1) named.add(c[0]);
    agreed = agreed === null ? new Set(c) : new Set([...agreed].filter(x => c.includes(x)));
  }
  if (named.size) return named;
  return agreed && agreed.size ? agreed : all;
}
function postingCountries(text) {
  const out = new Set();
  (text || "").split(/[;|]/).forEach(place => namedFirst(place).forEach(x => out.add(x)));
  return out;
}
function matchesNew(location, profile) {
  const parts = profile.split(",").map(s => s.trim()).filter(Boolean);
  const term = parts.length ? parts[parts.length - 1] : null;
  if (!term) return true;
  if (!location.trim()) return true;
  const mine = namedFirst(profile);
  if (mine.size && [...postingCountries(location)].some(c => mine.has(c))) return true;
  return matches(location, profile);
}

const rows = d.greenhouse_jobs.find({ closedAt: null },
  { boardKey: 1, title: 1, location: 1, "extracted.location": 1 }).toArray();
const stated = rows.filter(j => locOf(j).trim());
const uk = stated.filter(j => UK.test(locOf(j)));
const notUk = stated.filter(j => !UK.test(locOf(j)));
print(`${name}: ${rows.length} open posting(s), ${rows.length - stated.length} with no location (pass everyone), ` +
      `${uk.length} UK by this script's regex`);

const tally = (list) => {
  const t = {};
  list.forEach(j => { const l = locOf(j); t[l] = (t[l] || 0) + 1; });
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
};

print(`\nHow UK postings spell their location (top 40 of ${tally(uk).length}):`);
tally(uk).slice(0, 40).forEach(([l, n]) => print(`  ${String(n).padStart(4)}  ${l}`));

print("\nPer profile location:");
for (const p of PROFILES) {
  const seen = uk.filter(j => matches(locOf(j), p));
  const missed = uk.filter(j => !matches(locOf(j), p));
  const wrong = notUk.filter(j => matches(locOf(j), p));
  print(`\n  "${p}": sees ${seen.length} of ${uk.length} UK postings, misses ${missed.length}; ` +
        `also passes ${wrong.length} non-UK posting(s)`);
  if (missed.length) print("    missed, by spelling: " +
    tally(missed).slice(0, 12).map(([l, n]) => `${l} (${n})`).join(" | "));
  if (wrong.length) print("    non-UK passed: " +
    tally(wrong).slice(0, 8).map(([l, n]) => `${l} (${n})`).join(" | "));
  if (!table) continue;
  const seenN = uk.filter(j => matchesNew(locOf(j), p));
  const missedN = uk.filter(j => !matchesNew(locOf(j), p));
  const addedN = notUk.filter(j => matchesNew(locOf(j), p) && !matches(locOf(j), p));
  print(`    WITH COUNTRIES: sees ${seenN.length}, misses ${missedN.length}; ` +
        `${addedN.length} non-UK posting(s) added by the country rule`);
  if (missedN.length) print("      still missed: " +
    tally(missedN).slice(0, 12).map(([l, n]) => `${l} (${n})`).join(" | "));
  if (addedN.length) print("      added, not UK by this script's regex: " +
    tally(addedN).slice(0, 12).map(([l, n]) => `${l} (${n})`).join(" | "));
}
if (!table) print("\n(No /places.tsv: the country rule was not computed. Copy places.tsv next to mongosh.sh.)");

print("\nLocation terms learned from real profiles (pool_locations; users per term, no ids):");
d.pool_locations.find({}, { UserIds: 1, userIds: 1 }).toArray()
  .map(t => [t._id, (t.UserIds || t.userIds || []).length])
  .sort((a, b) => b[1] - a[1])
  .forEach(([t, n]) => print(`  ${String(n).padStart(3)}  ${t}`));
