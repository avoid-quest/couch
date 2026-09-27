import type { PlaybackCommand, PlaybackDevice, PlaybackSummary, PlayerState } from "../shared/protocol";
import { fromSendspinVolume, toSendspinVolume } from "../shared/audio-volume";
import type { openPlaybackCatalog } from "./playback-catalog";
import type { createPlaybackTargetRegistry } from "./playback-targets";
import type { createSendspin, SendspinDevice } from "./sendspin";
import type { createSession } from "./session";
import { browserCompatible } from "./playback-targets";
import { validateSendspinLoad } from "./sendspin-playback";

type Registry = ReturnType<typeof createPlaybackTargetRegistry>;
type Runtime = { id: string; sourceGeneration: number; session: ReturnType<typeof createSession>; targets: ReturnType<Registry["bind"]> };
type Host = ReturnType<typeof createSendspin>;
type Group = ReturnType<Host["playback"]>;
type GroupBinding = { host: Host; group: Group; endpoint: ReturnType<Registry["registerGroup"]>; screen?: string; video?: PlayerState; audio?: PlayerState; playbackId?: string; stopping?: boolean; unwatch?: () => void };
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
  const groups = new Map<string, GroupBinding>();
  const mutedDevices = new Map<string, number>();
  let tail = Promise.resolve();
  let changing = false;
  const assigned = (runtime: Runtime) => catalog.get(runtime.id)?.deviceIds ?? [];
  const commit = (runtime: Runtime, ids: string[]) => {
    if (JSON.stringify(assigned(runtime)) !== JSON.stringify(ids)) catalog.assign(runtime.id, ids);
  };
  const active = (runtime: Runtime) => !!runtime.session.state.player.playbackId && !["idle", "ended"].includes(runtime.session.state.player.status);
  const videoScreen = (runtime: Runtime) => {
    const binding = groups.get(runtime.id);
    return binding?.screen && binding.video?.playbackId && binding.video.playbackId === binding.audio?.playbackId
      && ["playing", "paused"].includes(binding.audio.status) && runtime.session.state.targetId === `sendspin:${runtime.id}`
      && registry.targets.some(target => target.id === binding.screen && target.connected) ? binding.screen : undefined;
  };
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
        volume: hardware?.volume ?? mutedDevices.get(target.id) ?? (shared ? sdkVolume : player?.volume ?? selected?.session.state.player.volume) ?? 100,
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
    const playbacks: PlaybackSummary[] = runtimes.filter(value => value.id === runtime.id || assigned(value).length || value.session.state.queue.length || active(value)).map(value => {
      const state = value.session.state;
      const screen = videoScreen(value);
      return { id: value.id, title: state.queue.find(entry => entry.id === state.currentEntryId)?.title ?? "New playback", status: state.player.status, deviceIds: assigned(value), ...(screen ? { videoDeviceId: screen } : {}) };
    });
    const screen = videoScreen(runtime);
    return { devices, playbacks, deviceIds: assigned(runtime), ...(screen ? { videoDeviceId: screen } : {}) };
  };
  const videoSource = (command: Extract<PlaybackCommand, { type: "load" }>) => !command.audioOnly && !command.radio && !/\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:[?#]|$)/i.test(command.source);
  const screenFor = (runtime: Runtime, ids: string[]) => {
    const capable = (id: string) => registry.targets.some(target => target.id === id && target.connected && target.kind === "endpoint" && target.backend !== "sendspin");
    const previous = groups.get(runtime.id)?.screen;
    return [previous, runtime.session.state.targetId, ...ids].find((id): id is string => !!id && ids.includes(id) && capable(id));
  };
  const merged = (binding: GroupBinding) => {
    const audio = binding.audio;
    if (!audio) return;
    if (audio.playbackId === null && binding.video?.playbackId) return;
    const video = binding.video?.playbackId === audio.playbackId ? binding.video : undefined;
    binding.endpoint.observe({ ...audio, ...(video ? { duration: video.duration ?? audio.duration, seekable: audio.seekable && video.seekable, live: video.live ?? audio.live, seekRange: video.seekRange ?? audio.seekRange,
      tracks: [...(audio.tracks ?? []), ...(video.tracks?.filter(track => track.kind !== "audio") ?? [])], chapters: video.chapters, subtitleDelay: video.subtitleDelay, subtitleError: video.subtitleError } : {}) });
  };
  const decorate = (binding: GroupBinding, target: Parameters<GroupBinding["endpoint"]["update"]>[0]) => ({ ...target, members: [...target.members ?? [], ...(binding.screen ? [{ id: `video:${binding.screen}`, deviceId: binding.screen, name: options.name(binding.screen) ?? "Video screen", connected: true, volume: 0, muted: true, joined: true }] : [])] });
  const groupFor = (runtime: Runtime) => {
    const host = options.host();
    if (!host?.listening) throw new Error("Audio sharing is unavailable. Check this library’s audio setting.");
    const existing = groups.get(runtime.id);
    if (existing?.host === host) return existing.group;
    existing?.unwatch?.();
    const id = `sendspin:${runtime.id}`;
    const endpoint = existing?.endpoint ?? registry.registerGroup({ id, name: "Playback devices", kind: "group", backend: "sendspin", connected: false }, command => {
      const current = groups.get(runtime.id);
      if (!current || current.host !== options.host()) throw new Error("The audio connection changed. Choose the devices again.");
      const screen = current.screen;
      if (command.type === "load") {
        if (current.video && screen) try { runtime.targets.sendMember(screen, { type: "stop", playbackOwner: runtime.id }); } catch {}
        current.video = undefined;
        current.playbackId = command.playbackId;
        if (videoSource(command)) {
          if (!screen) throw new Error("Choose a connected screen with Sendspin audio for shared video playback.");
          const audio = { ...command, playbackOwner: runtime.id };
          validateSendspinLoad(audio);
          const video = { ...command, videoOnly: true, playbackOwner: runtime.id, paused: true, audioOutput: undefined };
          if (registry.targets.find(target => target.id === screen)?.backend === "browser") browserCompatible(video);
          void runtime.targets.waitMember(screen, video, state => state.playbackId === command.playbackId && state.status === "paused").then(state => {
            if (current.playbackId !== command.playbackId) return;
            current.video = state;
            merged(current);
            current.group.send(audio);
          }).catch(error => {
            if (current.playbackId !== command.playbackId) return;
            const observed = runtime.targets.memberState(screen);
            if (observed?.playbackId === command.playbackId) current.video = observed;
            try { runtime.targets.sendMember(screen, { type: "stop", playbackOwner: runtime.id }); } catch {}
            current.group.reject(command.playbackId, error instanceof Error ? error.message : "The screen could not prepare video playback.");
          });
          return;
        }
      }
      if (command.type === "stop") {
        current.stopping = !!screen && !!current.video;
        if (screen) try { runtime.targets.sendMember(screen, { type: "stop", playbackOwner: runtime.id }); } catch {}
        if (!current.stopping) current.playbackId = undefined;
      } else if (screen && current.video && current.playbackId && "playbackId" in command && command.playbackId === current.playbackId) {
        if (command.type === "track" && command.kind === "subtitle" || ["subtitleDelay", "addSubtitle"].includes(command.type))
          runtime.targets.sendMember(screen, { ...command, playbackOwner: runtime.id });
        if (command.type === "track" && command.kind === "subtitle" || command.type === "subtitleDelay" || command.type === "addSubtitle") return;
      }
      current.group.send(command);
    });
    const binding: GroupBinding = { host, group: undefined as unknown as Group, endpoint, screen: existing?.screen };
    const group = host.playback(runtime.id, {
      observe: player => {
        binding.audio = player;
        merged(binding);
      },
      changed: target => {
        const selected = new Set(target.members?.filter(member => member.joined).map(member => member.id));
        endpoint.update(decorate(binding, { ...target, members: host.devices.map(audio => ({ ...audio, joined: selected.has(audio.id) })) }));
        options.changed();
      },
    });
    binding.group = group;
    groups.set(runtime.id, binding);
    binding.unwatch = runtime.targets.observeMember((targetId, player) => {
      if (targetId !== binding.screen || player.playbackId !== binding.playbackId && !(binding.stopping && player.playbackId === null)) return;
      const activeVideo = binding.video?.playbackId === player.playbackId && ["playing", "paused"].includes(binding.video.status);
      binding.video = player;
      if (binding.stopping && player.playbackId === null) { binding.stopping = false; binding.playbackId = undefined; }
      if (activeVideo && ["error", "unavailable"].includes(player.status)) binding.group.reject(player.playbackId!, player.error || "The video screen stopped playback.");
      else merged(binding);
    });
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
    const screen = shared ? screenFor(runtime, ids) : undefined;
    if (shared && runtime.session.state.player.playbackId && !runtime.session.audioOnly && !screen) throw new Error("Choose a screen with Sendspin audio before sharing this video.");
    const current = runtime.session.state.queue.find(entry => entry.id === runtime.session.state.currentEntryId);
    if (shared && active(runtime) && current && /^(library|recording):/.test(current.source)) throw new Error("This source is currently available on the Core's own player only.");
    if (screen && !takeover) runtime.targets.assertAvailable(screen);
    const occupied = options.runtimes().filter(other => other !== runtime && assigned(other).some(id => ids.includes(id)));
    if (!takeover && occupied.some(active)) throw new Error("This device is playing something else. Choose Replace to move playback here.");
    if (shared) await Promise.all(requested.filter(device => device.requiresGesture).map(device => options.activate(device.id)));
    guard();
    const restore: (() => Promise<void>)[] = [];
    const previousBinding = groups.get(runtime.id);
    const previous = previousBinding?.group;
    const oldScreen = previousBinding?.screen;
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
        const binding = groups.get(other.id)!;
        const oldScreen = binding.screen;
        const screenTaken = !!oldScreen && ids.includes(oldScreen);
        const members = [...group.members];
        const remaining = members.filter(clientId => { const audio = options.host()?.devices.find(device => device.id === clientId); return audio && !ids.includes(deviceId(audio)); });
        restore.push(async () => { binding.screen = oldScreen; group.refresh(); await group.setMembers(members); await resume(group.id); });
        if (screenTaken && active(other) && !other.session.audioOnly || !remaining.length) await other.targets.detach(guard, screenTaken);
        binding.screen = screenTaken ? undefined : oldScreen;
        group.refresh();
        if (other.session.state.targetId === group.id) await other.targets.control(group.id, () => group.setMembers(remaining), remaining);
        else await group.setMembers(remaining);
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
      await runtime.targets.detach(guard, true);
      await previous?.setMembers([]);
    } else if (shared || ids[0]!.startsWith("audio-")) {
      const group = groupFor(runtime), before = [...group.members];
      const binding = groups.get(runtime.id)!;
      if (oldScreen && oldScreen !== screen && runtime.session.state.targetId === group.id && active(runtime) && !runtime.session.audioOnly) {
        await runtime.targets.detach(guard, true);
        await group.setMembers([]);
      }
      binding.screen = screen;
      group.refresh();
      const clients = ids.map(id => options.host()!.devices.find(audio => deviceId(audio) === id)!.id);
      const initialLevels = Object.fromEntries(clients.map((clientId, index) => [clientId, ids[index] === "native" && options.localVolume ? { volume: 100, muted: false } : { volume: options.host()?.devices.find(audio => audio.id === clientId)?.deviceId ? toSendspinVolume(requested[index]!.volume) : requested[index]!.volume, muted: requested[index]!.muted }]));
      try {
        await runtime.targets.control(group.id, () => group.setMembers(clients, initialLevels), clients);
        guard();
        if (screen && runtime.session.state.targetId === screen && active(runtime) && !runtime.session.audioOnly) await runtime.targets.detach(guard, true);
        await runtime.targets.move(group.id, guard, { takeover: true });
      } catch (error) {
        if (runtime.session.state.targetId !== group.id) await group.setMembers(before).catch(() => {});
        binding.screen = oldScreen; group.refresh();
        throw error;
      }
    } else {
      if (previous && runtime.session.state.targetId === previous.id && !(ids[0] === "native" && options.localVolume)) await directLevel(ids[0]!, requested[0]!.volume, requested[0]!.muted);
      if (previous && runtime.session.state.targetId === previous.id) {
        await runtime.targets.detach(guard, true);
        await previous.setMembers([]);
        if (previousBinding) { previousBinding.screen = undefined; previous.refresh(); }
      }
      await runtime.targets.move(ids[0]!, guard, { takeover: true });
      if (previous && runtime.session.state.targetId !== previous.id) await previous.setMembers([]);
    }
    commit(runtime, ids);
    } catch (error) {
      // A failed move keeps uncertain outputs claimed; restoration then refuses to duplicate them.
      const group = groups.get(runtime.id)?.group;
      if (group && runtime.session.state.targetId !== group.id) await group.setMembers(oldMembers).catch(() => {});
      if (previousBinding) { previousBinding.screen = oldScreen; previousBinding.group.refresh(); }
      if (oldDevices.length === 1 && runtime.session.state.targetId === "checkpoint") await runtime.targets.move(oldDevices[0]!, guard, { takeover: true }).catch(() => {});
      else if (oldDevices.length > 1 && previous && runtime.session.state.targetId === "checkpoint") await runtime.targets.move(previous.id, guard, { takeover: true }).catch(() => {});
      for (const undo of restore.reverse()) await undo().catch(() => {});
      commit(runtime, oldDevices);
      throw error;
    } finally { options.changed(); }
  }
  const update = (runtime: Runtime, ids: () => string[], authorize: () => void, takeover = false) => {
      const work = tail.then(async () => {
        changing = true;
        try { await assign(runtime, ids(), authorize, takeover); }
        finally {
          changing = false;
          options.changed();
        }
      });
      tail = work.catch(() => {});
      return work;
  };
  return {
    snapshot,
    hasVideoScreen: (runtime: Runtime) => !!groups.get(runtime.id)?.screen && runtime.session.state.targetId === `sendspin:${runtime.id}`,
    validateLoad(runtime: Runtime, command: Extract<PlaybackCommand, { type: "load" }>) {
      if (!videoSource(command)) return validateSendspinLoad(command);
      const screen = groups.get(runtime.id)?.screen;
      if (!screen || !assigned(runtime).includes(screen) || !registry.targets.some(target => target.id === screen && target.connected)) throw new Error("Choose a connected screen with Sendspin audio for shared video playback.");
      const video = { ...command, videoOnly: true, playbackOwner: runtime.id };
      if (registry.targets.find(target => target.id === screen)?.backend === "browser") browserCompatible(video);
      validateSendspinLoad({ ...command, playbackOwner: runtime.id });
    },
    assign: (runtime: Runtime, ids: string[], authorize: () => void, takeover = false) => update(runtime, () => ids, authorize, takeover),
    join: (runtime: Runtime, id: string, authorize: () => void) => update(runtime, () => [...new Set([...assigned(runtime), id])], authorize, true),
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
