"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { History } from "lucide-react";

/** Historical Course Suggestion — Course & Lab Management module. */
export default function SuggestionsPage() {
  return (
    <ModulePlaceholder
      title="Course Suggestion"
      module="Course and Lab Management"
      description="Plan the forthcoming intake by retrieving the allocation records of the corresponding term of the previous academic year (e.g. 202505 for 202605). Suggestions are editable, validated against policy limits before import, and adjusted automatically when lecturers change between years."
      icon={History}
    />
  );
}
