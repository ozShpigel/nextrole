import { toDateTimeLocalValue } from './format';

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
