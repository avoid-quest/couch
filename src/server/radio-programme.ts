import type { RadioProgramme, SessionState } from "../shared/protocol";
import { createRadioMetadata } from "./radio-metadata";

// One active-station request serves the TV and every controller. All station
// configuration, retrieval and shared caching stay with radio.avoid.quest.
export function createRadioProgramme({ station, publish, fetch: request = globalThis.fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, metadata = createRadioMetadata({ fetch: request, now }) }: {
  station: (source: string) => { id: string; streamUrl: string } | null;
  publish: (playbackId: string, programme: RadioProgramme | null) => void;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  metadata?: ReturnType<typeof createRadioMetadata>;
}) {
  let active: { playbackId: string; stationId: string; streamUrl: string; controller: AbortController } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loaded: { playbackId: string; source: string; streamUrl: string } | null = null;
  let closed = false;
  const stop = () => { active?.controller.abort(); active = null; if (timer) cancel(timer); timer = undefined; };

  async function refresh(current: NonNullable<typeof active>) {
    let delay = 60_000;
    let resultExpiry = 0;
    const valid = () => !closed && active === current && !current.controller.signal.aborted;
    if (!valid()) return;
    try {
      const result = await metadata.get(current.stationId, current.streamUrl, current.controller.signal);
      if (!valid()) return;
      delay = result.retryAt - now();
      resultExpiry = result.programme?.expiresAt ?? 0;
      if (result.programme) publish(current.playbackId, { ...result.programme, playbackId: current.playbackId });
    } catch { /* Programme metadata never interrupts audio playback. */ }
    finally {
      if (valid()) timer = schedule(() => {
        timer = undefined;
        if (resultExpiry && resultExpiry <= now()) publish(current.playbackId, null);
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
    close() { closed = true; stop(); loaded = null; },
  };
}
