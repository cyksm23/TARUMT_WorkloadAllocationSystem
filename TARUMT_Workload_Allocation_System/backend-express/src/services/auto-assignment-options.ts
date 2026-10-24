/** Small shared contract: safe for both API validation and client controls. */
export const ASSIGNMENT_PRIORITIES = ["workload", "specialization", "interest", "history"] as const;
export type AssignmentPriority = (typeof ASSIGNMENT_PRIORITIES)[number];
export const DEFAULT_ASSIGNMENT_PRIORITIES: AssignmentPriority[] = [...ASSIGNMENT_PRIORITIES];
export const PRIORITY_LABELS: Record<AssignmentPriority, string> = {
  workload: "Workload / teaching hours",
  specialization: "Specialization",
  interest: "Area of interest",
  history: "Previous courses taught",
};

export function isAssignmentPriorityOrder(value: unknown): value is AssignmentPriority[] {
  return Array.isArray(value) && value.length === ASSIGNMENT_PRIORITIES.length &&
    value.every((entry) => typeof entry === "string" && (ASSIGNMENT_PRIORITIES as readonly string[]).includes(entry)) &&
    new Set(value).size === ASSIGNMENT_PRIORITIES.length;
}
