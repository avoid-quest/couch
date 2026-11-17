import type { LiveAudioSettings } from "../../shared/audio-settings";
import {
  detectIsAndroid,
  detectIsIOS,
  type SendspinPlayer,
  type SendspinPlayerConfig,
} from "@sendspin/sendspin-js";
import { apiFetch } from "../api/client";
import { waitForTap } from "./renderer";
import type { Credentials } from "./session";
import { storage } from "./device-id";
import { failed } from "../toasts";
import { reportBehind } from "./behind";
import {
  declareLiveBuffer,
  nextLateSteps,
  noLateSteps,
  sdkBatchMs,
  withLateSteps,
} from "./live-buffer";
import { liveReadings } from "../../shared/live-need";
import type { LivePlayer } from "./live-player";
import { countingLiveLoss, countLiveLoss, reportsOutputLatency, sampleLiveLoss } from "./live-loss";

// Synced sound (#644 ticket 10): while Core asks, this tab plays its Device's sound with the
// official Sendspin player, with Couch's stable Device ID. A Live listener plays with Couch's own
// player on the SDK's connection, clock and decoding (live-player.ts), except on Android and iOS.
// A tab that shows a synced picture connects too, only for the clock it follows (ticket 11).
type Player = SendspinPlayer | LivePlayer;
const isLive = (player: Player): player is LivePlayer => "sampleLoss" in player;
// On Android, Chrome plays a context with an AudioWorklet through a FIFO whose underruns add delay
// its output timestamps miss; the SDK's player has no worklet. On iOS sound plays through a media
// element whose delay no browser reports; the SDK's player adds its own allowance for it
// (docs/live-audio.md).
const sdkPlays = () => detectIsAndroid() || detectIsIOS();
let player: Promise<Player> | null = null;
let connected: Player | null = null;
let group: string | undefined;
let hearing = false;
let configuration: string | undefined;
// The SDK's destroy() clears Media Session, which useMediaSession owns and won't rewrite
// while its inputs are unchanged (a codec change replaces the player mid-Live): keep what it set.
const dispose = (stopped: Player) => {
  const session = navigator.mediaSession,
    kept = session && { metadata: session.metadata, playbackState: session.playbackState };
  stopped.destroy();
  if (session) Object.assign(session, kept);
};
// On Android, relaxed sound keeps the SDK's estimated clock, its fallback without getOutputTimestamp(), as
// the SDK keeps Cast receivers: their output timestamps make the speed hunt (sendspin-js #85). Live keeps them.
const AndroidAudioContext =
  typeof AudioContext !== "undefined" && /Android/i.test(navigator.userAgent)
    ? AudioContext
    : undefined;
const outputTimestamp =
  AndroidAudioContext &&
  Object.getOwnPropertyDescriptor(AndroidAudioContext.prototype, "getOutputTimestamp");
const useOutputTimestamps = (use: boolean) => {
  if (!AndroidAudioContext || !outputTimestamp) return;
  const descriptor = use ? outputTimestamp : { ...outputTimestamp, value: undefined };
  Object.defineProperty(AndroidAudioContext.prototype, "getOutputTimestamp", descriptor);
};
// On Android, relaxed sound also asks for a "playback" context, which the SDK's player can't ask for
// itself: Chrome then renders it in longer buffers than the default's low-latency ones, so a busy phone
// has more time before it misses one. Each miss is a gap, and the time it costs makes the player correct.
// Relaxed sound plays 1 s or more ahead anyway, and the player measures the longer output latency.
// Live, and any other sound, keeps the default.
let latencyHint: AudioContextLatencyCategory | undefined;
if (AndroidAudioContext)
  globalThis.AudioContext = class extends AndroidAudioContext {
    constructor(options?: AudioContextOptions) {
      super(
        latencyHint && options?.latencyHint === undefined ? { ...options, latencyHint } : options,
      );
    }
  };
