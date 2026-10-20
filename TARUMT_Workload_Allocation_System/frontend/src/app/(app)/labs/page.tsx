"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { FlaskConical } from "lucide-react";

/** Lab Management — Course & Lab Management module. */
export default function LabsPage() {
  return (
    <ModulePlaceholder
      title="Lab Management"
      module="Course and Lab Management"
      description="Schedule and track laboratory sessions across the three designated categories — Laboratory 1, Laboratory 2 and Third Remarks — and ensure practical sessions are assigned to qualified lecturers with maintained schedules."
      icon={FlaskConical}
    />
  );
}
