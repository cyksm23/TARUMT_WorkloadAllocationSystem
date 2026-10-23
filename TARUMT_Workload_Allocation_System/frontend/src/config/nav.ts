/**
 * NAV CONFIG — Programme Leader sidebar (flat list, top → bottom).
 *
 * Derived from the FYP document (ProjectIPortfolio_RSD3G2_ChongYeKeh.docx,
 * Table 1.4.1.1 "Functional Modules"):
 *   Workload Management   → Course Assignment · Teaching Hours · Moderator
 *                           Assignment
 *   Overtime & Reporting  → OT Claim Calculation (OT Claims) + Report
 *                           Generation (Reports) — combined into one entry
 *   Course & Lab Mgmt     → Courses & Programmes · Lecturers · Lab Management
 *                           · Course Suggestion
 * Ordered by the PL's daily workflow: Dashboard first, then Lecturers, then
 * Courses & Programmes, then Course Assignment (+ Moderator Assignment) —
 * the remaining modules follow. Class Splitting is not a sidebar entry (it
 * lives inside Courses & Programmes as the class-size rules card).
 * (Authentication/role control lives in the AppShell gate, not the sidebar.)
 */
import {
  LayoutDashboard,
  ClipboardList,
  Clock,
  Coins,
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

/** Sidebar order: Dashboard → Lecturers → Courses & Programmes → Course
    Assignment (+ Moderator Assignment), then the remaining modules. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Lecturers", href: "/lecturers", icon: Users },
  { label: "Courses & Programmes", href: "/courses", icon: BookOpen },
  { label: "Course Assignment", href: "/allocations", icon: ClipboardList },
  { label: "Moderator Assignment", href: "/moderators", icon: ShieldCheck },
  { label: "Teaching Hours", href: "/workloads", icon: Clock },
  { label: "OT Claims & Reports", href: "/ot-claims", icon: Coins },
  { label: "Lab Management", href: "/labs", icon: FlaskConical },
  { label: "Course Suggestion", href: "/suggestions", icon: History },
];

/** Path → page title. The Reports page shares the combined OT entry. */
export function titleForPath(pathname: string): string {
  const exact = NAV_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact.label;
  if (pathname === "/reports" || pathname.startsWith("/reports/")) {
    return "OT Claims & Reports";
  }
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
