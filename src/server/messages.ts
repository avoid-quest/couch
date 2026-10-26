// Server messages that reach the app UI. Copy rules: docs/design.md#copy.
export const ADMIN_ONLY = "Only an admin can do this.";
export const NO_LONGER_ADMIN = "You're no longer an admin.";
export const CHANGED_ELSEWHERE = "Someone else changed this. Refresh and try again.";
export const QUEUE_FULL = "Up next is full (500). Remove some first.";
export const VERSION_MISMATCH = "This Couch runs a different version. Update one of them.";
export const REMOTES_OFF = (name: string) => `Sharing is off. Turn on Share on network on ${name}.`;
export const STORAGE_ERROR = (thing: string) => `Couldn't save ${thing}. Couch may be out of space.`;
export const PLAY_CANCELED = "Another action canceled playback.";
export const LIVE_AUDIENCE_ONLY = "Live audio listeners can join, leave and adjust their device. Control the programme at its source.";
