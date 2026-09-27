import type { BrowserMediaCapabilities, PlaybackCommand, PlaybackTarget, PlayerState, SessionState } from "../shared/protocol";
import type { createSession, PlaybackDestination } from "./session";

type Endpoint = { target: PlaybackTarget; send: (command: PlaybackCommand) => void; player: PlayerState; attempts: Set<string>; capabilities?: BrowserMediaCapabilities; authorize?: () => void; receiver?: { unsafeUntil: number; timer?: ReturnType<typeof setTimeout> } };
type Session = ReturnType<typeof createSession>;
type Binding = { id: string; kind: "household" | "personal"; session: () => Session; assigned?: Endpoint; busy: boolean; closed: boolean; changed: (handoff?: SessionState["handoff"]) => void };
type RegistryOptions = { timeout?: number; observeNative?: () => void; recoveringReceiver?: boolean; recoveringGroup?: boolean; now?: () => number };
type Waiter = { binding: Binding; endpoint: Endpoint; accept: (player: PlayerState) => boolean; resolve: (player: PlayerState) => void; reject: (error: Error) => void };
const idle = (volume = 100): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume, seekable: false, error: null });

export function browserCompatible(command: Extract<PlaybackCommand, { type: "load" }>) {
  if (!/^https?:\/\//i.test(command.source) || command.headers && Object.keys(command.headers).length || command.audioSource || command.segment || command.subtitles?.length)
    throw new Error("This source needs media delivery that this browser does not support yet. Keep playing it on Couch TV.");
}

// The connection owns the endpoint. IDs in incoming observations never grant authority.
export function createPlaybackTargetRegistry(nativeSend: Endpoint["send"] | undefined, options: RegistryOptions = {}) {
  const timeout = options.timeout ?? 8_000;
  const now = options.now ?? (() => performance.now());
  // Native watchdog: 10s lease + 2s enforced shutdown, with a 500ms margin.
  const receiverFence = 12_500;
  const recoveryUntil = now() + Math.max(options.recoveringReceiver ? receiverFence : 0, options.recoveringGroup ? 1000 : 0);
  const native: Endpoint | undefined = nativeSend ? { target: { id: "native", name: "Couch TV", kind: "endpoint", backend: "native", connected: false }, send: nativeSend, player: idle(), attempts: new Set() } : undefined;
  const endpoints = new Map<string, Endpoint>(native ? [["native", native]] : []);
  const waiters = new Set<Waiter>();
  const memberObservers = new Map<Binding, Set<(id: string, player: PlayerState) => void>>();
  const bindings = new Map<string, Binding>();
  const claims = new Map<string, Binding>();
  const reservations = new Map<string, Binding>();
  const controls = new Map<Binding, Endpoint>();
  let closed = false;
  const changed = () => { for (const binding of bindings.values()) binding.changed(); };
  const overlap = (left: Endpoint, right: Endpoint) => left.target.id === right.target.id
    || left.target.kind === "group" && !!left.target.members?.some(member => member.joined && (
      right.target.kind === "endpoint" ? member.deviceId === right.target.id
        : right.target.members?.some(other => other.joined && (left.target.backend === right.target.backend && other.id === member.id || !!member.deviceId && other.deviceId === member.deviceId))))
    || right.target.kind === "group" && left.target.kind === "endpoint" && !!right.target.members?.some(member => member.joined && member.deviceId === left.target.id);
  const owners = (endpoint: Endpoint, binding?: Binding) => [...new Set([...claims, ...reservations].flatMap(([id, owner]) => owner !== binding && (id === endpoint.target.id || endpoints.has(id) && overlap(endpoint, endpoints.get(id)!)) ? [owner] : []).concat([...controls].flatMap(([owner, reserved]) => owner !== binding && overlap(endpoint, reserved) ? [owner] : [])))];
  const descriptor = (endpoint: Endpoint, viewer?: Binding) => {
    const owner = owners(endpoint, viewer)[0];
    return { ...endpoint.target, ...(owner ? { occupied: true, sessionKind: owner.kind } : {}) };
  };
  const unverified = (endpoint: Endpoint) => (endpoint.target as { handoffSafety?: string }).handoffSafety === "unverified";
  const release = (binding: Binding, endpoint: Endpoint) => { if (claims.get(endpoint.target.id) === binding) claims.delete(endpoint.target.id); };
  const deliveryFor = (binding: Binding, endpoint: Endpoint): PlaybackDestination => ({ backend: endpoint.target.backend, remote: !!endpoint.receiver || endpoint.target.kind === "group", capabilities: endpoint.capabilities, authorize: () => {
    if (closed || binding.closed || !endpoint.target.connected) throw new Error("The playback device disconnected.");
    if (owners(endpoint, binding).length) throw new Error("That playback output is occupied.");
    endpoint.authorize?.();
  } });
  const send = (binding: Binding, endpoint: Endpoint, command: PlaybackCommand) => {
    if (binding.closed && command.type !== "stop") throw new Error("Playback session closed.");
    if (command.type !== "stop" && !(command.type === "prepare" && !command.next) && owners(endpoint, binding).length) throw new Error("That playback output is occupied.");
    if (closed || !endpoint.target.connected) throw new Error("That playback device disconnected.");
    if (endpoint.receiver && (command.type === "audioOutput" || command.type === "audioPause" || command.type === "addSubtitle" && !/^https?:\/\//i.test(command.source))) throw new Error("This command belongs to the Core's own player.");
    if (command.type === "load") {
      if (now() < recoveryUntil) throw new Error("Waiting for previous playback to stop after Core restarted. Try again in a few seconds.");
      if (endpoint.target.backend === "browser") browserCompatible(command);
      if (endpoint.target.kind === "group") command = { ...command, audioOutput: undefined, preferences: command.preferences ? { ...command.preferences, audioDelay: 0 } : undefined };
      if (endpoint.receiver) {
        if (![command.source, ...(command.audioSource ? [command.audioSource] : []), ...command.subtitles?.map(subtitle => subtitle.source) ?? []].every(source => /^https?:\/\//i.test(source))) throw new Error("This source is only accessible on the Core's own player.");
        command = { ...command, audioOutput: undefined, preferences: command.preferences ? { ...command.preferences, audioDelay: 0 } : undefined };
      }
      endpoint.attempts = new Set([command.playbackId]);
    }
    if (command.type === "prepare") endpoint.attempts = new Set([command.playbackId, ...(command.next ? [command.next.playbackId] : [])]);
    endpoint.send(command);
  };
  const wait = (binding: Binding, endpoint: Endpoint, command: PlaybackCommand, accept: Waiter["accept"]) => new Promise<PlayerState>((resolve, reject) => {
    const timer = setTimeout(() => waiter.reject(new Error("The playback device did not confirm readiness. Try again.")), timeout);
    const finish = () => { clearTimeout(timer); waiters.delete(waiter); };
    const waiter: Waiter = { binding, endpoint, accept, resolve: player => { finish(); resolve(player); }, reject: error => { finish(); reject(error); } };
    waiters.add(waiter);
    try { send(binding, endpoint, command); if (endpoint === native) options.observeNative?.(); } catch (error) { waiter.reject(error instanceof Error ? error : new Error(String(error))); }
  });
  const observe = (endpoint: Endpoint, player: PlayerState) => {
    if (closed) return;
    if (player.playbackId !== null && !endpoint.attempts.has(player.playbackId)) return;
    endpoint.player = player;
    for (const waiter of [...waiters]) if (waiter.endpoint === endpoint) {
      if (["error", "unavailable"].includes(player.status) || player.requiresGesture) waiter.reject(new Error(player.error || "Playback failed."));
      else if (waiter.accept(player)) waiter.resolve(player);
    }
    const owner = claims.get(endpoint.target.id);
    if (owner && !owner.closed && endpoint === owner.assigned) owner.session().observe(player);
    for (const [binding, observers] of memberObservers) if (!binding.closed)
      for (const observer of observers) observer(endpoint.target.id, player);
  };
  const disconnect = (endpoint: Endpoint) => {
    if (closed || !endpoint.target.connected) return;
    endpoint.target.connected = false;
    if (endpoint.receiver) clearTimeout(endpoint.receiver.timer);
    for (const waiter of [...waiters]) if (waiter.endpoint === endpoint) waiter.reject(new Error("The playback device disconnected."));
    const owner = claims.get(endpoint.target.id);
    if (owner && !owner.closed && endpoint === owner.assigned) owner.session().rendererDisconnected();
    for (const [binding, observers] of memberObservers) if (!binding.closed)
      for (const observer of observers) observer(endpoint.target.id, { ...endpoint.player, status: "unavailable", error: "The video device disconnected." });
    changed();
  };
  const evict = async (owner: Binding, destination: Endpoint) => {
    if (owner.busy) throw new Error("That playback output is occupied. Wait for its pending operation.");
    const owned = [...claims].filter(([id, binding]) => binding === owner && (id === destination.target.id || endpoints.has(id) && overlap(destination, endpoints.get(id)!))).map(([id]) => endpoints.get(id)).filter((endpoint): endpoint is Endpoint => !!endpoint);
    if (!owned.length) throw new Error("That playback output is occupied.");
    for (const endpoint of owned) {
      const previous = owner.assigned?.target.id === endpoint.target.id ? owner.assigned : endpoint;
      if (!endpoint.target.connected || previous.receiver && !previous.target.connected && now() < previous.receiver.unsafeUntil || unverified(endpoint) && previous.player.playbackId !== null)
        throw new Error("The previous output cannot confirm silence. Stop it before taking over.");
      // Cancel the previous session's source resolution before yielding; its claim
      // remains in place until a fresh stop observation confirms actual retirement.
      if (!owner.closed && owner.assigned?.target.id === endpoint.target.id) owner.session().command({ type: "stop" });
      owner.busy = true;
      try {
        await wait(owner, endpoint, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
        endpoint.attempts.clear(); release(owner, endpoint);
        if (owner.assigned?.target.id === endpoint.target.id) {
          owner.assigned = undefined;
          if (!owner.closed) owner.session().selectIdleTarget(idle(endpoint.player.volume));
        }
      } finally { owner.busy = false; changed(); }
    }
  };
  const registry = {
    get targets() { return [...endpoints.values()].map(endpoint => descriptor(endpoint)); },
    deviceState(id: string) { return endpoints.get(id)?.player; },
    volume(id: string, volume: number) {
      const endpoint = endpoints.get(id);
      if (!endpoint?.target.connected) throw new Error("This device is disconnected.");
      endpoint.authorize?.();
      endpoint.send({ type: "volume", volume });
    },
    rename(id: string, name: string) {
      const endpoint = endpoints.get(id);
      if (endpoint && endpoint.target.name !== name) { endpoint.target.name = name; changed(); }
    },
    close() {
      closed = true;
      for (const waiter of [...waiters]) waiter.reject(new Error("Couch is shutting down."));
      for (const endpoint of endpoints.values()) {
        if (endpoint.receiver) clearTimeout(endpoint.receiver.timer);
        try { endpoint.send({ type: "stop" }); } catch { /* Closing sockets also stops browser renderers. */ }
      }
      bindings.clear(); claims.clear(); reservations.clear(); controls.clear(); memberObservers.clear();
    },
    observeNative(player: PlayerState) {
      if (!native) return;
      if (player.status === "unavailable") { disconnect(native); return; }
      if (!native.target.connected) { native.target.connected = true; changed(); }
      observe(native, player);
    },
    register(name: string, sendCommand: Endpoint["send"], capabilities?: BrowserMediaCapabilities, authorize?: () => void, id: string = crypto.randomUUID()) {
      if (closed) throw new Error("Couch is shutting down.");
      if (endpoints.has(id)) throw new Error("This device already has a playback connection.");
      const endpoint: Endpoint = { target: { id, name, kind: "endpoint", backend: "browser", connected: true }, send: sendCommand, player: idle(), attempts: new Set(), capabilities, authorize };
      endpoints.set(id, endpoint); changed();
      return { id, observe: (player: PlayerState) => { if (endpoints.get(id) === endpoint) observe(endpoint, player); }, close: () => {
        if (!endpoints.delete(id)) return;
        disconnect(endpoint);
        // Browser closure confirms silence; keep only the session's resumable snapshot.
        claims.delete(id); reservations.delete(id);
        for (const [binding, reserved] of controls) if (reserved.target.id === id) controls.delete(binding);
      } };
    },
    registerGroup(target: PlaybackTarget, sendCommand: Endpoint["send"]) {
      if (closed || endpoints.has(target.id)) throw new Error("Playback output is already registered or closed.");
      let endpoint: Endpoint = { target: { ...target }, send: sendCommand, player: idle(), attempts: new Set() };
      endpoints.set(target.id, endpoint); changed();
      return {
        update(target: PlaybackTarget) {
          if (closed) return;
          if (!target.connected) disconnect(endpoint);
          // A recovered group starts idle. The old assignment remains resumable,
          // just like a replacement browser connection; it never autoplays.
          if (target.connected && !endpoint.target.connected) endpoint = { target: { ...target }, send: sendCommand, player: idle(), attempts: new Set() };
          else endpoint.target = { ...target };
          endpoints.set(target.id, endpoint); changed();
        },
        observe: (player: PlayerState) => { if (endpoint.target.connected) observe(endpoint, player); },
      };
    },
    registerReceiver(controllerId: string, name: string, sendCommand: Endpoint["send"], authorize: () => void, expired: () => void) {
      if (closed) throw new Error("Couch is shutting down.");
      const id = `receiver-${controllerId}`;
      const previous = endpoints.get(id);
      if (previous?.target.connected) throw new Error("This native receiver is already connected.");
      // The trusted native begin operation confirms local shutdown before enrolling.
      if (previous?.receiver) previous.receiver.unsafeUntil = 0;
      const endpoint: Endpoint = { target: { id, name, kind: "endpoint", backend: "native", connected: true }, send: sendCommand, player: idle(), attempts: new Set(), authorize, receiver: { unsafeUntil: 0 } };
      endpoints.set(id, endpoint);
      const renew = () => {
        if (closed || endpoints.get(id) !== endpoint || !endpoint.target.connected) throw new Error("The receiver connection changed.");
        authorize();
        clearTimeout(endpoint.receiver!.timer);
        endpoint.receiver!.unsafeUntil = now() + receiverFence;
        endpoint.receiver!.timer = setTimeout(() => { disconnect(endpoint); expired(); }, 10_500);
        endpoint.receiver!.timer.unref?.();
      };
      renew(); changed();
      return { id, renew, observe: (player: PlayerState) => { if (endpoints.get(id) === endpoint) observe(endpoint, player); }, close: () => { if (endpoints.get(id) === endpoint) disconnect(endpoint); } };
    },
    bind(id: string, session: () => Session, { defaultNative = false, kind = defaultNative ? "household" : "personal" }: { defaultNative?: boolean; kind?: "household" | "personal" } = {}) {
      if (closed || bindings.has(id)) throw new Error("Playback session is already bound or closed.");
      if (defaultNative && native && claims.has(native.target.id)) throw new Error("That playback output is occupied.");
      const binding: Binding = { id, kind, session, assigned: defaultNative ? native : undefined, busy: false, closed: false, changed(handoff = session().state.handoff ?? null) {
        if (!binding.closed) session().updateTargets(binding.assigned?.target.id, [...endpoints.values()].map(endpoint => descriptor(endpoint, binding)), handoff);
      } };
      bindings.set(id, binding);
      if (binding.assigned) claims.set(binding.assigned.target.id, binding);
      let published = false;
      const facade = {
        publish() {
          if (!published && session().restoredCheckpoint) {
            if (binding.assigned) release(binding, binding.assigned);
            binding.assigned = { target: { id: "checkpoint", name: "Previous playback", kind: "endpoint", backend: "native", connected: false }, send() {}, player: session().state.player, attempts: new Set() };
          }
          if (!published && binding.assigned?.target.connected) session().observe(binding.assigned.player);
          published = true; changed();
        },
        async close() {
          if (binding.closed) return;
          binding.closed = true;
          for (const waiter of [...waiters]) if (waiter.binding === binding) waiter.reject(new Error("Playback session closed."));
          const owned = [...new Set([...claims, ...reservations].filter(([, owner]) => owner === binding).map(([id]) => endpoints.get(id)).filter((endpoint): endpoint is Endpoint => !!endpoint))];
          await Promise.all(owned.map(async endpoint => {
            try {
              await wait(binding, endpoint, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
              release(binding, endpoint);
              if (reservations.get(endpoint.target.id) === binding) reservations.delete(endpoint.target.id);
            } catch { /* Keep uncertain outputs claimed until a safe explicit takeover. */ }
          }));
          binding.assigned = undefined; bindings.delete(id); changed();
          memberObservers.delete(binding);
        },
        owns(targetId: string) { return claims.get(targetId) === binding; },
        memberState(targetId: string) { return endpoints.get(targetId)?.player; },
        observeMember(observer: (targetId: string, player: PlayerState) => void) {
          const observers = memberObservers.get(binding) ?? new Set();
          observers.add(observer); memberObservers.set(binding, observers);
          return () => { observers.delete(observer); if (!observers.size) memberObservers.delete(binding); };
        },
        sendMember(targetId: string, command: PlaybackCommand) {
          const endpoint = endpoints.get(targetId);
          if (!endpoint?.target.connected) throw new Error("The video device disconnected.");
          send(binding, endpoint, command);
        },
        waitMember(targetId: string, command: PlaybackCommand, accept: (player: PlayerState) => boolean) {
          const endpoint = endpoints.get(targetId);
          if (!endpoint?.target.connected) throw new Error("The video device disconnected.");
          return wait(binding, endpoint, command, accept);
        },
        assertAvailable(targetId: string, memberIds?: string[]) {
          if (binding.closed || closed) throw new Error("Playback session closed.");
          if (binding.busy) throw new Error("Playback is moving. Wait for it to finish.");
          const endpoint = endpoints.get(targetId);
          if (!endpoint) throw new Error("That playback output is unavailable.");
          const proposed = memberIds ? { ...endpoint, target: { ...endpoint.target, members: memberIds.map(id => {
            const member = endpoint.target.members?.find(member => member.id === id);
            if (!member) throw new Error("Choose available group members.");
            return { ...member, joined: true };
          }) } } : endpoint;
          if (owners(endpoint, binding).length || owners(proposed, binding).length) throw new Error("That playback output is occupied.");
        },
        async control<T>(targetId: string, operation: () => T | Promise<T>, memberIds?: string[]): Promise<T> {
          facade.assertAvailable(targetId, memberIds);
          const endpoint = endpoints.get(targetId)!;
          // Retain both old and proposed members until the backend confirms its change.
          controls.set(binding, { ...endpoint, target: { ...endpoint.target, members: endpoint.target.members?.map(member => ({ ...member, joined: member.joined || !!memberIds?.includes(member.id) })) } });
          binding.busy = true; changed();
          try { return await operation(); }
          finally { controls.delete(binding); binding.busy = false; changed(); }
        },
        get busy() { return binding.busy; },
        get nativeAssigned() { return !!native && binding.assigned === native; },
        get nativeRenderer() { return binding.assigned?.target.backend === "native"; },
        get destination() { return binding.assigned ? deliveryFor(binding, binding.assigned) : undefined; },
        send(command: PlaybackCommand) {
          if (binding.closed) throw new Error("Playback session closed.");
          if (!binding.assigned) throw new Error("Choose a playback output.");
          if (command.type === "prepare" && binding.assigned !== native) return;
          send(binding, binding.assigned, command);
        },
        observeNative: registry.observeNative,
        register: registry.register,
        registerReceiver: registry.registerReceiver,
        registerGroup: registry.registerGroup,
        async detach(authorize = () => {}, preserveIntent = false) {
          if (binding.busy) throw new Error("Wait for the device change to finish.");
          const source = binding.assigned;
          if (!source) return;
          authorize(); binding.busy = true;
          const original = session().state.player;
          binding.assigned = undefined;
          try {
            if (source.target.connected) await wait(binding, source, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
            else if (source.receiver && now() < source.receiver.unsafeUntil || source.target.kind === "group" && original.playbackId) throw new Error("The previous device cannot confirm it stopped.");
            release(binding, source);
            binding.assigned = { target: { id: "checkpoint", name: "Playback", kind: "endpoint", backend: "native", connected: false }, player: original, send() {}, attempts: new Set() };
            session().rendererDisconnected(preserveIntent ? original.status !== "playing" : undefined);
          } catch (error) { binding.assigned = source; session().rendererDisconnected(); throw error; }
          finally { binding.busy = false; changed(); }
        },
        async move(targetId: string, authorize = () => {}, { takeover = false }: { takeover?: boolean } = {}) {
          if (closed || binding.closed) throw new Error("Couch is shutting down.");
          if (binding.busy) throw new Error("Playback is moving. Wait for it to finish.");
          const destination = endpoints.get(targetId);
          if (!destination?.target.connected) throw new Error("That playback device is disconnected.");
          if (destination === binding.assigned) return;
          const previousOwners = owners(destination, binding);
          if (previousOwners.length && !takeover) throw new Error("That playback output is occupied.");
          if (previousOwners.some(owner => owner.busy)) throw new Error("That playback output is occupied. Wait for its pending operation.");
          if (session().state.player.status === "error") throw new Error("Stop the failed playback attempt before selecting another output.");
          const source = binding.assigned;
          // A backend control outage invalidates its configured buffering bound.
          // Recovery must stop/drain the producer before advertising the group again.
          if (source?.target.kind === "group" && !source.target.connected && !endpoints.get(source.target.id)?.target.connected) throw new Error("Reconnect the audio group before moving playback; its buffered output is uncertain.");
          if (now() < recoveryUntil || source?.receiver && !source.target.connected && now() < source.receiver.unsafeUntil) throw new Error("The previous playback output is stopping. Try again in a few seconds.");
          const original = session().state.player;
          const paused = session().handoffPaused;
          if (original.playbackId && (source && unverified(source) || unverified(destination))) throw new Error("Stop this output before moving playback; it cannot confirm silence.");
          authorize();
          reservations.set(targetId, binding);
          binding.busy = true; changed();
          let prepared = false;
          try {
          for (const owner of previousOwners) { authorize(); await evict(owner, destination); }
          if (closed || binding.closed) throw new Error("Playback session closed.");
          if (claims.get(targetId) === binding && destination !== source && (destination.player.playbackId !== null || destination.player.status !== "idle"))
            await wait(binding, destination, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
          if (!source || !original.playbackId || !["playing", "paused", "unavailable"].includes(original.status)) {
            if (original.status === "loading") throw new Error("Wait for playback to load before moving it.");
            authorize();
            if (original.playbackId && source?.target.connected) await wait(binding, source, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
            source?.attempts.clear();
            if (source) release(binding, source);
            claims.set(targetId, binding);
            binding.assigned = destination; session().selectIdleTarget(destination.player); changed(); return;
          }
          binding.busy = true; binding.changed({ targetId });
          let sourcePaused = false;
          let committed = false;
          let preparedId: string | undefined;
          let previousDelivery: ReturnType<ReturnType<typeof createSession>["commitHandoff"]> | undefined;
          try {
            const { command: load, delivery } = await session().prepareHandoff(deliveryFor(binding, destination));
            preparedId = load.playbackId;
            authorize();
            if (destination.target.backend === "browser") browserCompatible(load);
            prepared = true;
            let ready = await wait(binding, destination, load, player => player.playbackId === load.playbackId && player.status === "paused");
            // Track indices belong to a decoder. Match semantic choices after destination metadata arrives.
            for (const kind of ["audio", "subtitle"] as const) {
              const selected = original.tracks?.find(track => track.kind === kind && track.selected);
              const candidates = ready.tracks?.filter(track => track.kind === kind) ?? [];
              const match = selected && candidates.find(track => (track.language === selected.language && track.label === selected.label)
                || (candidates.length === 1 && original.tracks?.filter(item => item.kind === kind).length === 1 && (!selected.language || !track.language || track.language === selected.language)));
              // Browsers without audioTracks can best-effort play the sole source audio track.
              // Known-empty metadata and explicit choices among multiple tracks still require a match.
              const soleAudioWithUnknownDestination = kind === "audio" && (destination.target.backend === "browser" || destination.target.kind === "group")
                && ready.audioTracksKnown === false && original.tracks?.filter(track => track.kind === "audio").length === 1;
              if (selected && !match && !soleAudioWithUnknownDestination) throw new Error(`The destination cannot preserve the selected ${kind} track. Keep playback here.`);
              if (match && !match.selected || kind === "subtitle" && !selected && candidates.some(track => track.selected)) {
                const index = match?.index ?? -1;
                ready = await wait(binding, destination, { type: "track", playbackId: load.playbackId, kind, index }, player => player.playbackId === load.playbackId && (index === -1 ? !player.tracks?.some(track => track.kind === kind && track.selected) : !!player.tracks?.some(track => track.kind === kind && track.index === index && track.selected)));
              }
            }
            authorize();
            sourcePaused = true;
            if (source.receiver && !source.target.connected && now() < source.receiver.unsafeUntil) throw new Error("The native receiver disconnected while playback was moving. Wait for it to stop before retrying.");
            const checkpoint = source.target.connected
              ? await wait(binding, source, { type: "pause", playbackId: original.playbackId, paused: true }, player => player.playbackId === original.playbackId && player.status === "paused")
              : original;
            if (checkpoint.speed !== undefined && ready.speed !== checkpoint.speed) ready = await wait(binding, destination, { type: "speed", playbackId: load.playbackId, speed: checkpoint.speed }, player => player.playbackId === load.playbackId && player.speed === checkpoint.speed);
            const validRange = (range: PlayerState["seekRange"]) => range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end >= range.start;
            const live = checkpoint.live || ready.live;
            const position = live
              ? checkpoint.live && ready.live && validRange(checkpoint.seekRange) && validRange(ready.seekRange)
                ? Math.max(ready.seekRange!.start, Math.min(ready.seekRange!.end, ready.seekRange!.end - Math.max(0, checkpoint.seekRange!.end - checkpoint.position)))
                : undefined
              : checkpoint.position;
            if (checkpoint.seekable && position !== undefined) {
              if (!ready.seekable) throw new Error("The destination cannot seek this source. Keep playback here.");
              ready = await wait(binding, destination, { type: "seek", playbackId: load.playbackId, position }, player => player.playbackId === load.playbackId && player.status === "paused" && Math.abs(player.position - position) < 1);
            }
            authorize();
            // Source is known paused before the new attempt owns progress or can start.
            claims.set(targetId, binding);
            binding.assigned = destination;
            previousDelivery = session().commitHandoff(ready, delivery);
            committed = true; binding.changed({ targetId });
            if (!paused) await wait(binding, destination, { type: "pause", playbackId: load.playbackId, paused: false }, player => player.playbackId === load.playbackId && player.status === "playing");
            if (source.target.connected) await wait(binding, source, { type: "stop" }, player => player.playbackId === null && player.status === "idle");
            source.attempts.clear(); release(binding, source);
          } catch (error) {
            if (closed || binding.closed) throw error;
            if (committed && destination.player.status === "paused" && destination.player.requiresGesture) {
              // Autoplay refused before making sound. Keep the new session paused for a destination gesture.
              if (source.target.connected) try { await wait(binding, source, { type: "stop" }, player => player.playbackId === null && player.status === "idle"); } catch { /* Source was already confirmed paused. */ }
              throw error;
            }
            // Never resume a source if destination silence is uncertain.
            let silent = !prepared;
            if (prepared) try { await wait(binding, destination, { type: "stop" }, player => player.playbackId === null && player.status === "idle"); silent = true; } catch { /* Keep both sides paused/uncertain. */ }
            try { authorize(); } catch (canceled) {
              // Source configuration may change while destination retirement is pending.
              // Invalidated delivery must never be restored or resumed by rollback.
              if (source.target.connected) try { await wait(binding, source, { type: "stop" }, player => player.playbackId === null && player.status === "idle"); } catch { /* Retain the uncertain source claim. */ }
              throw canceled;
            }
            if (committed && silent && source.target.connected) { binding.assigned = source; session().commitHandoff(source.player, previousDelivery!); }
            if (sourcePaused && silent && source.target.connected && !paused) {
              try { await wait(binding, source, { type: "pause", playbackId: original.playbackId, paused: false }, player => player.playbackId === original.playbackId && player.status === "playing"); } catch { /* Report failure without starting another owner. */ }
            }
            if (!silent && sourcePaused) session().handoffFailed("Playback could not be confirmed. The previous device is paused; stop or retry on the selected device.");
            throw error;
          } finally {
            if (!closed && !binding.closed) {
              if (preparedId && binding.assigned !== destination) session().releaseHandoff(preparedId);
              if (binding.assigned !== source && original.playbackId) session().releaseHandoff(original.playbackId);
            }
            binding.changed(null);
          }
          } finally {
            // A failed prepared destination stays claimed if its silence is unknown.
            if ((reservations.get(targetId) === binding || claims.get(targetId) === binding) && binding.assigned !== destination && prepared && (destination.player.playbackId !== null || destination.player.status !== "idle")) claims.set(targetId, binding);
            else if (binding.assigned !== destination) release(binding, destination);
            if (source && binding.assigned !== source && (source.player.playbackId === null && source.player.status === "idle" || !source.target.connected && !source.receiver && source.target.kind !== "group")) release(binding, source);
            if (reservations.get(targetId) === binding) reservations.delete(targetId);
            binding.busy = false; changed();
          }
        },
      };
      return facade;
    },
  };
  return registry;
}

/** Backwards-compatible household session with installation-wide shutdown. */
export function createPlaybackTargets(nativeSend: Endpoint["send"] | undefined, session: () => Session, options: RegistryOptions = {}) {
  const registry = createPlaybackTargetRegistry(nativeSend, options);
  const targets = registry.bind("household", session, { defaultNative: true, kind: "household" });
  return { ...targets, get busy() { return targets.busy; }, get nativeAssigned() { return targets.nativeAssigned; }, get nativeRenderer() { return targets.nativeRenderer; }, get destination() { return targets.destination; }, close: registry.close };
}
