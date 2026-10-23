"use client";

/**
 * COURSE ASSIGNMENT (Workload Management — docx Table 1.4.1.1) — the
 * Programme Leader's workbench where each course's teaching slots get
 * assigned to lecturers. Policy enforced at save time by the API:
 * max 3 distinct courses per lecturer in Bachelor programmes and 4 in
 * Diploma programmes; only active lecturers; the course must carry a
 * academic year; hour totals are resummed into workloads.total_allocated_hours.
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
  Children,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ClipboardList,
  Loader2,
  Pencil,
  RefreshCcw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch } from "@/services/apiClient";
import Toast from "@/components/toast/Toast";

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

type Triage = "all" | "active" | "inactive";

type SortKey =
  | "code_asc"
  | "code_desc"
  | "name_asc"
  | "name_desc"
  | "hours_desc"
  | "students_desc";

const SORTERS: Record<SortKey, (a: CourseRow, b: CourseRow) => number> = {
  code_asc: (a, b) => a.subjectCode.localeCompare(b.subjectCode),
  code_desc: (a, b) => b.subjectCode.localeCompare(a.subjectCode),
  name_asc: (a, b) => a.subjectName.localeCompare(b.subjectName),
  name_desc: (a, b) => b.subjectName.localeCompare(a.subjectName),
  hours_desc: (a, b) =>
    b.totalHours - a.totalHours || a.subjectCode.localeCompare(b.subjectCode),
  students_desc: (a, b) =>
    b.studentCount - a.studentCount || a.subjectCode.localeCompare(b.subjectCode),
};

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
   narrower windows scroll the table horizontally instead of squeezing it */
const ROSTER_GRID =
  "grid grid-cols-[2.2fr_1.5fr_1fr_1fr_0.9fr_1.15fr_104px] items-center gap-x-md";

/* ── themed controls (same look as the module rosters) ───────────────────── */

/**
 * Themed filter dropdown — palette menu surface; options are declared with
 * <option value="…">Label</option> children.
 */
