/**
 * PLACEHOLDER SHELL - Sidebar.
 * Final styling: 240-280px wide, bg #FFFFFF, border 1px #E5E5EA,
 * active item: bg #EAF3FF + text #0071E3, hover bg #F5F5F7,
 * Inter Medium 500 / 15px.
 * Future: route-based active highlight, lucide-react icons, collapse.
 */
const menuItems = ["Dashboard", "Lecturers", "Courses", "Allocations", "Workloads", "Reports"];

export default function Sidebar() {
  return (
    <aside className="flex w-[260px] flex-col border-r border-divider bg-surface">
      <div className="flex h-16 items-center border-b border-divider px-md">
        <span className="font-semibold text-text">TARUMT</span>
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-sm">
          {menuItems.map((label) => (
            <li key={label} className="text-[15px] font-medium text-textNormal">
              {label}
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
