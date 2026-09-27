import type { Action, BrowserMediaCapabilities, Domain, PlaybackActor,ExternalSubtitle, PlaybackCommand, PlaybackClock, PlayerState, QueueEntry, RadioProgramme, SessionState } from "../shared/protocol";
import type { Store } from "./store";
import { createProgress, playbackMediaId, ViewingError } from "./progress";
import { createRadioRetry } from "./radio-retry";
import { playbackDefault } from "../shared/playback-default";
import type { TvAppearance } from "../shared/appearance";
import { supportsCurrentVideoQuality } from "../shared/video-quality";
import type { WebMediaSource } from "./web-media";
import { UPDATING_PAUSED, RECORDINGS_UNSUPPORTED, QUEUE_FULL, STORAGE_ERROR, PLAY_CANCELED } from "./messages";
import type { PlaybackContinuation } from "./continuation";

type Metadata = Pick<QueueEntry, "thumbnail" | "artworkId" | "duration" | "live" | "kind" | "subtitle" | "description" | "collection"> & { title?: string };
export type MediaSource = { audioOnly?: boolean; source: string; headers?: Record<string, string>; audioSource?: string; maxVideoHeight?: number; startPosition?: number; segment?: { start: number; end: number }; subtitles?: ExternalSubtitle[]; subtitleWarning?: string; metadata?: Metadata; radio?: boolean; goLive?: boolean; eventStart?: boolean; expiry?: WebMediaSource["expiry"] };
type HandoffDelivery = { expiry: MediaSource["expiry"]; webRetried: boolean; audioOnly: boolean; subtitleWarning: string | null };
export type PlaybackDestination = { backend: "native" | "browser"; remote?: boolean; capabilities?: BrowserMediaCapabilities; authorize?: () => void };
type SessionOptions = {
  admitted?: () => boolean;
  transferBusy?: () => boolean;
  validateCommand?: (command: PlaybackCommand) => void;
  nativeTarget?: () => boolean;
  nativeRenderer?: () => boolean;
  resolveSource?: (entry: QueueEntry, playbackId: string, signal: AbortSignal, fromStart: boolean, goLive: boolean, preparing?: boolean, destination?: PlaybackDestination) => MediaSource | Promise<MediaSource>;
  activatePrepared?: (playbackId: string, previous: PlayerState) => void;
  activateHandoff?: (playbackId: string, previous: PlayerState) => void;
  releaseHandoff?: (playbackId: string) => void;
  deactivate?: () => void;
  observe?: (player: PlayerState) => void;
  stopped?: (pendingPlaybackId: string | null) => void;
  now?: () => number;
  systemAudio?: boolean;
  prepareAudio?: () => string;
  resolveContinuation?: (entry: QueueEntry, signal: AbortSignal) => PlaybackContinuation | null | Promise<PlaybackContinuation | null>;
};

