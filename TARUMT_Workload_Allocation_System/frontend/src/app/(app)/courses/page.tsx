"use client";

/**
 * COURSES & PROGRAMMES (UC_CPM_01) — the module where the Programme
 * Leader creates, edits and deletes course (subject) and programme records.
 *
 * One page, two rosters behind a segmented switch (matching the sidebar's
 * single "Courses & Programmes" entry):
 *   · COURSES      — subjects joined with programme + academic year, hour
 *                    components (L/T/P), total hours (auto L+T+P),
 *                    students/groups, status.
 *   · PROGRAMMES   — programme directory with department, level, duration
 *                    and a live count of the courses inside it.
 *
 * The course dialogs carry the required Tutorial / Practical student
 * counts and auto-derive Groups; the flexible class-size rules (Tutorial /
 * Practical limits from class_size_rules) sit in a card below the roster —
 * like the Lecturers page's Hour-limit rules — reachable via the floating
 * jump button, which doubles as "Back to top" after arrival.
 *
 * Same design language as the Lecturers roster: Gmail-style row list,
 * filter chips + themed FilterSelect pills + search, per-field inline
 * validation (warn after blur or save attempt — never mid-typing), snapshot
 * uniqueness on codes (duplicates refused with a visible field error),
 * delete guard dialogs and the green completion toast.
 */

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiFetch } from "@/services/apiClient";
import Toast from "@/components/toast/Toast";
import CompactFilterSelect from "@/components/ui/FilterSelect";
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
  creditHours: number;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  totalHours: number;
  tutorialStudents: number | null;
  practicalStudents: number | null;
  studentCount: number;
  groupCount: number;
  isActive: boolean;
}

/** flexible class-size rule rows (class_size_rules table) */
interface ClassSizeRule {
  classType: "TUTORIAL" | "PRACTICAL";
  limitStudents: number;
}

interface ProgrammeRow {
  programmeCode: string;
  programmeName: string;
  department: string;
  level: string | null;
  durationYears: number | null;
  isActive: boolean;
  subjectCount: number;
}

interface ProgrammeOption {
  code: string;
  name: string;
}

interface AcademicYearOption {
  id: number;
  label: string;
  /** academic year of the term — drives the picker's optgroups */
  yearCode: string;
}

