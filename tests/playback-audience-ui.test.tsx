import { expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Action, PlaybackControls } from "../src/shared/protocol";
import type { ClientSessionState } from "../src/client/session/session";

// Exercise the product components and their emitted commands. Only browser/hook
// boundaries are replaced; these tests do not qualify physical audio or timing.
const effects: (() => void | (() => void))[] = [];
const react = await import("react");
mock.module("react", () => ({ ...react, useEffect: (effect: () => void | (() => void)) => effects.push(effect), useEffectEvent: (callback: unknown) => callback }));
const here = "listener";
mock.module("../src/client/session/device-id", () => ({ deviceId: () => here, announcePlay() {}, playsOn: () => null, localDeviceName: () => "Phone", subscribeDeviceIdentity: () => () => {}, useLocalDeviceName: () => "Phone" }));
const sent: Action[] = [];
const audience: PlaybackControls = { programme: false, queue: false, seek: false, speed: false, audioDelay: false, subtitleDelay: false, leave: true };
let state = fixture();
let connected = true;
const run = async (action: Action) => { sent.push(action); return true; };
mock.module("../src/client/session/session-context", () => ({ useSessionGate: () => ({ state, connected, run, seekBy: (seconds: number) => { throw new Error(`unexpected seek ${seconds}`); }, credentials: { origin: "http://couch", token: "test" } }), useOptionalSessionGate: () => ({ state, connected, run }) }));
const query = await import("@tanstack/react-query");
mock.module("@tanstack/react-query", () => ({ ...query, queryOptions: (options: unknown) => options, useQuery: () => ({ data: {} }), useMutation: () => ({ isPending: false }) }));
mock.module("../src/client/radio-clock", () => ({ useRadioClock: () => 0 }));
let hotkeys: { hotkey: string; enabled?: boolean; action: () => unknown }[] = [];
mock.module("../src/client/useCouchHotkeys", () => ({ useCouchHotkeys: (keys: typeof hotkeys) => { hotkeys = keys; } }));
mock.module("../src/client/sections/shell/shell-context", () => ({ useShell: () => ({ section: "Now", changeSection() {}, openPlayer() {}, focusSearch() {} }) }));
const { PlaybackTransport, PlaybackVolume, LiveParticipation, VolumeButton } = await import("../src/client/components/PlaybackTransport");
const { PlaybackMenu } = await import("../src/client/components/PlaybackSettings");
const { KeyboardShortcuts } = await import("../src/client/sections/shell/KeyboardShortcuts");
const { hasUpNext, UpNextButton } = await import("../src/client/sections/now/QueuePanel");
const { useMediaSession } = await import("../src/client/session/media-session");
const { useLiveSourceHits } = await import("../src/client/sections/find/useLiveSourceHits");
const { useItemMenu } = await import("../src/client/components/RowMenu");

function fixture(): ClientSessionState {
  const outputs = [{ deviceId: here, picture: false, sound: true }];
  return { playback: "session", controlling: "tv", outputs, devices: [{ id: here, name: "Phone", online: true, volume: 27, muted: false }, { id: "tv", name: "TV", online: true, sharing: { audio: true, video: true }, volume: 91, muted: true }],
    controls: audience, playbacks: [{ id: "session", title: "Concert", liveSourceId: "source", intent: "live", delivery: "scheduled", status: "playing", outputs }],
    liveSources: [{ id: "source", name: "Concert", deviceId: "publisher", kind: "microphone", video: false, audio: true, intent: "live" }],
    queue: [{ id: "entry", title: "Concert", source: "live:source", liveSourceId: "source", live: true }, { id: "next", title: "Next", source: "web:https://example.com/movie", duration: 300 }], currentEntryId: "entry",
    player: { playbackId: "load-generation", status: "playing", seekable: true, speed: 1.25, volume: 91, error: null, audioDelay: .3, subtitleDelay: .4, tracks: [{ id: "captions", index: 0, kind: "subtitle", label: "English", language: "en", selected: true }] },
  } as ClientSessionState;
}

