/**
 * NAV CONFIG — Programme Leader sidebar structure.
 *
 * Derived from the FYP document (ProjectIPortfolio_RSD3G2_ChongYeKeh.docx,
 * Table 1.4.1.1 "Functional Modules" + Section 3.3.2 use-case diagrams):
 *   Workload Management   → Course Assignment · Teaching Hours · Class Splitting
 *   Overtime & Reporting  → OT Claim Calculation · Report Generation
 *   Course & Lab Mgmt     → Courses & Programmes · Lecturers · Moderator
 *                           Assignment · Lab Management · Course Suggestion
 * (Authentication/role control lives in the AppShell gate, not the sidebar.)
 */
import {
  LayoutDashboard,
  ClipboardList,
  Clock,
  Columns2,
  Coins,
  FileText,
  BookOpen,
  Users,
  ShieldCheck,
  FlaskConical,
  History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type { LucideIcon };

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Group header shown in the sidebar (uppercase, tiny). Optional = plain top item. */
  header?: string;
  /** Icon used on the Gmail-style icon rail for this category. */
  icon?: LucideIcon;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    header: "Dashboard",
    icon: LayoutDashboard,
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    header: "Workload Management",
    icon: ClipboardList,
    items: [
      { label: "Course Assignment", href: "/allocations", icon: ClipboardList },
      { label: "Teaching Hours", href: "/workloads", icon: Clock },
      { label: "Class Splitting", href: "/class-splitting", icon: Columns2 },
    ],
  },
  {
    header: "Overtime & Reporting",
    icon: Coins,
    items: [
      { label: "OT Claims", href: "/ot-claims", icon: Coins },
      { label: "Reports", href: "/reports", icon: FileText },
    ],
  },
  {
    header: "Course & Lab Management",
    icon: FlaskConical,
    items: [
      { label: "Courses & Programmes", href: "/courses", icon: BookOpen },
      { label: "Lecturers", href: "/lecturers", icon: Users },
      { label: "Moderator Assignment", href: "/moderators", icon: ShieldCheck },
      { label: "Lab Management", href: "/labs", icon: FlaskConical },
      { label: "Course Suggestion", href: "/suggestions", icon: History },
    ],
  },
];

/** Flat item lookup (per-path page titles). */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function titleForPath(pathname: string): string {
  const exact = NAV_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact.label;
  const loose = NAV_ITEMS.find((i) => pathname.startsWith(i.href + "/"));
  if (loose) return loose.label;
  return "Dashboard";
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Live counters shown as right-aligned badges in the navigation panel. */
export interface RailCounts {
  allocations: number;
  overLimit: number;
  subjects: number;
  /** lecturers whose saved limit pair is outside the rules' allowed range */
  lecturersOverRules: number;
}
