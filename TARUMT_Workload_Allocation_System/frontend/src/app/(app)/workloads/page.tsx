"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { Clock } from "lucide-react";

/** Teaching Hour Calculation — Workload Management module. */
export default function WorkloadsPage() {
  return (
    <ModulePlaceholder
      title="Teaching Hours"
      module="Workload Management"
      description="Automatic computation of total teaching hours from the courses assigned to each lecturer, with the institutional thresholds enforced: sixteen hours for Diploma-only and Bachelor-only lecturers, sixteen to seventeen hours for Bachelor-plus-Diploma lecturers, and eleven to twelve hours for Programme Leaders."
      icon={Clock}
    />
  );
}
