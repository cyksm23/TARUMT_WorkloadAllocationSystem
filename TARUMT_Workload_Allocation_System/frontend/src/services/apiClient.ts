/**
 * API client — the separated-architecture bridge.
 *
 * Call order (mirrors the login service's try-first-then-fallback pattern):
 *   1. backend-express  `${NEXT_PUBLIC_API_URL}/...`  — the dedicated
 *      Express (TypeScript) REST API on http://localhost:8000/api
 *   2. Next.js route handlers (same-origin `/api/...`) — transitional
 *      fallback so pages keep working while/before the backend runs.
 *
 * Robustness rule learned the hard way: some environments (VPN/system
 * proxy/browser extensions) intercept localhost calls and answer with an
 * HTML page at HTTP 200 — a fetch that neither throws nor looks like JSON.
 * So every attempt is validated by content-type; anything not JSON is
 * treated as an interception and the fallback takes over. If both fail,
 * the collected evidence is thrown so the page can show exactly why.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const evidence: string[] = [];

  async function attempt(url: string, label: string): Promise<Response | null> {
    try {
      const res = await fetch(url, init);
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        evidence.push(
          `${label} answered but not JSON (status ${res.status}, content-type "${contentType || "none"}") — an interceptor (proxy/VPN/extension) likely served an HTML page`
        );
        console.warn(`[apiClient] ${evidence[evidence.length - 1]} for ${url}`);
        return null;
      }
      return res;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      evidence.push(`${label} unreachable (${reason})`);
      console.warn(`[apiClient] ${url} → ${label} failed:`, reason);
      return null;
    }
  }

  const primary = await attempt(`${API_BASE}${path}`, "Express backend");
  if (primary) return primary;

  const fallback = await attempt(path, "Next fallback");
  if (fallback) return fallback;

  throw new Error(evidence.length ? evidence.join(" · ") : "both data sources failed");
}
