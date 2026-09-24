/**
 * Keep every card where it was first shown.
 *
 * The Matches board is two sources — scored jobs, sorted by score, and the
 * unscored band in retrieval order — and a card moves from the second to the
 * first when its score lands. Sorted naively, it would jump to its score's
 * place at that moment. Scores land for exactly the cards being read (they are
 * requested when a card dwells in view), so a jump moves the card under the
 * reader's eyes and cursor: lost place, and a click meant for one card's ×
 * landing on another's Add.
 *
 * So a card keeps the position it was first given. `positions` is the memory:
 * create a fresh Map whenever the board should re-sort (a filter or search
 * change, or the next visit) and keep the same one otherwise. Ids it has not
 * seen go after everything it has, in the order they arrive.
 */
export function stableOrder<T extends { id: string }>(items: readonly T[], positions: Map<string, number>): T[] {
  for (const item of items) {
    if (!positions.has(item.id)) positions.set(item.id, positions.size);
  }
  return [...items].sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}