interface DepartmentOption {
  code: string;
  name: string;
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

type Triage = "all" | "active" | "inactive";

type CourseSortKey = "course" | "hours" | "students" | "status";
type ProgrammeSortKey = "programme" | "department" | "level" | "duration" | "courses" | "status";

const LEVELS = ["Bachelor", "Master", "Diploma", "Foundation"] as const;

const COURSE_SORT_LABELS: Record<CourseSortKey, string> = {
  course: "Course",
  hours: "Hours",
  students: "Students",
  status: "Status",
};

const PROGRAMME_SORT_LABELS: Record<ProgrammeSortKey, string> = {
  programme: "Programme",
  department: "Department",
  level: "Level",
  duration: "Duration",
  courses: "Courses",
  status: "Status",
};

const compareCourseIdentity = (a: CourseRow, b: CourseRow) =>
  a.subjectCode.localeCompare(b.subjectCode, undefined, { numeric: true }) ||
  a.subjectName.localeCompare(b.subjectName);

const COURSE_SORTERS: Record<CourseSortKey, (a: CourseRow, b: CourseRow) => number> = {
  course: compareCourseIdentity,
  hours: (a, b) => a.totalHours - b.totalHours,
  students: (a, b) => a.studentCount - b.studentCount,
  status: (a, b) => Number(b.isActive) - Number(a.isActive),
};

const compareProgrammeIdentity = (a: ProgrammeRow, b: ProgrammeRow) =>
  a.programmeCode.localeCompare(b.programmeCode, undefined, { numeric: true }) ||
  a.programmeName.localeCompare(b.programmeName);

const PROGRAMME_SORTERS: Record<ProgrammeSortKey, (a: ProgrammeRow, b: ProgrammeRow) => number> = {
  programme: compareProgrammeIdentity,
  department: (a, b) => a.department.localeCompare(b.department),
  level: (a, b) => (a.level ?? "").localeCompare(b.level ?? ""),
  duration: (a, b) => (a.durationYears ?? 0) - (b.durationYears ?? 0),
  courses: (a, b) => a.subjectCount - b.subjectCount,
  status: (a, b) => Number(b.isActive) - Number(a.isActive),
};

/* ── shared table-grid templates — the header and EVERY row reuse the same
   column recipe so cells always align under their headers; long text wraps
   inside its own column (min-w-0 cells, natural word wrap, no ellipsis),
   and narrower windows scroll the table horizontally instead of squeezing
   columns. Fixed-width tail columns keep Status/Actions pinned. */
const COURSE_GRID =
  "grid grid-cols-[2.2fr_1.5fr_1.5fr_1fr_0.9fr_86px_96px] items-center gap-x-md";
const PROGRAMME_GRID =
  "grid grid-cols-[2.6fr_1fr_1.1fr_0.8fr_1fr_86px_96px] items-center gap-x-md";

/** digits + at most ONE decimal place — the numeric(4,1) hour domain */
const sanitizeHour1 = (raw: string) => {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 1)}`;
};

/** whole digits only — counts & duration */
const sanitizeInt = (raw: string) => raw.replace(/[^0-9]/g, "");

/** course/programme code input: uppercase, letters+digits+dashes only */
const sanitizeCode = (raw: string) =>
  raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,14}$/;
const P_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,9}$/;

/* class-size rules — a TUTORIAL / PRACTICAL class over its limit splits
   into groups; the limits are flexible (editable in the course dialogs) */
const DEFAULT_TUTORIAL_LIMIT = 36;
const DEFAULT_PRACTICAL_LIMIT = 28;

const limitFor = (
  rules: ClassSizeRule[],
  type: "TUTORIAL" | "PRACTICAL",
  fallback: number,
) => rules.find((r) => r.classType === type)?.limitStudents ?? fallback;

/** groups for a class headcount — ceil(students / limit); 0 when empty */
const ceilGroups = (students: number, limit: number) =>
  students <= 0 ? 0 : Math.ceil(students / limit);

/** derived group split for the dialogs — each class type splits per its
    limit; the stored group_count is the total (never below 1) */
const deriveGroups = (
  tutorialStudents: string,
  practicalStudents: string,
  tutorialLimit: number,
  practicalLimit: number,
) => {
  const tutorialGroups = ceilGroups(Number(tutorialStudents), tutorialLimit);
  const practicalGroups = ceilGroups(Number(practicalStudents), practicalLimit);
  return {
    tutorialGroups,
    practicalGroups,
    totalGroups: Math.max(1, tutorialGroups + practicalGroups),
  };
};

/** hour component validity: 0–24 h with at most one decimal (numeric(4,1)) */
const badHour = (n: number) =>
  !Number.isFinite(n) || n < 0 || n > 24 || Math.abs(n * 10 - Math.round(n * 10)) > 1e-6;

/** shared input styling for the dialogs (theme: 44px, primary focus ring) */
const INPUT_CLS =
  "h-11 w-full rounded-button border border-divider bg-background px-md text-[13.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primaryLight disabled:cursor-not-allowed disabled:bg-hoverBg disabled:text-textSecondary";

/** inline per-field message — appears only after blur or a save attempt */
function FieldError({ text }: { text: string }) {
  return (
    <span className="animate-[badgeIn_0.2s_ease-out_both] mt-[3px] flex items-start gap-[4px] text-[11.5px] font-medium leading-tight text-errorText">
      <TriangleAlert size={12} className="mt-[2px] shrink-0" />
      {text}
    </span>
  );
}

/** labelled 44px form field wrapper for the dialog grid */
function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-textNormal">{label}</span>
      {children}
      {error && <FieldError text={error} />}
    </label>
  );
}

/**
 * Themed filter dropdown — custom menu surface in the docx palette.
 * Same call API as the Lecturers page: options are declared with
 * <option value="…">Label</option> children; `fullWidth` stretches the
 * pill to the whole cell width inside dialogs.
 */
function FilterSelect({
  ariaLabel,
  value,
  onChange,
  icon: Icon,
  fullWidth,
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  icon?: LucideIcon;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* flatten the <option>/<optgroup> children into menu entries — plain
     options render ungrouped; an optgroup (the academic-year picker's
     intakes) emits a caption row followed by its own options */
  const options: Array<{ value: string; label: string; group: string | null }> = [];
  Children.toArray(children)
    .filter(isValidElement)
    .forEach((el) => {
      const props = el.props as { value?: unknown; label?: unknown; children?: ReactNode };
      if (props.value === undefined && typeof props.label === "string") {
        const group = props.label;
        Children.toArray(props.children)
          .filter(isValidElement)
          .forEach((child) => {
            const cp = child.props as { value?: unknown; children?: ReactNode };
            options.push({
              value: String(cp.value ?? ""),
              label: String(cp.children ?? cp.value ?? ""),
              group,
            });
          });
        return;
      }
      options.push({
        value: String(props.value ?? ""),
        label: String(props.children ?? props.value ?? ""),
        group: null,
      });
    });
  const selected = options.find((o) => o.value === value) ?? options[0];

  /* close on outside click or Escape */
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        /* consume Escape so dialog-level handlers don't close the whole
           dialog while only this menu should close */
        e.stopImmediatePropagation();
        setOpen(false);
      }
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
        onClick={() => setOpen((o) => !o)}
        className={`relative flex h-9 items-center gap-xs whitespace-nowrap rounded-button border bg-surface pr-8 text-[13px] font-medium text-textNormal outline-none transition-colors ${
          fullWidth ? "w-full" : "w-full sm:w-auto"
        } ${open ? "border-primary" : "border-divider hover:bg-background"} ${
          Icon ? "pl-8" : "pl-md"
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

      {/* palette-themed menu panel */}
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="animate-[menuIn_0.18s_ease-out_both] absolute left-0 top-full z-30 mt-xs w-max min-w-full origin-top-left overflow-hidden rounded-card border border-divider bg-surface py-xs shadow-card"
        >
          {options.map((o, i) => {
            const active = o.value === value;
            const opensGroup = o.group !== null && o.group !== options[i - 1]?.group;
            return (
              <Fragment key={`${o.group ?? "opt"}-${o.value}`}>
                {opensGroup && (
                  <p
                    className={`${
                      i === 0 ? "" : "mt-1 border-t border-divider"
                    } px-md pb-[6px] pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-textSecondary`}
                  >
                    {o.group}
                  </p>
                )}
                <button
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
              </Fragment>
            );
          })}
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

function StatusDot({ active }: { active: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-xs">
      <span
        className={`h-2 w-2 shrink-0 rounded-badge ${
          active ? "bg-success" : "bg-textDisabled"
        }`}
      />
      <span
        className={`text-[12px] font-medium ${
          active ? "text-textNormal" : "text-textSecondary"
        }`}
      >
        {active ? "Active" : "Inactive"}
      </span>
    </div>
  );
}

/** segmented Courses / Programmes switch in the heading row */
function ViewSwitch({
  view,
  onChange,
  coursesCount,
  programmesCount,
}: {
  view: "courses" | "programmes";
  onChange: (v: "courses" | "programmes") => void;
  coursesCount: number | null;
  programmesCount: number | null;
}) {
  const tabs: Array<{
    key: "courses" | "programmes";
    label: string;
    icon: LucideIcon;
    count: number | null;
  }> = [
    { key: "courses", label: "Courses", icon: BookOpen, count: coursesCount },
    { key: "programmes", label: "Programmes", icon: GraduationCap, count: programmesCount },
  ];
  return (
    <div className="flex items-center gap-xs rounded-button border border-divider bg-surface p-[3px] shadow-card">
      {tabs.map((t, i) => {
        const active = view === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-pressed={active}
            className={`flex h-8 items-center gap-xs rounded-badge px-md text-[12.5px] transition-colors ${
              active
                ? "bg-primaryLight font-semibold text-primary"
                : "font-medium text-textNormal hover:bg-hoverBg"
            } ${i === 0 ? "animate-[badgeIn_0.2s_ease-out_both]" : "animate-[badgeIn_0.2s_ease-out_both_0.07s]"}`}
          >
            <t.icon size={14} className="shrink-0" />
            {t.label}
            {t.count !== null && (
              <span className={active ? "text-primary/70" : "text-textSecondary"}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** dialog backdrop — click on the veil closes, Escape handled per dialog */
function DialogShell({
  onClose,
  width,
  bodyRef,
  children,
}: {
  onClose: () => void;
  width: string;
  /** optional scroll control — the course dialogs use it for the sum-warning
      auto flow (direct to class-size & splitting / back to top) */
  bodyRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={bodyRef}
        className={`animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full ${width} overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card`}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-md">
      <div>
        <h2 className="text-[18px] font-bold leading-[26px] text-text">{title}</h2>
        <p className="mt-[2px] text-[12.5px] text-textSecondary">{subtitle}</p>
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
  );
}

/* ── ADD / EDIT COURSE ───────────────────────────────────────────────────── */

/** shared form state + validation for both course dialogs */
interface CourseForm {
  code: string;
  name: string;
  programmeCode: string;
  academicYearId: string;
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  tutorialStudents: string;
  practicalStudents: string;
  studentCount: string;
  isActive: boolean;
}

const COURSE_EMPTY: CourseForm = {
  code: "",
  name: "",
  programmeCode: "",
  academicYearId: "",
  lectureHours: "2",
  tutorialHours: "1",
  practicalHours: "0",
  tutorialStudents: "",
  practicalStudents: "",
  studentCount: "",
  isActive: true,
};

const COURSE_CODE_DUP = "This course code is already registered — duplicate course codes are not allowed.";

/**
 * Per-field course-form validator. Presence fields (code format, name,
 * programme, academic year) report on a save attempt; the sanitized numeric
 * fields report once blurred or the user attempts a save — never mid-typing
 * (digit sanitizers already keep letters from landing).
 */
function useCourseValidation(
  form: CourseForm,
  attempted: boolean,
  blurred: Set<string>,
  countsOptional = false,
) {
  return useMemo(() => {
    const errors: Record<string, string | null> = {
      code: null,
      name: null,
      programmeCode: null,
      academicYearId: null,
      lectureHours: null,
      tutorialHours: null,
      practicalHours: null,
      tutorialStudents: null,
      practicalStudents: null,
      studentCount: null,
      studentSum: null,
    };
    const db = (k: string) => attempted || blurred.has(k);

    if ((attempted || blurred.has("code")) && !CODE_RE.test(form.code)) {
      errors.code = form.code
        ? "Course code must be 2–15 letters or digits (no spaces)."
        : "Please enter the course code.";
    }
    if (attempted && !form.name.trim()) errors.name = "Please enter the course name.";
    if (form.programmeCode === "" && db("programmeCode"))
      errors.programmeCode = "Please select a programme.";
    if (form.academicYearId === "" && db("academicYearId"))
      errors.academicYearId = "Please select an academic year.";

    const hourFields: Array<[keyof CourseForm, string]> = [
      ["lectureHours", "Lecture hours"],
      ["tutorialHours", "Tutorial hours"],
      ["practicalHours", "Practical hours"],
    ];
    hourFields.forEach(([key, label]) => {
      if (db(key)) {
        const n = Number(form[key]);
        if (badHour(n)) errors[key] = `${label} must be 0–24 with one decimal at most.`;
      }
    });

    if (attempted && !countsOptional && form.studentCount === "") {
      errors.studentCount = "Please enter the total number of students.";
    } else if (db("studentCount")) {
      const s = Number(form.studentCount);
      if (!Number.isInteger(s) || s < 0 || s > 2000)
        errors.studentCount = "Students must be a whole number between 0 and 2000.";
    }

    /* per-class headcounts — required in the EDIT dialog (every value is
       prefilled there); the ADD dialog allows leaving them empty so the
       course can be created first and sized later. 0 is always valid
       (a course without that class component). */
    if (attempted && !countsOptional && form.tutorialStudents === "") {
      errors.tutorialStudents = "Please enter the number of tutorial students.";
    } else if (db("tutorialStudents")) {
      const t = Number(form.tutorialStudents);
      if (!Number.isInteger(t) || t < 0 || t > 2000)
        errors.tutorialStudents = "Tutorial students must be a whole number between 0 and 2000.";
    }
    if (attempted && !countsOptional && form.practicalStudents === "") {
      errors.practicalStudents = "Please enter the number of practical students.";
    } else if (db("practicalStudents")) {
      const p = Number(form.practicalStudents);
      if (!Number.isInteger(p) || p < 0 || p > 2000)
        errors.practicalStudents = "Practical students must be a whole number between 0 and 2000.";
    }

    /* per-class cross-check — each class headcount may not exceed the
       total students ON ITS OWN (tutorial and practical are separate
       intakes, not one combined pool). Same visibility policy: a message
       appears after a blur of its own field or the total's, a save
       attempt, never mid-typing, and only when both involved fields are
       otherwise valid (an empty count is still covered by its required
       message; format errors take priority). Each message blocks the
       save like every field error and the section renders them below the
       grid (errors.studentSum), not under the inputs. */
    const tNum = form.tutorialStudents === "" ? null : Number(form.tutorialStudents);
    const pNum = form.practicalStudents === "" ? null : Number(form.practicalStudents);
    const sNum = form.studentCount === "" ? null : Number(form.studentCount);
    const sumWarnings: string[] = [];
    if (
      (attempted || blurred.has("tutorialStudents") || blurred.has("studentCount")) &&
      tNum !== null &&
      sNum !== null &&
      errors.tutorialStudents === null &&
      errors.studentCount === null &&
      tNum > sNum
    ) {
      sumWarnings.push(`Tutorial students (${tNum}) exceed the total students (${sNum}).`);
    }
    if (
      (attempted || blurred.has("practicalStudents") || blurred.has("studentCount")) &&
      pNum !== null &&
      sNum !== null &&
      errors.practicalStudents === null &&
      errors.studentCount === null &&
      pNum > sNum
    ) {
      sumWarnings.push(`Practical students (${pNum}) exceed the total students (${sNum}).`);
    }
    if (sumWarnings.length > 0) {
      errors.studentSum = sumWarnings.join("\n");
    }
    return errors;
  }, [form, attempted, blurred, countsOptional]);
}

function CourseHourCell({
  label,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error: string | null;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-textNormal">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(sanitizeHour1(e.target.value))}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={5}
        className={`${INPUT_CLS} ${error ? "border-error ring-2 ring-errorLight" : ""}`}
      />
      {error && <FieldError text={error} />}
    </label>
  );
}

function CourseIntCell({
  label,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error: string | null;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-textNormal">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(sanitizeInt(e.target.value))}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={4}
        className={`${INPUT_CLS} ${error ? "border-error ring-2 ring-errorLight" : ""}`}
      />
      {error && <FieldError text={error} />}
    </label>
  );
}

function CourseCodeInput({
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error: string | null;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-textNormal">Course code</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(sanitizeCode(e.target.value))}
        onBlur={onBlur}
        disabled={disabled}
        maxLength={15}
        placeholder="e.g. RS2323"
        className={`${INPUT_CLS} ${error ? "border-error ring-2 ring-errorLight" : ""}`}
      />
      {error && <FieldError text={error} />}
    </label>
  );
}

function CourseNameInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-textNormal">Course name</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
        placeholder="e.g. Discrete Structures"
        className={`${INPUT_CLS} ${error ? "border-error ring-2 ring-errorLight" : ""}`}
      />
      {error && <FieldError text={error} />}
    </label>
  );
}

/** read-only auto-derived group count shown beside its matching headcount */
function GroupAutoCell({
  label,
  value,
  title,
}: {
  label: string;
  value: number;
  title: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-textNormal">{label}</span>
      <p
        className="flex h-11 items-center rounded-button border border-divider bg-hoverBg px-md text-[13.5px] font-semibold text-textNormal"
        title={title}
      >
        {value}
      </p>
    </label>
  );
}

/**
 * Class-size & splitting section — shared by both course dialogs.
 *
 * Two stacked columns: the headcount inputs on the left (tutorial, then
 * practical, then the total) each paired with its auto-derived group count
 * on the right; the per-class exceed warnings surface in lines under the
 * grid. The flexible class-size rule set lives in the Class-size rules card
 * below the roster — mirroring the Lecturers page's Hour-limit rules card —
 * and every group count here derives from those limits.
 */
function ClassSplittingSection({
  form,
  set,
  markBlurred,
  errors,
  sumWarning,
  sectionRef,
  tutorialLimit,
  practicalLimit,
  tutorialGroups,
  practicalGroups,
  totalGroups,
}: {
  form: CourseForm;
  set: (k: keyof CourseForm, v: string | boolean) => void;
  markBlurred: (k: string) => void;
  errors: Record<string, string | null>;
  sumWarning: string | null;
  /** dialog attaches this so a sum warning can direct the scroll here */
  sectionRef?: RefObject<HTMLDivElement>;
  tutorialLimit: number;
  practicalLimit: number;
  tutorialGroups: number;
  practicalGroups: number;
  totalGroups: number;
}) {
  const tutorialCount = Number(form.tutorialStudents || "0");
  const practicalCount = Number(form.practicalStudents || "0");

  return (
    <div ref={sectionRef} className="sm:col-span-2">
      {/* headcounts on the left column, their auto-derived group counts on
          the right — each box pairs with the input beside it */}
      <div className="grid grid-cols-1 gap-x-md gap-y-lg sm:grid-cols-2">
        <CourseIntCell
          label="Tutorial students"
          value={form.tutorialStudents}
          onChange={(v) => set("tutorialStudents", v)}
          onBlur={() => markBlurred("tutorialStudents")}
          error={errors.tutorialStudents}
          placeholder="e.g. 58"
        />
        <GroupAutoCell
          label="Tutorial groups"
          value={tutorialGroups}
          title={`tutorial students ÷ ${tutorialLimit} per group, rounded up — from the class-size rules`}
        />
        <CourseIntCell
          label="Practical students"
          value={form.practicalStudents}
          onChange={(v) => set("practicalStudents", v)}
          onBlur={() => markBlurred("practicalStudents")}
          error={errors.practicalStudents}
          placeholder="e.g. 45"
        />
        <GroupAutoCell
          label="Practical groups"
          value={practicalGroups}
          title={`practical students ÷ ${practicalLimit} per group, rounded up — from the class-size rules`}
        />
        <CourseIntCell
          label="Students (total)"
          value={form.studentCount}
          onChange={(v) => set("studentCount", v)}
          onBlur={() => markBlurred("studentCount")}
          error={errors.studentCount}
          placeholder="0–2000"
        />
        <GroupAutoCell
          label="Total groups"
          value={totalGroups}
          title="tutorial groups + practical groups"
        />
      </div>

      {/* per-class exceed warnings live here — blocking like every field
          error; otherwise show the guidance line only until counts are
          entered */}
      {sumWarning && sumWarning.length > 0 ? (
        <div className="mt-md flex flex-col gap-1">
          {sumWarning.split("\n").map((w) => (
            <p
              key={w}
              className="animate-[badgeIn_0.2s_ease-out_both] flex items-start gap-[4px] text-[11.5px] font-medium leading-tight text-errorText"
            >
              <TriangleAlert size={12} className="mt-[2px] shrink-0" />
              {w}
            </p>
          ))}
        </div>
      ) : tutorialCount === 0 && practicalCount === 0 ? (
        <p className="mt-md flex flex-wrap items-center gap-x-sm text-[11.5px] leading-snug text-textSecondary">
          Enter the two student counts — classes over a class-size rule split into groups
          automatically. They are optional: leave them empty now and fill them in later.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Auto-scroll flow for the class-size exceed warnings (both course dialogs).
 *
 * When a blocking warning appears ("Tutorial/Practical students … exceed
 * the total students…"), the dialog body smoothly scrolls itself down to
 * the Class-size & splitting section — the fix lives there, so the user
 * no longer hunts for it by hand. Once the counts are corrected and the
 * warnings clear, the body returns to the top automatically.
 * Uses plain scrollTo math on the dialog body because scrollIntoView
 * would also drag the page behind the overlay.
 */
function useSumWarningScroll(sumWarning: string | null): {
  bodyRef: RefObject<HTMLDivElement>;
  sectionRef: RefObject<HTMLDivElement>;
} {
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const warned = useRef(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (sumWarning) {
      warned.current = true;
      const section = sectionRef.current;
      if (body && section) {
        const delta = section.getBoundingClientRect().top - body.getBoundingClientRect().top;
        const max = body.scrollHeight - body.clientHeight;
        body.scrollTo({
          top: Math.min(max, Math.max(0, body.scrollTop + delta - 8)),
          behavior: "smooth",
        });
      }
    } else if (warned.current) {
      warned.current = false;
      if (body && body.scrollTop > 0) {
        body.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }, [sumWarning]);

  return { bodyRef, sectionRef };
}

/** Add course dialog — POST /api/courses (UC_CPM_01 create records) */
function AddCourseDialog({
  courses,
  programmes,
  academicYears,
  classSizeRules,
  onClose,
  onSaved,
}: {
  programmes: ProgrammeOption[];
  academicYears: AcademicYearOption[];
  /** existing codes — live duplicate refusal mirrors the Staff ID guard */
  courses: CourseRow[];
  classSizeRules: ClassSizeRule[];
  onClose: () => void;
  /** fired after a successful POST; the argument becomes the green toast */
  onSaved: (toast: string) => void;
}) {
  const [form, setForm] = useState<CourseForm>({
    ...COURSE_EMPTY,
    /* no placeholder entry — the picker opens directly on the first academic year */
    academicYearId: academicYears[0] ? String(academicYears[0].id) : "",
  });
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [blurred, setBlurred] = useState<Set<string>>(new Set());
  /** server refused the code (23505 → 409) — surfaced under the code field */
  const [serverDupe, setServerDupe] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof CourseForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));
  const markBlurred = (k: string) =>
    setBlurred((s) => new Set(s).add(k));

  /* live duplicate probe — same guard the Staff ID field uses */
  const codeDupe =
    form.code !== "" &&
    courses.some((c) => c.subjectCode.toUpperCase() === form.code.toUpperCase());

  /* group counts derive from the flexible class-size rules (Tutorial /
     Practical) — never typed by hand */
  const tutorialLimit = limitFor(classSizeRules, "TUTORIAL", DEFAULT_TUTORIAL_LIMIT);
  const practicalLimit = limitFor(classSizeRules, "PRACTICAL", DEFAULT_PRACTICAL_LIMIT);
  const split = deriveGroups(
    form.tutorialStudents,
    form.practicalStudents,
    tutorialLimit,
    practicalLimit,
  );

  const errors = useCourseValidation(form, attempted, blurred, true);
  const liveCodeError = codeDupe ? COURSE_CODE_DUP : errors.code;
  const codeError = serverDupe ? COURSE_CODE_DUP : liveCodeError;
  const fieldBlocked =
    Object.values(errors).some(Boolean) || codeDupe || serverDupe;

  /* sum-warning auto flow: direct to class-size & splitting, back to top */
  const { bodyRef, sectionRef } = useSumWarningScroll(errors.studentSum);

  const save = async () => {
    setServerDupe(false);
    if (!attempted) setAttempted(true);
    if (fieldBlocked) return; /* stay clickable — a click reveals messages */
    setSaving(true);
    try {
      const r = await apiFetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectCode: form.code,
          subjectName: form.name.trim(),
          programmeCode: form.programmeCode,
          academicYearId: Number(form.academicYearId),
          lectureHours: Number(form.lectureHours),
          tutorialHours: Number(form.tutorialHours),
          practicalHours: Number(form.practicalHours),
          studentCount: form.studentCount === "" ? 0 : Number(form.studentCount),
          /* groups derive once real sizes exist — until then the DB
             default of 1 group applies */
          groupCount: split.totalGroups || 1,
          /* sizes are optional — empty stores NULL (not filled in yet) */
          tutorialStudents: form.tutorialStudents === "" ? null : Number(form.tutorialStudents),
          practicalStudents: form.practicalStudents === "" ? null : Number(form.practicalStudents),
          isActive: form.isActive,
        }),
      });
      const d = await r.json();
      if (r.status === 201 && d.ok) {
        onSaved(`Course ${form.code} (${form.name.trim()}) has been created successfully.`);
      } else if (r.status === 409) {
        setServerDupe(true);
      } else if (typeof d.message === "string" && /programme/i.test(d.message)) {
        setBlurred((s) => new Set(s).add("programmeCode")); /* reveal the select error */
      } else {
        console.error("[AddCourseDialog] create failed:", d);
      }
    } catch (err) {
      console.error("[AddCourseDialog] create error:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell onClose={onClose} width="max-w-[680px]" bodyRef={bodyRef}>
      <DialogHeader
        title="Add course"
        subtitle="Create a course record with its hour components and class sizes."
        onClose={onClose}
      />
      <div className="mt-lg grid grid-cols-1 gap-x-md gap-y-lg sm:grid-cols-2">
        <CourseCodeInput
          value={form.code}
          onChange={(v) => {
            set("code", v);
            if (serverDupe) setServerDupe(false);
          }}
          onBlur={() => markBlurred("code")}
          error={codeError}
        />
        <CourseNameInput value={form.name} onChange={(v) => set("name", v)} error={errors.name} />

        <Field label="Programme" error={errors.programmeCode}>
          <FilterSelect
            ariaLabel="Select programme"
            value={form.programmeCode}
            onChange={(v) => set("programmeCode", v)}
            fullWidth
          >
            <option value="">Select programme…</option>
            {programmes.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </FilterSelect>
        </Field>
        <Field label="Academic Year" error={errors.academicYearId}>
          <FilterSelect
            ariaLabel="Select academic year"
            value={form.academicYearId}
            onChange={(v) => set("academicYearId", v)}
            fullWidth
          >
            {/* academic-year groups — three coded intakes per year
                (2026/2027 → 202605 · May 2026 …) */}
            {Array.from(new Set(academicYears.map((s) => s.yearCode))).map((yearCode) => (
              <optgroup key={yearCode} label={`AY ${yearCode}`}>
                {academicYears
                  .filter((s) => s.yearCode === yearCode)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </FilterSelect>
        </Field>

        {/* hour trio — one 3-col row; total hours preview below */}
        <div className="sm:col-span-2">
          <div className="grid grid-cols-3 gap-md">
            <CourseHourCell
              label="Lecture / wk"
              value={form.lectureHours}
              onChange={(v) => set("lectureHours", v)}
              onBlur={() => markBlurred("lectureHours")}
              error={errors.lectureHours}
            />
            <CourseHourCell
              label="Tutorial / wk"
              value={form.tutorialHours}
              onChange={(v) => set("tutorialHours", v)}
              onBlur={() => markBlurred("tutorialHours")}
              error={errors.tutorialHours}
            />
            <CourseHourCell
              label="Practical / wk"
              value={form.practicalHours}
              onChange={(v) => set("practicalHours", v)}
              onBlur={() => markBlurred("practicalHours")}
              error={errors.practicalHours}
            />
          </div>
        </div>

        {/* total credit hours — maintained automatically as lecture + tutorial + practical */}
        <div className="sm:col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-textNormal">Total credit hours</span>
          <p className="flex h-11 items-center rounded-button border border-divider bg-hoverBg px-md text-[13.5px] font-semibold text-textNormal">
            {(
              Math.round(
                (Number(form.lectureHours) +
                  Number(form.tutorialHours) +
                  Number(form.practicalHours)) *
                  10,
              ) / 10
            ).toFixed(1)}
            <span
              className="ml-xs min-w-0 flex-1 truncate text-[11.5px] font-medium text-textSecondary"
              title="= lecture + tutorial + practical (auto)"
            >
              = lecture + tutorial + practical (auto)
            </span>
          </p>
        </div>

        {/* class size & splitting — required counts + flexible rules */}
        <ClassSplittingSection
          form={form}
          set={set}
          markBlurred={markBlurred}
          errors={errors}
          tutorialLimit={tutorialLimit}
          practicalLimit={practicalLimit}
          sumWarning={errors.studentSum}
          sectionRef={sectionRef}
          tutorialGroups={split.tutorialGroups}
          practicalGroups={split.practicalGroups}
          totalGroups={split.totalGroups}
        />

        <Field label="Status">
          <FilterSelect
            ariaLabel="Select status"
            value={form.isActive ? "active" : "inactive"}
            onChange={(v) => set("isActive", v === "active")}
            fullWidth
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </FilterSelect>
        </Field>
      </div>

      <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {saving ? "Adding…" : "Add course"}
        </button>
      </div>
    </DialogShell>
  );
}

/** Edit course dialog — PATCH /api/courses/:code; code is immutable */
function EditCourseDialog({
  course,
  programmes,
  academicYears,
  classSizeRules,
  onClose,
  onSaved,
}: {
  course: CourseRow;
  programmes: ProgrammeOption[];
  academicYears: AcademicYearOption[];
  classSizeRules: ClassSizeRule[];
  onClose: () => void;
  onSaved: (toast: string) => void;
}) {
  const [form, setForm] = useState<CourseForm>({
    code: course.subjectCode,
    name: course.subjectName,
    programmeCode: course.programmeCode ?? "",
    academicYearId: course.academicYearId ? String(course.academicYearId) : "",
    lectureHours: String(course.lectureHours),
    tutorialHours: String(course.tutorialHours),
    practicalHours: String(course.practicalHours),
    tutorialStudents: String(course.tutorialStudents ?? ""),
    practicalStudents: String(course.practicalStudents ?? ""),
    studentCount: String(course.studentCount),
    isActive: course.isActive,
  });
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [blurred, setBlurred] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof CourseForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));
  const markBlurred = (k: string) => setBlurred((s) => new Set(s).add(k));

  /* group counts derive from the flexible class-size rules (Tutorial /
     Practical) — never typed by hand */
  const tutorialLimit = limitFor(classSizeRules, "TUTORIAL", DEFAULT_TUTORIAL_LIMIT);
  const practicalLimit = limitFor(classSizeRules, "PRACTICAL", DEFAULT_PRACTICAL_LIMIT);
  const split = deriveGroups(
    form.tutorialStudents,
    form.practicalStudents,
    tutorialLimit,
    practicalLimit,
  );

  const errors = useCourseValidation(form, attempted, blurred);
  const fieldBlocked = Object.values(errors).some(Boolean);

  /* sum-warning auto flow: direct to class-size & splitting, back to top */
  const { bodyRef, sectionRef } = useSumWarningScroll(errors.studentSum);

  const save = async () => {
    if (!attempted) setAttempted(true);
    if (fieldBlocked) return; /* stay clickable — a click reveals messages */
    setSaving(true);
    try {
      const r = await apiFetch(`/api/courses/${form.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: form.name.trim(),
          programmeCode: form.programmeCode,
          academicYearId: Number(form.academicYearId),
          lectureHours: Number(form.lectureHours),
          tutorialHours: Number(form.tutorialHours),
          practicalHours: Number(form.practicalHours),
          studentCount: Number(form.studentCount),
          groupCount: split.totalGroups,
          tutorialStudents: Number(form.tutorialStudents),
          practicalStudents: Number(form.practicalStudents),
          isActive: form.isActive,
        }),
      });
      const d = await r.json();
      if (r.status === 200 && d.ok) {
        onSaved(`Course ${form.code} (${form.name.trim()}) has been updated successfully.`);
      } else if (typeof d.message === "string" && /programme|academic/i.test(d.message)) {
        setBlurred((s) => new Set(s).add(/academic/i.test(d.message) ? "academicYearId" : "programmeCode"));
      } else {
        console.error("[EditCourseDialog] update failed:", d);
      }
    } catch (err) {
      console.error("[EditCourseDialog] update error:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell onClose={onClose} width="max-w-[680px]" bodyRef={bodyRef}>
      <DialogHeader
        title="Edit course"
        subtitle={`Maintaining ${course.subjectCode} — course codes are permanent.`}
        onClose={onClose}
      />
      <div className="mt-lg grid grid-cols-1 gap-x-md gap-y-lg sm:grid-cols-2">
        <CourseCodeInput
          value={form.code}
          onChange={() => {}}
          onBlur={() => markBlurred("code")}
          error={null}
          disabled
        />
        <CourseNameInput value={form.name} onChange={(v) => set("name", v)} error={errors.name} />

        <Field label="Programme" error={errors.programmeCode}>
          <FilterSelect
            ariaLabel="Select programme"
            value={form.programmeCode}
            onChange={(v) => set("programmeCode", v)}
            fullWidth
          >
            <option value="">Select programme…</option>
            {programmes.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </FilterSelect>
        </Field>
        <Field label="Academic Year" error={errors.academicYearId}>
          <FilterSelect
            ariaLabel="Select academic year"
            value={form.academicYearId}
            onChange={(v) => set("academicYearId", v)}
            fullWidth
          >
            {/* academic-year groups — three coded intakes per year
                (2026/2027 → 202605 · May 2026 …) */}
            {Array.from(new Set(academicYears.map((s) => s.yearCode))).map((yearCode) => (
              <optgroup key={yearCode} label={`AY ${yearCode}`}>
                {academicYears
                  .filter((s) => s.yearCode === yearCode)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </FilterSelect>
        </Field>

        <div className="sm:col-span-2">
          <div className="grid grid-cols-3 gap-md">
            <CourseHourCell
              label="Lecture / wk"
              value={form.lectureHours}
              onChange={(v) => set("lectureHours", v)}
              onBlur={() => markBlurred("lectureHours")}
              error={errors.lectureHours}
            />
            <CourseHourCell
              label="Tutorial / wk"
              value={form.tutorialHours}
              onChange={(v) => set("tutorialHours", v)}
              onBlur={() => markBlurred("tutorialHours")}
              error={errors.tutorialHours}
            />
            <CourseHourCell
              label="Practical / wk"
              value={form.practicalHours}
              onChange={(v) => set("practicalHours", v)}
              onBlur={() => markBlurred("practicalHours")}
              error={errors.practicalHours}
            />
          </div>
        </div>

        {/* total credit hours — maintained automatically as lecture + tutorial + practical */}
        <div className="sm:col-span-2 flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-textNormal">Total credit hours</span>
          <p className="flex h-11 items-center rounded-button border border-divider bg-hoverBg px-md text-[13.5px] font-semibold text-textNormal">
            {(
              Math.round(
                (Number(form.lectureHours) +
                  Number(form.tutorialHours) +
                  Number(form.practicalHours)) *
                  10,
              ) / 10
            ).toFixed(1)}
            <span
              className="ml-xs min-w-0 flex-1 truncate text-[11.5px] font-medium text-textSecondary"
              title="= lecture + tutorial + practical (auto)"
            >
              = lecture + tutorial + practical (auto)
            </span>
          </p>
        </div>

        {/* class size & splitting — required counts + flexible rules */}
        <ClassSplittingSection
          form={form}
          set={set}
          markBlurred={markBlurred}
          errors={errors}
          tutorialLimit={tutorialLimit}
          practicalLimit={practicalLimit}
          sumWarning={errors.studentSum}
          sectionRef={sectionRef}
          tutorialGroups={split.tutorialGroups}
          practicalGroups={split.practicalGroups}
          totalGroups={split.totalGroups}
        />

        <Field label="Status">
          <FilterSelect
            ariaLabel="Select status"
            value={form.isActive ? "active" : "inactive"}
            onChange={(v) => set("isActive", v === "active")}
            fullWidth
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </FilterSelect>
        </Field>
      </div>

      <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </DialogShell>
  );
}

/* ── ADD / EDIT PROGRAMME ────────────────────────────────────────────────── */

interface ProgrammeForm {
  code: string;
  name: string;
  departmentCode: string;
  level: string;
  durationYears: string;
  isActive: boolean;
}

const PROGRAMME_CODE_DUP =
  "This programme code is already registered — duplicate programme codes are not allowed.";

function ProgrammeDialogInner({
  form,
  set,
  setBlurredKey,
  errors,
  departments,
}: {
  form: ProgrammeForm;
  set: (k: keyof ProgrammeForm, v: string | boolean) => void;
  setBlurredKey: (k: string) => void;
  errors: Record<string, string | null>;
  departments: DepartmentOption[];
}) {
  return (
    <>
      <div className="mt-lg grid grid-cols-1 gap-x-md gap-y-lg sm:grid-cols-2">
        {/* code */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-textNormal">Programme code</span>
          <input
            type="text"
            value={form.code}
            onChange={(e) => set("code", sanitizeCode(e.target.value).slice(0, 10))}
            onBlur={() => setBlurredKey("code")}
            maxLength={10}
            placeholder="e.g. DSF"
            className={`${INPUT_CLS} ${errors.code ? "border-error ring-2 ring-errorLight" : ""}`}
          />
          {errors.code && <FieldError text={errors.code} />}
        </label>
        {/* name */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-textNormal">Programme name</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={200}
            placeholder="e.g. Diploma in Software Engineering"
            className={`${INPUT_CLS} ${errors.name ? "border-error ring-2 ring-errorLight" : ""}`}
          />
          {errors.name && <FieldError text={errors.name} />}
        </label>

        <Field label="Department">
          <FilterSelect
            ariaLabel="Select department"
            value={form.departmentCode}
            onChange={(v) => set("departmentCode", v)}
            fullWidth
          >
            {departments.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} · {d.name}
              </option>
            ))}
          </FilterSelect>
        </Field>
        <Field label="Level">
          <FilterSelect
            ariaLabel="Select level"
            value={form.level}
            onChange={(v) => set("level", v)}
            fullWidth
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </FilterSelect>
        </Field>

        {/* duration */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-textNormal">Duration (years)</span>
          <input
            type="text"
            inputMode="numeric"
            value={form.durationYears}
            onChange={(e) => set("durationYears", sanitizeInt(e.target.value))}
            onBlur={() => setBlurredKey("durationYears")}
            maxLength={2}
            className={`${INPUT_CLS} ${
              errors.durationYears ? "border-error ring-2 ring-errorLight" : ""
            }`}
          />
          {errors.durationYears && <FieldError text={errors.durationYears} />}
        </label>
        <Field label="Status">
          <FilterSelect
            ariaLabel="Select status"
            value={form.isActive ? "active" : "inactive"}
            onChange={(v) => set("isActive", v === "active")}
            fullWidth
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </FilterSelect>
        </Field>
      </div>
    </>
  );
}

function AddProgrammeDialog({
  programmes,
  departments,
  onClose,
  onSaved,
}: {
  programmes: ProgrammeRow[];
  departments: DepartmentOption[];
  onClose: () => void;
  onSaved: (toast: string) => void;
}) {
  const [form, setForm] = useState<ProgrammeForm>({
    code: "",
    name: "",
    departmentCode: departments[0]?.code ?? "DCIT",
    level: "Diploma",
    durationYears: "3",
    isActive: true,
  });
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [blurred, setBlurred] = useState<Set<string>>(new Set());
  const [serverDupe, setServerDupe] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof ProgrammeForm, v: string | boolean) => {
    if (k === "code") setServerDupe(false);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setBlurredKey = (k: string) => setBlurred((s) => new Set(s).add(k));

  /* live duplicate probe on the code */
  const codeDupe =
    form.code !== "" &&
    programmes.some((p) => p.programmeCode.toUpperCase() === form.code.toUpperCase());

  const errors = useMemo(() => {
    const e: Record<string, string | null> = { code: null, name: null, durationYears: null };
    if ((attempted || blurred.has("code")) && !P_CODE_RE.test(form.code)) {
      e.code = form.code
        ? "Programme code must be 2–10 letters or digits (no spaces)."
        : "Please enter the programme code.";
    }
    if (attempted && !form.name.trim()) e.name = "Please enter the programme name.";
    if (attempted || blurred.has("durationYears")) {
      const d = Number(form.durationYears);
      if (!Number.isInteger(d) || d < 1 || d > 8)
        e.durationYears = "Duration must be a whole number of years between 1 and 8.";
    }
    return e;
  }, [form, attempted, blurred]);

  const codeError = codeDupe ? PROGRAMME_CODE_DUP : errors.code;
  const fieldBlocked = errors.name !== null || errors.durationYears !== null || codeDupe || codeError !== null;

  const save = async () => {
    setServerDupe(false);
    if (!attempted) setAttempted(true);
    if (fieldBlocked) return;
    setSaving(true);
    try {
      const r = await apiFetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programmeCode: form.code,
          programmeName: form.name.trim(),
          departmentCode: form.departmentCode,
          level: form.level,
          durationYears: Number(form.durationYears),
          isActive: form.isActive,
        }),
      });
      const d = await r.json();
      if (r.status === 201 && d.ok) {
        onSaved(
          `Programme ${form.code} (${form.name.trim()}) has been created successfully.`,
        );
      } else if (r.status === 409) {
        setServerDupe(true);
      } else {
        console.error("[AddProgrammeDialog] create failed:", d);
      }
    } catch (err) {
      console.error("[AddProgrammeDialog] create error:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell onClose={onClose} width="max-w-[640px]">
      <DialogHeader
        title="Add programme"
        subtitle="Create a programme record with its department, level and duration."
        onClose={onClose}
      />
      <ProgrammeDialogInner
        form={form}
        set={set}
        setBlurredKey={setBlurredKey}
        errors={{ ...errors, code: codeError }}
        departments={departments}
      />
      <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {saving ? "Adding…" : "Add programme"}
        </button>
      </div>
    </DialogShell>
  );
}

function EditProgrammeDialog({
  programme,
  departments,
  onClose,
  onSaved,
}: {
  programme: ProgrammeRow;
  departments: DepartmentOption[];
  onClose: () => void;
  onSaved: (toast: string) => void;
}) {
  const [form, setForm] = useState<ProgrammeForm>({
    code: programme.programmeCode,
    name: programme.programmeName,
    departmentCode: programme.department,
    level: programme.level ?? "Diploma",
    durationYears: programme.durationYears ? String(programme.durationYears) : "3",
    isActive: programme.isActive,
  });
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [blurred, setBlurred] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof ProgrammeForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setBlurredKey = (k: string) => setBlurred((s) => new Set(s).add(k));

  const errors = useMemo(() => {
    const e: Record<string, string | null> = { code: null, name: null, durationYears: null };
    if (attempted && !form.name.trim()) e.name = "Please enter the programme name.";
    if (attempted || blurred.has("durationYears")) {
      const d = Number(form.durationYears);
      if (!Number.isInteger(d) || d < 1 || d > 8)
        e.durationYears = "Duration must be a whole number of years between 1 and 8.";
    }
    return e;
  }, [form, attempted, blurred]);

  const save = async () => {
    if (!attempted) setAttempted(true);
    if (errors.name !== null || errors.durationYears !== null) return;
    setSaving(true);
    try {
      const r = await apiFetch(`/api/programmes/${form.code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programmeName: form.name.trim(),
          departmentCode: form.departmentCode,
          level: form.level,
          durationYears: Number(form.durationYears),
          isActive: form.isActive,
        }),
      });
      const d = await r.json();
      if (r.status === 200 && d.ok) {
        onSaved(
          `Programme ${form.code} (${form.name.trim()}) has been updated successfully.`,
        );
      } else {
        console.error("[EditProgrammeDialog] update failed:", d);
      }
    } catch (err) {
      console.error("[EditProgrammeDialog] update error:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell onClose={onClose} width="max-w-[640px]">
      <DialogHeader
        title="Edit programme"
        subtitle={`Maintaining ${programme.programmeCode} — programme codes are permanent.`}
        onClose={onClose}
      />
      <ProgrammeDialogInner
        form={form}
        set={set}
        setBlurredKey={setBlurredKey}
        errors={{
          ...errors,
          code: "Programme codes are permanent — to change the code, create a new programme.",
        }}
        departments={departments}
      />
      <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </DialogShell>
  );
}

/**
 * CLASS-SIZE RULES CARD — the flexible class_size_rules limits, placed
 * below the course roster exactly like the Lecturers page's Hour-limit
 * rules card. A class over its limit splits into groups; each class type
 * carries one editable per-class student limit (1–200), saving PATCHes
 * /api/class-size-rules and every group derivation on the page re-resolves.
 */
function ClassSizeRulesSection({
  rules,
  onSaved,
}: {
  rules: ClassSizeRule[];
  onSaved: (rules: ClassSizeRule[]) => void;
}) {
  const tutorialRule = rules.find((r) => r.classType === "TUTORIAL");
  const practicalRule = rules.find((r) => r.classType === "PRACTICAL");

  /** draft copies — resynced whenever fresh rule values arrive */
  const [drafts, setDrafts] = useState({
    tutorial: String(tutorialRule?.limitStudents ?? DEFAULT_TUTORIAL_LIMIT),
    practical: String(practicalRule?.limitStudents ?? DEFAULT_PRACTICAL_LIMIT),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDrafts({
      tutorial: String(tutorialRule?.limitStudents ?? DEFAULT_TUTORIAL_LIMIT),
      practical: String(practicalRule?.limitStudents ?? DEFAULT_PRACTICAL_LIMIT),
    });
  }, [tutorialRule, practicalRule]);

  /* limit sanity: whole count 1–200 (the DB CHECK hard-caps at 500) */
  const limitState = (raw: string, stored: number | null) => {
    const n = Number(raw);
    const valid = raw !== "" && Number.isInteger(n) && n >= 1 && n <= 200;
    const changed = stored === null || n !== stored;
    return { n, valid, changed };
  };
  const tState = limitState(drafts.tutorial, tutorialRule?.limitStudents ?? null);
  const pState = limitState(drafts.practical, practicalRule?.limitStudents ?? null);
  const anyInvalid = !tState.valid || !pState.valid;
  const anyChanged = tState.changed || pState.changed;

  /* live row messages — digits-only input means only an out-of-range or
     half-typed count can be invalid; empty drafts stay neutral */
  const tMessage =
    drafts.tutorial !== "" && !tState.valid
      ? "Whole numbers only — 1–200 students per class."
      : null;
  const pMessage =
    drafts.practical !== "" && !pState.valid
      ? "Whole numbers only — 1–200 students per class."
      : null;

  /* clear the saved flash as soon as a draft drifts from the stored rules */
  useEffect(() => {
    if (anyChanged) setSavedFlash(false);
  }, [anyChanged]);

  const save = async () => {
    if (anyInvalid || !anyChanged) return;
    setError(null);
    setSaving(true);
    try {
      const r = await apiFetch("/api/class-size-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorialLimit: tState.n, practicalLimit: pState.n }),
      });
      const d = await r.json();
      if (r.status === 200 && d.ok) {
        onSaved(d.rules as ClassSizeRule[]);
        setSavedFlash(true);
      } else {
        setError((d as { message?: string }).message ?? "Could not save the class-size rules.");
      }
    } catch (err) {
      console.error("[ClassSizeRulesSection] save error:", err);
      setError("Network error while saving the class-size rules.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (bad: boolean) =>
    /* w-0 + min-w-full — the input stretches to exactly the reserved line's
       rendered label width ("Max students per class"), no hardcoded px */
    `h-10 w-0 min-w-full rounded-button border bg-background px-sm text-center text-[13px] text-text outline-none transition-colors ${
      bad
        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
        : "border-divider focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primaryLight"
    }`;

  const statusKey = error
    ? "error"
    : anyInvalid
      ? "invalid"
      : savedFlash
        ? "saved"
        : anyChanged
          ? "changed"
          : "idle";

  return (
    <section className="animate-[rowIn_0.26s_ease-out_0.24s_both] mt-lg overflow-hidden rounded-card bg-surface shadow-card">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-sm border-b border-divider px-lg py-md">
        <div>
          <h2 className="text-[15px] font-bold leading-[22px] text-text">Class-size rules</h2>
          <p className="mt-[2px] text-[12px] text-textSecondary">
            How many students a tutorial / practical class may hold — a class over its limit
            splits into groups, and every course&apos;s Groups derive from these numbers. Numbers
            only, 1–200 students per class — flexible at any time.
          </p>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="px-lg py-md text-[13px] text-textSecondary">Rules load with the course list…</p>
      ) : (
        <div>
          {/* tutorial row */}
          <div className="border-b border-divider px-lg py-sm">
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-text">Tutorial classes</p>
                <p className="mt-[2px] text-[11.5px] text-textSecondary">
                  e.g. 58 tutorial students at a limit of {tutorialRule?.limitStudents ?? DEFAULT_TUTORIAL_LIMIT} split
                  into {ceilGroups(58, tutorialRule?.limitStudents ?? DEFAULT_TUTORIAL_LIMIT)} groups —
                  applies to every course.
                </p>
              </div>
              <label className="flex w-max flex-col gap-1">
                <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                  Max students per class
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={drafts.tutorial}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, tutorial: sanitizeInt(e.target.value) }))
                  }
                  maxLength={3}
                  className={inputCls(tMessage !== null)}
                />
              </label>
            </div>
            {tMessage && (
              <p className="animate-[badgeIn_0.2s_ease-out_both] mt-1 text-[11.5px] font-medium text-errorText">
                {tMessage}
              </p>
            )}
          </div>

          {/* practical row */}
          <div className="border-b border-divider px-lg py-sm last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-text">Practical classes</p>
                <p className="mt-[2px] text-[11.5px] text-textSecondary">
                  e.g. 45 practical students at a limit of {practicalRule?.limitStudents ?? DEFAULT_PRACTICAL_LIMIT} split
                  into {ceilGroups(45, practicalRule?.limitStudents ?? DEFAULT_PRACTICAL_LIMIT)} groups —
                  applies to every course.
                </p>
              </div>
              <label className="flex w-max flex-col gap-1">
                <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                  Max students per class
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={drafts.practical}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, practical: sanitizeInt(e.target.value) }))
                  }
                  maxLength={3}
                  className={inputCls(pMessage !== null)}
                />
              </label>
            </div>
            {pMessage && (
              <p className="animate-[badgeIn_0.2s_ease-out_both] mt-1 text-[11.5px] font-medium text-errorText">
                {pMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {/* footer: status + green save */}
      <div className="flex flex-wrap items-center justify-between gap-sm border-t border-divider px-lg py-md">
        <p
          key={statusKey}
          className="animate-[badgeIn_0.25s_ease-out_both] text-[12px] text-textSecondary"
        >
          {error ? (
            <span className="font-medium text-errorText">{error}</span>
          ) : anyInvalid ? (
            "Fix the highlighted limits before saving."
          ) : savedFlash ? (
            <span className="font-medium text-successText">
              Class-size rules saved — group counts updated everywhere.
            </span>
          ) : anyChanged ? (
            "Unsaved changes — every course's group counts update after saving."
          ) : (
            "Changing a limit retunes how every course's classes split into groups."
          )}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={saving || !anyChanged || anyInvalid}
          className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? "Saving…" : "Save rules"}
        </button>
      </div>
    </section>
  );
}

/* ── DELETE GUARDS ───────────────────────────────────────────────────────── */

/** Delete course — refused by the API while workload details reference it */
function DeleteCourseDialog({
  course,
  onClose,
  onDeleted,
}: {
  course: CourseRow;
  onClose: () => void;
  onDeleted: (toast: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/courses/${course.subjectCode}`, {
        method: "DELETE",
      });
      const d = await r.json();
      if (r.status === 200 && d.ok) {
        onDeleted(`Course ${course.subjectCode} (${course.subjectName}) has been deleted successfully.`);
      } else {
        setError(
          d.message ??
            "The course could not be deleted — it is still referenced by assignment records.",
        );
      }
    } catch (err) {
      console.error("[DeleteCourseDialog] delete error:", err);
      setError("The course could not be deleted — a network error occurred.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell onClose={onClose} width="max-w-[440px]">
      <DialogHeader title="Delete course" subtitle="This action is permanent and cannot be undone." onClose={onClose} />

      {/* identity recap */}
      <div className="mt-lg rounded-card border border-divider bg-background p-md">
        <p className="text-[14px] font-semibold text-text">
          {course.subjectCode} · {course.subjectName}
        </p>
        <p className="mt-[2px] text-[12.5px] text-textSecondary">
          {course.programmeCode ?? "—"} · {course.academicYearLabel} · {course.totalHours}h total
        </p>
      </div>

      <p className="mt-md text-[12.5px] leading-snug text-textNormal">
        The record is immediately removed from the catalogue. However,{" "}
        <span className="font-medium text-errorText">
          courses referenced by workload details cannot be deleted.
        </span>{" "}
        In such cases, the system prevents deletion until those assignments are removed.
      </p>

      {error && (
        <p className="animate-[badgeIn_0.2s_ease-out_both] mt-md flex items-center gap-xs text-[12.5px] font-medium text-errorText">
          <TriangleAlert size={13} className="shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirmDelete}
          disabled={busy}
          className="flex h-10 items-center gap-xs rounded-button bg-error px-lg text-[13px] font-semibold text-white transition-colors hover:bg-errorText disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {busy ? "Deleting…" : "Delete course"}
        </button>
      </div>
    </DialogShell>
  );
}

/** Delete programme — refused by the API while courses still reference it */
function DeleteProgrammeDialog({
  programme,
  onClose,
  onDeleted,
}: {
  programme: ProgrammeRow;
  onClose: () => void;
  onDeleted: (toast: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/programmes/${programme.programmeCode}`, {
        method: "DELETE",
      });
      const d = await r.json();
      if (r.status === 200 && d.ok) {
        onDeleted(
          `Programme ${programme.programmeCode} (${programme.programmeName}) has been deleted successfully.`,
        );
      } else {
        setError(d.message ?? "The programme could not be deleted.");
      }
    } catch (err) {
      console.error("[DeleteProgrammeDialog] delete error:", err);
      setError("The programme could not be deleted — a network error occurred.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell onClose={onClose} width="max-w-[440px]">
      <DialogHeader
        title="Delete programme"
        subtitle="This action is permanent and cannot be undone."
        onClose={onClose}
      />

      {/* identity recap */}
      <div className="mt-lg rounded-card border border-divider bg-background p-md">
        <p className="text-[14px] font-semibold text-text">
          {programme.programmeCode} · {programme.programmeName}
        </p>
        <p className="mt-[2px] text-[12.5px] text-textSecondary">
          {programme.department} · {programme.level ?? "No level"}
          {programme.durationYears ? ` · ${programme.durationYears} yr` : ""}
          {programme.subjectCount > 0 ? ` · ${programme.subjectCount} course(s)` : ""}
        </p>
      </div>

      <p className="mt-md text-[12.5px] leading-snug text-textNormal">
        The record is immediately removed from the directory. However,{" "}
        <span className="font-medium text-errorText">
          programmes with existing courses cannot be deleted.
        </span>{" "}
        In such cases, the system prevents deletion until its courses are reassigned or removed.
      </p>

      {error && (
        <p className="animate-[badgeIn_0.2s_ease-out_both] mt-md flex items-center gap-xs text-[12.5px] font-medium text-errorText">
          <TriangleAlert size={13} className="shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirmDelete}
          disabled={busy}
          className="flex h-10 items-center gap-xs rounded-button bg-error px-lg text-[13px] font-semibold text-white transition-colors hover:bg-errorText disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {busy ? "Deleting…" : "Delete programme"}
        </button>
      </div>
    </DialogShell>
  );
}

/* ── PAGE ────────────────────────────────────────────────────────────────── */

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [programmes, setProgrammes] = useState<ProgrammeRow[]>([]);
  const [programmeOptions, setProgrammeOptions] = useState<ProgrammeOption[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [classSizeRules, setClassSizeRules] = useState<ClassSizeRule[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"courses" | "programmes">("courses");

  /* course filters */
  const [courseQuery, setCourseQuery] = useState("");
  const [courseProgramme, setCourseProgramme] = useState("all");
  const [courseAcademicYear, setCourseAcademicYear] = useState("all");
  const [courseStatus, setCourseStatus] = useState<Triage>("all");
  const [courseSorts, setCourseSorts] = useState<SortCriterion<CourseSortKey>[]>([
    { key: "course", direction: "asc" },
  ]);

  /* programme filters */
  const [progQuery, setProgQuery] = useState("");
  const [progLevel, setProgLevel] = useState("all");
  const [progStatus, setProgStatus] = useState<Triage>("all");
  const [progSorts, setProgSorts] = useState<SortCriterion<ProgrammeSortKey>[]>([
    { key: "programme", direction: "asc" },
  ]);

  /* dialogs */
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseRow | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<CourseRow | null>(null);
  const [addProgrammeOpen, setAddProgrammeOpen] = useState(false);
  const [editingProgramme, setEditingProgramme] = useState<ProgrammeRow | null>(null);
  const [deletingProgramme, setDeletingProgramme] = useState<ProgrammeRow | null>(null);

  /** bumps after every save — refetches + replays the row glide-in */
  const [reloadTick, setReloadTick] = useState(0);
  /** green completion toast — fired after create / update / delete */
  const [itemToast, setItemToast] = useState<string | null>(null);

  /* floating anchor: course list ⇄ Class-size rules card. Fixed to the
     viewport and never scrolls away; the label flips as soon as the card
     climbs into the upper half of the screen — via a click's smooth
     arrival OR the user's own manual scroll (a wheel/scrollbar event
     listener plus a light periodic check so the flip always follows the
     real position). The card sits near the page's end where its top can
     never reach the very top of the window, so a fixed "top <= 120px"
     test would never fire on shorter pages — half-viewport is the
     length-independent rule. */
  const rulesAnchorRef = useRef<HTMLDivElement | null>(null);
  const [atRules, setAtRules] = useState(false);
  const navigatingRef = useRef(false);

  useEffect(() => {
    const update = () => {
      if (navigatingRef.current) return;
      const el = rulesAnchorRef.current;
      if (!el) return;
      setAtRules(el.getBoundingClientRect().top <= window.innerHeight * 0.5);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    /* manual scrolling through some paths never reaches the window's
       scroll event — polling keeps the label glued to the position */
    const poll = window.setInterval(update, 150);
    return () => {
      window.removeEventListener("scroll", update);
      window.clearInterval(poll);
    };
  }, []);

  const jumpRulesOrTop = () => {
    navigatingRef.current = true;
    setAtRules(!atRules); /* label flips immediately to the destination */
    if (atRules) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      rulesAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    /* hold the scroll-driven flips while the smooth navigation settles */
    window.setTimeout(() => {
      navigatingRef.current = false;
    }, 700);
  };

  useEffect(() => {
    setError(null);
    Promise.all([
      apiFetch("/api/courses")
        .then((r) => r.json())
        .catch(() => null),
      apiFetch("/api/programmes")
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([c, p]) => {
      let failed = false;
      if (c && c.ok) {
        setCourses(c.courses as CourseRow[]);
        setProgrammeOptions(c.programmes as ProgrammeOption[]);
        setAcademicYears(c.academicYears as AcademicYearOption[]);
        setClassSizeRules((c.classSizeRules ?? []) as ClassSizeRule[]);
      } else {
        failed = true;
      }
      if (p && p.ok) {
        setProgrammes(p.programmes as ProgrammeRow[]);
        setDepartments(p.departments as DepartmentOption[]);
      } else {
        failed = true;
      }
      if (failed) {
        setError("Course & programme directory unavailable — check the API connection.");
      }
    });
  }, [reloadTick]);

  /* live course filter: status chip + programme + search */
  const matchedCourses = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    return courses.filter((c) => {
      if (courseStatus === "active" && !c.isActive) return false;
      if (courseStatus === "inactive" && c.isActive) return false;
      if (courseProgramme !== "all" && c.programmeCode !== courseProgramme) return false;
      if (courseAcademicYear !== "all" && String(c.academicYearId) !== courseAcademicYear) return false;
      if (!q) return true;
      return (
        c.subjectName.toLowerCase().includes(q) ||
        c.subjectCode.toLowerCase().includes(q) ||
        (c.programmeName ?? "").toLowerCase().includes(q)
      );
    });
  }, [courses, courseAcademicYear, courseQuery, courseProgramme, courseStatus]);

  const matchedProgrammes = useMemo(() => {
    const q = progQuery.trim().toLowerCase();
    return programmes.filter((p) => {
      if (progStatus === "active" && !p.isActive) return false;
      if (progStatus === "inactive" && p.isActive) return false;
      if (progLevel !== "all" && p.level !== progLevel) return false;
      if (!q) return true;
      return (
        p.programmeName.toLowerCase().includes(q) ||
        p.programmeCode.toLowerCase().includes(q) ||
        (p.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [programmes, progQuery, progLevel, progStatus]);

  const sortedCourses = useMemo(
    () => sortByCriteria(matchedCourses, courseSorts, COURSE_SORTERS, compareCourseIdentity),
    [matchedCourses, courseSorts],
  );
  const sortedProgrammes = useMemo(
    () => sortByCriteria(matchedProgrammes, progSorts, PROGRAMME_SORTERS, compareProgrammeIdentity),
    [matchedProgrammes, progSorts],
  );

  const { bodyRef: courseBodyRef, prepareAnimation: prepareCourseSortAnimation } =
    useTableSortAnimation<HTMLDivElement>(sortedCourses);
  const { bodyRef: programmeBodyRef, prepareAnimation: prepareProgrammeSortAnimation } =
    useTableSortAnimation<HTMLDivElement>(sortedProgrammes);

  const toggleCourseSort = (key: CourseSortKey) => {
    prepareCourseSortAnimation();
    setCourseSorts((current) => toggleSortCriterion(current, key));
  };
  const toggleProgrammeSort = (key: ProgrammeSortKey) => {
    prepareProgrammeSortAnimation();
    setProgSorts((current) => toggleSortCriterion(current, key));
  };
  const courseSortDirection = (key: CourseSortKey) =>
    courseSorts.find((criterion) => criterion.key === key)?.direction ?? null;
  const courseSortPriority = (key: CourseSortKey) => {
    const index = courseSorts.findIndex((criterion) => criterion.key === key);
    return index < 0 ? undefined : index + 1;
  };
  const programmeSortDirection = (key: ProgrammeSortKey) =>
    progSorts.find((criterion) => criterion.key === key)?.direction ?? null;
  const programmeSortPriority = (key: ProgrammeSortKey) => {
    const index = progSorts.findIndex((criterion) => criterion.key === key);
    return index < 0 ? undefined : index + 1;
  };
  const courseSortSummary = courseSorts.length
    ? `Sorting priority: ${courseSorts.map((criterion, index) => `${index + 1}. ${COURSE_SORT_LABELS[criterion.key]} ${criterion.direction === "asc" ? "ascending" : "descending"}`).join("; ")}. Later columns break ties.`
    : "No course sorting applied. The original directory order is shown.";
  const programmeSortSummary = progSorts.length
    ? `Sorting priority: ${progSorts.map((criterion, index) => `${index + 1}. ${PROGRAMME_SORT_LABELS[criterion.key]} ${criterion.direction === "asc" ? "ascending" : "descending"}`).join("; ")}. Later columns break ties.`
    : "No programme sorting applied. The original directory order is shown.";

  const courseCounts = useMemo(
    () => ({
      total: courses.length,
      active: courses.filter((c) => c.isActive).length,
      inactive: courses.filter((c) => !c.isActive).length,
    }),
    [courses],
  );
  const programmeCounts = useMemo(
    () => ({
      total: programmes.length,
      active: programmes.filter((p) => p.isActive).length,
      inactive: programmes.filter((p) => !p.isActive).length,
    }),
    [programmes],
  );

  /* per-programme total credit hours — the sum of its courses' totals
     (recomputed client-side from the loaded course list) */
  const creditHoursByProgramme = useMemo(() => {
    const map: Record<string, number> = {};
    courses.forEach((c) => {
      if (!c.programmeCode) return;
      const current = Number(map[c.programmeCode] ?? 0);
      map[c.programmeCode] =
        Math.round((current + Number(c.totalHours)) * 10) / 10;
    });
    return map;
  }, [courses]);

  /* Filter/search/save changes replay row entry. Sort changes deliberately do
     not remount rows, allowing the FLIP transition to move them in place. */
  const listSignature =
    view === "courses"
      ? `${view}|${courseStatus}|${courseProgramme}|${courseAcademicYear}|${courseQuery}|${reloadTick}`
      : `${view}|${progStatus}|${progLevel}|${progQuery}|${reloadTick}`;

  /** shared save handler — closes nothing itself; dialogs close via onSaved */
  const afterSave = (toast: string, reset: () => void) => {
    reset();
    setReloadTick((t) => t + 1);
    window.dispatchEvent(new Event("tw:rail:refresh"));
    setItemToast(toast);
  };

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      {/* heading */}
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div className="animate-[rowIn_0.26s_ease-out_both]">
          <h1 className="text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">
            Courses &amp; Programmes
          </h1>
          <p className="mt-1 text-[13px] text-textSecondary">
            {view === "courses"
              ? `Course catalogue & hour components · ${courseCounts.total} course${courseCounts.total === 1 ? "" : "s"} in ${programmes.length || 0} programme${programmes.length === 1 ? "" : "s"}`
              : `Programme directory & course census · ${programmeCounts.total} programme${programmeCounts.total === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="animate-[badgeIn_0.25s_ease-out_0.1s_both] flex items-center gap-sm">
          <ViewSwitch
            view={view}
            onChange={setView}
            coursesCount={courseCounts.total}
            programmesCount={programmeCounts.total}
          />
          <button
            type="button"
            onClick={() =>
              view === "courses" ? setAddCourseOpen(true) : setAddProgrammeOpen(true)
            }
            title={view === "courses" ? "Add a course" : "Add a programme"}
            className="flex h-11 items-center gap-xs rounded-button bg-primary px-md text-[13px] font-medium text-white shadow-card transition-all hover:bg-primaryHover active:scale-95"
          >
            <Plus size={16} />
            {view === "courses" ? "Add Course" : "Add Programme"}
          </button>
        </div>
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
      {view === "courses" ? (
        <div className="mt-lg flex flex-wrap items-center gap-sm">
          <TriageChip
            label="All"
            count={courseCounts.total}
            delay={0}
            active={courseStatus === "all"}
            onClick={() => setCourseStatus("all")}
          />
          <TriageChip
            label="Active"
            count={courseCounts.active}
            delay={60}
            active={courseStatus === "active"}
            onClick={() => setCourseStatus("active")}
          />
          <TriageChip
            label="Inactive"
            count={courseCounts.inactive}
            delay={120}
            active={courseStatus === "inactive"}
            onClick={() => setCourseStatus("inactive")}
          />
          <div className="animate-[rowIn_0.26s_ease-out_0.18s_both] relative z-20 ml-auto flex w-full flex-wrap items-center gap-sm sm:w-auto">
            <CompactFilterSelect
              ariaLabel="Filter by programme"
              value={courseProgramme}
              onChange={setCourseProgramme}
            >
              <option value="all">All programmes</option>
              {programmeOptions.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.code} · {p.name}
                </option>
              ))}
            </CompactFilterSelect>
            <CompactFilterSelect
              ariaLabel="Filter courses by academic year term"
              value={courseAcademicYear}
              onChange={setCourseAcademicYear}
              menuWidth={260}
            >
              <option value="all">All academic years</option>
              {Array.from(new Set(academicYears.map((term) => term.yearCode))).map((yearCode) => (
                <optgroup key={yearCode} label={`AY ${yearCode}`}>
                  {academicYears
                    .filter((term) => term.yearCode === yearCode)
                    .map((term) => (
                      <option key={term.id} value={String(term.id)}>{term.label}</option>
                    ))}
                </optgroup>
              ))}
            </CompactFilterSelect>
            <div className="flex w-full min-w-0 items-center gap-sm sm:w-auto">
              <button type="button"
                onClick={() => { prepareCourseSortAnimation(); setCourseSorts([]); }}
                disabled={courseSorts.length === 0}
                className="flex h-9 items-center gap-xs whitespace-nowrap rounded-badge px-md text-[12.5px] transition-colors border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg">
                Clear Sort
              </button>
              <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-textSecondary"
                />
                <input
                  type="text"
                  value={courseQuery}
                  onChange={(e) => setCourseQuery(e.target.value)}
                  placeholder="Search code, name, programme…"
                  className="h-11 w-full rounded-button border border-divider bg-surface pl-10 pr-md text-[13.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-lg flex flex-wrap items-center gap-sm">
          <TriageChip
            label="All"
            count={programmeCounts.total}
            delay={0}
            active={progStatus === "all"}
            onClick={() => setProgStatus("all")}
          />
          <TriageChip
            label="Active"
            count={programmeCounts.active}
            delay={60}
            active={progStatus === "active"}
            onClick={() => setProgStatus("active")}
          />
          <TriageChip
            label="Inactive"
            count={programmeCounts.inactive}
            delay={120}
            active={progStatus === "inactive"}
            onClick={() => setProgStatus("inactive")}
          />
          <div className="animate-[rowIn_0.26s_ease-out_0.18s_both] relative z-20 ml-auto flex w-full flex-wrap items-center gap-sm sm:w-auto">
            <FilterSelect ariaLabel="Filter by level" value={progLevel} onChange={setProgLevel}>
              <option value="all">All levels</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </FilterSelect>
            <div className="flex w-full min-w-0 items-center gap-sm sm:w-auto">
              <button type="button"
                onClick={() => { prepareProgrammeSortAnimation(); setProgSorts([]); }}
                disabled={progSorts.length === 0}
                className="flex h-9 items-center gap-xs whitespace-nowrap rounded-badge px-md text-[12.5px] transition-colors border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg">
                Clear Sort
              </button>
              <div className="relative min-w-0 flex-1 sm:w-[260px] sm:flex-none">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-textSecondary"
                />
                <input
                  type="text"
                  value={progQuery}
                  onChange={(e) => setProgQuery(e.target.value)}
                  placeholder="Search code, name, department…"
                  className="h-11 w-full rounded-button border border-divider bg-surface pl-10 pr-md text-[13.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <p id="catalogue-sort-help" className="sr-only">
        Use the Academic Year term list to filter courses. Click sortable column headers to combine sorts; later columns break ties. Use Clear Sort to start again.
      </p>
      <p id="catalogue-sort-summary" className="sr-only" aria-live="polite" aria-atomic="true">
        {view === "courses" ? courseSortSummary : programmeSortSummary}
      </p>

      {/* roster list */}
      <div className="mt-md overflow-hidden rounded-card bg-surface shadow-card">
        {view === "courses" ? (
          <>
            {/* shared grid table — the header and every row reuse COURSE_GRID
                so cells always align; long text wraps inside its column, and
                narrower windows scroll the table instead of squeezing it */}
            <div className="overflow-x-auto">
              <div className="min-w-[1080px]">
                {/* header — identical grid template as the rows below */}
                <div className={`${COURSE_GRID} border-b border-divider bg-surface px-lg py-sm`}>
                  <SortableGridHeader label="Course" direction={courseSortDirection("course")}
                    priority={courseSortPriority("course")} onSort={() => toggleCourseSort("course")}
                    description="Sort by course code, then course name" />
                  <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                    Programme
                  </p>
                  <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                    Academic Year
                  </p>
                  <SortableGridHeader label="Hours (L · T · P)" direction={courseSortDirection("hours")}
                    priority={courseSortPriority("hours")} onSort={() => toggleCourseSort("hours")}
                    description="Sort by total credit hours" />
                  <SortableGridHeader label="Students" direction={courseSortDirection("students")}
                    priority={courseSortPriority("students")} onSort={() => toggleCourseSort("students")} />
                  <SortableGridHeader label="Status" direction={courseSortDirection("status")}
                    priority={courseSortPriority("status")} onSort={() => toggleCourseSort("status")}
                    description="Ascending places active courses first" />
                  <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                    Actions
                  </p>
                </div>

                <div ref={courseBodyRef} key={listSignature}>
                  {courses.length === 0 && !error ? (
                    <div className="animate-[rowIn_0.26s_ease-out_both] flex items-center gap-sm px-lg py-xl">
                      <BookOpen size={18} className="shrink-0 text-textSecondary" />
                      <p className="text-[13px] text-textSecondary">Loading courses from PostgreSQL…</p>
                    </div>
                  ) : sortedCourses.length === 0 ? (
                    <div className="animate-[rowIn_0.26s_ease-out_both] px-lg py-xl text-center">
                      <p className="text-[14px] font-medium text-textNormal">No course found</p>
                      <p className="mt-1 text-[12.5px] text-textSecondary">
                        No course matches “{courseQuery.trim()}” with the selected filters.
                      </p>
                    </div>
                  ) : (
                    sortedCourses.map((c, i) => (
                      <div
                        key={c.subjectCode}
                        data-sort-motion={`course:${c.subjectCode}`}
                        style={{ animationDelay: `${Math.min(i * 22, 440)}ms` }}
                        className={`${COURSE_GRID} animate-[rowIn_0.26s_ease-out_both] border-b border-divider px-lg py-md transition-colors last:border-b-0 hover:bg-hoverBg/60`}
                      >
                        {/* identity: code + name — wraps within its column */}
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold leading-snug text-text">
                            <span className="text-primary">{c.subjectCode}</span> · {c.subjectName}
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
                          <p className="text-[12.5px] font-medium text-text">{c.studentCount}</p>
                          <p className="text-[11.5px] leading-snug text-textSecondary">
                            in {c.groupCount} group{c.groupCount === 1 ? "" : "s"}
                          </p>
                        </div>

                        <StatusDot active={c.isActive} />

                        {/* row actions stay inside their fixed-width column */}
                        <div className="flex items-center gap-sm">
                          <button
                            type="button"
                            onClick={() => setEditingCourse(c)}
                            title={`Edit ${c.subjectCode}`}
                            aria-label={`Edit ${c.subjectCode}`}
                            className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-primary hover:bg-primaryLight hover:text-primary active:scale-[0.97]"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingCourse(c)}
                            title={`Delete ${c.subjectCode}`}
                            aria-label={`Delete ${c.subjectCode}`}
                            className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-error hover:bg-errorBg hover:text-errorText active:scale-[0.97]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* shared grid table — same template on the header and every row */}
            <div className="overflow-x-auto">
              <div className="min-w-[960px]">
                {/* header — identical grid template as the rows below */}
                <div className={`${PROGRAMME_GRID} border-b border-divider bg-surface px-lg py-sm`}>
                  <SortableGridHeader label="Programme" direction={programmeSortDirection("programme")}
                    priority={programmeSortPriority("programme")} onSort={() => toggleProgrammeSort("programme")}
                    description="Sort by programme code, then programme name" />
                  <SortableGridHeader label="Department" direction={programmeSortDirection("department")}
                    priority={programmeSortPriority("department")} onSort={() => toggleProgrammeSort("department")} />
                  <SortableGridHeader label="Level" direction={programmeSortDirection("level")}
                    priority={programmeSortPriority("level")} onSort={() => toggleProgrammeSort("level")} />
                  <SortableGridHeader label="Duration" direction={programmeSortDirection("duration")}
                    priority={programmeSortPriority("duration")} onSort={() => toggleProgrammeSort("duration")} />
                  <SortableGridHeader label="Courses" direction={programmeSortDirection("courses")}
                    priority={programmeSortPriority("courses")} onSort={() => toggleProgrammeSort("courses")}
                    description="Sort by number of courses" />
                  <SortableGridHeader label="Status" direction={programmeSortDirection("status")}
                    priority={programmeSortPriority("status")} onSort={() => toggleProgrammeSort("status")}
                    description="Ascending places active programmes first" />
                  <p className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
                    Actions
                  </p>
                </div>

                <div ref={programmeBodyRef} key={listSignature}>
                  {programmes.length === 0 && !error ? (
                    <div className="animate-[rowIn_0.26s_ease-out_both] flex items-center gap-sm px-lg py-xl">
                      <GraduationCap size={18} className="shrink-0 text-textSecondary" />
                      <p className="text-[13px] text-textSecondary">
                        Loading programmes from PostgreSQL…
                      </p>
                    </div>
                  ) : sortedProgrammes.length === 0 ? (
                    <div className="animate-[rowIn_0.26s_ease-out_both] px-lg py-xl text-center">
                      <p className="text-[14px] font-medium text-textNormal">No programme found</p>
                      <p className="mt-1 text-[12.5px] text-textSecondary">
                        No programme matches “{progQuery.trim()}” with the selected filters.
                      </p>
                    </div>
                  ) : (
                    sortedProgrammes.map((p, i) => (
                      <div
                        key={p.programmeCode}
                        data-sort-motion={`programme:${p.programmeCode}`}
                        style={{ animationDelay: `${Math.min(i * 22, 440)}ms` }}
                        className={`${PROGRAMME_GRID} animate-[rowIn_0.26s_ease-out_both] border-b border-divider px-lg py-md transition-colors last:border-b-0 hover:bg-hoverBg/60`}
                      >
                        {/* identity: code + name — wraps within its column */}
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold leading-snug text-text">
                            <span className="text-primary">{p.programmeCode}</span> ·{" "}
                            {p.programmeName}
                          </p>
                          <p className="mt-[2px] text-[12px] leading-snug text-textSecondary">
                            {p.durationYears ? `${p.durationYears}-year programme` : "No duration set"}
                          </p>
                        </div>

                        {/* department */}
                        <p className="min-w-0 text-[12.5px] font-medium text-textNormal">
                          {p.department}
                        </p>

                        {/* level */}
                        <div className="min-w-0">
                          <span
                            className={`rounded-badge px-sm py-[2px] text-[10.5px] font-semibold ${
                              p.level === "Bachelor"
                                ? "bg-primaryLight text-primary"
                                : p.level === "Master"
                                  ? "bg-warningBg text-warningText"
                                  : p.level === "Foundation"
                                    ? "bg-hoverBg text-textSecondary"
                                    : "bg-background text-textNormal"
                            }`}
                          >
                            {p.level ?? "—"}
                          </span>
                        </div>

                        {/* duration */}
                        <p className="min-w-0 text-[12.5px] text-textNormal">
                          {p.durationYears ? (
                            `${p.durationYears} yr${p.durationYears === 1 ? "" : "s"}`
                          ) : (
                            "—"
                          )}
                        </p>

                        {/* course census + summed credit hours of its courses */}
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-text">
                            {p.subjectCount} course{p.subjectCount === 1 ? "" : "s"}
                          </p>
                          <p className="text-[11.5px] leading-snug text-textSecondary">
                            Total credit hours{" "}
                            {creditHoursByProgramme[p.programmeCode] ?? 0}
                          </p>
                        </div>

                        <StatusDot active={p.isActive} />

                        {/* row actions stay inside their fixed-width column */}
                        <div className="flex items-center gap-sm">
                          <button
                            type="button"
                            onClick={() => setEditingProgramme(p)}
                            title={`Edit ${p.programmeCode}`}
                            aria-label={`Edit ${p.programmeCode}`}
                            className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-primary hover:bg-primaryLight hover:text-primary active:scale-[0.97]"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingProgramme(p)}
                            title={`Delete ${p.programmeCode}`}
                            aria-label={`Delete ${p.programmeCode}`}
                            className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-error hover:bg-errorBg hover:text-errorText active:scale-[0.97]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* class-size rules card — below the roster like the Lecturers page's
          Hour-limit rules card; also the anchor for the floating jump button */}
      {view === "courses" && (
        <div ref={rulesAnchorRef} className="scroll-mt-[88px]">
          <ClassSizeRulesSection rules={classSizeRules} onSaved={setClassSizeRules} />
        </div>
      )}

      <p className="animate-[rowIn_0.26s_ease-out_0.3s_both] mt-md text-[12px] text-textSecondary">
        {view === "courses"
          ? `Showing ${sortedCourses.length} of ${courseCounts.total} courses — ${courseCounts.active} active · ${courseCounts.inactive} inactive. Total credit hours are maintained automatically as lecture + tutorial + practical.`
          : `Showing ${sortedProgrammes.length} of ${programmeCounts.total} programmes — ${programmeCounts.active} active · ${programmeCounts.inactive} inactive. Deleting a programme is refused while its courses still reference it.`}
      </p>

      {/* course dialogs */}
      {addCourseOpen && (
        <AddCourseDialog
          courses={courses}
          programmes={programmeOptions}
          academicYears={academicYears}
          classSizeRules={classSizeRules}
          onClose={() => setAddCourseOpen(false)}
          onSaved={(toast) =>
            afterSave(toast, () => setAddCourseOpen(false))
          }
        />
      )}
      {editingCourse && (
        <EditCourseDialog
          course={editingCourse}
          programmes={programmeOptions}
          academicYears={academicYears}
          classSizeRules={classSizeRules}
          onClose={() => setEditingCourse(null)}
          onSaved={(toast) =>
            afterSave(toast, () => setEditingCourse(null))
          }
        />
      )}
      {deletingCourse && (
        <DeleteCourseDialog
          course={deletingCourse}
          onClose={() => setDeletingCourse(null)}
          onDeleted={(toast) =>
            afterSave(toast, () => setDeletingCourse(null))
          }
        />
      )}

      {/* programme dialogs */}
      {addProgrammeOpen && (
        <AddProgrammeDialog
          programmes={programmes}
          departments={departments}
          onClose={() => setAddProgrammeOpen(false)}
          onSaved={(toast) =>
            afterSave(toast, () => setAddProgrammeOpen(false))
          }
        />
      )}
      {editingProgramme && (
        <EditProgrammeDialog
          programme={editingProgramme}
          departments={departments}
          onClose={() => setEditingProgramme(null)}
          onSaved={(toast) =>
            afterSave(toast, () => setEditingProgramme(null))
          }
        />
      )}
      {deletingProgramme && (
        <DeleteProgrammeDialog
          programme={deletingProgramme}
          onClose={() => setDeletingProgramme(null)}
          onDeleted={(toast) =>
            afterSave(toast, () => setDeletingProgramme(null))
          }
        />
      )}

      {/* floating anchor button — pinned to the viewport's bottom-right,
          jumps to the Class-size rules card below the roster, flipping to
          "Back to top" after arrival (courses view) */}
      {view === "courses" && (
        <button
          type="button"
          onClick={jumpRulesOrTop}
          title={atRules ? "Back to the course list" : "Jump to the Class-size rules"}
          className="fixed bottom-6 right-6 z-40 flex h-11 items-center gap-xs rounded-button bg-primary px-md text-[13px] font-medium text-white shadow-card transition-all hover:bg-primaryHover hover:-translate-y-[1px] active:scale-95 animate-[badgeIn_0.3s_ease-out_both]"
        >
          {atRules ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          {atRules ? "Back to top" : "Class-size rules"}
        </button>
      )}

      {/* green completion toast — paints above dialog backdrops */}
      <Toast tone="success" message={itemToast} onDone={() => setItemToast(null)} />
    </div>
  );
}
