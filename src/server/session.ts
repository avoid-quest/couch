import type { Action, Domain, PlaybackActor, ExternalSubtitle, PlaybackCommand, PlaybackClock, PlayerState, QueueEntry, RadioProgramme, SessionState } from "../shared/protocol";
import type { HistorySelection, WatchingProfile } from "../shared/viewing";
import type { Store } from "./store";
import { createProgress, playbackMediaId, ViewingError } from "./progress";
import { createRadioRetry } from "./radio-retry";
import { playbackDefault } from "../shared/playback-default";
import { supportsCurrentVideoQuality } from "../shared/video-quality";
import type { WebMediaSource } from "./web-media";
import { QUEUE_FULL, STORAGE_ERROR, PLAY_CANCELED } from "./messages";
import type { PlaybackContinuation } from "./continuation";

type Metadata = Pick<QueueEntry, "thumbnail" | "duration" | "live" | "kind" | "subtitle" | "description" | "collection" | "creator"> & { title?: string };
export type MediaSource = { preview?: WebMediaSource["preview"]; publicNetwork?: boolean; audioOnly?: boolean; mpegts?: boolean; mpv?: boolean; hls?: boolean; hlsSelection?: WebMediaSource["hlsSelection"]; source: string; audioSource?: string; startPosition?: number; subtitles?: ExternalSubtitle[]; subtitleWarning?: string; metadata?: Metadata; radio?: boolean; eventStart?: boolean; expiry?: WebMediaSource["expiry"] };
type SessionOptions = {
  resolveSource?: (entry: QueueEntry, playbackId: string, signal: AbortSignal, fromStart: boolean) => MediaSource | Promise<MediaSource>;
  prepareRecoveredSource?: (media: WebMediaSource, playbackId: string, signal: AbortSignal) => Promise<MediaSource>;
  observe?: (player: PlayerState) => void;
  stopped?: (pendingPlaybackId: string | null) => void;
  // Settings and history belong to every Playback; Core's revision per domain lives in the hub.
  invalidate?: (...domains: Domain[]) => void;
  // The current item moved to a new transport (another quality, or another Device).
  moved?: (from: string | null, to: string) => void;
  // A played item is now current, before this Playback publishes or resolves it.
  entered?: () => void;
  now?: () => number;
  systemAudio?: boolean;
  prepareAudio?: () => string;
  resolveContinuation?: (entry: QueueEntry, signal: AbortSignal) => PlaybackContinuation | null | Promise<PlaybackContinuation | null>;
};

