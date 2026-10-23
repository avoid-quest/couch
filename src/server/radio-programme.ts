import type { RadioProgramme, SessionState } from "../shared/protocol";
import { createRadioMetadata } from "./radio-metadata";

// Requests and timers belong to each independent Playback. The metadata hub still
// shares downloads when several outputs listen to the same station.
export function createRadioProgramme({ station, publish, fetch: request = globalThis.fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, metadata = createRadioMetadata({ fetch: request, now }) }: {
  station: (source: string) => { id: string; streamUrl: string } | null;
  publish: (playbackId: string, programme: RadioProgramme | null) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  metadata?: Pick<ReturnType<typeof createRadioMetadata>, "get">;
}) {
  type Active = { playbackId: string; stationId: string; streamUrl: string; controller: AbortController; timer?: ReturnType<typeof setTimeout> };
  const active = new Map<string, Active>();
  const loaded = new Map<string, { playbackId: string; source: string; streamUrl: string }>();
  let closed = false;
  function stop(key: string) {
    const current = active.get(key);
    active.delete(key);
    current?.controller.abort();
    if (current?.timer) cancel(current.timer);
    return current;
  }

  async function refresh(key: string, current: Active) {
    let delay = 60_000, expiry = 0;
    const valid = () => !closed && active.get(key) === current && !current.controller.signal.aborted;
    if (!valid()) return;
    try {
      const result = await metadata.get(current.stationId, current.streamUrl, current.controller.signal);
      if (!valid()) return;
      delay = result.retryAt - now();
      expiry = result.programme?.expiresAt ?? 0;
      publish(current.playbackId, result.programme && expiry > now() ? { ...result.programme, playbackId: current.playbackId } : null);
    } catch { /* Programme metadata never interrupts audio playback. */ }
    finally {
      if (valid()) current.timer = schedule(() => {
        current.timer = undefined;
        if (expiry && expiry <= now()) publish(current.playbackId, null);
        void refresh(key, current);
      }, Math.max(1, Math.min(delay, expiry ? expiry - now() : Infinity)));
    }
  }

  return {
    load(playbackId: string, source: string, streamUrl: string, key = "default") { loaded.set(key, { playbackId, source, streamUrl }); },
    observe(state: SessionState, key = "default") {
      if (closed) return;
      const load = loaded.get(key), previous = active.get(key);
      const source = state.queue.find(entry => entry.id === state.currentEntryId)?.source;
      const candidate = source && load?.source === source && load.playbackId === state.player.playbackId && ["playing", "paused"].includes(state.player.status) ? station(source) : null;
      const id = candidate?.streamUrl === load?.streamUrl ? candidate : null;
      if (previous?.playbackId === state.player.playbackId && previous?.stationId === id?.id && previous?.streamUrl === id?.streamUrl) return;
      const stopped = stop(key);
      if (id && state.player.playbackId) {
        const current: Active = { playbackId: state.player.playbackId, stationId: id.id, streamUrl: id.streamUrl, controller: new AbortController() };
        active.set(key, current);
        void refresh(key, current);
      }
      if (stopped) publish(stopped.playbackId, null);
    },
    remove(key: string) { loaded.delete(key); const stopped = stop(key); if (stopped) publish(stopped.playbackId, null); },
    close() { closed = true; for (const key of active.keys()) { const stopped = stop(key); if (stopped) publish(stopped.playbackId, null); } loaded.clear(); },
  };
}
