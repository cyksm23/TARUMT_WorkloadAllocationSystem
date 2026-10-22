import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * GET   /api/class-size-rules — the flexible class-size limits for
 *                              TUTORIAL / PRACTICAL classes. A class whose
 *                              headcount exceeds its limit splits into
 *                              groups (the course dialog derives the group
 *                              count from these rules).
 * PATCH /api/class-size-rules — the Programme Leader edits the limits at
 *                              any time; the upsert keeps both rule rows
 *                              complete even without seed data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/* limit sanity: 1–200 students per class (500 hard cap in the DB CHECK) */
const badLimit = (n: number) => !Number.isInteger(n) || n < 1 || n > 200;

export async function GET() {
  try {
    const { rows } = await getPool().query(`
      SELECT class_type     AS "classType",
             limit_students AS "limitStudents"
        FROM class_size_rules
       WHERE is_active
       ORDER BY class_type
    `);
    return NextResponse.json({ ok: true, rules: rows });
  } catch (err) {
    console.error("GET /api/class-size-rules failed", err);
    return NextResponse.json(
      { ok: false, message: "Class-size rules unavailable." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { tutorialLimit?: unknown; practicalLimit?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const wanted: Array<["TUTORIAL" | "PRACTICAL", number]> = [];
  if (body.tutorialLimit !== undefined) {
    const n = Number(body.tutorialLimit);
    if (badLimit(n)) {
      return NextResponse.json(
        { ok: false, message: "Tutorial class limit must be a whole number between 1 and 200." },
        { status: 400 }
      );
    }
    wanted.push(["TUTORIAL", n]);
  }
  if (body.practicalLimit !== undefined) {
    const n = Number(body.practicalLimit);
    if (badLimit(n)) {
      return NextResponse.json(
        { ok: false, message: "Practical class limit must be a whole number between 1 and 200." },
        { status: 400 }
      );
    }
    wanted.push(["PRACTICAL", n]);
  }

  if (wanted.length === 0) {
    return NextResponse.json({ ok: false, message: "No class-size limits supplied." }, { status: 400 });
  }

  try {
    for (const [classType, limit] of wanted) {
      await getPool().query(
        `INSERT INTO class_size_rules (class_type, limit_students)
         VALUES ($1, $2)
         ON CONFLICT (class_type)
         DO UPDATE SET limit_students = $2, updated_at = NOW()`,
        [classType, limit]
      );
    }

    const { rows } = await getPool().query(`
      SELECT class_type     AS "classType",
             limit_students AS "limitStudents"
        FROM class_size_rules
       WHERE is_active
       ORDER BY class_type
    `);
    return NextResponse.json({ ok: true, rules: rows });
  } catch (err) {
    console.error("PATCH /api/class-size-rules failed", err);
    return NextResponse.json(
      { ok: false, message: "Database error while saving the class-size rules." },
      { status: 500 }
    );
  }
}
