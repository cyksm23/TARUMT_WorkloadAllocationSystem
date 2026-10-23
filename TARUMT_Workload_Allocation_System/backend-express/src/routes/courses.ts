/**
 * GET    /api/courses        — subject directory joined with programme + academic year.
 * POST   /api/courses        — create a course (UC_CPM_01).
 * PATCH  /api/courses/:code  — maintain course details (code immutable).
 * DELETE /api/courses/:code  — remove a course; refused while workload details
 *                              reference it (workload_details.subject_id).
 *
 * Column notes: the hour components are NUMERIC(4,1) — AT MOST one decimal
 * place. total_hours is maintained as lecture + tutorial + practical (the
 * workbook's own composition), so the API recomputes it on every write.
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

/* ── GET /api/courses ─────────────────────────────────────────────────────── */

router.get("/", async (_req: Request, res: Response) => {
  try {
    /* future academic years provision themselves ahead of time — while the
       last seeded intake ends within ~6 months, the next academic year and
       its three coded terms (e.g. 2028 → 202805 / 202809 / 202901) appear */
    const provisioned = await getPool().query("SELECT ensure_academic_year_horizon() AS created");
    const createdCount = Number(provisioned.rows[0]?.created ?? 0);
    if (createdCount > 0) {
      console.log(`ensure_academic_year_horizon: auto-created ${createdCount} academic year(s)`);
    }
    const { rows } = await getPool().query(`
      SELECT s.subject_code                         AS "subjectCode",
             s.subject_name                         AS "subjectName",
             p.programme_code                       AS "programmeCode",
             COALESCE(p.programme_name, '—')        AS "programmeName",
             s.academic_year_id                     AS "academicYearId",
             COALESCE(t.term_code || ' · AY ' || ay.year_code, '—')
                                                    AS "academicYearLabel",
             s.credit_hours                         AS "creditHours",
             s.lecture_hours                        AS "lectureHours",
             s.tutorial_hours                       AS "tutorialHours",
             s.practical_hours                      AS "practicalHours",
             s.total_hours                          AS "totalHours",
             s.tutorial_students                    AS "tutorialStudents",
             s.practical_students                   AS "practicalStudents",
             s.student_count                        AS "studentCount",
             s.group_count                          AS "groupCount",
             s.is_active                            AS "isActive"
        FROM subjects s
        LEFT JOIN programmes p ON p.id = s.programme_id
        LEFT JOIN academic_year_terms t ON t.id = s.academic_year_id
        LEFT JOIN academic_years ay ON ay.id = t.academic_year_id
       ORDER BY s.subject_code
    `);
    const { rows: programmes } = await getPool().query(`
      SELECT p.programme_code AS code, p.programme_name AS name
        FROM programmes p
       WHERE p.is_active
       ORDER BY p.programme_code
    `);
    /* every coded term of every academic year (202605 · May 2026, 202609
       · September 2026, …) — the picker groups them under their year */
    const { rows: academicYears } = await getPool().query(`
      SELECT t.id,
             t.term_code || ' · ' || t.term_name AS label,
             ay.year_code                        AS "yearCode"
        FROM academic_year_terms t
        JOIN academic_years ay ON ay.id = t.academic_year_id
       ORDER BY ay.year_code, t.term_code
    `);
    /* flexible class-size limits — the course dialog derives group splits
       from these (Tutorial / Practical) */
    const { rows: classSizeRules } = await getPool().query(`
      SELECT class_type AS "classType", limit_students AS "limitStudents"
        FROM class_size_rules
       WHERE is_active
       ORDER BY class_type
    `);
    return res.json({ ok: true, courses: rows, programmes, academicYears, classSizeRules });
  } catch (err) {
    console.error("GET /api/courses failed:", err);
    return res.status(500).json({ ok: false, message: "Course directory unavailable." });
  }
});

/* ── hour validation helper — 0–24 h with at most ONE decimal (numeric(4,1)) */
const badHourComponent = (v: number) =>
  !Number.isFinite(v) || v < 0 || v > 24 || Math.abs(v * 10 - Math.round(v * 10)) > 1e-6;

/* ── POST /api/courses ────────────────────────────────────────────────────── */

