"use client";

/**
 * APP SHELL — layout frame for every in-system page (dashboard routes).
 *
 * Role gate (UC_AUTH: session validation):
 *   · no session            → redirect to /login
 *   · role ≠ "coordinator"  → "restricted" card (Programme Leader only scope)
 *
 * Composition: animated blue sidebar (collapsed icon rail ↔ expanded menu,
 * always visible on every screen size) + TopNav header + content area.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import Sidebar from "./Sidebar";
import TopNav from "./TopNav";
import type { RailCounts } from "@/config/nav";
import { getAuth, clearAuth, type AuthSession } from "@/services/auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [counts, setCounts] = useState<RailCounts | null>(null);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);

  /* desktop: expanded menu by default; mobile: collapsed icon rail */
  useEffect(() => {
    setExpanded(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  useEffect(() => {
    const s = getAuth();
    if (!s) {
      router.replace("/login");
    } else {
      setSession(s);
    }
    setReady(true);
  }, [router]);

  /* live counters for the menu badges (same source as the dashboard cards) */
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/dashboard/summary")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d.ok) {
          setCounts({
            allocations: d.allocations.total,
            overLimit: d.allocations.overLimit,
            subjects: d.courses.activeSubjects,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);

  /* still resolving localStorage on first paint */
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  /* no session — redirect in flight */
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  /* Programme Leader scope (dual-RBAC: this UI is the PL side) */
  if (session.user.role !== "coordinator") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-md">
        <div className="w-full max-w-[420px] rounded-card border border-divider bg-surface p-lg text-center shadow-card">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-badge bg-errorBg">
            <Lock size={30} className="text-error" />
          </span>
          <h1 className="mt-lg text-[24px] font-semibold tracking-[-0.01em] text-text">
            Programme Leader access only
          </h1>
          <p className="mt-sm text-[14px] leading-[22px] text-textNormal">
            You are signed in as <strong>{session.user.fullName}</strong> (role:{" "}
            {session.user.role}). This dashboard manages course allocation and is
            restricted to Programme Leaders. Lecturers get their own view later.
          </p>
          <button
            type="button"
            onClick={() => {
              clearAuth();
              router.replace("/login");
            }}
            className="mt-lg h-10 w-full rounded-button bg-primary px-5 text-[14px] font-medium text-white transition-colors hover:bg-primaryHover active:bg-primaryActive"
          >
            Sign out and go back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* animated blue sidebar — the whole strip stays primary-blue through
          the springy shrink-in / shrink-out animation */}
      <div
        className={`shrink-0 bg-primary transition-[width] duration-[320ms] ${
          expanded ? "w-[276px]" : "w-[84px]"
        }`}
        style={{ transitionTimingFunction: "cubic-bezier(0.34, 1.28, 0.64, 1)" }}
      >
        <Sidebar expanded={expanded} onToggle={() => setExpanded((o) => !o)} counts={counts} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav session={session} />
        <main className="flex-1 px-md py-lg md:px-xl">{children}</main>
      </div>
    </div>
  );
}
