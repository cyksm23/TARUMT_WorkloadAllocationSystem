"use client";

/**
 * SIDEBAR — "Animated Sidebar Menu" style (blue rail ↔ blue expanded menu).
 *
 * · One rounded primary-blue card that EXPANDS (260px, icons + labels,
 *   TARUMT Workload Allocation brand row) and COLLAPSES (68px, icon-only) —
 *   springy width animation, toggled by the hamburger at its top. Always
 *   visible on every screen size.
 * · The ACTIVE item renders as a white tile (collapsed) / white pill
 *   (expanded) with primary-blue icon+text — exactly one at a time, purely
 *   route-driven.
 * · DYNAMIC MOTION on every expand/collapse:
 *     – springy overshoot easing on the width (320ms, same spring family as
 *       the toast slide-down)
 *     – hamburger icon does a full 180° spin
 *     – menu labels glide in from the left, staggered per row
 *     – live-count badges pop in from the right, staggered per row
 *     – rows drift right on hover, icons scale up, press feedback squashes
 * · Functions come from the FYP module table (config/nav.ts): Dashboard +
 *   the ten module functions in one clean flat list.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, GraduationCap } from "lucide-react";
import { NAV_ITEMS, isActive, type LucideIcon, type RailCounts } from "@/config/nav";

/** spring used by the toast slide-down — the project's motion signature */
const SPRING = "cubic-bezier(0.34, 1.28, 0.64, 1)";

interface SidebarProps {
  /** Expanded menu (260px) or collapsed icon rail (68px). */
  expanded: boolean;
  /** Toggle request — hamburger at the top of the card. */
  onToggle: () => void;
  /** Live counters from /api/dashboard/summary. */
  counts?: RailCounts | null;
}

/** right-aligned live count for special rows */
function countFor(href: string, counts: RailCounts | null | undefined): number | null {
  if (!counts) return null;
  if (href === "/allocations") return counts.allocations;
  if (href === "/ot-claims") return counts.overLimit;
  if (href === "/courses") return counts.subjects;
  return null;
}

export default function Sidebar({ expanded, onToggle, counts }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 my-md ml-md flex transform flex-col overflow-hidden rounded-card bg-primary transition-[width] duration-[320ms] md:sticky md:inset-y-auto md:top-4 md:h-[calc(100vh-32px)] ${
        expanded ? "w-[260px]" : "w-[68px]"
      }`}
      style={{ transitionTimingFunction: SPRING }}
    >
      {/* top row: hamburger (does a 180° spin) + brand (glides in when expanded) */}
      <div className="flex h-16 shrink-0 items-center px-sm">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse menu" : "Expand menu"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-badge text-white transition-colors hover:bg-primaryHover active:scale-95"
        >
          <Menu
            size={18}
            className={`transition-transform duration-300 ${expanded ? "rotate-0" : "rotate-180"}`}
            style={{ transitionTimingFunction: SPRING }}
          />
        </button>
        {expanded && (
          <span
            style={{ animationDelay: "70ms" }}
            className="animate-[labelIn_0.32s_ease-out_both] flex min-w-0 items-center gap-sm pl-sm"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-badge bg-surface">
              <GraduationCap size={18} className="text-primary" />
            </span>
            <span className="flex min-w-0 flex-col leading-[1.15]">
              <span className="whitespace-nowrap text-[15px] font-extrabold leading-[1.1] tracking-[0.01em]">
                <span className="text-[#DA2A30]">TAR</span>
                <span className="text-[#2E9BC9]">UMT</span>
              </span>
              <span className="whitespace-nowrap text-[11px] font-medium text-white">
                Workload Allocation
              </span>
            </span>
          </span>
        )}
      </div>

      {/* menu — labels + counts stagger in on expand; rows drift/scale on hover */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-sm py-md">
        <ul className="space-y-sm">
          {NAV_ITEMS.map((item, i) => {
            const active = isActive(pathname, item.href);
            const Icon: LucideIcon = item.icon;
            const count = countFor(item.href, counts);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  className={`group flex h-10 items-center gap-sm rounded-button whitespace-nowrap transition-all duration-200 active:scale-[0.97] ${
                    expanded ? "px-md hover:translate-x-[3px]" : "w-10 justify-center"
                  } ${
                    active
                      ? "bg-surface font-semibold text-primary"
                      : "font-medium text-white hover:bg-primaryHover"
                  }`}
                >
                  <Icon
                    size={expanded ? 17 : 19}
                    className="shrink-0 transition-transform duration-200 group-hover:scale-110"
                  />
                  {expanded && (
                    <span
                      style={{ animationDelay: `${90 + i * 24}ms` }}
                      className="animate-[labelIn_0.3s_ease-out_both] whitespace-nowrap text-[14px]"
                    >
                      {item.label}
                    </span>
                  )}
                  {expanded && count !== null && (
                    <span
                      style={{ animationDelay: `${140 + i * 24}ms` }}
                      className="animate-[badgeIn_0.34s_ease-out_both] ml-auto shrink-0 whitespace-nowrap text-[12px] font-medium text-white/70"
                    >
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
