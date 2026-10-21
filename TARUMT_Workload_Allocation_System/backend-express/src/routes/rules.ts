/**
 * GET   /api/workload-rules — list the editable role/course hour-limit rules.
 * PATCH /api/workload-rules — update min/max pairs per rule (editable table).
 *
 * Ported 1:1 from frontend/src/app/api/workload-rules/route.ts.
 *
 * A lecturer's env limits resolve from role (Programme Leader) and the
 * programme levels actually taught (Bachelor only / Diploma only / both);
 * these rules hold the min/max pairs that resolution produces, editable here.
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

const LIMIT_MAX = 45; /* hard ceiling for any editable hourly boundary (h/wk) */

router.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query(`
      SELECT rule_key, label, basis, priority, min_hours, max_hours
        FROM workload_rules
       ORDER BY priority, rule_key
    `);
    return res.status(200).json({
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
    return res.status(500).json({ ok: false, message: "Hour-limit rules unavailable." });
  }
});

interface RuleUpdate {
  ruleKey?: unknown;
  minHours?: unknown;
  maxHours?: unknown;
}

router.patch("/", async (req: Request, res: Response) => {
  const body = (req.body ?? null) as { updates?: RuleUpdate[] } | null;
  if (!body || !Array.isArray(body.updates) || body.updates.length === 0) {
    return res.status(400).json({ ok: false, message: "No rule updates provided." });
  }

  /* validate every row before touching the DB */
  const parsed: { ruleKey: string; minHours: number; maxHours: number }[] = [];
  for (const u of body.updates) {
    const ruleKey = typeof u.ruleKey === "string" ? u.ruleKey.trim() : "";
    const min = Number(u.minHours);
    const max = Number(u.maxHours);

    if (!ruleKey || ruleKey.length > 30) {
      return res.status(400).json({ ok: false, message: "Invalid rule key." });
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return res
        .status(400)
        .json({ ok: false, message: "Min and max must be numbers." });
    }
    if (min < 0.5 || max < 0.5 || min > LIMIT_MAX || max > LIMIT_MAX) {
      return res
        .status(400)
        .json({ ok: false, message: "Hour limits must be between 0.5 and 45 h/wk." });
    }
    if (
      Math.abs(min * 100 - Math.round(min * 100)) > 1e-6 ||
      Math.abs(max * 100 - Math.round(max * 100)) > 1e-6
    ) {
      return res.status(400).json({
        ok: false,
        message: "Hours accept at most two decimal places (e.g. 12.50).",
      });
    }
    if (min > max) {
      return res
        .status(400)
        .json({ ok: false, message: `Rule ${ruleKey}: minimum cannot exceed maximum.` });
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
      const q = await client.query(
        `UPDATE workload_rules
            SET min_hours = $1, max_hours = $2, updated_at = NOW()
          WHERE rule_key = $3
          RETURNING rule_key`,
        [r.minHours, r.maxHours, r.ruleKey]
      );
      if (q.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, message: `Unknown rule "${r.ruleKey}".` });
      }
    }
    await client.query("COMMIT");
    return res.status(200).json({ ok: true, updated: parsed.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("PATCH /api/workload-rules failed", err);
    return res.status(500).json({ ok: false, message: "Database error while saving rules." });
  } finally {
    client.release();
  }
});

export default router;
