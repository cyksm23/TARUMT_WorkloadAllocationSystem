"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Info, Loader2, RefreshCcw, TriangleAlert, X } from "lucide-react";
import { apiFetch } from "@/services/apiClient";
import type { AutoAssignmentPlan } from "@/lib/server/auto-assignment";
import FilterSelect from "@/components/ui/FilterSelect";
import AutoAssignIcon from "@/components/allocations/AutoAssignIcon";
import { ASSIGNMENT_PRIORITIES, DEFAULT_ASSIGNMENT_PRIORITIES, PRIORITY_LABELS, type AssignmentPriority } from "@/lib/auto-assignment-options";

interface AutoAssignDialogProps {
  academicYears: Array<{ id: string; display: string }>;
  programmes: Array<{ code: string; name: string }>;
  initialAcademicYear: string;
  initialProgramme: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Only previews are kept in React state; Confirm saves the entire batch to
 * PostgreSQL. A stale preview must be regenerated, never silently replaced.
 */
export default function AutoAssignDialog({
  academicYears, programmes, initialAcademicYear, initialProgramme, onClose, onSaved,
}: AutoAssignDialogProps) {
  const [academicYear, setAcademicYear] = useState(initialAcademicYear === "all" ? "" : initialAcademicYear);
  const [programme, setProgramme] = useState(initialProgramme);
  const [priorities, setPriorities] = useState<AssignmentPriority[]>(() => [...DEFAULT_ASSIGNMENT_PRIORITIES]);
  const [plan, setPlan] = useState<AutoAssignmentPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const policyOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy !== null;
  policyOpenRef.current = policyOpen;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLButtonElement>("button[aria-haspopup='listbox']")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && policyOpenRef.current) {
        event.preventDefault();
        setPolicyOpen(false);
        return;
      }
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']",
      );
      if (!focusable?.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (policyOpenRef.current && !policyRef.current?.contains(event.target as Node)) setPolicyOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      requestRef.current?.abort();
      previousFocus?.focus();
    };
  }, []);

  const clearPreview = () => {
    setPlan(null);
    setError(null);
  };

  const changePriority = (position: number, criterion: AssignmentPriority) => {
    setPriorities((current) => {
      const next = [...current];
      const previousPosition = next.indexOf(criterion);
      next[previousPosition] = next[position];
      next[position] = criterion;
      return next;
    });
    clearPreview();
  };

  const run = async (action: "preview" | "commit") => {
    if (busyRef.current || !academicYear || (action === "commit" && !plan?.proposals.length)) return;
    busyRef.current = true;
    setBusy(action);
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await apiFetch("/api/allocations/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          academicYearId: Number(academicYear),
          programmeCode: programme === "all" ? null : programme,
          priorities,
          ...(action === "commit" ? { previewToken: plan?.previewToken } : {}),
        }),
      });
      const data = await response.json() as { ok: boolean; plan?: AutoAssignmentPlan; message?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !data.ok) {
        if (action === "commit" && response.status === 409) setPlan(null);
        setError(data.message ?? "Auto assignment could not be completed.");
      } else if (action === "preview" && data.plan) {
        setPlan(data.plan);
      } else if (action === "commit") {
        onSaved(data.message ?? "Automatic assignments saved successfully.");
      }
    } catch {
      if (!controller.signal.aborted) setError("Connection failed. Reload assignments before retrying a save; generate a new preview if the data changed.");
    } finally {
      busyRef.current = false;
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-assign-title"
        aria-describedby="auto-assign-description"
        aria-busy={busy !== null}
        className="animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full max-w-[860px] overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card"
      >
        <div className="flex items-start justify-between gap-md">
          <div>
            <div ref={policyRef} className="relative w-fit max-w-full">
              <div className="flex items-center gap-xs">
                <h2 id="auto-assign-title" className="flex items-center gap-sm text-[18px] font-bold leading-[26px] text-text">
                  <AutoAssignIcon size={23} className="text-primary" /> Auto Assign
                </h2>
                <button
                  type="button"
                  aria-label={`${policyOpen ? "Hide" : "Show"} Auto Assign policy information`}
                  aria-expanded={policyOpen}
                  aria-controls="auto-assign-policy"
                  title="Auto Assign policy information"
                  onClick={() => setPolicyOpen((open) => !open)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primaryLight focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primaryLight"
                >
                  <Info size={17} aria-hidden="true" />
                </button>
              </div>
              {policyOpen && (
                <div
                  id="auto-assign-policy"
                  role="note"
                  aria-label="Auto Assign policy"
                  className="absolute left-0 top-[calc(100%+8px)] z-40 w-[calc(100vw-64px)] max-w-[420px] rounded-card border border-divider bg-surface p-md text-[12px] font-normal leading-relaxed text-textSecondary shadow-card"
                >
                  <p>Only active, unassigned courses are included. One lecturer takes all L/T/P slots; existing assignments are never replaced.</p>
                  <p className="mt-xs">Workload preference means staff below their minimum target first, then the lowest projected percentage of maximum teaching hours. Maximum hours and existing 3 Bachelor / 4 Diploma course limits cannot be exceeded.</p>
                  <p className="mt-xs">A lecturer still needs a matching specialization, interest or past course record. Specializations are not guessed. History uses saved assignments from earlier completed terms only—not current/future plans or proof of teaching qualifications.</p>
                </div>
              )}
            </div>
            <p id="auto-assign-description" className="mt-[2px] text-[12.5px] text-textSecondary">
              Choose the order for workload, specialization, interest and previous-course matching.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy !== null} aria-label="Close Auto Assign"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-textSecondary transition-colors hover:bg-hoverBg hover:text-text disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <fieldset disabled={busy !== null} className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2">
          <legend className="sr-only">Assignment scope</legend>
          <div className="min-w-0">
            <p className="mb-xs text-[12px] font-semibold text-textNormal">Academic Year</p>
            <FilterSelect ariaLabel="Auto Assign academic year" value={academicYear} fullWidth disabled={busy !== null}
              onChange={(value) => { setAcademicYear(value); clearPreview(); }}>
              <option value="">Select an academic year…</option>
              {academicYears.map((year) => <option key={year.id} value={year.id}>{year.display}</option>)}
            </FilterSelect>
          </div>
          <div className="min-w-0">
            <p className="mb-xs text-[12px] font-semibold text-textNormal">Programme</p>
            <FilterSelect ariaLabel="Auto Assign programme" value={programme} fullWidth disabled={busy !== null}
              onChange={(value) => { setProgramme(value); clearPreview(); }}>
              <option value="all">All programmes</option>
              {programmes.map((item) => <option key={item.code} value={item.code}>{`${item.code} · ${item.name}`}</option>)}
            </FilterSelect>
          </div>
        </fieldset>

        <fieldset disabled={busy !== null} className="mt-md min-w-0">
          <legend className="text-[12px] font-semibold text-textNormal">Matching priorities</legend>
          <p className="mt-xs text-[11.5px] leading-snug text-textSecondary">
            Higher priorities are compared first; later ones break ties. Choosing an already-used criterion swaps the two positions.
          </p>
          <div className="mt-sm grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {priorities.map((priority, index) => (
              <div key={index} className="min-w-0">
                <p className="mb-xs text-[11.5px] font-medium text-textSecondary">{["1st", "2nd", "3rd", "4th"][index]} priority</p>
                <FilterSelect
                  ariaLabel={`Auto Assign priority ${index + 1}`}
                  value={priority}
                  onChange={(value) => changePriority(index, value as AssignmentPriority)}
                  fullWidth
                  disabled={busy !== null}
                  searchable={false}
                  menuWidth={220}
                  triggerClassName="h-14"
                >
                  {ASSIGNMENT_PRIORITIES.map((criterion) => <option key={criterion} value={criterion}>{PRIORITY_LABELS[criterion]}</option>)}
                </FilterSelect>
              </div>
            ))}
          </div>
        </fieldset>

        {busy === "preview" && (
          <p role="status" className="mt-lg flex items-center gap-sm text-[13px] text-textSecondary">
            <Loader2 size={16} className="animate-spin" /> Checking profiles, workloads and earlier course assignments…
          </p>
        )}

        {plan && (
          <div className="mt-lg" aria-live="polite">
            <div className="flex flex-wrap gap-sm text-[12px] font-medium">
              <span className="rounded-badge bg-primaryLight px-md py-xs text-primary">{plan.proposals.length} suggested</span>
              <span className="rounded-badge bg-background px-md py-xs text-textSecondary">{plan.existingCount} existing kept</span>
              <span className="rounded-badge bg-background px-md py-xs text-textSecondary">{plan.inactiveCount} inactive skipped</span>
              <span className="rounded-badge bg-background px-md py-xs text-textSecondary">{plan.unassigned.length} without a suitable lecturer</span>
            </div>
            <p className="mt-sm text-[12px] font-medium text-textNormal">
              Priority order: {plan.priorities.map((priority) => PRIORITY_LABELS[priority]).join(" → ")}
            </p>
            <p className="mt-xs text-[11.5px] leading-snug text-textSecondary">
              {plan.historyRecordCount > 0
                ? `${plan.historyRecordCount} earlier completed-term course assignment${plan.historyRecordCount === 1 ? "" : "s"} available as history evidence.`
                : "No earlier completed-term course assignments are recorded; history cannot influence this preview."}
            </p>

            {plan.proposals.length > 0 ? (
              <div className="mt-md flex flex-col gap-sm">
                {plan.proposals.map((proposal) => (
                  <div key={proposal.subjectCode} className="animate-[rowIn_0.26s_ease-out_both] rounded-card border border-divider p-md">
                    <div className="flex flex-wrap items-start justify-between gap-sm">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-text"><span className="text-primary">{proposal.subjectCode}</span> · {proposal.subjectName}</p>
                        <p className="mt-1 text-[12.5px] font-medium text-textNormal">{proposal.lecturerName} · {proposal.staffId}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-semibold text-primary">{proposal.beforeHours} → {proposal.afterHours} h/week</p>
                        <p className="text-[11.5px] text-textSecondary">+{proposal.weeklyHours} h · maximum {proposal.maxHours} h</p>
                      </div>
                    </div>
                    <dl className="mt-sm grid grid-cols-1 gap-xs text-[12px] leading-snug sm:grid-cols-[110px_1fr]">
                      <dt className="text-textSecondary">Area of interest</dt><dd className="text-textNormal">{proposal.areaOfInterest || "Not recorded"}</dd>
                      <dt className="text-textSecondary">Specialization</dt><dd className="text-textNormal">{proposal.specialization || "Not recorded"}</dd>
                      <dt className="text-textSecondary">Previous courses</dt>
                      <dd className="text-textNormal">
                        {proposal.historyMatches.length > 0 ? (
                          <ul className="space-y-1">
                            {proposal.historyMatches.map((match) => (
                              <li key={`${match.subjectCode}|${match.academicYearLabel}`}>
                                {match.subjectCode} · {match.subjectName}
                                <span className="block text-[11.5px] text-textSecondary">{match.academicYearLabel} · {match.matchType === "same_course" ? "same course" : "related course"}</span>
                              </li>
                            ))}
                          </ul>
                        ) : "No matching earlier completed-term record."}
                      </dd>
                      <dt className="text-textSecondary">Why this lecturer</dt>
                      <dd className="text-textNormal">
                        {plan.priorities.map((priority) => {
                          if (priority === "workload") return proposal.beforeHours < proposal.minHours ? "Workload: below minimum-hours target, with available capacity." : "Workload: fits maximum teaching hours.";
                          if (priority === "specialization" && proposal.specializationMatches.length > 0) return `Specialization: ${proposal.specializationMatches.join(", ")}.`;
                          if (priority === "interest" && proposal.interestMatches.length > 0) return `Interest: ${proposal.interestMatches.join(", ")}.`;
                          if (priority === "history" && proposal.historyMatches.length > 0) return "History: matching earlier course assignments recorded.";
                          return "";
                        }).filter(Boolean).join(" ")}
                      </dd>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-md rounded-card bg-background p-md text-[13px] text-textSecondary">
                {plan.unassigned.length > 0 ? "No suitable assignments could be generated. See the reasons below." : "No unassigned active courses in this selection."}
              </p>
            )}

            {plan.unassigned.length > 0 && (
              <div className="mt-md rounded-card border border-divider bg-background p-md">
                <h3 className="flex items-center gap-xs text-[13px] font-semibold text-errorText"><TriangleAlert size={14} /> Left unassigned</h3>
                <ul className="mt-sm space-y-sm">
                  {plan.unassigned.map((course) => (
                    <li key={course.subjectCode} className="text-[12px] leading-snug">
                      <p className="font-medium text-textNormal">{course.subjectCode} · {course.subjectName}</p>
                      <p className="mt-1 text-textSecondary">{course.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-md text-[11.5px] leading-snug text-textSecondary">
              Weekly hours use the existing L + T + P calculation, without a class-group multiplier. Course caps retain the manual assignment policy’s across-all-years scope. Nothing is saved until you confirm.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="animate-[badgeIn_0.2s_ease-out_both] mt-md flex items-start gap-xs text-[12px] font-medium text-errorText">
            <TriangleAlert size={14} className="mt-[2px] shrink-0" /> {error}
          </p>
        )}

        <div className="mt-lg flex flex-wrap items-center justify-end gap-sm border-t border-divider pt-md">
          <button type="button" onClick={onClose} disabled={busy !== null}
            className="h-10 rounded-button border border-divider bg-surface px-md text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => run("preview")} disabled={!academicYear || busy !== null}
            className={`flex h-10 items-center gap-xs rounded-button px-md text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${plan ? "border border-divider bg-surface text-textNormal hover:bg-hoverBg" : "bg-primary text-white hover:bg-primaryHover"}`}>
            {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : plan ? <RefreshCcw size={14} /> : <AutoAssignIcon size={18} />}
            {busy === "preview" ? "Generating…" : plan ? "Regenerate preview" : "Generate preview"}
          </button>
          {plan && (
            <button type="button" onClick={() => run("commit")} disabled={plan.proposals.length === 0 || busy !== null}
              className="flex h-10 items-center gap-xs rounded-button bg-primary px-md text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50">
              {busy === "commit" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {busy === "commit" ? "Saving…" : `Confirm & save ${plan.proposals.length} course${plan.proposals.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
