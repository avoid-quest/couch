import type { Action, ExternalSubtitle, PlaybackCommand, PlayerState, QueueEntry, SessionState } from "../shared/protocol";
import type { Store } from "./store";
import { createProgress, localMediaId, ViewingError } from "./progress";
import { createRadioRetry } from "./radio-retry";
import { playbackDefault } from "../shared/playback-default";
import type { TvAppearance } from "../shared/appearance";
import type { WebMediaSource } from "./web-media";

type Metadata = Pick<QueueEntry, "thumbnail" | "artworkId" | "duration" | "live" | "kind"> & { title?: string };
export type MediaSource = { audioOnly?: boolean; source: string; headers?: Record<string, string>; audioSource?: string; maxVideoHeight?: number; startPosition?: number; segment?: { start: number; end: number }; subtitles?: ExternalSubtitle[]; subtitleWarning?: string; metadata?: Metadata; radio?: boolean; goLive?: boolean; expiry?: WebMediaSource["expiry"] };
type SessionOptions = {
  admitted?: () => boolean;
  resolveSource?: (entry: QueueEntry, playbackId: string, signal: AbortSignal, fromStart: boolean, goLive: boolean, preparing?: boolean) => MediaSource | Promise<MediaSource>;
  activatePrepared?: (playbackId: string, previous: PlayerState) => void;
  deactivate?: () => void;
  observe?: (player: PlayerState) => void;
  stopped?: (pendingPlaybackId: string | null) => void;
  now?: () => number;
  systemAudio?: boolean;
  prepareAudio?: () => string;
};

