"use client";

/**
 * LECTURERS — Programme Leader staff directory (UC_CPM_01).
 *
 * Displays every lecturer from PostgreSQL (GET /api/lecturers): staff ID,
 * name, position, contact, employment classification, department, linked
 * account and a live academic-year workload roll-up. Hour limits are stored
 * per lecturer; rules provide suggestions based on role (Programme Leader
 * wins) and the programme levels taught (Bachelor / Diploma / both). Editing
 * the rules alone never changes saved lecturer limits. The explicit all-staff
 * action previews and confirms a reset to each applicable rule.
 *
 * Doc basis: RBAC gives PLs read access to workload data for all staff in
 * their department. Each row carries an Edit action (UC_CPM_01 "maintain
 * lecturer details") which opens a themed dialog and patches the record
 * via PATCH /api/lecturers/:staffId (hour limits are edited via the rules
 * card, PATCH /api/workload-rules).
 */

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock3, Loader2, Pencil, Plus, RefreshCcw, Save, Search, Trash2, TriangleAlert, Users, X, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/services/apiClient";
import Toast from "@/components/toast/Toast";
import ApplyHourLimitRulesDialog from "@/components/lecturers/ApplyHourLimitRulesDialog";
import SortableTableHeader from "@/components/ui/SortableTableHeader";
import useTableSortAnimation from "@/components/ui/useTableSortAnimation";
import { LECTURER_SORT_LABELS, sortLecturers, toggleLecturerSort, type LecturerSort, type LecturerSortKey } from "@/lib/lecturer-sorting";

interface LecturerRow {
  id: number;
  staffId: string;
  fullName: string;
  specialization: string | null;
  areaOfInterest: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPl: boolean;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT";
  isActive: boolean;
  /** limits: the lecturer's stored pair (snapshot-stable — rules edits
      never rewrite it) plus the rule's current suggestion for comparison */
  ruleKey: string;
  ruleLabel: string;
  ruleBasis: "ROLE" | "COURSES" | "GLOBAL";
  minHours: number;
  maxHours: number;
  suggestedMin: number;
  suggestedMax: number;
  /** stored pair differs from the current rule (informational chip) */
  custom: boolean;
  /** stored pair violates the rule's allowed min–max range (⚠ badge) */
  outOfRange: boolean;
  departmentCode: string | null;
  departmentName: string | null;
  username: string | null;
  academicYearRecords: number;
  allocatedHours: number;
}

interface LecturerCounts {
  total: number;
  fullTime: number;
  partTime: number;
  contract: number;
  programmeLeaders: number;
}

/** one editable min/max pair from workload_rules (role- or course-based) */
interface WorkloadRule {
  ruleKey: string;
  label: string;
  basis: "ROLE" | "COURSES" | "GLOBAL";
  priority: number;
  minHours: number;
  maxHours: number;
}

type TypeFilter = "all" | "FULL_TIME" | "PART_TIME" | "PL";

const EMPLOYMENT_LABEL: Record<LecturerRow["employmentType"], string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
};

const EMPLOYMENT_CLS: Record<LecturerRow["employmentType"], string> = {
  FULL_TIME: "bg-successBg text-successText",
  PART_TIME: "bg-warningBg text-warningText",
  CONTRACT: "bg-hoverBg text-textNormal",
};

/**
 * Themed filter dropdown — custom menu surface in the docx palette
 * (native <select> pop-ups can't adopt the white card / hover / primary
 * active states). Same call API as before: options are still declared with
 * <option value="…">Label</option> children.
 */
