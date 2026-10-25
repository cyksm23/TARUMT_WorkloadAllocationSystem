import type { Pool, QueryResultRow } from "pg";

type CourseHistoryDatabase = Pick<Pool, "query">;

export type TeachingActivity = "LECTURE" | "TUTORIAL" | "PRACTICAL";

export interface CourseHistoryTermSummary {
  termCode: string;
  termName: string;
  yearCode: string;
  startDate: string;
  endDate: string;
  courseCount: number;
  programmeCount: number;
  lecturerCount: number;
}

export interface CourseHistoryProgramme {
  code: string;
  name: string;
  level: string | null;
  courseCount: number;
  lecturerCount: number;
}

export interface CourseHistorySlot {
  activityType: TeachingActivity;
  lecturerId: number;
  staffId: string;
  lecturerName: string;
  position: string | null;
  hoursPerWeek: number;
  totalHours: number;
  studentCount: number;
  status: string;
}

export interface CourseHistoryAssignment {
  subjectCode: string;
  subjectName: string;
  creditHours: number;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
  studentCount: number;
  slots: CourseHistorySlot[];
}

export interface CourseHistoryTermDetail {
  term: CourseHistoryTermSummary & { weekCount: number };
  programmes: CourseHistoryProgramme[];
  selectedProgramme: CourseHistoryProgramme | null;
  assignments: CourseHistoryAssignment[];
}

export class CourseHistoryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface TermSummaryRow extends QueryResultRow {
  termCode: string;
  termName: string;
  yearCode: string;
  startDate: string;
  endDate: string;
  courseCount: number | string;
  programmeCount: number | string;
  lecturerCount: number | string;
}

interface TermDetailRow extends TermSummaryRow {
  weekCount: number | string;
}

interface ProgrammeRow extends QueryResultRow {
  code: string;
  name: string;
  level: string | null;
  courseCount: number | string;
  lecturerCount: number | string;
}

interface AssignmentRow extends QueryResultRow {
  subjectCode: string;
  subjectName: string;
  creditHours: number | string;
  lectureHours: number | string;
  tutorialHours: number | string;
  practicalHours: number | string;
  courseStudentCount: number | string | null;
  activityType: TeachingActivity;
  lecturerId: number;
  staffId: string;
  lecturerName: string;
  position: string | null;
  hoursPerWeek: number | string;
  totalHours: number | string;
  slotStudentCount: number | string | null;
  status: string;
}

const asTermSummary = (row: TermSummaryRow): CourseHistoryTermSummary => ({
  termCode: row.termCode,
  termName: row.termName,
  yearCode: row.yearCode,
  startDate: row.startDate,
  endDate: row.endDate,
  courseCount: Number(row.courseCount),
  programmeCount: Number(row.programmeCount),
  lecturerCount: Number(row.lecturerCount),
});

/** Terms without saved whole-course L/T/P assignment rows are not history yet. */
export async function loadCourseHistoryTerms(database: CourseHistoryDatabase): Promise<CourseHistoryTermSummary[]> {
  const { rows } = await database.query<TermSummaryRow>(`
    SELECT t.term_code AS "termCode", t.term_name AS "termName", ay.year_code AS "yearCode",
           t.start_date::text AS "startDate", t.end_date::text AS "endDate",
           COUNT(DISTINCT s.id)::int AS "courseCount",
           COUNT(DISTINCT p.id)::int AS "programmeCount",
           COUNT(DISTINCT l.id)::int AS "lecturerCount"
      FROM academic_year_terms t
      JOIN academic_years ay ON ay.id = t.academic_year_id
      JOIN subjects s ON s.academic_year_id = t.id
      JOIN programmes p ON p.id = s.programme_id
      JOIN workload_details wd ON wd.subject_id = s.id
       AND wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
       AND wd.group_name IS NULL
      JOIN workloads w ON w.id = wd.workload_id
      JOIN lecturers l ON l.id = w.lecturer_id
     GROUP BY t.id, t.term_code, t.term_name, ay.year_code, t.start_date, t.end_date
     ORDER BY t.term_code DESC
  `);
  return rows.map(asTermSummary);
}

