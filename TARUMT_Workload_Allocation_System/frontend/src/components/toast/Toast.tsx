"use client";

/**
 * TOAST — in-page notification used by the login flow (replaces the
 * /login/fail redirect page). Themed error badge (errorBg/errorText,
 * theme.docx status colors), fixed top-center, slides down on show.
 * Persists until the user closes it with ✕ — no auto-dismiss — so
 * the failure reason is never missed. Re-renders with new content
 * when a different error fires.
 */

import { useRef } from "react";
import { XCircle, X } from "lucide-react";

interface ToastProps {
  /** Current message, or null for no toast. */
  message: string | null;
  /** Called when the user closes the toast. */
  onDone: () => void;
}

export default function Toast({ message, onDone }: ToastProps) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-slide-down fixed left-1/2 top-8 z-50 flex max-w-[94vw] items-center gap-md rounded-button border border-error/25 bg-errorBg px-lg py-md shadow-card"
    >
      <XCircle size={22} className="shrink-0 text-error" />
      <p className="text-[16px] font-semibold leading-snug text-errorText">{message}</p>
      <button
        type="button"
        onClick={() => onDoneRef.current()}
        aria-label="Dismiss notification"
        className="ml-xs shrink-0 text-errorText/70 transition-colors hover:text-errorText"
      >
        <X size={17} />
      </button>
    </div>
  );
}
