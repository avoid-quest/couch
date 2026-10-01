import type { InterfaceSize } from "./appearance";
import type { ConnectionInfo } from "./protocol";

// The Couch app's preload (app/preload.ts) gives its window this bridge to Main (app/main.ts).
// Full mode ("local") hosts Couch on this computer; Client mode ("remote") shows another Couch.
export type AppMode = { mode: "local" | "remote" | null; address: string | null; targets: string[]; localSetupComplete: boolean };
// This app's own updates (app/update.ts). "latest" is the stable channel, as in electron-updater.
export type UpdateChannel = "latest" | "preview";
export type UpdateAction = { op: "read" | "check" } | { op: "channel"; channel: UpdateChannel } | { op: "install"; version: string };
export type UpdateTarget = { id: string; name: string; tv: boolean };
export type UpdateState = {
  version: string;
  channel: UpdateChannel;
  status: "idle" | "checking" | "up-to-date" | "downloading" | "ready" | "installing" | "error";
  // The version found, while it downloads, waits or installs.
  available: string | null;
  progress: number | null;
  checkedAt: number | null;
  error: string | null;
  // The TV's root updates: whether setup installed them, and the last run's
  // outcome from /var/lib/couch-update/status (docs/native-tv.md).
  automatic?: { installed: boolean; active?: boolean; last: UpdateOutcome | null };
};
export type UpdateOutcome = {
  version: string | null;
  outcome: "installed" | "installed-unverified" | "rolled-back" | "failed" | "skipped" | "up-to-date" | "waiting";
  at: number;
  error: string | null;
  // The release that last failed to start, which the timer skips.
  failed: string | null;
};
export type CouchApp = {
  tvPresentation: boolean;
  /** Reads, or saves, this computer's name; null until it has one. Older apps lack it. */
  deviceName?(name?: string): Promise<string | null>;
  mode(): Promise<AppMode>;
  // null: the window is loading the chosen Couch.
  choose(mode: "local" | "remote", address: string | null, confirm: boolean): Promise<AppMode | null>;
  forget(address: string): Promise<AppMode | null>;
  completeLocalSetup(): Promise<AppMode>;
  connection(): Promise<ConnectionInfo>;
  interfaceSize(size?: InterfaceSize): Promise<InterfaceSize>;
  onAddresses(listener: (urls: string[]) => void): () => void;
  updates(): Promise<UpdateState>;
  update?(action: UpdateAction): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  setUpdateChannel(channel: UpdateChannel): Promise<UpdateState>;
  // Restarts Couch on the downloaded version.
  installUpdate(): Promise<void>;
  onUpdates(listener: (state: UpdateState) => void): () => void;
  showLogs(): Promise<void>;
  // The TV's own renderer also plays in Client mode, without a local Core.
  reportPlayback?(status: import("./protocol").PlayerState["status"]): Promise<void>;
};
