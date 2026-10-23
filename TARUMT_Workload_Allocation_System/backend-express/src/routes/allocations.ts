/**
 * Course Assignment persistence (Workload Management — docx Table 1.4.1.1).
 *
 * GET    /api/allocations              — current whole-course slot rows
 *                                        (LECTURE / TUTORIAL / PRACTICAL,
 *                                        group_name IS NULL rows only).
 * POST   /api/allocations              — create the slots of a course
 *                                        { subjectCode, slots }.
 * PUT    /api/allocations/:subjectCode — replace a course's slot rows
 *                                        (the Edit dialog's save).
 * DELETE /api/allocations/:subjectCode — unassign the course.
 *
 * Storage model: the assignment lives in workload_details (one row per
 * slot activity) under the slot lecturer's workloads header for the
 * subject's academic year (headers are upserted by (lecturer_id,
 * academic_year_id)).
 * slot hours come from the subject's L/T/P components; total_hours =
 * hours_per_week × term week_count; after every write each touched
 * workload header's total_allocated_hours is resummed and emptied headers
 * are dropped.
 *
 * Assignment policy (institutional, enforced at save): a lecturer may not
 * hold more than 3 distinct courses in Bachelor programmes and 4 in
 * Diploma programmes (Master/Foundation are uncapped) — post-state
 * distinct-course counts are checked inside the same transaction, so a
 * retarget that keeps a lecturer within the cap still succeeds.
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

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

/* subject + programme context (NULL when the code is unknown) */
interface SubjectRow {
  subjectId: number;
  subjectCode: string;
  subjectName: string;
  academicYearId: number | null;
  lectureHours: string | number;
  tutorialHours: string | number;
  practicalHours: string | number;
  tutorialStudents: number | null;
  practicalStudents: number | null;
  studentCount: number | null;
  level: string | null;
}

/* fetch the subject's assignment context */
const loadSubject = async (client: { query: Function }, code: string) => {
  const { rows } = await client.query(
    `
    SELECT s.id                      AS "subjectId",
           s.subject_code            AS "subjectCode",
           s.subject_name            AS "subjectName",
           s.academic_year_id             AS "academicYearId",
           s.lecture_hours           AS "lectureHours",
           s.tutorial_hours          AS "tutorialHours",
           s.practical_hours         AS "practicalHours",
           s.tutorial_students       AS "tutorialStudents",
           s.practical_students      AS "practicalStudents",
           s.student_count           AS "studentCount",
           p.level                   AS "level"
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
  client: { query: Function },
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

/* post-state distinct-course counts per (lecturer, programme level) — used
   by the policy caps; the target subject is excluded so a retarget that
   keeps a lecturer within the cap succeeds */
const loadCourseCounts = async (
  client: { query: Function },
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

/* validate the caps: each DISTINCT slot lecturer gains this subject at the
   subject's level; the three slots of one course never double-count */
const checkCaps = (
  lecturersSet: number[],
  nameOf: Record<number, string>,
  level: string | null,
  counts: Record<string, number>,
): string | null => {
  const cap = level ? (LEVEL_CAPS[level] ?? null) : null;
  if (!cap) return null;
  const label = level;
  for (const lid of lecturersSet) {
    const held = counts[`${lid}|${level}`] ?? 0;
    if (held + 1 > cap) {
      return `${nameOf[lid] ?? `Lecturer #${lid}`} would hold ${held + 1} ${label} courses — policy allows at most ${cap} per lecturer in ${label} programmes.`;
    }
  }
  return null;
};

/* resum every workload header's total_allocated_hours and drop emptied
   headers (runs inside the caller's transaction) */
const refreshWorkloadTotals = async (client: { query: Function }) => {
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

router.get("/", async (_req: Request, res: Response) => {
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
    return res.json({ ok: true, allocations: rows });
  } catch (err) {
    console.error("GET /api/allocations failed:", err);
    return res.status(500).json({ ok: false, message: "Assignment list unavailable." });
  }
});

/* shared transaction body for POST (create) and PUT (:code replace) —
   code is looked up first; the slot-select phase is identical so the
   create route validates "not already assigned" before delegating here */
const writeSlots = async (
  req: Request,
  res: Response,
  subjectCode: string,
  slots: Record<SlotKey, number>,
  expectNew: boolean,
) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    /* subject must exist and carry an academic year + week count */
    const subject = await loadSubject(client, subjectCode);
    if (!subject) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Unknown course." });
    }

    let weekCount = 0;
    if (subject.academicYearId === null) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ ok: false, message: "This course has no academic year — edit the course first." });
    }
    {
      const { rows } = await client.query(
        `SELECT week_count FROM academic_year_terms WHERE id = $1`,
        [subject.academicYearId],
      );
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({ ok: false, message: "The course's academic year no longer exists." });
      }
      weekCount = Number(rows[0].week_count) || 14;
    }

    /* lecturer existence / activity */
    const lecturersSet = [...new Set(SLOT_KEYS.map((k) => slots[k]))];
    const lect = await loadLecturers(client, lecturersSet);
    if (!lect.ok) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, message: lect.message });
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
    if (expectNew && (existing.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        message: "This course is already assigned — edit the existing assignment instead.",
      });
    }

    /* policy caps (Bachelor 3 / Diploma 4) on the post-state counts */
    const counts = await loadCourseCounts(client, subject.subjectId);
    const capError = checkCaps(
      lecturersSet,
      lect.nameOf,
      subject.level,
      counts,
    );
    if (capError) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, message: capError });
    }

    /* rewrite the slot rows */
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
        INSERT INTO workloads (lecturer_id, academic_year_id)
        VALUES ($1, $2)
        ON CONFLICT (lecturer_id, academic_year_id)
        DO UPDATE SET updated_at = NOW()
        RETURNING id
        `,
        [lecturerId, subject.academicYearId],
      );
      const workloadId: number = headerRows[0].id;
      const hours = Number(subject[SLOT_HOURS[key] as keyof SubjectRow] ?? 0);
      const studentsRaw = subject[SLOT_STUDENTS[key] as keyof SubjectRow];
      const students = studentsRaw === null || studentsRaw === undefined ? 0 : Number(studentsRaw);
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

    /* resum the touched lecturers' totals + drop emptied headers */
    await refreshWorkloadTotals(client);

    await client.query("COMMIT");
    return res.status(expectNew ? 201 : 200).json({
      ok: true,
      message: `Assignment saved for ${subject.subjectCode} (${subject.subjectName.trim()}).`,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already gone */
    }
    console.error("write /api/allocations failed:", err);
    return res.status(500).json({ ok: false, message: "The assignment could not be saved." });
  } finally {
    client.release();
  }
};

