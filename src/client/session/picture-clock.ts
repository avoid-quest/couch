// A muted picture follows where its Playback's sound is (#644 ticket 11). Small errors are corrected
// by playback rate; a large one by one seek, only into picture already buffered. A picture without
// data where the sound is parks at one fixed point ahead and waits for the clock to reach it: chasing
// a moving target with seeks restarts loading each time, and a slow link never shows a frame.
// Omit position when the renderer cannot map source PTS; that picture still follows programme
// transport without claiming alignment.
type Sample = { position?: number; speed: number } | null;
export type FollowedVideo = Pick<
  HTMLVideoElement,
  | "currentTime"
  | "duration"
  | "ended"
  | "playbackRate"
  | "defaultPlaybackRate"
  | "paused"
  | "seeking"
  | "readyState"
  | "buffered"
  | "pause"
>;

// Within 15 ms the picture plays at the programme's speed; beyond 25 ms its rate moves by a fifth of
// the error per second, at most 5%: invisible on a muted picture, and outside Chromium's ±1/882 band
// around 1, where a rate is ignored.
const settled = 0.015;
const correcting = 0.025;
const gain = 0.2;
const maxNudge = 0.05;
// At 5%, a second takes 20 s to correct: beyond it, seek.
const seekBeyond = 1;
// A destination needs this much picture after it, so the seek doesn't land in a stall.
const headroom = 0.5;
// hls.js leaves gaps of a few frames between appended fragments.
const gap = 0.1;
// A parked picture starts this far ahead of the clock, double after each miss up to 8 s: a few
// fragments of a live stream, still inside its window.
const firstParkLead = 2;
const lastParkLead = 8;

export function createFollower(video: FollowedVideo, read: () => Sample, start: () => void) {
  let nudging = false;
  // How long a buffered seek takes, learnt from where each one lands.
  let seekLead = 0.2;
  let measuring = false;
  let parked: number | undefined;
  let parkLead = firstParkLead;
  const ahead = (time: number) => {
    for (let index = 0; index < video.buffered.length; index++)
      if (video.buffered.start(index) - gap <= time && time < video.buffered.end(index))
        return video.buffered.end(index) - time;
    return -1;
  };
  // A film's end is as far as a picture can wait.
  const end = () => (Number.isFinite(video.duration) ? video.duration : Infinity);
  const park = (target: number) => {
    parked = Math.min(target + parkLead, end());
    measuring = false;
    if (!video.paused) video.pause();
    video.currentTime = parked;
  };
  const rate = (value: number) => {
    if (video.playbackRate !== value) video.playbackRate = value;
  };
  return () => {
    const sample = video.readyState >= HTMLMediaElement.HAVE_METADATA ? read() : null;
    // No clock yet, or none any more: the picture waits where it is.
    if (!sample) {
      parked = undefined;
      if (!video.paused) video.pause();
      return;
    }
    if (sample.position === undefined) {
      parked = undefined;
      if (sample.speed > 0) {
        video.defaultPlaybackRate = video.playbackRate = sample.speed;
        if (video.paused) start();
      } else if (!video.paused) video.pause();
      return;
    }
    const { position: target, speed } = sample;
    if (speed <= 0) {
      parked = undefined;
      if (!video.paused) video.pause();
      if (!video.seeking && Math.abs(target - video.currentTime) > correcting)
        video.currentTime = target;
      return;
    }
    // An ended picture holds its last frame until the clock moves back past it: play() would restart
    // it from its first frame.
    if (video.ended && target > video.currentTime - seekBeyond) {
      parked = undefined;
      return;
    }
    // The sound moved back past the point the picture parked from (a new timeline): park again.
    if (parked !== undefined && target < parked - parkLead - seekBeyond) parked = undefined;
    if (parked !== undefined) {
      // Its picture came too late: wait further ahead.
      if (target > parked + headroom && parked < end()) {
        parkLead = Math.min(parkLead * 2, lastParkLead);
        park(target);
        return;
      }
      if (
        target < parked - settled ||
        video.seeking ||
        (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && parked < end())
      )
        return;
      parked = undefined;
      parkLead = firstParkLead;
      rate(speed);
      start();
      return;
    }
    if (video.seeking) return;
    const error = target - video.currentTime;
    if (measuring && !video.paused) seekLead = Math.min(Math.max(seekLead + error, 0), seekBeyond);
    measuring = false;
    if (Math.abs(error) > seekBeyond) {
      const destination = target + seekLead;
      if (ahead(destination) < headroom) return park(target);
      video.currentTime = destination;
      measuring = true;
      return;
    }
    if (video.paused) start();
    if (Math.abs(error) > correcting) nudging = true;
    else if (Math.abs(error) < settled) nudging = false;
    // Catching up needs picture to play into.
    const nudge =
      nudging && !(error > 0 && ahead(video.currentTime) < headroom)
        ? Math.min(Math.max(error * gain, -maxNudge), maxNudge)
        : 0;
    rate(speed * (1 + nudge));
  };
}

export function followClock(video: FollowedVideo, read: () => Sample, start: () => void) {
  const step = createFollower(video, read, start);
  step();
  const timer = setInterval(step, 250);
  return () => clearInterval(timer);
}
