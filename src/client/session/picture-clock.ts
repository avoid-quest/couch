import { TimingObject } from "timing-object";
import { setTimingsrc } from "timingsrc";

// A muted picture follows where its Playback's sound is (#644 ticket 11), with the maintained
// synchroniser #640 used: timingsrc nudges the playback rate for small drift and seeks for large
// drift (stepwise on Safari). `read` gives the sound's position on the video's own timeline.
export function followClock(video: HTMLVideoElement, read: () => { position: number; speed: number } | null) {
  const timing = new TimingObject();
  let detach: (() => void) | undefined;
  const refresh = () => {
    const sample = video.readyState >= HTMLMediaElement.HAVE_METADATA ? read() : null;
    // No clock yet, or none any more: the picture waits where it is.
    if (!sample) { if (detach) void timing.update({ velocity: 0 }); return; }
    void timing.update({ position: sample.position, velocity: sample.speed });
    detach ??= setTimingsrc(video, timing);
  };
  refresh();
  const timer = setInterval(refresh, 250);
  return () => { clearInterval(timer); detach?.(); };
}
