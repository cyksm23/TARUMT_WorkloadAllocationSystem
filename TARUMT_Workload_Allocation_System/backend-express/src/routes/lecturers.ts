/**
 * GET   /api/lecturers          — Programme Leader staff directory (UC_CPM_01).
 * PATCH /api/lecturers/:staffId — maintain lecturer details + stored limit pair.
 *
 * Ported 1:1 from frontend/src/app/api/lecturers/route.ts and
 * frontend/src/app/api/lecturers/[staffId]/route.ts.
 *
 * Full roster straight from PostgreSQL: lecturers joined with their
 * department and linked login account, plus a per-lecturer semester
 * workload roll-up. Each lecturer carries a materialized limit pair that is
 * seeded once and then snapshot-stable; rules edits never rewrite it — pairs
 * that drift from (or stand outside) the current rules surface as ⚠.
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

/* ── GET /api/lecturers ────────────────────────────────────────────────────── */

router.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query(`
      WITH taught_levels AS (
        SELECT w.lecturer_id,
               array_agg(DISTINCT UPPER(p.level)) AS levels
          FROM workloads w
          JOIN workload_details wd ON wd.workload_id = w.id
          JOIN subjects s ON s.id = wd.subject_id
          JOIN programmes p ON p.id = s.programme_id
         WHERE p.level IS NOT NULL
         GROUP BY w.lecturer_id
      ),
      rw AS (
        SELECT l.id AS lecturer_id,
               CASE
                 WHEN l.is_pl THEN 'PL'
                 WHEN 'BACHELOR' = ANY(t.levels) AND 'DIPLOMA' = ANY(t.levels) THEN 'BOTH'
                 WHEN 'BACHELOR' = ANY(t.levels) THEN 'BACHELOR_ONLY'
                 WHEN 'DIPLOMA'  = ANY(t.levels) THEN 'DIPLOMA_ONLY'
                 ELSE 'DEFAULT'
               END AS rule_key
          FROM lecturers l
          LEFT JOIN taught_levels t ON t.lecturer_id = l.id
      )
      SELECT
        l.id,
        l.staff_id,
        l.full_name,
        l.email,
        l.phone_number,
        l.position,
        l.is_pl,
        l.employment_type,
        l.is_active,
        rw.rule_key,
        r.label    AS rule_label,
        r.basis    AS rule_basis,
        /* stored per-lecturer pair (snapshot-stable) + the rule's current
           suggestion + its sync / bounds status vs that rule */
        l.min_limit_hours,
        l.max_limit_hours,
        r.min_hours    AS rule_min_hours,
        r.max_hours    AS rule_max_hours,
        (l.min_limit_hours <> r.min_hours OR l.max_limit_hours <> r.max_hours) AS out_of_sync,
        (l.min_limit_hours < r.min_hours OR l.min_limit_hours > r.max_hours
         OR l.max_limit_hours < r.min_hours OR l.max_limit_hours > r.max_hours) AS out_of_range,
        d.department_code,
        d.department_name,
        u.username,
        (SELECT COUNT(*)::int
           FROM workloads w
          WHERE w.lecturer_id = l.id)                                AS semester_records,
        (SELECT COALESCE(SUM(w.total_allocated_hours), 0)::float8
           FROM workloads w
          WHERE w.lecturer_id = l.id)                                AS allocated_hours
      FROM lecturers  l
      LEFT JOIN departments d ON d.id = l.department_id
      LEFT JOIN users       u ON u.id = l.user_id
      JOIN rw             ON rw.lecturer_id = l.id
      JOIN workload_rules r ON r.rule_key = rw.rule_key
      ORDER BY l.staff_id
    `);

    /* editable rules travel alongside the roster for the page's rules editor */
    const ruleRows = await getPool().query(`
      SELECT rule_key, label, basis, priority, min_hours, max_hours
        FROM workload_rules
       ORDER BY priority, rule_key
    `);

    const lecturers = rows.map((r) => ({
      id: r.id,
      staffId: r.staff_id,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone_number,
      position: r.position,
      isPl: r.is_pl === true,
      employmentType: r.employment_type,
      isActive: r.is_active === true,
      /* per-lecturer stored pair (snapshot-stable) + rule suggestion +
         sync status: custom = pair drifted from the rule (informational),
         outOfRange = pair violates the rule's allowed bounds (⚠) */
      ruleKey: r.rule_key,
      ruleLabel: r.rule_label,
      ruleBasis: r.rule_basis,
      minHours: Number(r.min_limit_hours),
      maxHours: Number(r.max_limit_hours),
      suggestedMin: Number(r.rule_min_hours),
      suggestedMax: Number(r.rule_max_hours),
      custom: r.out_of_sync === true,
      outOfRange: r.out_of_range === true,
      departmentCode: r.department_code,
      departmentName: r.department_name,
      username: r.username,
      semesterRecords: Number(r.semester_records ?? 0),
      allocatedHours: Number(r.allocated_hours ?? 0),
    }));

    const byType = (t: string) => lecturers.filter((l) => l.employmentType === t).length;

    return res.status(200).json({
      ok: true,
      department: lecturers[0]?.departmentName ?? null,
      counts: {
        total: lecturers.length,
        fullTime: byType("FULL_TIME"),
        partTime: byType("PART_TIME"),
        contract: byType("CONTRACT"),
        programmeLeaders: lecturers.filter((l) => l.isPl).length,
      },
      rules: ruleRows.rows.map((r) => ({
        ruleKey: r.rule_key,
        label: r.label,
        basis: r.basis,
        priority: r.priority,
        minHours: Number(r.min_hours),
        maxHours: Number(r.max_hours),
      })),
      lecturers,
    });
  } catch (err) {
    console.error("GET /api/lecturers failed", err);
    return res.status(500).json({ ok: false, message: "Lecturer directory unavailable." });
  }
});

