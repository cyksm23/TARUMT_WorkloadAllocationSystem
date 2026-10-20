import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * GET  /api/workload-rules — list the editable role/course hour-limit rules.
 * PATCH /api/workload-rules — update min/max pairs per rule (editable table).
 *
 * A lecturer's limits are NOT stored per lecturer: they resolve from role
 * (Programme Leader) and the programme levels actually taught
 * (Bachelor only / Diploma only / both). These rules hold the min/max
 * pairs that resolution produces, editable here.
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

const LIMIT_MAX = 45; /* hard ceiling for any editable hourly boundary (h/wk) */

export async function GET() {
  try {
    const { rows } = await getPool().query(`
      SELECT rule_key, label, basis, priority, min_hours, max_hours
        FROM workload_rules
       ORDER BY priority, rule_key
    `);
    return NextResponse.json({
      ok: true,
      rules: rows.map((r) => ({
        ruleKey: r.rule_key,
        label: r.label,
        basis: r.basis,
        priority: r.priority,
        minHours: Number(r.min_hours),
        maxHours: Number(r.max_hours),
      })),
    });
  } catch (err) {
    console.error("GET /api/workload-rules failed", err);
    return NextResponse.json(
      { ok: false, message: "Hour-limit rules unavailable." },
      { status: 500 }
    );
  }
}

interface RuleUpdate {
  ruleKey?: unknown;
  minHours?: unknown;
  maxHours?: unknown;
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { updates?: RuleUpdate[] } | null;
  if (!body || !Array.isArray(body.updates) || body.updates.length === 0) {
    return NextResponse.json(
      { ok: false, message: "No rule updates provided." },
      { status: 400 }
    );
  }

  /* validate every row before touching the DB */
  const parsed: { ruleKey: string; minHours: number; maxHours: number }[] = [];
  for (const u of body.updates) {
    const ruleKey = typeof u.ruleKey === "string" ? u.ruleKey.trim() : "";
    const min = Number(u.minHours);
    const max = Number(u.maxHours);

    if (!ruleKey || ruleKey.length > 30) {
      return NextResponse.json({ ok: false, message: "Invalid rule key." }, { status: 400 });
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return NextResponse.json(
        { ok: false, message: "Min and max must be numbers." },
        { status: 400 }
      );
    }
    if (min < 0.5 || max < 0.5 || min > LIMIT_MAX || max > LIMIT_MAX) {
      return NextResponse.json(
        { ok: false, message: "Hour limits must be between 0.5 and 45 h/wk." },
        { status: 400 }
      );
    }
    if (
      Math.abs(min * 100 - Math.round(min * 100)) > 1e-6 ||
      Math.abs(max * 100 - Math.round(max * 100)) > 1e-6
    ) {
      return NextResponse.json(
        { ok: false, message: "Hours accept at most two decimal places (e.g. 12.50)." },
        { status: 400 }
      );
    }
    if (min > max) {
      return NextResponse.json(
        { ok: false, message: `Rule ${ruleKey}: minimum cannot exceed maximum.` },
        { status: 400 }
      );
    }
    parsed.push({
      ruleKey,
      minHours: Math.round(min * 100) / 100,
      maxHours: Math.round(max * 100) / 100,
    });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const r of parsed) {
      const res = await client.query(
        `UPDATE workload_rules
            SET min_hours = $1, max_hours = $2, updated_at = NOW()
          WHERE rule_key = $3
          RETURNING rule_key`,
        [r.minHours, r.maxHours, r.ruleKey]
      );
      if (res.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, message: `Unknown rule "${r.ruleKey}".` },
          { status: 404 }
        );
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, updated: parsed.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("PATCH /api/workload-rules failed", err);
    return NextResponse.json(
      { ok: false, message: "Database error while saving rules." },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
