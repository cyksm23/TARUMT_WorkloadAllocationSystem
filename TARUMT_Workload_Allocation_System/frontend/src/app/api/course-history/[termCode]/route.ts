import { NextResponse } from "next/server";
import {
  CourseHistoryError,
  getCourseHistoryPool,
  loadCourseHistoryTerm,
} from "@/lib/server/course-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same-origin fallback for GET /api/course-history/:termCode. */
export async function GET(request: Request, { params }: { params: { termCode: string } }) {
  try {
    const programmeCode = new URL(request.url).searchParams.get("programmeCode");
    const detail = await loadCourseHistoryTerm(
      getCourseHistoryPool(),
      params.termCode,
      programmeCode,
    );
    return NextResponse.json({ ok: true, ...detail });
  } catch (error) {
    if (error instanceof CourseHistoryError) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/course-history/:termCode fallback failed:", error);
    return NextResponse.json(
      { ok: false, message: "Course history is unavailable." },
      { status: 500 },
    );
  }
}
