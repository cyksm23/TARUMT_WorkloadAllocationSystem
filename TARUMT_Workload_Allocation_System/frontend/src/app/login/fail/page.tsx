"use client";

/**
 * LOGIN FAIL PAGE — shown when verification fails (wrong password,
 * unknown code, inactive account, auth service unreachable).
 *
 * Reads ?reason=… and ?code=… query params; "Try again" returns to
 * /login with the code pre-filled.
 */

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { XCircle, RotateCcw, LifeBuoy } from "lucide-react";
import AnimatedContent from "@/components/animations/AnimatedContent";
import FadeContent from "@/components/animations/FadeContent";

function FailCard() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason") ?? "Verification failed. Please try again.";
  const code = params.get("code") ?? "";

  const backToLogin = () => {
    router.replace(code ? `/login?code=${encodeURIComponent(code)}` : "/login");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-pageBg via-background to-hoverBg px-md">
      {/* decorative blobs */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-badge bg-errorBg blur-3xl animate-blob" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-badge bg-hoverBg blur-3xl animate-blob-slow" />

      <FadeContent delay={0.05}>
        <div className="w-full max-w-[440px] rounded-card border border-divider bg-surface p-lg text-center shadow-card">
          {/* failure icon */}
          <AnimatedContent delay={0.08}>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-badge bg-errorBg">
              <XCircle size={44} className="animate-pop text-error" strokeWidth={2.2} />
            </div>
          </AnimatedContent>

          <AnimatedContent delay={0.16}>
            <h1 className="mt-lg text-[24px] font-semibold tracking-[-0.01em] text-text">Login failed</h1>
            <p className="mt-sm rounded-button bg-hoverBg px-md py-sm text-[13px] leading-relaxed text-textNormal">
              {reason}
            </p>
          </AnimatedContent>

          <AnimatedContent delay={0.24}>
            <div className="mt-md rounded-button bg-primaryLight px-md py-sm text-[12px] leading-relaxed text-textNormal">
              <span className="font-semibold text-text">Demo:</span> code{" "}
              <code className="font-mono text-text">1001</code> (lecturer) or{" "}
              <code className="font-mono text-text">0000</code> (admin) · password{" "}
              <code className="font-mono text-text">password123</code>
            </div>
          </AnimatedContent>

          <AnimatedContent delay={0.3}>
            <div className="mt-lg space-y-sm">
              <button
                type="button"
                onClick={backToLogin}
                className="flex h-10 w-full items-center justify-center gap-xs rounded-button bg-primary text-[14px] font-medium text-white transition-all hover:bg-primaryHover active:bg-primaryActive"
              >
                <RotateCcw size={16} /> Try again
              </button>
              <button
                type="button"
                onClick={() => router.replace("/dashboard")}
                className="flex h-10 w-full items-center justify-center gap-xs rounded-button border border-border bg-surface text-[14px] font-medium text-text transition-colors hover:bg-background"
              >
                <LifeBuoy size={15} /> Continue without signing in
              </button>
            </div>
            <p className="mt-md text-[13px] text-textSecondary">
              Having trouble? Contact the department administrator.
            </p>
          </AnimatedContent>
        </div>
      </FadeContent>
    </main>
  );
}

export default function LoginFailPage() {
  return (
    <Suspense fallback={null}>
      <FailCard />
    </Suspense>
  );
}
