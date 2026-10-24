"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock3, Loader2, RefreshCcw, TriangleAlert, X } from "lucide-react";
import { apiFetch } from "@/services/apiClient";
import type { ApplyHourLimitRulesPlan } from "@/lib/server/lecturer-limits";

interface ApplyHourLimitRulesDialogProps {
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Opening only previews. A separate confirmation applies the reviewed
 * all-staff reset to PostgreSQL; stale previews must be reloaded first.
 */
export default function ApplyHourLimitRulesDialog({ onClose, onSaved }: ApplyHourLimitRulesDialogProps) {
  const [plan, setPlan] = useState<ApplyHourLimitRulesPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const loadPreview = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("preview");
    setPlan(null);
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await apiFetch("/api/lecturers/apply-hour-limit-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ action: "preview" }),
      });
      const data = await response.json() as { ok: boolean; plan?: ApplyHourLimitRulesPlan; message?: string };
      if (controller.signal.aborted) return;
      if (response.ok && data.ok && data.plan) setPlan(data.plan);
      else setError(data.message ?? "The workload-limit preview could not be loaded. No limits were changed.");
    } catch {
      if (!controller.signal.aborted) setError("Connection failed while loading the preview. No limits were changed; please try again.");
    } finally {
      if (requestRef.current === controller && !controller.signal.aborted) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    void loadPreview();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']");
      if (!focusable?.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      requestRef.current?.abort();
      requestRef.current = null;
      busyRef.current = false;
      previousFocus?.focus();
    };
  }, [loadPreview]);

  const applyRules = async () => {
    if (busyRef.current || !plan?.changedCount) return;
    busyRef.current = true;
    setBusy("commit");
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await apiFetch("/api/lecturers/apply-hour-limit-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ action: "commit", previewToken: plan.previewToken }),
      });
      const data = await response.json() as { ok: boolean; message?: string };
      if (controller.signal.aborted) return;
      if (response.ok && data.ok) onSaved(data.message ?? "All lecturer workload limits now match their hour-limit rules.");
      else {
        setPlan(null);
        setError(data.message ?? "Workload limits could not be updated. Reload the preview before trying again.");
      }
    } catch {
      if (!controller.signal.aborted) {
        setPlan(null);
        setError("Connection interrupted. Reload the preview before trying again; the save may already have completed.");
      }
    } finally {
      if (requestRef.current === controller && !controller.signal.aborted) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) onClose();
      }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-labelledby="apply-hour-limits-title" aria-describedby="apply-hour-limits-description" aria-busy={busy !== null}
        className="animate-[menuIn_0.2s_ease-out_both] max-h-[calc(100vh-64px)] w-full max-w-[760px] overflow-y-auto rounded-card border border-divider bg-surface p-lg shadow-card">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0">
            <h2 id="apply-hour-limits-title" className="flex items-center gap-sm text-[18px] font-bold leading-[26px] text-text">
              <Clock3 size={22} className="shrink-0 text-primary" /> Apply hour-limit rules to all lecturers
            </h2>
            <p id="apply-hour-limits-description" className="mt-xs text-[12.5px] leading-snug text-textSecondary">
              Review each lecturer’s current and rule-based minimum/maximum hours before confirming.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy !== null} aria-label="Close hour-limit confirmation"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-textSecondary transition-colors hover:bg-hoverBg hover:text-text disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="mt-lg flex items-start gap-sm rounded-card border border-warningText/20 bg-warningBg p-md text-[12.5px] leading-snug text-warningText">
          <TriangleAlert size={17} className="mt-px shrink-0" />
          <div>
            <p className="font-semibold">Existing custom workload limits will be replaced.</p>
            <p className="mt-xs">This applies to all lecturers, including inactive staff and anyone hidden by your current filters. Each lecturer gets their own applicable rule, with the Programme Leader rule taking precedence.</p>
            <p className="mt-xs">Assignments, allocated hours, staff profiles and the hour-limit rules themselves will not change.</p>
          </div>
        </div>

        {busy === "preview" && (
          <p role="status" className="mt-lg flex items-center gap-sm text-[13px] text-textSecondary">
            <Loader2 size={16} className="animate-spin" /> Loading limits for all lecturers…
          </p>
        )}
        {error && (
          <p role="alert" className="mt-md flex items-start gap-xs rounded-button bg-errorBg p-md text-[12.5px] text-errorText">
            <TriangleAlert size={15} className="mt-px shrink-0" /> {error}
          </p>
        )}

        {plan && (
          <div className="mt-lg">
            <p className="text-[13px] font-semibold text-text" aria-live="polite">
              {plan.totalCount} lecturer{plan.totalCount === 1 ? "" : "s"} · {plan.changedCount} to update · {plan.unchangedCount} already match
            </p>
            {plan.changedCount === 0 && (
              <p className="mt-sm text-[12.5px] text-successText">{plan.totalCount ? "All lecturer workload limits already match their applicable rules. No update is needed." : "There are no lecturers to update."}</p>
            )}
            <div className="mt-md overflow-hidden rounded-card border border-divider">
              <div className="hidden grid-cols-[1.1fr_1fr_1fr] gap-md bg-background px-md py-sm text-[11.5px] font-semibold text-textSecondary sm:grid">
                <span>Lecturer</span><span>Applicable rule</span><span>Weekly limits (min–max)</span>
              </div>
              <div tabIndex={0} role="region" aria-label="All lecturer workload-limit preview"
                className="max-h-[300px] divide-y divide-divider overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                {plan.lecturers.map((lecturer) => (
                  <div key={lecturer.id} className="grid grid-cols-1 gap-sm px-md py-md text-[12.5px] sm:grid-cols-[1.1fr_1fr_1fr] sm:gap-md">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-text">{lecturer.fullName}</p>
                      <p className="mt-[2px] text-[11.5px] text-textSecondary">{lecturer.staffId}{!lecturer.isActive && " · Inactive"}</p>
                    </div>
                    <p className="min-w-0 break-words text-textNormal"><span className="sm:hidden">Rule: </span>{lecturer.ruleLabel}</p>
                    <div className="text-[12px]">
                      <p className="text-textSecondary">Current: {lecturer.minHours}–{lecturer.maxHours} h/week</p>
                      <p className={`mt-[2px] font-semibold ${lecturer.changed ? "text-primary" : "text-successText"}`}>
                        {lecturer.changed ? "→ " : "✓ "}{lecturer.targetMinHours}–{lecturer.targetMaxHours} h/week{!lecturer.changed && " (unchanged)"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-lg flex flex-wrap items-center justify-end gap-sm border-t border-divider pt-lg">
          <button type="button" onClick={() => void loadPreview()} disabled={busy !== null}
            className="mr-auto flex min-h-10 items-center gap-xs rounded-button border border-divider bg-surface px-md py-sm text-[12.5px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50">
            <RefreshCcw size={14} /> Reload preview
          </button>
          <button type="button" onClick={onClose} disabled={busy !== null}
            className="flex h-10 items-center rounded-button border border-divider bg-surface px-md text-[13px] font-medium text-textNormal transition-colors hover:bg-hoverBg disabled:opacity-50">
            {plan?.changedCount === 0 ? "Close" : "Cancel"}
          </button>
          <button type="button" onClick={() => void applyRules()} disabled={busy !== null || !plan?.changedCount}
            className="flex min-h-10 items-center justify-center gap-xs rounded-button bg-primary px-md py-sm text-[13px] font-semibold text-white transition-colors hover:bg-primaryHover disabled:cursor-not-allowed disabled:opacity-50">
            {busy === "commit" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {busy === "commit" ? "Applying…" : "Confirm & apply rules"}
          </button>
        </div>
      </div>
    </div>
  );
}