router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? null) as Record<string, unknown> | null;
  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  /* course code — 2–15 uppercase alphanumerics/dashes (RS2323, BAIT1004…) */
  const code = typeof body.subjectCode === "string" ? body.subjectCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(code)) {
    return res
      .status(400)
      .json({ ok: false, message: "Course code must be 2–15 letters or digits (no spaces)." });
  }

  const name = typeof body.subjectName === "string" ? body.subjectName.trim() : "";
  if (!name) {
    return res.status(400).json({ ok: false, message: "Course name is required." });
  }

  /* programme + academic year references */
  const programmeCode =
    typeof body.programmeCode === "string" ? body.programmeCode.trim().toUpperCase() : "";
  if (!programmeCode) {
    return res.status(400).json({ ok: false, message: "Programme is required." });
  }
  const academicYearId = Number(body.academicYearId);
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    return res.status(400).json({ ok: false, message: "Academic year is required." });
  }

  /* hour components — one decimal place max, non-negative */
  const hours = {
    lecture: Number(body.lectureHours),
    tutorial: Number(body.tutorialHours),
    practical: Number(body.practicalHours),
  };
  for (const v of Object.values(hours)) {
    if (badHourComponent(v)) {
      return res.status(400).json({
        ok: false,
        message: "Lecture, tutorial and practical hours must be 0–24 with one decimal at most.",
      });
    }
  }

  /* counts */
  const studentCount = Number(body.studentCount);
  const groupCount = Number(body.groupCount);
  if (!Number.isInteger(studentCount) || studentCount < 0 || studentCount > 2000) {
    return res
      .status(400)
      .json({ ok: false, message: "Students must be a whole number between 0 and 2000." });
  }
  if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > 200) {
    return res
      .status(400)
      .json({ ok: false, message: "Groups must be a whole number between 1 and 200." });
  }

  const isActive = body.isActive !== false;
  const totalHours = Math.round((hours.lecture + hours.tutorial + hours.practical) * 10) / 10;

  /* per-class headcounts (Tutorial / Practical) — required in the dialog;
     the API keeps them optional so legacy rows may stay NULL, but a
     provided value must be a sane whole count */
  const perClass = (
    field: string,
    label: string,
  ): { ok: true; value: number | null } | { ok: false; message: string } => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 2000) {
      return {
        ok: false,
        message: `${label} must be a whole number between 0 and 2000.`,
      };
    }
    return { ok: true, value: n };
  };
  const tutorialStudents = perClass("tutorialStudents", "Tutorial students");
  if (!tutorialStudents.ok) {
    return res.status(400).json({ ok: false, message: tutorialStudents.message });
  }
  const practicalStudents = perClass("practicalStudents", "Practical students");
  if (!practicalStudents.ok) {
    return res.status(400).json({ ok: false, message: practicalStudents.message });
  }

  try {
    const progRows = await getPool().query(
      "SELECT id FROM programmes WHERE programme_code = $1 LIMIT 1",
      [programmeCode],
    );
    const prog = progRows.rows[0] as { id: number } | undefined;
    if (!prog) {
      return res.status(400).json({ ok: false, message: `Unknown programme "${programmeCode}".` });
    }
    const semRows = await getPool().query(
      "SELECT id FROM academic_year_terms WHERE id = $1 LIMIT 1",
      [academicYearId],
    );
    if (semRows.rows.length === 0) {
      return res.status(400).json({ ok: false, message: "Unknown academic year." });
    }

    const insert = await getPool().query(
      `INSERT INTO subjects
         (subject_code, subject_name, programme_id, academic_year_id,
          credit_hours, lecture_hours, tutorial_hours, practical_hours, total_hours,
          tutorial_students, practical_students, student_count, group_count, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING subject_code`,
      [
        code,
        name,
        prog.id,
        academicYearId,
        Math.round((body.creditHours === undefined ? 3 : Number(body.creditHours)) * 10) / 10,
        hours.lecture,
        hours.tutorial,
        hours.practical,
        totalHours,
        tutorialStudents.value,
        practicalStudents.value,
        studentCount,
        groupCount,
        isActive,
      ],
    );
    if (insert.rowCount === 0) {
      return res.status(500).json({ ok: false, message: "Could not create the course." });
    }
    return res.status(201).json({ ok: true, subjectCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return res
        .status(409)
        .json({ ok: false, message: "That course code is already registered." });
    }
    if ((err as { code?: string }).code === "23503") {
      return res
        .status(400)
        .json({ ok: false, message: "Unknown programme or academic year reference." });
    }
    console.error("POST /api/courses failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while adding the course." });
  }
});

/* ── PATCH /api/courses/:code ─────────────────────────────────────────────── */
/* Whitelist column map — the :code path parameter is bound and only the
   recognized fields below ever reach the SQL. Hour components clamp to the
   numeric(4,1) domain; total_hours is always recomputed. */
const COURSE_COLUMNS: Array<{
  key: string;
  column: string;
  cast: (v: unknown) => unknown;
}> = [
  { key: "subjectName", column: "subject_name", cast: (v) => (typeof v === "string" && v.trim() ? v.trim() : null) },
  {
    key: "creditHours",
    column: "credit_hours",
    cast: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 24 && Math.abs(n * 10 - Math.round(n * 10)) < 1e-6 ? n : null;
    },
  },
  ...(["lectureHours", "tutorialHours", "practicalHours"] as const).map((key) => ({
    key,
    column: key === "lectureHours" ? "lecture_hours" : key === "tutorialHours" ? "tutorial_hours" : "practical_hours",
    cast: (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 24 && Math.abs(n * 10 - Math.round(n * 10)) < 1e-6 ? n : null;
    },
  })),
  {
    key: "studentCount",
    column: "student_count",
    cast: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 2000 ? Number(v) : null),
  },
  {
    key: "tutorialStudents",
    column: "tutorial_students",
    cast: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 2000 ? Number(v) : null),
  },
  {
    key: "practicalStudents",
    column: "practical_students",
    cast: (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 2000 ? Number(v) : null),
  },
  {
    key: "groupCount",
    column: "group_count",
    cast: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 200 ? Number(v) : null),
  },
  { key: "isActive", column: "is_active", cast: (v) => (typeof v === "boolean" ? v : null) },
];

