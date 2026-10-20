"use client";

/**
 * TOAST — in-page notification shared by the login flow and the lecturers
 * page's ⚠ warnings. Themed error badge (errorBg/errorText, theme.docx
 * status colors), fixed top-center.
 *
 * Motion + lifecycle:
 *   · entry       — slides down with the project spring; replays whenever a
 *                   NEW message replaces the current one (keyed remount)
 *   · auto-hide   — dismisses itself 3s after appearing
 *   · hover hold  — hovering the toast pauses the countdown; leaving it
 *                   restarts a fresh 3s read window
 *   · exit        — plays a springy slide-up fade-out, then unmounts and
 *                   syncs the parent (no close button needed)
 */

import { useEffect, useRef, useState } from "react";
import { XCircle } from "lucide-react";

interface ToastProps {
  /** Current message, or null for no toast. */
  message: string | null;
  /** Called after the exit animation completes (parent clears its state). */
  onDone: () => void;
}

/** read time before the toast dismisses itself */
const TOAST_MS = 3000;

export default function Toast({ message, onDone }: ToastProps) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  /* the message actually on screen + whether it is animating out */
  const [shown, setShown] = useState<string | null>(message);
  const [closing, setClosing] = useState(false);
  /* pointer parked on the toast → hold the countdown */
  const [hovering, setHovering] = useState(false);

  /* a new message pops in immediately (replacing/closing ones reset too) */
  useEffect(() => {
    if (message) {
      setShown(message);
      setClosing(false);
      setHovering(false);
    } else if (shown && !closing) {
      setClosing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  /* auto-dismiss: 3s to read; hovering the toast holds it, leaving
     restarts the full window */
  useEffect(() => {
    if (!shown || closing || hovering) return;
    const t = setTimeout(() => setClosing(true), TOAST_MS);
    return () => clearTimeout(t);
  }, [shown, closing, hovering]);

  /* exit animation finished → drop the toast and sync the parent */
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      setShown(null);
      setClosing(false);
      onDoneRef.current();
    }, 230);
    return () => clearTimeout(t);
  }, [closing]);

  if (!shown) return null;

  return (
    <div
      key={closing ? "toast-out" : shown}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`${
        closing ? "animate-toast-out" : "animate-slide-down"
      } fixed left-1/2 top-8 z-50 flex max-w-[94vw] items-center gap-md rounded-button border border-error/25 bg-errorBg px-lg py-md shadow-card`}
    >
      <XCircle size={22} className="shrink-0 text-error" />
      <p className="text-[16px] font-semibold leading-snug text-errorText">{shown}</p>
    </div>
  );
}
