"use client";

/**
 * LOGIN PAGE — TAR UMT intranet-style layout, themed with theme.docx tokens.
 *
 * Layout: centered crest + university wordmark + live clock + title above a
 * white card ("Please Enter Your Information" → Staff ID + Password →
 * full-width Login button). Particles drift in the background. Branding
 * comes from @/config/site.
 *
 * Staff ID = the 4-digit lecturer code (staff_id, e.g. '1001'; '0000' = admin).
 * Seeded password: password123.
 * Failure → in-page toast (no redirect page)  ·  Success → straight to the
 * dashboard (coordinators land on /allocations via landingFor).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Lock, Eye, EyeOff, KeyRound, Loader2, Leaf, GraduationCap } from "lucide-react";
import FadeContent from "@/components/animations/FadeContent";
import AnimatedContent from "@/components/animations/AnimatedContent";
import ShinyText from "@/components/animations/ShinyText";
import Particles from "@/components/animations/Particles";
import LiveClock from "@/components/login/LiveClock";
import Toast from "@/components/toast/Toast";
import { site } from "@/config/site";
import { login, saveAuth, landingFor } from "@/services/auth";

function LoginCard({ onFail }: { onFail: (message: string) => void }) {
    const router = useRouter();

    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;

        if (!/^\d{4}$/.test(code)) {
            onFail("Staff ID must be your 4-digit code.");
            return;
        }
        if (!password) {
            onFail("Please enter your password.");
            return;
        }

        setLoading(true);
        try {
            const session = await login(code, password);
            saveAuth(session);
            // straight into the system — no intermediate pages
            router.replace(landingFor(session.user.role));
        } catch (err) {
            setLoading(false);
            const reason = err instanceof Error && err.message ? err.message : "Unexpected error. Please try again.";
            onFail(reason);
        }
    };

    return (
        <div className="mx-auto w-full max-w-[460px] overflow-hidden rounded-card bg-surface shadow-card">
            <div className="px-xl py-xl">
                {/* card heading (theme §Typography — Section Title 18/600) — left, intranet style */}
                <AnimatedContent delay={0.08}>
                    <div className="flex items-center gap-sm">
                        <Leaf size={20} className="shrink-0 text-primary" />
                        <h2 className="text-[18px] font-semibold text-text">Please Enter Your Information</h2>
                    </div>
                    <div className="mt-md border-t border-divider" />
                </AnimatedContent>

                <form onSubmit={submit} className="mt-lg space-y-sm" noValidate>
                    {/* Staff ID (4-digit lecturer code) */}
                    <AnimatedContent delay={0.14}>
                        <div className="relative">
                            <User
                                size={17}
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-textSecondary"
                            />
                            <input
                                id="code"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={4}
                                autoFocus
                                disabled={loading}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                placeholder="Staff ID"
                                aria-label="Staff ID (4-digit code)"
                                className="h-11 w-full rounded-button border border-divider bg-surface pl-11 pr-md text-[14px] tracking-[0.08em] text-text outline-none transition-colors placeholder:tracking-normal placeholder:text-textPlaceholder focus:border-primary"
                            />
                        </div>
                    </AnimatedContent>

                    {/* password */}
                    <AnimatedContent delay={0.2}>
                        <div className="relative !mt-lg">
                            <Lock
                                size={17}
                                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-textSecondary"
                            />
                            <input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="current-password"
                                disabled={loading}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                aria-label="Password"
                                className="h-11 w-full rounded-button border border-divider bg-surface pl-11 pr-11 text-[14px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary"
                            />
                            <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setShowPassword((s) => !s)}
                                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-textSecondary transition-colors hover:text-text"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </AnimatedContent>

                    {/* Login button — full width, same width as the text boxes */}
                    <AnimatedContent delay={0.26}>
                        <div className="!mt-lg">
                            <button
                                type="submit"
                                disabled={loading || code.length < 4 || !password}
                                className="flex h-10 w-full items-center justify-center gap-xs rounded-button bg-primary px-5 text-[14px] font-medium text-white transition-all hover:bg-primaryHover active:bg-primaryActive disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" /> Verifying…
                                    </>
                                ) : (
                                    <>
                                        <KeyRound size={15} /> Login
                                    </>
                                )}
                            </button>
                        </div>
                    </AnimatedContent>
                </form>
            </div>
        </div>
    );
}

export default function LoginPage() {
    // login failures surface here as an in-page toast (no /login/fail page)
    const [toast, setToast] = useState<string | null>(null);

    return (
        <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-pageBg via-background to-hoverBg px-md">
            {/* decorative floating shapes (React Bits vibe, theme-friendly) */}
            <div
                aria-hidden
                className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-badge bg-primaryLight blur-3xl animate-blob"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-badge bg-hoverBg blur-3xl animate-blob-slow"
            />

            {/* softly drifting background particles */}
            <Particles count={16} />

            {/* centered column: crest → clock → title → card */}
            <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-col items-center py-xl">
                {/* crest + wordmark — fully centered stack */}
                <AnimatedContent delay={0.02}>
                    <div className="flex flex-col items-center text-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-badge border border-divider bg-surface text-primary shadow-card">
                            <GraduationCap size={28} />
                        </span>
                        <div className="mt-sm leading-tight">
                            {site.university.map((line) => (
                                <p
                                    key={line}
                                    className="text-[11px] font-semibold uppercase tracking-[0.14em] text-textNormal"
                                >
                                    {line}
                                </p>
                            ))}
                        </div>
                    </div>
                </AnimatedContent>

                {/* title */}
                <AnimatedContent delay={0.06}>
                    <h1 className="mt-md text-center text-[32px] font-bold tracking-[-0.02em] text-text">
                        <ShinyText text={site.systemTitle} />
                    </h1>
                </AnimatedContent>

                {/* live date + ticking clock */}
                <FadeContent delay={0.08}>
                    <LiveClock />
                </FadeContent>

                {/* card */}
                <FadeContent delay={0.1} className="mt-lg w-full">
                    <LoginCard onFail={setToast} />
                </FadeContent>
            </div>

            {/* login failure toast (replaces the /login/fail redirect page) */}
            <Toast message={toast} onDone={() => setToast(null)} />
        </main>
    );
}
