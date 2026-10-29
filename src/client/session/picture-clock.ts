import { TimingObject } from "timing-object";
import { setTimingsrc } from "timingsrc";

// A muted picture follows where its Playback's sound is (#644 ticket 11), with the maintained
// synchroniser #640 used: timingsrc nudges the playback rate for small drift and seeks for large
// drift (stepwise on Safari). Omit position when the renderer cannot map source PTS;
// that picture still follows programme transport without claiming alignment.
export function followClock(video: HTMLVideoElement, read: () => { position?: number; speed: number } | null, start: () => void) {
  const timing = new TimingObject();
  let detach: (() => void) | undefined;
  const refresh = () => {
    const sample = video.readyState >= HTMLMediaElement.HAVE_METADATA ? read() : null;
    // No clock yet, or none any more: the picture waits where it is.
    if (!sample) {
      if (detach) void timing.update({ velocity: 0 });
      else if (!video.paused) video.pause();
      return;
    }
    if (sample.position === undefined) {
      detach?.();
      detach = undefined;
      if (sample.speed > 0) {
        video.defaultPlaybackRate = video.playbackRate = sample.speed;
        if (video.paused) start();
      } else if (!video.paused) video.pause();
      return;
    }
    void timing.update({ position: sample.position, velocity: sample.speed });
    detach ??= setTimingsrc(video, timing);
  };
  refresh();
  const timer = setInterval(refresh, 250);
  return () => { clearInterval(timer); detach?.(); };
}
