/**
 * Auth service — manages the login flow from the client side.
 *
 * Order of preference:
 *   1. PHP API         `${NEXT_PUBLIC_API_URL}/auth/login`  (core service)
 *   2. Next.js route   `/api/auth/login`                    (same Postgres, dev fallback)
 */
import type { User } from "@/types";

export interface AuthUser extends Pick<User, "id" | "username" | "email" | "role"> {
  staffId: string | null;
  code: string;
  fullName: string;
  position: string | null;
  employmentType: string | null;
  department: string | null;
  departmentName?: string | null;
}

export interface AuthSession {
  token: string;
  expires: number;
  source: "php-api" | "database" | "dev-fallback";
  user: AuthUser;
}

export const AUTH_STORAGE_KEY = "tw_auth";

export function saveAuth(session: AuthSession): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  }
}

export function getAuth(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

/** Landing page per role (placeholders in the scaffold). */
export function landingFor(role: AuthUser["role"]): string {
  switch (role) {
    case "coordinator":
      return "/allocations";
    case "hod":
      return "/workloads";
    default:
      return "/dashboard";
  }
}

const isSession = (data: unknown): data is AuthSession =>
  typeof data === "object" && data !== null && "token" in data && "user" in data;

async function postJson(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { ok: false, message: "network-error" } };
  }
}

export class LoginError extends Error {
  constructor(
    message: string,
    public readonly kind: "invalid" | "network" | "server" | "deactivated"
  ) {
    super(message);
  }
}

/** Verifies a 4-digit lecturer code + password. Throws LoginError on failure. */
export async function login(code: string, password: string): Promise<AuthSession> {
  const payload = { code, password };
  const phpBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

  /* 1 ── PHP core API ─────────────────────────────────────────────────────── */
  const php = await postJson(`${phpBase}/auth/login`, payload);
  if (php.status === 200 && isSession(php.data)) return php.data;
  if (php.status >= 400 && php.status < 500) {
    const d = php.data as { message?: string };
    throw new LoginError(d.message ?? "Invalid Staff ID or password.", "invalid");
  }
  // status 0 (PHP not running) or 5xx (e.g. DB not reachable / pdo_pgsql off)
  //  → continue to the Next.js route handler.

  /* 2 ── Next.js route handler (same Postgres, dev fallback) ──────────────── */
  const local = await postJson("/api/auth/login", payload);
  if (local.status === 200 && isSession(local.data)) return local.data;
  if (local.status === 0) {
    throw new LoginError("Cannot reach any auth service. Is the dev server running?", "network");
  }
  const d = local.data as { message?: string };
  throw new LoginError(d.message ?? "Invalid Staff ID or password.", local.status === 403 ? "deactivated" : "invalid");
}
