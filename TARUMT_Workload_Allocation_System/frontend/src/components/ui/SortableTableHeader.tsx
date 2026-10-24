"use client";

import { useLayoutEffect, useRef } from "react";

export type SortDirection = "asc" | "desc";

/** The supplied PNGs remain the resting icons; rotation bridges directions
 * without replacing them with a different arrow design. */
export function SortArrowIcon({ direction }: { direction: SortDirection | null }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const previousDirection = useRef(direction);
  const arrowImage = `url('/icons/${direction === "desc" ? "sortup.png" : "sortdown.png"}')`;

  useLayoutEffect(() => {
    const previous = previousDirection.current;
    previousDirection.current = direction;
    const icon = iconRef.current;
    if (!icon?.animate || previous === direction || direction === null ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const startAngle = previous === null ? -360 : direction === "desc" ? -180 : 180;
    const animation = icon.animate(
      [{ transform: `rotate(${startAngle}deg)` }, { transform: "rotate(0deg)" }],
      { duration: 280, easing: "cubic-bezier(0.2, 0.75, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [direction]);

  return (
    <span ref={iconRef} aria-hidden="true" className="inline-block h-3.5 w-3.5 shrink-0"
      style={{
        backgroundColor: "currentColor",
        maskImage: arrowImage,
        WebkitMaskImage: arrowImage,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }} />
  );
}

interface SortableTableHeaderProps {
  label: string;
  direction: SortDirection | null;
  onSort: () => void;
  description?: string;
  className?: string;
  priority?: number;
}

function SortControl({
  label, direction, onSort, description, priority,
}: Omit<SortableTableHeaderProps, "className">) {
  const nextDirection = direction === "asc" ? "descending" : "ascending";
  const priorityLabel = priority ? `, sorting priority ${priority}` : "";

  return (
    <button type="button" onClick={onSort}
      aria-label={`${label}${priorityLabel}${direction ? `, sorted ${direction === "asc" ? "ascending" : "descending"}` : ""}: ${direction ? "sort" : "add sort"} ${nextDirection}`}
      title={`${description ? `${description}. ` : ""}Click to ${direction ? "sort" : "add"} ${nextDirection}`}
      className="flex min-h-8 w-full items-center gap-xs rounded-button text-left font-semibold uppercase outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      <SortArrowIcon direction={direction} />
    </button>
  );
}

/** Shared column-header interaction: ascending points down, descending up.
 * Native header/button semantics expose the current order to screen readers
 * and support keyboard activation without a separate sort dropdown.
 */
export default function SortableTableHeader({
  label, direction, onSort, description, className = "", priority,
}: SortableTableHeaderProps) {
  // aria-sort belongs on the primary column only; labels and the table's
  // live summary describe secondary directions and their precedence.
  const primary = direction !== null && (priority === undefined || priority === 1);

  return (
    <th scope="col" aria-sort={primary ? direction === "asc" ? "ascending" : "descending" : undefined}
      className={`bg-surface px-sm py-sm text-left align-middle text-[11px] font-semibold uppercase tracking-[0.06em] ${direction ? "text-primary" : "text-textSecondary"} ${className}`}>
      <SortControl label={label} direction={direction} onSort={onSort}
        description={description} priority={priority} />
    </th>
  );
}

/** Sortable column header for the legacy CSS-grid rosters. It mirrors the
 * native-table control while retaining each page's shared grid template. */
export function SortableGridHeader({
  label, direction, onSort, description, className = "", priority,
}: SortableTableHeaderProps) {
  const primary = direction !== null && (priority === undefined || priority === 1);

  return (
    <div role="columnheader"
      aria-sort={primary ? direction === "asc" ? "ascending" : "descending" : undefined}
      className={`min-w-0 bg-surface text-[11px] font-semibold uppercase tracking-[0.06em] ${direction ? "text-primary" : "text-textSecondary"} ${className}`}>
      <SortControl label={label} direction={direction} onSort={onSort}
        description={description} priority={priority} />
    </div>
  );
}
