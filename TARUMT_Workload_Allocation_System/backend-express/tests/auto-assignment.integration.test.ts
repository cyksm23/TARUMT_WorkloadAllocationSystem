import assert from "node:assert/strict";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { checkTeachingHourLimits, handleAutoAssignment, lockAssignmentWrites } from "../src/services/auto-assignment-service";

// Opt in with TEST_DATABASE_URL. Every fixture is a session-local TEMP table;
// no real lecturer, subject, workload or assignment is created or modified.
test("PostgreSQL preview, stale protection, atomic commit and manual hour checks", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const adapter = { connect: async () => ({ query: client.query.bind(client), release: () => {} } as PoolClient) } as Pick<Pool, "connect">;
  const request = { action: "preview", academicYearId: 1, programmeCode: null };
  try {
    await client.query(`
      CREATE TEMP TABLE academic_years (id int PRIMARY KEY, year_code text);
      CREATE TEMP TABLE academic_year_terms (id int PRIMARY KEY, academic_year_id int, term_code text, week_count int, start_date date, end_date date);
      CREATE TEMP TABLE programmes (id int PRIMARY KEY, programme_code text, programme_name text, level text);
      CREATE TEMP TABLE lecturers (id int PRIMARY KEY, staff_id text, full_name text, area_of_interest text, specialization varchar(200), min_limit_hours numeric, max_limit_hours numeric, is_active boolean);
      CREATE TEMP TABLE subjects (id int PRIMARY KEY, subject_code text, subject_name text, programme_id int, academic_year_id int, lecture_hours numeric, tutorial_hours numeric, practical_hours numeric, tutorial_students int, practical_students int, student_count int, is_active boolean);
      CREATE TEMP TABLE workloads (id serial PRIMARY KEY, lecturer_id int, academic_year_id int, total_allocated_hours numeric DEFAULT 0, status text DEFAULT 'DRAFT', updated_at timestamp DEFAULT NOW(), UNIQUE(lecturer_id, academic_year_id));
      CREATE TEMP TABLE workload_details (id serial PRIMARY KEY, workload_id int, subject_id int, activity_type text, group_name text, student_count int, hours_per_week numeric, total_hours numeric, notes text);
      INSERT INTO academic_years VALUES (1, '2026/2027');
      INSERT INTO academic_year_terms VALUES
        (1, 1, '202609', 14, '2026-09-21', '2026-12-20'),
        (2, 1, '202701', 14, '2027-01-11', '2027-04-11'),
        (3, 1, '202605', 14, '2026-05-04', '2026-08-02');
      INSERT INTO programmes VALUES (1, 'RSD', 'Software Development', 'Bachelor');
      INSERT INTO lecturers VALUES
        (1, '1001', 'Programming Lecturer', 'Programming', 'Computer Science', 2, 6, true),
        (2, '1002', 'Maths Lecturer', NULL, 'Mathematics', 5, 10, true),
        (3, '1003', 'Missing Profile', NULL, NULL, 5, 20, true);
      INSERT INTO subjects VALUES
        (1, 'TST1001', 'Object-Oriented Programming Techniques', 1, 1, 2, 1, 1, NULL, NULL, 0, true),
        (2, 'TST1002', 'Discrete Mathematics', 1, 1, 3, 0, 0, NULL, NULL, 0, true),
        (3, 'TST1003', 'Unknown Philosophy', 1, 1, 2, 0, 0, NULL, NULL, 0, true),
        (4, 'TST1004', 'Programming', 1, 1, 2, 0, 0, NULL, NULL, 0, false),
        (5, 'TST1005', 'Database Management', 1, 1, 1, 1, 1, NULL, NULL, 0, true);
    `);
    const rowCount = async () => Number((await client.query("SELECT COUNT(*) AS count FROM pg_temp.workload_details")).rows[0].count);
    const getPlan = async () => {
      const response = await handleAutoAssignment(adapter, request);
      assert.equal(response.status, 200);
      assert.ok("plan" in response.body && response.body.plan);
      return response.body.plan;
    };

    await t.test("preview is read-only and returns recorded specializations", async () => {
      const plan = await getPlan();
      assert.equal(plan.proposals.length, 2);
      assert.equal(plan.unassigned.length, 2);
      assert.equal(plan.inactiveCount, 1);
      assert.equal(plan.proposals.find((proposal) => proposal.subjectCode === "TST1002")?.specialization, "Mathematics");
      assert.equal(await rowCount(), 0);
      assert.equal((await getPlan()).previewToken, plan.previewToken);
    });

    await t.test("a specialization change makes the old preview stale without saving anything", async () => {
      const plan = await getPlan();
      await client.query("UPDATE pg_temp.lecturers SET specialization = 'Mathematics and Statistics' WHERE id = 2");
      const result = await handleAutoAssignment(adapter, { ...request, action: "commit", previewToken: plan.previewToken });
      assert.equal(result.status, 409);
      assert.equal(await rowCount(), 0);
    });

    await t.test("changing the priority order requires a newly reviewed preview", async () => {
      const plan = await getPlan();
      const result = await handleAutoAssignment(adapter, { ...request, priorities: ["specialization", "workload", "interest", "history"], action: "commit", previewToken: plan.previewToken });
      assert.equal(result.status, 409);
      assert.equal(await rowCount(), 0);
    });

    await t.test("history comes from positive-hour teaching in earlier completed non-rejected terms only", async () => {
      try {
        await client.query(`
          INSERT INTO subjects VALUES
            (20, 'HIST20', 'Programming', 1, 3, 2, 1, 0, NULL, NULL, 0, true),
            (21, 'HIST21', 'Computer Networks', 1, 2, 2, 0, 0, NULL, NULL, 0, true),
            (22, 'HIST22', 'Web Development', 1, 3, 2, 0, 0, NULL, NULL, 0, true),
            (23, 'HIST23', 'Mobile Applications', 1, 3, 0, 0, 0, NULL, NULL, 0, true),
            (24, 'HIST24', 'Unknown Philosophy', 1, 3, 0, 0, 0, NULL, NULL, 0, true);
          INSERT INTO workloads (lecturer_id, academic_year_id, status) VALUES (3, 3, 'DRAFT'), (1, 2, 'DRAFT'), (2, 3, 'REJECTED');
          INSERT INTO workload_details (workload_id, subject_id, activity_type, hours_per_week, total_hours)
            SELECT id, 20, 'LECTURE', 2, 28 FROM workloads WHERE lecturer_id = 3 AND academic_year_id = 3
            UNION ALL SELECT id, 20, 'TUTORIAL', 1, 14 FROM workloads WHERE lecturer_id = 3 AND academic_year_id = 3
            UNION ALL SELECT id, 23, 'LECTURE', 0, 0 FROM workloads WHERE lecturer_id = 3 AND academic_year_id = 3
            UNION ALL SELECT id, 24, 'OTHER', 1, 14 FROM workloads WHERE lecturer_id = 3 AND academic_year_id = 3
            UNION ALL SELECT id, 21, 'LECTURE', 2, 28 FROM workloads WHERE lecturer_id = 1 AND academic_year_id = 2
            UNION ALL SELECT id, 22, 'LECTURE', 2, 28 FROM workloads WHERE lecturer_id = 2 AND academic_year_id = 3;
        `);
        const countBefore = await rowCount();
        const plan = await getPlan();
        assert.equal(plan.historyRecordCount, 1);
        const historicalSuggestion = plan.proposals.find((proposal) => proposal.subjectCode === "TST1001")!;
        assert.equal(historicalSuggestion.lecturerId, 3);
        assert.equal(historicalSuggestion.historyMatches[0].subjectCode, "HIST20");
        assert.equal(historicalSuggestion.historyMatches[0].academicYearLabel, "202605 · AY 2026/2027");
        assert.equal(await rowCount(), countBefore);
        await client.query("UPDATE pg_temp.subjects SET subject_name = 'Object-Oriented Programming' WHERE id = 20");
        assert.equal((await handleAutoAssignment(adapter, { ...request, action: "commit", previewToken: plan.previewToken })).status, 409);
        assert.equal(await rowCount(), countBefore);
      } finally {
        await client.query("DELETE FROM pg_temp.workload_details; DELETE FROM pg_temp.workloads; DELETE FROM pg_temp.subjects WHERE id >= 20;");
      }
    });

    await t.test("an hour-limit change invalidates the preview as well", async () => {
      const plan = await getPlan();
      await client.query("UPDATE pg_temp.lecturers SET max_limit_hours = 7 WHERE id = 1");
      const result = await handleAutoAssignment(adapter, { ...request, action: "commit", previewToken: plan.previewToken });
      assert.equal(result.status, 409);
      assert.equal(await rowCount(), 0);
      await client.query("UPDATE pg_temp.lecturers SET max_limit_hours = 6 WHERE id = 1");
    });

    await t.test("a failed insert rolls back every course/header in the batch", async () => {
      const plan = await getPlan();
      await client.query(`CREATE FUNCTION pg_temp.reject_maths() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject_id = 2 THEN RAISE EXCEPTION 'test insert failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_maths BEFORE INSERT ON pg_temp.workload_details FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_maths();`);
      await assert.rejects(() => handleAutoAssignment(adapter, { ...request, action: "commit", previewToken: plan.previewToken }), /test insert failure/);
      assert.equal(await rowCount(), 0);
      assert.equal(Number((await client.query("SELECT COUNT(*) AS count FROM pg_temp.workloads")).rows[0].count), 0);
      await client.query("DROP TRIGGER reject_maths ON pg_temp.workload_details; DROP FUNCTION pg_temp.reject_maths();");
    });

    await t.test("confirmation saves all L/T/P rows, totals and matching notes exactly once", async () => {
      const plan = await getPlan();
      const result = await handleAutoAssignment(adapter, { ...request, action: "commit", previewToken: plan.previewToken });
      assert.equal(result.status, 201);
      assert.equal(await rowCount(), 6);
      const workloads = (await client.query("SELECT lecturer_id, total_allocated_hours::float8 AS hours FROM pg_temp.workloads ORDER BY lecturer_id")).rows;
      assert.deepEqual(workloads, [{ lecturer_id: 1, hours: 4 }, { lecturer_id: 2, hours: 3 }]);
      const details = (await client.query("SELECT notes, hours_per_week::float8 AS hours, total_hours::float8 AS total FROM pg_temp.workload_details")).rows;
      assert.ok(details.every((detail) => detail.notes.includes("Auto assigned after preview confirmation") &&
        detail.notes.includes("Priorities: Workload / teaching hours > Specialization") &&
        detail.notes.includes("Earlier assignments:") && detail.total === detail.hours * 14));
      assert.equal((await handleAutoAssignment(adapter, { ...request, action: "commit", previewToken: plan.previewToken })).status, 409);
      assert.equal(await rowCount(), 6);
      assert.equal((await getPlan()).existingCount, 2);
    });

    await t.test("manual retargets exclude replaced rows but include grouped and other teaching", async () => {
      const subject = { subjectId: 1, academicYearId: 1, lectureHours: 2, tutorialHours: 1, practicalHours: 1 };
      const slots = { LECTURE: 1, TUTORIAL: 1, PRACTICAL: 1 };
      assert.equal(await checkTeachingHourLimits(client, subject, slots), null);
      assert.match((await checkTeachingHourLimits(client, { ...subject, lectureHours: 5 }, slots))!, /would teach 7 h\/week/);
      await client.query("INSERT INTO pg_temp.workload_details (workload_id, subject_id, activity_type, group_name, hours_per_week, total_hours) SELECT id, 1, 'TUTORIAL', 'A', 1, 14 FROM pg_temp.workloads WHERE lecturer_id = 1");
      assert.equal(await checkTeachingHourLimits(client, subject, slots), null);
      await client.query("INSERT INTO pg_temp.workload_details (workload_id, subject_id, activity_type, hours_per_week, total_hours) SELECT id, 3, 'OTHER', 2, 28 FROM pg_temp.workloads WHERE lecturer_id = 1");
      assert.match((await checkTeachingHourLimits(client, subject, slots))!, /would teach 7 h\/week/);
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end(); // Session TEMP tables are automatically discarded.
  }
});

test("assignment transaction lock is shared across database connections", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query("BEGIN");
    await second.query("BEGIN");
    await lockAssignmentWrites(first);
    assert.equal((await second.query("SELECT pg_try_advisory_xact_lock(20261024, 1) AS acquired")).rows[0].acquired, false);
    await first.query("COMMIT");
    assert.equal((await second.query("SELECT pg_try_advisory_xact_lock(20261024, 1) AS acquired")).rows[0].acquired, true);
  } finally {
    await first.query("ROLLBACK");
    await second.query("ROLLBACK");
    first.release();
    second.release();
    await pool.end();
  }
});
