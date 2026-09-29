# Matches by country, not by spelling

Status: built 2026-09-29 (branch `country-location-match`). Measured 2026-09-29.
Three changes from the reviewed plan, found while building; each is marked **Changed in build** below.

## The problem

Matches keeps a posting when its location text contains the profile's
**term**, the last comma part of the profile's location ("London, UK" becomes
"UK"; UK and United Kingdom are aliases). Failing that, it keeps the posting
when the posting's whole location appears as words inside the profile's
location (`GreenhouseJobRepository.MatchesLocation`). It compares spellings,
not places.

`deploy/mongo/measure-uk-locations.js` ran that exact rule over every open
posting (1,889; ~577 of them in the UK, 120 distinct spellings):

| Profile says | Sees | Misses | What it misses |
|---|---|---|---|
| "London, UK" / "London, United Kingdom" | ~532 | ~38 | **London postings.** "London (hybrid)" 20, "London, England (hybrid)" 8, "London; Sunnyvale" 4, "London, England" 2, several multi-city ones with London in them |
| "Manchester, UK" | ~525 | ~45 | the same, plus a bare "London" 7 |
| "London" | ~308 | ~270 | every UK posting outside London: Manchester, Glasgow, Crawley, Reading, Cambridge, Edinburgh, "UK (remote)" |
| "London, England" | 22 | ~555 | nearly everything: the term becomes "England", and postings say "United Kingdom" |

Real profiles today register `london`, `uk`, `united kingdom` and
`open to relocation to london` (`pool_locations`). The users who exist are in
the first row, **missing about 38 postings in their own city.**

Two causes:

1. **The term is a spelling.** "England" and "London" name the UK, but as text
   they only find themselves.
2. **The fallback compares whole strings.** "London (hybrid)" is not inside
   "London, UK", because of the suffix.

## The fix

Resolve both sides to countries with the places table the ingest already uses
(`Places`, GeoNames), and keep a posting whose countries overlap the
profile's.

The rule becomes: **keep it if the countries overlap, OR if today's text rule
keeps it.** It is added alongside the current rule, and nothing replaces it.

That answers the reason written on `MatchesLocation` for having no gazetteer:
"a wrong guess silently hides jobs". With OR, the gazetteer cannot hide
anything. It can only add a posting the text rule missed. The worst a wrong
resolution does is show one posting from the wrong country, which the
Evaluator then scores on its own merits. Missing a posting is silent; showing
an extra one is not.

### Profile side: prefer the country the profile names

A profile's location resolves piece by piece, using the same separators as
the ingest. If any piece resolves to exactly one country, use those countries
only; otherwise use everything the pieces resolve to:

| Profile | Pieces resolve to | Countries used |
|---|---|---|
| "London, UK" | London: GB, CA; UK: GB | **GB** (UK is unambiguous) |
| "London, England" | England: GB | GB |
| "Open to relocation to London, UK" | UK: GB (the prose piece resolves to nothing) | GB |
| "London" | GB, CA | GB, CA. A bare-London user also sees London, Ontario. That's a few rows, and the ingest accepts the same trade. |
| "Barcelona, Spain" | Barcelona: ES, VE; Spain: ES | ES |
| "Rishon LeZion, Israel" | IL | IL |

### Posting side: each place read like a profile, then unioned

**Changed in build.** The plan said the plain union of every piece, as the
ingest does. The tests showed why not: "Birmingham, Alabama, United States"
would be GB and US there, because England has a Birmingham, so every US
Birmingham posting would reach every UK candidate, at a scoring call each.

So a posting's location is split into its places (on `;` and `|`, not commas,
which separate the parts of one place). Each place is read the way a profile
is (named country first), and the places are unioned
(`Places.CountriesOfPosting`):

- "Birmingham, Alabama, United States" → US
- "London, Ontario, Canada" → CA
- "London (hybrid)" → GB, CA
- "Germany; London (hybrid)" → DE, GB, CA
- "UK (remote)" → GB
- "Mig Ha'emek,ISR" → IL (after step 2)

