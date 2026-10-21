import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * GET /api/lecturers — Programme Leader staff directory (UC_CPM_01).
 *
 * Full roster straight from PostgreSQL: lecturers joined with their
 * department and linked login account, plus a per-lecturer semester
 * workload roll-up. Hour limits are NOT stored per lecturer — they resolve
 * from workload_rules by role and the programme levels actually taught
 * (PL role rule wins; else Bachelor-only / Diploma-only / both / default),
 * and the full editable rules table is embedded for the page's rules editor.
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

export async function GET() {
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

    return NextResponse.json({
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
    return NextResponse.json(
      { ok: false, message: "Lecturer directory unavailable." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/lecturers — create a new staff record (fallback twin of the
 * Express backend's POST). "Add Staff" form payload: staff id, identity,
 * contact, position/classification, department code and the seeded
 * snapshot limit pair (prefilled from the DEFAULT rule in the dialog).
 */
const EMPLOYMENT_POST = new Set(["FULL_TIME", "PART_TIME", "CONTRACT"]);
const badHoursPost = (v: number) =>
  !Number.isFinite(v) ||
  v < 0.5 ||
  v > 45 ||
  Math.abs(v * 100 - Math.round(v * 100)) > 1e-6;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  /* staff id — 4 digits, like every existing code */
  const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
  if (!/^\d{4}$/.test(staffId)) {
    return NextResponse.json(
      { ok: false, message: "Staff ID must be exactly 4 digits." },
      { status: 400 }
    );
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName) {
    return NextResponse.json({ ok: false, message: "Full name is required." }, { status: 400 });
  }

  const employmentType =
    typeof body.employmentType === "string" && EMPLOYMENT_POST.has(body.employmentType)
      ? body.employmentType
      : null;
  if (!employmentType) {
    return NextResponse.json(
      { ok: false, message: "Classification must be full-time, part-time or contract." },
      { status: 400 }
    );
  }

  const optionalText = (field: string): string | null =>
    typeof body[field] === "string" && (body[field] as string).trim()
      ? (body[field] as string).trim()
      : null;

  const email = optionalText("email");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ ok: false, message: "Enter a valid email address." }, { status: 400 });
  }
  const phone = optionalText("phone");
  const position = optionalText("position");

  const isPl = body.isPl === true;
  const isActive = body.isActive !== false;

  const departmentCode =
    typeof body.departmentCode === "string" && body.departmentCode.trim()
      ? body.departmentCode.trim().toUpperCase()
      : "DCIT";

  /* stored limit pair — required at creation (satisfies NOT NULL + CHECK) */
  const minRaw = Number(body.minHours);
  const maxRaw = Number(body.maxHours);
  if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw)) {
    return NextResponse.json(
      { ok: false, message: "Provide the min and max hour limits." },
      { status: 400 }
    );
  }
  if (badHoursPost(minRaw) || badHoursPost(maxRaw) || minRaw > maxRaw) {
    return NextResponse.json(
      {
        ok: false,
        message: "Hour limits must be between 0.5 and 45 h/wk, min ≤ max, two decimals max.",
      },
      { status: 400 }
    );
  }
  const cleanMin = Math.round(minRaw * 100) / 100;
  const cleanMax = Math.round(maxRaw * 100) / 100;

  try {
    const depRows = await getPool().query(
      "SELECT id, department_name FROM departments WHERE department_code = $1 LIMIT 1",
      [departmentCode]
    );
    const dep = depRows.rows[0] as { id: number; department_name: string } | undefined;
    if (!dep) {
      return NextResponse.json(
        { ok: false, message: `Unknown department "${departmentCode}".` },
        { status: 400 }
      );
    }

    /* the rules ceiling applies to the seeded pair as well */
    const { rows: ceilingRows } = await getPool().query(
      "SELECT COALESCE(MAX(max_hours), 45)::float8 AS ceiling FROM workload_rules"
    );
    const ceiling = Number(ceilingRows[0]?.ceiling ?? 45);
    if (cleanMin > ceiling || cleanMax > ceiling) {
      return NextResponse.json(
        {
          ok: false,
          message: `Cannot add — ${cleanMax > ceiling ? cleanMax : cleanMin}h exceeds the ${ceiling}h maximum set in the Hour-limit rules.`,
        },
        { status: 400 }
      );
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
      return NextResponse.json(
        { ok: false, message: "Could not create the lecturer." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, staffId }, { status: 201 });
  } catch (err) {
    /* unique_violation (23505) — staff id or email already taken */
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, message: "That staff ID or email is already registered." },
        { status: 409 }
      );
    }
    console.error("POST /api/lecturers failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while adding the lecturer." },
      { status: 500 }
    );
  }
}
