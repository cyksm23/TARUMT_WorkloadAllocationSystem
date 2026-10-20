"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { BookOpen } from "lucide-react";

/** Course & Programme Management (imports spec 3.4/UC_CPM_01). */
export default function CoursesPage() {
  return (
    <ModulePlaceholder
      title="Courses & Programmes"
      module="Course and Programme Management"
      description="Create, edit and remove programme and course records with their lecture, tutorial and practical hour components; manage semesters and programme levels. Course codes are validated against existing records before storing."
      icon={BookOpen}
    />
  );
}
