"use client";

/**
 * COURSE ASSIGNMENT (Workload Management — docx Table 1.4.1.1) — the
 * Programme Leader's workbench where each course's teaching slots get
 * assigned to lecturers. Policy enforced at save time by the API:
 * max 3 distinct courses per lecturer in Bachelor programmes and 4 in
 * Diploma programmes; stored maximum weekly hours per academic year;
 * only active lecturers; the course must carry an academic year; hour
 * totals are resummed into workloads.total_allocated_hours.
 *
 * Assignment model:
 *   · the initial ASSIGN picks ONE lecturer who takes all three slots;
 *   · EDIT then retargets the Lecture / Tutorial / Practical slots to
 *     different lecturers individually (one lecturer per slot);
 *   · the roster's Lecturer column mirrors the slots ("all slots" for a
 *     single lecturer, or an L/T/P breakdown once split).
 * Everything is persisted in workload_details (+ workloads headers) via
 * /api/allocations — Create/Edit/Delete round-trip the database, the
 * roster reloads after every save, and refusals (policy caps) surface
 * inside the dialog.
 */

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Check,
  ClipboardList,
  Eye,
  Loader2,
  Pencil,
  RefreshCcw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { apiFetch } from "@/services/apiClient";
import Toast from "@/components/toast/Toast";
import AutoAssignDialog from "@/components/allocations/AutoAssignDialog";
import AutoAssignIcon from "@/components/allocations/AutoAssignIcon";
import FilterSelect from "@/components/ui/FilterSelect";
import { SortableGridHeader } from "@/components/ui/SortableTableHeader";
import useTableSortAnimation from "@/components/ui/useTableSortAnimation";
import { sortByCriteria, toggleSortCriterion, type SortCriterion } from "@/lib/multi-sort";

/* ── data types ──────────────────────────────────────────────────────────── */

interface CourseRow {
  subjectCode: string;
  subjectName: string;
  programmeCode: string | null;
  programmeName: string;
  academicYearId: number | null;
  academicYearLabel: string;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  totalHours: number;
  studentCount: number;
  groupCount: number;
  isActive: boolean;
}

interface ProgrammeOption {
  code: string;
  name: string;
}

/** every coded term of every academic year — GET /api/courses
    academicYears payload (all 6 seeded terms, not just terms with courses) */
interface AcademicYearTerm {
  id: number;
  label: string;
  yearCode: string;
}

/** staff rows served by GET /api/lecturers (subset used here) */
interface StaffRow {
  id: number;
  staffId: string;
  fullName: string;
  position: string | null;
  employmentType: "FULL_TIME" | "PART_TIME";
  isActive: boolean;
}

/** the three teaching slots of a course — each resolves to one lecturer */
interface SlotAssignment {
  LECTURE: number;
  TUTORIAL: number;
  PRACTICAL: number;
}

/** GET /api/allocations row (subset) */
interface AllocationRow {
  subjectCode: string;
  subjectId: number;
  lecturerId: number;
  activityType: string;
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

type Triage = "all" | "assigned" | "unassigned";

type SortKey = "course";

const SORT_LABELS: Record<SortKey, string> = {
  course: "Course",
};

const compareCourseIdentity = (a: CourseRow, b: CourseRow) =>
  a.subjectCode.localeCompare(b.subjectCode, undefined, { numeric: true }) ||
  a.subjectName.localeCompare(b.subjectName);

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
};

/** slot keys in display order + their roster short labels */
const SLOTS = [
  { key: "LECTURE", short: "L", label: "Lecture" },
  { key: "TUTORIAL", short: "T", label: "Tutorial" },
  { key: "PRACTICAL", short: "P", label: "Practical" },
] as const;
type SlotKey = (typeof SLOTS)[number]["key"];

/* shared table-grid template — the header and EVERY row reuse the same
   column recipe so cells align; long text wraps inside its own column and
   narrower windows scroll the table horizontally instead of squeezing it.
   Academic Year, Hours (L · T · P) and Students moved into the per-row
   Details dialog — 5 columns: identity / programme / lecturer / details /
   actions */
