"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { ClipboardList } from "lucide-react";

/** Course Assignment — Workload Management module (docx Table 1.4.1.1). */
export default function AllocationsPage() {
  return (
    <ModulePlaceholder
      title="Course Assignment"
      module="Workload Management"
      description="Assign lecture, tutorial and practical slots of each course to lecturers. The system enforces institutional policy at the point of assignment: maximum three courses per lecturer in degree-level programmes and four in diploma-level programmes, combined per programme and cohort, with hour totals aggregated across programmes."
      icon={ClipboardList}
    />
  );
}