**Then the parts' agreement.** The first run on the box (2026-09-29) cut every
UK profile's misses to 0 of 571, and added "Rochester, MN" (5) to all of them.
Neither part names one country: Rochester is GB and US, and MN is Minnesota
and Mongolia. A bare "London" also took "Burlington, MA" (Morocco's code) and
"San Francisco, CA" (Canada's). The parts of one place describe the same
place, so when none names a country, a place is the countries all its parts
agree on ("Rochester, MN" → US), and everything only when they agree on
nothing. "Los Angeles, CA; Bay Area, CA" stays US and CA: "Bay Area" is not in
the table, so that place is just "CA", which is truly both.

The ingest's pre-read filter keeps the plain union (`Places.CountriesOf`).
There, a wider set only ever costs a read.

A posting that resolves to nothing falls through to the text rule, exactly
as today.

## Steps

1. **Move `Places` to Infrastructure.** **Changed in build:** `ServedPlaces`
   stays in the ingest (`Greenhouse/Work/ServedPlaces.cs`); it is the pre-read
   filter's concept and nothing else reads it. `Places` moves from
   `Greenhouse/Work/` to `Infrastructure/Greenhouse/`, with `places.tsv`
   embedded in the Infrastructure assembly and `build_places.py` moved with
   it. The Greenhouse ingest already references Infrastructure, and Matches'
   rule lives there, so there is one table and one resolver for both. Not
   Core: Core carries no data files and no I/O. The table loads lazily, so
   only a process that matches locations pays for its memory: the API and the
   ingest, not the mailbot.

2. **Add ISO three-letter country codes to the table.** `build_places.py`
   already reads `countryInfo.txt`, which carries ISO3 (`ISR`, `GBR`), so this
   is one more `add(iso3, {iso2})` there. It fixes Applied Materials'
   `Mig Ha'emek,ISR`, which the ingest skips today.
   **Built:** 240 codes added, 11 keys widened (12 codes were also a town's
   name; `usa` already was one). **Changed in build:** a bare "Netherlands"
   had never resolved. GeoNames names it "The Netherlands", and the alias list
   repeated that instead of adding the short form. Fixed in the aliases; it
   was the only country affected.
   - A key only ever matches a whole piece of a location ("ISR" alone between
     commas), so a code that is also a word (CAN, AND, PER) matches only a
     location piece that is exactly that word. The builder prints every code
     that lands on an existing key, for review.
   - **Rebuilding from today's GeoNames will churn unrelated rows.** The
     option I'd pick is to append the codes as their own clearly marked
     section in the builder, and rebuild only that section, so the diff shows
     just the new codes.

3. **Add `Places.CountriesOfProfile(location)`**, with the profile rule above.

4. **Change `MatchesLocation`.** Add the country overlap as a first check. The
   term, alias and word checks stay, unchanged, as the fallback. Update its
   remarks, including the "no gazetteer" paragraph, to say why a gazetteer is
   now safe: OR only.

5. **Tests** (`LocationMatchTests`, `PlacesTests`):
   - Every spelling in the measured table above, against "London, UK",
     "London", "London, England" and "Manchester, UK". Each must pass.
   - Non-UK spellings measured in the same run ("New York, NY (hybrid)",
     "Birmingham, Alabama, United States", "Amsterdam, Netherlands") stay
     out for a UK profile.
   - **Nothing that passes today fails after:** every existing
     `LocationMatchTests` case, unchanged.
   - The profile rule: "London, UK" → GB only; "London" → GB and CA.
   - `ISR` and `GBR` resolve, and "Mig Ha'emek,ISR" is served by the pre-read
     filter.
   - Mutation checks, as in earlier phases: drop the overlap check, and drop
     the unambiguous-first rule. The named tests must fail.

6. **Measure again after the merge.** `measure-uk-locations.js` mirrors
   today's JS rule and cannot resolve places, so it measures the before, not
   the after. For the after, use the API's own
   `Greenhouse candidates: … {Matched} in {Term}` line on a UK profile's scan,
   before and after the deploy. And/or extend the script to load `places.tsv`
   (it is plain text), so it can compute both rules side by side on the box.
   I'd do the second: the same instrument then measures both sides.

## Not in this change

- **The LinkedIn pool's Mongo query** (`PoolJobRepository`) keeps its regex.
  It is the retiring source, and a Mongo filter cannot call the resolver.
- **The ingest's served locations** already resolve countries. A learned
  profile term like "london" is ambiguous and serves only its text, but the
  baseline `served_locations` already lists the UK. The profile rule from
  step 3 could replace `CountryOfTerm` there later.
- **"Kyiv, Ukraine" passes a "UK" term by substring.** It is unchanged here,
  because the OR keeps the text rule as it is, and the measurement found no
  such posting. Making the term match word-bounded is a separate, narrowing
  change, and would need its own measurement.

## Cost

No Claude, no embeddings. The resolver is a dictionary lookup per location
piece, over the ~400 candidates a scan already fetches. The API holds the
table in memory once, lazily: about 88K keys, a few tens of MB. The box shows
26% of 4 GB in use.
