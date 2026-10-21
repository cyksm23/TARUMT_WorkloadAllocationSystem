/**
 * HS256 JWT utilities (dependency-free, identical algorithm & secret policy
 * as the Next.js login handler so tokens stay interchangeable).
 *
 * signJwt  — used by POST /api/auth/login to issue the session token.
 * verifyJwt — parses + signature-checks a bearer token; wired into
 *             middleware later once the frontend sends Authorization
 *             headers on every call (RBAC next step).
 */
import crypto from "crypto";

const SECRET = () => process.env.AUTH_SECRET || "dev-secret-change-me";

const b64url = (s: Buffer | string) =>
  (Buffer.isBuffer(s) ? s : Buffer.from(s))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const b64urlDecode = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function signJwt(payload: Record<string, unknown>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const data = b64url(Buffer.from(JSON.stringify(body)));
  const sig = crypto.createHmac("sha256", SECRET()).update(`${head}.${data}`).digest();
  return `${head}.${data}.${b64url(sig)}`;
}

/** Returns the payload when the signature and expiry check out, else null. */
export function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, data, sigB] = parts;

  const expected = crypto.createHmac("sha256", SECRET()).update(`${head}.${data}`).digest();
  const provided = b64urlDecode(sigB);
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(data).toString("utf8")) as { exp?: number };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
