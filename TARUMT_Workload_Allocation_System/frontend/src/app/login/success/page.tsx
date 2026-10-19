"use client";

/**
 * LOGIN SUCCESS PAGE — shown after a verified login.
 * Displays the signed-in user, then continues to the role landing page
 * (manual button + auto-redirect countdown).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ArrowRight, LogOut, Sparkles } from "lucide-react";
import AnimatedContent from "@/components/animations/AnimatedContent";
import FadeContent from "@/components/animations/FadeContent";
import { getAuth, clearAuth, landingFor } from "@/services/auth";

export default function LoginSuccessPage() {
  const router = useRouter();
  const [session, setSession] = useState<ReturnType<typeof getAuth>>(null);
  const [seconds, setSeconds] = useState(4);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const auth = getAuth();
    if (!auth?.token) {
      router.replace("/login"); // no session → nothing to celebrate
      return;
    }
    setSession(auth);

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          return 1;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [router]);

  // Auto-continue once countdown finishes (after session is loaded).
  useEffect(() => {
    if (session && seconds <= 1) {
      const id = setTimeout(() => router.replace(landingFor(session.user.role)), 350);
      return () => clearTimeout(id);
    }
  }, [session, seconds, router]);

  const logout = () => {
    clearAuth();
    router.replace("/login");
  };

  const stopCountdown = () => { if (timerRef.current) clearInterval(timerRef.current); };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-pageBg via-background to-hoverBg px-md">
      {/* decorative blobs */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-badge bg-primaryLight blur-3xl animate-blob" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-badge bg-hoverBg blur-3xl animate-blob-slow" />

      <FadeContent delay={0.05}>
        <div className="w-full max-w-[440px] rounded-card border border-divider bg-surface p-lg text-center shadow-card">
          {/* success icon */}
          <AnimatedContent delay={0.08}>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-badge bg-successBg">
              <CheckCircle2 size={44} className="animate-pop text-success" strokeWidth={2.2} />
            </div>
          </AnimatedContent>

          <AnimatedContent delay={0.16}>
            <h1 className="mt-lg text-[24px] font-semibold tracking-[-0.01em] text-text">Login successful</h1>
            {session && (
              <p className="mt-xs text-[14px] text-textSecondary">
                Welcome back,{" "}
                <span className="font-semibold text-text">{session.user.fullName}</span>
              </p>
            )}
          </AnimatedContent>

          {/* identity chips */}
          {session && (
            <AnimatedContent delay={0.24}>
              <div className="mt-md flex flex-wrap items-center justify-center gap-sm text-[12px]">
                <span className="rounded-badge bg-primaryLight px-sm py-xs font-medium text-textNormal">
                  {session.user.staffId ? `Code ${session.user.code} · ${session.user.staffId}` : "System Administrator"}
                </span>
                <span className="rounded-badge bg-hoverBg px-sm py-xs font-medium uppercase tracking-wide text-textSecondary">
                  {session.user.role}
                </span>
                {session.user.department && (
                  <span className="rounded-badge bg-hoverBg px-sm py-xs font-medium text-textSecondary">
                    {session.user.department}
                  </span>
                )}
              </div>
            </AnimatedContent>
          )}

          <AnimatedContent delay={0.3}>
            <div className="mt-md flex items-center justify-center gap-xs text-[12px] text-textSecondary">
              <Sparkles size={13} className="text-warning" />
              Authenticated via{" "}
              <span className="font-medium text-textNormal">
                {session?.source === "php-api" ? "PHP API" : session?.source === "database" ? "PostgreSQL" : "dev fallback"}
              </span>
            </div>
          </AnimatedContent>

          {/* actions */}
          <AnimatedContent delay={0.36}>
            <div className="mt-lg space-y-sm">
              <Link
                href={session ? landingFor(session.user.role) : "/dashboard"}
                onClick={stopCountdown}
                className="flex h-10 w-full items-center justify-center gap-xs rounded-button bg-primary text-[14px] font-medium text-white transition-all hover:bg-primaryHover active:bg-primaryActive"
              >
                Enter system <ArrowRight size={16} />
              </Link>
              <button
                type="button"
                onClick={logout}
                className="flex h-10 w-full items-center justify-center gap-xs rounded-button border border-border bg-surface text-[14px] font-medium text-text transition-colors hover:bg-background"
              >
                <LogOut size={15} /> Not you? Sign out
              </button>
            </div>
            {session && (
              <p className="mt-md text-[13px] text-textSecondary">
                Taking you to your dashboard in {seconds}s…
              </p>
            )}
          </AnimatedContent>
        </div>
      </FadeContent>
    </main>
  );
}
