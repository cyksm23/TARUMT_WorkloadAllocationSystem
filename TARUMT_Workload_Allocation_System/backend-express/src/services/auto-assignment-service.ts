import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  buildAutoAssignmentPlan,
  roundHours,
  TEACHING_ACTIVITIES,
  type AutoAssignmentSnapshot,
  type AutoCourse,
  type AutoLecturer,
  type ExistingTeaching,
  type HistoricalTeaching,
} from "./auto-assignment";
import { DEFAULT_ASSIGNMENT_PRIORITIES, isAssignmentPriorityOrder, PRIORITY_LABELS, type AssignmentPriority } from "./auto-assignment-options";

/** Shared by Express and the Next fallback. Every assignment writer uses the
 * same PostgreSQL transaction lock so concurrent manual/auto saves cannot
 * both consume the same remaining capacity or create duplicate course slots.
 */
export async function lockAssignmentWrites(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(20261024, 1)");
}

interface AutoAssignmentRequest {
  action: "preview" | "commit";
  academicYearId: number;
  programmeCode: string | null;
  priorities: AssignmentPriority[];
  previewToken: string | null;
}

class AllocationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parseAutoAssignmentRequest(raw: unknown): AutoAssignmentRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AllocationError(400, "Invalid request body.");
  }
  const body = raw as Record<string, unknown>;
  const yearRaw = body.academicYearId;
  const academicYearId = typeof yearRaw === "number" || (typeof yearRaw === "string" && /^\d+$/.test(yearRaw))
    ? Number(yearRaw) : NaN;
  if (!Number.isInteger(academicYearId) || academicYearId <= 0 || academicYearId > 2147483647) {
    throw new AllocationError(400, "Select one academic year before generating assignments.");
  }
  if (body.action !== "preview" && body.action !== "commit") {
    throw new AllocationError(400, "Choose preview or commit for auto assignment.");
  }
  const programmeCode = body.programmeCode === undefined || body.programmeCode === null ? null : body.programmeCode;
  if (programmeCode !== null && (typeof programmeCode !== "string" || !/^[A-Za-z0-9_-]{1,30}$/.test(programmeCode))) {
    throw new AllocationError(400, "Invalid programme filter.");
  }
  const priorities: unknown = body.priorities === undefined ? [...DEFAULT_ASSIGNMENT_PRIORITIES] : body.priorities;
  if (!isAssignmentPriorityOrder(priorities)) {
    throw new AllocationError(400, "Choose workload, specialization, interest and teaching history exactly once in the priority order.");
  }
  const previewToken = typeof body.previewToken === "string" ? body.previewToken : null;
  if (body.action === "commit" && (!previewToken || !/^[a-f0-9]{64}$/.test(previewToken))) {
    throw new AllocationError(400, "Generate and review a preview before saving.");
  }
  return { action: body.action, academicYearId, programmeCode, priorities, previewToken };
}

