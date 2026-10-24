import assert from "node:assert/strict";
import test from "node:test";
import {
  sortByCriteria,
  toggleSortCriterion,
  type SortCriterion,
} from "../../frontend/src/lib/multi-sort";

type Key = "group" | "name" | "count";
interface Row {
  id: number;
  group: string;
  name: string;
  count: number;
}

const rows: Row[] = [
  { id: 3, group: "B", name: "Alex", count: 2 },
  { id: 1, group: "A", name: "Blair", count: 2 },
  { id: 2, group: "A", name: "Alex", count: 4 },
  { id: 4, group: "A", name: "Alex", count: 2 },
];
const comparisons: Record<Key, (a: Row, b: Row) => number> = {
  group: (a, b) => a.group.localeCompare(b.group),
  name: (a, b) => a.name.localeCompare(b.name),
  count: (a, b) => a.count - b.count,
};
const ids = (order: SortCriterion<Key>[]) =>
  sortByCriteria(rows, order, comparisons, (a, b) => a.id - b.id).map((row) => row.id);

test("multi-sort appends new headers and toggles an existing direction in place", () => {
  let order: SortCriterion<Key>[] = [{ key: "group", direction: "asc" }];
  order = toggleSortCriterion(order, "name");
  order = toggleSortCriterion(order, "count");
  assert.deepEqual(order, [
    { key: "group", direction: "asc" },
    { key: "name", direction: "asc" },
    { key: "count", direction: "asc" },
  ]);
  assert.deepEqual(toggleSortCriterion(order, "name"), [
    order[0],
    { key: "name", direction: "desc" },
    order[2],
  ]);
});

test("multi-sort applies independent directions in first-clicked priority order", () => {
  assert.deepEqual(ids([
    { key: "group", direction: "asc" },
    { key: "name", direction: "asc" },
    { key: "count", direction: "desc" },
  ]), [2, 4, 1, 3]);
  assert.deepEqual(ids([
    { key: "count", direction: "asc" },
    { key: "group", direction: "desc" },
    { key: "name", direction: "asc" },
  ]), [3, 4, 1, 2]);
});

test("cleared sorting preserves API order and operations do not mutate inputs", () => {
  const frozenRows = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  const frozenOrder = Object.freeze([
    Object.freeze({ key: "name" as const, direction: "asc" as const }),
  ]);
  assert.deepEqual(sortByCriteria(frozenRows, [], comparisons, (a, b) => a.id - b.id), rows);
  assert.notEqual(sortByCriteria(frozenRows, frozenOrder, comparisons, (a, b) => a.id - b.id), frozenRows);
  assert.notEqual(toggleSortCriterion(frozenOrder, "name"), frozenOrder);
  assert.deepEqual(frozenOrder, [{ key: "name", direction: "asc" }]);
});
