/**
 * GET    /api/programmes        — programme directory + per-programme course census.
 * POST   /api/programmes        — create a programme (UC_CPM_01).
 * PATCH  /api/programmes/:code  — maintain programme details (code immutable).
 * DELETE /api/programmes/:code  — remove a programme; refused while courses reference it.
 *
 * Programme codes are uppercase alphanumerics and globally unique
 * (programmes_programme_code_key). Levels follow the DB's CHECK-free
 * whitelist used across the department: Bachelor / Master / Diploma /
 * Foundation (NULL allowed for special programmes).
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

/** accepted programme levels — mirrors the seed data's level vocabulary */
const LEVELS = new Set(["Bachelor", "Master", "Diploma", "Foundation"]);

/* ── GET /api/programmes ──────────────────────────────────────────────────── */

router.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query(`
      SELECT p.programme_code                   AS "programmeCode",
             p.programme_name                   AS "programmeName",
             COALESCE(d.department_code, '—')   AS "department",
             p.level,
             p.duration_years                   AS "durationYears",
             p.is_active                        AS "isActive",
             (SELECT COUNT(*)::int
                FROM subjects s
               WHERE s.programme_id = p.id)     AS "subjectCount"
        FROM programmes p
        LEFT JOIN departments d ON d.id = p.department_id
       ORDER BY p.programme_code
    `);
    const { rows: deps } = await getPool().query(`
      SELECT department_code AS code, department_name AS name
        FROM departments
       WHERE is_active
       ORDER BY department_code
    `);
    return res.json({ ok: true, programmes: rows, departments: deps });
  } catch (err) {
    console.error("GET /api/programmes failed:", err);
    return res.status(500).json({ ok: false, message: "Programme directory unavailable." });
  }
});

/* ── POST /api/programmes ─────────────────────────────────────────────────── */

router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? null) as Record<string, unknown> | null;
  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  /* programme code — 2–10 uppercase alphanumerics/dashes (DSF, RSD, MFT…) */
  const code = typeof body.programmeCode === "string" ? body.programmeCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code)) {
    return res.status(400).json({
      ok: false,
      message: "Programme code must be 2–10 letters or digits (no spaces).",
    });
  }

  const name = typeof body.programmeName === "string" ? body.programmeName.trim() : "";
  if (!name) {
    return res.status(400).json({ ok: false, message: "Programme name is required." });
  }

  /* department — defaults to the Programme Leader's DCIT scope */
  const departmentCode =
    typeof body.departmentCode === "string" && body.departmentCode.trim()
      ? body.departmentCode.trim().toUpperCase()
      : "DCIT";

  const level =
    typeof body.level === "string" && LEVELS.has(body.level) ? body.level : null;

  /* duration — 1–8 whole years, default 3 (the national diploma length) */
  let durationYears: number | null = null;
  if (body.durationYears !== undefined && body.durationYears !== null && body.durationYears !== "") {
    const d = Number(body.durationYears);
    if (!Number.isInteger(d) || d < 1 || d > 8) {
      return res
        .status(400)
        .json({ ok: false, message: "Duration must be a whole number of years between 1 and 8." });
    }
    durationYears = d;
  } else {
    durationYears = 3;
  }

  const isActive = body.isActive !== false;

  try {
    const depRows = await getPool().query(
      "SELECT id FROM departments WHERE department_code = $1 LIMIT 1",
      [departmentCode],
    );
    const dep = depRows.rows[0] as { id: number } | undefined;
    if (!dep) {
      return res.status(400).json({ ok: false, message: `Unknown department "${departmentCode}".` });
    }

    const insert = await getPool().query(
      `INSERT INTO programmes (programme_code, programme_name, department_id, level, duration_years, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING programme_code`,
      [code, name, dep.id, level, durationYears, isActive],
    );
    if (insert.rowCount === 0) {
      return res.status(500).json({ ok: false, message: "Could not create the programme." });
    }
    return res.status(201).json({ ok: true, programmeCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return res
        .status(409)
        .json({ ok: false, message: "That programme code is already registered." });
    }
    console.error("POST /api/programmes failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while adding the programme." });
  }
});

/* ── PATCH /api/programmes/:code ──────────────────────────────────────────── */
/* Whitelist column map — the :code path parameter is bound and only the
   recognized fields below ever reach the SQL. */