/* ── PATCH /api/lecturers/:staffId — UC_CPM_01 "maintain lecturer details" ── */
/*
 * Accepts the editable subset of the lecturers record (identity, contact,
 * position, classification, active flag) plus the lecturer's stored
 * workload-limit pair (min/max — written verbatim; paired fields required).
 * Limits are snapshot-stable: rules edits never rewrite them, and stored
 * pairs that drift from the current rule surface a warning badge. The
 * Hour-limit rules ceiling still applies to any saved pair. staff_id is
 * never edited.
 *
 * Dynamic fields are bound as parameters and column names come only from the
 * whitelisted map below, so the SQL built from `updates` stays safe.
 */

const EMPLOYMENT = new Set(["FULL_TIME", "PART_TIME", "CONTRACT"]);

/** standalone weekly-hour validity for creation: 0.5–45 bounds + ≤2 decimals */
const LIMIT_MIN_VAL = 0.5;
const LIMIT_MAX_VAL = 45;
const badHoursValue = (v: number) =>
  !Number.isFinite(v) ||
  v < LIMIT_MIN_VAL ||
  v > LIMIT_MAX_VAL ||
  Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;

/* ── POST /api/lecturers — create a new staff record (UC_CPM_01) ──────────── */
/*
 * Adds a lecturer from the Programme Leader's "Add Staff" form. The stored
 * limit pair is seeded once here (the form prefills it from the DEFAULT
 * rule) and stays snapshot-stable afterwards — exactly like existing rows.
 * is_pl is derived in the dialog: choosing "Programme Leader" sends isPl.
 */
