import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Same-origin fallback twin of backend-express routes/allocations.ts
 * (GET + POST /api/allocations). Slots live in workload_details (one row
 * per LECTURE/TUTORIAL/PRACTICAL under the slot lecturer's workloads
 * header for the subject's semester); hour totals are resummed after
 * every write. Policy: 3 distinct Bachelor courses / 4 Diploma courses
 * per lecturer — checked on the post-state counts inside the transaction.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* slot keys (validated) in canonical order */
const SLOT_KEYS = ["LECTURE", "TUTORIAL", "PRACTICAL"] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

/* per-level distinct-course caps (Master / Foundation: uncapped) */
const LEVEL_CAPS: Record<string, number> = {
  Bachelor: 3,
  Diploma: 4,
};

/* slot hour / headcount sources on the subjects row */
/* slot hour / headcount sources — keys into the loadSubject row
   (aliased camelCase, NOT the raw snake_case column names) */
const SLOT_HOURS: Record<SlotKey, string> = {
  LECTURE: "lectureHours",
  TUTORIAL: "tutorialHours",
  PRACTICAL: "practicalHours",
};
const SLOT_STUDENTS: Record<SlotKey, string> = {
  LECTURE: "studentCount",
  TUTORIAL: "tutorialStudents",
  PRACTICAL: "practicalStudents",
};

/* normalise the JSON slots payload → { key: lecturerId } or null on error */
const readSlots = (raw: unknown): Record<SlotKey, number> | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const out: Partial<Record<SlotKey, number>> = {};
  for (const key of SLOT_KEYS) {
    const v = Number(obj[key]);
    if (!Number.isInteger(v) || v <= 0 || v > 2147483647) return null;
    out[key] = v;
  }
  return out as Record<SlotKey, number>;
};

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

/* subject + programme context (NULL when the code is unknown) */
interface SubjectRow {
  subjectId: number;
  subjectCode: string;
  subjectName: string;
  semesterId: number | null;
  lectureHours: string | number;
  tutorialHours: string | number;
  practicalHours: string | number;
  tutorialStudents: number | null;
  practicalStudents: number | null;
  studentCount: number | null;
  level: string | null;
}

/* fetch the subject's assignment context */
const loadSubject = async (
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  code: string,
) => {
  const { rows } = await client.query(
    `
    SELECT s.id                AS "subjectId",
           s.subject_code      AS "subjectCode",
           s.subject_name      AS "subjectName",
           s.semester_id       AS "semesterId",
           s.lecture_hours     AS "lectureHours",
           s.tutorial_hours    AS "tutorialHours",
           s.practical_hours   AS "practicalHours",
           s.tutorial_students AS "tutorialStudents",
           s.practical_students AS "practicalStudents",
           s.student_count     AS "studentCount",
           p.level             AS "level"
      FROM subjects s
      LEFT JOIN programmes p ON p.id = s.programme_id
     WHERE s.subject_code = $1
    `,
    [code],
  );
  return (rows[0] ?? null) as SubjectRow | null;
};

/* validate every slot lecturer (exists + active) → lecturer map by id */
const loadLecturers = async (
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  ids: number[],
): Promise<{ ok: true; nameOf: Record<number, string> } | { ok: false; message: string }> => {
  const { rows } = await client.query(
    `
    SELECT id, full_name, staff_id, is_active
      FROM lecturers
     WHERE id = ANY($1::int[])
    `,
    [ids],
  );
  const byId: Record<number, { fullName: string; staffId: string; isActive: boolean }> = {};
  rows.forEach((r: { id: number; full_name: string; staff_id: string; is_active: boolean }) => {
    byId[r.id] = { fullName: r.full_name, staffId: r.staff_id, isActive: r.is_active };
  });
  for (const id of ids) {
    const l = byId[id];
    if (!l) {
      return { ok: false, message: `Lecturer #${id} does not exist in the directory.` };
    }
    if (!l.isActive) {
      return {
        ok: false,
        message: `${l.fullName} (${l.staffId}) is deactivated — only active lecturers can be assigned.`,
      };
    }
  }
  return {
    ok: true,
    nameOf: Object.fromEntries(
      Object.entries(byId).map(([id, l]) => [id, `${l.fullName} (${l.staffId})`]),
    ),
  };
};

/* post-state distinct-course counts per (lecturer, programme level) */
const loadCourseCounts = async (
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  excludeSubjectId: number,
): Promise<Record<string, number>> => {
  const { rows } = await client.query(
    `
    SELECT w.lecturer_id            AS "lecturerId",
           p.level                  AS "level",
           COUNT(DISTINCT s.id)     AS courses
      FROM workload_details wd
      JOIN workloads w     ON w.id = wd.workload_id
      JOIN subjects s      ON s.id = wd.subject_id
      LEFT JOIN programmes p ON p.id = s.programme_id
     WHERE wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
       AND wd.group_name IS NULL
       AND s.id <> $1
     GROUP BY w.lecturer_id, p.level
    `,
    [excludeSubjectId],
  );
  const map: Record<string, number> = {};
  rows.forEach(
    (r: { lecturerId: number; level: string | null; courses: string | number }) => {
      map[`${r.lecturerId}|${r.level ?? "—"}`] = Number(r.courses);
    },
  );
  return map;
};

