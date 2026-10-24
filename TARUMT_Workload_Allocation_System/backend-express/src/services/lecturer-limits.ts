import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { lockAssignmentWrites } from "./auto-assignment-service";

interface LimitRule {
  ruleKey: string;
  label: string;
  minHours: number;
  maxHours: number;
}

interface ResolvedLecturer {
  id: number;
  staffId: string;
  fullName: string;
  isActive: boolean;
  ruleKey: string;
  minHours: number;
  maxHours: number;
}

export interface LecturerLimitChange extends ResolvedLecturer {
  ruleLabel: string;
  targetMinHours: number;
  targetMaxHours: number;
  changed: boolean;
}

export interface ApplyHourLimitRulesPlan {
  previewToken: string;
  totalCount: number;
  changedCount: number;
  unchangedCount: number;
  lecturers: LecturerLimitChange[];
}

class LimitApplyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function parseRequest(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new LimitApplyError(400, "Invalid request body.");
  const body = raw as Record<string, unknown>;
  if (body.action !== "preview" && body.action !== "commit") {
    throw new LimitApplyError(400, "Choose preview or commit before applying hour-limit rules.");
  }
  const previewToken = typeof body.previewToken === "string" ? body.previewToken : null;
  if (body.action === "commit" && (!previewToken || !/^[a-f0-9]{64}$/.test(previewToken))) {
    throw new LimitApplyError(400, "Review and confirm the workload-limit preview before saving.");
  }
  return { action: body.action, previewToken };
}

/** Exactly the directory's rule resolution: PL wins, then the levels taught
 * across saved workloads (Bachelor / Diploma / both), otherwise DEFAULT.
 * All staff are included, regardless of the page's filters or active flag.
 */
async function loadPlan(client: PoolClient, locking: boolean): Promise<ApplyHourLimitRulesPlan> {
  const { rows: rules } = await client.query<LimitRule>(
    `SELECT rule_key AS "ruleKey", label, min_hours::float8 AS "minHours", max_hours::float8 AS "maxHours"
       FROM workload_rules ORDER BY rule_key ${locking ? "FOR SHARE" : ""}`,
  );
  if (locking) await client.query("SELECT id FROM lecturers ORDER BY id FOR UPDATE");
  const { rows } = await client.query<ResolvedLecturer>(`
    WITH taught_levels AS (
      SELECT w.lecturer_id, array_agg(DISTINCT UPPER(p.level)) AS levels
        FROM workloads w JOIN workload_details wd ON wd.workload_id = w.id
        JOIN subjects s ON s.id = wd.subject_id JOIN programmes p ON p.id = s.programme_id
       WHERE p.level IS NOT NULL GROUP BY w.lecturer_id
    )
    SELECT l.id, l.staff_id AS "staffId", l.full_name AS "fullName", l.is_active AS "isActive",
           l.min_limit_hours::float8 AS "minHours", l.max_limit_hours::float8 AS "maxHours",
           CASE WHEN l.is_pl THEN 'PL'
                WHEN 'BACHELOR' = ANY(t.levels) AND 'DIPLOMA' = ANY(t.levels) THEN 'BOTH'
                WHEN 'BACHELOR' = ANY(t.levels) THEN 'BACHELOR_ONLY'
                WHEN 'DIPLOMA' = ANY(t.levels) THEN 'DIPLOMA_ONLY'
                ELSE 'DEFAULT' END AS "ruleKey"
      FROM lecturers l LEFT JOIN taught_levels t ON t.lecturer_id = l.id ORDER BY l.staff_id
  `);
  const lecturers = rows.map((lecturer): LecturerLimitChange => {
    const rule = rules.find((entry) => entry.ruleKey === lecturer.ruleKey);
    if (!rule) throw new LimitApplyError(409, `Hour-limit rule ${lecturer.ruleKey} is missing for ${lecturer.staffId}. No limits were changed.`);
    if (![rule.minHours, rule.maxHours].every((hours) => Number.isFinite(hours) && hours >= 0.5 && hours <= 45 &&
        Math.abs(hours * 100 - Math.round(hours * 100)) <= 0.000001) || rule.minHours > rule.maxHours) {
      throw new LimitApplyError(409, `Rule "${rule.label}" has invalid hour limits. Fix the rule first; no lecturer limits were changed.`);
    }
    return {
      ...lecturer,
      ruleLabel: rule.label,
      targetMinHours: rule.minHours,
      targetMaxHours: rule.maxHours,
      changed: lecturer.minHours !== rule.minHours || lecturer.maxHours !== rule.maxHours,
    };
  });
  const changedCount = lecturers.filter((lecturer) => lecturer.changed).length;
  const previewToken = createHash("sha256").update(JSON.stringify({ rules, lecturers })).digest("hex");
  return { previewToken, totalCount: lecturers.length, changedCount, unchangedCount: lecturers.length - changedCount, lecturers };
}

/** Explicit, confirmed bulk reset only. Editing workload_rules by itself
 * still never rewrites per-lecturer limits. Existing assignments, allocated
 * hours, profile information and the rule definitions are not modified.
 */
export async function handleApplyHourLimitRules(pool: Pick<Pool, "connect">, raw: unknown) {
  let request: ReturnType<typeof parseRequest>;
  try {
    request = parseRequest(raw);
  } catch (error) {
    if (error instanceof LimitApplyError) return { status: error.status, body: { ok: false as const, message: error.message } };
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query(request.action === "preview" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    if (request.action === "commit") await lockAssignmentWrites(client);
    const plan = await loadPlan(client, request.action === "commit");
    if (request.action === "preview") {
      await client.query("COMMIT");
      return { status: 200, body: { ok: true as const, plan } };
    }
    if (request.previewToken !== plan.previewToken) {
      throw new LimitApplyError(409, "Lecturer data or hour-limit rules changed. Reload the preview and confirm again; no limits were changed.");
    }
    const changes = plan.lecturers.filter((lecturer) => lecturer.changed);
    if (changes.length > 0) {
      const result = await client.query(
        `UPDATE lecturers l SET min_limit_hours = change.min_hours, max_limit_hours = change.max_hours, updated_at = NOW()
           FROM unnest($1::int[], $2::numeric[], $3::numeric[]) AS change(id, min_hours, max_hours)
          WHERE l.id = change.id RETURNING l.id`,
        [changes.map((lecturer) => lecturer.id), changes.map((lecturer) => lecturer.targetMinHours), changes.map((lecturer) => lecturer.targetMaxHours)],
      );
      if (result.rowCount !== changes.length) throw new LimitApplyError(409, "The lecturer roster changed. Reload the preview; no partial reset was saved.");
    }
    await client.query("COMMIT");
    return {
      status: 200,
      body: {
        ok: true as const,
        updatedCount: changes.length,
        totalCount: plan.totalCount,
        message: changes.length > 0
          ? `Updated workload limits for ${changes.length} lecturer${changes.length === 1 ? "" : "s"} to their applicable hour-limit rules. ${plan.unchangedCount} already matched. Assignments were unchanged.`
          : `All ${plan.totalCount} lecturer workload limits already match their applicable hour-limit rules.`,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LimitApplyError) return { status: error.status, body: { ok: false as const, message: error.message } };
    if (["40001", "40P01"].includes((error as { code?: string }).code ?? "")) {
      return { status: 409, body: { ok: false as const, message: "Another update is in progress. Reload the preview and try again." } };
    }
    throw error;
  } finally {
    client.release();
  }
}