type Props = { children?: ReactNode; label?: string; "aria-label"?: string; disabled?: boolean; value?: number; onClick?: () => unknown; onCommit?: (value: number) => unknown; [key: string]: unknown };
const elements = (node: ReactNode): { type: unknown; props: Props }[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
function read<T>(render: () => T): T {
  let result: T;
  renderToStaticMarkup(createElement(function Read() { result = render(); return null; }));
  return result!;
}
const buttons = (node: ReactNode) => elements(node).filter(element => typeof element.props.onClick === "function");

test("listener transport is local Leave, queue is absent, and repeated presses emit one leave generation", async () => {
  state = fixture(); sent.length = 0;
  const html = renderToStaticMarkup(<PlaybackTransport state={state} connected run={run} />);
  expect(html).toContain(">Leave</button>");
  expect(html).not.toMatch(/aria-label="(?:Pause|Stop|Next)"/);
  expect(hasUpNext(state)).toBe(false);
  expect(UpNextButton({ state })).toBeNull();
  const tree = read(() => LiveParticipation({ state, connected: true, run }));
  const button = buttons(tree)[0]!;
  const first = button.props.onClick!();
  await button.props.onClick!();
  await first;
  expect(sent).toEqual([{ type: "leave", playbackId: "load-generation" }]);
});

test("Join always targets this listener even while its browser controls a TV", async () => {
  state = { ...fixture(), player: { ...fixture().player, playbackId: null }, controls: { ...audience, leave: false }, outputs: [] }; sent.length = 0;
  const tree = read(() => LiveParticipation({ state, connected: true, run }));
  expect(buttons(tree)[0]!.props.disabled).toBe(false);
  await buttons(tree)[0]!.props.onClick!();
  expect(sent).toEqual([{ type: "playLive", sourceId: "source", deviceId: here }]);
  let hits: ReturnType<typeof useLiveSourceHits> = [];
  read(() => { hits = useLiveSourceHits(""); });
  expect(hits[0]!.primary.label).toBe("Join");
  expect(hits[0]!.actions.map(action => action.label)).toEqual(["Join", "Play on"]);
  hits[0]!.primary.run();
  expect(sent.at(-1)).toEqual({ type: "playLive", sourceId: "source", deviceId: here });
});

test("audience volume and mute read and change only its own device; Remote can name an authorized output", async () => {
  state = fixture(); sent.length = 0;
  const tree = PlaybackVolume({ state, connected: true, run });
  const all = elements(tree);
  expect(all.find(item => item.props.label === "Your volume")!.props.value).toBe(27);
  await all.find(item => item.props.label === "Your volume")!.props.onCommit!(40);
  await all.find(item => item.props["aria-label"] === "Mute")!.props.onClick!();
  expect(sent).toEqual([{ type: "volume", deviceId: here, volume: 40 }, { type: "mute", deviceId: here, muted: true }]);
  const remote = elements(PlaybackVolume({ state, connected: true, run, targetDeviceId: "tv" }));
  await remote.find(item => item.props.label === "Volume")!.props.onCommit!(32);
  expect(sent.at(-1)).toEqual({ type: "volume", deviceId: "tv", volume: 32 });
});

test("Core rights hide settings and queue verbs, and disable programme shortcuts while own-volume shortcuts remain", () => {
  state = fixture(); sent.length = 0;
  const tree = read(() => PlaybackMenu({ player: state.player, controls: audience, ready: true, connected: true, credentials: { origin: "http://couch", token: "test" }, preferences: {} as never, profile: { id: "profile" } as never, onCommand: run, trigger: null }));
  expect(elements(tree).filter(item => item.props["data-view"])).toHaveLength(0);
  const menu = read(() => useItemMenu([{ label: "Queue", run() {} }, { label: "Play next", run() {} }, { label: "Details", run() {} }]));
  expect(menu.shown.map(item => item.label)).toEqual(["Details"]);
  read(() => KeyboardShortcuts({ open: false, onOpenChange() {} }));
  for (const key of ["K", "Space", "J", "L", "ArrowLeft", "ArrowRight", "0", "C", "Shift+N", "Q"]) expect(hotkeys.find(item => item.hotkey === key)?.enabled).toBe(false);
  hotkeys.find(item => item.hotkey === "ArrowUp")!.action();
  hotkeys.find(item => item.hotkey === "M")!.action();
  expect(sent).toEqual([{ type: "volume", deviceId: here, volume: 32 }, { type: "mute", deviceId: here, muted: true }]);
});

test("the real playback menu keeps split audio delay and omits unsupported muxed delay", () => {
  const menu = (audioDelay: number | undefined, allowed = true) => read(() => PlaybackMenu({ player: { ...fixture().player, audioDelay }, controls: { ...audience, programme: true, audioDelay: allowed }, ready: true, connected: true, credentials: { origin: "http://couch", token: "test" }, preferences: {} as never, profile: { id: "profile" } as never, onCommand: run, trigger: null }));
  const delayRows = (tree: ReactNode) => elements(tree).filter(item => item.props["data-view"] === "audioDelay");
  expect(delayRows(menu(undefined))).toHaveLength(0);
  expect(delayRows(menu(.3))).toHaveLength(1);
  expect(delayRows(menu(.3, false))).toHaveLength(0);
});

test("Live owns Media Session without a queued item, Stop leaves, and ordinary playback is restored", () => {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const mediaSession = { metadata: null as MediaMetadata | null, playbackState: "none", position: undefined as MediaPositionState | undefined,
    setActionHandler: (action: string, callback: MediaSessionActionHandler | null) => handlers.set(action, callback),
    setPositionState(position?: MediaPositionState) { this.position = position; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession } });
  Object.assign(globalThis, { MediaMetadata: class { constructor(metadata: MediaMetadataInit) { Object.assign(this, metadata); } } });
  effects.length = 0; sent.length = 0;
  state = { ...fixture(), queue: [], currentEntryId: null };
  read(useMediaSession);
  for (const effect of effects.splice(0)) effect();
  expect(mediaSession.metadata?.title).toBe("Concert");
  expect(mediaSession.playbackState).toBe("playing");
  expect(mediaSession.position).toBeUndefined();
  for (const action of ["play", "pause", "nexttrack", "seekto", "seekbackward", "seekforward"]) expect(handlers.get(action)).toBeNull();
  expect(typeof handlers.get("stop")).toBe("function");
  handlers.get("stop")!({ action: "stop" });
  expect(sent).toEqual([{ type: "leave", playbackId: "load-generation" }]);
  // Ordinary player updates cannot clear Live or supply stale programme metadata.
  state = { ...state, player: { ...state.player, status: "idle", nowPlaying: { title: "Old programme", artist: "Old artist" } } };
  read(useMediaSession);
  for (const effect of effects.splice(0)) effect();
  expect(mediaSession.metadata).toMatchObject({ title: "Concert", artist: "", album: "", artwork: [] });
  expect(mediaSession.playbackState).toBe("playing");
  state = { ...fixture(), controls: undefined, playbacks: [], liveSources: [], player: { ...fixture().player, status: "paused" }, queue: [{ id: "entry", source: "web:https://example.com/movie", title: "Film", duration: 300 }, { id: "next", source: "web:https://example.com/next", title: "Next" }] };
  read(useMediaSession);
  for (const effect of effects.splice(0)) effect();
  expect(mediaSession.metadata?.title).toBe("Film");
  expect(mediaSession.playbackState).toBe("paused");
  expect(mediaSession.position).toEqual({ duration: 300, position: 0, playbackRate: 1.25 });
  for (const action of ["play", "pause", "stop", "nexttrack", "seekto"]) expect(typeof handlers.get(action)).toBe("function");
  handlers.get("stop")!({ action: "stop" });
  expect(sent.at(-1)).toEqual({ type: "stop", playbackId: "load-generation" });
  // A remaining source and audience do not claim this device after it leaves.
  state = { ...fixture(), controls: { ...audience, leave: false }, outputs: [], queue: [], currentEntryId: null, player: { ...fixture().player, playbackId: null, status: "idle" } };
  read(useMediaSession);
  for (const effect of effects.splice(0)) effect();
  expect(mediaSession.metadata).toBeNull();
  expect(mediaSession.playbackState).toBe("none");
  expect(mediaSession.position).toBeUndefined();
  expect([...handlers.values()].every(value => value === null)).toBe(true);
});

