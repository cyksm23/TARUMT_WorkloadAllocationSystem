import type { SortDirection } from "../components/ui/SortableTableHeader";

export interface SortCriterion<Key extends string> {
  key: Key;
  direction: SortDirection;
}

/** Add a column after the existing priorities, or toggle its direction in
 * place. Keeping its position makes repeated header clicks predictable. */
export function toggleSortCriterion<Key extends string>(
  order: readonly SortCriterion<Key>[],
  key: Key,
): SortCriterion<Key>[] {
  if (!order.some((criterion) => criterion.key === key)) {
    return [...order, { key, direction: "asc" }];
  }
  return order.map((criterion) =>
    criterion.key === key
      ? { ...criterion, direction: criterion.direction === "asc" ? "desc" : "asc" }
      : criterion,
  );
}

/** Apply criteria from first-clicked to last-clicked. An empty order returns
 * a copy in API order, while the final comparator keeps equal values stable
 * and deterministic whenever sorting is active. */
export function sortByCriteria<Row, Key extends string>(
  rows: readonly Row[],
  order: readonly SortCriterion<Key>[],
  comparisons: Record<Key, (a: Row, b: Row) => number>,
  tieBreaker: (a: Row, b: Row) => number,
): Row[] {
  const result = [...rows];
  if (order.length === 0) return result;

  return result.sort((a, b) => {
    for (const criterion of order) {
      const comparison = comparisons[criterion.key](a, b);
      if (comparison !== 0) {
        return comparison * (criterion.direction === "asc" ? 1 : -1);
      }
    }
    return tieBreaker(a, b);
  });
}