/* ── POST — create a course's slots ──────────────────────────────────────── */

router.post("/", async (req: Request, res: Response) => {
  const subjectCode =
    typeof req.body?.subjectCode === "string" ? req.body.subjectCode.trim() : "";
  const slots = readSlots(req.body?.slots);
  if (!subjectCode || !slots) {
    return res.status(400).json({
      ok: false,
      message: "The request must carry subjectCode and the LECTURE/TUTORIAL/PRACTICAL slots.",
    });
  }
  return writeSlots(req, res, subjectCode, slots, true);
});

/* ── PUT /:subjectCode — replace a course's slots (Edit save) ───────────── */

router.put("/:subjectCode", async (req: Request, res: Response) => {
  const slots = readSlots(req.body?.slots);
  if (!slots) {
    return res.status(400).json({
      ok: false,
      message: "The request must carry the LECTURE/TUTORIAL/PRACTICAL slots.",
    });
  }
  return writeSlots(req, res, req.params.subjectCode, slots, false);
});

/* ── DELETE /:subjectCode — unassign the course ─────────────────────────── */

router.delete("/:subjectCode", async (req: Request, res: Response) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const subject = await loadSubject(client, req.params.subjectCode);
    if (!subject) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Unknown course." });
    }
    const result = await client.query(
      `
      DELETE FROM workload_details
       WHERE subject_id = $1
         AND activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
         AND group_name IS NULL
      `,
      [subject.subjectId],
    );
    if ((result.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ ok: false, message: "This course has no assignment to remove." });
    }
    await refreshWorkloadTotals(client);
    await client.query("COMMIT");
    return res.json({
      ok: true,
      message: `Assignment cleared for ${subject.subjectCode} (${subject.subjectName.trim()}).`,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already gone */
    }
    console.error("DELETE /api/allocations/:code failed:", err);
    return res
      .status(500)
      .json({ ok: false, message: "The assignment could not be removed." });
  } finally {
    client.release();
  }
});

export default router;
