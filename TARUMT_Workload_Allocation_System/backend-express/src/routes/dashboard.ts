/**
 * GET /api/dashboard/summary — Programme Leader dashboard counters.
 *
 * Ported 1:1 from frontend/src/app/api/dashboard/summary/route.ts.
 * Real-time numbers straight from PostgreSQL (read-only, single trip).
 * Hour-limit policy lives in editable workload_rules by role / programme
 * levels taught (PL role rule wins, else Bachelor-only / both / Diploma-only
 * / default). Each lecturer carries a materialized limit pair that is seeded
 * once and then snapshot-stable — rules edits never rewrite it; pairs that
 * drifted from (or climb above) the current rules count as limit alerts.
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

router.get("/summary", async (_req: Request, res: Response) => {
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
        (SELECT COUNT(*) FROM lecturers)                                     AS lecturers_total,
        (SELECT COUNT(*) FROM lecturers WHERE employment_type = 'PART_TIME') AS lecturers_part_time,
        (SELECT COUNT(*) FROM lecturers WHERE is_pl)                         AS programme_leaders,
        (SELECT COUNT(*) FROM academic_years)                                AS years_total,
        (SELECT COUNT(*) FROM academic_year_terms)                           AS academic_year_terms_total,
        (SELECT COUNT(*) FROM subjects WHERE is_active)                      AS subjects_total,
        (SELECT COUNT(*) FROM programmes)                                    AS programmes_total,
        (SELECT COUNT(*) FROM workloads)                                     AS workloads_total,
        (SELECT COUNT(*) FROM workloads WHERE status = 'APPROVED')           AS workloads_approved,
        (SELECT COUNT(*) FROM workloads WHERE status = 'PENDING')            AS workloads_pending,
        (SELECT COUNT(*)
           FROM workloads w
           JOIN lecturers l ON l.id = w.lecturer_id
          WHERE w.total_allocated_hours > l.max_limit_hours)                 AS over_limit,
        /* red warning rows: the stored limit pair falls outside the
           lecturer's current rule allowed range (this also covers pairs
           above the rules ceiling, which rules edits never clamp) */
        (SELECT COUNT(*)
           FROM lecturers l
           JOIN rw ON rw.lecturer_id = l.id
           JOIN workload_rules r ON r.rule_key = rw.rule_key
          WHERE l.min_limit_hours < r.min_hours
             OR l.min_limit_hours > r.max_hours
             OR l.max_limit_hours < r.min_hours
             OR l.max_limit_hours > r.max_hours)                           AS lecturers_limit_alerts
    `);

    const r = rows[0] ?? {};
    const n = (v: unknown): number => Number(v ?? 0);

    return res.status(200).json({
      ok: true,
      lecturers: {
        total: n(r.lecturers_total),
        partTime: n(r.lecturers_part_time),
        fullTime: n(r.lecturers_total) - n(r.lecturers_part_time),
        programmeLeaders: n(r.programme_leaders),
        /** lecturers whose stored limit is outside the rule's allowed range */
        limitAlerts: n(r.lecturers_limit_alerts),
      },
      courses: {
        academicYears: n(r.years_total),
        programs: n(r.programmes_total),
        activeSubjects: n(r.subjects_total),
        academicYearTerms: n(r.academic_year_terms_total),
      },
      allocations: {
        total: n(r.workloads_total),
        approved: n(r.workloads_approved),
        pending: n(r.workloads_pending),
        overLimit: n(r.over_limit),
      },
    });
  } catch {
    return res.status(503).json({
      ok: false,
      message: "Dashboard data is unavailable (database offline).",
    });
  }
});

export default router;