test("a receiver failure is actionable and disconnected audience controls cannot send", () => {
  state = fixture();
  state.outputs![0]!.error = "This output cannot decode audio.";
  const html = renderToStaticMarkup(<PlaybackTransport state={state} connected run={run} />);
  expect(html).toContain("This output cannot decode audio.");
  expect(html).not.toContain("leave and join again");
  connected = false;
  expect(renderToStaticMarkup(<PlaybackTransport state={state} connected={connected} run={run} />)).toContain("disabled");
  connected = true;
});

test("reconnect and Join remain local", async () => {
  const state = fixture();
  let html = renderToStaticMarkup(<PlaybackTransport state={state} connected={false} run={run} />);
  expect(html).toContain("Reconnecting…");
  expect(html).not.toContain("Preparing audio");
  state.outputs![0]!.sound = false;
  html = renderToStaticMarkup(<PlaybackTransport state={state} connected run={run} />);
  expect(html).not.toContain("Preparing audio");
  state.controls = { ...audience, leave: false };
  state.outputs = [{ deviceId: "tv", picture: false, sound: true }];
  html = renderToStaticMarkup(<PlaybackTransport state={state} connected run={run} />);
  expect(html).toContain(">Join</button>");
  expect(html).not.toMatch(/Preparing audio|Listening|Waiting for audio/);
  sent.length = 0;
  const tree = read(() => LiveParticipation({ state, connected: true, run }));
  await buttons(tree)[0]!.props.onClick!();
  expect(sent).toEqual([{ type: "playLive", sourceId: "source", deviceId: here }]);
});

