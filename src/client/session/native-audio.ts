import { liveCaptureConstraints } from "../../shared/audio-settings";
import { prepareCaptureAudio, uploadCaptureAudio } from "./capture-audio";
import type { AudioCaptureFormat, LiveAudioAction } from "../../shared/capture";

type Command = LiveAudioAction & { request: number };
const bridge = (window as unknown as { couchAudioCapture: {
  onCommand(listener: (command: Command) => void): void;
  event(value: { request?: number; error?: string; uploadId?: string; ready?: boolean; format?: AudioCaptureFormat }): void;
} }).couchAudioCapture;
let capture: MediaStream | undefined, frames: Awaited<ReturnType<typeof prepareCaptureAudio>> | undefined;
let sampleRate: 44100 | 48000 | undefined, format: AudioCaptureFormat | undefined;
let stopUpload: (() => void) | undefined, uploadId: string | undefined, ended = false;
const stop = () => {
  ended = true; stopUpload?.(); stopUpload = undefined;
  void frames?.cancel().catch(() => {}); frames = undefined;
  capture?.getTracks().forEach(track => track.stop());
};
addEventListener("pagehide", stop, { once: true });
// Commands run in order, so a stopped upload cannot cancel its replacement.
let pending = Promise.resolve();
bridge.onCommand(command => {
  pending = pending.then(async () => {
    if (ended) throw new Error("The audio capture ended.");
    if (command.op === "prepare") {
      if (capture) throw new Error("The audio input is already prepared.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
        deviceId: { exact: command.deviceId }, ...liveCaptureConstraints(command.sampleRate),
      } });
      if (ended) { stream.getTracks().forEach(track => track.stop()); throw new Error("Capture was canceled."); }
      capture = stream;
      const track = stream.getAudioTracks()[0];
      if (!track || stream.getAudioTracks().length !== 1 || track.getSettings().deviceId !== command.deviceId) throw new Error("The selected audio input changed.");
      track.addEventListener("ended", () => { if (!ended) { stop(); bridge.event({ error: "The audio input ended." }); } }, { once: true });
      sampleRate = command.sampleRate;
      frames = await prepareCaptureAudio(track, true, sampleRate, value => { format = value; });
    } else if (command.op === "upload") {
      if (!capture || stopUpload) throw new Error("The audio input is not ready for this upload.");
      // A later receiver gets a fresh processor on the same selected track, with native timestamps.
      // No old upload's queued audio or clock origin carries into the new generation.
      frames ??= await prepareCaptureAudio(capture.getAudioTracks()[0]!, true, sampleRate);
      uploadId = command.uploadId;
      stopUpload = uploadCaptureAudio(frames, command.url, error => {
        if (uploadId !== command.uploadId || ended) return;
        stopUpload = undefined; uploadId = undefined;
        bridge.event({ uploadId: command.uploadId, error: error.message });
      });
      frames = undefined;
    } else if (command.op === "stop-upload") {
      if (uploadId === command.uploadId) { stopUpload?.(); stopUpload = undefined; uploadId = undefined; }
    } else if (command.op === "mute") {
      capture?.getAudioTracks().forEach(track => { track.enabled = !command.muted; });
    } else stop();
    bridge.event({ request: command.request, ...(command.op === "prepare" ? { format } : {}) });
  }).catch(error => { bridge.event({ request: command.request, error: error instanceof Error ? error.message : "Audio capture failed." }); });
});
bridge.event({ ready: true });
