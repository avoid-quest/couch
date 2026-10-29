import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Mixer } from "../src/client/sections/shell/Outputs";
import { createCompressor } from "../src/client/session/compressor";
import { defaultCompressor, type CompressorSettings } from "../src/shared/compressor";
import { deviceId } from "../src/client/session/device-id";
import { attachStream, connectRenderer, play, renderInto } from "../src/client/session/renderer";
import type { Action, PlayerState } from "../src/shared/protocol";
import type { ClientSessionState } from "../src/client/session/session";
import { applyTvNavigation, useNavigation } from "../src/client/navigation";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const until = async (ready: () => boolean, message: string) => {
  const deadline = performance.now() + 2000;
  while (!ready()) { assert(performance.now() < deadline, message); await wait(10); }
};
const active = { ...defaultCompressor, enabled: true };
const stress = { ...active, threshold: -60, ratio: 20, attack: 0.1, release: 1, knee: 18, gain: 12 };
let settings: CompressorSettings = { ...active }, commands: Action[] = [], latest: PlayerState;
const contexts: AudioContext[] = [], sources: HTMLMediaElement[] = [];
const compressors: { node: DynamicsCompressorNode; connected: boolean }[] = [];
const NativeAudioContext = window.AudioContext;
window.AudioContext = class extends NativeAudioContext {
  constructor(options?: AudioContextOptions) { super(options); contexts.push(this); }
  override createMediaElementSource(element: HTMLMediaElement) { sources.push(element); return super.createMediaElementSource(element); }
  override createDynamicsCompressor() {
    const node = super.createDynamicsCompressor(), record = { node, connected: false };
    const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
    node.connect = ((...args: Parameters<AudioNode["connect"]>) => { record.connected = true; return Reflect.apply(connect, node, args); }) as AudioNode["connect"];
    node.disconnect = ((...args: Parameters<AudioNode["disconnect"]>) => { record.connected = false; return Reflect.apply(disconnect, node, args); }) as AudioNode["disconnect"];
    compressors.push(record); return node;
  }
};
const root = createRoot(document.getElementById("fixture")!);
function Controls() {
  useNavigation(() => {});
  const [current, setCurrent] = useState(settings);
  const id = deviceId(), outputs = [{ deviceId: id, picture: true, sound: true }];
  const state = { playback: "fixture", controlling: id, compressor: current, outputs, devices: [{ id, name: "Studio TV", online: true, volume: 50, muted: false }],
    queue: [{ id: "film", source: "/tone.wav", title: "Compressor fixture" }], currentEntryId: "film",
    playbacks: [{ id: "fixture", title: "Compressor fixture", status: "playing", outputs }],
    player: { playbackId: "audio", status: "playing", position: 0, duration: 8, volume: 50, seekable: true, error: null },
  } as ClientSessionState;
  return <main className="mx-auto grid w-full gap-2 p-4" style={{ maxWidth: 512 }}><Mixer state={state} tv={new URLSearchParams(location.search).has("tv")} connected run={async action => {
    commands.push(action);
    if (action.type === "compressor") { settings = { ...settings, ...action.settings }; setCurrent(settings); play({ ...action, settings }); }
    return true;
  }} /></main>;
}
const mount = () => flushSync(() => root.render(<Controls key={Math.random()} />));
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(element => element.getAttribute("aria-label") === label || element.textContent === label)!;
const edit = (name: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${name} value"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const picture = document.createElement("div");
picture.style.cssText = "width:1px;height:1px;overflow:hidden";
document.body.append(picture);
connectRenderer(state => { latest = state; });
renderInto(picture);
async function loaded(options: object = {}) {
  play({ type: "load", playbackId: "audio", source: `${location.origin}/tone.wav`, ...options });
  const video = picture.querySelector("video")!;
  video.loop = true;
  const deadline = performance.now() + 5000;
  while (latest?.status !== "playing") {
    assert(latest?.status !== "error", latest?.error ?? "Renderer error");
    assert(performance.now() < deadline, "Renderer did not start: " + JSON.stringify(latest));
    await wait(20);
  }
  return video;
}

async function render(settings: CompressorSettings, volume = 1, silent = false) {
  const rate = 48000, context = new OfflineAudioContext(2, rate * 3, rate), buffer = context.createBuffer(2, rate * 3, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = silent ? 0 : Math.sin(2 * Math.PI * 997 * i / rate) * (i < rate ? .04 : .8) / (channel + 1);
  }
  const source = context.createBufferSource(), graph = createCompressor(context, settings);
  graph.volume(volume); source.buffer = buffer; source.connect(graph.input); graph.output.connect(context.destination); source.start();
  const output = await context.startRendering(); graph.close(); return output;
}
const rms = (data: Float32Array, start: number, end: number) => Math.sqrt(data.slice(start * 48000, end * 48000).reduce((sum, value) => sum + value * value, 0) / ((end - start) * 48000));
async function transitionSignal() {
  const context = new OfflineAudioContext(2, 48000 * 2, 48000), oscillator = context.createOscillator();
  const source = context.createGain(), graph = createCompressor(context, defaultCompressor);
  oscillator.frequency.value = 997; source.gain.value = .2;
  oscillator.connect(source).connect(graph.input); graph.output.connect(context.destination); oscillator.start();
  // Suspends the actual audio clock so edits land at deterministic sample positions.
  const changes = [[.25, true], [.5, false], [.512, true], [.524, false], [.8, true], [1.2, false]] as const;
  const edits = changes.map(([at, enabled]) => context.suspend(at).then(() => { graph.set({ ...active, enabled }); return context.resume(); }));
  const rendered = await context.startRendering(); await Promise.all(edits); graph.close();
  const samples = rendered.getChannelData(0);
  let peak = 0, jump = 0;
  for (let i = 1; i < samples.length; i++) { peak = Math.max(peak, Math.abs(samples[i]!)); jump = Math.max(jump, Math.abs(samples[i]! - samples[i - 1]!)); }
  assert(peak < .4 && jump < .06, `Toggle introduced a spike: peak=${peak}, adjacent-sample change=${jump}`);
  assert(Math.abs(rms(samples, 1.5, 1.8) - .2 / Math.sqrt(2)) < .001, "Bypass did not settle to unity");
  return { peak, jump };
}
export async function runChecks() {
  play({ type: "stop" }); contexts.length = 0; sources.length = 0;
  const compressed = await render(active), bypassed = await render(defaultCompressor), quiet = await render(active, .25), trimmed = await render({ ...active, gain: -6 });
  const left = compressed.getChannelData(0), right = compressed.getChannelData(1), dry = bypassed.getChannelData(0);
  const dynamicRatio = rms(left, 2, 2.8) / rms(left, .6, .9);
  assert(dynamicRatio < 10, `Compression did not reduce the 20:1 input contrast: ${dynamicRatio}`);
  assert(Math.abs(rms(left, 2, 2.8) / rms(right, 2, 2.8) - 2) < .001, "Stereo balance changed");
  assert(Math.abs(rms(quiet.getChannelData(0), 2, 2.8) / rms(left, 2, 2.8) - .25) < .001, "Listener volume changed compression");
  assert(Math.abs(rms(trimmed.getChannelData(0), 2, 2.8) / rms(left, 2, 2.8) - 10 ** (-6 / 20)) < .001, "Output trim is wrong");
  let bypassError = 0;
  for (let i = 96000; i < 120000; i++) bypassError = Math.max(bypassError, Math.abs(dry[i]! - .8 * Math.sin(2 * Math.PI * 997 * (i - 288) / 48000)));
  assert(bypassError < .0001, `Bypass changed the input: ${bypassError}`);
  for (const sample of (await render(stress)).getChannelData(0)) assert(Number.isFinite(sample), "Extreme settings produced a nonfinite sample");
  assert(rms((await render(active, 1, true)).getChannelData(0), 0, 3) === 0, "Silence produced noise");
  const transition = await transitionSignal();
  // Firefox still lacks cancelAndHoldAtTime; the fallback must keep rapid changes smooth.
  const hold = Object.getOwnPropertyDescriptor(AudioParam.prototype, "cancelAndHoldAtTime")!;
  let fallbackTransition;
  try { Object.defineProperty(AudioParam.prototype, "cancelAndHoldAtTime", { value: undefined, configurable: true }); fallbackTransition = await transitionSignal(); }
  finally { if (hold) Object.defineProperty(AudioParam.prototype, "cancelAndHoldAtTime", hold); else Reflect.deleteProperty(AudioParam.prototype, "cancelAndHoldAtTime"); }

  const initial = await loaded();
  assert(contexts.length === 0, "Off created a processing context");
  const single = await loaded({ compressor: active });
  assert(sources.at(-1) === single && single.volume === 1, "Single-source Direct didn't use the video at unity gain");
  play({ type: "volume", playbackId: "audio", volume: 27 });
  assert(single.volume === 1 && latest.volume === 27, "Volume must be applied after the compressor");
  const context = contexts.at(-1)!;
  play({ type: "compressor", playbackId: "audio", settings: defaultCompressor });
  play({ type: "compressor", playbackId: "audio", settings: active });
  assert(contexts.at(-1) === context && single === picture.querySelector("video"), "Toggling recreated the graph or media");
  play({ type: "follow", playbackId: "audio", follow: { group: "fixture" } });
  // This fixture has no Sendspin clock, so picture playback waits for it.
  await until(() => single.paused && context.state === "suspended", "Synced picture did not wait for its clock");
  assert(single.muted && context.state === "suspended", "Synced picture retained local processing");
  play({ type: "follow", playbackId: "audio", follow: null, compressor: active });
  play({ type: "pause", playbackId: "audio", paused: false });
  await until(() => context.state === "running", "Direct did not resume its graph");
  assert(!single.muted && context.state === "running", "Direct did not resume its graph");
  play({ type: "follow", playbackId: "audio", follow: { group: "fixture" } });
  play({ type: "follow", playbackId: "audio", follow: null, compressor: active });
  play({ type: "pause", playbackId: "audio", paused: false });
  await wait(50);
  await until(() => context.state === "running", "A quick return to Direct left its graph suspended");
  assert(context.state === "running", "A quick return to Direct left its graph suspended");
  const split = await loaded({ compressor: active, audioSource: `${location.origin}/tone.wav` });
  assert(sources.at(-1)?.tagName === "AUDIO" && split.muted, "Split audio processed the wrong element");
  assert(picture.contains(split) && split !== single, "Replacing the source lost its picture container");
  const count = contexts.length, stream = new MediaStream();
  attachStream({ type: "load", playbackId: "live", source: "", liveSourceId: "capture", paused: true }, stream);
  const live = picture.querySelector("video")!;
  assert(live !== split && live.srcObject === stream && contexts.length === count, "WebRTC inherited the media graph");
  split.dispatchEvent(new Event("error"));
  assert(latest.status !== "error", "A discarded media element broke the next load");
  await loaded({ liveSourceId: "capture", compressor: active });
  assert(contexts.length === count, "Buffered Live Share created a compressor");
  await loaded();
  assert(contexts.length === count && picture.querySelector("video")!.crossOrigin === null, "Off retained CORS/processing on the next item");
  assert(initial !== picture.querySelector("video"), "Media source binding was not discarded");

  commands = []; settings = { ...active }; mount();
  button("Advanced compressor settings").click(); await wait(20);
  assert(commands.length === 0, "Opening Advanced changed the sound");
  edit("Threshold", "-24"); edit("Ratio", "4"); await wait(20);
  assert(commands.length === 0 && !button("Apply").disabled, "Drafts were applied before Apply");
  button("Apply").click(); await wait(20);
  assert(commands.length === 1 && settings.threshold === -24 && settings.ratio === 4, "Advanced edits were not batched");
  edit("Ratio", "21"); await wait(20);
  assert(button("Apply").disabled, "An invalid ratio can be applied");
  button("Reset to default").click(); await wait(20);
  assert(commands.length === 1, "Reset applied without confirmation");
  button("Apply").click(); await wait(20);
  assert(settings.threshold === defaultCompressor.threshold && settings.enabled, "Reset changed the switch or failed to restore defaults");
  const threshold = document.querySelector<HTMLElement>('[role="slider"][aria-label="Threshold"]')!;
  threshold.focus(); applyTvNavigation("right"); await wait(20);
  assert(threshold.getAttribute("aria-valuenow") === "-17", "Remote arrows could not edit the threshold");
  applyTvNavigation("down"); await wait(20);
  assert(document.activeElement?.getAttribute("aria-label") === "Ratio", "Remote could not leave the slider for the next setting");
  assert(document.documentElement.scrollWidth <= innerWidth, "Mixer overflows the viewport");
  play({ type: "stop" });
  return { passed: true, dynamicRatio, bypassError, transition, fallbackTransition, checks: ["signal", "stereo", "volume", "trim", "bypass", "extremes", "silence", "transition", "direct", "follow", "split", "live exclusion", "reset", "advanced drafts", "bounds", "remote navigation", "layout"] };
}
let editTimer: ReturnType<typeof setInterval> | undefined;
async function realtimeTransitionSignal() {
  const context = new AudioContext(), source = context.createOscillator(), level = context.createGain(), analyser = context.createAnalyser();
  const graph = createCompressor(context, active);
  analyser.fftSize = 32768; source.frequency.value = 997; level.gain.value = .2;
  source.connect(level).connect(graph.input); graph.output.connect(analyser).connect(context.destination);
  try {
    await context.resume(); source.start(); await wait(900);
    graph.set(defaultCompressor); await wait(200); // Includes the real timer disconnecting the wet path.
    graph.set(active); await wait(200);
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    let peak = 0, jump = 0, minimumRms = Infinity;
    for (let i = 1; i < samples.length; i++) { peak = Math.max(peak, Math.abs(samples[i]!)); jump = Math.max(jump, Math.abs(samples[i]! - samples[i - 1]!)); }
    const block = Math.round(context.sampleRate / 1000);
    for (let at = 0; at + block <= samples.length; at += block) minimumRms = Math.min(minimumRms, Math.sqrt(samples.slice(at, at + block).reduce((sum, sample) => sum + sample * sample, 0) / block));
    assert(peak < .4 && jump < .06 && minimumRms > .1, `Realtime bypass/reconnect disturbed output: ${JSON.stringify({ peak, jump, minimumRms })}`);
    return { peak, jump, minimumRms };
  } finally { source.stop(); graph.close(); await context.close(); }
}
export async function runPerformanceChecks() {
  await loaded({ compressor: active });
  const context = contexts.at(-1)!;
  play({ type: "pause", playbackId: "audio", paused: true }); await wait(150);
  const idle = context.state;
  play({ type: "pause", playbackId: "audio", paused: false }); await wait(150);
  assert(context.state === "running", "Resume did not restart audio processing");
  play({ type: "compressor", playbackId: "audio", settings: defaultCompressor }); await wait(150);
  const bypassConnected = compressors.at(-1)!.connected;
  // Rapid remote changes must converge to one active path without creating more contexts.
  for (let i = 0; i < 12; i++) { play({ type: "compressor", playbackId: "audio", settings: i % 2 ? active : defaultCompressor }); await wait(8); }
  await wait(150);
  assert(compressors.at(-1)!.connected && contexts.at(-1) === context, "Rapid toggles lost the compressor or recreated its context");
  play({ type: "pause", playbackId: "audio", paused: true });
  play({ type: "pause", playbackId: "audio", paused: false }); await wait(150);
  assert(context.state === "running", "A quick resume lost its audio context");
  play({ type: "load", playbackId: "audio", source: `${location.origin}/tone.wav`, compressor: active, paused: true }); await wait(150);
  assert(contexts.at(-1)!.state === "suspended", "Loading a paused item started continuous processing");
  play({ type: "stop" });
  assert(idle === "suspended" && !bypassConnected, `Unnecessary audio work: paused context=${idle}; bypass compressor connected=${bypassConnected}`);
  return { passed: true, pausedContext: idle, bypassConnected, realtimeTransition: await realtimeTransitionSignal() };
}
export async function prepare(mode: string) {
  clearInterval(editTimer); settings = mode === "stress" ? stress : active; mount();
  const started = performance.now();
  const media = document.documentElement.dataset.media ?? "/tone.wav";
  const video = await loaded({ source: new URL(media, location.origin).href, ...mode === "none" || mode === "paused-native" ? {} : { compressor: settings } });
  picture.style.cssText = video.videoWidth ? "width:100%;max-width:640px;margin:auto" : "width:1px;height:1px;overflow:hidden";
  if (mode === "bypass") play({ type: "compressor", playbackId: "audio", settings: defaultCompressor });
  if (mode.startsWith("paused")) play({ type: "pause", playbackId: "audio", paused: true });
  if (mode === "advanced") {
    button("Advanced compressor settings").click();
    let step = 0;
    editTimer = setInterval(() => edit("Threshold", String(-18 - ++step % 10)), 250);
  }
  if (mode === "toggle") {
    let enabled = true;
    editTimer = setInterval(() => { enabled = !enabled; play({ type: "compressor", playbackId: "audio", settings: { ...active, enabled } }); performance.mark(enabled ? "compressor-on" : "compressor-bypass"); }, 2000);
  }
  performance.mark(`compressor-case-${mode}`);
  const current = contexts.findLast(context => context.state !== "closed");
  return { startupMs: performance.now() - started, contexts: contexts.filter(context => context.state !== "closed").length, sampleRate: current?.sampleRate, outputLatency: current?.outputLatency, baseLatency: current?.baseLatency };
}
export function playbackHealth() {
  const video = picture.querySelector("video")!, quality = video.getVideoPlaybackQuality();
  const context = contexts.findLast(context => context.state !== "closed"), stats = (context as AudioContext & { playbackStats?: { toJSON(): unknown } })?.playbackStats;
  return { status: latest.status, error: latest.error, currentTime: video.currentTime, paused: video.paused, contextState: context?.state, decodedFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames, audio: stats?.toJSON() ?? null };
}
mount();
