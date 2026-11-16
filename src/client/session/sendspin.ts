import type { LiveAudioSettings } from "../../shared/audio-settings";
import type { SendspinPlayer } from "@sendspin/sendspin-js";
import { apiFetch } from "../api/client";
import { waitForTap } from "./renderer";
import type { Credentials } from "./session";
import { storage } from "./device-id";
import { failed } from "../toasts";
import { declareLiveBuffer, keepsLosing, withLateSteps } from "./live-buffer";
import { liveReadings } from "../../shared/live-need";

// Synced sound (#644 ticket 10): while Core asks, this tab plays its Device's sound with the
// official Sendspin player, with Couch's stable Device ID.
// A tab that shows a synced picture connects too, only for the clock it follows (ticket 11).
let player: Promise<SendspinPlayer> | null = null;
let connected: SendspinPlayer | null = null;
let group: string | undefined;
let hearing = false;
let configuration: string | undefined;
// The SDK's destroy() clears Media Session, which useMediaSession owns and won't rewrite
// while its inputs are unchanged (a codec change replaces the player mid-Live): keep what it set.
const dispose = (stopped: SendspinPlayer) => {
  const session = navigator.mediaSession,
    kept = session && { metadata: session.metadata, playbackState: session.playbackState };
  stopped.destroy("user_request");
  if (session) Object.assign(session, kept);
};
// On Android, relaxed sound keeps the SDK's estimated clock, its fallback without getOutputTimestamp(), as
// the SDK keeps Cast receivers: their output timestamps make the speed hunt (sendspin-js #85). Live keeps them.
const outputTimestamp =
  typeof AudioContext !== "undefined" && /Android/i.test(navigator.userAgent)
    ? Object.getOwnPropertyDescriptor(AudioContext.prototype, "getOutputTimestamp")
    : undefined;