export function createSession(store: Store, sendPlayer: (command: PlaybackCommand) => void, publish: (state: SessionState, clock?: PlaybackClock) => void, options: SessionOptions = {}) {
  const removedEntries = new Map<string, { entry: QueueEntry; index: number; queueIds: string[]; currentEntryId: string | null; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  let desiredVolume = store.volume;
  let nativeSystemAudio: SessionState["systemAudio"];
  const nativeTarget = () => options.nativeTarget?.() ?? true;
  const assertNotMoving = () => { if (options.transferBusy?.()) throw new Error("Playback is moving. Wait for it to finish."); };
  let audioInterrupted = false;
  let resolution: AbortController | null = null;
  let qualityResolution: AbortController | null = null;
  let audioOnly = false;
  let prepared: { entryId: string; playbackId: string; currentId: string; key: string; controller: AbortController; sent: boolean } | null = null;
  let subtitleWarning: string | null = null;
  let playIntent = 0;
  let activePlayIntent = 0;
  let expiry: MediaSource["expiry"];
  let webRecovery: { paused: boolean } | null = null;
  let pendingPause: boolean | null = null;
  let pendingSeek: { playbackId: string; position: number; from: number } | null = null;
  let webRetried = false;
  let quiescing = false;
  let continuation = store.playbackContinuation();
  let continuationResolution: AbortController | null = null;
  let continuationManualSources: string[] = [];
  let awaitingContinuation: "ended" | { authorize: () => void; playedBy?: PlaybackActor } | false = false;
  const admitted = () => !quiescing && (options.admitted?.() ?? true);
  const assertAdmitted = () => { if (!admitted()) throw new ViewingError(UPDATING_PAUSED, 503); };
  const radioRetry = createRadioRetry(options.now);
  const activeProfile = store.activeProfile();
  const savedCheckpoint = store.playbackCheckpoint();
  const restoredEntry = savedCheckpoint && store.queue.find(entry => entry.id === savedCheckpoint.entryId && entry.source === savedCheckpoint.source);
  let restoredCheckpoint = !!restoredEntry;
  const state: SessionState = {
    sessionId: store.installationId(),
    queue: store.queue,
    currentEntryId: restoredEntry ? restoredEntry.id : null,
    presentationId: restoredEntry ? savedCheckpoint!.presentationId ?? null : null,
    playedBy: restoredEntry ? savedCheckpoint!.playedBy : undefined,
    queueCursorEntryId: store.queueCursorEntryId(),
    activeProfile,
    installationName: store.installationName(),
    setupStep: store.setupStep(),
    appearance: { size: store.tvInterfaceSize(), confirmedSize: store.tvInterfaceSize(), preview: null },
    administratorClaimed: store.administratorExists(),
    preferences: store.playbackPreferences(activeProfile.id),
    autoplay: { enabled: store.playbackPreferences(activeProfile.id).profile.autoplay !== false, contextTitle: continuation?.title ?? null, next: continuation?.entries[0] ?? null },
    player: { playbackId: null, status: "unavailable", position: 0, duration: null, volume: desiredVolume, seekable: false, error: nativeTarget() ? "The Couch app isn't connected." : "Choose a playback output." },
  };
  if (restoredEntry) state.player = { ...state.player, playbackId: crypto.randomUUID(), position: savedCheckpoint!.position, duration: savedCheckpoint!.duration,
    speed: savedCheckpoint!.speed, seekable: savedCheckpoint!.seekable, tracks: savedCheckpoint!.tracks, audioTracksKnown: savedCheckpoint!.audioTracksKnown,
    error: "Core restarted. Choose a playback output to resume paused." };
  let checkpointAt = -Infinity;
  let checkpointIntent = "";
  let checkpointPresent = !!savedCheckpoint;
  const clearCheckpoint = () => { if (checkpointPresent) store.savePlaybackCheckpoint(null); checkpointPresent = false; checkpointIntent = ""; };
  const saveCheckpoint = (force = false) => {
    const entry = state.queue.find(entry => entry.id === state.currentEntryId);
    if (!entry || !state.player.playbackId || ["idle", "ended"].includes(state.player.status)) { clearCheckpoint(); return; }
    if (!["playing", "paused", "unavailable"].includes(state.player.status)) return;
    const now = options.now?.() ?? Date.now();
    const intent = JSON.stringify([entry.id, state.player.status, state.player.speed, state.player.tracks]);
    if (!force && intent === checkpointIntent && now - checkpointAt < 10_000) return;
    store.savePlaybackCheckpoint({ entryId: entry.id, source: entry.source, position: state.player.position, duration: state.player.duration,
      speed: state.player.speed ?? 1, seekable: state.player.seekable, tracks: state.player.tracks, audioTracksKnown: state.player.audioTracksKnown,
      playedBy: state.playedBy, presentationId: state.presentationId });
    checkpointPresent = true; checkpointAt = now; checkpointIntent = intent;
  };
  let published: Omit<SessionState, "player"> | undefined;
  let publishedPlayer: string | undefined;
  let publishedClock: PlaybackClock | undefined;
  const publishState = (observation = false, suppressClock = false) => {
    const { player, ...rest } = state;
    const { position, duration, ...details } = player;
    const playerDetails = JSON.stringify(details);
    // Session fields are replaced by their owners; native track arrays can be
    // freshly allocated but equal. Never walk or serialize the household queue.
    const clockOnly = observation && published && playerDetails === publishedPlayer
      && Object.keys({ ...published, ...rest }).every(key => Reflect.get(published!, key) === Reflect.get(rest, key));
    const clock = { playbackId: player.playbackId, position, duration };
    if (clockOnly && (suppressClock || position === publishedClock?.position && duration === publishedClock?.duration)) return;
    published = rest; publishedPlayer = playerDetails; publishedClock = clock;
    publish(state, clockOnly ? clock : undefined);
  };
  const broadcast = (observation = false, suppressClock = false) => {
    const enabled = state.preferences?.profile.autoplay !== false;
    const next = continuation?.entries[0] ?? null;
    const pending = continuationResolution !== null;
    if (state.autoplay?.enabled !== enabled || state.autoplay?.next !== next || state.autoplay?.contextTitle !== (continuation?.title ?? null) || (state.autoplay?.pending === true) !== pending) {
      state.autoplay = { enabled, contextTitle: continuation?.title ?? null, next, ...(pending ? { pending: true } : {}) };
    }
    if (state.radioProgramme && (state.radioProgramme.playbackId !== state.player.playbackId || !["playing", "paused"].includes(state.player.status))) state.radioProgramme = null;
    refreshPreparation(); publishState(observation, suppressClock);
  };
  const cancelRadioRetry = () => { radioRetry.cancel(); state.radioRetry = null; };
  const isRadio = (entry: QueueEntry | undefined) => entry?.kind === "radio" || entry?.source.startsWith("radio:") === true;
  const invalidate = (...domains: Domain[]) => {
    if (!admitted()) return;
    if (domains.includes("controllers")) {
      state.installationName = store.installationName();
      state.setupStep = store.setupStep();
      state.administratorClaimed = store.administratorExists();
    }
    const versions = { ...state.versions };
    for (const domain of domains) versions[domain] = (versions[domain] ?? 0) + 1;
    state.versions = versions;
    broadcast();
  };
  // Periodic checkpoints change only history and Continue; a finished viewing
  // also refreshes the resume and watched marks shown in library listings.
  const progress = createProgress(store, final => { if (!quiescing) saveCheckpoint(true); state.progressError = null; if (final) invalidate("progress", "library"); else invalidate("progress"); }, options.now);
  if (restoredEntry) {
    const mediaId = playbackMediaId(restoredEntry);
    progress.begin(restoredEntry, state.player.playbackId!, mediaId ? store.progressOwner(mediaId) ?? activeProfile.id : activeProfile.id, state.playedBy);
  }
  const persistProgress = (save: () => void, required = false) => {
    try { save(); }
    catch {
      state.progressError = STORAGE_ERROR("your progress");
      if (required) { broadcast(); throw new Error(state.progressError); }
    }
  };
  const finishProgress = (nearEnd = false, required = false) => persistProgress(() => progress.finish(nearEnd), required);
  const saveQueue = (queue: SessionState["queue"]) => {
    // If the cursor was removed, keep the boundary at its nearest retained predecessor.
    const cursor = state.queue.findIndex(entry => entry.id === state.queueCursorEntryId);
    const retained = new Set(queue.map(entry => entry.id));
    const cursorEntryId = state.queue.slice(0, cursor + 1).findLast(entry => retained.has(entry.id))?.id ?? null;
    store.saveQueue(queue, cursorEntryId);
    state.queue = queue;
    state.queueRemoval = undefined;
    state.queueCursorEntryId = cursorEntryId;
    state.queueError = null;
    cancelWebRecovery();
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
    if (mediaId && (catalogue || details.subtitle || details.description)) persistProgress(() => {
      if (store.enrichHistorySource(mediaId, source, { ...(details.subtitle ? { subtitle: details.subtitle } : {}), ...(details.description ? { description: details.description } : {}), ...(details.thumbnail ? { thumbnail: details.thumbnail } : {}), ...(catalogue && details.collection ? { collection: details.collection } : {}) })) invalidate("progress");
    });
    const next = { ...entry, ...details, ...(!catalogue && entry.thumbnail && (entry.subtitle || entry.description) ? { thumbnail: entry.thumbnail } : {}), ...(entry.automaticTitle && title ? { title } : {}) };
    if (JSON.stringify(next) === JSON.stringify(entry)) return;
    saveQueue(state.queue.map(entry => entry.id === entryId ? next : entry));
    persistProgress(() => progress.enrichEntry(next));
    broadcast();
  };
  const available = () => {
    assertAdmitted();
    assertNotMoving();
    if (state.player.status === "unavailable") throw new Error(state.player.error || "The playback device isn't connected.");
  };
  const currentPlayback = (playbackId: string) => {
    available();
    if (playbackId !== state.player.playbackId) throw new Error("The playing item changed. Use the current state and try again.");
  };
  const send = (command: PlaybackCommand) => {
    options.validateCommand?.(command);
    try { sendPlayer(command); } catch {
      playIntent++;
      cancelContinuation();
      cancelRadioRetry();
      resolution?.abort();
      qualityResolution?.abort();
      options.deactivate?.();
      finishProgress();
      state.playedBy = undefined;
      state.player = { ...state.player, playbackId: null, status: "unavailable", nowPlaying: null, error: "The Couch app disconnected." };
      broadcast();
      throw new Error("The Couch app disconnected.");
    }
  };
  const cancelPreparation = () => {
    const previous = prepared;
    prepared = null;
    previous?.controller.abort();
    if (previous?.sent && state.player.status !== "unavailable") send({ type: "prepare", playbackId: previous.currentId });
  };
  const refreshPreparation = () => {
    if (audioInterrupted) { if (prepared && !prepared.sent) cancelPreparation(); return; }
    const next = state.currentEntryId ? nextCandidate() : undefined;
    if (options.transferBusy?.() || !nativeTarget() || !admitted() || !audioOnly || !next || !/^(library|jellyfin):/.test(next.source) || activePlayIntent !== playIntent || !state.player.playbackId || !["playing", "paused"].includes(state.player.status)) {
      cancelPreparation();
      return;
    }
    const key = JSON.stringify([state.player.playbackId, next.id, next.source, state.preferences]);
    if (prepared?.key === key) return;
    cancelPreparation();
    const pending = { entryId: next.id, playbackId: crypto.randomUUID(), currentId: state.player.playbackId, key, controller: new AbortController(), sent: false };
    prepared = pending;
    const mediaId = playbackMediaId(next);
    if (mediaId && (store.sharedProgress(mediaId)?.position ?? 0) > 0) return;
    void Promise.resolve().then(() => {
      pending.controller.signal.throwIfAborted();
      return options.resolveSource?.(next, pending.playbackId, pending.controller.signal, false, false, true);
    }).then(media => {
      if (audioInterrupted || prepared !== pending || pending.controller.signal.aborted) return;
      if (!media?.audioOnly || media.segment || media.audioSource || media.startPosition || media.subtitles?.length || media.radio || media.goLive || media.eventStart) {
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
    qualityResolution?.abort();
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
    void Promise.resolve().then(() => { if (!current()) return null; return recover(controller.signal); }).then(fresh => {
      if (!current()) return;
      if (!fresh) throw new Error(failure.error || "This stream failed without a confirmed expiry. Play the track to try again.");
      const { metadata: _metadata, expiry: _expiry, ...media } = fresh;
      webRecovery = null;
      webRetried = true;
      pendingPause = recovery.paused;
      progress.replaceTransport(previous.playbackId, playbackId);
      send({ type: "load", playbackId, ...media, ...(nativeTarget() && options.prepareAudio ? { audioOutput: options.prepareAudio() } : {}), startPosition: previous.position, paused: recovery.paused,
        preferences: { ...state.preferences!.profile, ...(previous.speed !== undefined ? { speed: previous.speed } : {}), ...(previous.replayGain !== undefined ? { replayGain: previous.replayGain } : {}), ...state.preferences!.device } });
      broadcast();
    }).catch(failed);
    return true;
  };
  const failRadio = (error: string, authorize = () => {}, playedBy = state.playedBy) => {
    if (!admitted()) return false;
    const entry = state.queue.find(entry => entry.id === state.currentEntryId);
    if (!isRadio(entry)) return false;
    resolution?.abort();
    qualityResolution?.abort();
    options.deactivate?.();
    finishProgress();
    state.radioRetry = activePlayIntent === playIntent ? radioRetry.schedule(() => {
      if (!admitted()) return;
      try { play(entry!.id, true, true, () => {}, false, playedBy); } catch { /* The attempt already published its failure. */ }
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
  const assertCurrentPlay = (intent: number) => { if (intent !== playIntent) throw new Error(PLAY_CANCELED); };
  const play = (entryId: string, fromStart = false, retry = false, authorize = () => {}, goLive = false, playedBy?: PlaybackActor, selectedEntryIds: string[] = [], proposedQueue = state.queue, context?: PlaybackContinuation | null, preserveContext = false) => {
    authorize();
    available();
    if (nativeTarget()) options.prepareAudio?.();
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
    cancelPreparation();
    progress.finish(true, save => saveQueueCursor(entry.id, true, () => persistProgress(save, true), queue, preserveContext && context === undefined ? continuation : context ?? null));
    persistProgress(clearCheckpoint, true); restoredCheckpoint = false;
    awaitingContinuation = false;
    if (preserveContext && continuationResolution) continuationManualSources.push(entry.source);
    if (!preserveContext) cancelContinuation();
    if (retry) state.radioRetry = { ...state.radioRetry!, retryAt: null };
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
    options.deactivate?.();
    const playbackId = crypto.randomUUID();
    subtitleWarning = null;
    const profileId = state.activeProfile.id;
    const preferences = { ...state.preferences!.profile };
    state.playedBy = undefined;
    state.currentEntryId = entry.id;
    state.presentationId = playbackId;
    state.player = { ...state.player, playbackId, status: "loading", buffering: false, position: 0, duration: null, seekable: false, tracks: [], chapters: [], speed: undefined, replayGain: undefined, audioDelay: undefined, subtitleDelay: undefined, subtitleError: null, nowPlaying: null, error: null };
    broadcast();
    if (!preserveContext && context === undefined && !retry) resolveContinuation(entry);
    const failed = (error: unknown) => {
      if (!admitted() || state.player.playbackId !== playbackId) return;
      const message = error instanceof Error ? error.message : "Couldn't open this source.";
      try { authorize(); if (failRadio(message, authorize, playedBy)) return; } catch { cancelRadioRetry(); }
      resolution?.abort();
      qualityResolution?.abort();
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
        const mediaId = playbackMediaId(currentEntry);
        const position = mediaId && !fromStart ? store.sharedProgress(mediaId)?.position : undefined;
        if (media.startPosition === undefined && position !== undefined && position > 0) media.startPosition = position;
        progress.begin(currentEntry, playbackId, mediaId ? store.progressOwner(mediaId) ?? profileId : profileId, playedBy);
        send({ type: "load", playbackId, ...(nativeTarget() && options.prepareAudio ? { audioOutput: options.prepareAudio() } : {}), ...media, ...(isRadio(currentEntry) ? { radio: true } : {}), preferences: { ...preferences, ...state.preferences!.device } });
        state.playedBy = playedBy ? { ...playedBy } : undefined;
        broadcast();
      };
      if (source instanceof Promise) {
        send({ type: "stop" });
        void source.then(load).catch(failed);
      } else load(source);
    } catch (error) { failed(error); throw error; }
  };
  const changeVideoQuality = async (action: Extract<Action, { type: "videoQuality" }>, authorize: () => void) => {
    currentPlayback(action.playbackId);
    const entry = state.queue.find(entry => entry.id === state.currentEntryId);
    if (audioOnly || !supportsCurrentVideoQuality(entry, state.player) || !options.resolveSource) throw new Error("Quality cannot be changed for this item.");
    qualityResolution?.abort();
    const controller = qualityResolution = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    const intent = playIntent;
    const playbackId = crypto.randomUUID();
    const current = () => admitted() && !signal.aborted && intent === playIntent && state.player.playbackId === action.playbackId
      && state.currentEntryId === entry!.id && ["playing", "paused"].includes(state.player.status);
    try {
      // Resolve while the old stream continues. Stop, Next or another quality choice cancels this request.
      const fresh = await options.resolveSource({ ...entry!, quality: action.quality }, playbackId, signal, false, false);
      if (!current()) throw new Error("Quality change canceled because playback changed.");
      authorize();
      if (fresh.audioOnly || fresh.radio) throw new Error("This source has no video quality to change.");
      const audioOutput = nativeTarget() ? options.prepareAudio?.() : undefined;
      const previous = state.player;
      const paused = pendingPause ?? previous.status === "paused";
      const position = pendingSeek?.playbackId === previous.playbackId ? pendingSeek.position : previous.position;
      const { audioOnly: _audioOnly, metadata: _metadata, expiry: sourceExpiry, subtitleWarning: warning, startPosition: _startPosition, ...media } = fresh;
      const updated = state.queue.map(item => item.id === entry!.id ? { ...item, quality: action.quality } : item);
      saveQueue(updated);
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
      progress.replaceTransport(previous.playbackId, playbackId, state.queue.find(item => item.id === entry!.id));
      send({ type: "load", playbackId, ...media, paused,
        ...(entry!.live || fresh.metadata?.live ? {} : { startPosition: position }),
        ...(audioOutput ? { audioOutput } : {}),
        preferences: { ...state.preferences!.profile, ...(previous.speed === undefined ? {} : { speed: previous.speed }), ...state.preferences!.device } });
      broadcast();
    } finally {
      if (qualityResolution === controller) qualityResolution = null;
    }
  };
  const stop = () => {
    restoredCheckpoint = false;
    try { store.savePlaybackContinuation(null); }
    catch { state.queueError = STORAGE_ERROR("Autoplay"); }
    continuation = null;
    cancelContinuation();
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
    qualityResolution?.abort();
    options.deactivate?.();
    state.playedBy = undefined;
    state.currentEntryId = null;
    state.presentationId = null;
    subtitleWarning = null;
    state.player = { ...state.player, playbackId: null, status: state.player.status === "unavailable" ? "unavailable" : "loading", buffering: false, position: 0, duration: null, seekable: false, tracks: [], chapters: [], speed: undefined, replayGain: undefined, audioDelay: undefined, subtitleDelay: undefined, subtitleError: null, nowPlaying: null, error: state.player.status === "unavailable" ? state.player.error : null };
    persistProgress(clearCheckpoint);
    if (state.player.status !== "unavailable") send({ type: "stop" });
    broadcast();
  };
  const automaticQueue = (entry: QueueEntry) => [...state.queue.slice(-499), entry];
  const advanceNext = (authorize = () => {}, playedBy?: PlaybackActor) => {
    const following = nextCandidate();
    if (!following) return false;
    const manual = state.queue.some(entry => entry.id === following.id);
    if (manual) play(following.id, false, false, authorize, false, playedBy, [], state.queue, afterManualEntry(following), true);
    else play(following.id, false, false, authorize, false, playedBy, [], automaticQueue(following), remainingContinuation());
    return true;
  };
  const next = (authorize = () => {}, playedBy?: PlaybackActor) => {
    if (!advanceNext(authorize, playedBy)) {
      if (continuationResolution && state.preferences?.profile.autoplay !== false) awaitingContinuation = { authorize, playedBy };
      else stop();
    }
  };
  const end = (required: boolean) => {
    persistProgress(() => saveCheckpoint(true), required);
    quiescing = true;
    cancelContinuation();
    cancelPreparation();
    playIntent++;
    cancelRadioRetry();
    resolution?.abort();
    qualityResolution?.abort();
    state.player.playbackId = null;
    state.playedBy = undefined;
    // Stop callbacks first, but keep the dirty observation if its write fails.
    try { finishProgress(false, required); }
    finally { options.deactivate?.(); }
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
    play(added[0]!.id, fromStart, false, authorize, false, playedBy, added.map(entry => entry.id), [...state.queue, ...added], context);
    return added;
  };

  return {
    updateSystemAudio(audio: import("../shared/sound").SoundRouteState) {
      nativeSystemAudio = audio;
      state.systemAudio = nativeTarget() ? audio : undefined;
      if (nativeTarget() && audio.volume !== null) state.player.volume = audio.volume;
      if (admitted()) invalidate("sound"); else broadcast();
    },
    saveAudioDelay(delay: number) {
      assertNotMoving();
      store.saveAudioDelay(delay);
      state.preferences = { ...state.preferences!, device: { audioDelay: delay } };
      if (nativeTarget() && state.player.playbackId && ["loading", "playing", "paused"].includes(state.player.status)) send({ type: "audioDelay", playbackId: state.player.playbackId, delay });
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
        options.deactivate?.();
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
    updateAppearance(appearance: TvAppearance) { state.appearance = appearance; broadcast(); },
    notice(actor: PlaybackActor, text: string) {
      state.activity = { id: crypto.randomUUID(), actor, text };
      try { broadcast(); } finally { state.activity = undefined; }
    },
    updateTargets(targetId: string | undefined, targets: NonNullable<SessionState["targets"]>, handoff: SessionState["handoff"]) {
      state.systemAudio = nativeTarget() ? nativeSystemAudio : undefined;
      state.targetId = targetId; state.targets = targets; state.handoff = handoff; broadcast();
    },
    get restoredCheckpoint() { return restoredCheckpoint; },
    selectIdleTarget(player: PlayerState) { restoredCheckpoint = false; state.player = { ...player, ...(options.systemAudio && nativeTarget() ? { volume: nativeSystemAudio?.volume ?? player.volume } : {}), playbackId: null, status: "idle", error: null }; broadcast(); },
    get handoffPaused() { return pendingPause ?? state.player.status !== "playing"; },
    async prepareHandoff(target: PlaybackDestination | boolean): Promise<{ command: Extract<PlaybackCommand, { type: "load" }>; delivery: HandoffDelivery }> {
      const destination: PlaybackDestination = typeof target === "boolean" ? { backend: target ? "browser" : "native" } : target;
      const browser = destination.backend === "browser";
      const entry = state.queue.find(entry => entry.id === state.currentEntryId);
      if (!entry || !state.player.playbackId) throw new Error("The playing item changed.");
      if (browser && /^(library|recording):/.test(entry.source)) throw new Error("This source is currently available on Couch TV only.");
      cancelPreparation(); qualityResolution?.abort();
      const playbackId = crypto.randomUUID();
      let media: MediaSource;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException("Source resolution timed out.", "TimeoutError")), 15_000);
      try { media = await (options.resolveSource?.(entry, playbackId, controller.signal, false, false, true, destination) ?? { source: entry.source }); }
      catch (error) { options.releaseHandoff?.(playbackId); throw error; }
      finally { clearTimeout(timeout); }
      const { metadata: _metadata, expiry: _expiry, audioOnly: _audioOnly, subtitleWarning: _warning, ...delivery } = media;
      return { delivery: { expiry: media.expiry, webRetried: false, audioOnly: media.audioOnly === true && !media.segment, subtitleWarning: media.subtitleWarning ?? null }, command: { type: "load", ...delivery, playbackId, paused: true,
        ...(!browser && !destination.remote && options.prepareAudio ? { audioOutput: options.prepareAudio() } : {}),
        startPosition: entry.live || media.radio ? undefined : state.player.position,
        preferences: { ...state.preferences!.profile, speed: state.player.speed ?? state.preferences!.profile.speed, audioDelay: browser || destination.remote ? 0 : state.preferences!.device.audioDelay } } };
    },
    commitHandoff(player: PlayerState, delivery: HandoffDelivery) {
      restoredCheckpoint = false;
      options.activateHandoff?.(player.playbackId!, state.player);
      const previous = { expiry, webRetried, audioOnly, subtitleWarning };
      ({ expiry, webRetried, audioOnly, subtitleWarning } = delivery);
      activePlayIntent = playIntent;
      webRecovery = null; state.webRetry = null;
      progress.replaceTransport(state.player.playbackId, player.playbackId!);
      state.player = { ...player, ...(options.systemAudio && nativeTarget() ? { volume: nativeSystemAudio?.volume ?? player.volume } : {}) }; pendingPause = null; pendingSeek = null;
      persistProgress(() => { progress.observe(player); saveCheckpoint(true); }); options.observe?.(player); broadcast();
      return previous;
    },
    releaseHandoff(playbackId: string) { options.releaseHandoff?.(playbackId); },
    rendererDisconnected() {
      persistProgress(() => saveCheckpoint(true));
      persistProgress(progress.checkpoint);
      playIntent++; resolution?.abort(); qualityResolution?.abort(); cancelRadioRetry(); cancelContinuation();
      if (options.transferBusy?.() && state.player.playbackId) options.releaseHandoff?.(state.player.playbackId);
      else options.deactivate?.();
      state.player = { ...state.player, status: "unavailable", error: "The playback device disconnected. Move playback to a connected device to resume." }; broadcast();
    },
    handoffFailed(error: string) { state.player = { ...state.player, status: "error", error }; broadcast(); },
    get state() { return structuredClone(state); },
    enrichEntry,
    loadQueue(entries: QueueEntry[], mode: "append" | "replace" | "play", authorize = () => {}, playedBy?: PlaybackActor, placement?: "next", contextTitle = "Playlist") {
      assertAdmitted();
      assertNotMoving();
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
      send({ type: "addSubtitle", playbackId, ...subtitle });
    },
    playNewEntries,
    reservePlay() {
      available();
      qualityResolution?.abort();
      cancelPreparation();
      if (state.webRetry) { cancelWebRecovery(); broadcast(); }
      if (cancelReconnect("Radio reconnect canceled by a newer playback request.")) broadcast();
      return ++playIntent;
    },
    playIfCurrent(intent: number, entryId: string, fromStart = false, authorize = () => {}, playedBy?: PlaybackActor, selectedEntryIds: string[] = []) {
      assertCurrentPlay(intent);
      play(entryId, fromStart, false, authorize, false, playedBy, selectedEntryIds);
    },
    playHistory(mediaId: string, fromStart = false, authorize = () => {}, playedBy?: PlaybackActor) {
      authorize();
      if (mediaId.startsWith("recording:")) throw new ViewingError(RECORDINGS_UNSUPPORTED, 410);
      available();
      if (!store.sharedProgress(mediaId)) throw new ViewingError("History item not found.", 404);
      const existing = state.queue.find(entry => playbackMediaId(entry) === mediaId);
      const saved = existing ?? store.historySource(mediaId);
      if (!saved || playbackMediaId(saved) !== mediaId) throw new ViewingError("Open this item from its source again.", 409);
      if (!existing && state.queue.length >= 500) throw new ViewingError(QUEUE_FULL, 409);
      const entry = existing ?? { ...saved, id: crypto.randomUUID() };
      if (existing) play(entry.id, fromStart, false, authorize, false, playedBy);
      else playNewEntries([entry], { fromStart, authorize, playedBy });
    },
    close() { if (!quiescing) end(false); },
    checkpoint() { persistProgress(() => { progress.checkpoint(); saveCheckpoint(true); }, true); },
    quiesce() { end(true); },
    invalidate,
    createProfile(name: unknown) {
      assertAdmitted();
      const profile = store.createProfile(name);
      invalidate("library", "progress");
      return profile;
    },
    renameProfile(id: string, name: unknown, expectedName: string) {
      assertAdmitted();
      const profile = store.renameProfile(id, name, expectedName);
      if (state.activeProfile.id === id) state.activeProfile = profile;
      invalidate("library", "progress");
      return profile;
    },
    namePerson(id: string, name: unknown, expectedName: string) {
      assertAdmitted();
      if (id !== state.activeProfile.id) throw new ViewingError("The active history changed on another remote. Reopen Your name before saving.", 409);
      const profile = store.namePerson(id, name, expectedName);
      state.activeProfile = profile;
      invalidate("library", "progress");
      return profile;
    },
    removeProfile(id: string, expectedName: string) {
      assertAdmitted();
      assertNotMoving();
      if (restoredCheckpoint || ["loading", "playing", "paused"].includes(state.player.status)) throw new ViewingError("Stop playback before removing a watching profile. Pausing keeps the current profile.", 409);
      const preferences = id === state.activeProfile.id ? store.playbackPreferences("household") : state.preferences;
      const profile = store.removeProfile(id, expectedName);
      progress.forgetProfile(id);
      if (state.activeProfile.id === id) {
        playIntent++;
        cancelContinuation();
        continuation = null;
        state.activeProfile = profile;
        state.preferences = preferences;
        state.progressError = null;
        cancelRadioRetry();
      }
      invalidate("library", "progress");
      return profile;
    },
    selectProfile(id: string) {
      assertAdmitted();
      assertNotMoving();
      if (restoredCheckpoint || ["loading", "playing", "paused"].includes(state.player.status)) throw new ViewingError("Stop playback before selecting another watching profile.", 409);
      finishProgress(false, true);
      const preferences = store.playbackPreferences(id);
      const profile = store.selectProfile(id);
      playIntent++;
      cancelContinuation();
      continuation = null;
      state.activeProfile = profile;
      state.preferences = preferences;
      cancelRadioRetry();
      invalidate("library", "progress");
      return profile;
    },
    editProgress(mediaId: string, changes: { watched?: boolean; clearResume?: boolean }, item: { title: string; libraryItemId: string | null }) {
      assertAdmitted();
      assertNotMoving();
      if (changes.clearResume && progress.mediaId === mediaId && (restoredCheckpoint || ["loading", "playing", "paused"].includes(state.player.status))) throw new ViewingError("Stop this item before clearing its resume position.", 409);
      store.editSharedProgress(state.activeProfile.id, mediaId, changes, item);
      progress.discard(mediaId);
      invalidate("library", "progress");
    },
    removeHistory(mediaId: string) {
      assertAdmitted();
      assertNotMoving();
      if (progress.mediaId === mediaId && (restoredCheckpoint || ["loading", "playing", "paused"].includes(state.player.status))) throw new ViewingError("Stop this item before removing it from history.", 409);
      const removed = store.takeSharedProgress(mediaId);
      if (!removed.length) throw new ViewingError("History item not found.", 404);
      progress.discard(mediaId);
      invalidate("library", "progress");
      return removed;
    },
    restoreProgress(removed: import("./store").ProgressSnapshot, expected: import("./store").ProgressSnapshot = []) {
      assertAdmitted();
      assertNotMoving();
      if (progress.mediaId === removed[0]?.mediaId && (restoredCheckpoint || ["loading", "playing", "paused"].includes(state.player.status))) throw new ViewingError("Stop this item before restoring its history.", 409);
      store.restoreSharedProgress(removed, expected);
      invalidate("library", "progress");
    },
    command(action: Action, authorize = () => {}, playedBy?: PlaybackActor) {
      assertAdmitted();
      assertNotMoving();
      authorize();
      switch (action.type) {
        case "selectTarget": throw new Error("Select a target through the connected coordinator.");
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
        case "goLive": {
          currentPlayback(action.playbackId);
          const entry = state.queue.find(entry => entry.id === state.currentEntryId);
          if (!entry?.source.startsWith("iptv:")) throw new Error("Go live is only available for the current guide channel.");
          play(entry.id, true, false, authorize, true, playedBy);
          break;
        }
        case "play": play(action.entryId, action.fromStart, false, authorize, false, playedBy); break;
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
          if (!(options.nativeRenderer?.() ?? nativeTarget())) throw new Error("Audio delay is not supported in the browser yet.");
          currentPlayback(action.playbackId);
          if (nativeTarget()) { store.saveAudioDelay(action.delay); state.preferences = { ...state.preferences!, device: { audioDelay: action.delay } }; }
          broadcast();
          send(action);
          break;
        case "pause":
          currentPlayback(action.playbackId);
          if (!action.paused) { if (nativeTarget()) options.prepareAudio?.(); audioInterrupted = false; state.player.error = null; }
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
          if (!["playing", "paused"].includes(state.player.status) || state.player.replayGain === undefined) throw new Error("Volume leveling works on music only.");
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
        case "volume":
          if (nativeTarget()) { store.saveVolume(action.volume); desiredVolume = action.volume; }
          if (state.player.status === "unavailable") {
            state.player.volume = desiredVolume;
            broadcast();
          } else send(action);
          break;
        case "next": currentPlayback(action.playbackId); next(authorize, playedBy); break;
        case "stop": if (action.playbackId !== undefined) currentPlayback(action.playbackId); stop(); break;
        case "enqueueLibrary": case "enqueueAlbum": case "enqueueJellyfin": case "enqueueRadio": case "enqueueWeb": throw new Error("Resolve this catalog item before adding it to the queue.");
      }
    },
    observe(player: PlayerState) {
      if (!admitted()) return;
      if (prepared?.sent && player.playbackId === prepared.playbackId) {
        const next = nextCandidate();
        if (!next || next.id !== prepared.entryId) return;
        const manual = state.queue.some(entry => entry.id === next.id);
        saveQueueCursor(next.id, false, undefined, manual ? state.queue : automaticQueue(next), manual ? afterManualEntry(next) : remainingContinuation());
        awaitingContinuation = false;
        if (manual && continuationResolution) continuationManualSources.push(next.source);
        const previous: PlayerState = { ...state.player, status: "ended", position: state.player.duration ?? state.player.position };
        persistProgress(() => progress.observe(previous));
        options.activatePrepared?.(player.playbackId!, previous);
        resolution?.abort();
        qualityResolution?.abort();
        resolution = prepared.controller;
        prepared = null;
        state.playedBy = undefined;
        state.currentEntryId = next.id;
        state.presentationId = player.playbackId;
        state.player = { ...state.player, playbackId: player.playbackId, status: "loading", buffering: false };
        const mediaId = playbackMediaId(next);
        progress.begin(next, player.playbackId!, mediaId ? store.progressOwner(mediaId) ?? state.activeProfile.id : state.activeProfile.id);
      }
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
      if (state.player.status === "unavailable" && nativeTarget() && player.status === "idle" && player.playbackId === null) state.player.playbackId = null;
      if (player.status !== "unavailable" && player.playbackId !== state.player.playbackId) return;
      const wasUnavailable = state.player.status === "unavailable";
      // libmpv can report EOF after an interrupted HTTP range response. An early
      // VOD end only starts the same private expiry confirmation, never a blind retry.
      const earlyEnd = player.status === "ended" && player.duration !== null && player.position + 2 < player.duration;
      if (earlyEnd && webRetried) player = { ...player, status: "error" };
      const ended = player.status === "ended" && state.player.status !== "ended";
      if (!options.transferBusy?.() && (player.status === "error" || earlyEnd) && recoverWeb(player)) return;
      if (["playing", "paused"].includes(player.status)) {
        if (pendingSeek?.playbackId === player.playbackId && Math.abs(player.position - pendingSeek.position) <= 2
          && (pendingSeek.position < pendingSeek.from ? player.position < pendingSeek.from : pendingSeek.position > pendingSeek.from ? player.position > pendingSeek.from : true)) pendingSeek = null;
        if (pendingPause === (player.status === "paused")) pendingPause = null;
        state.webRetry = null;
      }
      if (player.status === "error" && webRetried) player = { ...player, error: "Stream recovery failed after one attempt. Play the track to try again." };
      if (["error", "unavailable", "idle", "ended"].includes(player.status)) state.webRetry = null;
      if (!options.transferBusy?.() && (player.status === "error" || ended) && isRadio(state.queue.find(entry => entry.id === state.currentEntryId))) {
        options.observe?.(player);
        failRadio(player.error || "The radio stream disconnected.");
        return;
      }
      if (player.status === "unavailable" && !wasUnavailable || ended) { playIntent++; qualityResolution?.abort(); }
      if (player.status === "unavailable") cancelContinuation();
      if (player.status === "unavailable") { cancelRadioRetry(); resolution?.abort(); qualityResolution?.abort(); options.deactivate?.(); }
      if (["unavailable", "error", "idle"].includes(player.status)) { state.playedBy = undefined; finishProgress(); }
      radioRetry.observe(player);
      if (player.status === "playing") state.radioRetry = null;
      const current = state.queue.find(entry => entry.id === state.currentEntryId);
      // Live streams keep growing mpv's demuxer-cache duration. Suppress their
      // clock publications, but still publish any other Session change.
      const suppressClock = (isRadio(current) || current?.live === true) && ["playing", "paused"].includes(player.status);
      state.player = { ...player, ...(options.systemAudio && nativeTarget() ? { volume: state.systemAudio?.volume ?? state.player.volume } : {}), ...(["unavailable", "error", "idle", "ended"].includes(player.status) ? { nowPlaying: null } : {}), ...(subtitleWarning ? { subtitleError: player.subtitleError || subtitleWarning } : {}) };
      try { progress.observe(player); saveCheckpoint(); }
      catch { state.progressError = STORAGE_ERROR("your progress"); }
      options.observe?.(state.player);
      if (nativeTarget() && wasUnavailable && player.status !== "unavailable") send({ type: "volume", volume: options.systemAudio ? 100 : desiredVolume });
      broadcast(true, suppressClock);
      if (ended && !options.transferBusy?.()) {
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
