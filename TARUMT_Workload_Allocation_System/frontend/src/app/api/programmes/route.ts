import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Same-origin fallback twin of backend-express routes/programmes.ts
 * (GET /api/programmes + POST /api/programmes). Kept 1:1 so the UI keeps
 * working even when the standalone API is offline.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** accepted programme levels — mirrors the seed data's level vocabulary */
const LEVELS = new Set(["Bachelor", "Master", "Diploma", "Foundation"]);

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
    return NextResponse.json({ ok: true, programmes: rows, departments: deps });
  } catch (err) {
    console.error("GET /api/programmes failed:", err);
    return NextResponse.json(
      { ok: false, message: "Programme directory unavailable." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  /* programme code — 2–10 uppercase alphanumerics/dashes (DSF, RSD, MFT…) */
  const code = typeof body.programmeCode === "string" ? body.programmeCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code)) {
    return NextResponse.json(
      { ok: false, message: "Programme code must be 2–10 letters or digits (no spaces)." },
      { status: 400 },
    );
  }

  const name = typeof body.programmeName === "string" ? body.programmeName.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, message: "Programme name is required." }, { status: 400 });
  }

  /* department — defaults to the Programme Leader's DCIT scope */
  const departmentCode =
    typeof body.departmentCode === "string" && body.departmentCode.trim()
      ? body.departmentCode.trim().toUpperCase()
      : "DCIT";

  const level = typeof body.level === "string" && LEVELS.has(body.level) ? body.level : null;

  /* duration — 1–8 whole years, default 3 (the national diploma length) */
  let durationYears: number;
  if (body.durationYears !== undefined && body.durationYears !== null && body.durationYears !== "") {
    const d = Number(body.durationYears);
    if (!Number.isInteger(d) || d < 1 || d > 8) {
      return NextResponse.json(
        { ok: false, message: "Duration must be a whole number of years between 1 and 8." },
        { status: 400 },
      );
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
      return NextResponse.json(
        { ok: false, message: `Unknown department "${departmentCode}".` },
        { status: 400 },
      );
    }

    const insert = await getPool().query(
      `INSERT INTO programmes (programme_code, programme_name, department_id, level, duration_years, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING programme_code`,
      [code, name, dep.id, level, durationYears, isActive],
    );
    if (insert.rowCount === 0) {
      return NextResponse.json({ ok: false, message: "Could not create the programme." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, programmeCode: code }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, message: "That programme code is already registered." },
        { status: 409 },
      );
    }
    console.error("POST /api/programmes failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while adding the programme." },
      { status: 500 },
    );
  }
}