const useOutputTimestamps = (use: boolean) => {
  if (!outputTimestamp) return;
  const descriptor = use ? outputTimestamp : { ...outputTimestamp, value: undefined };
  Object.defineProperty(AudioContext.prototype, "getOutputTimestamp", descriptor);
};
// The player chains each chunk where the last one ended, between two frames. Chrome then renders the
// frame where they meet without part of it: a one-frame notch per chunk that clicks on loud transients.
// Starting a chunk on its nearest frame moves it by at most half a sample and joins it exactly.
// A chunk the player speeds up or slows down has a fractional length, so it keeps its own start.
// The same place sees late chunks: the player drops one whose start has passed (scheduler.js) and
// counts nothing, and the next chunk then starts after the sound already ran out.
let framesAligned = false;
let played: { context: BaseAudioContext; end: number } | undefined;
let lostSound = false;
const alignStartsToFrames = () => {
  if (framesAligned || typeof AudioBufferSourceNode === "undefined") return;
  framesAligned = true;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (
    this: AudioBufferSourceNode,
    when?: number,
    offset = 0,
    ...rest
  ) {
    const rate = this.context.sampleRate,
      speed = this.playbackRate.value,
      now = this.context.currentTime;
    const aligned = when === undefined || speed !== 1 ? when : Math.round(when * rate) / rate;
    if (played?.context === this.context && played.end < now) lostSound = true;
    const length = this.buffer ? (this.buffer.duration - offset) / speed : 0;
    played = { context: this.context, end: Math.max(aligned ?? now, now) + length };
    return start.call(this, aligned, offset, ...rest);
  };
};
let liveSettings: LiveAudioSettings | undefined;
let bufferScope: string | undefined;
let needMs: number | undefined;
let declaredBufferMs: number | undefined;
let latencyReadings: number[] = [];
let lostSeconds: boolean[] = [];
let lateSteps = 0;
let bufferTimer: ReturnType<typeof setInterval> | undefined;
// sample: add this second's readings. The room's delay is the host's and isn't declared here.
const updateBuffer = (created: SendspinPlayer, sample = false) => {
  if (connected !== created || !liveSettings) return;
  const playing =
    sample && hearing && created.isConnected && created.isPlaying && created.timeSyncInfo.synced;
  const latency = playing ? created.syncInfo.outputLatencyMs : NaN;
  if (Number.isFinite(latency) && latency >= 0)
    latencyReadings = [...latencyReadings, latency].slice(-liveReadings);
  if (playing) lostSeconds = [...lostSeconds, lostSound].slice(-liveReadings);
  if (sample) lostSound = false;
  if (keepsLosing(lostSeconds)) {
    lateSteps++;
    lostSeconds = [];
  }
  needMs = declareLiveBuffer(needMs, latencyReadings);
  const next = needMs === undefined ? undefined : withLateSteps(needMs, lateSteps);
  if (next === undefined || next === declaredBufferMs) return;
  declaredBufferMs = next;
  created.setMinBufferMs(next);
};
export function listen(
  on: boolean,
  watch: boolean,
  credentials: Credentials | null,
  name: string,
  live?: LiveAudioSettings & { sourceId?: string },
) {
  const scope =
    live && (on || watch)
      ? JSON.stringify([credentials?.origin, credentials?.token, live.sourceId])
      : undefined;
  if (scope !== bufferScope) {
    bufferScope = scope;
    latencyReadings = [];
    lostSeconds = [];
    lostSound = false;
    lateSteps = 0;
    needMs = declaredBufferMs = undefined;
  }
  liveSettings = live;
  useOutputTimestamps(Boolean(live));
  const next = JSON.stringify([
    credentials?.origin,
    credentials?.token,
    live?.codec,
    live?.sourceId,
  ]);
  if ((!on && !watch) || (player && configuration !== next)) {
    const current = player;
    player = connected = null;
    group = undefined;
    hearing = false;
    configuration = undefined;
    clearInterval(bufferTimer);
    waitForTap(null);
    void current?.then(dispose).catch(() => {});
    if (!on && !watch) return;
  }
  if (!credentials) return;
  configuration = next;
  const hear = on && !hearing;
  hearing = on;
  if (!on) waitForTap(null);
  const current: Promise<SendspinPlayer> = (player ??= import("@sendspin/sendspin-js")
    .then(async ({ SendspinPlayer }) => {
      alignStartsToFrames();
      await apiFetch(credentials, "/api/audio/session", { method: "POST", credentials: "include" });
      // Electron ships BoringSSL without ChaCha20-Poly1305; both SDKs support AES-GCM.
      const created = new SendspinPlayer({
        suite: "aesgcm",
        url: `${credentials.origin.replace(/^http/, "ws")}/sendspin`,
        clientName: name,
        storage,
        ...(live?.codec && live.codec !== "auto"
          ? { codecs: live.codec === "opus" ? ["opus", "pcm"] : ["pcm"] }
          : {}),
        ...(live ? { minBufferMs: declaredBufferMs ?? 0 } : {}),
        onStateChange: (state) => {
          if (player === current) group = state.groupState.group_id;
        },
      });
      if (player !== current) return created;
      connected = created;
      if (live) bufferTimer = setInterval(() => updateBuffer(created, true), 1000);
      void created.connect().catch(() => {});
      return created;
    })
    .catch((reason) => {
      if (player === current) {
        player = connected = null;
        group = undefined;
        hearing = false;
        clearInterval(bufferTimer);
        failed("Couldn't start sound.", reason);
        waitForTap(() => {
          if (configuration === next) listen(on, watch, credentials, name, live);
        });
      }
      throw reason;
    }));
  void current
    .then((created) => {
      if (player === current) updateBuffer(created);
    })
    .catch(() => {});
  if (!hear) return;
  void current
    .then((created) => {
      if (player !== current || !hearing) return;
      // A browser that wants a gesture before it plays sound asks for a tap on its own screen (#644).
      let unlocked = false;
      void created.unlock().then(
        () => {
          if (player !== current || !hearing) return;
          unlocked = true;
          waitForTap(null);
        },
        () => {},
      );
      const retry = () => {
        if (player !== current || !hearing) return;
        void created.unlock().then(
          () => {
            if (player === current && hearing) waitForTap(null);
          },
          (reason) => {
            if (player !== current || !hearing) return;
            failed(
              reason instanceof Error
                ? `Couldn't enable sound: ${reason.message}`
                : "Couldn't enable sound. Check this device's audio output and try again.",
              reason,
            );
            waitForTap(retry);
          },
        );
      };
      setTimeout(() => {
        if (!unlocked && player === current && hearing) waitForTap(retry);
      }, 500);
    })
    .catch(() => {});
}

// Where the sound of Playback `id` is now, on this Device's synced clock: what a picture follows.
export function soundClock(id: string) {
  const progress =
    connected?.isConnected && connected.timeSyncInfo.synced && group === id
      ? connected.trackProgress
      : null;
  return progress ? { position: progress.positionMs / 1000, speed: progress.playbackSpeed } : null;
}
