import { TimingObject, type ITimingObject } from "timing-object";
import type { PlaybackCommand, PlayerState } from "../../shared/protocol";

export type AudioClockSample = { groupId: string; positionMs: number; playbackSpeed: number };
type ReadClock = () => AudioClockSample | null;
type NativeState = Pick<PlayerState, "playbackId" | "status" | "position" | "duration" | "speed">;
type VideoCommand = Extract<PlaybackCommand, { type: "seek" | "speed" | "pause" }>;

/** Feed the maintained media synchronizer from the local Sendspin player's audio clock. */
function follow(readClock: ReadClock, ready: () => boolean, attach: (timing: ITimingObject, sync: typeof import("timingsrc")) => () => void) {
  const timing = new TimingObject();
  let library: Promise<typeof import("timingsrc")> | undefined;
  let stopped = false;
  let refreshing = false;
  let detach: (() => void) | undefined;
  const refresh = async () => {
    if (stopped || refreshing) return;
    refreshing = true;
    try {
      const sample = readClock();
      if (!sample || !Number.isFinite(sample.positionMs) || !Number.isFinite(sample.playbackSpeed) || !ready()) {
        if (detach) await timing.update({ velocity: 0 });
        return;
      }
      await timing.update({ position: Math.max(0, sample.positionMs / 1000), velocity: Math.max(0, sample.playbackSpeed) });
      if (!stopped && !detach) {
        const sync = await (library ??= import("timingsrc"));
        if (!stopped && !detach) detach = attach(timing, sync);
      }
    } finally { refreshing = false; }
  };
  void refresh().catch(() => {});
  const timer = setInterval(() => { void refresh().catch(() => {}); }, 250);
  return () => { stopped = true; clearInterval(timer); detach?.(); };
}

export function followBrowserVideo(video: HTMLVideoElement, readClock: ReadClock) {
  video.muted = true;
  return follow(() => {
    const sample = readClock();
    if (!sample || video.dataset.sourcePtsTimeline !== "live") return sample;
    const offset = Number(video.dataset.sourcePtsOffset);
    return Number.isFinite(offset) ? { ...sample, positionMs: sample.positionMs - offset * 1000 } : null;
  }, () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA, (timing, sync) => sync.setTimingsrc(video, timing));
}

/** Native mpv keeps its own observed state; this adapter only coalesces synchronizer writes. */
export function followNativeVideo(readState: () => NativeState, send: (command: VideoCommand) => void | Promise<void>, readClock: ReadClock) {
  let stopped = false;
  const recent = new Map<VideoCommand["type"], { id: string; value: number; at: number }>();
  const write = (type: VideoCommand["type"], value: number) => {
    const state = readState(), id = state.playbackId;
    if (stopped || !id || !["playing", "paused"].includes(state.status)) return;
    const last = recent.get(type);
    const tolerance = type === "seek" ? 0.5 : type === "speed" ? 0.03 : 0;
    if (last?.id === id && Math.abs(last.value - value) <= tolerance && performance.now() - last.at < 500) return;
    recent.set(type, { id, value, at: performance.now() });
    const command: VideoCommand = type === "seek" ? { type, playbackId: id, position: value }
      : type === "speed" ? { type, playbackId: id, speed: value }
      : { type, playbackId: id, paused: value === 1 };
    void Promise.resolve().then(() => send(command)).catch(() => {});
  };
  // timingsrc uses only these synchronous MediaElement members. Observations remain
  // the source of truth; no optimistic state here can claim native readiness.
  const media = {
    get currentTime() { return readState().position; },
    set currentTime(value: number) { write("seek", value); },
    get duration() { return readState().duration ?? Infinity; },
    get playbackRate() { return readState().speed ?? 1; },
    set playbackRate(value: number) { write("speed", value); },
    get paused() { return readState().status !== "playing"; },
    play() { write("pause", 0); return Promise.resolve(); },
    pause() { write("pause", 1); },
  } as HTMLMediaElement;
  const stop = follow(readClock, () => {
    const state = readState();
    return !!state.playbackId && ["paused", "playing"].includes(state.status);
  }, (timing, sync) => sync.setTimingsrcWithCustomUpdateFunction(media, timing, sync.createUpdateStepwise(0.1)));
  return () => { stopped = true; stop(); recent.clear(); };
}
