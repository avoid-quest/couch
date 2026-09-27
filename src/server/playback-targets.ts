import type { PlaybackCommand, PlaybackTarget, PlayerState, SessionState } from "../shared/protocol";
import type { createSession } from "./session";

type Endpoint = { target: PlaybackTarget; send: (command: PlaybackCommand) => void; player: PlayerState; attempts: Set<string> };
type Waiter = { endpoint: Endpoint; accept: (player: PlayerState) => boolean; resolve: (player: PlayerState) => void; reject: (error: Error) => void };
const idle = (volume = 100): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume, seekable: false, error: null });

export function browserCompatible(command: Extract<PlaybackCommand, { type: "load" }>) {
  if (!/^https?:\/\//i.test(command.source) || command.headers && Object.keys(command.headers).length || command.audioSource || command.segment || command.subtitles?.length)
    throw new Error("This source needs media delivery that this browser does not support yet. Keep playing it on Couch TV.");
}

// The connection owns the endpoint. IDs in incoming observations never grant authority.
export function createPlaybackTargets(nativeSend: Endpoint["send"] | undefined, session: () => ReturnType<typeof createSession>, options: { timeout?: number; observeNative?: () => void } = {}) {
  const timeout = options.timeout ?? 8_000;
  const native: Endpoint | undefined = nativeSend ? { target: { id: "native", name: "Couch TV", kind: "endpoint", backend: "native", connected: false }, send: nativeSend, player: idle(), attempts: new Set() } : undefined;
  const endpoints = new Map<string, Endpoint>(native ? [["native", native]] : []);
  const waiters = new Set<Waiter>();
  let assigned = native;
  let busy = false;
  let closed = false;
  const changed = (handoff: SessionState["handoff"] = session().state.handoff ?? null) => { if (!closed) session().updateTargets(assigned?.target.id, [...endpoints.values()].map(endpoint => ({ ...endpoint.target })), handoff); };
  const send = (endpoint: Endpoint, command: PlaybackCommand) => {
    if (closed || !endpoint.target.connected) throw new Error("That playback device disconnected.");
    if (command.type === "load") {
      if (endpoint.target.backend === "browser") browserCompatible(command);
      endpoint.attempts = new Set([command.playbackId]);
    }
    if (command.type === "prepare") endpoint.attempts = new Set([command.playbackId, ...(command.next ? [command.next.playbackId] : [])]);
    endpoint.send(command);
  };
  const wait = (endpoint: Endpoint, command: PlaybackCommand, accept: Waiter["accept"]) => new Promise<PlayerState>((resolve, reject) => {
    const timer = setTimeout(() => waiter.reject(new Error("The playback device did not confirm readiness. Try again.")), timeout);
    const finish = () => { clearTimeout(timer); waiters.delete(waiter); };
    const waiter: Waiter = { endpoint, accept, resolve: player => { finish(); resolve(player); }, reject: error => { finish(); reject(error); } };
    waiters.add(waiter);
    try { send(endpoint, command); if (endpoint === native) options.observeNative?.(); } catch (error) { waiter.reject(error instanceof Error ? error : new Error(String(error))); }
  });
  const observe = (endpoint: Endpoint, player: PlayerState) => {
    if (closed) return;
    if (player.playbackId !== null && !endpoint.attempts.has(player.playbackId)) return;
    endpoint.player = player;
    for (const waiter of [...waiters]) if (waiter.endpoint === endpoint) {
      if (["error", "unavailable"].includes(player.status) || player.requiresGesture) waiter.reject(new Error(player.error || "Playback failed."));
      else if (waiter.accept(player)) waiter.resolve(player);
    }
    if (endpoint === assigned) session().observe(player);
  };
  const disconnect = (endpoint: Endpoint) => {
    if (closed) return;
    endpoint.target.connected = false;
    for (const waiter of [...waiters]) if (waiter.endpoint === endpoint) waiter.reject(new Error("The playback device disconnected."));
    if (endpoint === assigned) session().rendererDisconnected();
    changed();
  };
  return {
    publish: changed,
    close() {
      closed = true;
      for (const waiter of [...waiters]) waiter.reject(new Error("Couch is shutting down."));
      for (const endpoint of endpoints.values()) try { endpoint.send({ type: "stop" }); } catch { /* Closing sockets also stops browser renderers. */ }
    },
    get busy() { return busy; },
    get nativeAssigned() { return !!native && assigned === native; },
    send(command: PlaybackCommand) {
      if (!assigned) throw new Error("Choose a playback output.");
      // Browser loads retain their own volume; next-item preparation is native-only.
      if (command.type === "prepare" && assigned !== native) return;
      send(assigned, command);
    },
    observeNative(player: PlayerState) {
      if (!native) return;
      if (player.status === "unavailable") { disconnect(native); return; }
      if (!native.target.connected) { native.target.connected = true; changed(); }
      observe(native, player);
    },
    register(name: string, sendCommand: Endpoint["send"]) {
      const id = crypto.randomUUID();
      const endpoint: Endpoint = { target: { id, name, kind: "endpoint", backend: "browser", connected: true }, send: sendCommand, player: idle(), attempts: new Set() };
      endpoints.set(id, endpoint); changed();
      return { id, observe: (player: PlayerState) => { if (endpoints.get(id) === endpoint) observe(endpoint, player); }, close: () => { if (endpoints.delete(id)) disconnect(endpoint); } };
    },
    async move(targetId: string, authorize = () => {}) {
      if (closed) throw new Error("Couch is shutting down.");
      if (busy) throw new Error("Playback is moving. Wait for it to finish.");
      const destination = endpoints.get(targetId);
      if (!destination?.target.connected) throw new Error("That playback device is disconnected.");
      if (destination === assigned) return;
      if (session().state.player.status === "error") throw new Error("Stop the failed playback attempt before selecting another output.");
      const source = assigned;
      const original = session().state.player;
      const paused = session().handoffPaused;
      if (!source || !original.playbackId || !["playing", "paused", "unavailable"].includes(original.status)) {
        if (original.status === "loading") throw new Error("Wait for playback to load before moving it.");
        authorize();
        if (original.playbackId && source?.target.connected) send(source, { type: "stop" });
        source?.attempts.clear();
        assigned = destination; session().selectIdleTarget(destination.player); changed(); return;
      }
      busy = true; changed({ targetId });
      let prepared = false;
      let sourcePaused = false;
      let committed = false;
      let previousDelivery: ReturnType<ReturnType<typeof createSession>["commitHandoff"]> | undefined;
      try {
        const { command: load, delivery } = await session().prepareHandoff(destination.target.backend === "browser");
        authorize();
        if (destination.target.backend === "browser") browserCompatible(load);
        prepared = true;
        let ready = await wait(destination, load, player => player.playbackId === load.playbackId && player.status === "paused");
        // Track indices belong to a decoder. Match semantic choices after destination metadata arrives.
        for (const kind of ["audio", "subtitle"] as const) {
          const selected = original.tracks?.find(track => track.kind === kind && track.selected);
          const candidates = ready.tracks?.filter(track => track.kind === kind) ?? [];
          const match = selected && candidates.find(track => (track.language === selected.language && track.label === selected.label)
            || (candidates.length === 1 && original.tracks?.filter(item => item.kind === kind).length === 1 && (!selected.language || !track.language || track.language === selected.language)));
          // Browsers without audioTracks can best-effort play the sole source audio track.
          // Known-empty metadata and explicit choices among multiple tracks still require a match.
          const soleAudioWithUnknownDestination = kind === "audio" && destination.target.backend === "browser"
            && ready.audioTracksKnown === false && original.tracks?.filter(track => track.kind === "audio").length === 1;
          if (selected && !match && !soleAudioWithUnknownDestination) throw new Error(`The destination cannot preserve the selected ${kind} track. Keep playback here.`);
          if (match && !match.selected || kind === "subtitle" && !selected && candidates.some(track => track.selected)) {
            const index = match?.index ?? -1;
            ready = await wait(destination, { type: "track", playbackId: load.playbackId, kind, index }, player => player.playbackId === load.playbackId && (index === -1 ? !player.tracks?.some(track => track.kind === kind && track.selected) : !!player.tracks?.some(track => track.kind === kind && track.index === index && track.selected)));
          }
        }
        authorize();
        sourcePaused = true;
        const checkpoint = source.target.connected
          ? await wait(source, { type: "pause", playbackId: original.playbackId, paused: true }, player => player.playbackId === original.playbackId && player.status === "paused")
          : original;
        if (checkpoint.speed !== undefined && ready.speed !== checkpoint.speed) ready = await wait(destination, { type: "speed", playbackId: load.playbackId, speed: checkpoint.speed }, player => player.playbackId === load.playbackId && player.speed === checkpoint.speed);
        if (checkpoint.seekable) {
          if (!ready.seekable) throw new Error("The destination cannot seek this source. Keep playback here.");
          ready = await wait(destination, { type: "seek", playbackId: load.playbackId, position: checkpoint.position }, player => player.playbackId === load.playbackId && player.status === "paused" && Math.abs(player.position - checkpoint.position) < 1);
        }
        authorize();
        // Source is known paused before the new attempt owns progress or can start.
        assigned = destination;
        previousDelivery = session().commitHandoff(ready, delivery);
        committed = true; changed({ targetId });
        if (!paused) await wait(destination, { type: "pause", playbackId: load.playbackId, paused: false }, player => player.playbackId === load.playbackId && player.status === "playing");
        if (source.target.connected) await wait(source, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
        source.attempts.clear();
      } catch (error) {
        if (closed) throw error;
        if (committed && destination.player.status === "paused" && destination.player.requiresGesture) {
          // Autoplay refused before making sound. Keep the new session paused for a destination gesture.
          if (source.target.connected) try { await wait(source, { type: "stop" }, player => player.playbackId === null && player.status === "idle"); } catch { /* Source was already confirmed paused. */ }
          throw error;
        }
        // Never resume a source if destination silence is uncertain.
        let silent = !prepared;
        if (prepared) try { await wait(destination, { type: "stop" }, player => player.playbackId === null && player.status === "idle"); silent = true; } catch { /* Keep both sides paused/uncertain. */ }
        if (committed && silent && source.target.connected) { assigned = source; session().commitHandoff(source.player, previousDelivery!); }
        if (sourcePaused && silent && source.target.connected && !paused) {
          try { await wait(source, { type: "pause", playbackId: original.playbackId, paused: false }, player => player.playbackId === original.playbackId && player.status === "playing"); } catch { /* Report failure without starting another owner. */ }
        }
        if (!silent && sourcePaused) session().handoffFailed("Playback could not be confirmed. The previous device is paused; stop or retry on the selected device.");
        throw error;
      } finally { busy = false; changed(null); }
    },
  };
}
