"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { ShieldCheck } from "lucide-react";

/** Moderator Assignment — Course & Lab Management module. */
export default function ModeratorsPage() {
  return (
    <ModulePlaceholder
      title="Moderator Assignment"
      module="Course and Lab Management"
      description="Assign a single moderator to each course for coursework quality assurance. The system enforces a ceiling of nine coursework samples per moderator and suggests an alternative moderator when the cap is exceeded."
      icon={ShieldCheck}
    />
  );
}
