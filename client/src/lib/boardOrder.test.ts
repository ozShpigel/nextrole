import { describe, expect, it } from 'vitest';
import { stableOrder } from './boardOrder';

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('stableOrder', () => {
  it('keeps the first order it was given', () => {
    const positions = new Map<string, number>();
    expect(ids(stableOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], positions))).toEqual(['a', 'b', 'c']);
  });

  it('does not move a card when its score lands and it changes source', () => {
    // First paint: scored "a" (70), then the unscored band "b", "c".
    const positions = new Map<string, number>();
    stableOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], positions);

    // "c" scores 90: it is now in the scored list, sorted ahead of "a".
    const afterScore = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    expect(ids(stableOrder(afterScore, positions))).toEqual(['a', 'b', 'c']);
  });

  it('puts ids it has not seen after everything it has', () => {
    const positions = new Map<string, number>();
    stableOrder([{ id: 'a' }, { id: 'b' }], positions);
    expect(ids(stableOrder([{ id: 'new' }, { id: 'b' }, { id: 'a' }], positions))).toEqual(['a', 'b', 'new']);
  });

  it('re-sorts from scratch with a fresh memory', () => {
    const positions = new Map<string, number>();
    stableOrder([{ id: 'a' }, { id: 'b' }], positions);
    expect(ids(stableOrder([{ id: 'b' }, { id: 'a' }], new Map()))).toEqual(['b', 'a']);
  });
});
