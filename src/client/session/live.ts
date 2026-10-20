import type { Action, PlaybackCommand, ServerMessage } from "../../shared/protocol";
import type { LiveFailedMessage, LivePeer, LiveSelection, LiveSignalMessage, LiveSource, LiveUploadFailedMessage } from "../../shared/live-input";
import { couchApp } from "./native-context";
import { deviceId, localDeviceName } from "./device-id";
import { attachStream, streamChanged } from "./renderer";

type Publication = { source: LiveSource; capture: MediaStream; stream: MediaStream; key: string; published: boolean; uploadId?: string; recorder?: MediaRecorder; socket?: WebSocket };
type Peer = { connection: RTCPeerConnection; candidates: RTCIceCandidateInit[]; work: Promise<void> };
type Receiver = { peerId: string; load: Extract<PlaybackCommand, { type: "load" }>; stream: MediaStream; peer?: Peer; timeout?: ReturnType<typeof setTimeout> };
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());
// The browser's own capture errors are terse ("Permission denied", which Chromium also throws when the picker is
// closed); say what happened and what to do next. Anything else keeps its message.
const captureError = (reason: unknown, kind: LiveSelection["kind"]) => {
  const name = reason instanceof DOMException ? reason.name : "";
  const what = kind === "microphone" ? "Microphone access" : kind === "system-audio" ? "System audio capture" : "Screen capture";
  if (name === "NotAllowedError") return new Error(kind === "microphone" ? `${what} wasn't allowed. Allow it, then try again.` : `${what} wasn't allowed. Choose a screen or window and allow it, then try again.`);
  if (name === "NotFoundError") return new Error(kind === "microphone" ? "No audio input was found. Connect a microphone or audio interface, then try again." : "No screen or window was found to share.");
  if (name === "NotReadableError" || name === "AbortError") return new Error(`${what} couldn't start. Another app may be using it.`);
  return reason;
};