router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? null) as Record<string, unknown> | null;
  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  /* staff id — 4 digits, like every existing code */
  const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
  if (!/^\d{4}$/.test(staffId)) {
    return res.status(400).json({ ok: false, message: "Staff ID must be exactly 4 digits." });
  }

  /* full name mandatory — mirrors PATCH */
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName) {
    return res.status(400).json({ ok: false, message: "Full name is required." });
  }

  /* classification — same whitelist as PATCH */
  const employmentType =
    typeof body.employmentType === "string" && EMPLOYMENT.has(body.employmentType)
      ? body.employmentType
      : null;
  if (!employmentType) {
    return res
      .status(400)
      .json({ ok: false, message: "Classification must be full-time, part-time or contract." });
  }

  /* optional contact/text fields — empty strings become NULL */
  const optionalText = (field: string): string | null =>
    typeof body[field] === "string" && (body[field] as string).trim()
      ? (body[field] as string).trim()
      : null;

  const email = optionalText("email");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ ok: false, message: "Enter a valid email address." });
  }
  const phone = optionalText("phone");
  const position = optionalText("position");

  const isPl = body.isPl === true; /* Programme Leader drives the PL rule */
  const isActive = body.isActive !== false;

  /* department — defaults to the DCIT programme-leader scope */
  const departmentCode =
    typeof body.departmentCode === "string" && body.departmentCode.trim()
      ? body.departmentCode.trim().toUpperCase()
      : "DCIT";

  /* stored limit pair — required at creation (NOT NULL + CHECK) */
  const minRaw = Number(body.minHours);
  const maxRaw = Number(body.maxHours);
  if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw)) {
    return res.status(400).json({ ok: false, message: "Provide the min and max hour limits." });
  }
  if (badHoursValue(minRaw) || badHoursValue(maxRaw) || minRaw > maxRaw) {
    return res.status(400).json({
      ok: false,
      message: "Hour limits must be between 0.5 and 45 h/wk, min ≤ max, two decimals max.",
    });
  }
  const cleanMin = Math.round(minRaw * 100) / 100;
  const cleanMax = Math.round(maxRaw * 100) / 100;

  try {
    /* department lookup — reject unknown codes early */
    const depRows = await getPool().query(
      "SELECT id, department_name FROM departments WHERE department_code = $1 LIMIT 1",
      [departmentCode]
    );
    const dep = depRows.rows[0] as { id: number; department_name: string } | undefined;
    if (!dep) {
      return res.status(400).json({ ok: false, message: `Unknown department "${departmentCode}".` });
    }

    /* the rules ceiling applies to the seeded pair as well */
    const { rows: ceilingRows } = await getPool().query(
      "SELECT COALESCE(MAX(max_hours), 45)::float8 AS ceiling FROM workload_rules"
    );
    const ceiling = Number(ceilingRows[0]?.ceiling ?? 45);
    if (cleanMin > ceiling || cleanMax > ceiling) {
      return res.status(400).json({
        ok: false,
        message: `Cannot add — ${cleanMax > ceiling ? cleanMax : cleanMin}h exceeds the ${ceiling}h maximum set in the Hour-limit rules.`,
      });
    }

    const insert = await getPool().query(
      `INSERT INTO lecturers
         (staff_id, full_name, email, phone_number, position, employment_type,
          is_pl, is_active, min_limit_hours, max_limit_hours, department_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING staff_id`,
      [staffId, fullName, email, phone, position, employmentType, isPl, isActive, cleanMin, cleanMax, dep.id]
    );

    if (insert.rowCount === 0) {
      return res.status(500).json({ ok: false, message: "Could not create the lecturer." });
    }

    return res.status(201).json({ ok: true, staffId });
  } catch (err) {
    /* unique_violation (23505) — staff id or email already taken */
    if ((err as { code?: string }).code === "23505") {
      return res
        .status(409)
        .json({ ok: false, message: "That staff ID or email is already registered." });
    }
    console.error("POST /api/lecturers failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while adding the lecturer." });
  }
});

/* ── DELETE /api/lecturers/:staffId — remove a staff record ─────────────── */
/* Hard delete from the roster. If workloads/assignments still reference
   the lecturer, Postgres raises a FK violation (23503) — surface that as
   a 409 advising deactivation instead of silently losing data. */
router.delete("/:staffId", async (req: Request, res: Response) => {
  const staffId = typeof req.params.staffId === "string" ? req.params.staffId.trim() : "";
  if (!/^\d{4}$/.test(staffId)) {
    return res.status(400).json({ ok: false, message: "Staff ID must be exactly 4 digits." });
  }
  try {
    /* workloads.lecturer_id is ON DELETE CASCADE — a blind delete would
       silently erase the lecturer's workload rows. Refuse first and point
       at the soft (inactive) path instead. */
    const linked = await getPool().query(
      "SELECT COUNT(*)::int AS refs FROM workloads WHERE lecturer_id = (SELECT id FROM lecturers WHERE staff_id = $1)",
      [staffId]
    );
    const refs = Number(linked.rows[0]?.refs ?? 0);
    if (refs > 0) {
      return res.status(409).json({
        ok: false,
        message: `Staff ${staffId} still has ${refs} linked workload row(s) — set them inactive instead of deleting.`,
      });
    }

    const result = await getPool().query(
      "DELETE FROM lecturers WHERE staff_id = $1 RETURNING staff_id",
      [staffId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: `No staff member "${staffId}".` });
    }
    return res.json({ ok: true, staffId });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return res.status(409).json({
        ok: false,
        message: `Staff ${staffId} still has linked records (workloads or assignments) — deactivate them instead of deleting.`,
      });
    }
    console.error("DELETE /api/lecturers/:staffId failed:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Database error while deleting the lecturer." });
  }
});

