// Playback commands remain on the session WebSocket. Query owns server reads;
// SessionGate owns and retires its QueryClient when connection/authority changes.
export type ApiCredentials = { origin: string; token: string };

export async function apiFetch({ origin, token }: ApiCredentials, path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const response = await fetch(`${origin}${path}`, { ...init, headers, signal });
  signal.throwIfAborted();
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Request failed: ${path}`);
  return response;
}