export function createSession(store: Store, sendPlayer: (command: PlaybackCommand) => void, publish: (state: SessionState) => void, options: SessionOptions = {}) {
  let desiredVolume = store.volume;
  let audioInterrupted = false;
  let resolution: AbortController | null = null;
  let audioOnly = false;
  let prepared: { entryId: string; playbackId: string; currentId: string; key: string; controller: AbortController; sent: boolean } | null = null;
  let subtitleWarning: string | null = null;
  let playIntent = 0;
  let activePlayIntent = 0;
  let expiry: MediaSource["expiry"];
  let webRecovery: { paused: boolean } | null = null;
  let webAuthorize = () => {};
  let pendingPause: boolean | null = null;
  let webRetried = false;
  let quiescing = false;
  const admitted = () => !quiescing && (options.admitted?.() ?? true);
  const assertAdmitted = () => { if (!admitted()) throw new ViewingError("The TV is preparing an update. Controls are paused.", 503); };
  const radioRetry = createRadioRetry(options.now);
  const activeProfile = store.activeProfile();
  const state: SessionState = {
    queue: store.queue,
    currentEntryId: null,
    activeProfile,
    installationName: store.installationName(),
    appearance: { size: store.tvInterfaceSize(), confirmedSize: store.tvInterfaceSize(), preview: null },
    administratorClaimed: store.administratorExists(),
    preferences: store.playbackPreferences(activeProfile.id),
    player: { playbackId: null, status: "unavailable", position: 0, duration: null, volume: desiredVolume, seekable: false, error: "The desktop player is not connected." },
  };
  const broadcast = () => { refreshPreparation(); publish(state); };
  const cancelRadioRetry = () => { radioRetry.cancel(); state.radioRetry = null; };
  const isRadio = (entry: QueueEntry | undefined) => entry?.kind === "radio" || entry?.source.startsWith("radio:") === true;
  const invalidate = (kind: "library" | "radio" | "iptv" | "recordings" | "provider" | "jellyfin" | "playlist" | "controller") => {
    if (!admitted()) return;
    if (kind === "controller") {
      state.installationName = store.installationName();
      state.administratorClaimed = store.administratorExists();
    }
    const field = `${kind}Version` as const;
    state[field] = (state[field] ?? 0) + 1;
    broadcast();
  };
  const progress = createProgress(store, () => { state.progressError = null; invalidate("library"); }, options.now);
  const persistProgress = (save: () => void, required = false) => {
    try { save(); }
    catch {
      state.progressError = "Could not save viewing progress. Check the TV's storage.";
      if (required) { broadcast(); throw new Error(state.progressError); }
    }
  };
  const finishProgress = (nearEnd = false, required = false) => persistProgress(() => progress.finish(nearEnd), required);
  const saveQueue = (queue: SessionState["queue"]) => {
    store.saveQueue(queue);
    state.queue = queue;
    cancelWebRecovery();
  };
  const enrichEntry = (entryId: string, source: string, metadata: Metadata) => {
    assertAdmitted();
    const entry = state.queue.find(entry => entry.id === entryId && entry.source === source);
    if (!entry) return;
    const { title, ...details } = metadata;
    const next = { ...entry, ...details, ...(entry.automaticTitle && title ? { title } : {}) };
    if (JSON.stringify(next) === JSON.stringify(entry)) return;
    saveQueue(state.queue.map(entry => entry.id === entryId ? next : entry));
    broadcast();
  };
  const available = () => {
    assertAdmitted();
    if (state.player.status === "unavailable") throw new Error("The desktop player is not connected.");
  };
  const currentPlayback = (playbackId: string) => {
    available();
    if (playbackId !== state.player.playbackId) throw new Error("The playing item changed. Use the current state and try again.");
  };
  const send = (command: PlaybackCommand) => {
    try { sendPlayer(command); } catch {
      playIntent++;
      cancelRadioRetry();
      resolution?.abort();
      options.deactivate?.();
      finishProgress();
      state.player = { ...state.player, playbackId: null, status: "unavailable", nowPlaying: null, error: "The desktop player disconnected." };
      broadcast();
      throw new Error("The desktop player disconnected.");
    }
  };
  const cancelPreparation = () => {
    const previous = prepared;
    prepared = null;
    previous?.controller.abort();
    if (previous?.sent && state.player.status !== "unavailable") send({ type: "prepare", playbackId: previous.currentId });
  };
  const refreshPreparation = () => {
    const index = state.queue.findIndex(entry => entry.id === state.currentEntryId);
    const next = index >= 0 ? state.queue[index + 1] : undefined;
    if (!admitted() || !audioOnly || !next || !/^(library|jellyfin):/.test(next.source) || activePlayIntent !== playIntent || !state.player.playbackId || !["playing", "paused"].includes(state.player.status)) {
      cancelPreparation();
      return;
    }
    const key = JSON.stringify([state.player.playbackId, next.id, next.source, state.preferences]);
    if (prepared?.key === key) return;
    cancelPreparation();
    const pending = { entryId: next.id, playbackId: crypto.randomUUID(), currentId: state.player.playbackId, key, controller: new AbortController(), sent: false };
    prepared = pending;
    const mediaId = localMediaId(next);
    if (mediaId && (store.progress(state.activeProfile.id, mediaId)?.position ?? 0) > 0) return;
    void Promise.resolve().then(() => {
      pending.controller.signal.throwIfAborted();
      return options.resolveSource?.(next, pending.playbackId, pending.controller.signal, false, false, true);
    }).then(media => {
      if (prepared !== pending || pending.controller.signal.aborted) return;
      if (!media?.audioOnly || media.segment || media.audioSource || media.startPosition || media.subtitles?.length || media.radio || media.goLive) {
        pending.controller.abort();
        return;
      }
      pending.sent = true;
      send({ type: "prepare", playbackId: pending.currentId, next: { playbackId: pending.playbackId, source: media.source, headers: media.headers, preferences: { ...state.preferences!.profile, ...state.preferences!.device } } });
    }).catch(() => {
      // Preparation failure keeps the current song playing. Its ordinary EOF
      // load retains source-specific errors and retry controls.
      pending.controller.abort();
    });
  };
  const cancelReconnect = (message: string) => {
    if (!state.radioRetry || state.player.status !== "loading") return false;
    cancelRadioRetry();
    resolution?.abort();
    options.deactivate?.();
    state.player = { ...state.player, playbackId: crypto.randomUUID(), status: "error", nowPlaying: null, error: message };
    send({ type: "stop" });
    return true;
  };
  const cancelWebRecovery = () => {
    if (!state.webRetry) return;
    const loadingNative = !webRecovery;
    webRecovery = null;
    playIntent++;
    resolution?.abort();
    state.webRetry = null;
    state.player = { ...state.player, playbackId: crypto.randomUUID(), status: "error", error: "Stream recovery canceled by a newer control. Play the track to try again." };
    if (loadingNative) send({ type: "stop" });
  };
  const recoverWeb = (failure: PlayerState) => {
    if (!expiry || Date.now() < expiry.at || activePlayIntent !== playIntent) return false;
    const recover = expiry.recover;
    const authorize = webAuthorize;
    expiry = undefined; // One replacement transport per explicit Play, including failed checks.
    const previous = state.player;
    const recovery = { paused: pendingPause ?? previous.status === "paused" };
    webRecovery = recovery;
    resolution?.abort();
    const controller = resolution = new AbortController();
    const intent = playIntent;
    const playbackId = crypto.randomUUID();
    state.webRetry = { paused: recovery.paused };
    state.player = { ...previous, playbackId, status: "loading", error: null };
    const current = () => admitted() && !controller.signal.aborted && intent === playIntent && state.player.playbackId === playbackId;
    const failed = (error: unknown) => {
      if (!current()) return;
      webRecovery = null;
      state.webRetry = null;
      state.player = { ...state.player, status: "error", error: error instanceof Error ? error.message : "Stream recovery failed. Play the track to try again." };
      broadcast();
    };
    try { send({ type: "stop" }); } catch { return true; }
    broadcast();
    void Promise.resolve().then(() => { if (!current()) return null; authorize(); return recover(controller.signal); }).then(fresh => {
      if (!current()) return;
      authorize();
      if (!fresh) throw new Error(failure.error || "This stream failed without a confirmed expiry. Play the track to try again.");
      const { metadata: _metadata, expiry: _expiry, ...media } = fresh;
      webRecovery = null;
      webRetried = true;
      pendingPause = recovery.paused;
      send({ type: "load", playbackId, ...media, startPosition: previous.position, paused: recovery.paused,
        preferences: { ...state.preferences!.profile, ...(previous.speed !== undefined ? { speed: previous.speed } : {}), ...(previous.replayGain !== undefined ? { replayGain: previous.replayGain } : {}), ...state.preferences!.device } });
      broadcast();
    }).catch(failed);
    return true;
  };
  const failRadio = (error: string, authorize = () => {}) => {
    if (!admitted()) return false;
    const entry = state.queue.find(entry => entry.id === state.currentEntryId);
    if (!isRadio(entry)) return false;
    resolution?.abort();
    options.deactivate?.();
    finishProgress();
    state.radioRetry = activePlayIntent === playIntent ? radioRetry.schedule(() => {
      if (!admitted()) return;
      try { authorize(); } catch (error) {
        cancelRadioRetry();
        state.player = { ...state.player, status: "error", error: error instanceof Error ? error.message : "Radio reconnect canceled. Play the station from a paired remote." };
        broadcast();
        return;
      }
      try { play(entry!.id, true, true, authorize); } catch { /* The attempt already published its failure. */ }
    }) : null;
    // Ignore all later native observations and controls for the failed load, including Stop's idle acknowledgement.
    state.player = {
      ...state.player, playbackId: crypto.randomUUID(), status: state.radioRetry?.retryAt != null ? "loading" : "error",
      nowPlaying: null, seekable: false, tracks: [], chapters: [],
      error: state.radioRetry && state.radioRetry.retryAt === null ? `${error} Reconnect failed after ${state.radioRetry.maximum} retries. Play the station to try again.` : error,
    };
    try { send({ type: "stop" }); } catch { return true; }
    broadcast();
    return true;
  };
  const play = (entryId: string, fromStart = false, retry = false, authorize = () => {}, goLive = false) => {
    authorize();
    available();
    options.prepareAudio?.();
    audioInterrupted = false;
    const entry = state.queue.find(entry => entry.id === entryId);
    if (!entry) throw new Error("That queue entry no longer exists.");
    audioOnly = false;
    cancelPreparation();
    finishProgress(true, true);
    if (retry) state.radioRetry = { ...state.radioRetry!, retryAt: null };
    else cancelRadioRetry();
    activePlayIntent = ++playIntent;
    webRecovery = null;
    state.webRetry = null;
    expiry = undefined;
    webAuthorize = authorize;
    pendingPause = null;
    webRetried = false;
    resolution?.abort();
    resolution = new AbortController();
    options.deactivate?.();
    const playbackId = crypto.randomUUID();
    subtitleWarning = null;
    const profileId = state.activeProfile.id;
    const preferences = { ...state.preferences!.profile };
    state.currentEntryId = entry.id;
    state.player = { ...state.player, playbackId, status: "loading", position: 0, duration: null, seekable: false, tracks: [], chapters: [], speed: undefined, replayGain: undefined, audioDelay: undefined, subtitleDelay: undefined, subtitleError: null, nowPlaying: null, error: null };
    broadcast();
    const failed = (error: unknown) => {
      if (!admitted() || state.player.playbackId !== playbackId) return;
      const message = error instanceof Error ? error.message : "This source could not be opened.";
      try { authorize(); if (failRadio(message, authorize)) return; } catch { cancelRadioRetry(); }
      resolution?.abort();
      options.deactivate?.();
      try { send({ type: "stop" }); } catch { return; }
      state.player = { ...state.player, status: "error", nowPlaying: null, error: message };
      broadcast();
    };
    try {
      const source = options.resolveSource?.(entry, playbackId, resolution.signal, fromStart, goLive) ?? { source: entry.source };
      const load = ({ audioOnly: sourceAudioOnly, metadata, radio, subtitleWarning: warning, expiry: sourceExpiry, ...media }: MediaSource) => {
        if (!admitted() || state.player.playbackId !== playbackId) return;
        audioOnly = sourceAudioOnly === true && !media.segment;
        authorize();
        subtitleWarning = warning ?? null;
        expiry = sourceExpiry;
        if (metadata || radio) enrichEntry(entry.id, entry.source, { ...metadata, ...(radio ? { kind: "radio", live: true } : {}) });
        const currentEntry = state.queue.find(candidate => candidate.id === entry.id)!;
        const mediaId = localMediaId(currentEntry);
        const position = mediaId && !fromStart ? store.progress(profileId, mediaId)?.position : undefined;
        if (position !== undefined && position > 0) media.startPosition = position;
        progress.begin(currentEntry, playbackId, profileId);
        send({ type: "load", playbackId, ...(options.prepareAudio ? { audioOutput: options.prepareAudio() } : {}), ...media, ...(isRadio(currentEntry) ? { radio: true } : {}), preferences: { ...preferences, ...state.preferences!.device } });
      };
      if (source instanceof Promise) {
        send({ type: "stop" });
        void source.then(load).catch(failed);
      } else load(source);
    } catch (error) { failed(error); throw error; }
  };
  const stop = () => {
    audioOnly = false;
    cancelPreparation();
    webRecovery = null;
    state.webRetry = null;
    expiry = undefined;
    webRetried = false;
    pendingPause = null;
    audioInterrupted = false;
    playIntent++;
    cancelRadioRetry();
    finishProgress(true);
    resolution?.abort();
    options.deactivate?.();
    state.currentEntryId = null;
    subtitleWarning = null;
    state.player = { ...state.player, playbackId: null, status: state.player.status === "unavailable" ? "unavailable" : "loading", position: 0, duration: null, seekable: false, tracks: [], chapters: [], speed: undefined, replayGain: undefined, audioDelay: undefined, subtitleDelay: undefined, subtitleError: null, nowPlaying: null, error: state.player.status === "unavailable" ? state.player.error : null };
    if (state.player.status !== "unavailable") send({ type: "stop" });
    broadcast();
  };
  const next = (authorize = () => {}) => {
    const index = state.queue.findIndex(entry => entry.id === state.currentEntryId);
    const following = state.queue[index + 1];
    if (following) play(following.id, false, false, authorize);
    else stop();
  };
  const end = (required: boolean) => {
    quiescing = true;
    cancelPreparation();
    playIntent++;
    cancelRadioRetry();
    resolution?.abort();
    state.player.playbackId = null;
    // Stop callbacks first, but keep the dirty observation if its write fails.
    try { finishProgress(false, required); }
    finally { options.deactivate?.(); }
  };

  return {
    updateSystemAudio(audio: import("../shared/sound").SoundRouteState) {
      state.systemAudio = audio;
      if (audio.volume !== null) state.player.volume = audio.volume;
      broadcast();
    },
    saveAudioDelay(delay: number) {
      store.saveAudioDelay(delay);
      state.preferences = { ...state.preferences!, device: { audioDelay: delay } };
      if (state.player.playbackId && ["loading", "playing", "paused"].includes(state.player.status)) send({ type: "audioDelay", playbackId: state.player.playbackId, delay });
      broadcast();
    },
    audioLost(error: string) {
      if (!admitted() || audioInterrupted) return;
      audioInterrupted = true;
      playIntent++; cancelRadioRetry(); resolution?.abort(); finishProgress();
      if (state.player.playbackId && state.player.seekable && ["playing", "paused"].includes(state.player.status)) {
        send({ type: "pause", playbackId: state.player.playbackId, paused: true });
        state.player = { ...state.player, status: "paused", error };
      } else {
        options.deactivate?.();
        state.player = { ...state.player, playbackId: crypto.randomUUID(), status: "error", nowPlaying: null, error };
        send({ type: "stop" });
      }
      broadcast();
    },
    updateAppearance(appearance: TvAppearance) { state.appearance = appearance; broadcast(); },
    get state() { return structuredClone(state); },
    enrichEntry,
    loadQueue(entries: QueueEntry[], mode: "append" | "replace" | "play", authorize = () => {}) {
      assertAdmitted();
      authorize();
      if (mode === "play") {
        available();
        if (!entries.length) throw new Error("This playlist is empty. Add items before playing it.");
      }
      if (entries.length + (mode === "append" ? state.queue.length : 0) > 500) throw new Error("The queue can hold up to 500 items. Remove some items before loading this playlist.");
      const added = entries.map(entry => ({ ...entry, id: crypto.randomUUID() }));
      if (mode !== "append") persistProgress(progress.checkpoint, true);
      saveQueue(mode === "append" ? [...state.queue, ...added] : added);
      if (mode === "play") {
        try { play(added[0]!.id, true, false, authorize); }
        catch (error) {
          if (state.currentEntryId !== added[0]!.id || !state.radioRetry) stop();
          throw error;
        }
      }
      else if (mode === "replace") stop();
      else broadcast();
      return added;
    },
    addSubtitle(playbackId: string, subtitle: { source: string; title: string; language?: string }) {
      currentPlayback(playbackId);
      if (!["playing", "paused"].includes(state.player.status)) throw new Error("Wait for this item to finish loading before adding subtitles.");
      send({ type: "addSubtitle", playbackId, ...subtitle });
    },
    reservePlay() {
      available();
      cancelPreparation();
      if (state.webRetry) { cancelWebRecovery(); broadcast(); }
      if (cancelReconnect("Radio reconnect canceled by a newer playback request.")) broadcast();
      return ++playIntent;
    },
    playIfCurrent(intent: number, entryId: string, fromStart = false, authorize = () => {}) {
      if (intent !== playIntent) throw new Error("Added to the queue. Playback was canceled by a newer control.");
      play(entryId, fromStart, false, authorize);
    },
    close() { if (!quiescing) end(false); },
    checkpoint() { persistProgress(progress.checkpoint, true); },
    quiesce() { end(true); },
    invalidate,
    createProfile(name: unknown) {
      assertAdmitted();
      const profile = store.createProfile(name);
      invalidate("library");
      return profile;
    },
    renameProfile(id: string, name: unknown, expectedName: string) {
      assertAdmitted();
      const profile = store.renameProfile(id, name, expectedName);
      if (state.activeProfile.id === id) state.activeProfile = profile;
      invalidate("library");
      return profile;
    },
    removeProfile(id: string, expectedName: string) {
      assertAdmitted();
      if (["loading", "playing", "paused"].includes(state.player.status)) throw new ViewingError("Stop playback before removing a watching profile. Pausing keeps the current profile.", 409);
      const preferences = id === state.activeProfile.id ? store.playbackPreferences("household") : state.preferences;
      const profile = store.removeProfile(id, expectedName);
      progress.forgetProfile(id);
      if (state.activeProfile.id === id) {
        playIntent++;
        state.activeProfile = profile;
        state.preferences = preferences;
        state.progressError = null;
        cancelRadioRetry();
      }
      invalidate("library");
      return profile;
    },
    selectProfile(id: string) {
      assertAdmitted();
      if (["loading", "playing", "paused"].includes(state.player.status)) throw new ViewingError("Stop playback before selecting another watching profile.", 409);
      finishProgress(false, true);
      const preferences = store.playbackPreferences(id);
      const profile = store.selectProfile(id);
      playIntent++;
      state.activeProfile = profile;
      state.preferences = preferences;
      cancelRadioRetry();
      invalidate("library");
      return profile;
    },
    editProgress(mediaId: string, changes: { watched?: boolean; clearResume?: boolean }, item: { title: string; libraryItemId: string | null }) {
      assertAdmitted();
      if (changes.clearResume && progress.mediaId === mediaId && ["loading", "playing", "paused"].includes(state.player.status)) throw new ViewingError("Stop this item before clearing its resume position.", 409);
      store.editProgress(state.activeProfile.id, mediaId, changes, item);
      invalidate("library");
    },
    command(action: Action, authorize = () => {}) {
      assertAdmitted();
      authorize();
      switch (action.type) {
        case "enqueue":
          if (action.playNow) available();
          if (state.queue.length >= 500) throw new Error("The queue is full. Remove an item before adding another.");
          if (state.queue.some(entry => entry.id === action.entry.id)) throw new Error("That queue entry already exists.");
          saveQueue([...state.queue, { ...action.entry, title: action.entry.title.trim() }]);
          if (action.playNow) play(action.entry.id, true, false, authorize);
          else broadcast();
          break;
        case "remove": {
          const index = state.queue.findIndex(entry => entry.id === action.entryId);
          if (index === -1) throw new Error("That queue entry no longer exists.");
          saveQueue(state.queue.filter(entry => entry.id !== action.entryId));
          if (state.currentEntryId === action.entryId) stop();
          else broadcast();
          break;
        }
        case "move": {
          const index = state.queue.findIndex(entry => entry.id === action.entryId);
          if (index === -1 || (action.beforeEntryId !== null && !state.queue.some(entry => entry.id === action.beforeEntryId))) throw new Error("The queue changed. Try the move again.");
          if (action.entryId === action.beforeEntryId) break;
          const queue = [...state.queue];
          const [entry] = queue.splice(index, 1);
          const before = action.beforeEntryId === null ? queue.length : queue.findIndex(entry => entry.id === action.beforeEntryId);
          queue.splice(before, 0, entry!);
          saveQueue(queue);
          broadcast();
          break;
        }
        case "goLive": {
          currentPlayback(action.playbackId);
          const entry = state.queue.find(entry => entry.id === state.currentEntryId);
          if (!entry?.source.startsWith("iptv:")) throw new Error("Go live is only available for the current guide channel.");
          play(entry.id, true, false, authorize, true);
          break;
        }
        case "play": play(action.entryId, action.fromStart, false, authorize); break;
        case "preferences": case "savePlaybackDefault": {
          if (action.profileId !== state.activeProfile.id) throw new Error("The watching profile changed. Use the current state and try again.");
          if (action.type === "savePlaybackDefault") currentPlayback(action.playbackId);
          const patch = action.type === "preferences" ? action.preferences : playbackDefault(state.player, action.setting);
          if (!patch) throw new Error("This playback choice cannot be saved as a default. Choose a default in Settings, Playback.");
          const profile = { ...state.preferences!.profile, ...patch };
          store.saveProfilePreferences(action.profileId, profile);
          state.preferences = { ...state.preferences!, profile };
          broadcast();
          break;
        }
        case "audioDelay":
          currentPlayback(action.playbackId);
          store.saveAudioDelay(action.delay);
          state.preferences = { ...state.preferences!, device: { audioDelay: action.delay } };
          broadcast();
          send(action);
          break;
        case "pause":
          currentPlayback(action.playbackId);
          if (!action.paused) { options.prepareAudio?.(); audioInterrupted = false; state.player.error = null; }
          pendingPause = action.paused;
          if (state.webRetry) {
            state.webRetry = { paused: action.paused };
            broadcast();
          }
          if (webRecovery) webRecovery.paused = action.paused;
          else send(action);
          break;
        case "speed": case "subtitleDelay":
          currentPlayback(action.playbackId);
          send(action);
          break;
        case "replayGain":
          currentPlayback(action.playbackId);
          if (!["playing", "paused"].includes(state.player.status) || state.player.replayGain === undefined) throw new Error("ReplayGain is available after supported music finishes loading. Radio and video keep their normal level.");
          send(action);
          break;
        case "track":
          currentPlayback(action.playbackId);
          if (!(action.kind === "subtitle" && action.index === -1) && !state.player.tracks?.some(track => track.kind === action.kind && track.index === action.index)) throw new Error("That track is not available for this item.");
          send(action);
          break;
        case "seek":
          currentPlayback(action.playbackId);
          if (!state.player.seekable) throw new Error("This stream does not support seeking.");
          const position = state.player.duration === null ? action.position : Math.min(action.position, state.player.duration);
          send({ ...action, position });
          progress.seek(position);
          break;
        case "mute": throw new Error("System mute is unavailable on this player.");
        case "volume":
          store.saveVolume(action.volume);
          desiredVolume = action.volume;
          if (state.player.status === "unavailable") {
            state.player.volume = desiredVolume;
            broadcast();
          } else send(action);
          break;
        case "next": currentPlayback(action.playbackId); next(authorize); break;
        case "stop": stop(); break;
        case "enqueueLibrary": case "enqueueAlbum": case "enqueueProviderAlbum": case "enqueueJellyfin": case "enqueueRadio": case "enqueueWeb": throw new Error("Resolve this catalog item before adding it to the queue.");
      }
    },
    observe(player: PlayerState) {
      if (!admitted()) return;
      if (prepared?.sent && player.playbackId === prepared.playbackId) {
        const next = state.queue.find(entry => entry.id === prepared!.entryId);
        if (!next) return;
        const previous: PlayerState = { ...state.player, status: "ended", position: state.player.duration ?? state.player.position };
        persistProgress(() => progress.observe(previous));
        options.activatePrepared?.(player.playbackId!, previous);
        resolution?.abort();
        resolution = prepared.controller;
        prepared = null;
        state.currentEntryId = next.id;
        state.player = { ...state.player, playbackId: player.playbackId, status: "loading" };
        progress.begin(next, player.playbackId!, state.activeProfile.id);
      }
      if (player.status === "unavailable") audioInterrupted = false;
      if (audioInterrupted) {
        if (player.playbackId === state.player.playbackId && player.status === "paused") {
          const paused = { ...player, volume: state.player.volume };
          persistProgress(() => progress.observe(paused));
          options.observe?.(paused);
        }
        return;
      }
      // Native Stop can acknowledge the retired source while another source is still resolving.
      if (player.status === "idle" && player.playbackId === null) options.stopped?.(["loading", "playing", "paused"].includes(state.player.status) ? state.player.playbackId : null);
      if (player.status !== "unavailable" && player.playbackId !== state.player.playbackId) return;
      const wasUnavailable = state.player.status === "unavailable";
      // libmpv can report EOF after an interrupted HTTP range response. An early
      // VOD end only starts the same private expiry confirmation, never a blind retry.
      const earlyEnd = player.status === "ended" && player.duration !== null && player.position + 2 < player.duration;
      if (earlyEnd && webRetried) player = { ...player, status: "error" };
      const ended = player.status === "ended" && state.player.status !== "ended";
      if ((player.status === "error" || earlyEnd) && recoverWeb(player)) return;
      if (["playing", "paused"].includes(player.status)) {
        if (pendingPause === (player.status === "paused")) pendingPause = null;
        state.webRetry = null;
      }
      if (player.status === "error" && webRetried) player = { ...player, error: "Stream recovery failed after one attempt. Play the track to try again." };
      if (["error", "unavailable", "idle", "ended"].includes(player.status)) state.webRetry = null;
      if ((player.status === "error" || ended) && isRadio(state.queue.find(entry => entry.id === state.currentEntryId))) {
        options.observe?.(player);
        failRadio(player.error || "The radio stream disconnected.");
        return;
      }
      if (player.status === "unavailable" && !wasUnavailable || ended) playIntent++;
      if (player.status === "unavailable") { cancelRadioRetry(); resolution?.abort(); options.deactivate?.(); }
      if (["unavailable", "error", "idle"].includes(player.status)) finishProgress();
      radioRetry.observe(player);
      if (player.status === "playing") state.radioRetry = null;
      state.player = { ...player, ...(options.systemAudio ? { volume: state.systemAudio?.volume ?? state.player.volume } : {}), ...(["unavailable", "error", "idle", "ended"].includes(player.status) ? { nowPlaying: null } : {}), ...(subtitleWarning ? { subtitleError: player.subtitleError || subtitleWarning } : {}) };
      try { progress.observe(player); }
      catch { state.progressError = "Could not save viewing progress. Check the TV's storage."; }
      options.observe?.(state.player);
      if (wasUnavailable && player.status !== "unavailable") send({ type: "volume", volume: options.systemAudio ? 100 : desiredVolume });
      broadcast();
      if (ended) {
        const index = state.queue.findIndex(entry => entry.id === state.currentEntryId);
        const following = state.queue[index + 1];
        if (following) {
          try { play(following.id); } catch { /* Keep the ended item visible if its progress cannot be saved. */ }
        }
      }
    },
  };
}
