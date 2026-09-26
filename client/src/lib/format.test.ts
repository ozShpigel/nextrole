import { cityCountry, toDateTimeLocalValue, formatAge } from './format';

describe('toDateTimeLocalValue', () => {
  it('produces a datetime-local string that parses back to the same instant', () => {
    // "YYYY-MM-DDTHH:mm" has no offset and is parsed as LOCAL time, so the
    // only correct encoding is the local wall-clock. Holds in every zone;
    // the old toISOString().slice(0, 16) fails it anywhere but UTC.
    const iso = '2026-09-03T11:00:00.000Z';
    const value = toDateTimeLocalValue(iso);

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(value).toISOString()).toBe(iso);
  });

  it('uses local wall-clock components, not UTC ones', () => {
    const iso = '2026-09-03T11:00:00.000Z';
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    expect(toDateTimeLocalValue(iso)).toBe(expected);
  });

  it('returns an empty string for missing or invalid input', () => {
    expect(toDateTimeLocalValue(null)).toBe('');
    expect(toDateTimeLocalValue(undefined)).toBe('');
    expect(toDateTimeLocalValue('')).toBe('');
    expect(toDateTimeLocalValue('not a date')).toBe('');
  });
});

describe('cityCountry', () => {
  it('keeps the city and the country, dropping the region between them', () => {
    expect(cityCountry('Tel Aviv-Yafo, Tel Aviv District, Israel')).toBe('Tel Aviv-Yafo, Israel');
  });

  it('keeps a two-part location whole', () => {
    expect(cityCountry('London, United Kingdom')).toBe('London, United Kingdom');
  });

  it('leaves a single part alone and ignores empty parts', () => {
    expect(cityCountry('London')).toBe('London');
    expect(cityCountry(' London , ')).toBe('London');
  });

  it('returns null for nothing', () => {
    expect(cityCountry(null)).toBeNull();
    expect(cityCountry(' , ')).toBeNull();
  });
});

describe('formatAge', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

  it('says Posted when the posting date is known', () => {
    expect(formatAge(daysAgo(14), daysAgo(3))).toBe('Posted 2w ago');
  });

  it('falls back to Updated, never calling an edit a posting', () => {
    expect(formatAge(null, daysAgo(21))).toBe('Updated 3w ago');
    expect(formatAge(undefined, daysAgo(2))).toBe('Updated 2d ago');
  });

  it('reads old postings in months, then years', () => {
    expect(formatAge(daysAgo(90), null)).toBe('Posted 3mo ago');
    expect(formatAge(daysAgo(686), null)).toBe('Posted 1y ago');
  });

  it('says nothing when neither date is known', () => {
    expect(formatAge(null, null)).toBeNull();
  });
});
