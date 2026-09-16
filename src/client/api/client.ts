// Shared fetch shape for server reads. Playback commands stay on the WebSocket
// session; Query never issues them.
export type ApiCredentials = { origin: string; token: string };

export async function apiFetch({ origin, token }: ApiCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Request failed: ${path}`);
  return response;
}
