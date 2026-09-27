import { loadedBuild } from "../../shared/build";

// Playback commands remain on the session WebSocket. Query owns server reads;
// SessionGate owns and retires its QueryClient when connection/authority changes.
export type ApiCredentials = { origin: string; token: string; sessionMode?: "household" | "personal"; playbackId?: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) { super(message); }
}

export async function apiFetch({ origin, token, sessionMode, playbackId }: ApiCredentials, path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const headers = new Headers(init.headers);
  if (playbackId) headers.set("X-Couch-Playback", playbackId);
  else headers.delete("X-Couch-Playback");
  if (!playbackId && sessionMode === "personal") headers.set("X-Couch-Session", "personal");
  else headers.delete("X-Couch-Session");
  headers.set("Authorization", `Bearer ${token}`);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const response = await fetch(`${origin}${path}`, { ...init, headers, signal });
  signal.throwIfAborted();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed: ${path}`, response.status, body);
  }
  return response;
}

// JSON request helpers keep call sites to the path and body.
export const apiJson = <T,>(credentials: ApiCredentials, path: string, init?: RequestInit, timeoutMs?: number) =>
  apiFetch(credentials, path, init, timeoutMs).then(response => (response.status === 204 ? undefined : response.json()) as Promise<T>);

export const apiSend = <T = unknown,>(credentials: ApiCredentials, path: string, body?: unknown, method = "POST", timeoutMs?: number) =>
  apiJson<T>(credentials, path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }, timeoutMs);

// The native frontend confirms which build it loaded before maintenance can proceed.
export const acknowledgeFrontend = (credentials: ApiCredentials, signal: AbortSignal, timeoutMs: number) =>
  apiFetch(credentials, "/api/maintenance/frontend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ build: loadedBuild }), signal }, timeoutMs);
