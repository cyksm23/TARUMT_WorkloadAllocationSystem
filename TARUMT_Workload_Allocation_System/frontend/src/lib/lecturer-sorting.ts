import type { SortDirection } from "../components/ui/SortableTableHeader";

export type LecturerSortKey = "name" | "staffId" | "workloadLimit" | "status";
export interface LecturerSort {
  key: LecturerSortKey;
  direction: SortDirection;
}

interface SortableLecturer {
  fullName: string;
  staffId: string;
  minHours: number;
  maxHours: number;
  isActive: boolean;
}

export const LECTURER_SORT_LABELS: Record<LecturerSortKey, string> = {
  name: "Lecturer", staffId: "Staff ID", workloadLimit: "Workload limit", status: "Status",
};

const compareNames = (a: SortableLecturer, b: SortableLecturer) =>
  a.fullName.localeCompare(b.fullName) || a.staffId.localeCompare(b.staffId, undefined, { numeric: true });

const comparisons: Record<LecturerSortKey, (a: SortableLecturer, b: SortableLecturer) => number> = {
  name: (a, b) => a.fullName.localeCompare(b.fullName),
  staffId: (a, b) => a.staffId.localeCompare(b.staffId, undefined, { numeric: true }),
  workloadLimit: (a, b) => a.maxHours - b.maxHours || a.minHours - b.minHours,
  status: (a, b) => Number(b.isActive) - Number(a.isActive),
};

/** Each criterion only breaks ties from the earlier ones. Saved maximum
 * hours, then minimum hours, define the workload-limit value; allocated
 * hours never substitute for limits. An empty order preserves directory order.
 */
export function sortLecturers<T extends SortableLecturer>(rows: readonly T[], order: readonly LecturerSort[]): T[] {
  const result = [...rows];
  if (order.length === 0) return result;
  return result.sort((a, b) => {
    for (const criterion of order) {
      const comparison = comparisons[criterion.key](a, b) * (criterion.direction === "asc" ? 1 : -1);
      if (comparison !== 0) return comparison;
    }
    return compareNames(a, b);
  });
}

/** Add a new column last, or toggle its direction without losing priorities. */
export function toggleLecturerSort(order: readonly LecturerSort[], key: LecturerSortKey): LecturerSort[] {
  if (!order.some((criterion) => criterion.key === key)) return [...order, { key, direction: "asc" }];
  return order.map((criterion) => criterion.key === key
    ? { ...criterion, direction: criterion.direction === "asc" ? "desc" : "asc" } : criterion);
}

export function promoteLecturerSort(order: readonly LecturerSort[], key: LecturerSortKey): LecturerSort[] {
  const criterion = order.find((entry) => entry.key === key);
  return criterion ? [criterion, ...order.filter((entry) => entry.key !== key)] : [...order];
}

export function removeLecturerSort(order: readonly LecturerSort[], key: LecturerSortKey): LecturerSort[] {
  return order.filter((criterion) => criterion.key !== key);
}
