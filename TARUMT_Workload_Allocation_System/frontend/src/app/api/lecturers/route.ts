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
