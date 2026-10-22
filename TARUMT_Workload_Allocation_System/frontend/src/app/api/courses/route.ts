import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Same-origin fallback twin of backend-express routes/courses.ts
 * (GET /api/courses + POST /api/courses). Kept 1:1 so the UI keeps working
 * even when the standalone API is offline. Hour components are NUMERIC(4,1)
 * — at most one decimal place; total_hours is recomputed as lecture +
 * tutorial + practical on every write.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ── hour validation helper — 0–24 h with at most ONE decimal (numeric(4,1)) */
const badHourComponent = (v: number) =>
  !Number.isFinite(v) || v < 0 || v > 24 || Math.abs(v * 10 - Math.round(v * 10)) > 1e-6;

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

export async function GET() {
  try {
    const { rows } = await getPool().query(`
      SELECT s.subject_code                         AS "subjectCode",
             s.subject_name                         AS "subjectName",
             p.programme_code                       AS "programmeCode",
             COALESCE(p.programme_name, '—')        AS "programmeName",
             s.semester_id                          AS "semesterId",
             COALESCE(sy.semester_code || ' · ' || sy.semester_name
               || ' · ' || sy.week_count || ' weeks', '—')
                                                    AS "semesterLabel",
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
        LEFT JOIN semesters sy ON sy.id = s.semester_id
       ORDER BY s.subject_code
    `);
    const { rows: programmes } = await getPool().query(`
      SELECT p.programme_code AS code, p.programme_name AS name
        FROM programmes p
       WHERE p.is_active
       ORDER BY p.programme_code
    `);
    /* one canonical row per semester code (the three TARUMT semesters
       S1 / S2 / S3 exist once per academic year — dedupe to the earliest
       year's row so the picker shows exactly 3 options); labels mention
       the week count (S1 14 wks · S2 7 wks · S3 14 wks) */
    const { rows: semesters } = await getPool().query(`
      SELECT DISTINCT ON (semester_code)
             id,
             semester_code || ' · ' || semester_name
               || ' · ' || week_count || ' weeks' AS label
        FROM semesters
       ORDER BY semester_code, id
    `);
    /* flexible class-size limits — the course dialog derives group splits
       from these (Tutorial / Practical) */
    const { rows: classSizeRules } = await getPool().query(`
      SELECT class_type AS "classType", limit_students AS "limitStudents"
        FROM class_size_rules
       WHERE is_active
       ORDER BY class_type
    `);
    return NextResponse.json({ ok: true, courses: rows, programmes, semesters, classSizeRules });
  } catch (err) {
    console.error("GET /api/courses failed:", err);
    return NextResponse.json(
      { ok: false, message: "Course directory unavailable." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  /* course code — 2–15 uppercase alphanumerics/dashes (RS2323, BAIT1004…) */
  const code = typeof body.subjectCode === "string" ? body.subjectCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(code)) {
    return NextResponse.json(
      { ok: false, message: "Course code must be 2–15 letters or digits (no spaces)." },
      { status: 400 },
    );
  }

  const name = typeof body.subjectName === "string" ? body.subjectName.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, message: "Course name is required." }, { status: 400 });
  }

  /* programme + semester references */
  const programmeCode =
    typeof body.programmeCode === "string" ? body.programmeCode.trim().toUpperCase() : "";
  if (!programmeCode) {
    return NextResponse.json({ ok: false, message: "Programme is required." }, { status: 400 });
  }
  const semesterId = Number(body.semesterId);
  if (!Number.isInteger(semesterId) || semesterId <= 0) {
    return NextResponse.json({ ok: false, message: "Semester is required." }, { status: 400 });
  }

  /* hour components — one decimal place max, non-negative */
  const hours = {
    lecture: Number(body.lectureHours),
    tutorial: Number(body.tutorialHours),
    practical: Number(body.practicalHours),
  };
  for (const v of Object.values(hours)) {
    if (badHourComponent(v)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Lecture, tutorial and practical hours must be 0–24 with one decimal at most.",
        },
        { status: 400 },
      );
    }
  }

  /* counts */
  const studentCount = Number(body.studentCount);
  const groupCount = Number(body.groupCount);
  if (!Number.isInteger(studentCount) || studentCount < 0 || studentCount > 2000) {
    return NextResponse.json(
      { ok: false, message: "Students must be a whole number between 0 and 2000." },
      { status: 400 },
    );
  }
  if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > 200) {
    return NextResponse.json(
      { ok: false, message: "Groups must be a whole number between 1 and 200." },
      { status: 400 },
    );
  }

  const isActive = body.isActive !== false;
  const totalHours = Math.round((hours.lecture + hours.tutorial + hours.practical) * 10) / 10;

  /* per-class headcounts (Tutorial / Practical) — required in the dialog;
     the API keeps them optional so legacy rows may stay NULL, but a
     provided value must be a sane whole count */
  const perClass = (field: string, label: string) => {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") return { ok: true as const, value: null };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 2000) {
      return { ok: false as const, message: `${label} must be a whole number between 0 and 2000.` };
    }
    return { ok: true as const, value: n };
  };
  const tutorialStudents = perClass("tutorialStudents", "Tutorial students");
  if (!tutorialStudents.ok) {
    return NextResponse.json({ ok: false, message: tutorialStudents.message }, { status: 400 });
  }
  const practicalStudents = perClass("practicalStudents", "Practical students");
  if (!practicalStudents.ok) {
    return NextResponse.json({ ok: false, message: practicalStudents.message }, { status: 400 });
  }

  try {
    const progRows = await getPool().query(
      "SELECT id FROM programmes WHERE programme_code = $1 LIMIT 1",
      [programmeCode],
    );
    const prog = progRows.rows[0] as { id: number } | undefined;
    if (!prog) {
      return NextResponse.json(
        { ok: false, message: `Unknown programme "${programmeCode}".` },
        { status: 400 },
      );
    }
    const semRows = await getPool().query("SELECT id FROM semesters WHERE id = $1 LIMIT 1", [
      semesterId,
    ]);
    if (semRows.rows.length === 0) {
      return NextResponse.json({ ok: false, message: "Unknown semester." }, { status: 400 });
    }

    const insert = await getPool().query(
      `INSERT INTO subjects
         (subject_code, subject_name, programme_id, semester_id,
          credit_hours, lecture_hours, tutorial_hours, practical_hours, total_hours,
          tutorial_students, practical_students, student_count, group_count, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING subject_code`,
      [
        code,
        name,
        prog.id,
        semesterId,
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
      return NextResponse.json({ ok: false, message: "Could not create the course." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, subjectCode: code }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, message: "That course code is already registered." },
        { status: 409 },
      );
    }
    if ((err as { code?: string }).code === "23503") {
      return NextResponse.json(
        { ok: false, message: "Unknown programme or semester reference." },
        { status: 400 },
      );
    }
    console.error("POST /api/courses failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while adding the course." },
      { status: 500 },
    );
  }
}
