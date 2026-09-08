import type { RadioProgramme, SessionState } from "../shared/protocol";
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

function programme(value: unknown, playbackId: string, stationId: string, streamUrl: string, now: number): RadioProgramme | null {
  if (!object(value) || value.ok !== true || !object(value.data)) return null;
  const data = value.data;
  if (radioHttpUrl(data.streamUrl) !== streamUrl || typeof data.title !== "string" || !data.title.trim() || data.title.length > 500
    || typeof data.sampledAt !== "number" || !Number.isFinite(data.sampledAt) || data.sampledAt > now + 60_000
    || typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt <= data.sampledAt || data.expiresAt > now + 24 * 60 * 60_000) return null;
  const artworkUrl = radioHttpUrl(data.artworkUrl);
  return { playbackId, stationId, provider: "radio.avoid.quest", title: data.title.trim(), sampledAt: data.sampledAt, expiresAt: data.expiresAt, ...(artworkUrl ? { artworkUrl } : {}) };
}

// One active-station request serves the TV and every controller. All station
// configuration, retrieval and shared caching stay with radio.avoid.quest.
export function createRadioProgramme({ station, publish, fetch: request = globalThis.fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout }: {
  station: (source: string) => { id: string; streamUrl: string } | null;
  publish: (playbackId: string, programme: RadioProgramme | null) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}) {
  let active: { playbackId: string; stationId: string; streamUrl: string; controller: AbortController } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cookie: string | undefined;
  let loaded: { playbackId: string; source: string; streamUrl: string } | null = null;
  let closed = false;
  const stop = () => { active?.controller.abort(); active = null; if (timer) cancel(timer); timer = undefined; };

  async function refresh(current: NonNullable<typeof active>) {
    let delay = 60_000;
    const valid = () => !closed && active === current && !current.controller.signal.aborted;
    if (!valid()) return;
    try {
      const response = await request(`${endpoint}?${new URLSearchParams({ stationId: current.stationId })}`, {
        redirect: "error", signal: AbortSignal.any([current.controller.signal, AbortSignal.timeout(10_000)]),
        headers: { Accept: "application/json", "User-Agent": "Couch/0.1", ...(cookie ? { Cookie: cookie } : {}) },
      });
      if (!valid()) { await response.body?.cancel(); return; }
      // The service's anonymous rate-limit cookie belongs only to this hub.
      const sessionCookie = response.headers.getSetCookie().map(value => value.split(";")[0]!).find(value => /^radio_session_id=[A-Za-z0-9_-]{1,200}$/.test(value));
      if (sessionCookie) cookie = sessionCookie;
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 60_000;
        if (Number.isFinite(retryMs)) delay = Math.max(30_000, Math.min(15 * 60_000, retryMs));
      }
      if (!response.ok) { await response.body?.cancel(); return; }
      const result = programme(await readResponse(response), current.playbackId, current.stationId, current.streamUrl, now());
      if (!valid()) return;
      if (result) { delay = result.expiresAt - now(); publish(current.playbackId, result); }
    } catch { /* Programme metadata never interrupts native audio playback. */ }
    finally {
      if (valid()) timer = schedule(() => {
        timer = undefined;
        publish(current.playbackId, null);
        void refresh(current);
      }, Math.max(1, delay));
    }
  }

  return {
    load(playbackId: string, source: string, streamUrl: string) { loaded = { playbackId, source, streamUrl }; },
    observe(state: SessionState) {
      if (closed) return;
      const source = state.queue.find(entry => entry.id === state.currentEntryId)?.source;
      const candidate = source && loaded?.source === source && loaded.playbackId === state.player.playbackId && ["playing", "paused"].includes(state.player.status) ? station(source) : null;
      const id = candidate?.streamUrl === loaded?.streamUrl ? candidate : null;
      if (active?.playbackId === state.player.playbackId && active?.stationId === id?.id && active?.streamUrl === id?.streamUrl) return;
      const previous = active;
      stop();
      if (id && state.player.playbackId) active = { playbackId: state.player.playbackId, stationId: id.id, streamUrl: id.streamUrl, controller: new AbortController() };
      if (previous) publish(previous.playbackId, null);
      if (active) void refresh(active);
    },
    close() { closed = true; stop(); cookie = undefined; loaded = null; },
  };
}