test("a device that has not joined never inherits another listener's error", () => {
  const state = fixture();
  state.controls = { ...audience, leave: false };
  state.outputs = [{ deviceId: "tv", picture: false, sound: true, error: "TV speakers disconnected." }];
  state.player = { ...state.player, status: "error", error: "TV speakers disconnected." };
  const html = renderToStaticMarkup(<PlaybackTransport state={state} connected run={run} />);
  expect(html).toContain(">Join</button>");
  expect(html).not.toContain("TV speakers disconnected.");
});

test("the publisher does not offer to join or adjust reception of its own capture", () => {
  state = fixture();
  state.liveSources![0]!.deviceId = here;
  state.controls = { ...audience, leave: false };
  expect(read(() => useLiveSourceHits(""))[0]!.primary).toMatchObject({ label: "Sharing", disabled: true });
  expect(read(() => LiveParticipation({ state, connected: true, run }))).toBeNull();
  expect(read(() => VolumeButton({ state, connected: true, run }))).toBeNull();
});

test("own-volume keys stay available when the viewed Live output is unavailable", () => {
  state = fixture();
  state.player = { ...state.player, status: "unavailable" };
  read(() => KeyboardShortcuts({ open: false, onOpenChange() {} }));
  expect(hotkeys.find(item => item.hotkey === "M")!.enabled).toBe(true);
  expect(hotkeys.find(item => item.hotkey === "ArrowUp")!.enabled).toBe(true);
});


for (const priority of ["native", "group", "receiver"] as const) test(`Core-projected ${priority} failure remains visible`, () => {
  const state = fixture();
  const nativeError = "System audio output unavailable. Choose an audio output.";
  const groupError = "Captured audio exceeded its bounded queue.";
  const receiverError = "Audio output failed. Check this device's audio output.";
  // Match the actual corrected Hub projection: native > source/group > receiver.
  const expected = priority === "native" ? nativeError : priority === "group" ? groupError : receiverError;
  state.player = { ...state.player, status: priority === "receiver" ? "playing" : "error", error: priority === "receiver" ? null : groupError };
  state.outputs![0] = { ...state.outputs![0]!, error: expected };
  const html = renderToStaticMarkup(<PlaybackTransport state={state} connected run={run} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain(renderToStaticMarkup(<p>{expected}</p>).slice(3, -4));
  for (const hidden of [nativeError, groupError, receiverError].filter(error => error !== expected)) expect(html).not.toContain(hidden);
  expect(html).toContain(">Leave</button>");
  expect(html).not.toMatch(/Preparing audio|Listening|Waiting for audio|leave and join again/);
  expect(html).not.toMatch(/aria-label="(?:Pause|Stop|Next)"/);
});
