import assert from "node:assert/strict";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { handleApplyHourLimitRules } from "../src/services/lecturer-limits";

test("bulk hour-limit requests require preview or explicit token-bearing confirmation", async () => {
  const noDatabase = { connect: async () => { throw new Error("Invalid requests must not access PostgreSQL"); } } as Pick<Pool, "connect">;
  for (const body of [null, [], {}, { action: "save" }, { action: "commit" }, { action: "commit", previewToken: "unreviewed" }]) {
    const result = await handleApplyHourLimitRules(noDatabase, body);
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
  }
});

// Every table is session-local TEMP data, shadowing public names. The service
// may commit its transactions without touching the real staff or assignments.
test("PostgreSQL all-staff hour-limit preview and confirmed reset", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const adapter = { connect: async () => ({ query: client.query.bind(client), release: () => {} } as PoolClient) } as Pick<Pool, "connect">;
  try {
    await client.query(`
      CREATE TEMP TABLE workload_rules (rule_key text PRIMARY KEY, label text, min_hours numeric, max_hours numeric);
      CREATE TEMP TABLE lecturers (id int PRIMARY KEY, staff_id text, full_name text, is_pl boolean, is_active boolean,
        min_limit_hours numeric, max_limit_hours numeric, specialization text, email text,
        created_at timestamp DEFAULT '2020-01-01', updated_at timestamp DEFAULT '2020-01-01');
      CREATE TEMP TABLE programmes (id int PRIMARY KEY, level text);
      CREATE TEMP TABLE subjects (id int PRIMARY KEY, programme_id int, subject_name text);
      CREATE TEMP TABLE workloads (id int PRIMARY KEY, lecturer_id int, academic_year_id int, status text, total_allocated_hours numeric);
      CREATE TEMP TABLE workload_details (id int PRIMARY KEY, workload_id int, subject_id int, activity_type text, hours_per_week numeric);
    `);
    const reset = () => client.query(`
      TRUNCATE pg_temp.workload_rules, pg_temp.lecturers, pg_temp.programmes, pg_temp.subjects, pg_temp.workloads, pg_temp.workload_details;
      INSERT INTO workload_rules VALUES
        ('PL', 'Programme Leader', 8, 16), ('BACHELOR_ONLY', 'Bachelor only', 12, 20),
        ('DIPLOMA_ONLY', 'Diploma only', 14, 22), ('BOTH', 'Bachelor and Diploma', 13, 21), ('DEFAULT', 'Default', 10, 18);
      INSERT INTO lecturers (id, staff_id, full_name, is_pl, is_active, min_limit_hours, max_limit_hours, specialization, email) VALUES
        (1, '1001', 'Programme Leader', true, true, 1, 40, 'Computer Science', 'pl@example.test'),
        (2, '1002', 'Bachelor Lecturer', false, true, 1, 40, 'Software Engineering', 'bac@example.test'),
        (3, '1003', 'Diploma Lecturer', false, true, 1, 40, 'Mathematics', 'dip@example.test'),
        (4, '1004', 'Both Levels', false, true, 1, 40, 'Information Systems', 'both@example.test'),
        (5, '1005', 'Other Programme', false, true, 1, 40, NULL, 'other@example.test'),
        (6, '1006', 'Inactive Lecturer', false, false, 1, 40, 'Physics', 'inactive@example.test'),
        (7, '1007', 'Already Aligned', false, true, 10, 18, NULL, 'aligned@example.test');
      INSERT INTO programmes VALUES (1, 'Bachelor'), (2, 'diploma'), (3, 'Certificate');
      INSERT INTO subjects VALUES (1, 1, 'Programming'), (2, 2, 'Databases'), (3, 3, 'Other Course');
      INSERT INTO workloads VALUES
        (1, 1, 1, 'APPROVED', 5), (2, 2, 1, 'DRAFT', 3), (3, 3, 1, 'PENDING', 2),
        (4, 4, 1, 'DRAFT', 3), (5, 5, 1, 'DRAFT', 2), (8, 4, 2, 'DRAFT', 2);
      INSERT INTO workload_details VALUES
        (1, 1, 1, 'LECTURE', 3), (2, 1, 2, 'TUTORIAL', 2), (3, 2, 1, 'LECTURE', 3),
        (4, 3, 2, 'LECTURE', 2), (5, 4, 1, 'LECTURE', 3), (6, 8, 2, 'TUTORIAL', 2), (7, 5, 3, 'LECTURE', 2);
    `);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ["workload_rules", "lecturers", "programmes", "subjects", "workloads", "workload_details"]) {
        const order = table === "workload_rules" ? "rule_key" : "id";
        result[table] = (await client.query(`SELECT to_jsonb(r) AS row FROM pg_temp.${table} r ORDER BY ${order}`)).rows;
      }
      return result;
    };
    const profiles = async () => (await client.query(
      "SELECT to_jsonb(l) - ARRAY['min_limit_hours', 'max_limit_hours', 'updated_at'] AS row FROM pg_temp.lecturers l ORDER BY id",
    )).rows;
    const getPlan = async () => {
      const result = await handleApplyHourLimitRules(adapter, { action: "preview" });
      assert.equal(result.status, 200);
      assert.ok("plan" in result.body && result.body.plan);
      return result.body.plan;
    };
    const commit = (previewToken: string) => handleApplyHourLimitRules(adapter, { action: "commit", previewToken });

    await t.test("preview is read-only, includes inactive staff, and resolves PL/Bachelor/Diploma/both/default correctly", async () => {
      await reset();
      const before = await snapshot();
      const plan = await getPlan();
      assert.equal(plan.totalCount, 7);
      assert.equal(plan.changedCount, 6);
      assert.equal(plan.unchangedCount, 1);
      assert.deepEqual(plan.lecturers.map((lecturer) => lecturer.ruleKey), ["PL", "BACHELOR_ONLY", "DIPLOMA_ONLY", "BOTH", "DEFAULT", "DEFAULT", "DEFAULT"]);
      assert.deepEqual(plan.lecturers.map((lecturer) => [lecturer.targetMinHours, lecturer.targetMaxHours]), [[8, 16], [12, 20], [14, 22], [13, 21], [10, 18], [10, 18], [10, 18]]);
      assert.equal(plan.lecturers[5].isActive, false);
      assert.equal(plan.lecturers[6].changed, false);
      assert.equal((await getPlan()).previewToken, plan.previewToken);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("editing a rule alone does not rewrite saved lecturer limits", async () => {
      await reset();
      const before = (await snapshot()).lecturers;
      await client.query("UPDATE pg_temp.workload_rules SET min_hours = 10.25, max_hours = 18.75 WHERE rule_key = 'DEFAULT'");
      const plan = await getPlan();
      assert.equal(plan.lecturers[5].targetMaxHours, 18.75);
      assert.deepEqual((await snapshot()).lecturers, before);
    });

    await t.test("a missing applicable rule aborts the entire preview or reset", async () => {
      await reset();
      const plan = await getPlan();
      await client.query("DELETE FROM pg_temp.workload_rules WHERE rule_key = 'PL'");
      const before = await snapshot();
      for (const result of [await handleApplyHourLimitRules(adapter, { action: "preview" }), await commit(plan.previewToken)]) {
        assert.equal(result.status, 409);
        assert.match("message" in result.body ? result.body.message : "", /missing/);
      }
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("invalid ranges, precision and non-finite rule limits cannot be applied", async () => {
      await reset();
      const plan = await getPlan();
      for (const [min, max] of [[0.49, 18], [10, 45.01], [10.001, 18], [19, 18], ["NaN", 18], [10, "Infinity"], [null, 18]]) {
        await client.query("UPDATE pg_temp.workload_rules SET min_hours = $1, max_hours = $2 WHERE rule_key = 'DEFAULT'", [min, max]);
        const before = await snapshot();
        const result = await commit(plan.previewToken);
        assert.equal(result.status, 409);
        assert.match("message" in result.body ? result.body.message : "", /invalid hour limits/);
        assert.deepEqual(await snapshot(), before);
      }
    });

    await t.test("changed rules, limits, roles, programme levels, status or roster invalidate reviewed previews", async () => {
      const changes = [
        "UPDATE pg_temp.workload_rules SET max_hours = 19 WHERE rule_key = 'DEFAULT'",
        "UPDATE pg_temp.lecturers SET max_limit_hours = 30 WHERE id = 1",
        "UPDATE pg_temp.lecturers SET is_pl = true WHERE id = 2",
        "UPDATE pg_temp.programmes SET level = 'Diploma' WHERE id = 1",
        "UPDATE pg_temp.lecturers SET is_active = true WHERE id = 6",
        "INSERT INTO pg_temp.lecturers (id, staff_id, full_name, is_pl, is_active, min_limit_hours, max_limit_hours) VALUES (8, '1008', 'New Lecturer', false, true, 1, 40)",
      ];
      for (const change of changes) {
        await reset();
        const plan = await getPlan();
        await client.query(change);
        const before = await snapshot();
        assert.equal((await commit(plan.previewToken)).status, 409);
        assert.deepEqual(await snapshot(), before);
      }
    });

    await t.test("a database failure rolls back every changed limit and timestamp", async () => {
      await reset();
      const plan = await getPlan();
      const before = await snapshot();
      await client.query(`
        CREATE FUNCTION pg_temp.reject_limit_update() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.id = 6 THEN RAISE EXCEPTION 'test limit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_limit_update BEFORE UPDATE ON pg_temp.lecturers FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_limit_update();
      `);
      try {
        await assert.rejects(() => commit(plan.previewToken), /test limit failure/);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await client.query("DROP TRIGGER reject_limit_update ON pg_temp.lecturers; DROP FUNCTION pg_temp.reject_limit_update();");
      }
    });

    await t.test("an unexpectedly skipped row also rolls back rather than saving a partial reset", async () => {
      await reset();
      const plan = await getPlan();
      const before = await snapshot();
      await client.query(`
        CREATE FUNCTION pg_temp.skip_limit_update() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.id = 6 THEN RETURN NULL; END IF; RETURN NEW; END $$;
        CREATE TRIGGER skip_limit_update BEFORE UPDATE ON pg_temp.lecturers FOR EACH ROW EXECUTE FUNCTION pg_temp.skip_limit_update();
      `);
      try {
        assert.equal((await commit(plan.previewToken)).status, 409);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await client.query("DROP TRIGGER skip_limit_update ON pg_temp.lecturers; DROP FUNCTION pg_temp.skip_limit_update();");
      }
    });

    await t.test("confirmation updates changed pairs only, preserving profiles, assignments and rules; repeating is a no-op", async () => {
      await reset();
      const plan = await getPlan();
      const before = await snapshot();
      const profilesBefore = await profiles();
      const result = await commit(plan.previewToken);
      assert.equal(result.status, 200);
      assert.ok("updatedCount" in result.body);
      assert.equal(result.body.updatedCount, 6);
      assert.equal(result.body.totalCount, 7);
      const limits = (await client.query("SELECT id, min_limit_hours::float8 AS min, max_limit_hours::float8 AS max, updated_at > '2020-01-01' AS updated FROM pg_temp.lecturers ORDER BY id")).rows;
      assert.deepEqual(limits.map((lecturer) => [lecturer.min, lecturer.max]), plan.lecturers.map((lecturer) => [lecturer.targetMinHours, lecturer.targetMaxHours]));
      assert.deepEqual(limits.map((lecturer) => lecturer.updated), [true, true, true, true, true, true, false]);
      assert.deepEqual(await profiles(), profilesBefore);
      const after = await snapshot();
      for (const table of ["workload_rules", "programmes", "subjects", "workloads", "workload_details"]) assert.deepEqual(after[table], before[table]);
      assert.equal((await commit(plan.previewToken)).status, 409);
      const repeatedPlan = await getPlan();
      assert.equal(repeatedPlan.changedCount, 0);
      const repeated = await commit(repeatedPlan.previewToken);
      assert.equal(repeated.status, 200);
      assert.ok("updatedCount" in repeated.body);
      assert.equal(repeated.body.updatedCount, 0);
      assert.deepEqual(await snapshot(), after);
    });

    await t.test("valid boundaries and two-decimal rule hours are preserved exactly", async () => {
      await reset();
      await client.query("UPDATE pg_temp.workload_rules SET min_hours = 0.5, max_hours = 45 WHERE rule_key = 'PL'; UPDATE pg_temp.workload_rules SET min_hours = 10.25, max_hours = 18.75 WHERE rule_key = 'DEFAULT';");
      const plan = await getPlan();
      assert.equal((await commit(plan.previewToken)).status, 200);
      assert.equal((await getPlan()).changedCount, 0);
    });

    await t.test("an empty roster previews and confirms without updates", async () => {
      await reset();
      await client.query("TRUNCATE pg_temp.lecturers");
      const plan = await getPlan();
      assert.equal(plan.totalCount, 0);
      assert.equal(plan.changedCount, 0);
      const before = await snapshot();
      const result = await commit(plan.previewToken);
      assert.equal(result.status, 200);
      assert.ok("updatedCount" in result.body);
      assert.equal(result.body.updatedCount, 0);
      assert.deepEqual(await snapshot(), before);
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