/* validate the caps on the post-state counts */
const checkCaps = (
  lecturersSet: number[],
  nameOf: Record<number, string>,
  level: string | null,
  counts: Record<string, number>,
): string | null => {
  const cap = level ? (LEVEL_CAPS[level] ?? null) : null;
  if (!cap) return null;
  for (const lid of lecturersSet) {
    const held = counts[`${lid}|${level}`] ?? 0;
    if (held + 1 > cap) {
      return `${nameOf[lid] ?? `Lecturer #${lid}`} would hold ${held + 1} ${level} courses — policy allows at most ${cap} per lecturer in ${level} programmes.`;
    }
  }
  return null;
};

/* resum every workload header's total_allocated_hours and drop emptied
   headers (runs inside the caller's transaction) */
const refreshWorkloadTotals = async (client: {
  query: (sql: string) => Promise<unknown>;
}) => {
  await client.query(`
    UPDATE workloads w
       SET total_allocated_hours = COALESCE(
             (SELECT SUM(hd.hours_per_week)
                FROM workload_details hd
               WHERE hd.workload_id = w.id), 0),
           updated_at = NOW()
  `);
  await client.query(`
    DELETE FROM workloads w
     WHERE NOT EXISTS (
       SELECT 1 FROM workload_details hd WHERE hd.workload_id = w.id)
  `);
};

/* ── GET — every whole-course slot row currently stored ──────────────────── */

export async function GET() {
  try {
    const { rows } = await getPool().query(`
      SELECT s.subject_code           AS "subjectCode",
             s.id                     AS "subjectId",
             w.lecturer_id            AS "lecturerId",
             wd.activity_type         AS "activityType",
             wd.student_count         AS "studentCount",
             wd.hours_per_week        AS "hoursPerWeek",
             wd.total_hours           AS "totalHours"
        FROM workload_details wd
        JOIN workloads w  ON w.id = wd.workload_id
        JOIN subjects s   ON s.id = wd.subject_id
       WHERE wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
         AND wd.group_name IS NULL
       ORDER BY s.subject_code, wd.activity_type
    `);
    return NextResponse.json({ ok: true, allocations: rows });
  } catch (err) {
    console.error("GET /api/allocations failed:", err);
    return NextResponse.json(
      { ok: false, message: "Assignment list unavailable." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: { subjectCode?: unknown; slots?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const subjectCode = typeof body.subjectCode === "string" ? body.subjectCode.trim() : "";
  const slots = readSlots(body.slots);
  if (!subjectCode || !slots) {
    return NextResponse.json(
      {
        ok: false,
        message: "The request must carry subjectCode and the LECTURE/TUTORIAL/PRACTICAL slots.",
      },
      { status: 400 },
    );
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const subject = await loadSubject(client, subjectCode);
    if (!subject) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, message: "Unknown course." }, { status: 404 });
    }
    if (subject.semesterId === null) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, message: "This course has no semester — edit the course first." },
        { status: 409 },
      );
    }
    const { rows: semRows } = await client.query(
      `SELECT week_count FROM semesters WHERE id = $1`,
      [subject.semesterId],
    );
    if (semRows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, message: "The course's semester no longer exists." },
        { status: 409 },
      );
    }
    const weekCount = Number(semRows[0].week_count) || 14;

    const lecturersSet = Array.from(new Set(SLOT_KEYS.map((k) => slots[k])));
    const lect = await loadLecturers(client, lecturersSet);
    if (!lect.ok) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, message: lect.message }, { status: 409 });
    }

    /* POST only: refuse when the course already holds slot rows */
    const existing = await client.query(
      `
      SELECT 1 FROM workload_details
       WHERE subject_id = $1
         AND activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
         AND group_name IS NULL
       LIMIT 1
      `,
      [subject.subjectId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          ok: false,
          message: "This course is already assigned — edit the existing assignment instead.",
        },
        { status: 409 },
      );
    }

    const counts = await loadCourseCounts(client, subject.subjectId);
    const capError = checkCaps(lecturersSet, lect.nameOf, subject.level, counts);
    if (capError) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, message: capError }, { status: 409 });
    }

    await client.query(
      `
      DELETE FROM workload_details
       WHERE subject_id = $1
         AND activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
         AND group_name IS NULL
      `,
      [subject.subjectId],
    );
    for (const key of SLOT_KEYS) {
      const lecturerId = slots[key];
      const { rows: headerRows } = await client.query(
        `
        INSERT INTO workloads (lecturer_id, semester_id)
        VALUES ($1, $2)
        ON CONFLICT (lecturer_id, semester_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id
        `,
        [lecturerId, subject.semesterId],
      );
      const workloadId: number = headerRows[0].id;
      const hours = Number(subject[SLOT_HOURS[key] as keyof SubjectRow] ?? 0);
      const studentsRaw = subject[SLOT_STUDENTS[key] as keyof SubjectRow];
      const students =
        studentsRaw === null || studentsRaw === undefined ? 0 : Number(studentsRaw);
      await client.query(
        `
        INSERT INTO workload_details
               (workload_id, subject_id, activity_type, group_name,
                student_count, hours_per_week, total_hours)
        VALUES ($1, $2, $3, NULL, $4, $5, $6)
        `,
        [workloadId, subject.subjectId, key, students, hours, hours * weekCount],
      );
    }

    await refreshWorkloadTotals(client);
    await client.query("COMMIT");
    return NextResponse.json(
      {
        ok: true,
        message: `Assignment saved for ${subject.subjectCode} (${subject.subjectName.trim()}).`,
      },
      { status: 201 },
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already gone */
    }
    console.error("POST /api/allocations failed:", err);
    return NextResponse.json(
      { ok: false, message: "The assignment could not be saved." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
