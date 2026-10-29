// Real renderer; the native harness supplies resolved media with controlled HTTP latency.
import { connectRenderer, play, renderInto } from "../src/client/session/renderer";

export async function measureMediaStartup(mode: string) {
  renderInto(document.body);
  const video = document.querySelector("video")!;
  let error: string | null = null;
  const disconnect = connectRenderer(state => { if (state.error) error = state.error; });
  const audio = document.querySelector("audio")!;
  const started = performance.now();
  let firstFrameMs: number | undefined;
  const callback = video.requestVideoFrameCallback(() => { firstFrameMs = performance.now() - started; });
  const until = async (ready: () => boolean) => {
    while (!ready()) {
      if (error) throw new Error(error);
      if (performance.now() - started > 15_000) throw new Error("Media startup timed out");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    const { command, prepareMs, upstreamRequests } = await (await fetch(`/load?mode=${mode}`)).json();
    const loadMs = performance.now() - started;
    play(command);
    await until(() => firstFrameMs !== undefined && !video.paused && video.currentTime > .1
      && (!command.audioSource || audio.readyState >= 3 && !audio.paused && audio.currentTime > .1));
    const playingMs = performance.now() - started;
    await new Promise(resolve => setTimeout(resolve, 500));
    const quality = video.getVideoPlaybackQuality();
    const result = { mode, prepareMs, upstreamRequests, loadMs, firstFrameMs, playingMs,
      width: video.videoWidth, height: video.videoHeight, totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames };
    play({ type: "seek", playbackId: command.playbackId, position: 4 });
    await until(() => !video.seeking && video.currentTime >= 4 && (!command.audioSource || audio.currentTime >= 3.8));
    return result;
  } finally {
    video.cancelVideoFrameCallback(callback);
    play({ type: "stop" }); disconnect();
  }
}
