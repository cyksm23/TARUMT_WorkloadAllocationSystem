import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { DEV_DIRECTORY, DEV_PASSWORD, fallbackAllowed, type DevLecturer } from "./devDirectory";

/**
 * POST /api/auth/login — verifies a 4-digit lecturer code + password.
 *
 * Primary source of truth: PostgreSQL (users + lecturers, bcrypt hashes
 * seeded via pgcrypto).  When the DB is unreachable or the teaching_workload_db
 * is not initialised yet (and app is NOT in production), falls back to the
 * static DEV directory so the login page is testable before Phase 1 is run.
 */

export const runtime = "nodejs";

export interface LoginUser {
  id: number | null;
  username: string;
  email: string | null;
  role: "admin" | "coordinator" | "lecturer" | "hod";
  staffId: string | null;
  code: string;
  fullName: string;
  position: string | null;
  employmentType: string | null;
  department: string | null;
  departmentName?: string | null;
}

/* ── 4-digit segmented display shared with the UI ──────────────────────────── */

const bodyOf = (req: NextRequest) => req.json().catch(() => ({}) as Record<string, unknown>);

const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, message, ...extra }, { status });

/* ── HS256 JWT (no external dependency) ────────────────────────────────────── */

const b64url = (s: Buffer | string) =>
  (Buffer.isBuffer(s) ? s : Buffer.from(s)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function signJwt(payload: Record<string, unknown>, ttlSeconds: number): string {
  const secret = process.env.AUTH_SECRET || "dev-secret-change-me";
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const data = b64url(Buffer.from(JSON.stringify(body)));
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${data}`).digest();
  return `${head}.${data}.${b64url(sig)}`;
}

/* ── Postgres lookup ────────────────────────────────────────────────────────── */

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "teaching_workload_db",
      connectionTimeoutMillis: 4000,
      max: 4,
    });
  }
  return pool;
}

interface DbRow {
  id: number;
  username: string;
  email: string | null;
  role: string;
  password_hash: string;
  is_active: boolean;
  lecturer_id: number | null;
  staff_id: string | null;
  full_name: string | null;
  position: string | null;
  employment_type: string | null;
  department_code: string | null;
  department_name: string | null;
}

/* ── handler ───────────────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const body = (await bodyOf(req)) as { code?: string; password?: string };
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");

  if (!/^\d{4}$/.test(code)) return fail(400, "Lecturer code must be exactly 4 digits.");
  if (!password) return fail(400, "Password is required.");

  /* 1 ── try the database first ───────────────────────────────────────────── */
  try {
    const { rows } = await getPool().query(
      `SELECT u.id, u.username, u.email, u.role, u.password_hash, u.is_active,
              l.id AS lecturer_id, l.staff_id, l.full_name, l.position,
              l.employment_type, d.department_code, d.department_name
         FROM users u
         LEFT JOIN lecturers l ON l.user_id = u.id
         LEFT JOIN departments d ON d.id = l.department_id
        WHERE (l.staff_id = $1 OR l.staff_id = 'L' || $1 OR ($2 = TRUE AND u.username = 'admin'))
        LIMIT 1`,
      [code, code === "0000"]
    );

    const row: DbRow | undefined = rows[0];
    if (row) {
      const valid = await bcrypt.compare(password, row.password_hash);
      if (!valid) return fail(401, "Invalid lecturer code or password.");
      if (!row.is_active) return fail(403, "This account is deactivated.");

      getPool()
        .query("UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1", [row.id])
        .catch(() => undefined);

      const user: LoginUser = {
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role as LoginUser["role"],
        staffId: row.staff_id,
        code,
        fullName: row.full_name ?? row.username,
        position: row.position,
        employmentType: row.employment_type,
        department: row.department_code,
        departmentName: row.department_name,
      };

      return NextResponse.json({
        ok: true,
        source: "database",
        token: signJwt({ sub: row.id, role: row.role, staff: row.staff_id }, 12 * 3600),
        expires: (Math.floor(Date.now() / 1000) + 12 * 3600) * 1000,
        user,
      });
    }
    return fail(401, "Lecturer code not found.");
  } catch (dbError) {
    /* 2 ── DEV fallback when the DB is not initialised yet ─────────────────── */
    if (fallbackAllowed()) {
      console.warn(
        "[auth] DB not reachable, using DEV fallback directory. Error:",
        dbError instanceof Error ? dbError.message : dbError
      );
      const match = DEV_DIRECTORY.find((d: DevLecturer) => d.code === code);
      if (!match) return fail(401, "Lecturer code not found.");
      if (password !== DEV_PASSWORD) return fail(401, "Invalid lecturer code or password.");

      const user: LoginUser = {
        id: null,
        username: match.code === "0000" ? "admin" : match.fullName.toLowerCase().replace(/[^a-z]/g, "."),
        email: null,
        role: match.role,
        staffId: match.code === "0000" ? null : `L${match.code}`,
        code,
        fullName: match.fullName,
        position: match.position,
        employmentType: match.employmentType,
        department: match.department,
      };
      return NextResponse.json({
        ok: true,
        source: "dev-fallback",
        token: signJwt({ sub: match.code, role: match.role }, 12 * 3600),
        expires: (Math.floor(Date.now() / 1000) + 12 * 3600) * 1000,
        user,
      });
    }
    return fail(503, "Database not reachable and fallback disabled.");
  }
}
