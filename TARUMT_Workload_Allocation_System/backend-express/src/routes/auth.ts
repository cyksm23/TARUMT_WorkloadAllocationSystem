/**
 * POST /api/auth/login — verifies a 4-digit lecturer code + password.
 *
 * Ported 1:1 from frontend/src/app/api/auth/login/route.ts.
 * Primary source of truth: PostgreSQL (users + lecturers, bcrypt hashes
 * seeded via pgcrypto). When the DB is unreachable (and app is NOT in
 * production), falls back to the static DEV directory so the login page
 * stays testable before the database is initialised.
 */
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { getPool } from "../db";
import { signJwt } from "../token";
import { DEV_DIRECTORY, DEV_PASSWORD, fallbackAllowed, type DevLecturer } from "./devDirectory";

const router = Router();

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

const fail = (res: Response, status: number, message: string, extra: Record<string, unknown> = {}) =>
  res.status(status).json({ ok: false, message, ...extra });

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

router.post("/login", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { code?: unknown; password?: unknown };
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");

  if (!/^\d{4}$/.test(code)) return fail(res, 400, "Staff ID must be exactly 4 digits.");
  if (!password) return fail(res, 400, "Password is required.");

  /* 1 ── try the database first ─────────────────────────────────────────── */
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
      if (!valid) return fail(res, 401, "Invalid Staff ID or password.");
      if (!row.is_active) return fail(res, 403, "This account is deactivated.");

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

      return res.status(200).json({
        ok: true,
        source: "database",
        token: signJwt({ sub: row.id, role: row.role, staff: row.staff_id }, 12 * 3600),
        expires: (Math.floor(Date.now() / 1000) + 12 * 3600) * 1000,
        user,
      });
    }
    return fail(res, 401, "Staff ID not found.");
  } catch (dbError) {
    /* 2 ── DEV fallback when the DB is not initialised yet ────────────────── */
    if (fallbackAllowed()) {
      console.warn(
        "[auth] DB not reachable, using DEV fallback directory. Error:",
        dbError instanceof Error ? dbError.message : String(dbError), // Keep the message short
      );
      const match = DEV_DIRECTORY.find((d: DevLecturer) => d.code === code);
      if (!match) return fail(res, 401, "Staff ID not found.");
      if (password !== DEV_PASSWORD) return fail(res, 401, "Invalid Staff ID or password.");

      const user: LoginUser = {
        id: null,
        username: match.code === "0000" ? "admin" : match.fullName.toLowerCase().replace(/[^a-z]/g, "."), // mirror DB username convention
        email: null,
        role: match.role,
        staffId: match.code === "0000" ? null : `L${match.code}`,
        code,
        fullName: match.fullName,
        position: match.position,
        employmentType: match.employmentType,
        department: match.department,
      };
      return res.status(200).json({
        ok: true,
        source: "dev-fallback",
        token: signJwt({ sub: match.code, role: match.role }, 12 * 3600),
        expires: (Math.floor(Date.now() / 1000) + 12 * 3600) * 1000,
        user,
      });
    }
    return fail(res, 503, "Database not reachable and fallback disabled.");
  }
});

export default router;
