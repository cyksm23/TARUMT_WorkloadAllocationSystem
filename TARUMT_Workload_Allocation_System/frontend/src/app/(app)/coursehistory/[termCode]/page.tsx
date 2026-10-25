"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCcw,
  UserRound,
} from "lucide-react";
import FilterSelect from "@/components/ui/FilterSelect";
import type {
  CourseHistoryAssignment,
  CourseHistoryTermDetail,
  TeachingActivity,
} from "@/lib/server/course-history";
import { apiFetch } from "@/services/apiClient";

interface CourseHistoryDetailResponse extends Partial<CourseHistoryTermDetail> {
  ok: boolean;
  message?: string;
}

const ACTIVITY: Record<TeachingActivity, { short: string; label: string; tone: string }> = {
  LECTURE: { short: "L", label: "Lecture", tone: "bg-primaryLight text-primary" },
  TUTORIAL: { short: "T", label: "Tutorial", tone: "bg-warningBg text-warningText" },
  PRACTICAL: { short: "P", label: "Practical", tone: "bg-successBg text-successText" },
};

const numberFormatter = new Intl.NumberFormat("en-MY", { maximumFractionDigits: 2 });
const hours = (value: number) => `${numberFormatter.format(value)} h`;

function lecturerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0]?.slice(0, 2) ?? "—").toUpperCase();
}

function statusTone(status: string): string {
  if (status === "APPROVED") return "bg-successBg text-successText";
  if (status === "PENDING") return "bg-warningBg text-warningText";
  if (status === "REJECTED") return "bg-errorBg text-errorText";
  return "bg-background text-textSecondary";
}

