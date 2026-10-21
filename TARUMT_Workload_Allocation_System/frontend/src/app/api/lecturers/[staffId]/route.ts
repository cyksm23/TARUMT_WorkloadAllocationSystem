import { NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * PATCH /api/lecturers/:staffId — UC_CPM_01 "maintain lecturer details".
 *
 * Accepts the editable subset of the lecturers record (identity, contact,
 * position, classification, active flag) plus the lecturer's stored
 * workload-limit pair (min/max — written verbatim; paired fields required).
 * Limits are snapshot-stable: rules edits never rewrite them, and stored
 * pairs that drift from the current rule surface a warning badge. The
 * Hour-limit rules ceiling still applies to any saved pair. staff_id is
 * never edited.
 *
 * Dynamic fields are bound as parameters and column names come only from the
 * whitelisted map below, so the SQL built from `updates` stays safe.
 */

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "1234",
  database: process.env.PGDATABASE ?? "teaching_workload_db",
});

const EMPLOYMENT = new Set(["FULL_TIME", "PART_TIME", "CONTRACT"]);

export async function PATCH(
  request: Request,
  { params }: { params: { staffId: string } }
) {
  const { staffId } = params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body) {
    return NextResponse.json(
      { ok: false, message: "Invalid request body." },
      { status: 400 }
    );
  }

  /* full name is mandatory — everything else optional / validated */
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!fullName) {
    return NextResponse.json(
      { ok: false, message: "Full name is required." },
      { status: 400 }
    );
  }

  const employmentType =
    typeof body.employmentType === "string" && EMPLOYMENT.has(body.employmentType)
      ? body.employmentType
      : null;
  if (!employmentType) {
    return NextResponse.json(
      { ok: false, message: "Classification must be full-time, part-time or contract." },
      { status: 400 }
    );
  }

  /* workload-limit pair — the dialog always sends both when limits are shown;
     they write the snapshot-stored pair directly (never auto-updated) */
  let overrideUpdate: { min: number; max: number } | null = null;
  if (body.overrideMin !== undefined || body.overrideMax !== undefined) {
    if (body.overrideMin === undefined || body.overrideMax === undefined) {
      return NextResponse.json(
        { ok: false, message: "Provide both limit values or neither." },
        { status: 400 }
      );
    }
    const isBlank = (v: unknown) => v === null || v === "";
    const mn = Number(body.overrideMin);
    const mx = Number(body.overrideMax);

    if (isBlank(body.overrideMin) || isBlank(body.overrideMax)) {
      return NextResponse.json(
        { ok: false, message: "Limit values cannot be empty — every lecturer keeps a stored pair." },
        { status: 400 }
      );
    } else if (
      !Number.isFinite(mn) ||
      !Number.isFinite(mx) ||
      mn < 0.5 ||
      mx < 0.5 ||
      mn > 45 ||
      mx > 45
    ) {
      return NextResponse.json(
        { ok: false, message: "Hour limits must be between 0.5 and 45 h/wk." },
        { status: 400 }
      );
    } else if (mn > mx) {
      return NextResponse.json(
        { ok: false, message: "Minimum limit cannot exceed maximum limit." },
        { status: 400 }
      );
    } else if (
      Math.abs(mn * 100 - Math.round(mn * 100)) > 1e-6 ||
      Math.abs(mx * 100 - Math.round(mx * 100)) > 1e-6
    ) {
      return NextResponse.json(
        { ok: false, message: "Hours accept at most two decimal places (e.g. 12.50)." },
        { status: 400 }
      );
    } else {
      const cleanMin = Math.round(mn * 100) / 100;
      const cleanMax = Math.round(mx * 100) / 100;

      /* the Hour-limit rules ceiling applies: no override may exceed the
         largest max_hours defined in workload_rules */
      const { rows: ceilingRows } = await pool.query(
        "SELECT COALESCE(MAX(max_hours), 45)::float8 AS ceiling FROM workload_rules"
      );
      const ceiling = Number(ceilingRows[0]?.ceiling ?? 45);
      if (cleanMin > ceiling || cleanMax > ceiling) {
        return NextResponse.json(
          {
            ok: false,
            message: `Cannot save — ${cleanMax > ceiling ? cleanMax : cleanMin}h exceeds the ${ceiling}h maximum set in the Hour-limit rules.`,
          },
          { status: 400 }
        );
      }
      overrideUpdate = { min: cleanMin, max: cleanMax };
    }
  }

  /** ordered values → their $n placeholders, built only from the whitelist */
  const values: unknown[] = [];
  const update = (column: string, value: unknown) => {
    values.push(value);
    return `${column} = $${values.length}`;
  };

  const text = (field: string) =>
    typeof body[field] === "string" && (body[field] as string).trim()
      ? (body[field] as string).trim()
      : null;

  const sql = [
    update("full_name", fullName),
    update("email", text("email")),
    update("phone_number", text("phone")),
    update("position", text("position")),
    update("employment_type", employmentType),
    update("is_pl", body.isPl === true),
    update("is_active", body.isActive !== false),
    /* snapshot limit pair arrives together — write both columns in one pass */
    ...(overrideUpdate
      ? [
          update("min_limit_hours", overrideUpdate.min),
          update("max_limit_hours", overrideUpdate.max),
        ]
      : []),
    "updated_at = NOW()",
  ].join(", ");

  try {
    const result = await pool.query(
      `UPDATE lecturers SET ${sql} WHERE staff_id = $${values.length + 1} RETURNING staff_id`,
      [...values, staffId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { ok: false, message: "Lecturer not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, staffId });
  } catch (err) {
    /* unique_violation (23505) — the roster email is already taken */
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, message: "That email is already used by another staff member." },
        { status: 409 }
      );
    }
    console.error("PATCH /api/lecturers/[staffId] failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while saving lecturer." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/lecturers/:staffId — remove a staff record (fallback twin of
 * the Express backend). A hard delete from the roster; FK violations
 * (still-linked workloads/assignments) surface as 409 with a deactivation
 * suggestion instead of silently losing data.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { staffId: string } }
) {
  const staffId = typeof params.staffId === "string" ? params.staffId.trim() : "";
  if (!/^\d{4}$/.test(staffId)) {
    return NextResponse.json(
      { ok: false, message: "Staff ID must be exactly 4 digits." },
      { status: 400 }
    );
  }
  try {
    /* workloads.lecturer_id is ON DELETE CASCADE — a blind delete would
       silently erase the lecturer's workload rows. Refuse first and point
       at the soft (inactive) path instead. */
    const linked = await pool.query(
      "SELECT COUNT(*)::int AS refs FROM workloads WHERE lecturer_id = (SELECT id FROM lecturers WHERE staff_id = $1)",
      [staffId]
    );
    const refs = Number(linked.rows[0]?.refs ?? 0);
    if (refs > 0) {
      return NextResponse.json(
        {
          ok: false,
          message: `Staff ${staffId} still has ${refs} linked workload row(s) — set them inactive instead of deleting.`,
        },
        { status: 409 }
      );
    }

    const result = await pool.query(
      "DELETE FROM lecturers WHERE staff_id = $1 RETURNING staff_id",
      [staffId]
    );
    if (result.rowCount === 0) {
      return NextResponse.json(
        { ok: false, message: `No staff member "${staffId}".` },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, staffId });
  } catch (err) {
    if ((err as { code?: string }).code === "23503") {
      return NextResponse.json(
        {
          ok: false,
          message: `Staff ${staffId} still has linked records (workloads or assignments) — deactivate them instead of deleting.`,
        },
        { status: 409 }
      );
    }
    console.error("DELETE /api/lecturers/[staffId] failed:", err);
    return NextResponse.json(
      { ok: false, message: "Database error while deleting the lecturer." },
      { status: 500 }
    );
  }
}
