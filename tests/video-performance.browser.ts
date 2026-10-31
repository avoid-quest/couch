// Real renderer and live-session paths; only Core signaling and UI reads are fixtures.
import { mountUiAudit } from "./ui-audit.browser";
import { connectRenderer, play } from "../src/client/session/renderer";
import { createLiveSession } from "../src/client/session/live";
import type { PlayerState } from "../src/shared/protocol";
import type { LiveVideoFrameRate, LiveVideoQuality } from "../src/shared/live-input";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? null;
const summary = (values: number[]) => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : null });
const until = async (ready: () => boolean) => {
  const started = performance.now();
  while (!ready()) { if (performance.now() - started > 15_000) throw new Error("Video did not start"); await wait(25); }
};

export async function prepareVideo(mode: "playback" | "controls" | "live", media: string, frameRate: LiveVideoFrameRate, quality: LiveVideoQuality, codec?: string, hint?: string, bitrate = 0, jitter = 0, diagnostics = false, bitrateAtOffer = false, sound = false) {
  const audit = await mountUiAudit();
  const errors: string[] = [];
  const peers: RTCPeerConnection[] = [];
  const NativePeer = window.RTCPeerConnection;
  const parameters = (sender: RTCRtpSender) => {
    const value = sender.getParameters();
    return { kind: sender.track?.kind, encodings: value.encodings.map(({ active, maxBitrate, maxFramerate, scaleResolutionDownBy }) => ({ active, maxBitrate: maxBitrate ?? null, maxFramerate: maxFramerate ?? null, scaleResolutionDownBy: scaleResolutionDownBy ?? null })),
      codecs: value.codecs.map(({ mimeType, clockRate, channels }) => ({ mimeType, clockRate, channels })) };
  };
  const addedSenders: ReturnType<typeof parameters>[] = [];
  // Observe the production peers without changing codec selection, encoding or congestion control.
  window.RTCPeerConnection = class extends NativePeer {
    constructor(configuration?: RTCConfiguration) { super(configuration); peers.push(this); }
    override addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
      const sender = super.addTrack(track, ...streams);
      if (diagnostics) addedSenders.push(parameters(sender));
      if (codec && track.kind === "video") {
        const codecs = RTCRtpSender.getCapabilities("video")!.codecs;
        const preferred = codecs.filter(item => item.mimeType.toLowerCase() === `video/${codec}`);
        if (!preferred.length) throw new Error(`Unsupported codec: ${codec}`);
        this.getTransceivers().find(item => item.sender === sender)!.setCodecPreferences([...preferred, ...codecs.filter(item => !preferred.includes(item))]);
      }
      return sender;
    }
    override async createOffer(options?: RTCOfferOptions) {
      if (bitrate && bitrateAtOffer) for (const sender of this.getSenders()) if (sender.track?.kind === "video") {
        const value = sender.getParameters();
        for (const encoding of value.encodings) encoding.maxBitrate = bitrate;
        await sender.setParameters(value);
      }
      return super.createOffer(options);
    }
  };
  let latest: PlayerState | undefined;
  const disconnect = connectRenderer(state => { latest = state; });
  let publisher: ReturnType<typeof createLiveSession> | undefined, receiver: typeof publisher;
  let frame = 0, videoFrame = 0, clock: ReturnType<typeof setInterval> | undefined;
  let sampling = false, previous = 0;
  const gaps: number[] = [], processing: number[] = [], frameAge: number[] = [], tasks: number[] = [];
  const timings: { now: number; presentationTime: number; expectedDisplayTime: number; mediaTime: number; presentedFrames: number; width: number; height: number; captureTime: number | null; receiveTime: number | null; rtpTimestamp: number | null }[] = [];
  const dimensions = new Set<string>();
  let firstPresented: number | undefined, lastPresented: number | undefined, callbacks = 0;
  const longTasks = new PerformanceObserver(list => { if (sampling) tasks.push(...list.getEntries().map(entry => entry.duration)); });
  longTasks.observe({ type: "longtask" });
  const close = () => {
    sampling = false; clearInterval(clock); cancelAnimationFrame(frame);
    video?.cancelVideoFrameCallback(videoFrame); longTasks.disconnect();
    publisher?.close(); receiver?.close(); disconnect(); audit.close(); window.RTCPeerConnection = NativePeer;
  };
  let video: HTMLVideoElement;
  const started = performance.now();
  try {
    await audit.go("/now", { player: "playing", video: true });
    if (mode === "live") {
      const options = { iceServers: [], command: async () => {}, upload: () => { throw new Error("Unexpected buffered fallback"); }, failed: (error: Error) => errors.push(error.message), published: () => {} };
      publisher = createLiveSession({ ...options, send: message => {
        if (message.type === "liveSignal") queueMicrotask(() => receiver!.receive(message)); else errors.push(JSON.stringify(message));
      } });
      receiver = createLiveSession({ ...options, send: message => {
        if (message.type === "liveSignal") queueMicrotask(() => publisher!.receive(message)); else errors.push(JSON.stringify(message));
      } });
      const source = await publisher.start({ kind: "screen", includeAudio: sound, videoQuality: quality, videoFrameRate: frameRate });
      if (hint) publisher.sharing()!.stream.getVideoTracks()[0]!.contentHint = hint;
      receiver.play({ type: "load", playbackId: "p", source: "", liveSourceId: source.id, livePeerId: "benchmark", liveOutput: { picture: true, sound, volume: sound ? 1 : 0 } });
      publisher.receive({ type: "livePeers", sourceId: source.id, upload: false, peers: [{ peerId: "benchmark", deviceId: "benchmark-receiver", picture: true, sound }] });
    } else play({ type: "load", playbackId: "p", source: new URL(media, location.origin).href });
    video = document.querySelector<HTMLVideoElement>(".player-video video")!;
    if (!video) throw new Error("Production player did not mount its video");
    video.muted = !sound;
    video.loop = true;
    await until(() => video.readyState >= 3 && video.currentTime > 0 && !video.paused);
    if (bitrate && !bitrateAtOffer) for (const peer of peers) for (const sender of peer.getSenders()) if (sender.track?.kind === "video") {
      const parameters = sender.getParameters();
      parameters.encodings = parameters.encodings.map(encoding => ({ ...encoding, maxBitrate: bitrate }));
      await sender.setParameters(parameters);
    }
    if (jitter) for (const peer of peers) for (const receiver of peer.getReceivers()) if (receiver.track.kind === "video" && "jitterBufferTarget" in receiver) receiver.jitterBufferTarget = jitter;
    let audioContext: AudioContext | undefined, analyser: AnalyserNode | undefined;
    if (sound && video.srcObject instanceof MediaStream) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      audioContext.createMediaStreamSource(video.srcObject).connect(analyser);
      await audioContext.resume();
    }
    const audioRms = () => {
      if (!analyser) return 0;
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };
    const startupMs = performance.now() - started;
    await document.fonts.ready;
    // Real playback clock updates reach the production timeline while video keeps playing.
    clock = setInterval(() => { void audit.updateClock({ playbackId: "p", position: video.currentTime, duration: mode === "live" ? null : video.duration }); }, 250);
    const tick = (now: number) => {
      if (sampling && previous) gaps.push(now - previous);
      previous = sampling ? now : 0;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const presented: VideoFrameRequestCallback = (now, metadata) => {
      if (diagnostics) dimensions.add(`${metadata.width}x${metadata.height}`);
      if (sampling) {
        firstPresented ??= metadata.presentedFrames; lastPresented = metadata.presentedFrames; callbacks++;
        if (metadata.processingDuration !== undefined) processing.push(metadata.processingDuration * 1000);
        if (metadata.captureTime !== undefined) frameAge.push(metadata.expectedDisplayTime - metadata.captureTime);
        if (diagnostics && timings.length < 4096) timings.push({ now, presentationTime: metadata.presentationTime, expectedDisplayTime: metadata.expectedDisplayTime, mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames,
          width: metadata.width, height: metadata.height, captureTime: metadata.captureTime ?? null, receiveTime: metadata.receiveTime ?? null, rtpTimestamp: metadata.rtpTimestamp ?? null });
      }
      videoFrame = video.requestVideoFrameCallback(presented);
    };
    videoFrame = video.requestVideoFrameCallback(presented);
    const health = () => {
      const quality = video.getVideoPlaybackQuality();
      return { time: performance.now(), currentTime: video.currentTime, paused: video.paused, readyState: video.readyState, width: video.videoWidth, height: video.videoHeight,
        totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames, status: latest?.status, error: latest?.error,
        capture: publisher?.sharing()?.stream.getVideoTracks()[0]?.getSettings() };
    };
    const stats = async () => (await Promise.all(peers.map(async (peer, peerIndex) => [...(await peer.getStats()).values()].filter(item =>
      ["inbound-rtp", "outbound-rtp", "media-source", "codec", "candidate-pair"].includes(item.type)).map(item => ({ ...item, peerIndex }))))).flat();
    const senders = () => peers.flatMap((peer, peerIndex) => peer.getSenders().filter(sender => sender.track).map(sender => ({ peerIndex, ...parameters(sender) })));
    const preWarmup = diagnostics ? { ...health(), stats: await stats() } : null;
    const preparedSenders = diagnostics ? senders() : null;
    const stages: { health: ReturnType<typeof health>; stats: Awaited<ReturnType<typeof stats>> }[] = [];
    let before: ReturnType<typeof health>, beforeStats: Awaited<ReturnType<typeof stats>>;
    return {
      startupMs,
      async sample() { if (diagnostics && stages.length < 120) stages.push({ health: health(), stats: await stats() }); },
      async begin() { beforeStats = await stats(); before = health(); sampling = true; return before; },
      async finish() {
        sampling = false;
        const after = health(), afterStats = await stats(), decodedAudioRms = audioRms();
        void audioContext?.close();
        const seconds = (after.time - before.time) / 1000;
        if (sound) {
          const advances = (type: string, key: string) => afterStats.some(stat => stat.kind === "audio" && stat.type === type && stat[key] > (beforeStats.find(previous => previous.id === stat.id)?.[key] ?? 0));
          if (!publisher?.sharing()?.source.audio
            || !advances("outbound-rtp", "bytesSent") || !advances("inbound-rtp", "bytesReceived") || !(advances("inbound-rtp", "totalAudioEnergy") || decodedAudioRms > 0)) errors.push("Sharing sound must remain live with advancing sent/received bytes and decoded audio energy");
        }
        const total = after.totalFrames - before.totalFrames, dropped = after.droppedFrames - before.droppedFrames;
        const result = { mode, startupMs, seconds, decodedAudioRms, before, after, totalFrames: total, droppedFrames: dropped, droppedPercent: total ? dropped / total * 100 : null,
          // Playback quality counts include dropped frames; callbacks are limited by display refresh.
          videoFps: (total - dropped) / seconds, presentedFps: firstPresented === undefined ? 0 : (lastPresented! - firstPresented) / seconds, callbacks,
          frameMs: summary(gaps), uiFps: gaps.length / seconds, over25ms: gaps.filter(gap => gap > 25).length,
          decodeMs: summary(processing), captureToDisplayMs: summary(frameAge), longTasks: tasks, errors, beforeStats, afterStats,
          jitterTargets: peers.flatMap(peer => peer.getReceivers().filter(receiver => receiver.track.kind === "video").map(receiver => ({ supported: "jitterBufferTarget" in receiver, target: receiver.jitterBufferTarget }))) };
        Object.assign(result, diagnostics ? { preWarmup, addedSenders, preparedSenders, finalSenders: senders(), stages, timings, dimensions: [...dimensions], timingTruncated: timings.length === 4096 } : {});
        close(); return result;
      },
      close,
    };
  } catch (error) { close(); throw error; }
}