function FilterSelect({
  ariaLabel,
  value,
  onChange,
  icon: Icon,
  /** dialog fields stretch the pill to the full cell width (like inputs) */
  fullWidth,
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  /** optional leading icon (e.g. the arrows on the sort selector) */
  icon?: LucideIcon;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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
        } ${
          open ? "border-primary" : "border-divider hover:bg-background"
        } ${Icon ? "pl-8" : "pl-md"}`}
      >
        {Icon && <Icon size={14} className="shrink-0 text-textSecondary" />}
        {selected?.label ?? "—"}
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
          {options.map((o) => {
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
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone = "default",
}: {
  /** string or short JSX (e.g. icon + text) */
  label: ReactNode;
  count: number | null;
  active: boolean;
  onClick: () => void;
  /** error-tone chips (the ⚠ warnings filter) highlight in red when active */
  tone?: "default" | "error";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-xs whitespace-nowrap rounded-badge px-md text-[12.5px] transition-colors ${
        active
          ? tone === "error"
            ? "bg-errorBg font-semibold text-errorText"
            : "bg-primaryLight font-semibold text-primary"
          : "border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg"
      }`}
    >
      {label}
      {count !== null && (
        <span
          className={
            active
              ? tone === "error"
                ? "text-errorText/70"
                : "text-primary/70"
              : "text-textSecondary"
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** "12" not "12.00" for rule copy */
const hoursLabel = (v: number) => `${Number(v.toFixed(2))}`;

const BASIS_LABEL: Record<WorkloadRule["basis"], string> = {
  ROLE: "Role",
  COURSES: "From courses",
  GLOBAL: "Fallback",
};

const BASIS_CLS: Record<WorkloadRule["basis"], string> = {
  ROLE: "bg-primaryLight text-primary",
  COURSES: "bg-background text-textNormal",
  GLOBAL: "bg-hoverBg text-textSecondary",
};

/**
 * HOUR-LIMIT RULES EDITOR — the editable workload_rules table.
 *
 * Limits are NOT per lecturer: each lecturer resolves a rule in priority
 * order (Programme Leader ROLE rule first; otherwise the COURSES rule for
 * the programme levels taught — Bachelor only / Diploma only / both;
 * DEFAULT when nothing matches). Each rule carries an editable min/max
 * pair; saving PATCHes /api/workload-rules and the parent refetches so the
 * roster re-resolves and replays its row animation.
 */
function RulesEditor({
  rules,
  staffCountByRule,
  onSaved,
}: {
  rules: WorkloadRule[];
  staffCountByRule: Record<string, number>;
  onSaved: () => void;
}) {
  /** server copy rebuilt whenever new values arrive (also resets drafts) */
  const serverDrafts = useMemo(
    () =>
      Object.fromEntries(
        rules.map((r) => [r.ruleKey, { min: hoursLabel(r.minHours), max: hoursLabel(r.maxHours) }])
      ) as Record<string, { min: string; max: string }>,
    [rules]
  );

  const [drafts, setDrafts] = useState(serverDrafts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(serverDrafts);
  }, [serverDrafts]);

  /** parse + validate one row draft (policy: 0.5–45 h/wk, min ≤ max) */
  const rowState = (rule: WorkloadRule) => {
    const d = drafts[rule.ruleKey] ?? { min: "", max: "" };
    const min = Number(d.min);
    const max = Number(d.max);
    const valid =
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min >= LIMIT_MIN &&
      max >= LIMIT_MIN &&
      min <= LIMIT_MAX &&
      max <= LIMIT_MAX &&
      min <= max;
    const changed = min !== rule.minHours || max !== rule.maxHours;
    return { min, max, valid, changed };
  };

  const anyInvalid = rules.some((r) => !rowState(r).valid);
  const anyChanged = rules.some((r) => rowState(r).changed);

  const save = async () => {
    if (!anyChanged || anyInvalid) return;
    setError(null);
    setSaving(true);
    try {
      const r = await apiFetch("/api/workload-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: rules.map((rule) => {
            const s = rowState(rule);
            return { ruleKey: rule.ruleKey, minHours: s.min, maxHours: s.max };
          }),
        }),
      });
      const d = (await r.json()) as { ok: boolean; message?: string };
      if (d.ok) onSaved();
      else setError(d.message ?? "Could not save the rules.");
    } catch {
      setError("Network error while saving the rules.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = (bad: boolean) =>
    `h-10 w-[92px] rounded-button border bg-background px-sm text-center text-[13px] text-text outline-none transition-colors disabled:cursor-not-allowed ${
      bad
        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
        : "border-divider focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primaryLight"
    }`;

  const setDraft = (ruleKey: string, part: "min" | "max", value: string) =>
    setDrafts((prev) => ({ ...prev, [ruleKey]: { ...prev[ruleKey], [part]: value } }));

  return (
    <section className="mt-lg overflow-hidden rounded-card bg-surface shadow-card">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-sm border-b border-divider px-lg py-md">
        <div>
          <h2 className="text-[15px] font-bold leading-[22px] text-text">Hour-limit rules</h2>
          <p className="mt-[2px] text-[12px] text-textSecondary">
            Minimum and maximum teaching hours per role / courses taught — Programme Leader
            resolves first, then the programme levels actually taught. Numbers only,
            0.5–45 h/wk per rule — two decimals like .00. Policy only: lecturer limits
            keep their snapshot, flagged rows show ⚠ until updated.
          </p>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="px-lg py-md text-[13px] text-textSecondary">Rules load with the roster…</p>
      ) : (
        <div>
          {rules.map((rule) => {
            const d = drafts[rule.ruleKey] ?? { min: "", max: "" };
            const s = rowState(rule);
            const badMin = badHours(s.min);
            const badMax = badHours(s.max);
            const rangeBad = !badMin && !badMax && s.min > s.max;
            return (
              <div
                key={rule.ruleKey}
                className="grid grid-cols-[minmax(200px,1fr)_auto_auto] items-center gap-x-md gap-y-1 border-b border-divider px-lg py-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-sm">
                    <p className="text-[13.5px] font-semibold text-text">{rule.label}</p>
                    <span
                      className={`rounded-badge px-sm py-[3px] text-[11px] font-semibold ${BASIS_CLS[rule.basis]}`}
                    >
                      {BASIS_LABEL[rule.basis]}
                    </span>
                  </div>
                  <p className="mt-[2px] whitespace-nowrap text-[11.5px] text-textSecondary">
                    {staffCountByRule[rule.ruleKey] ?? 0} staff currently resolve here
                    {rule.ruleKey === "PL" && " · wins over course rules"}
                    {rule.ruleKey === "DEFAULT" && " · when role and courses match nothing"}
                  </p>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                    Min h/wk
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={d.min}
                    onChange={(e) => setDraft(rule.ruleKey, "min", sanitizeHours(e.target.value))}
                    className={inputCls(badMin || rangeBad)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                    Max h/wk
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={d.max}
                    onChange={(e) => setDraft(rule.ruleKey, "max", sanitizeHours(e.target.value))}
                    className={inputCls(badMax || rangeBad)}
                  />
                </label>

                {(badMin || badMax || rangeBad) && (
                  <p className="col-span-2 col-start-2 animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                    {badMin || badMax
                      ? !Number.isFinite(s.min) || !Number.isFinite(s.max)
                        ? "Numbers only — 0.5–45 h/wk, two decimals max."
                        : "Weekly hours: 0.5–45 h/wk (two decimals like .00)."
                      : "Minimum cannot exceed maximum."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* footer: status + actions */}
      <div className="flex flex-wrap items-center justify-between gap-sm border-t border-divider px-lg py-md">
        <p className="text-[12px] text-textSecondary">
          {error ? (
            <span className="font-medium text-errorText">{error}</span>
          ) : anyInvalid ? (
            "Fix the highlighted rows before saving."
          ) : anyChanged ? (
            "Unsaved changes — flagged lecturers keep their snapshot until re-synced."
          ) : (
            "Saved values live. Lecturer limits are snapshots — rules changes flag affected lecturers (⚠) instead of rewriting their limits."
          )}
        </p>
        <div className="flex items-center gap-sm">
          {anyChanged && (
            <button
              type="button"
              onClick={() => setDrafts(serverDrafts)}
              disabled={saving}
              className="flex h-10 items-center rounded-button border border-divider bg-surface px-md text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!anyChanged || anyInvalid || saving}
            className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-medium text-white transition-colors hover:bg-primaryHover disabled:opacity-50"
            title={anyChanged ? "Save rule limits" : "No changes to save"}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? "Saving…" : "Save rules"}
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkloadCell({
  lecturer,
  limitCeiling,
  onExceedToast,
}: {
  lecturer: LecturerRow;
  /** largest max in the Hour-limit rules — row limits above it are flagged */
  limitCeiling: number;
  /** raises the page-level exceed toast (badge hover and click) */
  onExceedToast: (message: string) => void;
}) {
  const allocated = lecturer.allocatedHours;
  const pct = Math.min((allocated / Math.max(lecturer.maxHours, 0.1)) * 100, 100);
  const belowMin = allocated < lecturer.minHours;
  const barCls =
    allocated > lecturer.maxHours
      ? "bg-error"
      : belowMin || pct >= 85
        ? "bg-warning"
        : "bg-success";

  /** ⚠ shows only when the stored pair falls outside the rule's allowed
      min–max range — a kept/custom limit within the range is fine */
  const overCeiling = lecturer.minHours > limitCeiling || lecturer.maxHours > limitCeiling;
  const outOfRange = lecturer.outOfRange;
  const exceedMessage = overCeiling
    ? `${lecturer.staffId} — ${hoursLabel(lecturer.maxHours > limitCeiling ? lecturer.maxHours : lecturer.minHours)}h exceeds the ${limitCeiling}h maximum set in the Hour-limit rules — lower the lecturer's custom limit or raise the rule maximum.`
    : `${lecturer.staffId} — ${lecturer.minHours}–${lecturer.maxHours}h is outside rule "${lecturer.ruleLabel}" allowed range (${lecturer.suggestedMin}–${lecturer.suggestedMax}h) — snap to the rule values or set a limit within the range.`;

  const overBadge = outOfRange ? (
    <button
      type="button"
      onClick={() => onExceedToast(exceedMessage)}
      onMouseEnter={() => onExceedToast(exceedMessage)}
      onFocus={() => onExceedToast(exceedMessage)}
      aria-label={`Warning: ${exceedMessage}`}
      className="animate-[badgeIn_0.2s_ease-out_both] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-badge bg-errorBg text-errorText transition-colors hover:bg-error/15"
    >
      <TriangleAlert size={12} />
    </button>
  ) : null;

  return (
    <div className="flex w-[168px] flex-col justify-center gap-1">
      {allocated > 0 ? (
        <>
          <div className="flex items-center gap-xs">
            <p className="whitespace-nowrap text-[12.5px] font-medium text-text">
              {allocated}h / {lecturer.minHours}–{lecturer.maxHours}h
            </p>
            {lecturer.custom && <CustomLimitChip />}
            {overBadge}
          </div>
          <span className="h-1.5 w-full overflow-hidden rounded-badge bg-hoverBg">
            <span
              className={`block h-full ${barCls} rounded-badge transition-all`}
              style={{ width: `${pct}%` }}
            />
          </span>
          {belowMin && (
            <p className="whitespace-nowrap text-[11px] font-medium text-warningText">
              Below {lecturer.minHours}h minimum
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-xs">
            <p className="whitespace-nowrap text-[12.5px] font-medium text-text">
              {lecturer.minHours}–{lecturer.maxHours}h / wk
            </p>
            {lecturer.custom && <CustomLimitChip />}
            {overBadge}
          </div>
          <p className="text-[11.5px] text-textSecondary">No academic-year workload yet</p>
        </>
      )}
    </div>
  );
}

/** marks limits set per lecturer rather than resolved from the rules */
function CustomLimitChip() {
  return (
    <span className="rounded-badge bg-primaryLight px-sm py-[2px] text-[10.5px] font-semibold text-primary">
      Custom
    </span>
  );
}

function StatusDot({ lecturer }: { lecturer: LecturerRow }) {
  return (
    <div className="flex w-[68px] shrink-0 items-center gap-xs">
      <span
        className={`h-2 w-2 shrink-0 rounded-badge ${
          lecturer.isActive ? "bg-success" : "bg-textDisabled"
        }`}
      />
      <span
        className={`text-[12px] font-medium ${
          lecturer.isActive ? "text-textNormal" : "text-textSecondary"
        }`}
      >
        {lecturer.isActive ? "Active" : "Inactive"}
      </span>
    </div>
  );
}

/** labelled 44px form input wrapper for the dialog grid */
function Field({
  label,
  wide,
  children,
}: {
  label: string;
  /** span both grid columns */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] font-semibold text-textNormal">{label}</span>
      {children}
    </label>
  );
}

/** shared input styling for the dialog (theme: 44px, primary focus ring) */
const INPUT_CLS =
  "h-11 w-full rounded-button border border-divider bg-background px-md text-[13.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primaryLight disabled:cursor-not-allowed disabled:bg-hoverBg disabled:text-textSecondary";

/** weekly-hour policy (h/wk): fractional halves allowed, hard cap 45 */
const LIMIT_MIN = 0.5;
const LIMIT_MAX = 45;

/** digits + at most ONE decimal point with TWO decimal places — a valid
    double h/wk entry (12 · 12.5 · 12.45 ✓ · 12.345 ✗); letters never land */
const sanitizeHours = (raw: string) => {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return `${cleaned.slice(0, dot + 1)}${cleaned
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2)}`;
};

/** standalone precision probe (12.345 ✗ · 12.50 ✓) — loops reuse badHours,
    which already embeds this check */
const tooPrecise = (v: number) =>
  Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;

/** true when a parsed weekly-hour value is unusable: outside the 0.5–45
    bounds, or carrying more than two decimal places (12.345 …) */
const badHours = (v: number) =>
  !Number.isFinite(v) ||
  v < LIMIT_MIN ||
  v > LIMIT_MAX ||
  Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;

/**
 * Edit dialog for a lecturer record (UC_CPM_01 "maintain lecturer details").
 * Patches PATCH /api/lecturers/:staffId with the editable subset — identity,
 * contact, position and classification flags — plus the lecturer's stored
 * workload-limit pair (min/max). Limits are snapshot-stable: rules edits
 * never rewrite them, so per-record value changes only happen here. On save
 * the page refetches and replays the row animation.
 */
function EditLecturerDialog({
  lecturer,
  ceiling,
  onExceed,
  onClose,
  onSaved,
}: {
  lecturer: LecturerRow;
  /** hard maximum (h/wk) from the Hour-limit rules — overrides may not exceed it */
  ceiling: number;
  /** raises/clears the page-level exceed toast */
  onExceed: (message: string | null) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(lecturer.fullName);
  const [specialization, setSpecialization] = useState(lecturer.specialization ?? "");
  const [email, setEmail] = useState(lecturer.email ?? "");
  const [phone, setPhone] = useState(lecturer.phone ?? "");
  /* position is chosen via the same selection list as Add Staff; when the
     stored position is a custom title, it shows as "Current — … (custom)" */
  const knownPositions = POSITION_OPTIONS as readonly string[];
  const storedIsCustom =
    !!(lecturer.position ?? "") && !knownPositions.includes(lecturer.position ?? "");
  const [positionSelect, setPositionSelect] = useState<string>(
    knownPositions.includes(lecturer.position ?? "") ? (lecturer.position ?? "") : POSITION_OTHER
  );
  const [position, setPosition] = useState(lecturer.position ?? "");
  const [employmentType, setEmploymentType] = useState<LecturerRow["employmentType"]>(
    lecturer.employmentType
  );
  const [isPl, setIsPl] = useState(lecturer.isPl);
  const [isActive, setIsActive] = useState(lecturer.isActive);
  /* workload limit pair — stored per lecturer and snapshot-stable; rules
     edits never rewrite it, so the dialog always consumes/produces values */
  const [minLimit, setMinLimit] = useState(hoursLabel(lecturer.minHours));
  const [maxLimit, setMaxLimit] = useState(hoursLabel(lecturer.maxHours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** set on the first Save click — gates the per-field inline warnings */
  const [attempted, setAttempted] = useState(false);
  /** blur-gates for the format fields — warnings appear when the user
      LEAVES the field (or on a save attempt), never while still typing */
  const [emailTouched, setEmailTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  /** server refused uniqueness (23505) — staff_id is fixed here, so a 409
      can only mean the edited EMAIL collides with another record */
  const [serverEmailDupe, setServerEmailDupe] = useState(false);

  /* Escape closes while the dialog is open */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ceiling guard — while either editable limit exceeds the rules maximum,
     raise the page toast (debounced against keystrokes) and block Save */
  const mnLimit = Number(minLimit);
  const mxLimit = Number(maxLimit);
  const minExceeded = Number.isFinite(mnLimit) && mnLimit > ceiling;
  const maxExceeded = Number.isFinite(mxLimit) && mxLimit > ceiling;
  const limitBlocked = minExceeded || maxExceeded;
  const exceededValue = minExceeded ? mnLimit : mxLimit;
  /** 0.5–45 policy bounds + pairing — drives the red borders on the inputs */
  const pairBad =
    Number.isFinite(mnLimit) && Number.isFinite(mxLimit) && mnLimit > mxLimit;
  const minLimitBad = badHours(mnLimit) || pairBad;
  const maxLimitBad = badHours(mxLimit) || pairBad;
  /** bounds status of the currently edited pair vs the rule's range */
  const dialogOutOfRange =
    (Number.isFinite(mnLimit) &&
      (mnLimit < lecturer.suggestedMin || mnLimit > lecturer.suggestedMax)) ||
    (Number.isFinite(mxLimit) &&
      (mxLimit < lecturer.suggestedMin || mxLimit > lecturer.suggestedMax));
  /** contact validation — empty is fine (optional fields), a filled value
      must match its format; drives the red borders + Save block */
  const emailInvalid = contactInvalid(email, EMAIL_RE);
  const phoneInvalid = contactInvalid(normalizePhone(phone), MY_PHONE_RE);
  /* per-field messages — appear only after a save attempt so the form never
     nags while it is still being filled in */
  const nameMsg = attempted && !fullName.trim();
  const emailMsg = (attempted || emailTouched) && emailInvalid;
  const phoneMsg = (attempted || phoneTouched) && phoneInvalid;
  const posMsg = attempted && positionSelect === POSITION_OTHER && !position.trim();
  /** Save runs only when every per-field flag is clear; server-level
      problems (duplicates, DB errors) keep their banner below the grid */
  const fieldBlocked =
    nameMsg || emailMsg || phoneMsg || posMsg || minLimitBad || maxLimitBad || limitBlocked;

  useEffect(() => {
    if (!limitBlocked) {
      onExceed(null);
      return;
    }
    const t = setTimeout(() => {
      onExceed(
        `${exceededValue}h exceeds the ${ceiling}h maximum allowed by the Hour-limit rules — lower it to save changes.`
      );
    }, 400);
    return () => clearTimeout(t);
  }, [limitBlocked, exceededValue, ceiling, onExceed]);

  const save = async () => {
    /* one save attempt reveals every per-field message at once; each warning
       then disappears live when its field is fixed. Server-level problems
       (duplicates, DB errors) still use the banner below the grid. */
    setError(null);
    setAttempted(true);
    if (fieldBlocked) return;
    /* the chosen position — fixed selection value, or the custom text under "Other" */
    const finalPosition = positionSelect === POSITION_OTHER ? position.trim() : positionSelect;
    /* validate + send the stored limit pair (0.5–45 h/wk policy bounds) */
    const mn = Number(minLimit);
    const mx = Number(maxLimit);
    setSaving(true);
    try {
      const r = await apiFetch(`/api/lecturers/${lecturer.staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          specialization: specialization.trim(),
          email: email.trim(),
          phone: phone.trim(),
          position: finalPosition,
          employmentType,
          isPl,
          isActive,
          overrideMin: Math.round(mn * 100) / 100,
          overrideMax: Math.round(mx * 100) / 100,
        }),
      });
      const d = (await r.json()) as { ok: boolean; message?: string };
      if (d.ok) {
        onSaved();
      } else if ((d.message ?? "").includes("already registered")) {
        /* staff_id is fixed in this dialog, so a 409 means the edited
           EMAIL collides with another record */
        setServerEmailDupe(true);
      } else setError(d.message ?? "Could not save the lecturer.");
    } catch {
      setError("Network error while saving the lecturer.");
    } finally {
      setSaving(false);
    }
  };

  const toggleChip = (on: boolean) =>
    `flex h-9 items-center gap-xs rounded-badge px-md text-[12.5px] transition-colors ${
      on
        ? "bg-primaryLight font-semibold text-primary"
        : "border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg"
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full max-w-[560px] overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card">
        {/* title bar */}
        <div className="flex items-start justify-between gap-md">
          <div>
            <h2 className="text-[18px] font-bold leading-[26px] text-text">Edit lecturer</h2>
            <p className="mt-[2px] text-[12.5px] text-textSecondary">
              Maintain the staff record — changes apply immediately on save.
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

        {/* fields */}
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field label="Staff ID" wide>
            <input value={lecturer.staffId} readOnly disabled className={INPUT_CLS} />
          </Field>
          <Field label="Full name" wide>
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={200}
                className={`${INPUT_CLS} ${
                  nameMsg
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {nameMsg && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  Full name is required.
                </p>
              )}
            </div>
          </Field>
          <Field label="Email">
            <div className="flex flex-col gap-1">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setServerEmailDupe(false);
                }}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@tarc.edu.my"
                maxLength={200}
                className={`${INPUT_CLS} ${
                  emailMsg || serverEmailDupe
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {(emailMsg || serverEmailDupe) && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  {serverEmailDupe && !emailMsg
                    ? "That email is already registered."
                    : "Please enter a valid email"}
                </p>
              )}
            </div>
          </Field>
          <Field label="Phone">
            <div className="flex flex-col gap-1">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                placeholder="e.g. 012-3456789"
                maxLength={20}
                className={`${INPUT_CLS} ${
                  phoneMsg
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {phoneMsg && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  Please enter a valid phone number
                </p>
              )}
            </div>
          </Field>
          <Field label="Specialization" wide>
            <input
              type="text"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              maxLength={200}
              placeholder="e.g. Computer Science, Mathematics or Software Engineering"
              className={INPUT_CLS}
            />
            <p className="mt-1 text-[11.5px] leading-snug text-textSecondary">
              Optional — used with interests and teaching hours for Auto Assign.
            </p>
          </Field>
          <Field label="Position" wide>
            <div className="flex flex-col gap-sm">
              {/* same selection list as Add Staff — fixed titles + custom option,
                  and the stored value is always visible on open */}
              {/* same pill design as the toolbar's Sort/Status selectors */}
              <FilterSelect
                ariaLabel="Position"
                value={positionSelect}
                fullWidth
                onChange={(v) => setPositionSelect(v)}
              >
                {storedIsCustom && (
                  <option value={POSITION_OTHER}>
                    {`Current — “${lecturer.position}” (custom)`}
                  </option>
                )}
                {POSITION_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {!storedIsCustom && <option value={POSITION_OTHER}>Other… (custom position)</option>}
              </FilterSelect>
              {positionSelect === POSITION_OTHER && (
                <>
                  <input
                    type="text"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="Type the custom position here — e.g. Tutor"
                    maxLength={100}
                    className={`${INPUT_CLS} ${
                      posMsg
                        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                        : ""
                    }`}
                  />
                  {posMsg && (
                    <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                      Type the custom position title.
                    </p>
                  )}
                </>
              )}
              <p className="text-[11.5px] leading-snug text-textSecondary">
                The role chip under “Role &amp; status” still decides the Programme-Leader rule
                — this list only stores the job title.
              </p>
            </div>
          </Field>

          {/* classification — single choice (drives the hour-limit engine) */}
          <Field label="Classification" wide>
            <div className="flex flex-wrap gap-sm">
              {(["FULL_TIME", "PART_TIME", "CONTRACT"] as const).map((t) => {
                const on = employmentType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEmploymentType(t)}
                    className={toggleChip(on)}
                  >
                    {on && <Check size={13} />}
                    {EMPLOYMENT_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* role / status toggles */}
          <Field label="Role & status" wide>
            <div className="flex flex-wrap gap-sm">
              <button type="button" onClick={() => setIsPl((v) => !v)} className={toggleChip(isPl)}>
                {isPl && <Check size={13} />}
                Programme Leader · {isPl ? "on" : "off"}
              </button>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={toggleChip(isActive)}
              >
                {isActive && <Check size={13} />}
                Status · {isActive ? "active" : "inactive"}
              </button>
            </div>
          </Field>

          {/* workload limit — stored per lecturer, snapshot-stable; the
              rule's current suggestion is one click away */}
          <Field label="Workload limit (min & max h/wk)" wide>
            <div className="flex flex-col gap-sm">
              {/* one row: min + max inputs and the rule-snap action share it */}
              <div className="flex flex-nowrap items-end gap-sm">
                <label className="flex w-[104px] shrink-0 flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                    Min h/wk
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={minLimit}
                    onChange={(e) => setMinLimit(sanitizeHours(e.target.value))}
                    className={`${INPUT_CLS} ${
                      minExceeded || minLimitBad
                        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                        : ""
                    }`}
                  />
                </label>
                <label className="flex w-[104px] shrink-0 flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                    Max h/wk
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={maxLimit}
                    onChange={(e) => setMaxLimit(sanitizeHours(e.target.value))}
                    className={`${INPUT_CLS} ${
                      maxExceeded || maxLimitBad
                        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                        : ""
                    }`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMinLimit(hoursLabel(lecturer.suggestedMin));
                    setMaxLimit(hoursLabel(lecturer.suggestedMax));
                  }}
                  title={`Snap the stored pair to the current "${lecturer.ruleLabel}" rule values`}
                  className="ml-auto flex h-11 shrink-0 items-center gap-xs rounded-button bg-success px-md text-[12.5px] font-medium text-white transition-colors hover:bg-successHover"
                >
                  <RefreshCcw size={13} />
                  Set to rule ({hoursLabel(lecturer.suggestedMin)}–
                  {hoursLabel(lecturer.suggestedMax)}h)
                </button>
              </div>
              {(limitBlocked || minLimitBad || maxLimitBad) && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  {limitBlocked
                    ? `Cannot exceed the ${ceiling}h rules ceiling — lower the pair to save.`
                    : pairBad
                      ? "Minimum limit cannot exceed maximum limit."
                      : "Hour limits: numbers only — 0.5–45 h/wk, two decimals max."}
                </p>
              )}
              <p className="max-w-[360px] text-[11.5px] leading-snug text-textSecondary">
                {`Stored for "${lecturer.ruleLabel}" at ${lecturer.minHours}–${lecturer.maxHours}h — `}
                {dialogOutOfRange
                  ? `outside the rule's allowed range (${lecturer.suggestedMin}–${lecturer.suggestedMax}h), so the roster shows the ⚠ warning.`
                  : `matches the rule's allowed range (${lecturer.suggestedMin}–${lecturer.suggestedMax}h), so no ⚠ shows${lecturer.custom ? " even though the pair differs from the rule's exact values." : "."}`}{" "}
                Rules card edits never rewrite these values; saving here re-syncs
                the row.
                <span className="mt-1 block font-medium text-textNormal">
                  Numbers only — 0.5–45 h/wk, two decimals like .00; beyond the {ceiling}h
                  rules ceiling blocks saving.
                </span>
              </p>
            </div>
          </Field>
        </div>

        {/* field-level problems live under their own inputs; server-level
            errors surface in the DevTools console via the apiClient logger */}

        {/* footer actions */}
        <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            /* stays clickable with field problems — the click triggers the
               per-field inline warnings; only a network round-trip disables it */
            disabled={saving}
            title={
              limitBlocked
                ? `Blocked — limit exceeds the ${ceiling}h maximum from the Hour-limit rules`
                : undefined
            }
            className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-medium text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ── shared dialog validators ───────────────────────────────────────────────
    one source of truth for the Add-Staff and Edit-lecturer forms */
/* loose e-mail sanity — one @, dot-suffixed domain, no whitespace */
const EMAIL_RE = /^\S+@\S+\.\S+$/;
/* Malaysian phone sanity — mobile 01x-xxxxxxx (also written +60 12-xxx) or
   fixed line 0[3-9]-xxxxxxx; the separators used when writing MY numbers
   (+, spaces, dashes, parentheses) are stripped before testing */
const MY_PHONE_RE = /^(?:(?:60|0)1[0-9]{8,9}|(?:60|0)[3-9][0-9]{6,7})$/;
/** strips the separators Malaysian numbers are written with */
const normalizePhone = (raw: string) => raw.replace(/[+()\s-]/g, "");
/** optional-text invalidity — EMPTY always stays valid (both are optional);
    a filled field must match its format rule to unblock Save */
const contactInvalid = (value: string, re: RegExp) =>
  value.trim() !== "" && !re.test(value.trim());

/** Position choices for newly added staff — the department's four fixed job
    titles plus "Other", which reveals an editable free-text input. Values
    match the labels stored in `lecturers.position` exactly. */
const POSITION_OPTIONS = [
  "Programme Leader",
  "Lecturer",
  "Senior Lecturer",
  "Assistant Professor",
] as const;
const POSITION_OTHER = "__OTHER__";
/** department codes present in the seed data */
const ADD_DEPARTMENTS = ["DCIT", "DACB", "DSSH"] as const;

function AddStaffDialog({
  defaultMin,
  defaultMax,
  /** every staff ID currently on the roster — powers the live duplicate check */
  existingStaffIds,
  ceiling,
  onClose,
  onSaved,
}: {
  /** DEFAULT rule's suggested pair — the starter snapshot for the record */
  defaultMin: number;
  defaultMax: number;
  /** every staff ID currently on the roster — powers the live duplicate check */
  existingStaffIds: string[];
  /** hard maximum (h/wk) from the Hour-limit rules */
  ceiling: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [positionChoice, setPositionChoice] = useState<string>("Lecturer");
  const [customPosition, setCustomPosition] = useState("");
  const [employmentType, setEmploymentType] = useState<LecturerRow["employmentType"]>("FULL_TIME");
  const [departmentCode, setDepartmentCode] = useState<string>("DCIT");
  const [isActive, setIsActive] = useState(true);
  /* stored limit pair — seeded once at creation from the DEFAULT rule */
  const [minLimit, setMinLimit] = useState(hoursLabel(defaultMin));
  const [maxLimit, setMaxLimit] = useState(hoursLabel(defaultMax));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** set on the first Save click — gates the per-field inline warnings */
  const [attempted, setAttempted] = useState(false);
  /** blur-gates for the format fields — warnings appear when the user
      LEAVES the field (or on a save attempt), never while still typing */
  const [emailTouched, setEmailTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  /** server-side uniqueness refusal (23505) — flags the staff-ID field */
  const [serverDupe, setServerDupe] = useState(false);

  /* Escape closes while the dialog is open */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* limits: policy bounds + pairing + ceiling — drive red borders and Save */
  const mnLimit = Number(minLimit);
  const mxLimit = Number(maxLimit);
  const pairBad =
    Number.isFinite(mnLimit) && Number.isFinite(mxLimit) && mnLimit > mxLimit;
  const minBad = badHours(mnLimit) || pairBad;
  const maxBad = badHours(mxLimit) || pairBad;
  const overCeiling = Math.max(
    Number.isFinite(mnLimit) ? mnLimit : 0,
    Number.isFinite(mxLimit) ? mxLimit : 0
  ) > ceiling;
  const limitBlocked = overCeiling;
  const exceededValue = Math.max(
    Number.isFinite(mnLimit) ? mnLimit : 0,
    Number.isFinite(mxLimit) ? mxLimit : 0
  );
  const customNeeded = positionChoice === POSITION_OTHER && !customPosition.trim();
  /** contact validation — empty is fine (optional fields), a filled value
      must match its format; drives the red borders + Save block */
  const emailInvalid = contactInvalid(email, EMAIL_RE);
  const phoneInvalid = contactInvalid(normalizePhone(phone), MY_PHONE_RE);
  /* per-field messages — appear only after a save attempt so the form never
     nags while it is still being filled in */
  const codeTyped = staffId.trim();
  /** live duplicate check vs the current roster — an exact 4-digit match
      flags immediately, before any save attempt */
  const staffIdDupe = codeTyped.length === 4 && existingStaffIds.includes(codeTyped);
  const nameMsg = attempted && !fullName.trim();
  const staffIdMsg = attempted && !/^\d{4}$/.test(codeTyped);
  const emailMsg = (attempted || emailTouched) && emailInvalid;
  const phoneMsg = (attempted || phoneTouched) && phoneInvalid;
  const posMsg = attempted && customNeeded;
  /** Save runs only when every per-field flag is clear; server-level
      problems keep their banner (duplicates surface on the field itself) */
  const fieldBlocked =
    nameMsg ||
    staffIdMsg ||
    staffIdDupe ||
    serverDupe ||
    emailMsg ||
    phoneMsg ||
    posMsg ||
    minBad ||
    maxBad ||
    overCeiling;

  const toggleChipClass = (on: boolean) =>
    `flex h-9 items-center gap-xs rounded-badge px-md text-[12.5px] transition-colors ${
      on
        ? "bg-primaryLight font-semibold text-primary"
        : "border border-divider bg-surface font-medium text-textNormal hover:bg-hoverBg"
    }`;

  const save = async () => {
    /* one save attempt reveals every per-field message at once; each warning
       then disappears live when its field is fixed. Server-level problems
       (duplicates, unknown department, DB errors) still use the banner. */
    setError(null);
    setAttempted(true);
    if (fieldBlocked) return;
    const code = staffId.trim();
    const position = positionChoice === POSITION_OTHER ? customPosition.trim() : positionChoice;
    /* validate + seed the stored limit pair (0.5–45 h/wk policy bounds) */
    const mn = Number(minLimit);
    const mx = Number(maxLimit);
    setSaving(true);
    try {
      const r = await apiFetch("/api/lecturers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId: code,
          fullName: fullName.trim(),
          specialization: specialization.trim(),
          email: email.trim(),
          phone: phone.trim(),
          position,
          employmentType,
          isPl: position === "Programme Leader",
          isActive,
          departmentCode: departmentCode.trim().toUpperCase(),
          minHours: Math.round(mn * 100) / 100,
          maxHours: Math.round(mx * 100) / 100,
        }),
      });
      const d = (await r.json()) as { ok: boolean; message?: string };
      if (d.ok) onSaved();
      else if ((d.message ?? "").includes("already registered")) {
        /* DB-level uniqueness refused it — surface on the staff-ID field */
        setServerDupe(true);
      }
      else setError(d.message ?? "Could not add the lecturer.");
    } catch {
      setError("Network error while adding the lecturer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full max-w-[560px] overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card">
        {/* title bar */}
        <div className="flex items-start justify-between gap-md">
          <div>
            <h2 className="text-[18px] font-bold leading-[26px] text-text">Add staff</h2>
            <p className="mt-[2px] text-[12.5px] text-textSecondary">
              Create a lecturer record — it joins the roster immediately on save.
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

        {/* fields */}
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2">
          <Field label="Staff ID" wide>
            <div className="flex flex-col gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={staffId}
                onChange={(e) => {
                  setStaffId(e.target.value.replace(/\D/g, "").slice(0, 4));
                  setServerDupe(false);
                }}
                placeholder="e.g. 1013"
                className={`${INPUT_CLS} ${
                  staffIdMsg || staffIdDupe || serverDupe
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {(staffIdMsg || staffIdDupe || serverDupe) && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  {serverDupe && !staffIdDupe
                    ? "That staff ID or email is already registered."
                    : staffIdDupe
                      ? "This staff ID is already registered — duplicate staff IDs are not allowed."
                      : "Staff ID must be exactly 4 digits."}
                </p>
              )}
            </div>
          </Field>
          <Field label="Full name" wide>
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. En. Ahmad Bin Ali"
                maxLength={200}
                className={`${INPUT_CLS} ${
                  nameMsg
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {nameMsg && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  Full name is required.
                </p>
              )}
            </div>
          </Field>
          <Field label="Email">
            <div className="flex flex-col gap-1">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@tarc.edu.my"
                maxLength={200}
                className={`${INPUT_CLS} ${
                  emailMsg
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {emailMsg && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  Please enter a valid email
                </p>
              )}
            </div>
          </Field>
          <Field label="Phone">
            <div className="flex flex-col gap-1">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setPhoneTouched(true)}
                placeholder="e.g. 012-3456789"
                maxLength={20}
                className={`${INPUT_CLS} ${
                  phoneMsg
                    ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                    : ""
                }`}
              />
              {phoneMsg && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  Please enter a valid phone number
                </p>
              )}
            </div>
          </Field>

          <Field label="Specialization" wide>
            <input
              type="text"
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              maxLength={200}
              placeholder="e.g. Computer Science, Mathematics or Software Engineering"
              className={INPUT_CLS}
            />
            <p className="mt-1 text-[11.5px] leading-snug text-textSecondary">
              Optional — used with interests and teaching hours for Auto Assign.
            </p>
          </Field>

          {/* position — selection only, with an editable "Other" option */}
          <Field label="Position" wide>
            <div className="flex flex-col gap-sm">
              {/* same pill design as the toolbar's Sort/Status selectors */}
              <FilterSelect
                ariaLabel="Position"
                value={positionChoice}
                fullWidth
                onChange={(v) => {
                  setPositionChoice(v);
                  if (v !== POSITION_OTHER) setCustomPosition("");
                }}
              >
                {POSITION_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value={POSITION_OTHER}>Other… (custom position)</option>
              </FilterSelect>
              {positionChoice === POSITION_OTHER && (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={customPosition}
                    onChange={(e) => setCustomPosition(e.target.value)}
                    placeholder="Type the custom position here — e.g. Tutor"
                    maxLength={100}
                    className={`${INPUT_CLS} ${
                      posMsg
                        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                        : ""
                    }`}
                  />
                  {posMsg && (
                    <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                      Type the custom position title.
                    </p>
                  )}
                </>
              )}
              <p className="text-[11.5px] leading-snug text-textSecondary">
                Choosing{" "}
                <span className="font-medium text-textNormal">Programme Leader</span> sets the
                role flag that resolves the PL hour-limit rule.
              </p>
            </div>
          </Field>

          {/* department — same pill design as the position selector */}
          <Field label="Department">
            <FilterSelect
              ariaLabel="Department"
              value={departmentCode}
              fullWidth
              onChange={setDepartmentCode}
            >
              {ADD_DEPARTMENTS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </FilterSelect>
          </Field>

          {/* classification — single choice (drives the hour-limit engine) */}
          <Field label="Classification">
            <div className="flex flex-wrap gap-sm">
              {(["FULL_TIME", "PART_TIME", "CONTRACT"] as const).map((t) => {
                const on = employmentType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEmploymentType(t)}
                    className={toggleChipClass(on)}
                  >
                    {on && <Check size={13} />}
                    {EMPLOYMENT_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* status — active by default */}
          <Field label="Status" wide>
            <div className="flex flex-wrap gap-sm">
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={toggleChipClass(isActive)}
              >
                {isActive && <Check size={13} />}
                Status · {isActive ? "active" : "inactive"}
              </button>
            </div>
          </Field>

          {/* workload limit — seeded once, snapshot-stable afterwards */}
          <Field label="Workload limit (min &amp; max h/wk)" wide>
            <div className="flex flex-col gap-sm">
              <div className="flex flex-nowrap items-end gap-sm">
                <label className="flex w-[104px] shrink-0 flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                    Min h/wk
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={minLimit}
                    onChange={(e) => setMinLimit(sanitizeHours(e.target.value))}
                    className={`${INPUT_CLS} ${
                      minBad || overCeiling
                        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                        : ""
                    }`}
                  />
                </label>
                <label className="flex w-[104px] shrink-0 flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-textSecondary">
                    Max h/wk
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={maxLimit}
                    onChange={(e) => setMaxLimit(sanitizeHours(e.target.value))}
                    className={`${INPUT_CLS} ${
                      maxBad || overCeiling
                        ? "border-error focus:border-error focus:ring-4 focus:ring-errorBg"
                        : ""
                    }`}
                  />
                </label>
              </div>
              {(overCeiling || minBad || maxBad) && (
                <p className="animate-[badgeIn_0.2s_ease-out_both] text-[11.5px] font-medium text-errorText">
                  {overCeiling
                    ? `Cannot exceed the ${ceiling}h rules ceiling — lower the pair to save.`
                    : pairBad
                      ? "Minimum limit cannot exceed maximum limit."
                      : "Hour limits: numbers only — 0.5–45 h/wk, two decimals max."}
                </p>
              )}
              <p className="max-w-[400px] text-[11.5px] leading-snug text-textSecondary">
                {`Seeded from the DEFAULT rule (${hoursLabel(defaultMin)}–${hoursLabel(
                  defaultMax
                )}h) and stored as this lecturer's snapshot — rules card edits never rewrite it, and a saved pair outside the rule's range raises ⚠.`}
                <span className="mt-1 block font-medium text-textNormal">
                  Numbers only — 0.5–45 h/wk, two decimals like .00; beyond the {ceiling}h
                  rules ceiling blocks saving.
                </span>
              </p>
            </div>
          </Field>
        </div>

        {/* field-level problems live under their own inputs; server-level
            errors surface in the DevTools console via the apiClient logger */}

        {/* footer actions */}
        <div className="mt-lg flex items-center justify-end gap-sm border-t border-divider pt-lg">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-10 items-center rounded-button border border-divider bg-surface px-lg text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            /* stays clickable with field problems — the click triggers the
               per-field inline warnings; only a network round-trip disables it */
            disabled={saving}
            title={
              limitBlocked
                ? `Blocked — limit exceeds the ${ceiling}h maximum from the Hour-limit rules`
                : undefined
            }
            className="flex h-10 items-center gap-xs rounded-button bg-primary px-lg text-[13px] font-medium text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Adding…" : "Add staff"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Delete confirmation — the destructive counterpart to the row actions.
    Deletion is irreversible, so the dialog restates who is being removed
    and shows the server's FK verdict inline (staff with linked workloads
    is refused with a deactivate-instead message). */
function DeleteStaffDialog({
  lecturer,
  onClose,
  onDeleted,
}: {
  lecturer: LecturerRow;
  onClose: () => void;
  /** called with the deleted record once the server confirms removal */
  onDeleted: (deleted: LecturerRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape closes while the dialog is open */
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
      const r = await apiFetch(`/api/lecturers/${lecturer.staffId}`, {
        method: "DELETE",
      });
      const d = (await r.json()) as { ok: boolean; message?: string };
      if (d.ok) onDeleted(lecturer);
      else setError(d.message ?? "Could not delete the lecturer.");
    } catch {
      setError("Network error while deleting the lecturer.");
    } finally {
      setBusy(false);
    }
  };

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
            <h2 className="text-[18px] font-bold leading-[26px] text-text">Delete staff</h2>
            <p className="mt-[2px] text-[12.5px] text-textSecondary">
              This action is permanent and cannot be undone.
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

        {/* identity recap — the requester must see exactly who is removed */}
        <div className="mt-lg rounded-card border border-divider bg-background p-md">
          <p className="text-[14px] font-semibold text-text">{lecturer.fullName}</p>
          <p className="mt-[2px] text-[12.5px] text-textSecondary">
            {lecturer.staffId} · {lecturer.position ?? "No position"} ·{" "}
            {EMPLOYMENT_LABEL[lecturer.employmentType]}
            {lecturer.custom ? " · custom limits" : ""}
          </p>
          {lecturer.email && (
            <p className="mt-[2px] text-[12.5px] text-textSecondary">{lecturer.email}</p>
          )}
        </div>

        <p className="mt-md text-[12.5px] leading-snug text-textNormal">
          The record is immediately removed from the roster. However,{" "}
          <span className="font-medium text-errorText">
            staff with assigned workloads or linked records cannot be deleted.
          </span>{" "}
          In such cases, the system prevents deletion and requires the staff member to be
          deactivated instead.
        </p>

        {/* server-side refusal (FK-locked staff, not found, network) */}
        {error && (
          <p className="animate-[badgeIn_0.2s_ease-out_both] mt-md flex items-center gap-xs text-[12.5px] font-medium text-errorText">
            <TriangleAlert size={13} className="shrink-0" />
            {error}
          </p>
        )}

        {/* footer actions */}
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
            {busy ? "Deleting…" : "Delete staff"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LecturersPage() {
  const [lecturers, setLecturers] = useState<LecturerRow[]>([]);
  const [counts, setCounts] = useState<LecturerCounts | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  /* Sort order is intentionally page-local and starts empty after navigation
     or refresh; the PostgreSQL directory order is shown until a header click. */
  const [sorts, setSorts] = useState<LecturerSort[]>([]);
  /** lecturer currently opened in the edit dialog (null = closed) */
  const [editing, setEditing] = useState<LecturerRow | null>(null);
  /** bumped after each successful save — refetches the directory */
  const [reloadTick, setReloadTick] = useState(0);
  /** Add Staff dialog open state (UC_CPM_01 — programme leader creates records) */
  const [addOpen, setAddOpen] = useState(false);
  const [applyRulesOpen, setApplyRulesOpen] = useState(false);
  /** staff row queued for deletion — shows the confirm guard */
  const [deleting, setDeleting] = useState<LecturerRow | null>(null);
  /** ⚠ filter: show only lecturers whose saved limit broke the rule bounds */
  const [warningsOnly, setWarningsOnly] = useState(false);
  /** editable role/course hour-limit rules (workload_rules) */
  const [rules, setRules] = useState<WorkloadRule[]>([]);
  /** toast for limit-exceeded warnings raised by the edit dialog */
  const [limitToast, setLimitToast] = useState<string | null>(null);
  /** green completion toast (top-center) — staff actions and bulk limit reset */
  const [staffToast, setStaffToast] = useState<string | null>(null);

  /** floating anchor button: roster ⇄ Hour-limit rules card. Fixed to the
      viewport, so it never scrolls away; the mode flips as soon as the
      card climbs into the upper half of the screen — via a click's smooth
      arrival OR the user's own manual scroll (the card sits near the
      page's end where its top can never reach the window's top, so a
      fixed 120px test would never fire on shorter pages) */
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
    apiFetch("/api/lecturers")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setLecturers(d.lecturers as LecturerRow[]);
          setCounts(d.counts as LecturerCounts);
          setDepartment(d.department ?? null);
          if (Array.isArray(d.rules)) setRules(d.rules as WorkloadRule[]);
        } else {
          setError(d.message ?? "Lecturer directory unavailable.");
        }
      })
      .catch((err: unknown) =>
        setError(
          `Lecturer directory unavailable — ${err instanceof Error ? err.message : "network error"}.`
        )
      );
  }, [reloadTick]);

  /* live filter: classification chip + department + free-text search
     (+ the ⚠ warnings-only toggle) */
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lecturers.filter((l) => {
      /* ⚠ filter — keep only the rows showing the red warning badge */
      if (warningsOnly && !l.outOfRange) return false;

      const typeOk =
        typeFilter === "all"
          ? true
          : typeFilter === "PL"
            ? l.isPl
            : l.employmentType === typeFilter;
      if (!typeOk) return false;

      if (departmentFilter !== "all" && l.departmentCode !== departmentFilter) return false;

      if (!q) return true;
      return (
        l.fullName.toLowerCase().includes(q) ||
        l.staffId.toLowerCase().includes(q) ||
        (l.email ?? "").toLowerCase().includes(q) ||
        (l.position ?? "").toLowerCase().includes(q)
      );
    });
  }, [lecturers, query, typeFilter, departmentFilter, warningsOnly]);

  const sorted = useMemo(() => sortLecturers(matched, sorts), [matched, sorts]);
  const { bodyRef, prepareAnimation } = useTableSortAnimation(sorted);

  const toggleSort = (key: LecturerSortKey) => {
    prepareAnimation();
    setSorts((current) => toggleLecturerSort(current, key));
  };

  const sortDirection = (key: LecturerSortKey) => sorts.find((criterion) => criterion.key === key)?.direction ?? null;
  const sortPriority = (key: LecturerSortKey) => {
    const index = sorts.findIndex((criterion) => criterion.key === key);
    return index < 0 ? undefined : index + 1;
  };
  const sortSummary = sorts.length > 0
    ? `Sorting priority: ${sorts.map((criterion, index) => `${index + 1}. ${LECTURER_SORT_LABELS[criterion.key]} ${criterion.direction === "asc" ? "ascending" : "descending"}`).join("; ")}. Later columns break ties.`
    : "No sorting applied. The directory's original order is shown.";

  /* unique departments in the roster — the dropdown appears only with >1 */
  const departments = useMemo(() => {
    const map = new Map<string, string>();
    lecturers.forEach((l) => {
      if (l.departmentCode) map.set(l.departmentCode, l.departmentName ?? l.departmentCode);
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [lecturers]);

  /* how many staff currently resolve to each hour-limit rule */
  const staffCountByRule = useMemo(() => {
    const map: Record<string, number> = {};
    lecturers.forEach((l) => {
      map[l.ruleKey] = (map[l.ruleKey] ?? 0) + 1;
    });
    return map;
  }, [lecturers]);

  /** hard ceiling for any lecturer limit — the largest max in the rules */
  const limitCeiling = useMemo(
    () => (rules.length ? Math.max(...rules.map((r) => r.maxHours)) : 99),
    [rules]
  );

  /** roster members needing attention: their stored pair falls outside
      the rule's allowed min–max range (⚠ badge rows) */
  const limitAlertStaff = useMemo(
    () => lecturers.filter((l) => l.outOfRange),
    [lecturers]
  );
  const overCount = limitAlertStaff.length;

  /** summary toast text for the heading count badge */
  const overSummary = () => {
    const list = limitAlertStaff
      .map((s) => `${s.staffId} (${s.minHours}–${s.maxHours}h)`)
      .join(" · ");
    return `⚠ ${overCount} lecturer${overCount === 1 ? "" : "s"} need${overCount === 1 ? "s" : ""} attention — saved limit sits outside the rule's allowed range: ${list}. Snap each to the rule values (or set a limit within the range) from the Edit dialog.`;
  };

  /* footer note built from the live rule values */
  const ruleNote = useMemo(() => {
    if (rules.length === 0) return null;
    const get = (k: string) => rules.find((r) => r.ruleKey === k);
    const pieces: string[] = [];
    const pl = get("PL");
    if (pl) pieces.push(`PL min ${hoursLabel(pl.minHours)}h`);
    const bac = get("BACHELOR_ONLY");
    if (bac) pieces.push(`Bachelor-only min ${hoursLabel(bac.minHours)}h`);
    const bot = get("BOTH");
    if (bot) pieces.push(`both levels min ${hoursLabel(bot.minHours)}h`);
    const dip = get("DIPLOMA_ONLY");
    if (dip) pieces.push(`Diploma-only min ${hoursLabel(dip.minHours)}h`);
    const globalMax = Math.max(...rules.map((r) => r.maxHours));
    pieces.push(`overall max ${hoursLabel(globalMax)}h`);
    return pieces.join(" · ");
  }, [rules]);

  /* starter pair for newly created staff — the DEFAULT rule's suggestion
     (no courses assigned yet at creation time), editable in the dialog */
  const defaultRule =
    rules.find((r) => r.basis === "GLOBAL") ?? rules[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      {/* heading */}
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <h1 className="text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">
            Lecturers
          </h1>
          <p className="mt-1 text-[13px] text-textSecondary">
            Staff directory &amp; classifications · {department ?? "loading department…"}
          </p>
        </div>
        <div className="flex w-full min-w-0 items-center gap-sm sm:w-auto">
          <button
            type="button"
            onClick={() => { setLimitToast(null); setApplyRulesOpen(true); }}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-xs rounded-button bg-primary px-md py-sm text-[13px] font-medium leading-snug text-white shadow-card transition-all hover:bg-primaryHover active:scale-95 sm:flex-none"
          >
            <Clock3 size={17} className="shrink-0" />
            <span>Apply Hour-limit Rules</span>
          </button>
          {defaultRule && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              title="Add a staff member"
              className="flex h-11 shrink-0 items-center gap-xs rounded-button bg-primary px-md text-[13px] font-medium text-white shadow-card transition-all hover:bg-primaryHover active:scale-95"
            >
              <Plus size={16} />
              Add Staff
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-md flex flex-wrap items-center gap-sm">
          <p className="text-[13px] text-errorText">{error}</p>
          {/* one-click recovery from a transient backend outage — bumps
              reloadTick, which re-runs the roster fetch (no page reload) */}
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="flex h-8 items-center gap-xs rounded-button border border-errorText/30 bg-errorBg px-sm text-[12px] font-medium text-errorText transition-colors hover:border-errorText/60 active:scale-95"
          >
            <RefreshCcw size={14} /> Retry
          </button>
        </div>
      )}

      {/* filters: classification chips + search (theme 44px input) */}
      <div className="mt-lg flex flex-wrap items-center gap-sm">
        <FilterChip
          label="All"
          count={counts ? counts.total : null}
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
        />
        <FilterChip
          label="Full-time"
          count={counts ? counts.fullTime : null}
          active={typeFilter === "FULL_TIME"}
          onClick={() => setTypeFilter("FULL_TIME")}
        />
        <FilterChip
          label="Part-time"
          count={counts ? counts.partTime : null}
          active={typeFilter === "PART_TIME"}
          onClick={() => setTypeFilter("PART_TIME")}
        />
        <FilterChip
          label="Programme Leaders"
          count={counts ? counts.programmeLeaders : null}
          active={typeFilter === "PL"}
          onClick={() => setTypeFilter("PL")}
        />
        <FilterChip
          label={
            <span className="flex items-center gap-[3px]">
              <TriangleAlert size={13} />
              Warned
            </span>
          }
          count={overCount}
          active={warningsOnly}
          tone="error"
          onClick={() => setWarningsOnly((v) => !v)}
        />
        {/* department (when applicable) and search; sorting lives in the table headers */}
        <div className="ml-auto flex w-full flex-wrap items-center gap-sm sm:w-auto">
          {departments.length > 1 && (
            <FilterSelect
              ariaLabel="Filter by department"
              value={departmentFilter}
              onChange={setDepartmentFilter}
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.name}
                </option>
              ))}
            </FilterSelect>
          )}
          <div className="flex w-full min-w-0 items-center gap-sm sm:w-auto">
            <button type="button" onClick={() => { prepareAnimation(); setSorts([]); }} disabled={sorts.length === 0}
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, staff ID, email…"
                className="h-11 w-full rounded-button border border-divider bg-surface pl-10 pr-md text-[13.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
              />
            </div>
          </div>
        </div>
      </div>

      <p id="lecturer-sort-help" className="sr-only">Click headers to combine sorts in click order; later columns break ties. Use Clear Sort to start again.</p>
      <p id="lecturer-sort-summary" className="sr-only" aria-live="polite" aria-atomic="true">{sortSummary}</p>

      {/* The headers stay available on every screen; narrow screens scroll
          this table horizontally instead of hiding its sorting controls. */}
      <div className="mt-md overflow-x-auto rounded-card bg-surface shadow-card">
        <table aria-label="Lecturer directory" aria-describedby="lecturer-sort-help lecturer-sort-summary" className="w-full min-w-[1080px] table-fixed border-collapse text-left">
          <caption className="sr-only">Combine Lecturer, Staff ID, Workload limit and Status in sorting priority order. Down arrow means ascending; up arrow means descending.</caption>
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[112px]" />
            <col />
            <col className="w-[144px]" />
            <col className="w-[184px]" />
            <col className="w-[108px]" />
            <col className="w-[104px]" />
          </colgroup>
          <thead className="bg-surface">
            <tr className="border-b border-divider">
              <SortableTableHeader label="Lecturer" direction={sortDirection("name")} priority={sortPriority("name")}
                onSort={() => toggleSort("name")} className="pl-lg" />
              <SortableTableHeader label="Staff ID" direction={sortDirection("staffId")} priority={sortPriority("staffId")}
                onSort={() => toggleSort("staffId")} />
              <th scope="col" className="px-sm py-sm text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">Specialization &amp; Area of Interest</th>
              <th scope="col" className="px-sm py-sm text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">Classification</th>
              <SortableTableHeader label="Workload limit" direction={sortDirection("workloadLimit")} priority={sortPriority("workloadLimit")}
                onSort={() => toggleSort("workloadLimit")} description="Maximum workload-limit hours, then minimum hours" />
              <SortableTableHeader label="Status" direction={sortDirection("status")} priority={sortPriority("status")}
                onSort={() => toggleSort("status")} description="Ascending: Active first. Descending: Inactive first" />
              <th scope="col" className="py-sm pl-sm pr-lg text-[11px] font-semibold uppercase tracking-[0.06em] text-textSecondary">Actions</th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {lecturers.length === 0 && !error ? (
              <tr><td colSpan={7} className="px-lg py-xl">
                <div className="flex items-center gap-sm text-[13px] text-textSecondary">
                  <Users size={18} className="shrink-0" /> Loading lecturers from PostgreSQL…
                </div>
              </td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={7} className="px-lg py-xl text-center">
                <p className="text-[14px] font-medium text-textNormal">No lecturer found</p>
                <p className="mt-1 text-[12.5px] text-textSecondary">No staff member matches “{query.trim()}” with the selected filters.</p>
              </td></tr>
            ) : sorted.map((l) => (
              <tr key={l.id} className="border-b border-divider transition-colors last:border-b-0 hover:bg-hoverBg/60">
                <td className="py-md pl-lg pr-sm align-middle">
                  <div data-sort-motion={`${l.id}:name`}>
                    <p className="break-words text-[14px] font-semibold text-text">{l.fullName}</p>
                    <p className="mt-[2px] text-[12px] leading-snug text-textSecondary">
                      {l.position ?? "Lecturer"}
                      {l.academicYearRecords > 0
                        ? ` · ${l.academicYearRecords} academic-year record${l.academicYearRecords > 1 ? "s" : ""}` : ""}
                    </p>
                    <p className="mt-xs break-all text-[11.5px] leading-snug text-textSecondary">{l.email || "No email recorded"}</p>
                    {l.phone && <p className="mt-[2px] text-[11.5px] text-textSecondary">{l.phone}</p>}
                  </div>
                </td>
                <td className="px-sm py-md align-middle">
                  <span data-sort-motion={`${l.id}:staffId`} className="inline-block rounded-badge bg-background px-sm py-1 text-[12px] font-medium tracking-[0.04em] text-textNormal">{l.staffId}</span>
                </td>
                <td className="px-sm py-md align-middle">
                  <dl data-sort-motion={`${l.id}:profile`} className="min-w-0 space-y-xs break-words text-[12px] leading-snug">
                    <div>
                      <dt className="inline font-medium text-textNormal">Specialization: </dt>
                      <dd className="inline text-textSecondary">{l.specialization?.trim() || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-textNormal">Area of Interest: </dt>
                      <dd className="inline text-textSecondary">{l.areaOfInterest?.trim() || "Not recorded"}</dd>
                    </div>
                  </dl>
                </td>
                <td className="px-sm py-md align-middle">
                  <div data-sort-motion={`${l.id}:classification`} className="flex flex-wrap gap-xs">
                    {l.isPl && <span className="rounded-badge bg-primaryLight px-sm py-[3px] text-[11.5px] font-semibold text-primary">Programme Leader</span>}
                    <span className={`rounded-badge px-sm py-[3px] text-[11.5px] font-semibold ${EMPLOYMENT_CLS[l.employmentType]}`}>{EMPLOYMENT_LABEL[l.employmentType]}</span>
                  </div>
                </td>
                <td className="px-sm py-md align-middle">
                  <div data-sort-motion={`${l.id}:workloadLimit`}>
                    <WorkloadCell lecturer={l} limitCeiling={limitCeiling} onExceedToast={setLimitToast} />
                  </div>
                </td>
                <td className="px-sm py-md align-middle"><div data-sort-motion={`${l.id}:status`}><StatusDot lecturer={l} /></div></td>
                <td className="py-md pl-sm pr-lg align-middle">
                  <div data-sort-motion={`${l.id}:actions`} className="flex w-[72px] items-center gap-sm">
                    <button type="button" onClick={() => setEditing(l)} title={`Edit ${l.fullName}`} aria-label={`Edit ${l.fullName}`}
                      className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-primary hover:bg-primaryLight hover:text-primary active:scale-[0.97]">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => setDeleting(l)} title={`Delete ${l.fullName}`} aria-label={`Delete ${l.fullName}`}
                      className="flex h-8 w-8 items-center justify-center rounded-button border border-divider bg-surface text-textNormal transition-all hover:border-error hover:bg-errorBg hover:text-errorText active:scale-[0.97]">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* hour-limit rules editor — role/course-based limits (editable) */}
      <div ref={rulesAnchorRef} className="scroll-mt-[88px]">
        <RulesEditor
          rules={rules}
          staffCountByRule={staffCountByRule}
          onSaved={() => {
            setReloadTick((t) => t + 1);
          }}
        />
      </div>

      <p className="mt-md text-[12px] text-textSecondary">
        {counts
          ? `Showing ${sorted.length} of ${counts.total} staff — ${counts.fullTime} full-time · ${counts.partTime} part-time · ${counts.programmeLeaders} programme leader(s). ${
              ruleNote
                ? `Hour limits — ${ruleNote} — resolved per lecturer from role and courses taught.`
                : "Hour limit rules load with the roster."
            }`
          : "Hour limit rules load with the roster."}
      </p>

      {/* lecturer edit dialog (UC_CPM_01) with the live limit ceiling guard */}
      {editing && (
        <EditLecturerDialog
          lecturer={editing}
          ceiling={limitCeiling}
          onExceed={setLimitToast}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setLimitToast(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {/* add-staff dialog (UC_CPM_01) — creation form with position select */}
      {addOpen && defaultRule && (
        <AddStaffDialog
          defaultMin={defaultRule.minHours}
          defaultMax={defaultRule.maxHours}
          existingStaffIds={lecturers.map((l) => l.staffId)}
          ceiling={limitCeiling}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            setReloadTick((t) => t + 1);
          }}
        />
      )}

      {applyRulesOpen && (
        <ApplyHourLimitRulesDialog
          onClose={() => setApplyRulesOpen(false)}
          onSaved={(message) => {
            setApplyRulesOpen(false);
            setLimitToast(null);
            setWarningsOnly(false);
            setReloadTick((t) => t + 1);
            setStaffToast(message);
          }}
        />
      )}

      {/* deletion confirm dialog — destructive guard for row removal */}
      {deleting && (
        <DeleteStaffDialog
          lecturer={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(deleted) => {
            setDeleting(null);
            setReloadTick((t) => t + 1);
            setStaffToast(
              `The staff member ${deleted.fullName} (${deleted.staffId}) has been deleted successfully.`
            );
          }}
        />
      )}

      {/* exceed toast — after the dialog in the DOM so it paints above its backdrop */}
      {/* floating anchor button — pinned to the viewport's bottom-right,
          never scrolls with the page; #0071E3 primary button that jumps to
          the Hour-limit rules card, flipping to "back to top" after arrival */}
      <button
        type="button"
        onClick={jumpRulesOrTop}
        title={atRules ? "Back to the lecturers roster" : "Jump to the Hour-limit rules"}
        className="fixed bottom-6 right-6 z-40 flex h-11 items-center gap-xs rounded-button bg-primary px-md text-[13px] font-medium text-white shadow-card transition-all hover:bg-primaryHover hover:-translate-y-[1px] active:scale-95 animate-[badgeIn_0.3s_ease-out_both]"
      >
        {atRules ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        {atRules ? "Back to top" : "Hour-limit rules"}
      </button>

      <Toast message={limitToast} onDone={() => setLimitToast(null)} />
      <Toast tone="success" message={staffToast} onDone={() => setStaffToast(null)} />
    </div>
  );
}
