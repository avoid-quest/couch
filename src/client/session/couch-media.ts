import type { Action, MediaTrack, PlaybackClock, PlayerState } from "../../shared/protocol";
import { positionAt } from "./playback-clock";

/** What Couch knows about the Playback this window controls, as the player's controls read it. */
export type CouchMediaSource = {
  playbackId: string | null;
  entryId: string | null;
  status: PlayerState["status"];
  buffering: boolean;
  /** An error, or a radio waiting to retry: Play tries it again. */
  failed: boolean;
  /** Core's position anchor. */
  clock: PlaybackClock;
  /** The item's own length, until Core's clock has one. */
  length: number | null;
  seekable: boolean;
  endless: boolean;
  speed: number;
  /** 0–100, as Core reports it. */
  volume: number;
  muted: boolean;
  subtitles: MediaTrack[];
  /** Where this device's own element has loaded to (buffered.ts). */
  loaded: number | null;
  /** This device's own element, when it plays this Playback: its time beats the anchor's. */
  local: HTMLMediaElement | null;
};

type Run = (action: Action) => Promise<boolean>;
type Seek = {
  target: number;
  sent: boolean;
  acked: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

// Video.js reads time ranges through this shape.
class Ranges {
  constructor(private readonly ranges: [number, number][]) {}
  get length() {
    return this.ranges.length;
  }
  start(index: number) {
    return this.ranges[index]![0];
  }
  end(index: number) {
    return this.ranges[index]![1];
  }
}

class SubtitleTrack {
  readonly kind = "subtitles";
  readonly cues = null;
  #mode: "showing" | "disabled";
  constructor(
    readonly id: string,
    readonly label: string,
    readonly language: string,
    readonly index: number,
    selected: boolean,
    private readonly changed: () => void,
  ) {
    this.#mode = selected ? "showing" : "disabled";
  }
  get mode() {
    return this.#mode;
  }
  set mode(mode: "showing" | "disabled" | "hidden") {
    const next = mode === "showing" ? "showing" : "disabled";
    if (next === this.#mode) return;
    this.#mode = next;
    this.changed();
  }
}

class SubtitleTrackList extends EventTarget {
  [index: number]: SubtitleTrack;
  #tracks: SubtitleTrack[] = [];
  get length() {
    return this.#tracks.length;
  }
  [Symbol.iterator]() {
    return this.#tracks[Symbol.iterator]();
  }
  getTrackById(id: string) {
    return this.#tracks.find((track) => track.id === id) ?? null;
  }
  replace(tracks: SubtitleTrack[]) {
    for (let index = 0; index < this.#tracks.length; index++) delete this[index];
    this.#tracks = tracks;
    tracks.forEach((track, index) => (this[index] = track));
    this.dispatchEvent(new Event("change"));
  }
}

// mpv and browsers land on a keyframe, up to two seconds from where a seek asked.
const LANDED_WITHIN = 2;
// Core reports the position about once a second; three reports away from the target means it landed elsewhere.
const SETTLE_MS = 3000;

/**
 * The media Video.js's controls drive, on every device. Each action sends its intent to Core, which tells whatever
 * plays; state comes from this device's own element when it plays the Playback, else from Core's anchor.
 */
export class CouchMedia extends EventTarget {
  #source: CouchMediaSource;
  #run: Run;
  #seek: Seek | null = null;
  #scrubbing = false;
  #element: { media: HTMLMediaElement; detach: AbortController } | null = null;
  #subtitlesPending = false;
  readonly textTracks = new SubtitleTrackList();

  constructor(source: CouchMediaSource, run: Run) {
    super();
    this.#source = source;
    this.#run = run;
    this.#follow(source.local);
    this.#applySubtitles();
  }

  /** Called on every render with what Core and this device now say. */
  update(source: CouchMediaSource, run: Run) {
    const before = this.#source;
    const was = this.#snapshot();
    this.#source = source;
    this.#run = run;
    this.#follow(source.local);
    if (before.playbackId !== source.playbackId) {
      this.#endSeek();
      this.#emit("emptied", "loadstart");
    }
    const now = this.#snapshot();
    if (!was.readyState && now.readyState) this.#emit("loadedmetadata");
    if (!Object.is(was.duration, now.duration)) this.#emit("durationchange");
    if (was.endless !== now.endless) this.#emit("streamtypechange", "targetlivewindowchange");
    if (was.paused !== now.paused) this.#emit(...(now.paused ? ["pause"] : ["play", "playing"]));
    if (was.waiting !== now.waiting && !now.paused) this.#emit(now.waiting ? "waiting" : "playing");
    if (!was.ended && now.ended) this.#emit("ended");
    if (was.speed !== now.speed) this.#emit("ratechange");
    if (was.volume !== now.volume || was.muted !== now.muted) this.#emit("volumechange");
    if (before.loaded !== source.loaded) this.#emit("progress");
    if (subtitleKey(before.subtitles) !== subtitleKey(source.subtitles)) this.#applySubtitles();
    if (before.clock !== source.clock) {
      this.#settle();
      this.#emit("timeupdate");
    }
  }

  /** While a pointer drags the timeline, its moves show where it would land; release sends one seek. */
  scrub(active: boolean) {
    this.#scrubbing = active;
    const seek = this.#seek;
    if (active || !seek || seek.sent) return;
    // Video.js commits the release's value around its drag end; send whichever target is last.
    setTimeout(() => {
      if (this.#seek === seek) this.#send(seek.target);
    });
  }

  play() {
    const { playbackId, entryId, failed, status } = this.#source;
    if ((status === "ended" || failed) && entryId)
      return this.#act({ type: "play", entryId, fromStart: status === "ended" });
    if (playbackId) return this.#act({ type: "pause", playbackId, paused: false });
    return Promise.resolve();
  }

  pause() {
    const { playbackId } = this.#source;
    if (playbackId) void this.#act({ type: "pause", playbackId, paused: true });
  }

  get paused() {
    const { status, buffering } = this.#source;
    // A stall mid-watch reports loading with buffering: the item has started, as in Core's session.
    return !(status === "playing" || (status === "loading" && buffering));
  }

  get ended() {
    return this.#source.status === "ended";
  }

  get currentTime() {
    if (this.#seek) return this.#seek.target;
    return this.#position();
  }

  set currentTime(time: number) {
    if (!this.#source.playbackId) return;
    const target = Math.max(0, Math.min(time, this.duration || Infinity));
    if (!this.#scrubbing) {
      this.#send(target);
      return;
    }
    clearTimeout(this.#seek?.timer);
    this.#seek = { target, sent: false, acked: false };
    this.#emit("seeking", "timeupdate");
  }

  get duration() {
    const { playbackId, clock, length } = this.#source;
    if (!playbackId) return NaN;
    if (this.#live()) return Infinity;
    return (clock.playbackId === playbackId && clock.duration) || length || NaN;
  }

  get seeking() {
    return !!this.#seek;
  }

  get seekable() {
    const { seekable, clock, playbackId } = this.#source;
    const duration = clock.playbackId === playbackId ? clock.duration : null;
    return new Ranges(seekable && duration ? [[0, duration]] : []);
  }

  get buffered() {
    const { loaded } = this.#source;
    return new Ranges(loaded === null ? [] : [[0, loaded]]);
  }

  get played() {
    return new Ranges([]);
  }

  get readyState() {
    const { playbackId, status, buffering } = this.#source;
    if (!playbackId || status === "idle" || status === "unavailable") return 0;
    if (buffering) return 2;
    return status === "loading" ? 1 : 4;
  }

  get playbackRate() {
    return this.#source.speed;
  }

  set playbackRate(speed: number) {
    const { playbackId } = this.#source;
    if (playbackId && speed !== this.#source.speed)
      void this.#act({ type: "speed", playbackId, speed });
  }

  get volume() {
    return this.#source.volume / 100;
  }

  set volume(volume: number) {
    void this.#act({ type: "volume", volume: Math.round(volume * 100) });
  }

  get muted() {
    return this.#source.muted;
  }

  set muted(muted: boolean) {
    if (muted !== this.#source.muted) void this.#act({ type: "mute", muted });
  }

  get streamType() {
    if (this.#live()) return "live";
    return Number.isFinite(this.duration) ? "on-demand" : "unknown";
  }

  /** An endless stream always plays at its edge: Couch has nothing behind it to seek to. */
  get liveEdgeStart() {
    return this.#live() ? this.currentTime : NaN;
  }

  get targetLiveWindow() {
    return this.#live() ? 0 : NaN;
  }

  get src() {
    return this.#source.playbackId ?? "";
  }

  get currentSrc() {
    return this.src;
  }

  // Core loads what plays; these exist so Video.js treats this as media it can seek.
  readonly error = null;
  readonly controls = false;
  readonly autoplay = false;
  readonly loop = false;
  readonly preload = "auto";
  readonly crossOrigin = null;
  readonly defaultMuted = false;
  readonly defaultPlaybackRate = 1;
  load() {}
  canPlayType() {
    return "";
  }

  #live() {
    const { endless, seekable, clock, playbackId } = this.#source;
    return endless && !(seekable && clock.playbackId === playbackId && clock.duration);
  }

  #position() {
    const { local, clock, playbackId } = this.#source;
    if (local) return local.currentTime;
    return clock.playbackId === playbackId ? positionAt(clock) : 0;
  }

  #snapshot() {
    return {
      readyState: this.readyState,
      duration: this.duration,
      endless: this.#live(),
      paused: this.paused,
      waiting: this.#source.buffering,
      ended: this.ended,
      speed: this.playbackRate,
      volume: this.#source.volume,
      muted: this.#source.muted,
    };
  }

  #send(target: number) {
    const { playbackId } = this.#source;
    if (!playbackId) return;
    clearTimeout(this.#seek?.timer);
    const seek: Seek = { target, sent: true, acked: false };
    this.#seek = seek;
    this.#emit("seeking", "timeupdate");
    this.#run({ type: "seek", playbackId, position: target }).then(
      (accepted) => {
        if (this.#seek !== seek) return;
        if (!accepted) return this.#endSeek();
        seek.acked = true;
        seek.timer = setTimeout(() => this.#seek === seek && this.#endSeek(), SETTLE_MS);
        this.#settle();
      },
      () => this.#seek === seek && this.#endSeek(),
    );
  }

  // Hold the target until what plays reaches it, so repeated keys add up from where the last one asked.
  #settle() {
    const seek = this.#seek;
    if (seek?.acked && Math.abs(this.#position() - seek.target) <= LANDED_WITHIN) this.#endSeek();
  }

  #endSeek() {
    if (!this.#seek) return;
    clearTimeout(this.#seek.timer);
    this.#seek = null;
    this.#emit("seeked", "timeupdate");
  }

  // Video.js reads its time every frame while it plays; a paused element's seek or progress still needs telling.
  #follow(media: HTMLMediaElement | null) {
    if (this.#element?.media === media) return;
    this.#element?.detach.abort();
    this.#element = null;
    if (!media) return;
    const detach = new AbortController();
    for (const event of ["timeupdate", "seeked"])
      media.addEventListener(
        event,
        () => {
          this.#settle();
          this.#emit("timeupdate");
        },
        { signal: detach.signal },
      );
    this.#element = { media, detach };
  }

  #applySubtitles() {
    const changed = () => this.#subtitleChanged();
    this.textTracks.replace(
      this.#source.subtitles
        .filter((track) => track.kind === "subtitle")
        .map(
          (track) =>
            new SubtitleTrack(
              `couch-subtitle-${track.index}`,
              // The menu names a track by its label, else its language, as Couch's other track lists do.
              track.label || track.language || `Subtitle ${track.index + 1}`,
              track.language,
              track.index,
              track.selected,
              changed,
            ),
        ),
    );
  }

  // Video.js turns one track on and the others off in turn; Core hears the result once.
  #subtitleChanged() {
    if (this.#subtitlesPending) return;
    this.#subtitlesPending = true;
    queueMicrotask(() => {
      this.#subtitlesPending = false;
      this.textTracks.dispatchEvent(new Event("change"));
      const { playbackId, subtitles } = this.#source;
      const shown = [...this.textTracks].find((track) => track.mode === "showing")?.index ?? -1;
      const selected = subtitles.find((track) => track.kind === "subtitle" && track.selected);
      if (!playbackId || shown === (selected?.index ?? -1)) return;
      void this.#run({ type: "track", playbackId, kind: "subtitle", index: shown }).then(
        (accepted) => accepted || this.#applySubtitles(),
      );
    });
  }

  async #act(action: Action) {
    await this.#run(action);
  }

  #emit(...types: string[]) {
    for (const type of types) this.dispatchEvent(new Event(type));
  }
}

const subtitleKey = (tracks: MediaTrack[]) =>
  tracks
    .filter((track) => track.kind === "subtitle")
    .map((track) => `${track.index}:${track.label}:${track.language}:${track.selected}`)
    .join("|");
