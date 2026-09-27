// Server messages that reach the app UI. Copy rules: docs/design.md#copy.
export const ADMIN_ONLY = "Only an admin can do this.";
export const NO_LONGER_ADMIN = "You're no longer an admin.";
export const UPDATING_PAUSED = "Updating. Try again in a minute.";
export const CHANGED_ELSEWHERE = "Someone else changed this. Refresh and try again.";
export const RECORDINGS_UNSUPPORTED = "Recordings aren't supported. Open the file instead.";
export const QUEUE_FULL = "Up next is full (500). Remove some first.";
export const VERSION_MISMATCH = "This Couch runs a different version. Update one of them.";
export const REMOTES_OFF = (name: string) => `Remotes are off. Turn on Allow remotes on ${name}.`;
export const STORAGE_ERROR = (thing: string) => `Couldn't save ${thing}. Couch may be out of space.`;
export const PLAY_CANCELED = "Another action canceled playback.";
export class PlaybackError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
