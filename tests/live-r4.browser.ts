import { connectRenderer, play, renderInto } from "../src/client/session/renderer";
import { createLiveSession } from "../src/client/session/live";
import { listen, soundClock } from "../src/client/session/sendspin";
import type { PlaybackCommand, PlayerState, ServerMessage } from "../src/shared/protocol";

type Credentials = { id: string; token: string; key: string };
type Load = Extract<PlaybackCommand, { type: "load" }>;
async function until(check: () => boolean, label: string, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!check()) { if (performance.now() > deadline) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 50)); }
}
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

// Run one copy per frame, so every renderer, SDK clock, identity and socket is
// independent. The browser outputs stay muted; sound is decoded by the Node peer.
async function connectR4(credentials: Credentials) {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  localStorage.setItem("sendspin-identity-sk", credentials.key);
  const socket = new WebSocket(`${location.origin.replace("http:", "ws:")}/api/ws?${new URLSearchParams({ token: credentials.token, device: credentials.id, audio: "1", video: "1" })}`);
  let state: PlayerState | undefined, load: Load | undefined, loadCount = 0, failures = 0;
  const reports: PlayerState[] = [];
  const live = createLiveSession({ iceServers: [], send: message => { if (message.type === "liveFailed") failures++; socket.send(JSON.stringify(message)); }, command: async () => {}, upload: () => { throw new Error("receiver cannot upload"); }, failed: error => { throw error; }, published: () => {} });
  const detach = connectRenderer(player => { state = player; reports.push(player); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "player", state: player })); });
  renderInto(document.body);
  const muted = () => { for (const media of document.querySelectorAll("video,audio")) (media as HTMLMediaElement).muted = true; };
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "player") {
      if (message.command.type === "load") { load = message.command; loadCount++; }
      if (!live.play(message.command)) play(message.command);
      muted();
    } else if (message.type === "sendspin") listen(false, message.watch, "R4 picture clock");
    else if (message.type === "liveSignal" || message.type === "livePeers" || message.type === "liveIceServers") live.receive(message);
  };
  await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("receiver socket failed")); });
  return {
    snapshot: () => {
      const video = document.querySelector("video")!;
      return { loadCount, failures, load, state, clock: load?.follow ? soundClock(load.follow.group) : null, width: video.videoWidth, height: video.videoHeight, time: video.currentTime, paused: video.paused, frames: video.getVideoPlaybackQuality().totalVideoFrames, errors: reports.filter(report => report.error).map(report => report.error) };
    },
    failRTC: () => {
      check(load?.livePeerId, "receiver has no RTC peer to fail");
      // Exercise the real RTCPeerConnection rejection and production fallback
      // handler, without changing the browser's WebRTC implementation.
      live.receive({ type: "liveSignal", peerId: load!.livePeerId!, signal: { description: { type: "offer", sdp: "R4 intentionally invalid offer" } } });
    },
    close: () => { live.close(); listen(false, false, "R4"); detach(); socket.close(); },
  };
}

type R4Window = Window & { connectR4: typeof connectR4; eval: (source: string) => unknown };
Object.assign(window, { connectR4, runR4Browser: async (control: string) => {
  const config = await (await fetch(`${control}/config`)).json() as { page: string; clients: Credentials[] };
  const bundle = await (await fetch(`${control}/bundle`)).text();
  const frames: HTMLIFrameElement[] = [], receivers: Awaited<ReturnType<typeof connectR4>>[] = [];
  const action = async (name: string) => {
    const response = await fetch(`${control}/${name}`, { method: "POST" });
    const value = await response.json();
    check(response.ok, JSON.stringify(value));
    return value;
  };
  const viewer = async (index: number) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:320px;height:180px;border:0";
    frame.src = `${config.page}?r4=${index}`;
    frames.push(frame);
    const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
    document.body.append(frame);
    await loaded;
    const target = frame.contentWindow as R4Window;
    target.eval(bundle);
    const receiver = await target.connectR4(config.clients[index - 1]!);
    receivers.push(receiver);
    return receiver;
  };
  try {
    const fallback = await viewer(1), picture = await viewer(2);
    await action("add-picture");
    await until(() => !!fallback.snapshot().load?.livePeerId && !!picture.snapshot().load?.livePeerId, "RTC routing missing");
    fallback.failRTC();
    await until(() => fallback.snapshot().width === 160 && fallback.snapshot().frames >= 10 && !!fallback.snapshot().load?.hls, "fallback HLS did not decode");
    const fallbackResult = fallback.snapshot();
    check(fallbackResult.failures === 1 && !fallbackResult.load?.follow, "fallback did not isolate the failed RTC peer");
    fallback.close();
    await action("split");
    await until(() => picture.snapshot().width === 160 && picture.snapshot().frames >= 10 && !!picture.snapshot().clock && picture.snapshot().state?.timeline?.mapping === "hls", "split picture did not follow the real SDK clock");
    const before = picture.snapshot();
    const late = await viewer(3);
    await action("add-late");
    await until(() => late.snapshot().width === 160 && late.snapshot().frames >= 10 && !!late.snapshot().clock && late.snapshot().state?.timeline?.mapping === "hls", "independent late picture did not decode");
    const after = picture.snapshot(), joined = late.snapshot();
    check(after.loadCount === before.loadCount && after.frames > before.frames, "late join disrupted the existing picture");
    check(after.load?.follow?.group === joined.load?.follow?.group, "pictures follow different programmes");
    const restarted = await action("restart");
    await until(() => picture.snapshot().loadCount > after.loadCount && picture.snapshot().frames >= 10 && !!picture.snapshot().clock && picture.snapshot().state?.timeline?.mapping === "hls", "re-ingest picture did not recover");
    const recovered = picture.snapshot();
    check(recovered.clock!.position > after.clock!.position, "publication clock reset on re-ingest");
    check(recovered.errors.length === 0 && joined.errors.length === 0 && fallbackResult.errors.length === 0, "renderer reported an error");
    const result = { fallback: fallbackResult, split: before, existingAfterLateJoin: after, late: joined, recovered, software: restarted, browser: navigator.userAgent };
    await fetch(`${control}/receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
    return result;
  } finally { for (const receiver of receivers) receiver.close(); for (const frame of frames) frame.remove(); await action("end").catch(() => {}); }
} });
