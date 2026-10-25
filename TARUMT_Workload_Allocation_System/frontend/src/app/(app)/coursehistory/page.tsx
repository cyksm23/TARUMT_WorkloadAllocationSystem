"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Database,
  GraduationCap,
  Loader2,
  RefreshCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import type { CourseHistoryTermSummary } from "@/lib/server/course-history";
import { apiFetch } from "@/services/apiClient";

interface CourseHistoryTermsResponse {
  ok: boolean;
  terms?: CourseHistoryTermSummary[];
  message?: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00`));

/** Saved course-to-lecturer assignments, grouped by coded academic term. */
export default function CourseHistoryPage() {
  const [terms, setTerms] = useState<CourseHistoryTermSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTerms = normalizedSearch
    ? terms.filter((term) => [
        term.termCode,
        term.termName,
        term.yearCode,
        formatDate(term.startDate),
        formatDate(term.endDate),
      ].some((value) => value.toLowerCase().includes(normalizedSearch)))
    : terms;

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch("/api/course-history", { signal: controller.signal });
        const body = (await response.json()) as CourseHistoryTermsResponse;
        if (!response.ok || !body.ok || !Array.isArray(body.terms)) {
          throw new Error(body.message ?? "Course history could not be loaded.");
        }
        setTerms(body.terms);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Course history could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [reloadTick]);

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <div className="history-reveal">
        <h1 className="text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">
          Course History
        </h1>
      </div>

      {error && (
        <div role="alert" className="mt-lg flex flex-wrap items-center justify-between gap-md rounded-card border border-error/20 bg-errorBg p-md">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-errorText">Unable to load course history</p>
            <p className="mt-1 break-words text-[12.5px] text-errorText/80">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setReloadTick((tick) => tick + 1)}
            className="flex h-9 shrink-0 items-center gap-xs rounded-button border border-errorText/30 bg-surface px-md text-[12.5px] font-medium text-errorText transition-colors hover:border-errorText/60 active:scale-95"
          >
            <RefreshCcw size={14} /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-lg flex min-h-[260px] items-center justify-center rounded-card bg-surface shadow-card" aria-live="polite">
          <div className="text-center">
            <Loader2 size={24} className="mx-auto animate-spin text-primary" />
            <p className="mt-sm text-[13px] text-textSecondary">Loading saved assignments from PostgreSQL…</p>
          </div>
        </div>
      ) : !error && terms.length === 0 ? (
        <div className="mt-lg rounded-card bg-surface px-lg py-xxl text-center shadow-card">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-badge bg-background text-textSecondary">
            <Database size={24} />
          </span>
          <h2 className="mt-md text-[16px] font-semibold text-text">No saved course history yet</h2>
          <p className="mx-auto mt-xs max-w-[480px] text-[13px] leading-[20px] text-textSecondary">
            Academic terms appear here after at least one course assignment has been saved.
          </p>
        </div>
      ) : !error ? (
        <section className="mt-lg" aria-labelledby="history-terms-heading">
          <div className="mb-sm flex flex-wrap items-center justify-between gap-md">
            <h2 id="history-terms-heading" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-textSecondary">
              Academic terms
            </h2>
            <label className="relative w-full sm:w-[280px]">
              <span className="sr-only">Quick search academic terms</span>
              <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-textPlaceholder" />
              <input
                ref={searchRef}
                type="search"
                data-history-search
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Quick search..."
                className="h-10 w-full appearance-none rounded-input border border-divider bg-surface pl-10 pr-10 text-[12.5px] text-text shadow-card outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-textPlaceholder hover:border-primary/30 focus:border-primary focus:ring-4 focus:ring-primaryLight [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search && (
                <button
                  type="button"
                  data-clear-history-search
                  aria-label="Clear quick search"
                  title="Clear search"
                  onClick={() => {
                    setSearch("");
                    searchRef.current?.focus();
                  }}
                  className="history-icon-swap absolute right-sm top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-button text-textSecondary outline-none transition-colors hover:bg-hoverBg hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </label>
          </div>

          <div
            key={normalizedSearch || "all-terms"}
            data-history-search-results
            data-search-state={normalizedSearch || "all-terms"}
            aria-live="polite"
            className="history-content-enter"
          >
            {filteredTerms.length === 0 ? (
              <div className="rounded-card border border-dashed border-border bg-surface/60 px-lg py-xl text-center">
                <Search size={22} className="mx-auto text-textPlaceholder" aria-hidden="true" />
                <p className="mt-sm text-[13.5px] font-semibold text-textNormal">No matching academic terms</p>
                <p className="mt-1 break-words text-[12.5px] text-textSecondary">No results for “{search.trim()}”.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
                {filteredTerms.map((term, index) => (
                  <Link
                    key={`${term.yearCode}-${term.termCode}`}
                    href={`/coursehistory/${encodeURIComponent(term.termCode)}`}
                    data-history-term={term.termCode}
                    data-history-motion
                    style={{ animationDelay: `${Math.min(index * 55, 330)}ms` }}
                    className="group history-reveal rounded-card border border-transparent bg-surface p-lg shadow-card outline-none transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-dashboard focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primaryLight active:scale-[0.99]"
                  >
                    <div className="flex items-start gap-md">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[22px] font-bold tracking-[-0.01em] text-text">{term.termCode}</h2>
                        <p className="mt-[2px] break-words text-[13.5px] font-medium text-textNormal">{term.termName}</p>
                        <p className="mt-1 text-[12px] text-textSecondary">
                          AY {term.yearCode} · {formatDate(term.startDate)} – {formatDate(term.endDate)}
                        </p>
                      </div>
                      <ArrowRight size={18} data-history-motion className="mt-1 shrink-0 text-textPlaceholder transition-all group-hover:translate-x-1 group-hover:text-primary" />
                    </div>

                    <div className="mt-lg grid grid-cols-3 gap-sm border-t border-divider pt-md">
                      <div className="min-w-0">
                        <BookOpen size={14} data-history-motion className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" />
                        <p className="mt-xs text-[13px] font-semibold text-text">{term.courseCount}</p>
                        <p className="text-[11px] text-textSecondary">Course{term.courseCount === 1 ? "" : "s"}</p>
                      </div>
                      <div className="min-w-0 border-l border-divider pl-sm">
                        <GraduationCap size={14} data-history-motion className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" />
                        <p className="mt-xs text-[13px] font-semibold text-text">{term.programmeCount}</p>
                        <p className="break-words text-[11px] text-textSecondary">Programme{term.programmeCount === 1 ? "" : "s"}</p>
                      </div>
                      <div className="min-w-0 border-l border-divider pl-sm">
                        <Users size={14} data-history-motion className="text-primary transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110" />
                        <p className="mt-xs text-[13px] font-semibold text-text">{term.lecturerCount}</p>
                        <p className="break-words text-[11px] text-textSecondary">Lecturer{term.lecturerCount === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
