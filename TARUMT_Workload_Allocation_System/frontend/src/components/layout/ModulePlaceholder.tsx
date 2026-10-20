"use client";

/**
 * MODULE PLACEHOLDER — shared body for in-system pages whose workbench is not
 * built yet. Renders the theme page heading (24/600) + a description card with
 * the FYP module name it will implement. Keeps every route alive inside the
 * AppShell while the real module screens are developed sprint by sprint.
 */

import type { LucideIcon } from "lucide-react";
import FadeContent from "@/components/animations/FadeContent";

interface ModulePlaceholderProps {
  title: string;
  /** The functional module this page implements (docx Table 1.4.1.1). */
  module: string;
  description: string;
  icon: LucideIcon;
}

export default function ModulePlaceholder({
  title,
  module,
  description,
  icon: Icon,
}: ModulePlaceholderProps) {
  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <FadeContent>
        <h1 className="text-[24px] font-semibold tracking-[-0.01em] text-text">{title}</h1>
        <p className="mt-xs text-[13px] text-textSecondary">
          Module: {module} · current sprint target
        </p>
      </FadeContent>

      <FadeContent delay={0.08}>
        <div className="mt-lg rounded-card bg-surface p-lg shadow-card">
          <div className="flex items-start gap-md">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-button bg-primaryLight">
              <Icon size={22} className="text-primary" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-sm">
                <h2 className="text-[16px] font-semibold text-text">{title} workbench</h2>
                <span className="rounded-badge bg-primaryLight px-sm py-[2px] text-[11px] font-semibold text-primary">
                  Planned module
                </span>
              </div>
              <p className="mt-sm max-w-[640px] text-[14px] leading-[24px] text-textNormal">
                {description}
              </p>
              <p className="mt-sm text-[13px] text-textSecondary">
                The allocation engine, tables and forms for this module arrive in the
                next sprint — the sidebar navigation, shell and role gate are already
                wired for it.
              </p>
            </div>
          </div>
        </div>
      </FadeContent>
    </div>
  );
}
