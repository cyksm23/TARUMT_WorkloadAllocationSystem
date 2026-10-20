"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { Columns2 } from "lucide-react";

/** Class Splitting — Workload Management module. */
export default function ClassSplittingPage() {
  return (
    <ModulePlaceholder
      title="Class Splitting"
      module="Workload Management"
      description="Practical classes exceeding twenty-eight students and tutorial classes exceeding thirty-six students are automatically divided into two sections, so class sizes stay within the effective teaching range without manual counting. Confirm proposed splits before they are stored."
      icon={Columns2}
    />
  );
}
