"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { FileText } from "lucide-react";

/** Report Generation — Overtime & Reporting module. */
export default function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Reports"
      module="Overtime & Reporting"
      description="Comprehensive workload summary reports and overtime claim documents, printable or downloadable as PDF, for official administrative submission and personal record-keeping by Programme Leaders and lecturers."
      icon={FileText}
    />
  );
}
