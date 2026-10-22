/**
 * GET   /api/class-size-rules — the flexible class-size limits for
 *                              TUTORIAL / PRACTICAL classes. A class whose
 *                              headcount exceeds its limit splits into
 *                              groups (the course dialog derives the group
 *                              count from these rules).
 * PATCH /api/class-size-rules — the Programme Leader edits the limits at
 *                              any time; the upsert keeps both rule rows
 *                              complete even without seed data.
 */
import { Router, Request, Response } from "express";
import { getPool } from "../db";

const router = Router();

/* limit sanity: 1–200 students per class (500 hard cap in the DB CHECK) */
const badLimit = (n: number) => !Number.isInteger(n) || n < 1 || n > 200;

/* ── GET /api/class-size-rules ────────────────────────────────────────────── */

router.get("/", async (_req: Request, res: Response) => {
  try {
    const { rows } = await getPool().query(`
      SELECT class_type     AS "classType",
             limit_students AS "limitStudents"
        FROM class_size_rules
       WHERE is_active
       ORDER BY class_type
    `);
    return res.json({ ok: true, rules: rows });
  } catch (err) {
    console.error("GET /api/class-size-rules failed:", err);
    return res.status(500).json({ ok: false, message: "Class-size rules unavailable." });
  }
});

/* ── PATCH /api/class-size-rules ──────────────────────────────────────────── */

router.patch("/", async (req: Request, res: Response) => {
  const body = (req.body ?? null) as Record<string, unknown> | null;
  if (!body) {
    return res.status(400).json({ ok: false, message: "Invalid request body." });
  }

  const wanted: Array<["TUTORIAL" | "PRACTICAL", number]> = [];
  if (body.tutorialLimit !== undefined) {
    const n = Number(body.tutorialLimit);
    if (badLimit(n)) {
      return res
        .status(400)
        .json({ ok: false, message: "Tutorial class limit must be a whole number between 1 and 200." });
    }
    wanted.push(["TUTORIAL", n]);
  }
  if (body.practicalLimit !== undefined) {
    const n = Number(body.practicalLimit);
    if (badLimit(n)) {
      return res
        .status(400)
        .json({ ok: false, message: "Practical class limit must be a whole number between 1 and 200." });
    }
    wanted.push(["PRACTICAL", n]);
  }

  if (wanted.length === 0) {
    return res.status(400).json({ ok: false, message: "No class-size limits supplied." });
  }

  try {
    for (const [classType, limit] of wanted) {
      await getPool().query(
        `INSERT INTO class_size_rules (class_type, limit_students)
         VALUES ($1, $2)
         ON CONFLICT (class_type)
         DO UPDATE SET limit_students = $2, updated_at = NOW()`,
        [classType, limit],
      );
    }

    const { rows } = await getPool().query(`
      SELECT class_type     AS "classType",
             limit_students AS "limitStudents"
        FROM class_size_rules
       WHERE is_active
       ORDER BY class_type
    `);
    return res.json({ ok: true, rules: rows });
  } catch (err) {
    console.error("PATCH /api/class-size-rules failed:", err);
    return res.status(500).json({ ok: false, message: "Database error while saving the class-size rules." });
  }
});

export default router;
