import "dotenv/config";
import express from "express";
import authRouter from "./routes/auth";
import classSizesRouter from "./routes/class-sizes";
import coursesRouter from "./routes/courses";
import dashboardRouter from "./routes/dashboard";
import lecturersRouter from "./routes/lecturers";
import programmesRouter from "./routes/programmes";
import rulesRouter from "./routes/rules";

/**
 * backend-express — the separated REST API of the TARUMT Workload
 * Allocation System (single API port: 8000).
 *
 * Layer contract, matching the report's architecture figure:
 *   Next.js frontend (port 3000)  ──HTTP/JSON──▶  this service (port 8000)
 *                                                ──pg parameterised queries──▶  Postgres :5432
 */

const app = express();

/* ── dev CORS: allow the Next.js dev origin(s) + preflight for PATCH ─────── */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (typeof origin === "string" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }
  return next();
});

/* ── body parsing + health probe ──────────────────────────────────────────── */
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "backend-express", time: new Date().toISOString() });
});

/* ── feature routes (ported 1:1 from the Next.js route handlers) ─────────── */
app.use("/api/auth", authRouter);
app.use("/api/class-size-rules", classSizesRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/lecturers", lecturersRouter);
app.use("/api/programmes", programmesRouter);
app.use("/api/workload-rules", rulesRouter);

/* ── error guard: bad JSON → 400, anything else → 500 ────────────────────── */
app.use(
  (
    err: Error & { type?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return res.status(400).json({ ok: false, message: "Invalid request body." });
    }
    console.error("[backend-express] unhandled error:", err);
    return res.status(500).json({ ok: false, message: "Internal server error." });
  },
);

const PORT = Number(process.env.PORT || 8000);
app.listen(PORT, () => {
  console.log(`[backend-express] REST API listening on http://localhost:${PORT}`);
});

export default app;