const ROSTER_GRID =
  "grid grid-cols-[2.6fr_1.8fr_1.6fr_64px_104px] items-center gap-x-md";

/* ── themed controls (same look as the module rosters) ───────────────────── */

/** count-filter chip (triage: All / Assigned / Unassigned) */
function TriageChip({
  label,
  count,
  active,
  onClick,
  delay,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
  /** staggered entrance delay (ms) — part of the page-level choreography */
  delay?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={delay === undefined ? undefined : { animationDelay: `${delay}ms` }}
      className={`animate-[badgeIn_0.2s_ease-out_both] flex h-9 items-center gap-xs whitespace-nowrap rounded-badge px-md text-[12.5px] transition-colors ${
        active
          ? "bg-primaryLight font-semibold text-primary"
          : "border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg"
      }`}
    >
      {label}
      {count !== null && (
        <span className={active ? "text-primary/70" : "text-textSecondary"}>{count}</span>
      )}
    </button>
  );
}

/* ── assign dialog ───────────────────────────────────────────────────────── */

/* ── COURSE DETAILS ─────────────────────────────────────────────────────── */

/** Read-only detail dialog — Academic Year, Hours (L · T · P) and Students
    live here instead of table columns, keeping the assignment roster lean */
function CourseDetailDialog({
  course,
  onClose,
}: {
  course: CourseRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full max-w-[440px] overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card">
        {/* title bar */}
        <div className="flex items-start justify-between gap-md">
          <div>
            <h2 className="text-[18px] font-bold leading-[26px] text-text">
              <span className="text-primary">{course.subjectCode}</span> details
            </h2>
            <p className="mt-[2px] text-[12.5px] text-textSecondary">
              {course.subjectName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-textSecondary transition-colors hover:bg-hoverBg hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-lg flex flex-col gap-md">
          <div className="rounded-card border border-divider bg-background p-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
              Academic Year
            </p>
            <p className="mt-[2px] text-[13.5px] font-medium text-text">
              {course.academicYearLabel}
            </p>
          </div>

          <div className="rounded-card border border-divider bg-background p-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
              Hours (L · T · P)
            </p>
            <p className="mt-[2px] text-[13.5px] font-medium text-text">
              {course.lectureHours} · {course.tutorialHours} · {course.practicalHours}
              <span className="text-[12px] font-normal text-textSecondary"> per week</span>
            </p>
            <p className="text-[12px] text-textSecondary">
              {course.totalHours} total credit hour
              {Number(course.totalHours) === 1 ? "" : "s"}
            </p>
          </div>

          <div className="rounded-card border border-divider bg-background p-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
              Students
            </p>
            <p className="mt-[2px] text-[13.5px] font-medium text-text">
              {course.studentCount} in {course.groupCount} group
              {course.groupCount === 1 ? "" : "s"}
            </p>
            <p className="text-[12px] text-textSecondary">
              Per-class sizes live in Courses &amp; Programmes (Edit course).
            </p>
          </div>
        </div>

        <div className="mt-lg flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover active:bg-primaryActive"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Assign dialog with two modes driven by the course's assignment state:
 *   · CREATE — a single-select list; the picked lecturer takes all three
 *     slots; persists via POST /api/allocations;
 *   · EDIT  — a themed select per slot (retarget individually) and an
 *     "Unassign course" danger action; persists via PUT / DELETE
 *     /api/allocations/:code and DELETE /api/allocations/:code.
 * API refusals (policy caps, deactivated lecturers, already assigned)
 * surface as an animated error line inside the dialog; the commit runs
 * inside the dialog so the busy spinner owns Save / Clear.
 */
function AssignDialog({
  course,
  lecturers,
  initial,
  onClose,
  onCommit,
  onClear,
}: {
  course: CourseRow;
  /** staff directory (already loaded by the page) */
  lecturers: StaffRow[];
  /** current slot assignment — null = first assignment (create mode) */
  initial: SlotAssignment | null;
  onClose: () => void;
  /** persist the slot map → resolves null on success, or an error text */
  onCommit: (slots: SlotAssignment) => Promise<string | null>;
  /** remove the whole assignment (edit mode only) → null | error text */
  onClear: () => Promise<string | null>;
}) {
  const isEdit = initial !== null;

  /* create mode — the one lecturer who takes every slot */
  const [picked, setPicked] = useState<number | null>(initial ? initial.LECTURE : null);
  /* edit mode — per-slot selections */
  const [slotPick, setSlotPick] = useState<SlotAssignment>(
    initial ?? { LECTURE: 0, TUTORIAL: 0, PRACTICAL: 0 },
  );
  /* API round-trip state */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  /* only active staff can be assigned */
  const assignable = lecturers.filter((l) => l.isActive);

  const commit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onCommit(
      isEdit
        ? { LECTURE: slotPick.LECTURE, TUTORIAL: slotPick.TUTORIAL, PRACTICAL: slotPick.PRACTICAL }
        : { LECTURE: picked as number, TUTORIAL: picked as number, PRACTICAL: picked as number },
    );
    /* success closes the dialog from the page; an error stays visible */
    if (err !== null) {
      setError(err);
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onClear();
    if (err !== null) {
      setError(err);
      setBusy(false);
    }
  };

  const canSave = isEdit ? true : picked !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full max-w-[560px] overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card">
        {/* title bar */}
        <div className="flex items-start justify-between gap-md">
          <div>
            <h2 className="text-[18px] font-bold leading-[26px] text-text">
              {isEdit ? "Edit" : "Assign"} —{" "}
              <span className="text-primary">{course.subjectCode}</span>
            </h2>
            <p className="mt-[2px] text-[12.5px] text-textSecondary">
              {isEdit
                ? "Workload Management · change the lecturer for Lecture / Tutorial / Practical"
                : "Workload Management · select which lecturer teaches this course"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-textSecondary transition-colors hover:bg-hoverBg hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* course recap — the requester must see exactly what is assigned */}
        <div className="mt-lg rounded-card border border-divider bg-background p-md">
          <p className="text-[14px] font-semibold text-text">{course.subjectName}</p>
          <p className="mt-[2px] text-[12.5px] text-textSecondary">
            {course.programmeCode
              ? `${course.programmeCode} · ${course.programmeName}`
              : "No programme"}{" "}
            · {course.academicYearLabel}
          </p>
          <p className="mt-[2px] text-[12.5px] text-textSecondary">
            {course.lectureHours} · {course.tutorialHours} · {course.practicalHours}{" "}
            hours/week ({course.totalHours} total) · {course.studentCount} students in{" "}
            {course.groupCount} group{course.groupCount === 1 ? "" : "s"}
          </p>
        </div>

        {isEdit ? (
          /* edit mode — one themed select per slot */
          <div className="mt-lg">
            <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
              Slot lecturer
              <span className="normal-case tracking-normal">
                every slot keeps a lecturer — pick to retarget
              </span>
            </p>
            <div className="mt-xs flex flex-col gap-sm">
              {SLOTS.map((slot) => (
                <div key={slot.key} className="flex items-center gap-sm">
                  <span className="w-[86px] shrink-0 text-[12px] font-semibold text-textNormal">
                    {slot.label}
                  </span>
                  <FilterSelect
                    ariaLabel={`Select the ${slot.label.toLowerCase()} lecturer`}
                    value={String(slotPick[slot.key])}
                    onChange={(v) => setSlotPick({ ...slotPick, [slot.key]: Number(v) })}
                  >
                    {assignable.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.fullName} · {s.staffId}
                      </option>
                    ))}
                  </FilterSelect>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* create mode — single-select lecturer list */
          <div className="mt-lg">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
              Lecturer
            </p>
            <div className="mt-xs max-h-[280px] overflow-y-auto rounded-card border border-divider bg-background py-xs">
              {assignable.length === 0 ? (
                <p className="px-md py-md text-[12.5px] text-textSecondary">
                  No lecturers available — the staff directory is empty.
                </p>
              ) : (
                assignable.map((s) => {
                  const active = picked === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setPicked((prev) => (prev === s.id ? null : s.id))}
                      aria-pressed={active}
                      title={s.fullName}
                      className={`flex w-full items-center gap-sm px-md py-2 text-left transition-colors ${
                        active ? "bg-primaryLight/70" : "hover:bg-hoverBg"
                      }`}
                    >
                      {/* check chip (single-select) */}
                      <span
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-badge border transition-colors ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-divider bg-surface"
                        }`}
                      >
                        {active && <Check size={12} />}
                      </span>
                      <span className="min-w-0 flex-col">
                        <span
                          className={`block truncate text-[13px] leading-snug ${
                            active ? "font-semibold text-primary" : "font-semibold text-text"
                          }`}
                        >
                          {s.fullName}
                        </span>
                        <span className="block truncate text-[11.5px] leading-snug text-textSecondary">
                          {s.staffId} ·{" "}
                          {EMPLOYMENT_LABEL[s.employmentType] ?? s.employmentType} ·{" "}
                          {s.position ?? "—"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* policy note — mode-aware */}
        <p className="mt-md text-[12.5px] leading-snug text-textNormal">
          {isEdit
            ? "Every slot keeps one lecturer — switching a select retargets just that slot. Saving is blocked if a lecturer exceeds their maximum weekly teaching hours or course limits."
            : "One lecturer takes all three slots first — reopen Edit afterwards to give Lecture / Tutorial / Practical to different lecturers. Saving respects maximum weekly teaching hours and the course limits (3 Bachelor / 4 Diploma courses per lecturer)."}
        </p>

        {/* API refusal (policy caps, deactivated lecturers, race conflicts) */}
        {error && (
          <p className="animate-[badgeIn_0.2s_ease-out_both] mt-md flex items-start gap-[4px] text-[11.5px] font-medium leading-tight text-errorText">
            <TriangleAlert size={12} className="mt-[2px] shrink-0" />
            {error}
          </p>
        )}

        {/* footer actions */}
        <div className="mt-lg flex items-center justify-between gap-sm border-t border-divider pt-lg">
          {isEdit ? (
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="flex h-10 items-center gap-xs rounded-button border border-errorText/30 bg-surface px-md text-[12.5px] font-medium text-errorText transition-colors hover:border-errorText/60 hover:bg-errorBg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              {/* busy owns both ops; label still clarifies the danger action */}
              Unassign course
            </button>
          ) : (
            <span aria-hidden />
          )}
          <div className="flex items-center gap-sm">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={!canSave || busy}
              title={canSave ? undefined : "Select a lecturer first"}
              className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {busy ? "Saving…" : isEdit ? "Save changes" : "Save assignment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function AllocationsPage() {
  /* directory data */
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [programmeOptions, setProgrammeOptions] = useState<ProgrammeOption[]>([]);
  const [lecturers, setLecturers] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  /* DB-held slot assignments (subjectCode → slot lecturer ids), loaded
     from /api/allocations and refreshed after every save */
  const [assignments, setAssignments] = useState<Record<string, SlotAssignment>>({});
  /* the course whose assign/edit dialog is open */
  const [assigning, setAssigning] = useState<CourseRow | null>(null);
  const [detailCourse, setDetailCourse] = useState<CourseRow | null>(null);
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  /* green completion toast (top-center) */
  const [itemToast, setItemToast] = useState<string | null>(null);

  /* filters */
  const [status, setStatus] = useState<Triage>("all");
  const [programme, setProgramme] = useState("all");
  const [academicYears, setAcademicYears] = useState<AcademicYearTerm[]>([]);
  const [academicYear, setAcademicYear] = useState("all");
  const [sorts, setSorts] = useState<SortCriterion<SortKey>[]>([]);
  const [query, setQuery] = useState("");

  /* load the course directory (same payload the Courses module serves) plus
     the staff directory and the persisted slot assignments */
  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      apiFetch("/api/courses")
        .then((r) => r.json())
        .catch(() => null),
      apiFetch("/api/lecturers")
        .then((r) => r.json())
        .catch(() => null),
      apiFetch("/api/allocations")
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([c, l, a]) => {
      if (cancelled) return;
      let failed = false;
      if (c && c.ok) {
        setCourses(c.courses as CourseRow[]);
        setProgrammeOptions((c.programmes ?? []) as ProgrammeOption[]);
        setAcademicYears((c.academicYears ?? []) as AcademicYearTerm[]);
      } else {
        failed = true;
      }
      if (l && l.ok) {
        setLecturers(l.lecturers as StaffRow[]);
      } else {
        failed = true;
      }
      if (a && a.ok) {
        /* fold one row per (subject, slot) into the page's slot map */
        const map: Record<string, SlotAssignment> = {};
        (a.allocations as AllocationRow[]).forEach((row) => {
          if (row.activityType !== "LECTURE" && row.activityType !== "TUTORIAL" && row.activityType !== "PRACTICAL") {
            return;
          }
          const entry = (map[row.subjectCode] ??= {
            LECTURE: 0,
            TUTORIAL: 0,
            PRACTICAL: 0,
          });
          entry[row.activityType] = row.lecturerId;
        });
        setAssignments(map);
      } else {
        failed = true;
      }
      setError(failed ? "Course assignment data unavailable — check the API connection." : null);
    });
    return () => { cancelled = true; };
  }, [reloadTick]);

  /** create / edit persist — resolves null on success, error text on refusal */
  const commitAssignment = async (
    course: CourseRow,
    slots: SlotAssignment,
  ): Promise<string | null> => {
    try {
      const isEdit = assignments[course.subjectCode] != null;
      const r = await apiFetch(
        isEdit ? `/api/allocations/${course.subjectCode}` : "/api/allocations",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          /* POST (create) must label the course in the body — the PUT (edit)
             carries it in the URL instead */
          body: JSON.stringify(isEdit ? { slots } : { subjectCode: course.subjectCode, slots }),
        },
      );
      const d = await r.json();
      if (d.ok) {
        setAssigning(null);
        setItemToast(d.message);
        setReloadTick((t) => t + 1); /* roster + Lecturer column reload from the DB */
        return null;
      }
      return d.message ?? "The assignment could not be saved.";
    } catch {
      return "Network error while saving the assignment.";
    }
  };

  /** unassign (edit dialog's danger action) — null | error text */
  const clearAssignment = async (course: CourseRow): Promise<string | null> => {
    try {
      const r = await apiFetch(`/api/allocations/${course.subjectCode}`, { method: "DELETE" });
      const d = await r.json();
      if (d.ok) {
        setAssigning(null);
        setItemToast(d.message);
        setReloadTick((t) => t + 1);
        return null;
      }
      return d.message ?? "The assignment could not be removed.";
    } catch {
      return "Network error while clearing the assignment.";
    }
  };

  /* Assignment status follows saved L/T/P records, not the course's active
     flag. A partially assigned course already has an editable assignment. */
  const matchedCourses = useMemo(() => {
    const search = query.trim().toLowerCase();
    return courses.filter((c) => {
      const assigned = assignments[c.subjectCode] != null;
      if (status === "assigned" && !assigned) return false;
      if (status === "unassigned" && assigned) return false;
      if (programme !== "all" && c.programmeCode !== programme) return false;
      if (academicYear !== "all" && String(c.academicYearId) !== academicYear) return false;
      if (search && ![c.subjectCode, c.subjectName, c.programmeCode ?? "", c.programmeName].some((value) => value.toLowerCase().includes(search))) return false;
      return true;
    });
  }, [courses, assignments, academicYear, programme, status, query]);

  const counts = useMemo(
    () => {
      const assigned = courses.filter((course) => assignments[course.subjectCode] != null).length;
      return { total: courses.length, assigned, unassigned: courses.length - assigned };
    },
    [courses, assignments],
  );

  /* lecturer id → staff row (names + staffId for the Lecturer column) */
  const lectById = useMemo(() => {
    const map: Record<number, StaffRow> = {};
    lecturers.forEach((l) => {
      map[l.id] = l;
    });
    return map;
  }, [lecturers]);

  const sortedCourses = useMemo(() => sortByCriteria(
    matchedCourses,
    sorts,
    {
      course: compareCourseIdentity,
    },
    compareCourseIdentity,
  ), [matchedCourses, sorts]);

  const { bodyRef, prepareAnimation: prepareSortAnimation } =
    useTableSortAnimation<HTMLDivElement>(sortedCourses);
  const toggleSort = (key: SortKey) => {
    prepareSortAnimation();
    setSorts((current) => toggleSortCriterion(current, key));
  };
  const sortDirection = (key: SortKey) =>
    sorts.find((criterion) => criterion.key === key)?.direction ?? null;
  const sortPriority = (key: SortKey) => {
    const index = sorts.findIndex((criterion) => criterion.key === key);
    return index < 0 ? undefined : index + 1;
  };
  const sortSummary = sorts.length
    ? `${SORT_LABELS[sorts[0].key]} sorted ${sorts[0].direction === "asc" ? "ascending" : "descending"}.`
    : "No course-assignment sorting applied. The original directory order is shown.";

  /* academic-year filter options — EVERY coded term in the database
     (even terms without courses yet), shown in the roster's own
     "term code · AY year" wording, in year order (SQL pre-sorted) */
  const academicYearOptions = useMemo(
    () =>
      academicYears.map((t) => ({
        id: String(t.id),
        display: `${t.label.split(" · ")[0]} · AY ${t.yearCode}`,
        termDisplay: t.label,
        yearCode: t.yearCode,
      })),
    [academicYears],
  );

  /* Filter/search/reload changes replay row entry. Sorting retains keyed rows
     so the FLIP transition can move them smoothly between positions. */
  const listSignature = `${status}|${programme}|${academicYear}|${query}|${reloadTick}`;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      {/* heading */}
      <div className="animate-[rowIn_0.26s_ease-out_both] flex flex-wrap items-end justify-between gap-md">
        <div>
          <h1 className="text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">
            Course Assignment
          </h1>
          <p className="mt-1 text-[13px] text-textSecondary">
            Assign lecture, tutorial and practical slots of each course to lecturers ·{" "}
            {counts.total} course{counts.total === 1 ? "" : "s"} ({counts.assigned} assigned · {counts.unassigned} unassigned)
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAutoAssignOpen(true)}
          title="Preview assignments by workload, specialization, interest and previous courses"
          className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover active:scale-[0.97]"
        >
          <AutoAssignIcon size={20} /> Auto Assign
        </button>
      </div>

      {error && (
        <div className="animate-[badgeIn_0.2s_ease-out_both] mt-md flex flex-wrap items-center gap-sm">
          <p className="text-[13px] text-errorText">{error}</p>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="flex h-8 items-center gap-xs rounded-button border border-errorText/30 bg-errorBg px-sm text-[12px] font-medium text-errorText transition-colors hover:border-errorText/60 active:scale-95"
          >
            <RefreshCcw size={14} /> Retry
          </button>
        </div>
      )}

      {/* filters */}
      <div className="mt-lg flex flex-wrap items-center gap-sm">
        <TriageChip
          label="All"
          count={counts.total}
          delay={0}
          active={status === "all"}
          onClick={() => setStatus("all")}
        />
        <TriageChip
          label="Assigned"
          count={counts.assigned}
          delay={60}
          active={status === "assigned"}
          onClick={() => setStatus("assigned")}
        />
        <TriageChip
          label="Unassigned"
          count={counts.unassigned}
          delay={120}
          active={status === "unassigned"}
          onClick={() => setStatus("unassigned")}
        />
        {/* z-20 lifts the cluster above the roster card — the retained
            transform of the entrance animation would otherwise trap the
            dropdown menus' z-index behind the rows below */}
        <div className="animate-[rowIn_0.26s_ease-out_0.18s_both] relative z-20 ml-auto flex w-full flex-wrap items-center gap-sm sm:w-auto">
          <FilterSelect
            ariaLabel="Filter assignments by academic year term"
            value={academicYear}
            onChange={setAcademicYear}
          >
            <option value="all">All academic years</option>
            {Array.from(new Set(academicYearOptions.map((term) => term.yearCode))).map((yearCode) => (
              <optgroup key={yearCode} label={`AY ${yearCode}`}>
                {academicYearOptions
                  .filter((term) => term.yearCode === yearCode)
                  .map((term) => (
                    <option key={term.id} value={term.id}>{term.termDisplay}</option>
                  ))}
              </optgroup>
            ))}
          </FilterSelect>
          <FilterSelect
            ariaLabel="Filter by programme"
            value={programme}
            onChange={setProgramme}
          >
            <option value="all">All programmes</option>
            {programmeOptions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </FilterSelect>
          <div className="flex w-full min-w-0 items-center gap-sm sm:w-auto">
            <button type="button"
              onClick={() => { prepareSortAnimation(); setSorts([]); }}
              disabled={sorts.length === 0}
              className="flex h-9 items-center gap-xs whitespace-nowrap rounded-badge px-md text-[12.5px] transition-colors border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg">
              Clear Sort
            </button>
            <div className="relative min-w-0 flex-1 sm:w-[240px] sm:flex-none">
              <Search size={15} className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-textSecondary" />
              <input
                type="search"
                aria-label="Search courses"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search code, course or programme…"
                className="h-9 w-full rounded-button border border-divider bg-surface pl-9 pr-md text-[13px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
              />
            </div>
          </div>
        </div>
      </div>

      <p id="assignment-sort-help" className="sr-only">
        Use the Academic Year term list to filter assignments. Click Course to change its sorting direction. Use Clear Sort to restore the original order.
      </p>
      <p id="assignment-sort-summary" className="sr-only" aria-live="polite" aria-atomic="true">
        {sortSummary}
      </p>

      {/* roster list */}
      <div className="mt-md overflow-hidden rounded-card bg-surface shadow-card">
        {/* shared grid table — the header and every row reuse the same column
            recipe; narrower windows scroll instead of squeezing columns */}
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* header — identical grid template as the rows below */}
            <div className={`${ROSTER_GRID} border-b border-divider bg-surface px-lg py-sm`}>
              <SortableGridHeader label="Course" direction={sortDirection("course")}
                priority={sortPriority("course")} onSort={() => toggleSort("course")}
                description="Sort by course code, then course name" />
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Programme
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Lecturer
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Details
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Actions
              </p>
            </div>

            <div ref={bodyRef} key={listSignature}>
              {courses.length === 0 && !error ? (
                <div className="animate-[rowIn_0.26s_ease-out_both] flex items-center gap-sm px-lg py-xl">
                  <ClipboardList size={18} className="shrink-0 text-textSecondary" />
                  <p className="text-[13px] text-textSecondary">
                    Loading courses from PostgreSQL…
                  </p>
                </div>
              ) : sortedCourses.length === 0 ? (
                <div className="animate-[rowIn_0.26s_ease-out_both] px-lg py-xl text-center">
                  <p className="text-[14px] font-medium text-textNormal">No course found</p>
                  <p className="mt-1 text-[12.5px] text-textSecondary">
                    {query.trim() ? "No course matches your search and selected filters." : "No course matches the selected filters."}
                  </p>
                </div>
              ) : (
                sortedCourses.map((c, i) => {
                  const slotsOf = assignments[c.subjectCode] ?? null;
                  return (
                    <div
                      key={c.subjectCode}
                      data-sort-motion={`assignment:${c.subjectCode}`}
                      style={{ animationDelay: `${Math.min(i * 22, 440)}ms` }}
                      className={`${ROSTER_GRID} animate-[rowIn_0.26s_ease-out_both] border-b border-divider px-lg py-md transition-colors last:border-b-0 hover:bg-hoverBg/60`}
                    >
                      {/* identity: code + name */}
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold leading-snug text-text">
                          <span className="text-primary">{c.subjectCode}</span> ·{" "}
                          {c.subjectName}
                        </p>
                        <p className="mt-[2px] text-[12px] leading-snug text-textSecondary">
                          {c.totalHours} total credit hour
                          {Number(c.totalHours) === 1 ? "" : "s"}
                        </p>
                      </div>

                      {/* programme */}
                      <p className="min-w-0 text-[12.5px] leading-snug text-textNormal">
                        {c.programmeCode ? (
                          <>
                            <span className="font-medium">{c.programmeCode}</span>
                            <span className="block text-[11.5px] leading-snug text-textSecondary">
                              {c.programmeName}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </p>

                      {/* academic year / hours / students live in the
                          Details dialog (eye button) — not table columns */}

                      {/* lecturers — one name when every slot shares the same
                          lecturer, an L/T/P breakdown once slots are split */}
                      <div className="min-w-0">
                        {!slotsOf ? (
                          <p className="text-[12px] italic text-textDisabled">
                            Not assigned yet
                          </p>
                        ) : lectById[slotsOf.LECTURE] && slotsOf.LECTURE === slotsOf.TUTORIAL &&
                          slotsOf.TUTORIAL === slotsOf.PRACTICAL ? (
                          /* single lecturer teaching every slot */
                          <>
                            <p className="text-[12.5px] font-medium leading-snug text-textNormal">
                              {lectById[slotsOf.LECTURE].fullName}
                            </p>
                            <p className="text-[11.5px] leading-snug text-textSecondary">
                              {lectById[slotsOf.LECTURE].staffId} · all slots
                            </p>
                          </>
                        ) : (
                          /* split slots — one line each (L/T/P) */
                          <div className="min-w-0 text-[12.5px] leading-snug">
                            {SLOTS.map((slot) => (
                              <p
                                key={slot.key}
                                className="truncate"
                                title={lectById[slotsOf[slot.key]]?.fullName}
                              >
                                <span className="font-semibold text-textSecondary">
                                  {slot.short}·
                                </span>{" "}
                                {lectById[slotsOf[slot.key]]?.fullName ?? (slotsOf[slot.key] ? "Lecturer unavailable" : "Unassigned")}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* details — opens the read-only course detail dialog
                          (Academic Year / Hours / Students) */}
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() => setDetailCourse(c)}
                          title={`View ${c.subjectCode} details`}
                          aria-label={`View ${c.subjectCode} details`}
                          className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-primary hover:bg-primaryLight hover:text-primary active:scale-[0.97]"
                        >
                          <Eye size={14} />
                        </button>
                      </div>

                      {/* action: assign (none) or edit (already assigned) */}
                      <div className="flex items-center">
                        <button
                          type="button"
                          onClick={() => setAssigning(c)}
                          title={
                            slotsOf
                              ? `Edit lecturers for ${c.subjectCode}`
                              : `Assign lecturers to ${c.subjectCode}`
                          }
                          className="flex h-8 items-center gap-xs rounded-button bg-primary px-md text-[12.5px] font-medium text-white transition-colors hover:bg-primaryHover active:scale-95"
                        >
                          {slotsOf ? <Pencil size={13} /> : <ClipboardList size={14} />}
                          {slotsOf ? "Edit" : "Assign"}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {autoAssignOpen && (
        <AutoAssignDialog
          academicYears={academicYearOptions}
          programmes={programmeOptions}
          initialAcademicYear={academicYear}
          initialProgramme={programme}
          onClose={() => setAutoAssignOpen(false)}
          onSaved={(message) => {
            setAutoAssignOpen(false);
            setItemToast(message);
            setReloadTick((tick) => tick + 1);
          }}
        />
      )}

      {/* assign / edit dialog (CRUD to the database) */}
      {assigning && (
        <AssignDialog
          course={assigning}
          lecturers={lecturers}
          initial={assignments[assigning.subjectCode] ?? null}
          onClose={() => setAssigning(null)}
          onCommit={(slots) => commitAssignment(assigning, slots)}
          onClear={() => clearAssignment(assigning)}
        />
      )}
      {detailCourse && (
        <CourseDetailDialog
          course={detailCourse}
          onClose={() => setDetailCourse(null)}
        />
      )}

      <Toast tone="success" message={itemToast} onDone={() => setItemToast(null)} />
    </div>
  );
}