export async function loadCourseHistoryTerm(
  database: CourseHistoryDatabase,
  rawTermCode: unknown,
  rawProgrammeCode?: unknown,
): Promise<CourseHistoryTermDetail> {
  const termCode = typeof rawTermCode === "string" ? rawTermCode.trim() : "";
  if (!/^\d{6}$/.test(termCode)) {
    throw new CourseHistoryError(400, "Academic term code must contain exactly 6 digits.");
  }

  const programmeCode = rawProgrammeCode === undefined || rawProgrammeCode === null || rawProgrammeCode === ""
    ? null
    : typeof rawProgrammeCode === "string" && /^[A-Za-z0-9_-]{1,30}$/.test(rawProgrammeCode.trim())
      ? rawProgrammeCode.trim().toUpperCase()
      : "";
  if (programmeCode === "") throw new CourseHistoryError(400, "Invalid programme code.");

  const { rows: termRows } = await database.query<TermDetailRow>(`
    SELECT t.term_code AS "termCode", t.term_name AS "termName", ay.year_code AS "yearCode",
           t.start_date::text AS "startDate", t.end_date::text AS "endDate", t.week_count AS "weekCount",
           COUNT(DISTINCT s.id) FILTER (WHERE wd.id IS NOT NULL)::int AS "courseCount",
           COUNT(DISTINCT p.id) FILTER (WHERE wd.id IS NOT NULL)::int AS "programmeCount",
           COUNT(DISTINCT l.id) FILTER (WHERE wd.id IS NOT NULL)::int AS "lecturerCount"
      FROM academic_year_terms t
      JOIN academic_years ay ON ay.id = t.academic_year_id
      LEFT JOIN subjects s ON s.academic_year_id = t.id
      LEFT JOIN programmes p ON p.id = s.programme_id
      LEFT JOIN workload_details wd ON wd.subject_id = s.id
       AND wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
       AND wd.group_name IS NULL
      LEFT JOIN workloads w ON w.id = wd.workload_id
      LEFT JOIN lecturers l ON l.id = w.lecturer_id
     WHERE t.term_code = $1
     GROUP BY t.id, t.term_code, t.term_name, ay.year_code, t.start_date, t.end_date, t.week_count
     ORDER BY ay.year_code DESC
     LIMIT 1
  `, [termCode]);
  if (termRows.length === 0) throw new CourseHistoryError(404, `Academic term ${termCode} was not found.`);

  const termRow = termRows[0];
  const { rows: programmeRows } = await database.query<ProgrammeRow>(`
    SELECT p.programme_code AS code, p.programme_name AS name, p.level,
           COUNT(DISTINCT s.id)::int AS "courseCount",
           COUNT(DISTINCT w.lecturer_id)::int AS "lecturerCount"
      FROM academic_year_terms t
      JOIN subjects s ON s.academic_year_id = t.id
      JOIN programmes p ON p.id = s.programme_id
      JOIN workload_details wd ON wd.subject_id = s.id
       AND wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
       AND wd.group_name IS NULL
      JOIN workloads w ON w.id = wd.workload_id
     WHERE t.term_code = $1
     GROUP BY p.id, p.programme_code, p.programme_name, p.level
     ORDER BY p.programme_code
  `, [termCode]);
  const programmes = programmeRows.map((row): CourseHistoryProgramme => ({
    code: row.code,
    name: row.name,
    level: row.level,
    courseCount: Number(row.courseCount),
    lecturerCount: Number(row.lecturerCount),
  }));

  const selectedProgramme = programmeCode
    ? programmes.find((programme) => programme.code.toUpperCase() === programmeCode) ?? null
    : null;
  if (programmeCode && !selectedProgramme) {
    throw new CourseHistoryError(404, `No saved ${termCode} assignments were found for programme ${programmeCode}.`);
  }

  let assignments: CourseHistoryAssignment[] = [];
  if (selectedProgramme) {
    const { rows } = await database.query<AssignmentRow>(`
      SELECT s.subject_code AS "subjectCode", s.subject_name AS "subjectName",
             s.credit_hours AS "creditHours", s.lecture_hours AS "lectureHours",
             s.tutorial_hours AS "tutorialHours", s.practical_hours AS "practicalHours",
             s.student_count AS "courseStudentCount", wd.activity_type AS "activityType",
             l.id AS "lecturerId", l.staff_id AS "staffId", l.full_name AS "lecturerName",
             l.position, wd.hours_per_week AS "hoursPerWeek", wd.total_hours AS "totalHours",
             wd.student_count AS "slotStudentCount", w.status
        FROM academic_year_terms t
        JOIN subjects s ON s.academic_year_id = t.id
        JOIN programmes p ON p.id = s.programme_id
        JOIN workload_details wd ON wd.subject_id = s.id
         AND wd.activity_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')
         AND wd.group_name IS NULL
        JOIN workloads w ON w.id = wd.workload_id
        JOIN lecturers l ON l.id = w.lecturer_id
       WHERE t.term_code = $1 AND p.programme_code = $2
       ORDER BY s.subject_code,
                CASE wd.activity_type WHEN 'LECTURE' THEN 1 WHEN 'TUTORIAL' THEN 2 ELSE 3 END,
                l.staff_id
    `, [termCode, selectedProgramme.code]);

    const byCourse = new Map<string, CourseHistoryAssignment>();
    for (const row of rows) {
      let course = byCourse.get(row.subjectCode);
      if (!course) {
        course = {
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          creditHours: Number(row.creditHours),
          lectureHours: Number(row.lectureHours),
          tutorialHours: Number(row.tutorialHours),
          practicalHours: Number(row.practicalHours),
          studentCount: Number(row.courseStudentCount ?? 0),
          slots: [],
        };
        byCourse.set(row.subjectCode, course);
      }
      course.slots.push({
        activityType: row.activityType,
        lecturerId: Number(row.lecturerId),
        staffId: row.staffId,
        lecturerName: row.lecturerName,
        position: row.position,
        hoursPerWeek: Number(row.hoursPerWeek),
        totalHours: Number(row.totalHours),
        studentCount: Number(row.slotStudentCount ?? 0),
        status: row.status,
      });
    }
    assignments = Array.from(byCourse.values());
  }

  return {
    term: { ...asTermSummary(termRow), weekCount: Number(termRow.weekCount) },
    programmes,
    selectedProgramme,
    assignments,
  };
}
