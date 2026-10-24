import { NextResponse } from "next/server";
import { Pool } from "pg";
import { handleApplyHourLimitRules } from "@/lib/server/lecturer-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let pool: Pool | null = null;
const getPool = () => {
  if (!pool) pool = new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "teaching_workload_db",
    connectionTimeoutMillis: 4000,
    max: 4,
  });
  return pool;
};

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  try {
    const result = await handleApplyHourLimitRules(getPool(), body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("POST /api/lecturers/apply-hour-limit-rules failed:", error);
    return NextResponse.json({ ok: false, message: "Workload limits could not be updated. No partial reset was saved." }, { status: 500 });
  }
}
