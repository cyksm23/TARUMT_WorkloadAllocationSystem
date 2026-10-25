import { NextResponse } from "next/server";
import { getCourseHistoryPool, loadCourseHistoryTerms } from "@/lib/server/course-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same-origin fallback for GET /api/course-history. */
export async function GET() {
  try {
    const terms = await loadCourseHistoryTerms(getCourseHistoryPool());
    return NextResponse.json({ ok: true, terms });
  } catch (error) {
    console.error("GET /api/course-history fallback failed:", error);
    return NextResponse.json(
      { ok: false, message: "Course history is unavailable." },
      { status: 500 },
    );
  }
}