function AssignmentCard({ assignment }: { assignment: CourseHistoryAssignment }) {
  const [open, setOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const reactId = useId().replace(/:/g, "");
  const headingId = `course-history-heading-${reactId}`;
  const panelId = `course-history-panel-${reactId}`;
  const arrowImage = `/icons/${open ? "sortup.png" : "sortdown.png"}`;
  const totalCreditHours = Number(assignment.lectureHours) +
    Number(assignment.tutorialHours) + Number(assignment.practicalHours);
  const savedHours = (activityType: TeachingActivity) =>
    assignment.slots.find((slot) => slot.activityType === activityType)?.hoursPerWeek ?? 0;

  const togglePanel = () => {
    if (open) {
      setOpen(false);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setPanelMounted(false);
      }
      return;
    }

    setPanelMounted(true);
    setOpen(true);
  };

  return (
    <article
      data-history-course={assignment.subjectCode}
      data-history-motion
      className="overflow-hidden rounded-card border border-transparent bg-surface shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-dashboard"
    >
      <div
        role="button"
        tabIndex={0}
        data-course-disclosure={assignment.subjectCode}
        data-disclosure-icon={open ? "sortup.png" : "sortdown.png"}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? "Hide" : "Show"} assigned lecturers for ${assignment.subjectCode}`}
        title={`${open ? "Hide" : "Show"} assigned lecturers`}
        onClick={togglePanel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            togglePanel();
          }
        }}
        className={`group flex cursor-pointer flex-wrap items-start justify-between gap-md px-lg py-md text-left outline-none transition-colors duration-300 hover:bg-hoverBg/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${panelMounted ? "border-b border-divider bg-primaryLight/20" : ""}`}
      >
        <div className="min-w-0">
          <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-primary">{assignment.subjectCode}</p>
          <h3 id={headingId} className="mt-1 break-words text-[16px] font-semibold leading-[22px] text-text">{assignment.subjectName}</h3>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-xs">
          <div className="flex flex-wrap items-center justify-end gap-xs text-[11.5px] text-textSecondary">
            <span className="rounded-badge bg-background px-sm py-xs" title="Lecture + tutorial + practical">
              {numberFormatter.format(totalCreditHours)} total credit hours
            </span>
            <span className="rounded-badge bg-background px-sm py-xs">{assignment.studentCount} students</span>
            <span className="rounded-badge bg-background px-sm py-xs" title="Saved lecture, tutorial and practical hours per week">
              L {numberFormatter.format(savedHours("LECTURE"))} · T {numberFormatter.format(savedHours("TUTORIAL"))} · P {numberFormatter.format(savedHours("PRACTICAL"))} / wk
            </span>
          </div>
          <span
            aria-hidden="true"
            data-history-motion
            className="flex h-9 w-9 shrink-0 items-center justify-center text-textSecondary transition-colors duration-200 group-hover:text-primary"
          >
            <span
              key={open ? "expanded" : "collapsed"}
              aria-hidden="true"
              className="history-icon-swap inline-block h-3.5 w-3.5 bg-current"
              style={{
                maskImage: `url('${arrowImage}')`,
                WebkitMaskImage: `url('${arrowImage}')`,
                maskSize: "contain",
                WebkitMaskSize: "contain",
                maskPosition: "center",
                WebkitMaskPosition: "center",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
              }}
            />
          </span>
        </div>
      </div>

      {panelMounted && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headingId}
          aria-hidden={!open}
          data-history-motion
          data-panel-state={open ? "open" : "closing"}
          onAnimationEnd={(event) => {
            if (event.currentTarget === event.target && event.animationName === "historyPanelOut" && !open) {
              setPanelMounted(false);
            }
          }}
          className={open ? "history-panel-enter" : "history-panel-exit"}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="divide-y divide-divider">
              {assignment.slots.map((slot, slotIndex) => {
                const activity = ACTIVITY[slot.activityType];
                return (
                  <div
                    key={`${slot.activityType}-${slot.lecturerId}-${slotIndex}`}
                    data-history-slot={slot.activityType}
                    style={{ animationDelay: `${slotIndex * 45}ms` }}
                    className={`${open ? "history-slot-enter" : ""} grid grid-cols-1 gap-md px-lg py-md transition-colors hover:bg-hoverBg/50 sm:grid-cols-[minmax(120px,0.7fr)_minmax(220px,1.6fr)_minmax(120px,0.7fr)] sm:items-center`}
                  >
                    <div className="flex min-w-0 items-center gap-sm">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-[12px] font-bold ${activity.tone}`}>
                        {activity.short}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold text-text">{activity.label}</p>
                        <p className="text-[11.5px] text-textSecondary">{hours(slot.hoursPerWeek)} / week</p>
                      </div>
                    </div>

                    <div className="flex min-w-0 items-center gap-sm">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-badge bg-primaryLight text-[11px] font-bold text-primary">
                        {lecturerInitials(slot.lecturerName)}
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-[13px] font-semibold leading-[18px] text-text">{slot.lecturerName}</p>
                        <p className="break-words text-[11.5px] leading-[17px] text-textSecondary">
                          Staff {slot.staffId}{slot.position ? ` · ${slot.position}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex min-w-0 items-center justify-between gap-sm sm:block sm:text-right">
                      <div>
                        <p className="text-[12.5px] font-semibold text-text">{hours(slot.totalHours)}</p>
                        <p className="text-[11px] text-textSecondary">term total</p>
                      </div>
                      <span className={`rounded-badge px-sm py-[3px] text-[10px] font-semibold ${statusTone(slot.status)} sm:mt-xs sm:inline-block`}>
                        {slot.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

interface PageProps {
  params: { termCode: string };
  searchParams: { programme?: string | string[] };
}

/** Programme-first view of one term's saved L/T/P lecturer assignments. */
export default function CourseHistoryTermPage({ params, searchParams }: PageProps) {
  const termCode = params.termCode;
  const rawProgramme = Array.isArray(searchParams.programme) ? searchParams.programme[0] : searchParams.programme;
  const initialSelectedCode = rawProgramme?.trim().toUpperCase() ?? "";
  const [selectedCode, setSelectedCode] = useState(initialSelectedCode);
  const [detail, setDetail] = useState<CourseHistoryTermDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setSelectedCode(initialSelectedCode);
  }, [initialSelectedCode]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const programmeQuery = selectedCode
          ? `?programmeCode=${encodeURIComponent(selectedCode)}`
          : "";
        const response = await apiFetch(
          `/api/course-history/${encodeURIComponent(termCode)}${programmeQuery}`,
          { signal: controller.signal },
        );
        const body = (await response.json()) as CourseHistoryDetailResponse;
        if (!response.ok || !body.ok || !body.term || !Array.isArray(body.programmes) || !Array.isArray(body.assignments)) {
          throw new Error(body.message ?? `Course history for ${termCode} could not be loaded.`);
        }
        setDetail(body as CourseHistoryTermDetail & { ok: boolean });
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : `Course history for ${termCode} could not be loaded.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [termCode, selectedCode, reloadTick]);

  useEffect(() => {
    const syncSelectionFromUrl = () => {
      const programmeCode = new URLSearchParams(window.location.search).get("programme");
      setSelectedCode(programmeCode?.trim().toUpperCase() ?? "");
    };

    window.addEventListener("popstate", syncSelectionFromUrl);
    return () => window.removeEventListener("popstate", syncSelectionFromUrl);
  }, []);

  const chooseProgramme = (programmeCode: string) => {
    if (programmeCode === selectedCode) return;
    setLoading(true);
    setError(null);
    setSelectedCode(programmeCode);

    const url = new URL(window.location.href);
    if (programmeCode) url.searchParams.set("programme", programmeCode);
    else url.searchParams.delete("programme");
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <nav aria-label="Breadcrumb" className="history-reveal flex items-center justify-between gap-sm text-[12.5px]">
        <div className="flex min-w-0 items-center gap-xs whitespace-nowrap">
          <Link href="/coursehistory" className="font-medium text-primary transition-colors hover:text-primaryHover hover:underline">
            Course History
          </Link>
          <ChevronRight size={14} className="shrink-0 text-textPlaceholder" aria-hidden="true" />
          <span aria-current="page" className="font-semibold text-textNormal">{termCode}</span>
        </div>
        <Link
          href="/coursehistory"
          aria-label="Back to Course History"
          title="Back to Course History"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-xs rounded-button border border-[#0071E3] bg-[#0071E3] px-xs text-[12.5px] font-medium text-white shadow-card outline-none transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[#005BB5] hover:bg-[#005BB5] focus-visible:ring-4 focus-visible:ring-primaryLight active:translate-y-0 active:border-[#004A99] active:bg-[#004A99] sm:px-md"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Back</span>
        </Link>
      </nav>

      {!detail && loading ? (
        <div className="mt-lg flex min-h-[300px] items-center justify-center rounded-card bg-surface shadow-card" aria-live="polite">
          <div className="text-center">
            <Loader2 size={24} className="mx-auto animate-spin text-primary" />
            <p className="mt-sm text-[13px] text-textSecondary">Loading {termCode} programmes…</p>
          </div>
        </div>
      ) : !detail && error ? (
        <div role="alert" className="mt-lg rounded-card border border-error/20 bg-errorBg p-lg">
          <p className="text-[15px] font-semibold text-errorText">Unable to open {termCode}</p>
          <p className="mt-xs break-words text-[13px] text-errorText/80">{error}</p>
          <div className="mt-md flex flex-wrap gap-sm">
            <button
              type="button"
              onClick={() => setReloadTick((tick) => tick + 1)}
              className="flex h-9 items-center gap-xs rounded-button bg-errorText px-md text-[12.5px] font-medium text-white transition-colors hover:bg-errorHover active:scale-95"
            >
              <RefreshCcw size={14} /> Retry
            </button>
            <Link href="/coursehistory" className="flex h-9 items-center gap-xs rounded-button border border-errorText/30 bg-surface px-md text-[12.5px] font-medium text-errorText">
              <ArrowLeft size={14} /> All terms
            </Link>
          </div>
        </div>
      ) : detail ? (
        <>
          <header className="history-reveal relative z-20 mt-md" style={{ animationDelay: "55ms" }}>
            <div className="flex flex-col gap-lg md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h1 className="text-[30px] font-bold leading-[38px] tracking-[-0.02em] text-text">{detail.term.termCode}</h1>
                <p className="mt-xs break-words text-[14px] font-medium text-textNormal">{detail.term.termName} · AY {detail.term.yearCode}</p>
              </div>

              <div className="w-full md:w-[340px]">
                <h2 id="programme-choice-heading" className="text-[14px] font-semibold text-text">Choose a programme</h2>
                {detail.programmes.length > 0 ? (
                  <div
                    data-programme-select
                    data-selected-programme={selectedCode || "all"}
                    className="mt-sm"
                  >
                    <FilterSelect
                      ariaLabel="Choose a programme"
                      value={selectedCode || "all"}
                      onChange={(value) => chooseProgramme(value === "all" ? "" : value)}
                      fullWidth
                      searchable
                      menuWidth={360}
                      triggerClassName="min-h-10 shadow-card"
                    >
                      <option value="all">All programmes</option>
                      {detail.programmes.map((programme) => (
                        <option key={programme.code} value={programme.code}>
                          {programme.code} · {programme.name}
                        </option>
                      ))}
                    </FilterSelect>
                  </div>
                ) : (
                  <p className="mt-sm text-[12.5px] text-textSecondary">No programme has saved assignments for this term.</p>
                )}
              </div>
            </div>
          </header>

          {error && (
            <div role="alert" className="mt-md flex flex-wrap items-center justify-between gap-sm rounded-card border border-error/20 bg-errorBg p-md">
              <p className="min-w-0 break-words text-[12.5px] text-errorText">{error}</p>
              <button type="button" onClick={() => setReloadTick((tick) => tick + 1)} className="flex h-8 shrink-0 items-center gap-xs rounded-button bg-surface px-sm text-[12px] font-medium text-errorText">
                <RefreshCcw size={13} /> Retry
              </button>
            </div>
          )}

          {selectedCode && loading ? (
            <div className="history-content-enter mt-lg flex min-h-[150px] items-center justify-center rounded-card bg-surface shadow-card" aria-live="polite">
              <div className="text-center">
                <p className="text-[13px] font-medium text-textSecondary">Loading {selectedCode} assignments…</p>
                <div className="mx-auto mt-sm h-1 w-32 overflow-hidden rounded-badge bg-primaryLight" aria-hidden="true">
                  <span className="history-loading-bar block h-full w-1/3 rounded-badge bg-primary" />
                </div>
              </div>
            </div>
          ) : !selectedCode ? (
            <div className="history-content-enter mt-lg rounded-card border border-dashed border-border bg-surface/60 px-lg py-xl text-center">
              <UserRound size={23} className="mx-auto text-textPlaceholder" />
              <p className="mt-sm text-[14px] font-semibold text-textNormal">Choose a programme above</p>
              <p className="mt-1 text-[12.5px] text-textSecondary">Its saved courses and L/T/P lecturers will appear here.</p>
            </div>
          ) : !error && detail.selectedProgramme ? (
            <section key={detail.selectedProgramme.code} className="history-content-enter mt-xl" aria-labelledby="assignment-history-heading">
              <div className="flex flex-wrap items-end justify-between gap-md">
                <div className="min-w-0">
                  <h2 id="assignment-history-heading" className="break-words text-[19px] font-semibold text-text">
                    {detail.selectedProgramme.code} course assignments
                  </h2>
                  <p className="mt-1 break-words text-[12.5px] text-textSecondary">{detail.selectedProgramme.name} · lecturer shown separately for each teaching activity</p>
                </div>
                <span className="history-icon-swap flex items-center gap-xs rounded-badge bg-primaryLight px-md py-sm text-[11.5px] font-semibold text-primary">
                  <Clock3 size={13} /> {detail.assignments.length} saved course{detail.assignments.length === 1 ? "" : "s"}
                </span>
              </div>

              {detail.assignments.length === 0 ? (
                <div className="mt-md rounded-card bg-surface p-lg text-center shadow-card">
                  <BookOpen size={22} className="mx-auto text-textSecondary" />
                  <p className="mt-sm text-[13px] text-textSecondary">No saved assignments were found for this programme.</p>
                </div>
              ) : (
                <div className="mt-md space-y-md">
                  {detail.assignments.map((assignment) => (
                    <AssignmentCard key={assignment.subjectCode} assignment={assignment} />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
