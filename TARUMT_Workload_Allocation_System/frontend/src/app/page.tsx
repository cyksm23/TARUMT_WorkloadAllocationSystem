import { redirect } from "next/navigation";

/**
 * Root route — forwards "/" to the login page.
 * (The scaffold created pages only under /login, /dashboard, etc.)
 */
export default function RootPage() {
  redirect("/login");
}
