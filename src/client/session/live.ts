import type { Action } from "../../shared/protocol";
import type { LiveSelection, LiveSource } from "../../shared/live-input";
import { couchApp } from "./native-context";
import { deviceId, localDeviceName } from "./device-id";

type Publication = { source: LiveSource; capture: MediaStream; stream: MediaStream; published: boolean; recorder?: MediaRecorder; socket?: WebSocket; cancel?: () => void };
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

// Capture belongs to the authenticated session. Core turns this one upload into
// an ordinary live media source; receivers use the same player and clocks as TV.
export function createLiveSession(options: { command: (action: Action) => Promise<void>; upload: (sourceId: string, key: string) => WebSocket; failed: (error: Error) => void; published: (source: LiveSource | null) => void }) {
  let generation = 0;
  let closed = false;
  let starting = false;
  let publication: Publication | undefined;
  const closePublication = () => {
    generation++;
    const current = publication;
    publication = undefined;
    current?.cancel?.();
    if (current?.recorder?.state !== "inactive") current?.recorder?.stop();
    current?.socket?.close();
    if (current) stopTracks(current.capture);
    options.published(null);
  };
  const end = async () => {
    const sourceId = publication?.source.id;
    closePublication();
    if (sourceId) await options.command({ type: "endLive", sourceId });
  };
  const upload = (current: Publication, key: string) => new Promise<void>((resolve, reject) => {
    let ready = false;
    const deadline = setTimeout(() => fail(new Error("The live input didn't start. Check the connection and try again.")), 30_000);
    const fail = (error: Error) => {
      if (publication !== current) return;
      clearTimeout(deadline);
      if (ready) { options.failed(error); void end().catch(() => {}); }
      else reject(error);
    };
    current.cancel = () => { clearTimeout(deadline); if (!ready) reject(new Error("Capture was canceled.")); };
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot share a live input.");
      const types = current.source.video
        ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser cannot encode this live input.");
      // The recording standard supports keyframe intervals; older engines ignore
      // this option, and TypeScript's DOM declarations don't include it yet.
      const recording = { mimeType, audioBitsPerSecond: 192_000, videoBitsPerSecond: 5_000_000, videoKeyFrameIntervalDuration: 1000 };
      const recorder = current.recorder = new MediaRecorder(current.stream, recording);
      const socket = current.socket = options.upload(current.source.id, key);
      recorder.ondataavailable = event => {
        if (!event.data.size || publication !== current || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount + event.data.size > 4 * 1024 * 1024) { fail(new Error("The connection cannot keep up with this live input. Try a lower capture quality.")); return; }
        // Timeslices form ONE continuous recording. Keep their byte order and fit
        // each message within Core's existing WebSocket frame limit.
        for (let at = 0; at < event.data.size; at += 64 * 1024) socket.send(event.data.slice(at, at + 64 * 1024));
      };
      recorder.onerror = () => fail(new Error("The live input stopped recording. Start sharing again."));
      socket.onopen = () => { if (publication === current) { try { recorder.start(250); } catch { fail(new Error("The live input could not start recording.")); } } };
      socket.onmessage = event => {
        if (publication !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ready") { ready = true; clearTimeout(deadline); resolve(); }
          else if (message.type === "error") fail(new Error(typeof message.error === "string" ? message.error : "The live input failed."));
        } catch { fail(new Error("Couch sent an invalid live input response.")); }
      };
      socket.onerror = () => fail(new Error("The live input lost its connection to Couch."));
      socket.onclose = () => fail(new Error("The live input lost its connection to Couch."));
    } catch (reason) { fail(reason instanceof Error ? reason : new Error("The live input could not start.")); }
  });
  return {
    async audioInputs(): Promise<MediaDeviceInfo[]> {
      if (closed || starting || publication) throw new Error("Stop sharing before choosing another audio input.");
      starting = true;
      const attempt = ++generation;
      let probe: MediaStream | undefined;
      try {
        await couchApp?.prepareCapture?.({ kind: "microphone" });
        if (closed || attempt !== generation) throw new Error("Input selection was canceled.");
        // Browsers expose input names only after microphone access is granted.
        probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const inputs = await navigator.mediaDevices.enumerateDevices();
        if (closed || attempt !== generation) throw new Error("Input selection was canceled.");
        return inputs.filter(input => input.kind === "audioinput" && input.deviceId);
      } finally {
        if (probe) stopTracks(probe);
        if (!closed) await couchApp?.prepareCapture?.(null).catch(() => {});
        starting = false;
      }
    },
    async start(selection: LiveSelection): Promise<LiveSource> {
      if (closed) throw new Error("Reconnect before sharing a live input.");
      if (publication) throw new Error("End the current source before sharing another input.");
      if (starting) throw new Error("Capture is already starting.");
      if (!navigator.mediaDevices) throw new Error("Live capture needs a secure Couch connection.");
      starting = true;
      const attempt = ++generation;
      let capture: MediaStream | undefined;
      try {
        if (couchApp?.prepareCapture) await couchApp.prepareCapture({ kind: selection.kind, sourceId: selection.sourceId });
        if (closed || attempt !== generation) throw new Error("Capture was canceled.");
        const quality = selection.videoQuality ?? "1080p";
        const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        // Bound capture before encoding its single upload. Audio-only display capture
        // still needs a video track, but none of those pixels are transmitted.
        const video: MediaTrackConstraints = selection.kind === "system-audio"
          ? { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 1 } }
          : { ...(quality === "original" ? {} : { width: { max: quality === "720p" ? 1280 : 1920 }, height: { max: quality === "720p" ? 720 : 1080 } }), frameRate: { ideal: 30, max: 30 } };
        capture = selection.kind === "microphone"
          ? await navigator.mediaDevices.getUserMedia({ audio: { ...audio, ...(selection.audioDeviceId ? { deviceId: { exact: selection.audioDeviceId } } : {}) }, video: false })
          : await navigator.mediaDevices.getDisplayMedia({ video, audio: selection.kind === "screen" && selection.includeAudio === false ? false : audio });
        if (closed || attempt !== generation) throw new Error("Capture was canceled.");
        const audioTracks = capture.getAudioTracks(), videoTracks = selection.kind === "screen" ? capture.getVideoTracks() : [];
        if (selection.kind !== "screen" && !audioTracks.length) throw new Error("The selected capture did not provide audio. Choose an audio input or grant system audio access.");
        if (selection.kind === "screen" && !videoTracks.length) throw new Error("The selected capture did not provide a screen.");
        const label = selection.kind === "microphone" ? "Microphone" : selection.kind === "system-audio" ? "System audio" : "Screen";
        const source: LiveSource = { id: crypto.randomUUID(), deviceId: deviceId(), name: `${localDeviceName() ?? "This device"} · ${label}`, kind: selection.kind, audio: !!audioTracks.length, video: !!videoTracks.length };
        const current: Publication = { source, capture, stream: new MediaStream([...audioTracks, ...videoTracks]), published: false };
        publication = current;
        // For audio-only desktop capture, retain its original video track until End.
        for (const track of capture.getTracks()) track.addEventListener("ended", () => { if (publication === current) void end().catch(() => {}); }, { once: true });
        const uploadToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
        await options.command({ type: "publishLive", sourceId: source.id, uploadToken, kind: source.kind, name: source.name, audio: source.audio, video: source.video });
        if (closed || attempt !== generation || publication !== current) throw new Error("Capture was canceled.");
        current.published = true;
        await upload(current, uploadToken);
        if (closed || attempt !== generation || publication !== current) throw new Error("Capture was canceled.");
        options.published(source);
        return source;
      } catch (reason) {
        const sourceId = attempt === generation ? publication?.source.id : undefined;
        if (capture) stopTracks(capture);
        if (attempt === generation) closePublication();
        // Core may have accepted Publish even when its reply was lost.
        if (sourceId && !closed) void options.command({ type: "endLive", sourceId }).catch(() => {});
        throw reason;
      } finally { if (!closed) await couchApp?.prepareCapture?.(null).catch(() => {}); starting = false; }
    },
    end,
    observe(sources: LiveSource[]) {
      if (publication?.published && !sources.some(source => source.id === publication!.source.id)) {
        // State and upload errors use different sockets. Whichever arrives first
        // must retire capture and tell the publisher why sharing disappeared.
        if (!starting) options.failed(new Error("Couch stopped this live input. Start sharing again."));
        closePublication();
      }
    },
    close() { closed = true; closePublication(); void couchApp?.prepareCapture?.(null).catch(() => {}); },
  };
}
