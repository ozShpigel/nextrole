"""Build places.tsv -- place name -> the countries it can mean -- for the pre-read filter.

Source: GeoNames (https://www.geonames.org), CC BY 4.0. Download next to this
script, then run it:

    curl -O https://download.geonames.org/export/dump/cities15000.zip   (unzip it)
    curl -O https://download.geonames.org/export/dump/countryInfo.txt
    curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
    python build_places.py

Every entry is a SET of ISO-3166 alpha-2 codes, because names are ambiguous
(London is GB and CA; "IL" is Israel and Illinois). The filter unions them and
reads a posting whenever any of them is served, so ambiguity can only ever cost
a read, never a skip. Output is sorted, so a rebuild diffs cleanly.
"""
import csv
import re
import sys
from collections import defaultdict

places = defaultdict(set)

# Words boards put in a location field that are not places, and must never
# resolve to one (GeoNames has towns called all sorts of things).
NOT_PLACES = {
    "remote", "hybrid", "office", "offices", "hq", "headquarters", "anywhere", "global", "worldwide",
    "flexible", "onsite", "on-site", "home", "field", "various", "multiple", "multiple locations",
    "in office", "in-office", "distributed", "virtual", "travel", "emea", "apac", "latam", "americas",
    "europe", "asia", "africa", "north america", "south america", "oceania", "middle east",
}

# Only letters, spaces, apostrophes, dots and hyphens; 3-40 characters. Keeps
# ASCII spellings boards actually use and drops the rest of GeoNames' variants.
USABLE = re.compile(r"^[a-z][a-z .'\-]{1,38}[a-z.]$")


def add(name, countries):
    key = " ".join(name.strip().lower().replace("‘", "'").replace("’", "'").split())
    if key in NOT_PLACES:
        return
    places[key].update(countries)


# Countries: official name, and ISO-2 as a whole segment ("Remote (IT)").
for row in csv.reader(open("countryInfo.txt", encoding="utf-8"), delimiter="\t"):
    if not row or row[0].startswith("#"):
        continue
    iso2, name = row[0], row[4]
    add(name, {iso2})
    add(iso2, {iso2})

# How boards actually write countries.
ALIASES = {
    "GB": ["UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales", "Northern Ireland"],
    "US": ["USA", "U.S.", "U.S.A.", "United States of America", "America"],
    "AE": ["UAE", "U.A.E."],
    "NL": ["Holland", "The Netherlands"],
    "KR": ["South Korea", "Korea"],
    "CZ": ["Czechia", "Czech Republic"],
    "TR": ["Turkiye", "Türkiye"],
    "IL": ["Israel"],
    "IE": ["Republic of Ireland"],
}
for iso2, names in ALIASES.items():
    for n in names:
        add(n, {iso2})

# First-level divisions boards append: "Burlington, MA", "Toronto, ON".
# US and Canada only -- elsewhere the country is written out.
for row in csv.reader(open("admin1CodesASCII.txt", encoding="utf-8"), delimiter="\t"):
    code, name, ascii_name = row[0], row[1], row[2]
    cc, sub = code.split(".", 1)
    if cc not in ("US", "CA"):
        continue
    add(ascii_name, {cc})
    if len(sub) == 2 and sub.isalpha():
        add(sub, {cc})
# GeoNames keys Canadian provinces by number, not letters.
for code in ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]:
    add(code, {"CA"})

# Cities over 15,000 people: name and ASCII name; alternate spellings ("Tel
# Aviv-Yafo", "Rishon LeZion") only for cities over 100,000 and 4+ characters.
# Every alternate is a chance for a foreign town to share a served town's
# spelling, and a board string that resolves ONLY to the wrong country is the
# one way this list can cause a skip -- so alternates are kept where they pay.
ALTERNATES_MIN_POPULATION = 100_000
csv.field_size_limit(sys.maxsize if sys.maxsize < 2**31 else 2**31 - 1)
for row in csv.reader(open("cities15000.txt", encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
    name, ascii_name, alternates, cc, population = row[1], row[2], row[3], row[8], int(row[14] or 0)
    names = {name, ascii_name}
    if population >= ALTERNATES_MIN_POPULATION:
        names.update(a for a in alternates.split(",") if len(a.strip()) >= 4)
    for n in names:
        k = n.strip().lower()
        if USABLE.match(k):
            add(k, {cc})

with open("places.tsv", "w", encoding="utf-8", newline="\n") as out:
    out.write("# place name (lower-case) TAB countries it can mean (ISO-3166 alpha-2).\n")
    out.write("# Built by build_places.py from GeoNames (https://www.geonames.org), CC BY 4.0.\n")
    for key in sorted(places):
        out.write(f"{key}\t{','.join(sorted(places[key]))}\n")

print(f"{len(places)} places")
