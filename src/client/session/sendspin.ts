import type { LiveAudioSettings } from "../../shared/audio-settings";
import type { SendspinPlayer } from "@sendspin/sendspin-js";
import { apiFetch } from "../api/client";
import { waitForTap } from "./renderer";
import type { Credentials } from "./session";
import { storage } from "./device-id";
import { failed } from "../toasts";
import { declareLiveBuffer, nextLateSteps, withLateSteps, type LateSteps } from "./live-buffer";
import { liveReadings } from "../../shared/live-need";
import { logLiveMargins, noteLiveDropped } from "./live-margin";

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
// The same places see late chunks. The player makes each chunk it receives a buffer and handles it at
// its next batch, 15 ms later (scheduler.js; its schedule horizon is seconds, so none waits longer):
// it starts it, or drops it because its start has passed, and counts nothing. So a chunk received and
// not started well after that batch was lost to this listener's own lateness, which a later step
// cures. Chunks Core never sent don't count: Core sending nothing, or skipping what is already late
// when its input is late for everyone, which Core's own input side covers.
let framesAligned = false;
// When each chunk the player received and hasn't started arrived, on the player's own context.
let arrivals: { context?: BaseAudioContext; at: number[] } = { at: [] };
// The player corrects a chunk by a sample by copying it and starting the copy at once, in the same
// task; a chunk it received is started in a later one.
let copy: AudioBuffer | undefined;
// Well past the player's 15 ms batch, even with a busy main thread.
const handledMs = 100;
const droppedLate = () => {
  const due = performance.now() - handledMs,
    handled = arrivals.at.findIndex((at) => at > due);
  const dropped = handled === -1 ? arrivals.at.length : handled;
  arrivals.at = arrivals.at.slice(dropped);
  noteLiveDropped(dropped);
  return dropped > 0;
};
const alignStartsToFrames = () => {
  if (framesAligned || typeof AudioBufferSourceNode === "undefined") return;
  framesAligned = true;
  const createBuffer = BaseAudioContext.prototype.createBuffer;
  BaseAudioContext.prototype.createBuffer = function (this: BaseAudioContext, ...args) {
    const buffer = createBuffer.apply(this, args);
    if (arrivals.context !== this) arrivals = { context: this, at: [] };
    arrivals.at.push(performance.now());
    copy = buffer;
    queueMicrotask(() => {
      if (copy === buffer) copy = undefined;
    });
    return buffer;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (
    this: AudioBufferSourceNode,
    when?: number,
    offset = 0,
    ...rest
  ) {
    const rate = this.context.sampleRate,
      speed = this.playbackRate.value;
    const aligned = when === undefined || speed !== 1 ? when : Math.round(when * rate) / rate;
    if (this.context === arrivals.context) {
      if (this.buffer === copy) arrivals.at.pop();
      arrivals.at.shift();
    }
    return start.call(this, aligned, offset, ...rest);
  };
};
let liveSettings: LiveAudioSettings | undefined;
let bufferScope: string | undefined;
let needMs: number | undefined;
let declaredBufferMs: number | undefined;
let latencyReadings: number[] = [];
let lostSeconds: boolean[] = [];
let lateSteps: LateSteps = { steps: 0 };
let bufferTimer: ReturnType<typeof setInterval> | undefined;
// The player whose sound this tab unlocked. Until then its context is suspended and reports only
// its base latency, too little a need; with no room delay, Core sends a listener nothing before it
// has declared one, so this reading has to come from a running context.
let sounding: SendspinPlayer | undefined;
// sample: add this second's readings. The room's delay is the host's and isn't declared here.
const updateBuffer = (created: SendspinPlayer, sample = false) => {
  if (connected !== created || !liveSettings) return;
  const playing =
    sample &&
    hearing &&
    sounding === created &&
    created.isConnected &&
    created.isPlaying &&
    created.timeSyncInfo.synced;
  const latency = playing ? created.syncInfo.outputLatencyMs : NaN;
  if (Number.isFinite(latency) && latency >= 0)
    latencyReadings = [...latencyReadings, latency].slice(-liveReadings);
  // A suspended context handles nothing: what it received isn't late, and it plays nothing.
  const lost = sample && droppedLate() && arrivals.context?.state === "running";
  if (playing) lostSeconds = [...lostSeconds, lost].slice(-liveReadings);
  const late = nextLateSteps(
    lateSteps,
    lostSeconds,
    declaredBufferMs ?? 0,
    liveSettings.minBufferMs,
  );
  if (late.steps !== lateSteps.steps) lostSeconds = [];
  lateSteps = late;
  needMs = declareLiveBuffer(needMs, latencyReadings);
  const next = needMs === undefined ? undefined : withLateSteps(needMs, lateSteps.steps);
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
    lateSteps = { steps: 0 };
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
    .then(async (sendspin) => {
      const { SendspinPlayer } = sendspin;
      alignStartsToFrames();
      logLiveMargins(sendspin, () =>
        liveSettings ? { player: connected, declaredMs: declaredBufferMs } : undefined,
      );
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
          sounding = created;
          waitForTap(null);
        },
        () => {},
      );
      const retry = () => {
        if (player !== current || !hearing) return;
        void created.unlock().then(
          () => {
            if (player !== current || !hearing) return;
            sounding = created;
            waitForTap(null);
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
