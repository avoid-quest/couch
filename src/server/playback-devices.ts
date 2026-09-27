import type { PlaybackDevice, PlaybackSummary } from "../shared/protocol";
import { fromSendspinVolume, toSendspinVolume } from "../shared/audio-volume";
import type { openPlaybackCatalog } from "./playback-catalog";
import type { createPlaybackTargetRegistry } from "./playback-targets";
import type { createSendspin, SendspinDevice } from "./sendspin";
import type { createSession } from "./session";

type Registry = ReturnType<typeof createPlaybackTargetRegistry>;
type Runtime = { id: string; sourceGeneration: number; session: ReturnType<typeof createSession>; targets: ReturnType<Registry["bind"]> };
type Host = ReturnType<typeof createSendspin>;
type Group = ReturnType<Host["playback"]>;
type Options = {
  registry: Registry;
  catalog: ReturnType<typeof openPlaybackCatalog>;
  runtimes: () => Runtime[];
  host: () => Host | undefined;
  changed: () => void;
  name: (deviceId: string) => string | undefined;
  ready: (deviceId: string) => boolean;
  activate: (deviceId: string) => Promise<void>;
  localVolume?: (volume: number, muted: boolean, authorize: () => void) => Promise<unknown>;
  localLevel?: () => { volume: number | null; muted: boolean };
};
const deviceId = (audio: SendspinDevice) => audio.deviceId ?? `audio-${audio.id}`;

