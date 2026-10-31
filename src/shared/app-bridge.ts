import type { InterfaceSize } from "./appearance";
import type { ConnectionInfo } from "./protocol";
import type { DeviceSharing } from "./device-sharing";
import type { UpdateAction, UpdateChannel, UpdateState } from "./updates";
import type { CaptureKind, CaptureSelection, CaptureSource } from "./capture";

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
  /** Capture starts only in this app's own window. Older apps lack these methods. */
  captureSources?(): Promise<CaptureSource[]>;
  /** Selects one capture request; null cancels a prepared selection. */
  prepareCapture?(selection: CaptureSelection | null): Promise<void>;
  /** Desktop Live microphone capture owned by Main, independent of this page's render loop. */
  liveAudio?(action: import("./capture").LiveAudioAction): Promise<import("./capture").AudioCaptureFormat | undefined>;
  nativeAudioInputs?(): Promise<import("./capture").NativeAudioInput[]>;
  onLiveAudioError?(listener: (error: import("./capture").LiveAudioError) => void): () => void;
  /** What to allow in the system's settings before capturing this kind; null when nothing. */
  captureAccess?(kind: CaptureKind): Promise<string | null>;
  /** Opens the system's setting that allows this kind. */
  openCaptureSettings?(kind: CaptureKind): Promise<void>;
  mode(): Promise<AppMode>;
  // null: the window is loading the chosen Couch.
  choose(mode: "local" | "remote", address: string | null, confirm: boolean): Promise<AppMode | null>;
  forget(address: string): Promise<AppMode | null>;
  completeLocalSetup(): Promise<AppMode>;
  connection(): Promise<ConnectionInfo>;
  interfaceSize(size?: InterfaceSize): Promise<InterfaceSize>;
  onAddresses(listener: (urls: string[]) => void): () => void;
  /** Closing hides the window, which keeps hosting and playing; the page ends its sharing. Older apps lack it. */
  onWindowClosed?(listener: () => void): () => void;
  /** macOS HTML fullscreen resolves before the native window finishes animating. */
  onFullscreenPending?(listener: (pending: boolean) => void): () => void;
  /** Complete native entry before HTML fullscreen; false restores the previous native mode. */
  playerFullscreen?(enter: boolean): Promise<void>;
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
  /** Tells the app that this page's shell mounted; false when it was not this window's current page. Older apps lack it. */
  shellReady?(): Promise<boolean>;
};