const playRelaxed = (relaxed: boolean) => {
  latencyHint = relaxed ? "playback" : undefined;
};
// The player chains each chunk where the last one ended, between two frames. Chrome then renders the
// frame where they meet without part of it: a one-frame notch per chunk that clicks on loud transients.
// Starting a chunk on its nearest frame moves it by at most half a sample and joins it exactly.
// A chunk the player speeds up or slows down has a fractional length, so it keeps its own start.
let framesAligned = false;
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
      speed = this.playbackRate.value;
    const aligned = when === undefined || speed !== 1 ? when : Math.round(when * rate) / rate;
    return start.call(this, aligned, offset, ...rest);
  };
};
let liveSettings: LiveAudioSettings | undefined;
let bufferScope: string | undefined;
let needMs: number | undefined;
let declaredBufferMs: number | undefined;
let latencyReadings: number[] = [];
let lastLatency: number | undefined;
let lateSteps = noLateSteps;
let bufferTimer: ReturnType<typeof setInterval> | undefined;
// The player whose sound this tab unlocked. Until then its context is suspended and reports only
// its base latency, too little a need; Core sends a listener nothing before it has declared one,
// so this reading has to come from a running context.
let sounding: Player | undefined;
// sample: add this second's readings.
const updateBuffer = (created: Player, sample = false) => {
  if (connected !== created || !liveSettings) return;
  const worklet = isLive(created);
  const playing =
    sample &&
    hearing &&
    sounding === created &&
    created.isConnected &&
    created.isPlaying &&
    created.timeSyncInfo.synced;
  const output = worklet ? created.outputMs() : created.syncInfo.outputLatencyMs;
  const latency = playing ? output : undefined;
  // The first declaration waits for a reading the context has settled on: one that includes its
  // output latency, or the same reading twice (a browser that reports none).
  const measured = worklet ? created.measuresOutput : reportsOutputLatency();
  const settled = needMs !== undefined || measured || latency === lastLatency;
  lastLatency = latency;
  if (settled && latency !== undefined && latency >= 0)
    latencyReadings = [...latencyReadings, latency].slice(-liveReadings);
  if (sample) {
    // A suspended context handles nothing: what it received isn't late, and it plays nothing.
    const second = worklet ? created.sampleLoss(playing) : sampleLiveLoss(created, playing);
    if (second) lateSteps = nextLateSteps(lateSteps, second);
    // Losing chunks in most of the last few seconds is what makes it step later: until then it is
    // behind. A step that lands starts its seconds again.
    const lossy = lateSteps.seconds.slice(-liveReadings).filter((counted) => counted.lost > 0);
    reportBehind({ sound: lossy.length > liveReadings / 2 });
  }
  needMs = declareLiveBuffer(needMs, latencyReadings, worklet ? 0 : sdkBatchMs);
  const next = needMs === undefined ? undefined : withLateSteps(needMs, lateSteps.lateMs);
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
    lastLatency = undefined;
    lateSteps = noLateSteps;
    needMs = declaredBufferMs = undefined;
  }
  liveSettings = live;
  const sdkLive = Boolean(live) && sdkPlays();
  countingLiveLoss(sdkLive && (on || watch));
  useOutputTimestamps(Boolean(live));
  playRelaxed(!live && (on || watch));
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
    reportBehind({ sound: false });
    waitForTap(null);
    void current?.then(dispose).catch(() => {});
    if (!on && !watch) return;
  }
  if (!credentials) return;
  configuration = next;
  const hear = on && !hearing;
  hearing = on;
  if (!on) waitForTap(null);
  const current: Promise<Player> = (player ??= Promise.all([
    import("@sendspin/sendspin-js"),
    live && !sdkLive ? import("./live-player") : undefined,
  ])
    .then(async ([sendspin, livePlayer]) => {
      alignStartsToFrames();
      if (sdkLive)
        countLiveLoss(sendspin, () => (connected && !isLive(connected) ? connected : null));
      await apiFetch(credentials, "/api/audio/session", { method: "POST", credentials: "include" });
      // Electron ships BoringSSL without ChaCha20-Poly1305; both SDKs support AES-GCM.
      const options = {
        suite: "aesgcm",
        url: `${credentials.origin.replace(/^http/, "ws")}/sendspin`,
        clientName: name,
        storage,
        ...(live?.codec && live.codec !== "auto"
          ? { codecs: live.codec === "opus" ? ["opus", "pcm"] : ["pcm"] }
          : {}),
        onStateChange: (state) => {
          if (player === current) group = state.groupState.group_id;
        },
      } satisfies SendspinPlayerConfig;
      const created = livePlayer
        ? new livePlayer.LivePlayer({ ...options, minBufferMs: declaredBufferMs ?? 0 })
        : new sendspin.SendspinPlayer({
            ...options,
            ...(live ? { minBufferMs: declaredBufferMs ?? 0 } : {}),
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
