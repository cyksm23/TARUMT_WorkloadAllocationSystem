"use client";

import AppShell from "@/components/layout/AppShell";

/**
 * (app) route group — every in-system page (dashboard, modules) renders
 * inside the Programme Leader shell: role gate + sidebar drawer + top nav.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