const PROGRAMME_COLUMNS: Array<{
  key: string;
  column: string;
  cast: (v: unknown) => unknown | null;
}> = [
  { key: "programmeName", column: "programme_name", cast: (v) => (typeof v === "string" && v.trim() ? v.trim() : null) },
  { key: "level", column: "level", cast: (v) => (typeof v === "string" && LEVELS.has(v) ? v : null) },
  {
    key: "durationYears",
    column: "duration_years",
    cast: (v) => {
      const d = Number(v);
      return Number.isInteger(d) && d >= 1 && d <= 8 ? d : null;
    },
  },
  { key: "isActive", column: "is_active", cast: (v) => (typeof v === "boolean" ? v : null) },
];

router.patch("/:code", async (req: Request, res: Response) => {
  const code = typeof req.params.code === "string" ? req.params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code)) {
    return res.status(400).json({ ok: false, message: "Programme code must be 2–10 letters or digits." });
  }

  const body = (req.body ?? null) as Record<string, unknown> | null;
  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  /* durable columns; departmentCode resolves through a separate lookup */
  const sets: string[] = [];
  const params: unknown[] = [];
  let departmentCode: string | null = null;

  for (const field of PROGRAMME_COLUMNS) {
    if (!(field.key in body)) continue;
    /* an explicit null on the nullable `level` clears it; other fields
       skip so a bad value never wipes existing data */
    if (field.key === "level" && body.level === null) {
      params.push(null);
      sets.push(`${field.column} = $${params.length}`);
      continue;
    }
    const value = field.cast(body[field.key]);
    if (value === null) continue;
    params.push(value);
    sets.push(`${field.column} = $${params.length}`);
  }

  if (typeof body.departmentCode === "string" && body.departmentCode.trim()) {
    departmentCode = body.departmentCode.trim().toUpperCase();
  }

  if (sets.length === 0 && !departmentCode) {
    return res.status(400).json({ ok: false, message: "No editable fields supplied." });
  }

  try {
    if (departmentCode) {
      const depRows = await getPool().query("SELECT id FROM departments WHERE department_code = $1 LIMIT 1", [
        departmentCode,
      ]);
      const dep = depRows.rows[0] as { id: number } | undefined;
      if (!dep) {
        return res.status(400).json({ ok: false, message: `Unknown department "${departmentCode}".` });
      }
      params.push(dep.id);
      sets.push(`department_id = $${params.length}`);
    }

    params.push(code);
    const result = await getPool().query(
      `UPDATE programmes SET ${sets.join(", ")} WHERE programme_code = $${params.length} RETURNING programme_code`,
      params,
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: `No programme "${code}".` });
    }
    return res.json({ ok: true, programmeCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return res.status(409).json({ ok: false, message: "That programme code is already registered." });
    }
    console.error("PATCH /api/programmes/:code failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while saving the programme." });
  }
});

/* ── DELETE /api/programmes/:code ─────────────────────────────────────────── */
/* subjects.programme_id defaults to NO ACTION — refuse with a clear 409
   while courses still sit in the programme. */
router.delete("/:code", async (req: Request, res: Response) => {
  const code = typeof req.params.code === "string" ? req.params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code)) {
    return res.status(400).json({ ok: false, message: "Programme code must be 2–10 letters or digits." });
  }
  try {
    const linked = await getPool().query(
      "SELECT COUNT(*)::int AS refs FROM subjects WHERE programme_id = (SELECT id FROM programmes WHERE programme_code = $1)",
      [code],
    );
    const refs = Number(linked.rows[0]?.refs ?? 0);
    if (refs > 0) {
      return res.status(409).json({
        ok: false,
        message: `Programme ${code} still has ${refs} course(s) — reassign or remove its courses first.`,
      });
    }

    const result = await getPool().query(
      "DELETE FROM programmes WHERE programme_code = $1 RETURNING programme_code",
      [code],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: `No programme "${code}".` });
    }
    return res.json({ ok: true, programmeCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return res.status(409).json({
        ok: false,
        message: `Programme ${code} is still referenced by other records — it cannot be deleted.`,
      });
    }
    console.error("DELETE /api/programmes/:code failed:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Database error while deleting the programme." });
  }
});

export default router;