async function loadSnapshot(client: PoolClient, request: AutoAssignmentRequest): Promise<AutoAssignmentSnapshot> {
  const locking = request.action === "commit";
  const { rows: terms } = await client.query(
    `SELECT t.id, t.term_code || ' · AY ' || ay.year_code AS label, t.week_count AS "weekCount",
            t.start_date::text AS "startDate", CURRENT_DATE::text AS "asOfDate"
       FROM academic_year_terms t JOIN academic_years ay ON ay.id = t.academic_year_id
      WHERE t.id = $1 ${locking ? "FOR SHARE OF t, ay" : ""}`,
    [request.academicYearId],
  );
  if (terms.length === 0) throw new AllocationError(404, "The selected academic year no longer exists.");
  if (!Number.isInteger(terms[0].weekCount) || terms[0].weekCount <= 0) {
    throw new AllocationError(409, "The academic year needs a valid teaching week count first.");
  }
  // Prevent profile, programme-level and subject edits during validation/write.
  if (locking) await client.query("SELECT id FROM programmes ORDER BY id FOR SHARE");
  if (request.programmeCode) {
    const programme = await client.query("SELECT id FROM programmes WHERE programme_code = $1", [request.programmeCode]);
    if (programme.rows.length === 0) throw new AllocationError(404, "Unknown programme filter.");
  }
  const { rows: courses } = await client.query<AutoCourse>(
    `SELECT s.id, s.subject_code AS "subjectCode", s.subject_name AS "subjectName",
            p.programme_code AS "programmeCode", COALESCE(p.programme_name, '—') AS "programmeName",
            p.level, s.academic_year_id AS "academicYearId",
            s.lecture_hours::float8 AS "lectureHours", s.tutorial_hours::float8 AS "tutorialHours",
            s.practical_hours::float8 AS "practicalHours", s.tutorial_students AS "tutorialStudents",
            s.practical_students AS "practicalStudents", s.student_count AS "studentCount", s.is_active AS "isActive"
       FROM subjects s LEFT JOIN programmes p ON p.id = s.programme_id
      WHERE s.academic_year_id = $1 AND ($2::text IS NULL OR p.programme_code = $2)
      ORDER BY s.subject_code ${locking ? "FOR SHARE OF s" : ""}`,
    [request.academicYearId, request.programmeCode],
  );
  const { rows: lecturers } = await client.query<AutoLecturer>(
    `SELECT id, staff_id AS "staffId", full_name AS "fullName", area_of_interest AS "areaOfInterest",
            specialization, min_limit_hours::float8 AS "minHours",
            max_limit_hours::float8 AS "maxHours", is_active AS "isActive"
       FROM lecturers ORDER BY staff_id ${locking ? "FOR SHARE" : ""}`,
  );
  const { rows: allocations } = await client.query<ExistingTeaching>(
    `SELECT w.lecturer_id AS "lecturerId", w.academic_year_id AS "academicYearId", wd.subject_id AS "subjectId",
            p.level, wd.activity_type AS "activityType", wd.group_name AS "groupName", wd.hours_per_week::float8 AS "hoursPerWeek"
       FROM workload_details wd JOIN workloads w ON w.id = wd.workload_id
       JOIN subjects s ON s.id = wd.subject_id LEFT JOIN programmes p ON p.id = s.programme_id
      ORDER BY w.lecturer_id, w.academic_year_id, wd.subject_id, wd.activity_type, wd.id`,
  );
  const { rows: protectedWorkloads } = await client.query<{ lecturerId: number }>(
    `SELECT lecturer_id AS "lecturerId" FROM workloads
      WHERE academic_year_id = $1 AND status IN ('PENDING', 'APPROVED') ORDER BY lecturer_id`,
    [request.academicYearId],
  );
  const { rows: teachingHistory } = await client.query<HistoricalTeaching>(
    `SELECT DISTINCT w.lecturer_id AS "lecturerId", t.id AS "academicYearId",
            t.term_code || ' · AY ' || ay.year_code AS "academicYearLabel", s.id AS "subjectId",
            s.subject_code AS "subjectCode", s.subject_name AS "subjectName", t.end_date::text AS "endDate"
       FROM workload_details wd JOIN workloads w ON w.id = wd.workload_id
       JOIN subjects s ON s.id = wd.subject_id
       JOIN academic_year_terms t ON t.id = w.academic_year_id
       JOIN academic_years ay ON ay.id = t.academic_year_id
      WHERE wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL') AND wd.hours_per_week > 0
        AND w.status <> 'REJECTED' AND t.id <> $1
        AND t.end_date < $2::date AND t.end_date < CURRENT_DATE
      ORDER BY "lecturerId", "endDate" DESC, "subjectCode", "academicYearId"`,
    [request.academicYearId, terms[0].startDate],
  );
  return {
    term: { id: terms[0].id, label: terms[0].label, weekCount: terms[0].weekCount, startDate: terms[0].startDate },
    asOfDate: terms[0].asOfDate,
    programmeCode: request.programmeCode,
    priorities: request.priorities,
    courses,
    lecturers,
    allocations,
    teachingHistory,
    protectedLecturerIds: protectedWorkloads.map((row) => row.lecturerId),
  };
}

/** Revalidate manual assignments with the same per-term maximum hours.
 * Existing target rows that will be replaced are excluded; grouped teaching
 * and other activities remain included in the lecturer's current workload.
 */
export async function checkTeachingHourLimits(
  client: PoolClient,
  subject: { subjectId: number; academicYearId: number | null; lectureHours: number | string; tutorialHours: number | string; practicalHours: number | string },
  slots: Record<(typeof TEACHING_ACTIVITIES)[number], number>,
): Promise<string | null> {
  if (subject.academicYearId === null) return "The course needs an academic year before assignment.";
  const ids = Array.from(new Set(TEACHING_ACTIVITIES.map((key) => slots[key])));
  const { rows: lecturers } = await client.query<{ id: number; fullName: string; maxHours: number }>(
    `SELECT id, full_name AS "fullName", max_limit_hours::float8 AS "maxHours"
       FROM lecturers WHERE id = ANY($1::int[]) ORDER BY id FOR SHARE`, [ids],
  );
  const { rows: loads } = await client.query<{ lecturerId: number; hours: number }>(
    `SELECT w.lecturer_id AS "lecturerId", COALESCE(SUM(wd.hours_per_week), 0)::float8 AS hours
       FROM workloads w JOIN workload_details wd ON wd.workload_id = w.id
      WHERE w.academic_year_id = $1 AND w.lecturer_id = ANY($2::int[])
        AND NOT (wd.subject_id = $3 AND wd.group_name IS NULL AND wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL'))
      GROUP BY w.lecturer_id`, [subject.academicYearId, ids, subject.subjectId],
  );
  const components = { LECTURE: Number(subject.lectureHours), TUTORIAL: Number(subject.tutorialHours), PRACTICAL: Number(subject.practicalHours) };
  if (Object.values(components).some((hours) => !Number.isFinite(hours) || hours < 0)) {
    return "The course needs valid teaching hours before assignment.";
  }
  for (const lecturer of lecturers) {
    const current = loads.find((load) => load.lecturerId === lecturer.id)?.hours ?? 0;
    const added = TEACHING_ACTIVITIES.reduce((total, key) => total + (slots[key] === lecturer.id ? components[key] : 0), 0);
    const projected = roundHours(current + added);
    if (!Number.isFinite(lecturer.maxHours) || lecturer.maxHours <= 0 || projected > lecturer.maxHours) {
      return `${lecturer.fullName} would teach ${projected} h/week in this academic year — their maximum is ${lecturer.maxHours} h/week.`;
    }
  }
  return null;
}