// One Playback (#644 ticket 9): its queue, current item, position, pause state, speed and tracks.
// `store` is Core's store with this Playback's own saved queue (store.playback(id)).
export type PlaybackStore = Store & ReturnType<Store["playback"]>;
// Up next shows this many of the entries Autoplay will play.
const AUTOPLAY_PREVIEW = 10;
export function createSession(store: PlaybackStore, sendPlayer: (command: PlaybackCommand) => void, publish: (state: SessionState, clock?: PlaybackClock) => void, options: SessionOptions = {}) {
  const removedEntries = new Map<string, { entry: QueueEntry; index: number; queueIds: string[]; currentEntryId: string | null; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  let audioInterrupted = false;
  let resolution: AbortController | null = null;
  let qualityResolution: AbortController | null = null;
  let audioOnly = false;
  let subtitleWarning: string | null = null;
  let playIntent = 0;
  let activePlayIntent = 0;
  let expiry: MediaSource["expiry"];
  // Subtitle files added while this item plays; they move with it.
  let addedSubtitles: ExternalSubtitle[] = [];
  let webRecovery: { paused: boolean } | null = null;
  let pendingPause: boolean | null = null;
  let pendingSeek: { playbackId: string; position: number; from: number } | null = null;
  let webRetried = false;
  let quiescing = false;
  let continuation = store.playbackContinuation();
  let continuationResolution: AbortController | null = null;
  let continuationManualSources: string[] = [];
  let awaitingContinuation: "ended" | { authorize: () => void; playedBy?: PlaybackActor } | false = false;
  const admitted = () => !quiescing;
  const assertAdmitted = () => { if (!admitted()) throw new ViewingError("Couch is closing.", 503); };
  const radioRetry = createRadioRetry(options.now);
  const activeProfile = store.activeProfile();
  const state: SessionState = {
    queue: store.queue,
    currentEntryId: null,
    presentationId: null,
    queueCursorEntryId: store.queueCursorEntryId(),
    activeProfile,
    preferences: store.playbackPreferences(activeProfile.id),
    autoplay: { enabled: store.playbackPreferences(activeProfile.id).profile.autoplay !== false, contextTitle: continuation?.title ?? null, upcoming: continuation?.entries.slice(0, AUTOPLAY_PREVIEW) ?? [] },
    player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null },
  };
  let published: Omit<SessionState, "player"> | undefined;
  let publishedPlayer: string | undefined;
  let publishedClock: PlaybackClock | undefined;
  const publishState = (observation = false, suppressClock = false) => {
    const { player, ...rest } = state;
    const { position, duration, ...details } = player;
    const playerDetails = JSON.stringify(details);
    // Session fields are replaced by their owners; reported track arrays can be
    // freshly allocated but equal. Never walk or serialize this Playback's queue.
    const clockOnly = observation && published && playerDetails === publishedPlayer
      && Object.keys({ ...published, ...rest }).every(key => Reflect.get(published!, key) === Reflect.get(rest, key));
    const clock = { playbackId: player.playbackId, position, duration };
    if (clockOnly && (suppressClock || position === publishedClock?.position && duration === publishedClock?.duration)) return;
    published = rest; publishedPlayer = playerDetails; publishedClock = clock;
    publish(state, clockOnly ? clock : undefined);
  };
  const broadcast = (observation = false, suppressClock = false) => {
    const enabled = state.preferences?.profile.autoplay !== false;
    const upcoming = continuation?.entries.slice(0, AUTOPLAY_PREVIEW) ?? [];
    const pending = continuationResolution !== null;
    // Ids name continuation entries; equal ids keep the published object, so unchanged autoplay sends no snapshot.
    if (state.autoplay?.enabled !== enabled || state.autoplay.upcoming.map(entry => entry.id).join() !== upcoming.map(entry => entry.id).join() || state.autoplay.contextTitle !== (continuation?.title ?? null) || (state.autoplay.pending === true) !== pending) {
      state.autoplay = { enabled, contextTitle: continuation?.title ?? null, upcoming, ...(pending ? { pending: true } : {}) };
    }
    if (state.radioProgramme && (state.radioProgramme.playbackId !== state.player.playbackId || !["playing", "paused"].includes(state.player.status))) state.radioProgramme = null;
    publishState(observation, suppressClock);
  };
  const cancelRadioRetry = () => { radioRetry.cancel(); state.radioRetry = null; };
  const isRadio = (entry: QueueEntry | undefined) => entry?.kind === "radio" || entry?.source.startsWith("radio:") === true;
  const invalidate = (...domains: Domain[]) => { if (admitted()) options.invalidate?.(...domains); };
  const progress = createProgress(store, () => { state.progressError = null; invalidate("progress"); }, options.now);
  const persistProgress = (save: () => void, required = false) => {
    try { save(); }
    catch {
      state.progressError = STORAGE_ERROR("your progress");
      if (required) { broadcast(); throw new Error(state.progressError); }
    }
  };
  const finishProgress = (nearEnd = false, required = false) => persistProgress(() => progress.finish(nearEnd), required);
  const saveQueue = (queue: SessionState["queue"], cancelRecovery = true) => {
    // If the cursor was removed, keep the boundary at its nearest retained predecessor.
    const cursor = state.queue.findIndex(entry => entry.id === state.queueCursorEntryId);
    const retained = new Set(queue.map(entry => entry.id));
    const cursorEntryId = state.queue.slice(0, cursor + 1).findLast(entry => retained.has(entry.id))?.id ?? null;
    store.saveQueue(queue, cursorEntryId);
    state.queue = queue;
    state.queueRemoval = undefined;
    state.queueCursorEntryId = cursorEntryId;
    state.queueError = null;
    if (cancelRecovery) cancelWebRecovery();
  };
  const saveQueueCursor = (entryId: string, required = true, beforeCommit?: () => void, queue = state.queue, context = continuation) => {
    let completingProgress = false;
    try { store.saveQueueCursor(entryId, () => {
      if (queue !== state.queue) store.saveQueue(queue, entryId);
      if (context !== continuation) store.savePlaybackContinuation(context);
      completingProgress = true; beforeCommit?.(); completingProgress = false;
    }); state.queueError = null; }
    catch (error) {
      if (completingProgress) throw error;
      state.queueError = STORAGE_ERROR("your place in Up next");
      if (required) { broadcast(); throw new Error(state.queueError); }
    }
    state.queue = queue;
    state.queueCursorEntryId = entryId;
    continuation = context;
  };
  const nextCandidate = () => {
    const index = state.queue.findIndex(entry => entry.id === state.currentEntryId);
    return state.queue[index + 1] ?? (state.preferences?.profile.autoplay !== false ? continuation?.entries[0] : undefined);
  };
  const remainingContinuation = () => continuation ? { ...continuation, entries: continuation.entries.slice(1) } : null;
  const afterManualEntry = (entry: QueueEntry) => continuation?.entries[0]?.source === entry.source ? remainingContinuation() : continuation;
  const cancelContinuation = () => { continuationResolution?.abort(); continuationResolution = null; continuationManualSources = []; awaitingContinuation = false; };
  const resolveContinuation = (entry: QueueEntry) => {
    if (!options.resolveContinuation) return;
    const controller = new AbortController();
    const manualSources: string[] = [];
    continuationManualSources = manualSources;
    continuationResolution = controller;
    broadcast();
    void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return options.resolveContinuation!(entry, controller.signal); }).then(context => {
      if (!admitted() || controller.signal.aborted || continuationResolution !== controller) return;
      let consumed = 0;
      for (const source of manualSources) if (context?.entries[consumed]?.source === source) consumed++;
      const remaining = context && consumed ? { ...context, entries: context.entries.slice(consumed) } : context;
      store.savePlaybackContinuation(remaining);
      continuation = remaining;
      continuationResolution = null;
      const advance = awaitingContinuation;
      awaitingContinuation = false;
      broadcast();
      if (advance === "ended" && state.player.status === "ended") advanceNext();
      else if (advance && typeof advance === "object" && !["error", "unavailable"].includes(state.player.status)) {
        advance.authorize();
        if (!advanceNext(advance.authorize, advance.playedBy)) stop();
      }
    }).catch(() => {
      if (continuationResolution !== controller) return;
      const advance = awaitingContinuation;
      continuationResolution = null;
      awaitingContinuation = false;
      if (!admitted()) return;
      if (advance && typeof advance === "object" && !["error", "unavailable"].includes(state.player.status)) {
        try { advance.authorize(); stop(); } catch { /* A revoked controller cannot stop playback. */ }
      }
      broadcast();
      // Missing sequence metadata never interrupts the item the user chose.
    });
  };
  const enrichEntry = (entryId: string, source: string, metadata: Metadata, catalogue = false) => {
    assertAdmitted();
    const entry = state.queue.find(entry => entry.id === entryId && entry.source === source);
    if (!entry) return;
    const { title, ...details } = metadata;
    if (details.collection && entry.collection) details.collection = entry.collection;
    const mediaId = playbackMediaId(entry);
    if (mediaId && (catalogue || details.subtitle || details.description || details.creator)) persistProgress(() => {
      if (store.enrichHistorySource(mediaId, source, { ...(details.creator ? { creator: details.creator } : {}), ...(details.subtitle ? { subtitle: details.subtitle } : {}), ...(details.description ? { description: details.description } : {}), ...(details.thumbnail ? { thumbnail: details.thumbnail } : {}), ...(catalogue && details.collection ? { collection: details.collection } : {}) })) invalidate("progress");
    });
    const next = { ...entry, ...details, ...(!catalogue && entry.thumbnail && (entry.subtitle || entry.description) ? { thumbnail: entry.thumbnail } : {}), ...(entry.automaticTitle && title ? { title } : {}) };
    if (JSON.stringify(next) === JSON.stringify(entry)) return;
    saveQueue(state.queue.map(entry => entry.id === entryId ? next : entry));
    persistProgress(() => progress.enrichEntry(next));
    broadcast();
  };
  const available = () => {
    assertAdmitted();
    if (state.player.status === "unavailable") throw new Error(state.player.error ?? "Nothing is playing this.");
  };
  const currentPlayback = (playbackId: string) => {
    available();
    if (playbackId !== state.player.playbackId) throw new Error("The playing item changed. Use the current state and try again.");
  };
  let loaded: Extract<PlaybackCommand, { type: "load" }> | null = null;
  // Errors finish the active progress record; retry retains the original viewing owner and actor.
  let progressContext: { profileId: string; playedBy?: PlaybackActor } | undefined;
  const send = (command: PlaybackCommand) => {
    if (command.type === "load") {
      const entry = state.queue.find(item => item.id === state.currentEntryId);
      if (entry?.live || isRadio(entry) || command.radio) command = { ...command, preferences: { ...command.preferences!, speed: 1 } };
      loaded = command;
    }
    try { sendPlayer(command); } catch (error) {
      playIntent++;
      cancelContinuation();
      cancelRadioRetry();
      resolution?.abort();
      qualityResolution?.abort();
      finishProgress();
      state.playedBy = undefined;
      const message = error instanceof Error ? error.message : "The Device playing this disconnected.";
      state.player = { ...state.player, playbackId: null, status: "unavailable", nowPlaying: null, error: message };
      broadcast();
      throw new Error(message);
    }
  };
  const cancelReconnect = (message: string) => {
    if (!state.radioRetry || state.player.status !== "loading") return false;
    cancelRadioRetry();
    resolution?.abort();
    qualityResolution?.abort();
    state.player = { ...state.player, playbackId: crypto.randomUUID(), status: "error", nowPlaying: null, error: message };
    send({ type: "stop" });
    return true;
  };
  const cancelWebRecovery = () => {
    if (!state.webRetry) return;
    const loadingNative = !webRecovery;
    webRecovery = null;
    playIntent++;
    awaitingContinuation = false;
    resolution?.abort();
    qualityResolution?.abort();
    state.webRetry = null;
    state.player = { ...state.player, playbackId: crypto.randomUUID(), status: "error", error: "Canceled. Play it again." };
    if (loadingNative) send({ type: "stop" });
  };
  const recoverWeb = (failure: PlayerState) => {
    if (!expiry || Date.now() < expiry.at || activePlayIntent !== playIntent) return false;
    const recover = expiry.recover;
    expiry = undefined; // One replacement transport per explicit Play, including failed checks.
    const previous = state.player;
    const recovery = { paused: pendingPause ?? previous.status === "paused" };
    webRecovery = recovery;
    resolution?.abort();
    qualityResolution?.abort();
    const controller = resolution = new AbortController();
    const intent = playIntent;
    const playbackId = crypto.randomUUID();
    state.webRetry = { paused: recovery.paused };
    state.player = { ...previous, playbackId, status: "loading", buffering: false, error: null };
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
    void Promise.resolve().then(() => { if (!current()) return null; return recover(controller.signal); }).then(async fresh => !current() ? null : fresh && options.prepareRecoveredSource ? options.prepareRecoveredSource(fresh, playbackId, controller.signal) : fresh).then(fresh => {
      if (!current()) return;
      if (!fresh) throw new Error(failure.error || "This stream failed without a confirmed expiry. Play the track to try again.");
      const { metadata: _metadata, expiry: _expiry, headers: _headers, publicNetwork: _publicNetwork, ...media } = fresh as MediaSource & { headers?: Record<string, string> };
      webRecovery = null;
      webRetried = true;
      pendingPause = recovery.paused;
      progress.replaceTransport(previous.playbackId, playbackId);
      options.prepareAudio?.();
      send({ type: "load", playbackId, ...media, startPosition: previous.position, paused: recovery.paused,
        preferences: { ...state.preferences!.profile, ...(previous.speed !== undefined ? { speed: previous.speed } : {}), ...state.preferences!.device } });
      broadcast();
    }).catch(failed);
    return true;
  };
  const failRadio = (error: string, _authorize = () => {}, playedBy = state.playedBy) => {
    if (!admitted()) return false;
    const entry = state.queue.find(entry => entry.id === state.currentEntryId);
    if (!isRadio(entry)) return false;
    resolution?.abort();
    qualityResolution?.abort();
    finishProgress();
    state.radioRetry = activePlayIntent === playIntent ? radioRetry.schedule(() => {
      if (!admitted()) return;
      try { play(entry!.id, true, "retry", () => {}, playedBy); } catch { /* The attempt already published its failure. */ }
    }) : null;
    // Ignore all later player reports and controls for the failed load, including Stop's idle acknowledgement.
    state.player = {
      ...state.player, playbackId: crypto.randomUUID(), status: state.radioRetry?.retryAt != null ? "loading" : "error",
      nowPlaying: null, seekable: false, tracks: [], chapters: [],
      error: state.radioRetry && state.radioRetry.retryAt === null ? `${error} Reconnect failed after ${state.radioRetry.maximum} retries. Play the station to try again.` : error,
    };
    try { send({ type: "stop" }); } catch { return true; }
    broadcast();
    return true;
  };
  const assertCurrentPlay = (intent: number) => { if (intent !== playIntent) throw new Error(PLAY_CANCELED); };
  const play = (entryId: string, fromStart = false, reason: "play" | "next" | "retry" = "play", authorize = () => {}, playedBy?: PlaybackActor, selectedEntryIds: string[] = [], proposedQueue = state.queue, context?: PlaybackContinuation | null, preserveContext = false) => {
    authorize();
    available();
    options.prepareAudio?.();
    audioInterrupted = false;
    const entry = proposedQueue.find(entry => entry.id === entryId);
    if (!entry) throw new Error("That queue entry no longer exists.");
    const index = proposedQueue.indexOf(entry);
    const cursor = proposedQueue.findIndex(item => item.id === (state.currentEntryId ?? state.queueCursorEntryId));
    // Play now moves the chosen item or explicit album ahead of waiting entries.
    // Replaying history moves only that entry to the boundary, keeping older plays out of Up next.
    const selected = new Set([entryId, ...selectedEntryIds]);
    const waiting = proposedQueue.slice(cursor + 1);
    const queue = index < cursor ? [...proposedQueue.slice(0, cursor + 1).filter(item => item.id !== entryId), entry, ...waiting]
      : index > cursor + 1 ? [...proposedQueue.slice(0, cursor + 1), ...waiting.filter(item => selected.has(item.id)), ...waiting.filter(item => !selected.has(item.id))] : proposedQueue;
    audioOnly = false;
    progress.finish(true, save => saveQueueCursor(entry.id, true, () => persistProgress(save, true), queue, preserveContext && context === undefined ? continuation : context ?? null));
    awaitingContinuation = false;
    if (preserveContext && continuationResolution) continuationManualSources.push(entry.source);
    if (!preserveContext) cancelContinuation();
    if (reason === "retry") state.radioRetry = { ...state.radioRetry!, retryAt: null };
    else cancelRadioRetry();
    activePlayIntent = ++playIntent;
    webRecovery = null;
    state.webRetry = null;
    expiry = undefined;
    pendingPause = null;
    webRetried = false;
    resolution?.abort();
    qualityResolution?.abort();
    resolution = new AbortController();
    const playbackId = crypto.randomUUID();
    subtitleWarning = null;
    addedSubtitles = [];
    const profileId = state.activeProfile.id;
    const preferences = { ...state.preferences!.profile };
    state.playedBy = undefined;
    state.currentEntryId = entry.id;
    state.presentationId = reason === "play" ? playbackId : null;
    state.player = { ...state.player, playbackId, status: "loading", buffering: false, position: 0, duration: null, seekable: false, tracks: [], chapters: [], speed: undefined, audioDelay: undefined, subtitleDelay: undefined, subtitleError: null, nowPlaying: null, error: null };
    options.entered?.();
    broadcast();
    if (!preserveContext && context === undefined && reason !== "retry") resolveContinuation(entry);
    const failed = (error: unknown) => {
      if (!admitted() || state.player.playbackId !== playbackId) return;
      const message = error instanceof Error ? error.message : "Couldn't open this source.";
      try { authorize(); if (failRadio(message, authorize, playedBy)) return; } catch { cancelRadioRetry(); }
      resolution?.abort();
      qualityResolution?.abort();
      try { send({ type: "stop" }); } catch { return; }
      state.player = { ...state.player, status: "error", nowPlaying: null, error: message };
      broadcast();
    };
    try {
      const source = options.resolveSource?.(entry, playbackId, resolution.signal, fromStart) ?? { source: entry.source };
      const load = ({ audioOnly: sourceAudioOnly, metadata, radio, subtitleWarning: warning, expiry: sourceExpiry, ...media }: MediaSource) => {
        if (!admitted() || state.player.playbackId !== playbackId) return;
        audioOnly = sourceAudioOnly === true;
        authorize();
        subtitleWarning = warning ?? null;
        expiry = sourceExpiry;
        if (metadata || radio) enrichEntry(entry.id, entry.source, { ...metadata, ...(radio ? { kind: "radio", live: true } : {}) });
        const currentEntry = state.queue.find(candidate => candidate.id === entry.id)!;
        const mediaId = playbackMediaId(currentEntry);
        const position = mediaId && !fromStart ? store.sharedProgress(mediaId)?.position : undefined;
        if (media.startPosition === undefined && position !== undefined && position > 0) media.startPosition = position;
        progressContext = { profileId: mediaId ? store.progressOwner(mediaId) ?? profileId : profileId, playedBy: playedBy ? { ...playedBy } : undefined };
        progress.begin(currentEntry, playbackId, progressContext.profileId, progressContext.playedBy);
        options.prepareAudio?.();
        send({ type: "load", playbackId, ...media, ...(isRadio(currentEntry) ? { radio: true } : {}), preferences: { ...preferences, ...state.preferences!.device } });
        state.playedBy = playedBy ? { ...playedBy } : undefined;
        broadcast();
      };
      if (source instanceof Promise) {
        send({ type: "stop" });
        void source.then(load).catch(failed);
      } else load(source);
    } catch (error) { failed(error); throw error; }
  };
  // What moves with the current item: its selected tracks and subtitle delay (#644 ticket 9).
  const carried = (player: PlayerState) => {
    const audio = player.tracks?.filter(track => track.kind === "audio") ?? [];
    const subtitles = player.tracks?.filter(track => track.kind === "subtitle") ?? [];
    return {
      ...(audio.length > 1 ? { audioTrack: audio.find(track => track.selected)?.index ?? 0 } : {}),
      ...(subtitles.length ? { subtitleTrack: subtitles.find(track => track.selected)?.index ?? -1 } : {}),
      ...(player.subtitleDelay ? { subtitleDelay: player.subtitleDelay } : {}),
    };
  };
  const withAdded = (subtitles: ExternalSubtitle[] = []) => [...subtitles, ...addedSubtitles.filter(file => !subtitles.some(item => item.source === file.source))];
  // Opens the current item again where it is, for another quality or on the Device it was sent to.
  // The old stream plays until the new one is resolved; Stop, Next or another change cancels it.
  // A stall mid-watch reports "loading" with buffering set (renderer.ts, mpv.ts): the item has started.
  const started = () => ["playing", "paused"].includes(state.player.status) || state.player.status === "loading" && state.player.buffering === true;
  const reopen = async (entry: QueueEntry, authorize: () => void, switchOver: (fresh: MediaSource) => void) => {
    qualityResolution?.abort();
    const controller = qualityResolution = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    const intent = playIntent;
    const previousId = state.player.playbackId;
    const playbackId = crypto.randomUUID();
    const current = () => admitted() && !signal.aborted && intent === playIntent && state.player.playbackId === previousId
      && state.currentEntryId === entry.id && started();
    try {
      const fresh = await options.resolveSource!(entry, playbackId, signal, false);
      if (!current()) throw new Error("Playback changed. Try again.");
      authorize();
      switchOver(fresh);
      options.prepareAudio?.();
      const previous = state.player;
      const paused = pendingPause ?? previous.status === "paused";
      const position = pendingSeek?.playbackId === previous.playbackId ? pendingSeek.position : previous.position;
      const { audioOnly: _audioOnly, metadata: _metadata, expiry: sourceExpiry, subtitleWarning: warning, startPosition: _startPosition, ...media } = fresh;
      resolution?.abort();
      resolution = controller;
      qualityResolution = null;
      activePlayIntent = ++playIntent;
      awaitingContinuation = false;
      webRecovery = null;
      state.webRetry = null;
      webRetried = false;
      expiry = sourceExpiry;
      pendingPause = paused;
      subtitleWarning = warning ?? null;
      state.player = { ...previous, playbackId, status: "loading", buffering: false, error: null, tracks: [], chapters: [] };
      progress.replaceTransport(previous.playbackId, playbackId, state.queue.find(item => item.id === entry.id));
      options.moved?.(previous.playbackId, playbackId);
      send({ type: "load", playbackId, ...media, subtitles: withAdded(media.subtitles), paused, ...carried(previous),
        ...(entry.live || fresh.metadata?.live ? {} : { startPosition: position }),
        preferences: { ...state.preferences!.profile, ...(previous.speed === undefined ? {} : { speed: previous.speed }), ...state.preferences!.device } });
      broadcast();
    } finally {
      if (qualityResolution === controller) qualityResolution = null;
    }
  };
  const changeVideoQuality = async (action: Extract<Action, { type: "videoQuality" }>, authorize: () => void) => {
    currentPlayback(action.playbackId);
    const entry = state.queue.find(entry => entry.id === state.currentEntryId);
    if (audioOnly || !supportsCurrentVideoQuality(entry, state.player) || !options.resolveSource) throw new Error("Quality cannot be changed for this item.");
    await reopen({ ...entry!, quality: action.quality }, authorize, fresh => {
      if (fresh.audioOnly || fresh.radio) throw new Error("This source has no video quality to change.");
      saveQueue(state.queue.map(item => item.id === entry!.id ? { ...item, quality: action.quality } : item));
    });
  };
  const stop = () => {
    try { store.savePlaybackContinuation(null); }
    catch { state.queueError = STORAGE_ERROR("Autoplay"); }
    continuation = null;
    cancelContinuation();
    audioOnly = false;
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
    qualityResolution?.abort();
    state.playedBy = undefined;
    state.currentEntryId = null;
    state.presentationId = null;
    subtitleWarning = null;
    addedSubtitles = [];
    state.player = { ...state.player, playbackId: null, status: state.player.status === "unavailable" ? "unavailable" : "loading", buffering: false, position: 0, duration: null, seekable: false, tracks: [], chapters: [], speed: undefined, audioDelay: undefined, subtitleDelay: undefined, subtitleError: null, nowPlaying: null, error: state.player.status === "unavailable" ? state.player.error : null };
    if (state.player.status !== "unavailable") send({ type: "stop" });
    broadcast();
  };
  const automaticQueue = (entry: QueueEntry) => [...state.queue.slice(-499), entry];
  const advanceNext = (authorize = () => {}, playedBy?: PlaybackActor) => {
    const following = nextCandidate();
    if (!following) return false;
    const manual = state.queue.some(entry => entry.id === following.id);
    if (manual) play(following.id, false, "next", authorize, playedBy, [], state.queue, afterManualEntry(following), true);
    else play(following.id, false, "next", authorize, playedBy, [], automaticQueue(following), remainingContinuation());
    return true;
  };
  const next = (authorize = () => {}, playedBy?: PlaybackActor) => {
    if (!advanceNext(authorize, playedBy)) {
      if (continuationResolution && state.preferences?.profile.autoplay !== false) awaitingContinuation = { authorize, playedBy };
      else stop();
    }
  };
  const end = (required: boolean) => {
    quiescing = true;
    cancelContinuation();
    playIntent++;
    cancelRadioRetry();
    resolution?.abort();
    qualityResolution?.abort();
    state.player.playbackId = null;
    state.playedBy = undefined;
    finishProgress(false, required);
  };

  const playNewEntries = (entries: QueueEntry[], { intent, fromStart = false, authorize = () => {}, playedBy, continuation: context }: { intent?: number; fromStart?: boolean; authorize?: () => void; playedBy?: PlaybackActor; continuation?: PlaybackContinuation | null } = {}) => {
    assertAdmitted();
    authorize();
    if (intent !== undefined) assertCurrentPlay(intent);
    if (!entries.length) throw new Error("This playlist is empty. Add items before playing it.");
    if (state.queue.length + entries.length > 500) throw new Error(QUEUE_FULL);
    const ids = new Set(state.queue.map(entry => entry.id));
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error("That queue entry already exists.");
      ids.add(entry.id);
    }
    const added = entries.map(entry => ({ ...entry, addedBy: playedBy ? { ...playedBy } : entry.addedBy }));
    play(added[0]!.id, fromStart, "play", authorize, playedBy, added.map(entry => entry.id), [...state.queue, ...added], context);
    return added;
  };

  return {
    updateSystemAudio(audio: import("../shared/sound").SoundRouteState) {
      state.systemAudio = audio;
      if (audio.volume !== null) state.player.volume = audio.volume;
      if (admitted()) invalidate("sound"); else broadcast();
    },
    saveAudioDelay(delay: number) {
      store.saveAudioDelay(delay);
      state.preferences = { ...state.preferences!, device: { audioDelay: delay } };
      if (state.player.playbackId && ["loading", "playing", "paused"].includes(state.player.status)) send({ type: "audioDelay", playbackId: state.player.playbackId, delay });
      broadcast();
    },
    audioLost(error: string) {
      if (!admitted() || audioInterrupted) return;
      cancelContinuation();
      audioInterrupted = true;
      webRecovery = null; state.webRetry = null; expiry = undefined; webRetried = false; pendingPause = null;
      playIntent++; cancelRadioRetry(); resolution?.abort(); qualityResolution?.abort(); finishProgress();
      if (state.player.playbackId && state.player.seekable && ["playing", "paused"].includes(state.player.status)) {
        send({ type: "audioPause" });
        state.player = { ...state.player, status: "paused", error };
      } else {
        state.player = { ...state.player, playbackId: crypto.randomUUID(), status: "error", nowPlaying: null, error };
        send({ type: "stop" });
      }
      broadcast();
    },
    updateRadioProgramme(playbackId: string, programme: RadioProgramme | null) {
      if (!admitted() || playbackId !== state.player.playbackId || !["playing", "paused"].includes(state.player.status)) return;
      if (state.radioProgramme === programme) return;
      state.radioProgramme = programme;
      broadcast();
    },
    // The newest tab of an output Device took over, or an output came back online: the current
    // item loads there where it is (#644 Tabs, Offline).
    reload(media?: Pick<MediaSource, "source" | "audioSource" | "hls">, retry = false) {
      const { playbackId, status, position, speed } = state.player;
      if (!loaded || loaded.playbackId !== playbackId || !["loading", "playing", "paused"].includes(status) && !(retry && status === "error")) return;
      const entry = state.queue.find(entry => entry.id === state.currentEntryId);
      const live = loaded.radio || entry?.live;
      if (retry && status === "error" && entry && progressContext) {
        progress.begin(entry, loaded.playbackId, progressContext.profileId, progressContext.playedBy);
        state.playedBy = progressContext.playedBy ? { ...progressContext.playedBy } : undefined;
      }
      const { startPosition: _start, ...command } = { ...loaded, ...media };
      send({ ...command, ...(live ? {} : { startPosition: position }), paused: pendingPause ?? status === "paused", subtitles: withAdded(command.subtitles), ...carried(state.player), ...(speed ? { preferences: { ...command.preferences!, speed } } : {}) });
    },
    // No output is online: the Playback pauses where it is and waits (#644 Offline). The wait
    // supersedes a Play its output never confirmed; only a later Play resumes it.
    wait(message: string) {
      if (!["loading", "playing", "paused"].includes(state.player.status)) return;
      pendingPause = null;
      state.player = { ...state.player, status: "paused", buffering: false, error: message };
      broadcast();
    },
    // Solo (#644 ticket 9): `switchOver` hands the outputs to another Device, and the current
    // item continues there where it was, with its pause state, speed, tracks and delays.
    async move(switchOver: () => void, authorize = () => {}) {
      assertAdmitted();
      const entry = state.queue.find(item => item.id === state.currentEntryId);
      if (entry && state.player.status === "loading" && !started()) throw new Error("Wait for this item to start, then play it there.");
      if (!entry || !loaded || !started() || !options.resolveSource) { switchOver(); broadcast(); return; }
      await reopen(entry, authorize, switchOver);
    },
    // The watching profile and its preferences are shared by every Playback.
    viewing(profile: WatchingProfile, preferences: SessionState["preferences"], reset = false) {
      state.activeProfile = profile;
      state.preferences = preferences;
      if (reset) { playIntent++; cancelContinuation(); continuation = null; state.progressError = null; cancelRadioRetry(); }
      broadcast();
    },
    // A rename reaches every place that shows a Device's name.
    renamed() {
      const renamed = (actor: PlaybackActor) => {
        const name = store.device(actor.deviceId)?.name;
        return name && name !== actor.name ? { ...actor, name } : actor;
      };
      if (state.playedBy) state.playedBy = renamed(state.playedBy);
      if (progressContext?.playedBy) progressContext.playedBy = renamed(progressContext.playedBy);
      if (state.queue.some(entry => entry.addedBy && renamed(entry.addedBy) !== entry.addedBy)) {
        state.queue = state.queue.map(entry => entry.addedBy ? { ...entry, addedBy: renamed(entry.addedBy) } : entry);
        try { store.saveQueue(state.queue, state.queueCursorEntryId); } catch { /* The saved queue keeps the old name until its next save. */ }
      }
      broadcast();
    },
    busy: (mediaId?: string) => ["loading", "playing", "paused"].includes(state.player.status) && (mediaId === undefined || progress.mediaId === mediaId),
    forget(mediaId: string) { progress.discard(mediaId); },
    forgetProfile(id: string) { progress.forgetProfile(id); if (progressContext?.profileId === id) progressContext = undefined; },
    finish() { finishProgress(false, true); },
    notice(actor: PlaybackActor, text: string, kind?: NonNullable<SessionState["activity"]>["kind"]) {
      const activity = state.activity = { id: crypto.randomUUID(), actor, text, kind };
      broadcast();
      // The hub sends state on its next turn, so the activity stays until then: cleared at once, it never left.
      setImmediate(() => { if (state.activity === activity) state.activity = undefined; });
    },
    // Ephemeral inputs disappear from Up next when capture ends, including removed-entry Undo.
    endSource(sourceId: string) {
      let changed = false;
      for (const [token, removed] of removedEntries) if (removed.entry.liveSourceId === sourceId) {
        clearTimeout(removed.timer); removedEntries.delete(token);
        if (state.queueRemoval?.token === token) { state.queueRemoval = undefined; changed = true; }
      }
      if (!state.queue.some(entry => entry.liveSourceId === sourceId)) { if (changed) broadcast(); return; }
      const current = state.queue.find(entry => entry.id === state.currentEntryId)?.liveSourceId === sourceId;
      saveQueue(state.queue.filter(entry => entry.liveSourceId !== sourceId), current);
      if (current) stop(); else broadcast();
    },
    get state() { return structuredClone(state); },
    enrichEntry,
    loadQueue(entries: QueueEntry[], mode: "append" | "replace" | "play", authorize = () => {}, playedBy?: PlaybackActor, placement?: "next", contextTitle = "Playlist") {
      assertAdmitted();
      authorize();
      if (mode === "play") {
        available();
        if (!entries.length) throw new Error("This playlist is empty. Add items before playing it.");
      }
      if (entries.length + (mode === "append" ? state.queue.length : 0) > 500) throw new Error(QUEUE_FULL);
      const added = entries.map(entry => ({ ...entry, id: crypto.randomUUID(), ...(playedBy ? { addedBy: { ...playedBy } } : {}) }));
      if (mode === "play") {
        try { playNewEntries(added.slice(0, 1), { fromStart: true, authorize, playedBy, continuation: { title: contextTitle, entries: added.slice(1) } }); }
        catch (error) {
          if (state.currentEntryId === added[0]!.id && !state.radioRetry) stop();
          throw error;
        }
      } else {
        if (mode === "replace") persistProgress(progress.checkpoint, true);
        const cursor = state.queue.findIndex(entry => entry.id === (state.currentEntryId ?? state.queueCursorEntryId));
        saveQueue(mode === "append" ? placement === "next" ? [...state.queue.slice(0, cursor + 1), ...added, ...state.queue.slice(cursor + 1)] : [...state.queue, ...added] : added);
        if (mode === "replace") stop();
        else broadcast();
      }
      return added;
    },
    addSubtitle(playbackId: string, subtitle: { source: string; title: string; language?: string }) {
      currentPlayback(playbackId);
      if (!["playing", "paused"].includes(state.player.status)) throw new Error("Wait for this item to finish loading before adding subtitles.");
      addedSubtitles = [...addedSubtitles, subtitle];
      send({ type: "addSubtitle", playbackId, ...subtitle });
    },
    playNewEntries,
    reservePlay() {
      available();
      qualityResolution?.abort();
      if (state.webRetry) { cancelWebRecovery(); broadcast(); }
      if (cancelReconnect("Radio reconnect canceled by a newer playback request.")) broadcast();
      return ++playIntent;
    },
    playIfCurrent(intent: number, entryId: string, fromStart = false, authorize = () => {}, playedBy?: PlaybackActor, selectedEntryIds: string[] = []) {
      assertCurrentPlay(intent);
      play(entryId, fromStart, "play", authorize, playedBy, selectedEntryIds);
    },
    playHistory(mediaId: string, fromStart = false, authorize = () => {}, playedBy?: PlaybackActor, selection?: HistorySelection) {
      authorize();
      available();
      if (!store.sharedProgress(mediaId)) throw new ViewingError("History item not found.", 404);
      const existing = state.queue.find(entry => playbackMediaId(entry) === mediaId);
      const saved = existing ?? store.historySource(mediaId);
      if (!saved || playbackMediaId(saved) !== mediaId) throw new ViewingError("Open this item from its source again.", 409);
      if ((!existing || selection) && state.queue.length >= 500) throw new ViewingError(QUEUE_FULL, 409);
      const entry = existing && !selection ? existing : { ...saved, id: crypto.randomUUID(), ...(selection ? { collection: selection.collection, ...(selection.quality ? { quality: selection.quality } : {}) } : {}) };
      if (existing && !selection) play(entry.id, fromStart, "play", authorize, playedBy);
      else playNewEntries([entry], { fromStart, authorize, playedBy });
    },
    close() { if (!quiescing) end(false); },
    invalidate,
    command(action: Action, authorize = () => {}, playedBy?: PlaybackActor) {
      assertAdmitted();
      authorize();
      switch (action.type) {
        case "enqueue":
          if (action.playNow) available();
          if (state.queue.length >= 500) throw new Error(QUEUE_FULL);
          if (state.queue.some(entry => entry.id === action.entry.id)) throw new Error("That queue entry already exists.");
          const entry = { ...action.entry, title: action.entry.title.trim(), addedBy: playedBy ? { ...playedBy } : undefined };
          const cursor = state.queue.findIndex(item => item.id === (state.currentEntryId ?? state.queueCursorEntryId));
          if (action.playNow) playNewEntries([entry], { fromStart: true, authorize, playedBy });
          else {
            saveQueue(action.placement === "next" ? [...state.queue.slice(0, cursor + 1), entry, ...state.queue.slice(cursor + 1)] : [...state.queue, entry]);
            broadcast();
          }
          break;
        case "remove": {
          const index = state.queue.findIndex(entry => entry.id === action.entryId);
          if (index === -1) throw new Error("That queue entry no longer exists.");
          const entry = state.queue[index]!;
          saveQueue(state.queue.filter(entry => entry.id !== action.entryId));
          const token = crypto.randomUUID();
          const expiresAt = Date.now() + 6_000;
          const timer = setTimeout(() => removedEntries.delete(token), 6_000);
          timer.unref?.();
          removedEntries.set(token, { entry, index, queueIds: state.queue.map(entry => entry.id), currentEntryId: state.currentEntryId === action.entryId ? null : state.currentEntryId, expiresAt, timer });
          state.queueRemoval = { entryId: action.entryId, token };
          if (state.currentEntryId === action.entryId) stop();
          else broadcast();
          break;
        }
        case "restoreRemoved": {
          const removed = removedEntries.get(action.token);
          if (!removed || Date.now() >= removed.expiresAt) throw new Error("Undo expired. Check the current queue.");
          if (state.currentEntryId !== removed.currentEntryId || state.queue.length !== removed.queueIds.length || state.queue.some((entry, index) => entry.id !== removed.queueIds[index]) || state.queue.length >= 500) throw new Error("Up next or playback changed. Try again.");
          const queue = [...state.queue];
          queue.splice(removed.index, 0, removed.entry);
          saveQueue(queue);
          clearTimeout(removed.timer);
          removedEntries.delete(action.token);
          broadcast();
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
        case "videoQuality": return changeVideoQuality(action, authorize);
        case "play": play(action.entryId, action.fromStart, "play", authorize, playedBy); break;
        case "preferences": case "savePlaybackDefault": {
          if (action.profileId !== state.activeProfile.id) throw new Error("The watching profile changed. Use the current state and try again.");
          if (action.type === "savePlaybackDefault") currentPlayback(action.playbackId);
          const patch = action.type === "preferences" ? action.preferences : playbackDefault(state.player, action.setting);
          if (!patch) throw new Error("Can't save this as a default.");
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
          pendingSeek = { playbackId: action.playbackId, position, from: state.player.position };
          progress.seek(position);
          break;
        case "mute": throw new Error("Mute isn't available on this Couch.");
        case "next": currentPlayback(action.playbackId); next(authorize, playedBy); break;
        case "stop": if (action.playbackId !== undefined) currentPlayback(action.playbackId); stop(); break;
        case "enqueueRadio": case "enqueueWeb": throw new Error("Resolve this catalog item before adding it to the queue.");
      }
    },
    observe(player: PlayerState) {
      if (!admitted()) return;
      // Native Stop can acknowledge the retired source while another source is still resolving.
      if (player.status === "idle" && player.playbackId === null) options.stopped?.(["loading", "playing", "paused"].includes(state.player.status) ? state.player.playbackId : null);
      if (player.status === "unavailable") audioInterrupted = false;
      if (audioInterrupted) {
        if (player.playbackId === state.player.playbackId && player.status === "paused") {
          const paused = { ...player, volume: state.player.volume };
          state.player = { ...paused, error: state.player.error };
          publishState(true);
          persistProgress(() => progress.observe(paused));
          options.observe?.(paused);
        }
        return;
      }
      if (player.status !== "unavailable" && player.playbackId !== state.player.playbackId) return;
      const wasUnavailable = state.player.status === "unavailable";
      // A player can report EOF after an interrupted HTTP range response. An early
      // VOD end only starts the same private expiry confirmation, never a blind retry.
      const earlyEnd = player.status === "ended" && player.duration !== null && player.position + 2 < player.duration;
      if (earlyEnd && webRetried) player = { ...player, status: "error" };
      const ended = player.status === "ended" && state.player.status !== "ended";
      if ((player.status === "error" || earlyEnd) && recoverWeb(player)) return;
      if (["playing", "paused"].includes(player.status)) {
        if (pendingSeek?.playbackId === player.playbackId && Math.abs(player.position - pendingSeek.position) <= 2
          && (pendingSeek.position < pendingSeek.from ? player.position < pendingSeek.from : pendingSeek.position > pendingSeek.from ? player.position > pendingSeek.from : true)) pendingSeek = null;
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
      if (player.status === "unavailable" && !wasUnavailable || ended) { playIntent++; qualityResolution?.abort(); }
      if (player.status === "unavailable") cancelContinuation();
      if (player.status === "unavailable") { cancelRadioRetry(); resolution?.abort(); qualityResolution?.abort(); }
      if (["unavailable", "error", "idle"].includes(player.status)) { state.playedBy = undefined; finishProgress(); }
      radioRetry.observe(player);
      if (player.status === "playing") state.radioRetry = null;
      const current = state.queue.find(entry => entry.id === state.currentEntryId);
      // A live stream's duration grows with every playlist reload. Suppress its
      // clock publications, but still publish any other Session change.
      const suppressClock = (isRadio(current) || current?.live === true) && ["playing", "paused"].includes(player.status);
      state.player = { ...player, ...(options.systemAudio ? { volume: state.systemAudio?.volume ?? state.player.volume } : {}), ...(["unavailable", "error", "idle", "ended"].includes(player.status) ? { nowPlaying: null } : {}), ...(subtitleWarning ? { subtitleError: player.subtitleError || subtitleWarning } : {}) };
      try { progress.observe(player); }
      catch { state.progressError = STORAGE_ERROR("your progress"); }
      options.observe?.(state.player);
      broadcast(true, suppressClock);
      if (ended) {
        const manual = state.queue[state.queue.findIndex(entry => entry.id === state.currentEntryId) + 1];
        try {
          if (manual || !earlyEnd) {
            if (!advanceNext() && continuationResolution && state.preferences?.profile.autoplay !== false) awaitingContinuation = "ended";
          }
        } catch { /* Keep the ended item visible if its progress cannot be saved. */ }
      }
    },
  };
}
