"use client";

import ModulePlaceholder from "@/components/layout/ModulePlaceholder";
import { Coins } from "lucide-react";

/** OT Claim Calculation — Overtime & Reporting module. */
export default function OtClaimsPage() {
  return (
    <ModulePlaceholder
      title="OT Claims"
      module="Overtime & Reporting"
      description="Automatically determine overtime eligibility and compute the claim amount when a lecturer's total teaching hours surpass the institutional threshold, referencing the lecturer's annual entitlement to derive excess hours and monetary compensation."
      icon={Coins}
    />
  );
}