/** Assign devices to a durable playback. Transport groups and their ownership stay here. */
export function createPlaybackDevices(options: Options) {
  const { registry, catalog } = options;
  const groups = new Map<string, { host: Host; group: Group; endpoint: ReturnType<Registry["registerGroup"]> }>();
  const mutedDevices = new Map<string, number>();
  let tail = Promise.resolve();
  let changing = false;
  const assigned = (runtime: Runtime) => catalog.get(runtime.id)?.deviceIds ?? [];
  const commit = (runtime: Runtime, ids: string[]) => {
    if (JSON.stringify(assigned(runtime)) !== JSON.stringify(ids)) catalog.assign(runtime.id, ids);
  };
  const active = (runtime: Runtime) => !!runtime.session.state.player.playbackId && !["idle", "ended"].includes(runtime.session.state.player.status);
  const snapshot = (runtime: Runtime) => {
    const runtimes = options.runtimes();
    const audioDevices = options.host()?.devices ?? [];
    const devices: PlaybackDevice[] = registry.targets.filter(target => target.kind === "endpoint").map(target => {
      const selected = runtimes.find(value => assigned(value).includes(target.id));
      const owner = selected && active(selected) ? selected : undefined;
      const audio = audioDevices.find(audio => deviceId(audio) === target.id);
      const shared = selected?.session.state.targetId?.startsWith("sendspin:");
      const player = registry.deviceState(target.id);
      const hardware = target.id === "native" ? options.localLevel?.() : undefined;
      const sdkVolume = audio?.volume === undefined ? undefined : audio.deviceId ? fromSendspinVolume(audio.volume) : audio.volume;
      return { id: target.id, name: target.name, connected: target.connected || !!audio, playbackId: owner?.id,
        volume: hardware?.volume ?? mutedDevices.get(target.id) ?? (shared ? sdkVolume : selected?.session.state.systemAudio?.volume ?? (selected?.session.state.targetId === target.id ? selected.session.state.player.volume : player?.volume)) ?? 100,
        muted: hardware?.muted ?? (shared ? audio?.muted ?? false : mutedDevices.has(target.id)), audio: !!audio,
        requiresGesture: !!audio && !options.ready(target.id) };
    });
    for (const audio of audioDevices) if (!devices.some(device => device.id === deviceId(audio))) {
      const id = deviceId(audio), owner = runtimes.find(value => active(value) && assigned(value).includes(id));
      devices.push({ id, name: audio.name, connected: audio.connected, playbackId: owner?.id, volume: audio.deviceId ? fromSendspinVolume(audio.volume) : audio.volume, muted: audio.muted, audio: true, requiresGesture: !!audio.deviceId && !options.ready(id) });
    }
    // Remember disconnected destinations by their persistent identity; never create a second row on reconnect.
    for (const value of runtimes) for (const id of assigned(value)) if (!devices.some(device => device.id === id)) {
      devices.push({ id, name: options.name(id) ?? "Disconnected device", connected: false, playbackId: active(value) ? value.id : undefined, volume: 100, muted: false, audio: false });
    }
    const playbacks: PlaybackSummary[] = runtimes.filter(value => value.id === runtime.id || value.session.state.queue.length || active(value)).map(value => {
      const state = value.session.state;
      return { id: value.id, title: state.queue.find(entry => entry.id === state.currentEntryId)?.title ?? "New playback", status: state.player.status, deviceIds: assigned(value) };
    });
    return { devices, playbacks, deviceIds: assigned(runtime) };
  };
  const groupFor = (runtime: Runtime) => {
    const host = options.host();
    if (!host?.listening) throw new Error("Audio sharing is unavailable. Check this library’s audio setting.");
    const existing = groups.get(runtime.id);
    if (existing?.host === host) return existing.group;
    const id = `sendspin:${runtime.id}`;
    const endpoint = existing?.endpoint ?? registry.registerGroup({ id, name: "Playback devices", kind: "group", backend: "sendspin", connected: false }, command => {
      const current = groups.get(runtime.id);
      if (!current || current.host !== options.host()) throw new Error("The audio connection changed. Choose the devices again.");
      current.group.send(command);
    });
    const group = host.playback(runtime.id, {
      observe: endpoint.observe,
      changed: target => {
        const selected = new Set(target.members?.filter(member => member.joined).map(member => member.id));
        endpoint.update({ ...target, members: host.devices.map(audio => ({ ...audio, joined: selected.has(audio.id) })) });
        if (!changing && runtime.session.state.targetId === id) commit(runtime, target.members?.filter(member => member.joined).map(member => member.deviceId ?? `audio-${member.id}`) ?? []);
        options.changed();
      },
    });
    groups.set(runtime.id, { host, group, endpoint });
    group.refresh();
    return group;
  };
  const directLevel = async (id: string, volume: number, muted: boolean) => {
    const expected = muted ? 0 : volume;
    registry.volume(id, expected);
    const deadline = Date.now() + 3000;
    while (Math.abs((registry.deviceState(id)?.volume ?? Infinity) - expected) > 0.5 && Date.now() < deadline) await Bun.sleep(20);
    if (Math.abs((registry.deviceState(id)?.volume ?? Infinity) - expected) > 0.5) throw new Error("This device did not confirm its volume before playback moved.");
    if (muted) mutedDevices.set(id, volume); else mutedDevices.delete(id);
  };
  async function assign(runtime: Runtime, ids: string[], authorize: () => void, takeover = false) {
    const generation = runtime.sourceGeneration;
    const guard = () => { authorize(); if (generation !== runtime.sourceGeneration) throw new Error("The source changed while playback was moving."); };
    guard();
    const state = snapshot(runtime);
    const requested = ids.map(id => { const device = state.devices.find(device => device.id === id); if (!device?.connected) throw new Error("That device is disconnected. Open Couch there and try again."); return device; });
    const shared = ids.length > 1;
    if (shared && requested.some(device => !device.audio)) throw new Error("These devices cannot play audio together. Choose one device to move playback.");
    if (shared && runtime.session.state.player.playbackId && !runtime.session.audioOnly) throw new Error("Video plays on one screen. Choose a device to move it there.");
    const occupied = options.runtimes().filter(other => other !== runtime && assigned(other).some(id => ids.includes(id)));
    if (!takeover && occupied.some(active)) throw new Error("This device is playing something else. Choose Replace to move playback here.");
    if (shared) await Promise.all(requested.filter(device => device.requiresGesture).map(device => options.activate(device.id)));
    guard();
    const restore: (() => Promise<void>)[] = [];
    const previous = groups.get(runtime.id)?.group;
    const oldMembers = previous ? [...previous.members] : [];
    const oldDevices = assigned(runtime);
    try {
    // Replacing a busy device can interrupt it. Preserve its owner for recovery if preparation fails.
    for (const other of occupied) {
      const group = groups.get(other.id)?.group;
      const before = assigned(other);
      const wasPlaying = other.session.state.player.status === "playing";
      const resume = async (target: string) => {
        await other.targets.move(target, guard);
        const player = other.session.state.player;
        if (wasPlaying && player.playbackId && player.status === "paused") other.session.command({ type: "pause", playbackId: player.playbackId, paused: false }, guard);
        commit(other, before);
      };
      if (group && other.session.state.targetId === group.id) {
        const members = [...group.members];
        const remaining = members.filter(clientId => { const audio = options.host()?.devices.find(device => device.id === clientId); return audio && !ids.includes(deviceId(audio)); });
        restore.push(async () => { await group.setMembers(members); await resume(group.id); });
        if (remaining.length) await other.targets.control(group.id, () => group.setMembers(remaining), remaining);
        else { await other.targets.detach(guard); await group.setMembers([]); }
        commit(other, before.filter(id => !ids.includes(id)));
      } else {
        const target = other.session.state.targetId;
        if (target && target !== "checkpoint") {
          restore.push(() => resume(target));
          await other.targets.detach(guard);
        } else restore.push(async () => { commit(other, before); });
        commit(other, before.filter(id => !ids.includes(id)));
      }
    }
    if (!ids.length) {
      await runtime.targets.detach(guard);
      await previous?.setMembers([]);
    } else if (shared || ids[0]!.startsWith("audio-")) {
      const group = groupFor(runtime), before = [...group.members];
      const clients = ids.map(id => options.host()!.devices.find(audio => deviceId(audio) === id)!.id);
      const initialLevels = Object.fromEntries(clients.map((clientId, index) => [clientId, ids[index] === "native" && options.localVolume ? { volume: 100, muted: false } : { volume: options.host()?.devices.find(audio => audio.id === clientId)?.deviceId ? toSendspinVolume(requested[index]!.volume) : requested[index]!.volume, muted: requested[index]!.muted }]));
      try {
        await runtime.targets.control(group.id, () => group.setMembers(clients, initialLevels), clients);
        guard();
        await runtime.targets.move(group.id, guard, { takeover: true });
      } catch (error) {
        if (runtime.session.state.targetId !== group.id) await group.setMembers(before).catch(() => {});
        throw error;
      }
    } else {
      if (previous && runtime.session.state.targetId === previous.id && !(ids[0] === "native" && options.localVolume)) await directLevel(ids[0]!, requested[0]!.volume, requested[0]!.muted);
      await runtime.targets.move(ids[0]!, guard, { takeover: true });
      await previous?.setMembers([]);
    }
    commit(runtime, ids);
    } catch (error) {
      // A failed move keeps uncertain outputs claimed; restoration then refuses to duplicate them.
      const group = groups.get(runtime.id)?.group;
      if (group && runtime.session.state.targetId !== group.id) await group.setMembers(oldMembers).catch(() => {});
      for (const undo of restore.reverse()) await undo().catch(() => {});
      commit(runtime, oldDevices);
      throw error;
    } finally { options.changed(); }
  }
  return {
    snapshot,
    assign(runtime: Runtime, ids: string[], authorize: () => void, takeover = false) {
      const work = tail.then(async () => {
        changing = true;
        try { await assign(runtime, ids, authorize, takeover); }
        finally {
          changing = false;
          for (const current of options.runtimes()) {
            const group = groups.get(current.id)?.group;
            if (group && current.session.state.targetId === group.id) commit(current, group.members.flatMap(id => { const audio = options.host()?.devices.find(device => device.id === id); return audio ? [deviceId(audio)] : []; }));
          }
          options.changed();
        }
      });
      tail = work.catch(() => {});
      return work;
    },
    async volume(runtime: Runtime, id: string, volume: number, muted: boolean, authorize: () => void) {
      authorize();
      if (!assigned(runtime).includes(id)) throw new Error("Choose this playback’s device to adjust its volume.");
      const group = groups.get(runtime.id)?.group;
      if (id === "native" && options.localVolume) await options.localVolume(volume, muted, authorize);
      else if (group && runtime.session.state.targetId === group.id) {
        const client = options.host()?.devices.find(audio => deviceId(audio) === id);
        if (!client) throw new Error("That device is disconnected.");
        await group.setMemberVolume(client.id, client.deviceId ? toSendspinVolume(volume) : volume, muted);
      } else {
        if (id === "native" && runtime.targets.nativeAssigned) await runtime.session.command({ type: "volume", volume: muted ? 0 : volume }, authorize);
        else registry.volume(id, muted ? 0 : volume);
        if (muted) mutedDevices.set(id, volume); else mutedDevices.delete(id);
      }
      options.changed();
    },
  };
}
