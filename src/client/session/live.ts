import type { Action, PlaybackCommand, PlayerState, ServerMessage } from "../../shared/protocol";
import type { LivePeer, LiveSelection, LiveSignal, LiveSignalMessage, LiveSource } from "../../shared/live-input";
import { couchApp } from "./native-context";
import { deviceId, localDeviceName } from "./device-id";
import { attachLive, detachLive, play } from "./renderer";

type Load = Extract<PlaybackCommand, { type: "load" }>;
type Peer = { connection: RTCPeerConnection; candidates: (RTCIceCandidateInit | null)[]; work: Promise<void> };
type Publication = { source: LiveSource; capture: MediaStream; stream: MediaStream; published: boolean };
type Receiver = Peer & { peerId: string; load: Load; stream: MediaStream; local: boolean; timeout?: ReturnType<typeof setTimeout> };
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

// Owned by the authenticated session, so changing UI routes never ends capture.
export function createLiveSession(options: { iceServers?: RTCIceServer[]; command: (action: Action) => Promise<void>; send: (message: LiveSignalMessage) => void; failed: (state: PlayerState) => void; published: (source: LiveSource | null) => void }) {
  let generation = 0;
  let closed = false;
  let starting = false;
  let publication: Publication | undefined;
  let receiver: Receiver | undefined;
  const publishers = new Map<string, Peer>();
  const closeReceiver = () => {
    if (!receiver) return;
    clearTimeout(receiver.timeout);
    receiver.connection.close();
    if (!receiver.local) stopTracks(receiver.stream);
    receiver = undefined;
    detachLive();
  };
  const closePublication = () => {
    generation++;
    const current = publication;
    publication = undefined;
    for (const peer of publishers.values()) peer.connection.close();
    publishers.clear();
    if (current) stopTracks(current.capture);
    options.published(null);
  };
  const failure = (load: Load, reason: unknown) => {
    if (receiver?.load !== load || closed) return;
    clearTimeout(receiver.timeout);
    receiver.connection.close();
    options.failed({ playbackId: load.playbackId, status: "error", buffering: false, position: 0, duration: null, volume: load.liveOutput?.volume ?? 100, seekable: false, speed: 1, audioDelay: 0, subtitleDelay: 0, tracks: [], error: reason instanceof Error ? reason.message : "The live connection failed." });
  };
  const makePeer = (peerId: string): Peer => {
    const connection = new RTCPeerConnection({ iceServers: options.iceServers ?? [] });
    const peer: Peer = { connection, candidates: [], work: Promise.resolve() };
    connection.onicecandidate = event => { if (!closed && connection.signalingState !== "closed") options.send({ type: "liveSignal", peerId, signal: { candidate: event.candidate ? { ...event.candidate.toJSON(), candidate: event.candidate.candidate } : null } }); };
    return peer;
  };
  const receiveSignal = (peer: Peer, signal: LiveSignal, peerId: string, load?: Load) => {
    peer.work = peer.work.then(async () => {
      if (peer.connection.signalingState === "closed") return;
      if (signal.description) {
        await peer.connection.setRemoteDescription(signal.description);
        for (const candidate of peer.candidates.splice(0)) await peer.connection.addIceCandidate(candidate ?? undefined);
        if (signal.description.type === "offer") {
          await peer.connection.setLocalDescription(await peer.connection.createAnswer());
          const description = peer.connection.localDescription!;
          if (peer.connection.connectionState !== "closed") options.send({ type: "liveSignal", peerId, signal: { description: { type: "answer", sdp: description.sdp } } });
        }
      } else if (signal.candidate !== undefined) {
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(signal.candidate ?? undefined);
        else if (peer.candidates.length < 64) peer.candidates.push(signal.candidate);
      }
    }).catch(reason => { if (load) failure(load, reason); });
  };
  const attach = (current: Receiver) => {
    if (receiver !== current || !current.load.liveOutput || closed) return;
    attachLive(current.load.playbackId, current.stream, current.load.liveOutput);
  };
  const startPublisher = (description: LivePeer) => {
    const current = publication;
    if (!current || publishers.has(description.peerId) || receiver?.local && receiver.peerId === description.peerId) return;
    const peer = makePeer(description.peerId);
    publishers.set(description.peerId, peer);
    for (const track of current.stream.getTracks()) if (track.kind === "audio" ? description.sound : description.picture) peer.connection.addTrack(track, current.stream);
    peer.work = (async () => {
      await peer.connection.setLocalDescription(await peer.connection.createOffer());
      if (closed || publication !== current || publishers.get(description.peerId) !== peer || peer.connection.signalingState === "closed") return;
      options.send({ type: "liveSignal", peerId: description.peerId, signal: { description: { type: "offer", sdp: peer.connection.localDescription!.sdp } } });
    })().catch(() => {});
  };
  const end = async () => {
    const sourceId = publication?.source.id;
    closePublication();
    if (sourceId) await options.command({ type: "endLive", sourceId });
  };
  return {
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
        capture = selection.kind === "microphone"
          ? await navigator.mediaDevices.getUserMedia({ audio: { ...(selection.audioDeviceId ? { deviceId: { exact: selection.audioDeviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
          : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true });
        if (closed || attempt !== generation) throw new Error("Capture was canceled.");
        const audio = capture.getAudioTracks(), video = selection.kind === "screen" ? capture.getVideoTracks() : [];
        if (selection.kind !== "screen" && !audio.length) throw new Error("The selected capture did not provide audio. Choose an audio input or grant system audio access.");
        if (selection.kind === "screen" && !video.length) throw new Error("The selected capture did not provide a screen.");
        const label = selection.kind === "microphone" ? "Microphone" : selection.kind === "system-audio" ? "System audio" : "Screen";
        const source: LiveSource = { id: crypto.randomUUID(), deviceId: deviceId(), name: `${localDeviceName() ?? "This device"} · ${label}`, kind: selection.kind, audio: !!audio.length, video: !!video.length };
        const current: Publication = { source, capture, stream: new MediaStream([...audio, ...video]), published: false };
        publication = current;
        // For audio-only desktop capture, retain its original video track until End.
        for (const track of capture.getTracks()) track.addEventListener("ended", () => { if (publication === current) void end().catch(() => {}); }, { once: true });
        await options.command({ type: "publishLive", sourceId: source.id, kind: source.kind, name: source.name, audio: source.audio, video: source.video });
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
      } finally { starting = false; if (couchApp?.prepareCapture) await couchApp.prepareCapture(null).catch(() => {}); }
    },
    end,
    observe(sources: LiveSource[]) {
      if (publication?.published && !sources.some(source => source.id === publication!.source.id)) closePublication();
    },
    receive(message: Extract<ServerMessage, { type: "livePeers" | "liveSignal" }>) {
      if (message.type === "liveSignal") {
        const peer = receiver?.peerId === message.peerId && !receiver.local ? receiver : publishers.get(message.peerId);
        if (peer) receiveSignal(peer, message.signal, message.peerId, receiver === peer ? receiver.load : undefined);
        return;
      }
      if (publication?.source.id !== message.sourceId) return;
      const wanted = new Set(message.peers.map(peer => peer.peerId));
      for (const [peerId, peer] of publishers) if (!wanted.has(peerId)) { peer.connection.close(); publishers.delete(peerId); }
      for (const peer of message.peers) startPublisher(peer);
    },
    play(command: PlaybackCommand): boolean {
      if (command.type === "load") {
        closeReceiver();
        if (!command.liveSourceId || !command.livePeerId || !command.liveOutput) return false;
        const peer = makePeer(command.livePeerId);
        const local = publication?.source.id === command.liveSourceId;
        const stream = local ? new MediaStream(publication!.stream.getTracks().filter(track => track.kind === "audio" ? command.liveOutput!.sound : command.liveOutput!.picture)) : new MediaStream();
        const current: Receiver = { ...peer, peerId: command.livePeerId, load: command, stream, local };
        receiver = current;
        // Retire URL media immediately, while the new peer connects.
        play({ type: "stop" });
        current.connection.ontrack = event => {
          if (receiver !== current) return;
          if (!current.stream.getTracks().includes(event.track)) current.stream.addTrack(event.track);
          attach(current);
        };
        current.connection.onconnectionstatechange = () => {
          if (current.connection.connectionState === "connected") clearTimeout(current.timeout);
          if (current.connection.connectionState === "failed") failure(command, new Error("The live connection failed. Stop and play this source again."));
        };
        if (!local) current.timeout = setTimeout(() => failure(command, new Error("Couldn't connect to this live source. Check network access or try another browser.")), 30_000);
        if (local) attach(current);
        return true;
      }
      if (command.type === "stop") { closeReceiver(); return false; }
      if (receiver && command.type === "volume") { receiver.load.liveOutput!.volume = command.volume; play(command); return true; }
      return false;
    },
    close() { closed = true; closeReceiver(); closePublication(); void couchApp?.prepareCapture?.(null).catch(() => {}); },
  };
}