// Capture belongs to the authenticated session. Every receiver gets it directly over WebRTC;
// Core asks for an encoded upload only while it plays the source buffered (docs/adr/0001).
export function createLiveSession(options: { iceServers: RTCIceServer[]; send: (message: LiveSignalMessage | LiveFailedMessage | LiveUploadFailedMessage) => void; command: (action: Action) => Promise<void>; upload: (sourceId: string, key: string) => WebSocket; failed: (error: Error) => void; published: (source: LiveSource | null) => void }) {
  let generation = 0;
  let closed = false;
  let starting = false;
  let publication: Publication | undefined;
  let receiver: Receiver | undefined;
  const publishers = new Map<string, Peer>();
  const closeReceiver = () => {
    const current = receiver;
    receiver = undefined;
    if (!current) return;
    clearTimeout(current.timeout);
    current.peer?.connection.close();
    stopTracks(current.stream);
  };
  const errorOf = (reason: unknown) => reason instanceof Error ? reason.message : "The live input couldn't connect.";
  // Core then plays the source through its own stream, so the player keeps buffering until it does.
  const failReceiver = (current: Receiver, reason: unknown) => {
    if (receiver !== current) return;
    closeReceiver();
    options.send({ type: "liveFailed", peerId: current.peerId, error: errorOf(reason) });
  };
  const failPublisher = (peerId: string, peer: Peer, reason: unknown) => {
    if (closed || publishers.get(peerId) !== peer) return;
    publishers.delete(peerId);
    peer.connection.close();
    options.send({ type: "liveFailed", peerId, error: errorOf(reason) });
  };
  const makePeer = (peerId: string): Peer => {
    const connection = new RTCPeerConnection({ iceServers: options.iceServers });
    const peer: Peer = { connection, candidates: [], work: Promise.resolve() };
    connection.onicecandidate = event => {
      if (!closed && (receiver?.peer === peer || publishers.get(peerId) === peer)) options.send({ type: "liveSignal", peerId, signal: { candidate: event.candidate ? { ...event.candidate.toJSON(), candidate: event.candidate.candidate } : null } });
    };
    return peer;
  };
  const receiveSignal = (message: LiveSignalMessage) => {
    const current = receiver?.peerId === message.peerId ? receiver : undefined;
    const peer = current?.peer ?? publishers.get(message.peerId);
    if (!peer) return;
    const active = () => !closed && (receiver?.peer === peer || publishers.get(message.peerId) === peer);
    peer.work = peer.work.then(async () => {
      if (!active()) return;
      const { description, candidate } = message.signal;
      if (description) {
        await peer.connection.setRemoteDescription(description);
        if (!active()) return;
        for (const queued of peer.candidates.splice(0)) { await peer.connection.addIceCandidate(queued); if (!active()) return; }
        if (description.type === "offer") {
          const answer = await peer.connection.createAnswer();
          if (!active()) return;
          await peer.connection.setLocalDescription(answer);
          if (active()) options.send({ type: "liveSignal", peerId: message.peerId, signal: { description: { type: "answer", sdp: peer.connection.localDescription!.sdp } } });
        }
      } else if (candidate) {
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(candidate);
        else if (peer.candidates.length < 64) peer.candidates.push(candidate);
      }
    }).catch(reason => { if (current) failReceiver(current, reason); else failPublisher(message.peerId, peer, reason); });
  };
  const startPublisher = async (target: LivePeer) => {
    const current = publication;
    if (!current || publishers.has(target.peerId)) return;
    let peer: Peer;
    try { peer = makePeer(target.peerId); } catch { return; }
    publishers.set(target.peerId, peer);
    const active = () => publication === current && publishers.get(target.peerId) === peer;
    try {
      for (const track of current.stream.getTracks()) if (track.kind === "video" ? target.picture : target.sound) peer.connection.addTrack(track, current.stream);
      const offer = await peer.connection.createOffer();
      if (!active()) return;
      await peer.connection.setLocalDescription(offer);
      if (active()) options.send({ type: "liveSignal", peerId: target.peerId, signal: { description: { type: "offer", sdp: peer.connection.localDescription!.sdp } } });
    } catch (reason) {
      if (active()) failPublisher(target.peerId, peer, reason);
    }
  };
  const closePublication = () => {
    generation++;
    const current = publication;
    publication = undefined;
    for (const peer of publishers.values()) peer.connection.close();
    publishers.clear();
    if (current) { stopUpload(current); stopTracks(current.capture); }
    options.published(null);
  };
  const end = async () => {
    const sourceId = publication?.source.id;
    closePublication();
    if (sourceId) await options.command({ type: "endLive", sourceId });
  };
  // The desktop window hides on Close to keep Couch hosting; Close still ends sharing.
  const leaving = () => { void end().catch(() => {}); };
  const unsubscribeWindowClosed = couchApp?.onWindowClosed?.(leaving);
  // Navigation can freeze the page before Core observes its socket closing. End capture now;
  // the socket's close remains Core's fallback when the page cannot deliver this command.
  window.addEventListener("pagehide", leaving);
  // Core's buffered stream (In sync, or a receiver that couldn't connect directly) reads one continuous
  // recording. Its failure ends only that upload; Core stops buffered delivery and receivers keep their peers.
  const stopUpload = (current: Publication, error?: Error) => {
    const { recorder, socket } = current;
    current.recorder = current.socket = undefined;
    if (recorder) { recorder.ondataavailable = recorder.onerror = null; if (recorder.state !== "inactive") recorder.stop(); }
    if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); }
    if (error && publication === current && current.uploadId) {
      options.send({ type: "liveUploadFailed", sourceId: current.source.id, uploadId: current.uploadId, error: error.message });
      options.failed(error);
    }
  };
  const startUpload = (current: Publication) => {
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record a live input for buffered playback.");
      const types = current.source.video
        ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser cannot encode this live input for buffered playback.");
      // The recording standard supports keyframe intervals; older engines ignore
      // this option, and TypeScript's DOM declarations don't include it yet.
      const recording = { mimeType, audioBitsPerSecond: 192_000, videoBitsPerSecond: 5_000_000, videoKeyFrameIntervalDuration: 1000 };
      const recorder = current.recorder = new MediaRecorder(current.stream, recording);
      const socket = current.socket = options.upload(current.source.id, current.key);
      const active = () => current.socket === socket;
      recorder.ondataavailable = event => {
        if (!event.data.size || !active() || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount + event.data.size > 4 * 1024 * 1024) { stopUpload(current, new Error("The connection cannot keep up with buffered playback of this input. Try a lower capture quality.")); return; }
        // Timeslices form ONE continuous recording. Keep their byte order and fit
        // each message within Core's existing WebSocket frame limit.
        for (let at = 0; at < event.data.size; at += 64 * 1024) socket.send(event.data.slice(at, at + 64 * 1024));
      };
      recorder.onerror = () => { if (active()) stopUpload(current, new Error("The live input stopped recording for buffered playback.")); };
      socket.onopen = () => { if (!active()) return; try { recorder.start(250); } catch { stopUpload(current, new Error("The live input could not start recording.")); } };
      socket.onmessage = event => {
        if (!active()) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "error") stopUpload(current, new Error(typeof message.error === "string" ? message.error : "Buffered playback of this input failed."));
        } catch { stopUpload(current, new Error("Couch sent an invalid live input response.")); }
      };
      socket.onerror = () => { if (active()) stopUpload(current, new Error("The live input lost its connection to Couch.")); };
      // Core closes it once nothing plays the source buffered.
      socket.onclose = () => { if (active()) stopUpload(current); };
    } catch (reason) { stopUpload(current, reason instanceof Error ? reason : new Error("Buffered playback of this input could not start.")); }
  };
  return {
    receive(message: Extract<ServerMessage, { type: "livePeers" | "liveSignal" | "liveIceServers" }>) {
      if (closed) return;
      if (message.type === "liveIceServers") { options.iceServers = message.iceServers; return; }
      if (message.type === "liveSignal") { receiveSignal(message); return; }
      if (message.sourceId !== publication?.source.id) return;
      // A failed attempt waits for a new Core request; its delayed error cannot fail that new attempt.
      const uploadId = message.upload ? message.uploadId : undefined;
      if (publication.uploadId !== uploadId) {
        stopUpload(publication);
        publication.uploadId = uploadId;
        if (uploadId) startUpload(publication);
      }
      const wanted = new Set(message.peers.map(peer => peer.peerId));
      for (const [id, peer] of publishers) if (!wanted.has(id)) { publishers.delete(id); peer.connection.close(); }
      for (const target of message.peers) void startPublisher(target);
    },
    play(command: PlaybackCommand): boolean {
      if (closed) return false;
      if (command.type === "stop") closeReceiver();
      if (command.type !== "load") return false;
      closeReceiver();
      if (!command.liveSourceId || !command.livePeerId || !command.liveOutput) return false;
      // Core never routes a capture back to its publisher, so every receiver connects to it.
      const stream = new MediaStream();
      const current: Receiver = { peerId: command.livePeerId, load: command, stream };
      receiver = current;
      attachStream(command, stream);
      try {
        const peer = current.peer = makePeer(current.peerId);
        peer.connection.ontrack = event => {
          if (receiver !== current) return;
          // Only the channels Core routed to this output play, whatever the publisher sends.
          const { picture, sound } = command.liveOutput!;
          if (!(event.track.kind === "video" ? picture : event.track.kind === "audio" && sound)) { event.track.stop(); return; }
          if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
          streamChanged(command.playbackId, stream);
        };
        peer.connection.onconnectionstatechange = () => {
          if (receiver !== current) return;
          if (peer.connection.connectionState === "connected") clearTimeout(current.timeout);
          if (peer.connection.connectionState === "failed") failReceiver(current, new Error("The direct connection failed."));
        };
        // A LAN peer connects within a second or two; one that can't is relayed rather than awaited.
        current.timeout = setTimeout(() => failReceiver(current, new Error("The direct connection didn't connect within 10 seconds.")), 10_000);
      } catch (reason) { failReceiver(current, reason); }
      return true;
    },
    async audioInputs(): Promise<MediaDeviceInfo[]> {
      if (closed || starting || publication) throw new Error("Stop sharing before choosing another audio input.");
      starting = true;
      const attempt = ++generation;
      let probe: MediaStream | undefined;
      try {
        await couchApp?.prepareCapture?.({ kind: "microphone" });
        if (closed || attempt !== generation) throw new Error("Input selection was canceled.");
        // Browsers expose input names only after microphone access is granted.
        probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(reason => { throw captureError(reason, "microphone"); });
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
        const sound = selection.kind !== "screen" || selection.includeAudio !== false;
        if (couchApp?.prepareCapture) await couchApp.prepareCapture({ kind: selection.kind, sourceId: selection.sourceId, audio: sound });
        if (closed || attempt !== generation) throw new Error("Capture was canceled.");
        const quality = selection.videoQuality ?? "1080p";
        const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        // Bound capture before encoding it. Audio-only display capture
        // still needs a video track, but none of those pixels are transmitted.
        const video: MediaTrackConstraints = selection.kind === "system-audio"
          ? { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 1 } }
          : { ...(quality === "original" ? {} : { width: { max: quality === "720p" ? 1280 : 1920 }, height: { max: quality === "720p" ? 720 : 1080 } }), frameRate: { ideal: 30, max: 30 } };
        capture = await (selection.kind === "microphone"
          ? navigator.mediaDevices.getUserMedia({ audio: { ...audio, ...(selection.audioDeviceId ? { deviceId: { exact: selection.audioDeviceId } } : {}) }, video: false })
          : navigator.mediaDevices.getDisplayMedia({ video, audio: sound && audio })).catch(reason => { throw captureError(reason, selection.kind); });
        if (closed || attempt !== generation) throw new Error("Capture was canceled.");
        const audioTracks = capture.getAudioTracks(), videoTracks = selection.kind === "screen" ? capture.getVideoTracks() : [];
        if (selection.kind !== "screen" && !audioTracks.length) throw new Error("The selected capture did not provide audio. Choose an audio input or grant system audio access.");
        if (selection.kind === "screen" && !videoTracks.length) throw new Error("The selected capture did not provide a screen.");
        const label = selection.kind === "microphone" ? "Microphone" : selection.kind === "system-audio" ? "System audio" : "Screen";
        const source: LiveSource = { id: crypto.randomUUID(), deviceId: deviceId(), name: `${localDeviceName() ?? "This device"} · ${label}`, kind: selection.kind, audio: !!audioTracks.length, video: !!videoTracks.length };
        const uploadToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
        const current: Publication = { source, capture, stream: new MediaStream([...audioTracks, ...videoTracks]), key: uploadToken, published: false };
        publication = current;
        // For audio-only desktop capture, retain its original video track until End.
        for (const track of capture.getTracks()) track.addEventListener("ended", () => { if (publication === current) void end().catch(() => {}); }, { once: true });
        await options.command({ type: "publishLive", sourceId: source.id, uploadToken, kind: selection.kind, name: source.name, audio: source.audio, video: source.video });
        if (closed || attempt !== generation || publication !== current) throw new Error("Capture was canceled.");
        current.published = true;
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
    close() { closed = true; window.removeEventListener("pagehide", leaving); unsubscribeWindowClosed?.(); closeReceiver(); closePublication(); void couchApp?.prepareCapture?.(null).catch(() => {}); },
  };
}
