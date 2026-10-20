"use client";

/**
 * PROGRAMME LEADER DASHBOARD — the coordinator's home screen.
 *
 * Top: welcome + semester context. Then four live KPI cards (real counters
 * from GET /api/dashboard/summary → PostgreSQL), a workload-balance strip
 * (theme.docx status-badge palette) and a launcher grid for every function
 * module from the FYP document (Table 1.4.1.1).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Clock,
  Columns2,
  Coins,
  FileText,
  BookOpen,
  ShieldCheck,
  History,
  Users,
  type LucideIcon,
} from "lucide-react";
import FadeContent from "@/components/animations/FadeContent";
import { getAuth } from "@/services/auth";

interface Summary {
  lecturers: {
    total: number;
    partTime: number;
    fullTime: number;
    programmeLeaders: number;
  };
  courses: {
    academicYears: number;
    programs: number;
    activeSubjects: number;
    semesters: number;
  };
  allocations: {
    total: number;
    approved: number;
    pending: number;
    overLimit: number;
  };
}

const MODULE_LAUNCHERS: Array<{
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}> = [
  {
    label: "Course Assignment",
    href: "/allocations",
    icon: ClipboardList,
    description: "Assign courses to lecturers within policy limits (max 3 degree / 4 diploma courses).",
  },
  {
    label: "Teaching Hour Calculation",
    href: "/workloads",
    icon: Clock,
    description: "Auto-compute weekly hours and enforce limits: ≤16h full-time, ≤12h programme leaders, ≤8h part-time.",
  },
  {
    label: "Class Splitting",
    href: "/class-splitting",
    icon: Columns2,
    description: "Practicals above 28 students and tutorials above 36 are split into balanced sections automatically.",
  },
  {
    label: "OT Claim Calculation",
    href: "/ot-claims",
    icon: Coins,
    description: "Detect hours beyond the entitlement, compute claim amounts and issue claim records.",
  },
  {
    label: "Report Generation",
    href: "/reports",
    icon: FileText,
    description: "Workload summaries, OT claim documents and printable PDF export for submission.",
  },
  {
    label: "Moderator Assignment",
    href: "/moderators",
    icon: ShieldCheck,
    description: "One moderator per course, capped at nine coursework samples per moderator.",
  },
  {
    label: "Lab Management",
    href: "/labs",
    icon: BookOpen,
    description: "Schedule and track Lab 1, Lab 2 and Third Remarks practical sessions.",
  },
  {
    label: "Course Suggestion",
    href: "/suggestions",
    icon: History,
    description: "Reuse the previous academic year's semester allocations as editable suggestions.",
  },
];

function KpiCard({
  icon: Icon,
  value,
  label,
  sub,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="rounded-card bg-surface p-lg shadow-card">
      <div className="flex items-center gap-md">
        <span className="flex h-11 w-11 items-center justify-center rounded-button bg-primaryLight">
          <Icon size={20} className="text-primary" />
        </span>
        <div>
          <p className="text-[28px] font-bold leading-none tracking-[-0.02em] text-text">{value}</p>
          <p className="mt-1 text-[13px] font-medium text-textNormal">{label}</p>
        </div>
      </div>
      <p className="mt-md text-[12.5px] text-textSecondary">{sub}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    setName(getAuth()?.user.fullName ?? "Programme Leader");
    fetch("/api/dashboard/summary")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setSummary(d as Summary);
        else setError(d.message ?? "Summary unavailable.");
      })
      .catch(() => setError("Summary unavailable (network error)."));
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      {/* heading */}
      <FadeContent>
        <div className="flex flex-wrap items-end justify-between gap-md">
          <div>
            <h1 className="text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">
              Dashboard
            </h1>
            <p className="mt-1 text-[13px] text-textSecondary">
              Welcome back, {name || "Programme Leader"} · Department of Computing &amp; IT
            </p>
          </div>
          <span className="rounded-badge bg-primaryLight px-md py-sm text-[12.5px] font-semibold text-primary">
            2026/2027 · Semester 1
          </span>
        </div>
      </FadeContent>

      {/* KPI row — live counters from PostgreSQL */}
      <FadeContent delay={0.08}>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={Users}
            value={summary ? String(summary.lecturers.total) : "—"}
            label="Active lecturers"
            sub={
              summary
                ? `${summary.lecturers.fullTime} full-time · ${summary.lecturers.partTime} part-time · ${summary.lecturers.programmeLeaders} programme leader(s)`
                : "Counting from the lecturers table…"
            }
          />
          <KpiCard
            icon={BookOpen}
            value={summary ? String(summary.courses.activeSubjects) : "—"}
            label="Active subjects"
            sub={
              summary
                ? `${summary.courses.programs} programmes · ${summary.courses.academicYears} academic year(s)`
                : "Counting from the subjects table…"
            }
          />
          <KpiCard
            icon={ClipboardList}
            value={summary ? String(summary.allocations.total) : "—"}
            label="Allocations"
            sub={
              summary
                ? `${summary.allocations.approved} approved · ${summary.allocations.pending} pending`
                : "Reading the workloads table…"
            }
          />
          <KpiCard
            icon={Coins}
            value={summary ? String(summary.allocations.overLimit) : "—"}
            label="Over-limit lecturers"
            sub={
              summary
                ? summary.allocations.overLimit === 0
                  ? "All assigned hours within institutional limits"
                  : "Needs OT claim review"
                : "Checking hour thresholds…"
            }
          />
        </div>
      </FadeContent>

      {error && (
        <p className="mt-md text-[13px] text-errorText">{error}</p>
      )}

      {/* workload balance legend (theme status badges) */}
      <FadeContent delay={0.14}>
        <div className="mt-lg flex flex-wrap items-center gap-sm rounded-card bg-surface px-lg py-md shadow-card">
          <p className="text-[13px] font-medium text-textNormal">Workload balance:</p>
          <span className="rounded-badge bg-successBg px-sm py-[3px] text-[11.5px] font-semibold text-successText">
            Balanced
          </span>
          <span className="rounded-badge bg-warningBg px-sm py-[3px] text-[11.5px] font-semibold text-warningText">
            Near limit
          </span>
          <span className="rounded-badge bg-errorBg px-sm py-[3px] text-[11.5px] font-semibold text-errorText">
            Overloaded ({summary ? summary.allocations.overLimit : "—"})
          </span>
          <p className="ml-auto text-[12px] text-textSecondary">Per-lecturer bars arrive with the allocations engine.</p>
        </div>
      </FadeContent>

      {/* function-module launcher grid (section 3.1.1) */}
      <FadeContent delay={0.2}>
        <h2 className="mt-xl text-[18px] font-semibold text-text">Function modules</h2>
        <div className="mt-md grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
          {MODULE_LAUNCHERS.map(({ label, href, icon: Icon, description }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-card bg-surface p-lg shadow-card transition-shadow hover:shadow-dashboard"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-button bg-primaryLight">
                <Icon size={20} className="text-primary" />
              </span>
              <p className="mt-md text-[15px] font-semibold text-text">{label}</p>
              <p className="mt-1 text-[12.5px] leading-[20px] text-textSecondary">{description}</p>
              <p className="mt-md text-[13px] font-medium text-primary">Open module →</p>
            </Link>
          ))}
        </div>
      </FadeContent>
    </div>
  );
}
