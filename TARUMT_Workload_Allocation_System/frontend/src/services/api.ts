/** Typed fetch wrapper for the PHP API (and the Python engine). */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
const PYTHON_URL = process.env.NEXT_PUBLIC_PYTHON_API_URL ?? "http://localhost:8001/api";

async function request<T>(baseUrl: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(BASE_URL, path),
  post: <T>(path: string, body: unknown) =>
    request<T>(BASE_URL, path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(BASE_URL, path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(BASE_URL, path, { method: "DELETE" }),
};

/** Python engine (OT calc, auto-assign, class split, semester suggestion). */
export const pythonApi = {
  get: <T>(path: string) => request<T>(PYTHON_URL, path),
  post: <T>(path: string, body: unknown) =>
    request<T>(PYTHON_URL, path, { method: "POST", body: JSON.stringify(body) }),
};
