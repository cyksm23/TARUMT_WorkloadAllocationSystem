"use client";

/**
 * TOPNAV — 64px header (theme.docx specs): white, 1px #E5E5EA bottom border.
 * Right: user chip + sign out.
 * (The system brand lives in the sidebar now — TARUMT Workload Allocation.)
 */

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
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
