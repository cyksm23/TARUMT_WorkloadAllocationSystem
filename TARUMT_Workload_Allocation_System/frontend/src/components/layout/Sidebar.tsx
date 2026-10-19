/**
 * PLACEHOLDER SHELL — Sidebar (theme.docx specs).
 * Width 240px · bg #FFFFFF · right border #E5E5EA.
 * Menu: Inter Medium 500, 15px, #6E6E73 · hover bg #F5F5F7.
 * Active: bg #EAF3FF + text #0071E3.
 * Future: route-based active highlight, collapse, PL/Coordinator section.
 */
import {
  LayoutDashboard,
  Users,
  BookOpen,
  ClipboardList,
  BarChart3,
  FileText,
} from "lucide-react";

const menuItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, active: true },
  { label: "Lecturers", href: "/lecturers", icon: Users },
  { label: "Courses", href: "/courses", icon: BookOpen },
  { label: "Allocations", href: "/allocations", icon: ClipboardList },
  { label: "Workloads", href: "/workloads", icon: BarChart3 },
  { label: "Reports", href: "/reports", icon: FileText },
];

export default function Sidebar() {
  return (
    <aside className="flex w-[240px] flex-col border-r border-divider bg-surface">
      <div className="flex h-16 items-center border-b border-divider px-md">
        <span className="text-[16px] font-semibold text-text">TARUMT · TWS</span>
      </div>
      <nav className="flex-1 space-y-1 p-md">
        {menuItems.map(({ label, href, icon: Icon, active }) => (
          <a
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-sm rounded-button px-md py-sm text-[15px] font-medium transition-colors ${
              active
                ? "bg-primaryLight text-primary"
                : "text-textSecondary hover:bg-background hover:text-text"
            }`}
          >
            <Icon size={18} className="shrink-0" />
            {label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
