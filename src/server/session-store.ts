import type { Store } from "./store";

// Database lifetime and authorization stay with Core, outside this playback facade.
export function createSessionStore(shared: Store, playback: Store = shared) {
  return {
    queue: playback.queue,
    volume: playback.volume,
    queueCursorEntryId: playback.queueCursorEntryId,
    saveQueue: playback.saveQueue,
    saveQueueCursor: playback.saveQueueCursor,
    saveVolume: playback.saveVolume,
    playbackContinuation: playback.playbackContinuation,
    savePlaybackContinuation: playback.savePlaybackContinuation,
    playbackCheckpoint: playback.playbackCheckpoint,
    savePlaybackCheckpoint: playback.savePlaybackCheckpoint,
    profiles: playback.profiles,
    activeProfile: playback.activeProfile,
    createProfile: playback.createProfile,
    renameProfile: playback.renameProfile,
    namePerson: playback.namePerson,
    removeProfile: playback.removeProfile,
    selectProfile: playback.selectProfile,
    saveProfilePreferences: playback.saveProfilePreferences,
    progress: playback.progress,
    history: playback.history,
    progressOwner: playback.progressOwner,
    sharedProgress: playback.sharedProgress,
    sharedProgressRows: playback.sharedProgressRows,
    sharedHistory: playback.sharedHistory,
    saveProgress: playback.saveProgress,
    editSharedProgress: playback.editSharedProgress,
    takeSharedProgress: playback.takeSharedProgress,
    restoreSharedProgress: playback.restoreSharedProgress,
    historySource: playback.historySource,
    enrichHistorySource: playback.enrichHistorySource,
    installationId: shared.installationId,
    installationName: shared.installationName,
    setupStep: shared.setupStep,
    administratorExists: shared.administratorExists,
    tvInterfaceSize: shared.tvInterfaceSize,
    saveAudioDelay: shared.saveAudioDelay,
    playbackPreferences(profileId: string) {
      return { profile: playback.playbackPreferences(profileId).profile, device: shared.playbackPreferences("household").device };
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
