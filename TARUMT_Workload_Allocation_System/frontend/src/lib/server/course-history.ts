import { Pool } from "pg";

export {
  CourseHistoryError,
  loadCourseHistoryTerm,
  loadCourseHistoryTerms,
} from "../../../../backend-express/src/services/course-history";
export type {
  CourseHistoryAssignment,
  CourseHistoryProgramme,
  CourseHistorySlot,
  CourseHistoryTermDetail,
  CourseHistoryTermSummary,
  TeachingActivity,
} from "../../../../backend-express/src/services/course-history";

let pool: Pool | null = null;

/** Shared PostgreSQL pool used only by the same-origin Course History fallback. */
export function getCourseHistoryPool(): Pool {
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
