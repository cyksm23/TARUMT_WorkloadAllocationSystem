import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Same-origin fallback twin of backend-express routes/programmes.ts
 * (PATCH + DELETE /api/programmes/:code). Programme codes are immutable;
 * the whitelist column map decides exactly which fields reach the SQL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** accepted programme levels — mirrors the seed data's level vocabulary */
const LEVELS = new Set(["Bachelor", "Master", "Diploma", "Foundation"]);

const PROGRAMME_COLUMNS: Array<{
  key: string;
  column: string;
  cast: (v: unknown) => unknown | null;
}> = [
  { key: "programmeName", column: "programme_name", cast: (v) => (typeof v === "string" && v.trim() ? v.trim() : null) },
  { key: "level", column: "level", cast: (v) => (typeof v === "string" && LEVELS.has(v) ? v : null) },
  {
    key: "durationYears",
    column: "duration_years",
    cast: (v) => {
      const d = Number(v);
      return Number.isInteger(d) && d >= 1 && d <= 8 ? d : null;
    },
  },
  { key: "isActive", column: "is_active", cast: (v) => (typeof v === "boolean" ? v : null) },
];

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

export async function PATCH(request: Request, { params }: { params: { code: string } }) {
  const code = typeof params.code === "string" ? params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code)) {
    return NextResponse.json(
      { ok: false, message: "Programme code must be 2–10 letters or digits." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const sets: string[] = [];
  const params_: unknown[] = [];
  let departmentCode: string | null = null;

  for (const field of PROGRAMME_COLUMNS) {
    if (!(field.key in body)) continue;
    /* an explicit null on the nullable `level` clears it; other fields
       skip so a bad value never wipes existing data */
    if (field.key === "level" && body.level === null) {
      params_.push(null);
      sets.push(`${field.column} = $${params_.length}`);
      continue;
    }
    const value = field.cast(body[field.key]);
    if (value === null) continue;
    params_.push(value);
    sets.push(`${field.column} = $${params_.length}`);
  }

  if (typeof body.departmentCode === "string" && body.departmentCode.trim()) {
    departmentCode = body.departmentCode.trim().toUpperCase();
  }

  if (sets.length === 0 && !departmentCode) {
    return NextResponse.json({ ok: false, message: "No editable fields supplied." }, { status: 400 });
  }

  try {
    if (departmentCode) {
      const depRows = await getPool().query(
        "SELECT id FROM departments WHERE department_code = $1 LIMIT 1",
        [departmentCode],
      );
      const dep = depRows.rows[0] as { id: number } | undefined;
      if (!dep) {
        return NextResponse.json(
          { ok: false, message: `Unknown department "${departmentCode}".` },
          { status: 400 },
        );
      }
      params_.push(dep.id);
      sets.push(`department_id = $${params_.length}`);
    }

    params_.push(code);
    const result = await getPool().query(
      `UPDATE programmes SET ${sets.join(", ")} WHERE programme_code = $${params_.length} RETURNING programme_code`,
      params_,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, message: `No programme "${code}".` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, programmeCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, message: "That programme code is already registered." },
        { status: 409 },
      );
    }
    console.error("PATCH /api/programmes/:code failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while saving the programme." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { code: string } }) {
  const code = typeof params.code === "string" ? params.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code)) {
    return NextResponse.json(
      { ok: false, message: "Programme code must be 2–10 letters or digits." },
      { status: 400 },
    );
  }
  try {
    const linked = await getPool().query(
      "SELECT COUNT(*)::int AS refs FROM subjects WHERE programme_id = (SELECT id FROM programmes WHERE programme_code = $1)",
      [code],
    );
    const refs = Number(linked.rows[0]?.refs ?? 0);
    if (refs > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: `Programme ${code} still has ${refs} course(s) — reassign or remove its courses first.`,
        },
        { status: 409 },
      );
    }

    const result = await getPool().query(
      "DELETE FROM programmes WHERE programme_code = $1 RETURNING programme_code",
      [code],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, message: `No programme "${code}".` }, { status: 404 });
    }
    return NextResponse.json({ ok: true, programmeCode: code });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return NextResponse.json(
        {
          ok: false,
          message: `Programme ${code} is still referenced by other records — it cannot be deleted.`,
        },
        { status: 409 },
      );
    }
    console.error("DELETE /api/programmes/:code failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while deleting the programme." },
      { status: 500 },
    );
  }
}
