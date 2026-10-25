import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import {
  CourseHistoryError,
  loadCourseHistoryTerm,
  loadCourseHistoryTerms,
} from "../src/services/course-history";

// Opt in with TEST_DATABASE_URL. Session-local TEMP tables shadow the live
// schema, so this suite cannot create, update or delete real history records.
test("PostgreSQL course history terms, programme choices and slot lecturers", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TEMP TABLE academic_years (
        id int PRIMARY KEY,
        year_code text NOT NULL
      );
      CREATE TEMP TABLE academic_year_terms (
        id int PRIMARY KEY,
        academic_year_id int NOT NULL,
        term_name text NOT NULL,
        term_code text NOT NULL,
        start_date date NOT NULL,
        end_date date NOT NULL,
        week_count int NOT NULL
      );
      CREATE TEMP TABLE programmes (
        id int PRIMARY KEY,
        programme_code text NOT NULL,
        programme_name text NOT NULL,
        level text
      );
      CREATE TEMP TABLE lecturers (
        id int PRIMARY KEY,
        staff_id text NOT NULL,
        full_name text NOT NULL,
        position text
      );
      CREATE TEMP TABLE subjects (
        id int PRIMARY KEY,
        subject_code text NOT NULL,
        subject_name text NOT NULL,
        programme_id int,
        academic_year_id int,
        credit_hours numeric,
        lecture_hours numeric,
        tutorial_hours numeric,
        practical_hours numeric,
        student_count int
      );
      CREATE TEMP TABLE workloads (
        id int PRIMARY KEY,
        lecturer_id int NOT NULL,
        academic_year_id int NOT NULL,
        status text NOT NULL
      );
      CREATE TEMP TABLE workload_details (
        id int PRIMARY KEY,
        workload_id int NOT NULL,
        subject_id int NOT NULL,
        activity_type text NOT NULL,
        group_name text,
        student_count int,
        hours_per_week numeric NOT NULL,
        total_hours numeric NOT NULL
      );

      INSERT INTO academic_years VALUES
        (1, '2025/2026'),
        (2, '2026/2027');
      INSERT INTO academic_year_terms VALUES
        (1, 2, 'September 2026', '202609', '2026-09-21', '2026-12-20', 14),
        (2, 2, 'May 2026',       '202605', '2026-05-04', '2026-08-02', 14),
        (3, 1, 'January 2026',   '202601', '2026-01-12', '2026-04-12', 14),
        (4, 1, 'September 2025', '202509', '2025-09-22', '2025-12-21', 14),
        (5, 2, 'January 2027',   '202701', '2027-01-11', '2027-04-11', 14);
      INSERT INTO programmes VALUES
        (1, 'DFT', 'Diploma in Information Technology', 'Diploma'),
        (2, 'RSD', 'Bachelor of Software Engineering', 'Bachelor');
      INSERT INTO lecturers VALUES
        (1, '1001', 'Dr. Ada Lim', 'Senior Lecturer'),
        (2, '1002', 'Mr. Ben Tan', 'Lecturer'),
        (3, '1003', 'Ms. Chloe Lee', 'Lecturer');
      INSERT INTO subjects VALUES
        (1, 'DFT1001', 'Programming Concepts', 1, 1, 3, 2, 1, 0, 42),
        (2, 'RSD2001', 'Software Design',      2, 1, 4, 2, 1, 1, 35),
        (3, 'DFT1002', 'Database Fundamentals',1, 2, 3, 2, 1, 0, 40),
        (4, 'RSD2002', 'Web Application',      2, 3, 4, 2, 1, 1, 32),
        (5, 'DFT1003', 'Information Systems',  1, 4, 3, 2, 1, 0, 38),
        (6, 'RSD2999', 'Grouped Session Only', 2, 5, 3, 2, 1, 0, 20),
        (7, 'DFT1999', 'Mismatched Header',     1, 1, 3, 2, 1, 0, 20);
      INSERT INTO workloads VALUES
        (1, 1, 1, 'APPROVED'),
        (2, 2, 1, 'PENDING'),
        (3, 3, 2, 'DRAFT'),
        (4, 1, 3, 'APPROVED'),
        (5, 2, 4, 'DRAFT'),
        (6, 3, 5, 'DRAFT');
      INSERT INTO workload_details VALUES
        (1, 1, 1, 'LECTURE',   NULL, 42, 2, 28),
        (2, 2, 1, 'TUTORIAL',  NULL, 42, 1, 14),
        (3, 2, 1, 'PRACTICAL', NULL, 42, 0,  0),
        (4, 2, 2, 'LECTURE',   NULL, 35, 2, 28),
        (5, 2, 2, 'TUTORIAL',  NULL, 35, 1, 14),
        (6, 1, 2, 'PRACTICAL', NULL, 35, 1, 14),
        (7, 3, 3, 'LECTURE',   NULL, 40, 2, 28),
        (8, 4, 4, 'LECTURE',   NULL, 32, 2, 28),
        (9, 5, 5, 'LECTURE',   NULL, 38, 2, 28),
        (10, 6, 6, 'LECTURE',  'A', 20, 2, 28),
        (11, 3, 7, 'LECTURE',  NULL, 20, 2, 28);
    `);

    await t.test("lists only saved whole-course history in newest-term-first order", async () => {
      const terms = await loadCourseHistoryTerms(client);
      assert.deepEqual(terms.map((term) => term.termCode), ["202609", "202605", "202601", "202509"]);
      assert.deepEqual(terms[0], {
        termCode: "202609",
        termName: "September 2026",
        yearCode: "2026/2027",
        startDate: "2026-09-21",
        endDate: "2026-12-20",
        courseCount: 3,
        programmeCount: 2,
        lecturerCount: 3,
      });
    });

    await t.test("loads programme choices before any assignment details", async () => {
      const detail = await loadCourseHistoryTerm(client, "202609");
      assert.equal(detail.term.courseCount, 3);
      assert.equal(detail.term.weekCount, 14);
      assert.deepEqual(detail.programmes.map((programme) => programme.code), ["DFT", "RSD"]);
      assert.equal(detail.selectedProgramme, null);
      assert.deepEqual(detail.assignments, []);
    });

    await t.test("preserves split lecture, tutorial and practical lecturers", async () => {
      const detail = await loadCourseHistoryTerm(client, "202609", "dft");
      assert.equal(detail.selectedProgramme?.code, "DFT");
      assert.equal(detail.assignments.length, 2);
      const assignment = detail.assignments.find((course) => course.subjectCode === "DFT1001");
      assert.ok(assignment);
      assert.deepEqual(
        assignment.slots.map((slot) => [slot.activityType, slot.staffId, slot.hoursPerWeek, slot.status]),
        [
          ["LECTURE", "1001", 2, "APPROVED"],
          ["TUTORIAL", "1002", 1, "PENDING"],
          ["PRACTICAL", "1002", 0, "PENDING"],
        ],
      );
      assert.equal(
        detail.assignments.find((course) => course.subjectCode === "DFT1999")?.slots[0].staffId,
        "1003",
        "the subject term remains authoritative when old workload-header metadata differs",
      );
    });

    await t.test("validates term and programme route parameters", async () => {
      await assert.rejects(
        () => loadCourseHistoryTerm(client, "2026-09"),
        (error: unknown) => error instanceof CourseHistoryError && error.status === 400,
      );
      await assert.rejects(
        () => loadCourseHistoryTerm(client, "199901"),
        (error: unknown) => error instanceof CourseHistoryError && error.status === 404,
      );
      await assert.rejects(
        () => loadCourseHistoryTerm(client, "202609", "UNKNOWN"),
        (error: unknown) => error instanceof CourseHistoryError && error.status === 404,
      );
    });
  } finally {
    client.release();
    await pool.end(); // Closing the session discards every TEMP table above.
  }
});
