import assert from "node:assert/strict";
import test from "node:test";
import {
  promoteLecturerSort, removeLecturerSort, sortLecturers, toggleLecturerSort,
  type LecturerSort,
} from "../../frontend/src/lib/lecturer-sorting";

const rows = [
  { staffId: "1004", fullName: "Alex", minHours: 10, maxHours: 20, isActive: false, allocatedHours: 2 },
  { staffId: "1002", fullName: "Alex", minHours: 8, maxHours: 20, isActive: true, allocatedHours: 19 },
  { staffId: "1003", fullName: "Alex", minHours: 8, maxHours: 30, isActive: true, allocatedHours: 0 },
  { staffId: "1001", fullName: "Blair", minHours: 15, maxHours: 20, isActive: false, allocatedHours: 5 },
  { staffId: "1005", fullName: "Casey", minHours: 5, maxHours: 10, isActive: true, allocatedHours: 4 },
  { staffId: "1006", fullName: "Alex", minHours: 12, maxHours: 20, isActive: true, allocatedHours: 18 },
];
const ids = (order: LecturerSort[]) => sortLecturers(rows, order).map((row) => row.staffId);

test("new columns append unique sorting priorities; toggling retains every other criterion", () => {
  let order: LecturerSort[] = [{ key: "name", direction: "asc" }];
  order = toggleLecturerSort(order, "staffId");
  order = toggleLecturerSort(order, "workloadLimit");
  assert.deepEqual(order, [
    { key: "name", direction: "asc" }, { key: "staffId", direction: "asc" }, { key: "workloadLimit", direction: "asc" },
  ]);
  order = toggleLecturerSort(order, "staffId");
  assert.deepEqual(order, [
    { key: "name", direction: "asc" }, { key: "staffId", direction: "desc" }, { key: "workloadLimit", direction: "asc" },
  ]);
  assert.equal(toggleLecturerSort(order, "staffId").length, 3);
});

test("all four criteria combine lexicographically with independent directions", () => {
  assert.deepEqual(ids([
    { key: "name", direction: "asc" }, { key: "status", direction: "asc" },
    { key: "workloadLimit", direction: "desc" }, { key: "staffId", direction: "asc" },
  ]), ["1003", "1006", "1002", "1004", "1001", "1005"]);
});

test("maximum then minimum limit hours are sorted numerically, not allocated teaching hours", () => {
  assert.deepEqual(ids([{ key: "workloadLimit", direction: "asc" }]), ["1005", "1002", "1004", "1006", "1001", "1003"]);
  assert.deepEqual(ids([{ key: "workloadLimit", direction: "desc" }]), ["1003", "1001", "1006", "1004", "1002", "1005"]);
});

test("promoting a criterion changes precedence without dropping directions or other priorities", () => {
  const order: LecturerSort[] = [{ key: "name", direction: "asc" }, { key: "workloadLimit", direction: "desc" }, { key: "status", direction: "asc" }];
  const promoted = promoteLecturerSort(order, "workloadLimit");
  assert.deepEqual(promoted, [order[1], order[0], order[2]]);
  assert.equal(promoted.length, order.length);
  assert.notDeepEqual(ids(promoted), ids(order));
  assert.deepEqual(promoteLecturerSort(order, "staffId"), order);
});

test("removing criteria preserves the remaining priority order and supports clearing all sorting", () => {
  const order: LecturerSort[] = [{ key: "name", direction: "asc" }, { key: "staffId", direction: "desc" }, { key: "workloadLimit", direction: "asc" }];
  assert.deepEqual(removeLecturerSort(order, "staffId"), [order[0], order[2]]);
  assert.deepEqual(removeLecturerSort([{ key: "name", direction: "asc" }], "name"), []);
  assert.deepEqual(ids([]), rows.map((row) => row.staffId));
  assert.deepEqual(toggleLecturerSort([], "status"), [{ key: "status", direction: "asc" }]);
});

test("later criteria only break ties; unique higher-priority staff IDs already determine order", () => {
  assert.deepEqual(ids([{ key: "staffId", direction: "desc" }, { key: "workloadLimit", direction: "asc" }]),
    ids([{ key: "staffId", direction: "desc" }]));
  assert.deepEqual(ids([{ key: "name", direction: "asc" }]), ["1002", "1003", "1004", "1006", "1001", "1005"]);
});

test("status keeps both active and inactive staff, grouped in the selected direction", () => {
  const ascending = sortLecturers(rows, [{ key: "status", direction: "asc" }]);
  const descending = sortLecturers(rows, [{ key: "status", direction: "desc" }]);
  assert.deepEqual(ascending.map((row) => row.isActive), [true, true, true, true, false, false]);
  assert.deepEqual(descending.map((row) => row.isActive), [false, false, true, true, true, true]);
});

test("sorting and priority operations never mutate rows or the reviewed criterion list", () => {
  const frozenRows = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  const order = Object.freeze([Object.freeze({ key: "name" as const, direction: "asc" as const })]);
  assert.notEqual(sortLecturers(frozenRows, order), frozenRows);
  assert.notEqual(toggleLecturerSort(order, "name"), order);
  assert.notEqual(promoteLecturerSort(order, "name"), order);
  assert.notEqual(removeLecturerSort(order, "name"), order);
  assert.deepEqual(order, [{ key: "name", direction: "asc" }]);
  assert.deepEqual(frozenRows.map((row) => row.staffId), rows.map((row) => row.staffId));
});
