"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { Users } from "lucide-react";

/** Lecturer classification management (UC_CPM_01). */
export default function LecturersPage() {
  return (
    <ModulePlaceholder
      title="Lecturers"
      module="Course and Programme Management"
      description="Maintain lecturer records and classifications: department, programme leadership status, employment type (full-time / part-time / contract) and qualification levels, which drive the differentiated hour limits used by the workload engine."
      icon={Users}
    />
  );
}