function FilterSelect({
  ariaLabel,
  value,
  onChange,
  icon: Icon,
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /* measured at open: the tallest the list may render while staying
     INSIDE its clipping card — an overlong menu would grow the dialog's
     scroll area ("the whole dialog scrolling"), so the list scrolls
     itself instead. Placement is consistently BELOW the trigger (the
     list just gets shorter near the dialog bottom, e.g. Practical). */
  const [menuMaxH, setMenuMaxH] = useState(288);
  /* live search inside the open menu — narrows the entries as you type */
  const [term, setTerm] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const root = rootRef.current;
    let maxH = 288;
    if (root) {
      const rect = root.getBoundingClientRect();
      /* nearest ancestor that clips the menu (the dialog's card);
         page-level selects fall back to the viewport bounds */
      let bounds: { top: number; bottom: number } | null = null;
      let el: HTMLElement | null = root.parentElement;
      while (el) {
        const oy = window.getComputedStyle(el).overflowY;
        if (oy === "auto" || oy === "scroll") {
          const r = el.getBoundingClientRect();
          bounds = { top: r.top, bottom: r.bottom };
          break;
        }
        el = el.parentElement;
      }
      const clipBottom = bounds ? bounds.bottom : window.innerHeight - 8;
      maxH = Math.min(288, Math.max(120, Math.floor(clipBottom - rect.bottom - 16)));
    }
    setMenuMaxH(maxH);
    setTerm("");
    setOpen(true);
  };

  /* flatten the <option> children into {value,label} menu entries */
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((el) => {
      const props = el.props as { value?: unknown; children?: ReactNode };
      return {
        value: String(props.value ?? ""),
        label: String(props.children ?? props.value ?? ""),
      };
    });
  const selected = options.find((o) => o.value === value) ?? options[0];
  const searched = term.trim().toLowerCase();
  const visibleOptions = searched
    ? options.filter((o) => o.label.toLowerCase().includes(searched))
    : options;

  /* close on outside click or Escape */
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {/* trigger button — shows the selected label, chevron spins when open */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        className={`flex h-9 w-full items-center gap-xs whitespace-nowrap rounded-button border bg-surface pl-md pr-8 text-[13px] font-medium text-textNormal outline-none transition-colors sm:w-auto ${
          open ? "border-primary" : "border-divider hover:bg-background"
        }`}
      >
        {Icon && <Icon size={14} className="shrink-0 text-textSecondary" />}
        <span className="min-w-0 flex-1 truncate text-left" title={selected?.label}>
          {selected?.label ?? "—"}
        </span>
        <span
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-textSecondary transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          <ChevronDown size={14} />
        </span>
      </button>

      {/* palette-themed menu panel — pinned search, the list scrolls itself */}
      {open && (
        <div className="animate-[menuIn_0.18s_ease-out_both] absolute left-0 top-full z-30 mt-xs w-max min-w-full origin-top-left overflow-hidden rounded-card border border-divider bg-surface shadow-card">
          <div className="border-b border-divider p-xs">
            <input
              type="text"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search…"
              aria-label={`Search — ${ariaLabel}`}
              className="h-9 w-full min-w-[220px] rounded-button border border-divider bg-background px-md text-[12.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
            />
          </div>
          <div
            role="listbox"
            aria-label={ariaLabel}
            className="py-xs"
            style={{ maxHeight: Math.max(96, menuMaxH - 54), overflowY: "auto" }}
          >
            {visibleOptions.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={o.label}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex h-9 w-full items-center gap-sm whitespace-nowrap px-md text-left text-[13px] transition-colors ${
                    active
                      ? "bg-primaryLight font-semibold text-primary"
                      : "font-medium text-textNormal hover:bg-hoverBg"
                  }`}
                >
                  {o.label}
                  {active && <Check size={14} className="ml-auto shrink-0" />}
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <p className="px-md py-md text-[12.5px] italic text-textSecondary">
                No match for “{term.trim()}”
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** count-filter chip (triage: All / Active / Inactive) */
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
            ? "Every slot keeps one lecturer — switching a select retargets just that slot. The save writes workload_details rows and refuses when a lecturer passes the policy caps."
            : "One lecturer takes all three slots first — reopen Edit afterwards to give Lecture / Tutorial / Practical to different lecturers. The save writes workload_details rows and refuses when a lecturer passes the policy caps (3 Bachelor / 4 Diploma courses per lecturer)."}
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
  /* green completion toast (top-center) */
  const [itemToast, setItemToast] = useState<string | null>(null);

  /* filters */
  const [status, setStatus] = useState<Triage>("all");
  const [programme, setProgramme] = useState("all");
  const [sort, setSort] = useState<SortKey>("code_asc");
  const [query, setQuery] = useState("");

  /* load the course directory (same payload the Courses module serves) plus
     the staff directory and the persisted slot assignments */
  useEffect(() => {
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
      let failed = false;
      if (c && c.ok) {
        setCourses(c.courses as CourseRow[]);
        setProgrammeOptions((c.programmes ?? []) as ProgrammeOption[]);
      } else {
        failed = true;
      }
      if (l && l.ok) {
        setLecturers(l.lecturers as StaffRow[]);
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
      }
      if (failed) {
        setError("Course directory unavailable — check the API connection.");
      }
    });
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
        window.dispatchEvent(new Event("tw:rail:refresh"));
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
        window.dispatchEvent(new Event("tw:rail:refresh"));
        return null;
      }
      return d.message ?? "The assignment could not be removed.";
    } catch {
      return "Network error while clearing the assignment.";
    }
  };

  /* live course filter: status chip + programme + search */
  const matchedCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (status === "active" && !c.isActive) return false;
      if (status === "inactive" && c.isActive) return false;
      if (programme !== "all" && c.programmeCode !== programme) return false;
      if (!q) return true;
      return (
        c.subjectName.toLowerCase().includes(q) ||
        c.subjectCode.toLowerCase().includes(q) ||
        (c.programmeName ?? "").toLowerCase().includes(q)
      );
    });
  }, [courses, query, programme, status]);

  const sortedCourses = useMemo(
    () => [...matchedCourses].sort(SORTERS[sort]),
    [matchedCourses, sort],
  );

  const counts = useMemo(
    () => ({
      total: courses.length,
      active: courses.filter((c) => c.isActive).length,
      inactive: courses.filter((c) => !c.isActive).length,
    }),
    [courses],
  );

  /* lecturer id → staff row (names + staffId for the Lecturer column) */
  const lectById = useMemo(() => {
    const map: Record<number, StaffRow> = {};
    lecturers.forEach((l) => {
      map[l.id] = l;
    });
    return map;
  }, [lecturers]);

  /* remount key — every filter/sort/search change (and each reload) replays
     the row glide-in */
  const listSignature = `${status}|${programme}|${sort}|${query}|${reloadTick}`;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      {/* heading */}
      <div className="animate-[rowIn_0.26s_ease-out_both]">
        <h1 className="text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">
          Course Assignment
        </h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Assign lecture, tutorial and practical slots of each course to lecturers ·{" "}
          {counts.total} course{counts.total === 1 ? "" : "s"} ({counts.active} active)
        </p>
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
          label="Active"
          count={counts.active}
          delay={60}
          active={status === "active"}
          onClick={() => setStatus("active")}
        />
        <TriageChip
          label="Inactive"
          count={counts.inactive}
          delay={120}
          active={status === "inactive"}
          onClick={() => setStatus("inactive")}
        />
        {/* z-20 lifts the cluster above the roster card — the retained
            transform of the entrance animation would otherwise trap the
            dropdown menus' z-index behind the rows below */}
        <div className="animate-[rowIn_0.26s_ease-out_0.18s_both] relative z-20 ml-auto flex w-full flex-wrap items-center gap-sm sm:w-auto">
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
          <FilterSelect
            ariaLabel="Sort courses"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            icon={ArrowDownUp}
          >
            <option value="code_asc">Sort: Code A → Z</option>
            <option value="code_desc">Sort: Code Z → A</option>
            <option value="name_asc">Sort: Name A → Z</option>
            <option value="name_desc">Sort: Name Z → A</option>
            <option value="hours_desc">Sort: Total hours → high</option>
            <option value="students_desc">Sort: Students → many</option>
          </FilterSelect>
          <div className="relative w-full sm:w-[260px]">
            <Search
              size={16}
              className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-textSecondary"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, name, programme…"
              className="h-11 w-full rounded-button border border-divider bg-surface pl-10 pr-md text-[13.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
            />
          </div>
        </div>
      </div>

      {/* roster list */}
      <div className="mt-md overflow-hidden rounded-card bg-surface shadow-card">
        {/* shared grid table — the header and every row reuse the same column
            recipe; narrower windows scroll instead of squeezing columns */}
        <div className="overflow-x-auto">
          <div className="min-w-[1100px]">
            {/* header — identical grid template as the rows below */}
            <div className={`${ROSTER_GRID} border-b border-divider px-lg py-sm`}>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Course
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Programme
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Academic Year
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Hours (L · T · P)
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Students
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Lecturer
              </p>
              <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                Actions
              </p>
            </div>

            <div key={listSignature}>
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
                    No course matches “{query.trim()}” with the selected filters.
                  </p>
                </div>
              ) : (
                sortedCourses.map((c, i) => {
                  const slotsOf = assignments[c.subjectCode] ?? null;
                  return (
                    <div
                      key={c.subjectCode}
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

                      {/* academic year */}
                      <p className="min-w-0 text-[12.5px] leading-snug text-textNormal">
                        {c.academicYearLabel}
                      </p>

                      {/* hours */}
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-text">
                          {c.lectureHours} · {c.tutorialHours} · {c.practicalHours}
                        </p>
                        <p className="text-[11.5px] leading-snug text-textSecondary">
                          lecture · tut · prac / wk
                        </p>
                      </div>

                      {/* students/groups */}
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-text">
                          {c.studentCount}
                        </p>
                        <p className="text-[11.5px] leading-snug text-textSecondary">
                          in {c.groupCount} group{c.groupCount === 1 ? "" : "s"}
                        </p>
                      </div>

                      {/* lecturers — one name when every slot shares the same
                          lecturer, an L/T/P breakdown once slots are split */}
                      <div className="min-w-0">
                        {!slotsOf ||
                        !lectById[slotsOf.LECTURE] ||
                        !lectById[slotsOf.TUTORIAL] ||
                        !lectById[slotsOf.PRACTICAL] ? (
                          <p className="text-[12px] italic text-textDisabled">
                            Not assigned yet
                          </p>
                        ) : slotsOf.LECTURE === slotsOf.TUTORIAL &&
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
                                title={lectById[slotsOf[slot.key]].fullName}
                              >
                                <span className="font-semibold text-textSecondary">
                                  {slot.short}·
                                </span>{" "}
                                {lectById[slotsOf[slot.key]].fullName}
                              </p>
                            ))}
                          </div>
                        )}
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

      <Toast tone="success" message={itemToast} onDone={() => setItemToast(null)} />
    </div>
  );
}
