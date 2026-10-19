/**
 * PLACEHOLDER SHELL - Top navigation.
 * Final styling: 64px tall, white bg, 1px #E5E5EA bottom border.
 * Future: page title left; active-semester selector + user menu / logout right.
 */
export default function TopNav() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-divider bg-surface px-md">
      <span className="text-[16px] font-semibold text-text">TARUMT Workload Allocation System</span>
    </header>
  );
}
