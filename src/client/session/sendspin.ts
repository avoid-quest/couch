import type { LiveAudioSettings } from "../../shared/audio-settings";
import type { SendspinPlayer } from "@sendspin/sendspin-js";
import { apiFetch } from "../api/client";
import { waitForTap } from "./renderer";
import type { Credentials } from "./session";
import { storage } from "./device-id";
import { failed } from "../toasts";

// Synced sound (#644 ticket 10): while Core asks, this tab plays its Device's sound with the
// official Sendspin player, with Couch's stable Device ID.
// A tab that shows a synced picture connects too, only for the clock it follows (ticket 11).
let player: Promise<SendspinPlayer> | null = null;
let connected: SendspinPlayer | null = null;
let group: string | undefined;
let hearing = false;
let configuration: string | undefined;
// The SDK's disconnect() clears Media Session, which useMediaSession owns and won't rewrite
// while its inputs are unchanged (a codec change replaces the player mid-Live): keep what it set.
const dispose = (stopped: SendspinPlayer) => {
  const session = navigator.mediaSession, kept = session && { metadata: session.metadata, playbackState: session.playbackState };
  stopped.disconnect("user_request");
  if (session) Object.assign(session, kept);
};
export function listen(on: boolean, watch: boolean, credentials: Credentials | null, name: string, live?: LiveAudioSettings) {
  const next = JSON.stringify([credentials?.origin, credentials?.token, live?.codec]);
  if (!on && !watch || player && configuration !== next) {
    const current = player;
    player = connected = null;
    group = undefined;
    hearing = false;
    configuration = undefined;
    waitForTap(null);
    void current?.then(dispose).catch(() => {});
    if (!on && !watch) return;
  }
  if (!credentials) return;
  configuration = next;
  const hear = on && !hearing;
  hearing = on;
  if (!on) waitForTap(null);
  const current: Promise<SendspinPlayer> = player ??= import("@sendspin/sendspin-js").then(async ({ SendspinPlayer }) => {
    await apiFetch(credentials, "/api/audio/session", { method: "POST", credentials: "include" });
    // Electron ships BoringSSL without ChaCha20-Poly1305; both SDKs support AES-GCM.
    const created = new SendspinPlayer({ suite: "aesgcm", baseUrl: credentials.origin, clientName: name, storage,
      ...live?.codec && live.codec !== "auto" ? { codecs: live.codec === "opus" ? ["opus", "pcm"] : ["pcm"] } : {},
      ...live ? { minBufferMs: live.minBufferMs } : {},
      onStateChange: state => { if (player === current) group = state.groupState.group_id; } });
    if (player !== current) return created;
    connected = created;
    void created.connect().catch(() => {});
    return created;
  }).catch(reason => {
    if (player === current) {
      player = connected = null; group = undefined; hearing = false;
      failed("Couldn't start sound.", reason);
      waitForTap(() => { if (configuration === next) listen(on, watch, credentials, name, live); });
    }
    throw reason;
  });
  void current.then(created => { if (player === current && live) created.setMinBufferMs(live.minBufferMs); }).catch(() => {});
  if (!hear) return;
  void current.then(created => {
    if (player !== current || !hearing) return;
    // A browser that wants a gesture before it plays sound asks for a tap on its own screen (#644).
    let unlocked = false;
    void created.unlock().then(() => { if (player !== current || !hearing) return; unlocked = true; waitForTap(null); }, () => {});
    const retry = () => {
      if (player !== current || !hearing) return;
      void created.unlock().then(() => { if (player === current && hearing) waitForTap(null); }, reason => {
        if (player !== current || !hearing) return;
        failed(reason instanceof Error ? `Couldn't enable sound: ${reason.message}` : "Couldn't enable sound. Check this device's audio output and try again.", reason);
        waitForTap(retry);
      });
    };
    setTimeout(() => { if (!unlocked && player === current && hearing) waitForTap(retry); }, 500);
  }).catch(() => {});
}

// Where the sound of Playback `id` is now, on this Device's synced clock: what a picture follows.
export function soundClock(id: string) {
  const progress = connected?.isConnected && connected.timeSyncInfo.synced && group === id ? connected.trackProgress : null;
  return progress ? { position: progress.positionMs / 1000, speed: progress.playbackSpeed } : null;
}
