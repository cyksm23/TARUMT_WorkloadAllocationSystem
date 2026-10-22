import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Same-origin fallback twin of backend-express routes/courses.ts
 * (PATCH + DELETE /api/courses/:code). Course codes are immutable;
 * total_hours is recomputed from the final set of hour components after
 * every partial update. Deletion is refused while workload details
 * reference the course (workload_details.subject_id is NO ACTION).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function PATCH(request: Request, { params }: { params: { code: string } }) {
  const code = typeof params.code === "string" ? params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(code)) {
    return NextResponse.json(
      { ok: false, message: "Course code must be 2–15 letters or digits." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const sets: string[] = [];
  const params_: unknown[] = [];
  let programmeCode: string | null = null;
  let semesterId: number | null = null;

  for (const field of COURSE_COLUMNS) {
    if (!(field.key in body)) continue;
    const value = field.cast(body[field.key]);
    if (value === null) continue;
    params_.push(value);
    sets.push(`${field.column} = $${params_.length}`);
  }
  if (typeof body.programmeCode === "string" && body.programmeCode.trim()) {
    programmeCode = body.programmeCode.trim().toUpperCase();
  }
  if (Number.isInteger(Number(body.semesterId)) && Number(body.semesterId) > 0) {
    semesterId = Number(body.semesterId);
  }

  /* recompute total from the FINAL set of components when any hour changed */
  const hoursTouched = ["lectureHours", "tutorialHours", "practicalHours"].some((k) => k in body);

  if (sets.length === 0 && !programmeCode && semesterId === null) {
    return NextResponse.json({ ok: false, message: "No editable fields supplied." }, { status: 400 });
  }

  try {
    if (programmeCode) {
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
      params_.push(prog.id);
      sets.push(`programme_id = $${params_.length}`);
    }
    if (semesterId !== null) {
      params_.push(semesterId);
      sets.push(`semester_id = $${params_.length}`);
    }

    /* pull the resulting row first so total recomputes from true values */
    params_.push(code);
    const codeIdx = params_.length;
    const current = await getPool().query(
      "SELECT lecture_hours AS lecture, tutorial_hours AS tutorial, practical_hours AS practical FROM subjects WHERE subject_code = $1",
      [code],
    );
    const c = current.rows[0] as { lecture: number; tutorial: number; practical: number } | undefined;
    if (!c) {
      return NextResponse.json({ ok: false, message: `No course "${code}".` }, { status: 404 });
    }
    if (hoursTouched) {
      const rel = (k: string, fallback: number) =>
        k in body && Number.isFinite(Number(body[k])) ? Number(body[k]) : fallback;
      const total =
        Math.round(
          (rel("lectureHours", Number(c.lecture)) +
            rel("tutorialHours", Number(c.tutorial)) +
            rel("practicalHours", Number(c.practical))) *
            10,
        ) / 10;
      params_.push(total);
      sets.push(`total_hours = $${params_.length}`);
    }

    const result = await getPool().query(
      `UPDATE subjects SET ${sets.join(", ")} WHERE subject_code = $${codeIdx} RETURNING subject_code`,
      params_,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, message: `No course "${code}".` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, subjectCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return NextResponse.json(
        { ok: false, message: "Unknown programme or semester reference." },
        { status: 400 },
      );
    }
    console.error("PATCH /api/courses/:code failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while saving the course." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { code: string } }) {
  const code = typeof params.code === "string" ? params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,14}$/.test(code)) {
    return NextResponse.json(
      { ok: false, message: "Course code must be 2–15 letters or digits." },
      { status: 400 },
    );
  }
  try {
    const linked = await getPool().query(
      "SELECT COUNT(*)::int AS refs FROM workload_details WHERE subject_id = (SELECT id FROM subjects WHERE subject_code = $1)",
      [code],
    );
    const refs = Number(linked.rows[0]?.refs ?? 0);
    if (refs > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: `Course ${code} is used in ${refs} workload detail row(s) — remove those assignments first.`,
        },
        { status: 409 },
      );
    }

    const result = await getPool().query(
      "DELETE FROM subjects WHERE subject_code = $1 RETURNING subject_code",
      [code],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, message: `No course "${code}".` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, subjectCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return NextResponse.json(
        {
          ok: false,
          message: `Course ${code} is still referenced by assignment records — it cannot be deleted.`,
        },
        { status: 409 },
      );
    }
    console.error("DELETE /api/courses/:code failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while deleting the course." },
      { status: 500 },
    );
  }
}
