import type { RadioProgrammeDetails } from "../shared/radio";
import { radioHttpUrl } from "./radio-playlists";

const endpoint = "https://radio.avoid.quest/api/radio-metadata";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      size += value.length;
      if (size > 64 * 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

function programme(value: unknown, stationId: string, streamUrl: string, now: number): RadioProgrammeDetails | null {
  if (!object(value) || value.ok !== true || !object(value.data)) return null;
  const data = value.data;
  if (radioHttpUrl(data.streamUrl) !== streamUrl || typeof data.title !== "string" || !data.title.trim() || data.title.length > 500
    || typeof data.sampledAt !== "number" || !Number.isFinite(data.sampledAt) || data.sampledAt > now + 60_000
    || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt <= data.sampledAt || data.expiresAt > now + 24 * 60 * 60_000) return null;
  const artworkUrl = radioHttpUrl(data.artworkUrl);
  const programmeUrl = radioHttpUrl(data.itemUrl);
  const description = typeof data.stationDescription === "string" && data.stationDescription.length <= 10_000 ? data.stationDescription.trim() : "";
  return { stationId, provider: "radio.avoid.quest", title: data.title.trim(), sampledAt: data.sampledAt, expiresAt: data.expiresAt,
    ...(artworkUrl ? { artworkUrl } : {}), ...(programmeUrl ? { programmeUrl } : {}), ...(description ? { description } : {}) };
}

type Result = { programme: RadioProgrammeDetails | null; retryAt: number };

// The provider owns station-specific retrieval and caching. This hub shares its
// validated response and anonymous session between discovery and active playback.
export function createRadioMetadata({ fetch: request = globalThis.fetch, now = Date.now, signal }: {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  signal?: AbortSignal;
} = {}) {
  const cache = new Map<string, Result>();
  const pending = new Map<string, Promise<Result>>();
  let cookie: string | undefined;
  let limitedUntil = 0;

  return {
    async get(stationId: string, streamUrl: string, callerSignal?: AbortSignal): Promise<Result> {
      const key = `${stationId}\0${streamUrl}`;
      const cached = cache.get(key);
      if (cached && cached.retryAt > now()) return cached;
      if (limitedUntil > now()) return { programme: null, retryAt: limitedUntil };
      const existing = pending.get(key);
      if (existing) return existing;
      const work = (async () => {
        let result: Result = { programme: null, retryAt: now() + 60_000 };
        try {
          const response = await request(`${endpoint}?${new URLSearchParams({ stationId })}`, {
            redirect: "error", signal: AbortSignal.any([signal, callerSignal, AbortSignal.timeout(10_000)].filter((value): value is AbortSignal => !!value)),
            headers: { Accept: "application/json", "User-Agent": "Couch/0.1", ...(cookie ? { Cookie: cookie } : {}) },
          });
          const sessionCookie = response.headers.getSetCookie().map(value => value.split(";")[0]!).find(value => /^radio_session_id=[A-Za-z0-9_-]{1,200}$/.test(value));
          if (sessionCookie) cookie = sessionCookie;
          if (response.status === 429) {
            const retry = response.headers.get("retry-after");
            const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 60_000;
            limitedUntil = now() + (Number.isFinite(retryMs) ? Math.max(30_000, Math.min(15 * 60_000, retryMs)) : 60_000);
            result.retryAt = limitedUntil;
          }
          if (!response.ok) await response.body?.cancel();
          else {
            const current = programme(await readResponse(response), stationId, streamUrl, now());
            if (current) result = { programme: current, retryAt: current.expiresAt };
          }
        } catch { /* Programme metadata never prevents browsing or audio playback. */ }
        if (!signal?.aborted && !callerSignal?.aborted) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
        }
        return result;
      })().finally(() => { pending.delete(key); });
      pending.set(key, work);
      return work;
    },
  };
}
