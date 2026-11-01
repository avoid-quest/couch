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
const run = async (action: Action) => { sent.push(action); return true; };
mock.module("../src/client/session/session-context", () => ({ useSessionGate: () => ({ state, connected: true, run, seekBy: (seconds: number) => { throw new Error(`unexpected seek ${seconds}`); }, credentials: { origin: "http://couch", token: "test" } }), useOptionalSessionGate: () => ({ state, connected: true, run }) }));
const query = await import("@tanstack/react-query");
mock.module("@tanstack/react-query", () => ({ ...query, queryOptions: (options: unknown) => options, useQuery: () => ({ data: {} }), useMutation: () => ({ isPending: false }) }));
mock.module("../src/client/radio-clock", () => ({ useRadioClock: () => 0 }));
mock.module("../src/client/sections/shell/shell-context", () => ({ useShell: () => ({ section: "Now", changeSection() {}, openPlayer() {}, focusSearch() {} }) }));
const { PlaybackVolume, LiveParticipation } = await import("../src/client/components/PlaybackTransport");
const { useMediaSession } = await import("../src/client/session/media-session");
const { useLiveSourceHits } = await import("../src/client/sections/find/useLiveSourceHits");

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

test("Join always targets this listener even while its browser controls a TV", async () => {
  state = { ...fixture(), player: { ...fixture().player, playbackId: null }, controls: { ...audience, leave: false }, outputs: [] }; sent.length = 0;
  const tree = read(() => LiveParticipation({ state, connected: true, run }));
  expect(buttons(tree)[0]!.props.disabled).toBe(false);
  await buttons(tree)[0]!.props.onClick!();
  expect(sent).toEqual([{ type: "playLive", sourceId: "source", deviceId: here }]);
  let hits: ReturnType<typeof useLiveSourceHits> = [];
  read(() => { hits = useLiveSourceHits(""); });
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

test("Live owns Media Session without a queued item, its controls do nothing, and ordinary playback is restored", () => {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const mediaSession = { metadata: null as MediaMetadata | null, playbackState: "none", position: undefined as MediaPositionState | undefined,
    setActionHandler: (action: string, callback: MediaSessionActionHandler | null) => handlers.set(action, callback),
    setPositionState(position?: MediaPositionState) { this.position = position; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaSession } });
  Object.assign(globalThis, { MediaMetadata: class { constructor(metadata: MediaMetadataInit) { Object.assign(this, metadata); } } });
  const session = (next: ClientSessionState) => { state = next; read(useMediaSession); for (const effect of effects.splice(0)) effect(); };
  effects.length = 0; sent.length = 0;
  session({ ...fixture(), queue: [], currentEntryId: null });
  expect(mediaSession.metadata?.title).toBe("Concert");
  expect(mediaSession.playbackState).toBe("playing");
  for (const action of ["nexttrack", "seekto", "seekbackward", "seekforward"]) expect(handlers.get(action)).toBeNull();
  // Listeners get no media commands. Unhandled, Android's notification Pause would pause the SDK's silent
  // keep-alive element, so Play, Pause and Stop are handled and do nothing.
  for (const action of ["play", "pause", "stop"] as const) handlers.get(action)!({ action });
  expect(sent).toEqual([]);
  // Ordinary player updates cannot clear Live or supply stale programme metadata.
  session({ ...state, player: { ...state.player, status: "idle", nowPlaying: { title: "Old programme", artist: "Old artist" } } });
  expect(mediaSession.metadata).toMatchObject({ title: "Concert", artist: "" });
  expect(mediaSession.playbackState).toBe("playing");
  session({ ...fixture(), controls: undefined, playbacks: [], liveSources: [], player: { ...fixture().player, status: "paused" }, queue: [{ id: "entry", source: "web:https://example.com/movie", title: "Film", duration: 300 }, { id: "next", source: "web:https://example.com/next", title: "Next" }] });
  expect(mediaSession.metadata?.title).toBe("Film");
  expect(mediaSession.playbackState).toBe("paused");
  handlers.get("stop")!({ action: "stop" });
  expect(sent.at(-1)).toEqual({ type: "stop", playbackId: "load-generation" });
  // A remaining source and audience do not claim this device after it leaves.
  session({ ...fixture(), controls: { ...audience, leave: false }, outputs: [], queue: [], currentEntryId: null, player: { ...fixture().player, playbackId: null, status: "idle" } });
  expect(mediaSession.metadata).toBeNull();
  expect(mediaSession.playbackState).toBe("none");
  expect([...handlers.values()].every(value => value === null)).toBe(true);
});
