import { Router, type Request, type Response } from "express";
import { getPool } from "../db";
import {
  CourseHistoryError,
  loadCourseHistoryTerm,
  loadCourseHistoryTerms,
} from "../services/course-history";

const router = Router();

/** Read-only history of saved whole-course teaching assignments. */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const terms = await loadCourseHistoryTerms(getPool());
    return res.json({ ok: true, terms });
  } catch (error) {
    console.error("GET /api/course-history failed:", error);
    return res.status(500).json({ ok: false, message: "Course history is unavailable." });
  }
});

router.get("/:termCode", async (req: Request, res: Response) => {
  try {
    const detail = await loadCourseHistoryTerm(getPool(), req.params.termCode, req.query.programmeCode);
    return res.json({ ok: true, ...detail });
  } catch (error) {
    if (error instanceof CourseHistoryError) {
      return res.status(error.status).json({ ok: false, message: error.message });
    }
    console.error("GET /api/course-history/:termCode failed:", error);
    return res.status(500).json({ ok: false, message: "Course history is unavailable." });
  }
});

export default router;