router.patch("/:staffId", async (req: Request, res: Response) => {
  const { staffId } = req.params;
  const body = (req.body ?? null) as Record<string, unknown> | null;

  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  /* full name is mandatory — everything else optional / validated */
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName) {
    return res
      .status(400)
      .json({ ok: false, message: "Full name is required." });
  }

  const employmentType =
    typeof body.employmentType === "string" && EMPLOYMENT.has(body.employmentType)
      ? body.employmentType
      : null;
  if (!employmentType) {
    return res.status(400).json({
      ok: false,
      message: "Classification must be full-time, part-time or contract.",
    });
  }

  /* workload-limit pair — the dialog always sends both when limits are shown;
     they write the snapshot-stored pair directly (never auto-updated) */
  let overrideUpdate: { min: number; max: number } | null = null;
  if (body.overrideMin !== undefined || body.overrideMax !== undefined) {
    if (body.overrideMin === undefined || body.overrideMax === undefined) {
      return res.status(400).json({
        ok: false,
        message: "Provide both limit values or neither.",
      });
    }
    const isBlank = (v: unknown) => v === null || v === "";
    const mn = Number(body.overrideMin);
    const mx = Number(body.overrideMax);

    if (isBlank(body.overrideMin) || isBlank(body.overrideMax)) {
      return res.status(400).json({
        ok: false,
        message: "Limit values cannot be empty — every lecturer keeps a stored pair.",
      });
    } else if (
      !Number.isFinite(mn) ||
      !Number.isFinite(mx) ||
      mn < 0.5 ||
      mx < 0.5 ||
      mn > 45 ||
      mx > 45
    ) {
      return res.status(400).json({
        ok: false,
        message: "Hour limits must be between 0.5 and 45 h/wk.",
      });
    } else if (mn > mx) {
      return res.status(400).json({
        ok: false,
        message: "Minimum limit cannot exceed maximum limit.",
      });
    } else if (
      Math.abs(mn * 100 - Math.round(mn * 100)) > 1e-6 ||
      Math.abs(mx * 100 - Math.round(mx * 100)) > 1e-6
    ) {
      return res.status(400).json({
        ok: false,
        message: "Hours accept at most two decimal places (e.g. 12.50).",
      });
    } else {
      const cleanMin = Math.round(mn * 100) / 100;
      const cleanMax = Math.round(mx * 100) / 100;

      /* the Hour-limit rules ceiling applies: no override may exceed the
         largest max_hours defined in workload_rules */
      const { rows: ceilingRows } = await getPool().query(
        "SELECT COALESCE(MAX(max_hours), 45)::float8 AS ceiling FROM workload_rules"
      );
      const ceiling = Number(ceilingRows[0]?.ceiling ?? 45);
      if (cleanMin > ceiling || cleanMax > ceiling) {
        return res.status(400).json({
          ok: false,
          message: `Cannot save — ${cleanMax > ceiling ? cleanMax : cleanMin}h exceeds the ${ceiling}h maximum set in the Hour-limit rules.`,
        });
      }
      overrideUpdate = { min: cleanMin, max: cleanMax };
    }
  }

  /** ordered values → their $n placeholders, built only from the whitelist */
  const values: unknown[] = [];
  const update = (column: string, value: unknown) => {
    values.push(value);
    return `${column} = $${values.length}`;
  };

  const text = (field: string) =>
    typeof body[field] === "string" && (body[field] as string).trim()
      ? (body[field] as string).trim()
      : null;

  const sql = [
    update("full_name", fullName),
    update("email", text("email")),
    update("phone_number", text("phone")),
    update("position", text("position")),
    update("employment_type", employmentType),
    update("is_pl", body.isPl === true),
    update("is_active", body.isActive !== false),
    /* snapshot limit pair arrives together — write both columns in one pass */
    ...(overrideUpdate
      ? [update("min_limit_hours", overrideUpdate.min), update("max_limit_hours", overrideUpdate.max)]
      : []),
    "updated_at = NOW()",
  ].join(", ");

  try {
    const result = await getPool().query(
      `UPDATE lecturers SET ${sql} WHERE staff_id = $${values.length + 1} RETURNING staff_id`,
      [...values, staffId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: "Lecturer not found." });
    }
    return res.status(200).json({ ok: true, staffId });
  } catch (err) {
    /* unique_violation (23505) — the roster email is already taken */
    if ((err as { code?: string }).code === "23505") {
      return res
        .status(409)
        .json({ ok: false, message: "That email is already used by another staff member." });
    }
    console.error("PATCH /api/lecturers/:staffId failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while saving lecturer." });
  }
});

export default router;
