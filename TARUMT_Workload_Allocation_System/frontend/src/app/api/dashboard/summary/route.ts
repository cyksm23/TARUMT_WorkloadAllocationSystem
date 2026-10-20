import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * GET /api/dashboard/summary — Programme Leader dashboard counters.
 * Real-time numbers straight from PostgreSQL (read-only, single round-trip).
 * Hour-limit rule seeded from institutional policy (docx §3.4.1):
 *   Programme Leader ≤ 12h · full-time non-PL ≤ 16h · part-time ≤ 8h.
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
      SELECT
        (SELECT COUNT(*) FROM lecturers)                                        AS lecturers_total,
        (SELECT COUNT(*) FROM lecturers WHERE employment_type = 'PART_TIME')    AS lecturers_part_time,
        (SELECT COUNT(*) FROM lecturers WHERE is_pl)                            AS programme_leaders,
        (SELECT COUNT(*) FROM academic_years)                                   AS years_total,
        (SELECT COUNT(*) FROM subjects WHERE is_active)                         AS subjects_total,
        (SELECT COUNT(*) FROM programmes)                                       AS programmes_total,
        (SELECT COUNT(*) FROM workloads)                                        AS workloads_total,
        (SELECT COUNT(*) FROM workloads WHERE status = 'APPROVED')              AS workloads_approved,
        (SELECT COUNT(*) FROM workloads WHERE status = 'PENDING')               AS workloads_pending,
        (SELECT COUNT(*)
           FROM workloads w
           JOIN lecturers l ON l.id = w.lecturer_id
          WHERE w.total_allocated_hours >
                (CASE
                   WHEN l.is_pl                          THEN 12  -- PL limit
                   WHEN l.employment_type = 'PART_TIME'  THEN 8   -- part-time limit
                   ELSE 16                                        -- full-time limit
                 END)
        )                                                                        AS over_limit
    `);

    const r = rows[0] ?? {};
    const n = (v: unknown): number => Number(v ?? 0);

    return NextResponse.json({
      ok: true,
      lecturers: {
        total: n(r.lecturers_total),
        partTime: n(r.lecturers_part_time),
        fullTime: n(r.lecturers_total) - n(r.lecturers_part_time),
        programmeLeaders: n(r.programme_leaders),
      },
      courses: {
        academicYears: n(r.years_total),
        programs: n(r.programmes_total),
        activeSubjects: n(r.subjects_total),
        semesters: n(r.semesters_total),
      },
      allocations: {
        total: n(r.workloads_total),
        approved: n(r.workloads_approved),
        pending: n(r.workloads_pending),
        overLimit: n(r.over_limit),
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Dashboard data is unavailable (database offline)." },
      { status: 503 },
    );
  }
}
