"use client";

/**
 * TOPNAV — 64px header (theme.docx specs): white, 1px #E5E5EA bottom border.
 * Right: active-semester selector + user chip + sign out.
 * (The system brand lives in the sidebar now — TARUMT Workload Allocation.)
 */

import { useRouter } from "next/navigation";
import { LogOut, ChevronDown } from "lucide-react";
import { clearAuth, type AuthSession } from "@/services/auth";

interface TopNavProps {
  session: AuthSession;
}

const ROLE_LABEL: Record<AuthSession["user"]["role"], string> = {
  coordinator: "Programme Leader",
  lecturer: "Lecturer",
  admin: "Administrator",
  hod: "Head of Department",
};

export default function TopNav({ session }: TopNavProps) {
  const router = useRouter();

  const signOut = () => {
    clearAuth();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-end gap-md border-b border-divider bg-surface px-md">
      <div className="flex items-center gap-md">
        {/* active-semester context selector */}
        <div className="relative hidden sm:block">
          <select
            aria-label="Active semester"
            defaultValue="2026-1"
            className="h-9 appearance-none rounded-button border border-divider bg-surface pl-md pr-8 text-[13px] font-medium text-textNormal outline-none transition-colors hover:bg-background focus:border-primary"
          >
            <option value="2026-1">2026/2027 · Semester 1</option>
            <option value="2026-2">2026/2027 · Semester 2</option>
            <option value="2025-1">2025/2026 · Semester 1</option>
            <option value="2025-2">2025/2026 · Semester 2</option>
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-textSecondary"
          />
        </div>

        {/* user chip */}
        <div className="flex items-center gap-sm">
          <div className="hidden leading-tight sm:block">
            <p className="text-[13px] font-medium text-text">{session.user.fullName}</p>
            <p className="text-[11px] text-textSecondary">
              {ROLE_LABEL[session.user.role] ?? session.user.role} · {session.user.code}
            </p>
          </div>
        </div>

        {/* sign out */}
        <button
          type="button"
          onClick={signOut}
          className="flex h-9 items-center gap-xs rounded-button border border-divider bg-surface px-md text-[13px] font-medium text-text transition-colors hover:bg-background"
          title="Sign out"
        >
          <LogOut size={15} className="text-textSecondary" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
