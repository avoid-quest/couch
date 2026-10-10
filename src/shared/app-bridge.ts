import type { InterfaceSize } from "./appearance";
import type { ConnectionInfo } from "./protocol";
import type { DeviceSharing } from "./device-sharing";
import type { UpdateAction, UpdateChannel, UpdateState } from "./updates";

// Keep the existing type imports usable by older renderer code.
export type { UpdateAction, UpdateChannel, UpdateOutcome, UpdateState, UpdateTarget } from "./updates";

// The Couch app's preload (app/preload.ts) gives its window this bridge to Main (app/main.ts).
// Full mode ("local") hosts Couch on this computer; Client mode ("remote") shows another Couch.
export type AppMode = { mode: "local" | "remote" | null; address: string | null; targets: string[]; localSetupComplete: boolean };
export type CouchApp = {
  tvPresentation: boolean;
  /** Reads, or saves, this computer's name; null until it has one. Older apps lack it. */
  deviceName?(name?: string): Promise<string | null>;
  /** Reads, or saves, what this computer shares with every Couch it joins. Older apps lack it. */
  deviceSharing?(sharing?: DeviceSharing): Promise<DeviceSharing>;
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
  // Legacy methods stay available to older remote renderers. New ones use update.
  installUpdate(version?: string): Promise<void>;
  onUpdates(listener: (state: UpdateState) => void): () => void;
  showLogs(): Promise<void>;
  /** Quits this app and shuts down its Core, even when the system tray is unavailable. */
  quit?(): Promise<void>;
  // The TV's own renderer also plays in Client mode, without a local Core.
  reportPlayback?(status: import("./protocol").PlayerState["status"]): Promise<void>;
};