/** A commit always regenerates from current DB rows and compares the complete
 * preview fingerprint. No client-supplied lecturer ids/hours are trusted.
 * All suggested courses are persisted atomically or none are saved.
 */
export async function handleAutoAssignment(pool: Pick<Pool, "connect">, raw: unknown) {
  let request: AutoAssignmentRequest;
  try {
    request = parseAutoAssignmentRequest(raw);
  } catch (error) {
    if (error instanceof AllocationError) return { status: error.status, body: { ok: false as const, message: error.message } };
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query(request.action === "preview" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    if (request.action === "commit") await lockAssignmentWrites(client);
    const snapshot = await loadSnapshot(client, request);
    const generated = buildAutoAssignmentPlan(snapshot);
    // Include the decisions too: a matcher/rule deployment between preview
    // and confirmation must not silently save different lecturer choices.
    const previewToken = createHash("sha256").update(JSON.stringify({ snapshot, generated })).digest("hex");
    const plan = { ...generated, previewToken };
    if (request.action === "preview") {
      await client.query("COMMIT");
      return { status: 200, body: { ok: true as const, plan } };
    }
    if (request.previewToken !== previewToken) {
      throw new AllocationError(409, "Data changed since this preview. Generate a new preview before saving; no assignments were changed.");
    }
    if (plan.proposals.length === 0) throw new AllocationError(409, "There are no suitable assignments to save.");

    const touched = new Set<number>();
    for (const proposal of plan.proposals) {
      const course = snapshot.courses.find((row) => row.subjectCode === proposal.subjectCode)!;
      const { rows: headers } = await client.query<{ id: number }>(
        `INSERT INTO workloads (lecturer_id, academic_year_id) VALUES ($1, $2)
         ON CONFLICT (lecturer_id, academic_year_id) DO UPDATE SET updated_at = NOW() RETURNING id`,
        [proposal.lecturerId, snapshot.term.id],
      );
      const workloadId = headers[0].id;
      touched.add(workloadId);
      const hours = { LECTURE: course.lectureHours, TUTORIAL: course.tutorialHours, PRACTICAL: course.practicalHours };
      const students = { LECTURE: course.studentCount, TUTORIAL: course.tutorialStudents, PRACTICAL: course.practicalStudents };
      const notes = `Auto assigned after preview confirmation. Priorities: ${plan.priorities.map((priority) => PRIORITY_LABELS[priority]).join(" > ")}. Interest matches: ${proposal.interestMatches.join(", ") || "none"}. Specialization matches: ${proposal.specializationMatches.join(", ") || "none"}. Earlier assignments: ${proposal.historyMatches.map((match) => `${match.subjectCode} (${match.academicYearLabel})`).join(", ") || "none recorded"}.`;
      for (const activity of TEACHING_ACTIVITIES) {
        await client.query(
          `INSERT INTO workload_details (workload_id, subject_id, activity_type, group_name, student_count, hours_per_week, total_hours, notes)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
          [workloadId, course.id, activity, students[activity] ?? 0, hours[activity], roundHours(hours[activity] * snapshot.term.weekCount), notes],
        );
      }
    }
    await client.query(
      `UPDATE workloads w SET total_allocated_hours =
         (SELECT COALESCE(SUM(wd.hours_per_week), 0) FROM workload_details wd WHERE wd.workload_id = w.id), updated_at = NOW()
        WHERE w.id = ANY($1::int[])`, [Array.from(touched)],
    );
    await client.query("COMMIT");
    const count = plan.proposals.length;
    return {
      status: 201,
      body: { ok: true as const, assignedCount: count, message: `Auto assigned ${count} course${count === 1 ? "" : "s"} in ${plan.academicYearLabel}. Existing assignments were kept.` },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof AllocationError) return { status: error.status, body: { ok: false as const, message: error.message } };
    if (["40001", "40P01"].includes((error as { code?: string }).code ?? "")) {
      return { status: 409, body: { ok: false as const, message: "Another allocation is being saved. Generate a new preview and try again." } };
    }
    throw error;
  } finally {
    client.release();
  }
}