router.patch("/:code", async (req: Request, res: Response) => {
  const code = typeof req.params.code === "string" ? req.params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(code)) {
    return res.status(400).json({ ok: false, message: "Course code must be 2–15 letters or digits." });
  }

  const body = (req.body ?? null) as Record<string, unknown> | null;
  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let programmeCode: string | null = null;
  let academicYearId: number | null = null;

  for (const field of COURSE_COLUMNS) {
    if (!(field.key in body)) continue;
    const value = field.cast(body[field.key]);
    if (value === null) continue;
    params.push(value);
    sets.push(`${field.column} = $${params.length}`);
  }
  if (typeof body.programmeCode === "string" && body.programmeCode.trim()) {
    programmeCode = body.programmeCode.trim().toUpperCase();
  }
  if (Number.isInteger(Number(body.academicYearId)) && Number(body.academicYearId) > 0) {
    academicYearId = Number(body.academicYearId);
  }

  /* recompute total from the FINAL set of components when any hour changed */
  const hoursTouched = ["lectureHours", "tutorialHours", "practicalHours"].some((k) => k in body);

  if (sets.length === 0 && !programmeCode && academicYearId === null) {
    return res.status(400).json({ ok: false, message: "No editable fields supplied." });
  }

  try {
    if (programmeCode) {
      const progRows = await getPool().query("SELECT id FROM programmes WHERE programme_code = $1 LIMIT 1", [
        programmeCode,
      ]);
      const prog = progRows.rows[0] as { id: number } | undefined;
      if (!prog) {
        return res.status(400).json({ ok: false, message: `Unknown programme "${programmeCode}".` });
      }
      params.push(prog.id);
      sets.push(`programme_id = $${params.length}`);
    }
    if (academicYearId !== null) {
      params.push(academicYearId);
      sets.push(`academic_year_id = $${params.length}`);
    }

    /* pull the resulting row first so total recomputes from true values */
    params.push(code);
    const codeIdx = params.length;
    const current = await getPool().query(
      "SELECT lecture_hours AS lecture, tutorial_hours AS tutorial, practical_hours AS practical FROM subjects WHERE subject_code = $1",
      [code],
    );
    const c = current.rows[0] as { lecture: number; tutorial: number; practical: number } | undefined;
    if (!c) {
      return res.status(404).json({ ok: false, message: `No course "${code}".` });
    }
    if (hoursTouched) {
      const rel = (k: string, fallback: number) => (k in body && Number.isFinite(Number(body[k])) ? Number(body[k]) : fallback);
      const total =
        Math.round(
          ((rel("lectureHours", Number(c.lecture)) + rel("tutorialHours", Number(c.tutorial)) + rel("practicalHours", Number(c.practical))) * 10),
        ) / 10;
      params.push(total);
      sets.push(`total_hours = $${params.length}`);
    }

    const result = await getPool().query(
      `UPDATE subjects SET ${sets.join(", ")} WHERE subject_code = $${codeIdx} RETURNING subject_code`,
      params,
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: `No course "${code}".` });
    }
    return res.json({ ok: true, subjectCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return res.status(400).json({ ok: false, message: "Unknown programme or academic year reference." });
    }
    console.error("PATCH /api/courses/:code failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while saving the course." });
  }
});

/* ── DELETE /api/courses/:code ────────────────────────────────────────────── */
/* workload_details.subject_id is NO ACTION — refuse while any allocated
   workload detail still references the course. */
router.delete("/:code", async (req: Request, res: Response) => {
  const code = typeof req.params.code === "string" ? req.params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(code)) {
    return res.status(400).json({ ok: false, message: "Course code must be 2–15 letters or digits." });
  }
  try {
    const linked = await getPool().query(
      "SELECT COUNT(*)::int AS refs FROM workload_details WHERE subject_id = (SELECT id FROM subjects WHERE subject_code = $1)",
      [code],
    );
    const refs = Number(linked.rows[0]?.refs ?? 0);
    if (refs > 0) {
      return res.status(409).json({
        ok: false,
        message: `Course ${code} is used in ${refs} workload detail row(s) — remove those assignments first.`,
      });
    }

    const result = await getPool().query(
      "DELETE FROM subjects WHERE subject_code = $1 RETURNING subject_code",
      [code],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: `No course "${code}".` });
    }
    return res.json({ ok: true, subjectCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return res.status(409).json({
        ok: false,
        message: `Course ${code} is still referenced by assignment records — it cannot be deleted.`,
      });
    }
    console.error("DELETE /api/courses/:code failed:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Database error while deleting the course." });
  }
});

export default router;
