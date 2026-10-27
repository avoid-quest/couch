import { expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientSessionState } from "../src/client/session/session";
import type { SessionGateValue } from "../src/client/session/session-context";

// The real Sheet renders; the wrapper records the controlled props Radix receives, so Close can be pressed without a DOM.
const real = { ...await import("../src/client/components/ui/sheet") };
type SheetProps = ComponentProps<typeof real.Sheet>;
const sheets: SheetProps[] = [];
mock.module("../src/client/components/ui/sheet", () => ({ ...real, Sheet: (props: SheetProps) => { sheets.push(props); return real.Sheet(props); } }));
const { Mixer, WhereItPlays } = await import("../src/client/sections/shell/Outputs");
const { SessionGateContext } = await import("../src/client/session/gate-context");

const devices = [{ id: "mac", name: "Mac", online: true, volume: 50, muted: false }, { id: "tv", name: "TV", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }];
const waiting = (choosing: number, sharing = devices) => ({
  playback: "p", outputs: [], queue: [{ id: "e", title: "Mac · Screen", source: "live:s", liveSourceId: "s" }], currentEntryId: "e", devices: sharing,
  playbacks: [{ id: "p", title: "Mac · Screen", status: "paused", outputs: [], liveSourceId: "s", choosing }],
  liveSources: [{ id: "s", deviceId: "mac", name: "Mac · Screen", audio: true, video: true }],
}) as unknown as ClientSessionState;

test("a closed Where it plays stays closed when Now Playing replaces the mini player, and a new request opens it once", () => {
  // SessionGate's state: each mount reads the provider's current value, as after a re-render.
  let gate = { dismissedChooser: null as string | null, dismissChooser: (request: string) => { gate = { ...gate, dismissedChooser: request }; } };
  // Each render is a fresh mount, as when the shell swaps the mini player for the player page.
  const mount = (state: ClientSessionState, className?: string) => {
    sheets.length = 0;
    const html = renderToStaticMarkup(<SessionGateContext.Provider value={gate as unknown as SessionGateValue}><WhereItPlays state={state} run={async () => true} className={className} /></SessionGateContext.Provider>);
    expect(sheets.length).toBe(1);
    expect(html).toContain(`aria-expanded="${!!sheets[0]!.open}"`);
    return sheets[0]!;
  };
  // Find → Play on the publisher: the mini player's Where it plays opens; Close dismisses it.
  const mini = mount(waiting(1));
  expect(mini.open).toBe(true);
  mini.onOpenChange!(false);
  // Open player: the same request does not reopen, nor does an unrelated broadcast.
  expect(mount(waiting(1), "size-11").open).toBe(false);
  expect(mount(waiting(1, devices.map(device => ({ ...device, volume: 70 }))), "size-11").open).toBe(false);
  expect(mount(waiting(1)).open).toBe(false);
  // Another Play on the publisher is a new request.
  const again = mount(waiting(2), "size-11");
  expect(again.open).toBe(true);
  again.onOpenChange!(false);
  expect(mount(waiting(2)).open).toBe(false);
});

test("Play on a playing source's publisher opens only this window's Where it plays, once per request, and keeps the playback", () => {
  // This window's own request (SessionGate's requestedChooser); closing it answers the request.
  let gate = { dismissedChooser: null as string | null, requestedChooser: null as string | null, dismissChooser: (request: string) => { gate = { ...gate, dismissedChooser: request, requestedChooser: null }; } };
  const playing = { ...waiting(0), outputs: [{ deviceId: "tv", picture: true, sound: true }], playbacks: [{ id: "p", title: "Mac · Screen", status: "playing", outputs: [{ deviceId: "tv", picture: true, sound: true }], liveSourceId: "s", held: { deviceId: "mac", picture: true, sound: true, local: true } }] } as unknown as ClientSessionState;
  const run = mock(async () => true);
  const mount = (state: ClientSessionState) => {
    sheets.length = 0;
    renderToStaticMarkup(<SessionGateContext.Provider value={gate as unknown as SessionGateValue}><WhereItPlays state={state} run={run} /></SessionGateContext.Provider>);
    return sheets[0]!;
  };
  // Another window, and this one before asking, stay closed: Core broadcasts no request.
  expect(mount(playing).open).toBe(false);
  gate = { ...gate, requestedChooser: "p:here:1" };
  // A request for a playback this window no longer views does not open it.
  expect(mount({ ...playing, playback: "other" } as ClientSessionState).open).toBe(false);
  const mini = mount(playing);
  expect(mini.open).toBe(true);
  // Now Playing replaces the mini player while it is open: it stays open there.
  expect(mount(playing).open).toBe(true);
  mount(playing).onOpenChange!(false);
  expect(gate.requestedChooser).toBe(null);
  expect(mount(playing).open).toBe(false);
  // A repeated Play is a new request; nothing it opens sends a command.
  gate = { ...gate, requestedChooser: "p:here:2" };
  expect(mount(playing).open).toBe(true);
  expect(run).not.toHaveBeenCalled();
  // While Core asks every window (the source waits again), its request decides, and closing it answers both.
  const asked = mount(waiting(3));
  expect(asked.open).toBe(true);
  asked.onOpenChange!(false);
  expect(gate).toMatchObject({ dismissedChooser: "p:3", requestedChooser: null });
  expect(mount(playing).open).toBe(false);
});

test("only a successful Play whose destination is the playing source's publisher asks this window to choose", async () => {
  const { choosesHere } = await import("../src/client/session/where-it-plays");
  const playing = { playback: "p", controlling: "tv", playbacks: [{ id: "p", status: "playing", outputs: [{ deviceId: "tv", picture: true, sound: true }], liveSourceId: "s" }], liveSources: waiting(0).liveSources } as unknown as ClientSessionState;
  const before = { ...playing, controlling: "mac" } as ClientSessionState;
  const play = { type: "playLive", sourceId: "s" } as const;
  expect(choosesHere({ ...play, deviceId: "mac" }, playing, playing)).toBe(true);
  expect(choosesHere(play, before, playing)).toBe(true);
  expect(choosesHere(play, playing, playing)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "tv" }, before, playing)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac", playNow: false }, before, playing)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac" }, before, waiting(4))).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac" }, before, { ...playing, playback: "q" } as ClientSessionState)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac" }, before, null)).toBe(false);
});

test("with shared requests off, a waiting source opens only in the window that pressed Play, including Up next", async () => {
  const { choosesHere } = await import("../src/client/session/where-it-plays");
  const state = waiting(0);
  expect(choosesHere({ type: "playLive", sourceId: "s" }, { ...state, controlling: "mac" }, state)).toBe(true);
  expect(choosesHere({ type: "play", entryId: "e" }, state, state)).toBe(true);
  expect(choosesHere({ type: "play", entryId: "different" }, state, state)).toBe(false);
  const mount = (requestedChooser: string | null, dismissedChooser: string | null = null) => {
    sheets.length = 0;
    const gate = { requestedChooser, dismissedChooser, dismissChooser: () => {} } as unknown as SessionGateValue;
    renderToStaticMarkup(<SessionGateContext.Provider value={gate}><WhereItPlays state={state} run={async () => true} /></SessionGateContext.Provider>);
    return sheets[0]!.open;
  };
  expect(mount(null)).toBe(false);
  expect(mount("p:here:1")).toBe(true);
  expect(mount("p:here:1", "p:here:1")).toBe(false);
  expect(mount("p:here:2", "p:here:1")).toBe(true);
});

type Props = { children?: ReactNode; id?: string; label?: string; value?: string; "aria-label"?: string; pressed?: boolean; disabled?: boolean; onClick?: () => void; onSelect?: () => void; onKeyDown?: (event: { key: string; preventDefault: () => void }) => void; onPressedChange?: (pressed: boolean) => void; onCommit?: (value: number) => Promise<boolean> };
const elements = (node: ReactNode): { type: unknown; props: Props }[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement<Props>(node) ? [node, ...elements(node.props.children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join(" ") : isValidElement<Props>(node) ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
const inSync = { deviceId: "tv", picture: true, sound: true, delay: 80, delayActive: true };

test("the mixer shows the Volume, the counts, then the playback's devices with Picture, Sound, a fader and …, then the rest with Move here", async () => {
  const { PlaybackVolume } = await import("../src/client/components/PlaybackTransport");
  const sent: unknown[] = [];
  const phone = { id: "phone", name: "Phone", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } };
  const away = { id: "away", name: "Away", online: false, volume: 50, muted: false };
  const radio = { id: "r", title: "avoid radio", status: "playing", outputs: [{ deviceId: "phone", picture: false, sound: true }] };
  const state = { ...waiting(0), devices: [...devices, phone, away], outputs: [inSync], playbacks: [{ id: "p", title: "Mac · Screen", status: "playing", outputs: [inSync] }, radio], liveSources: [] } as unknown as ClientSessionState;
  const tree = Mixer({ state, connected: true, run: async action => { sent.push(action); return true; } });
  const all = elements(tree), labelled = (label: string) => all.filter(item => item.props.label === label || item.props["aria-label"] === label);
  // The Volume always leads, with one device or many; there is no header repeating what plays.
  expect(all.filter(item => item.type === PlaybackVolume).length).toBe(1);
  expect(text(tree)).not.toContain("Mac · Screen");
  expect(text(tree)).toContain("Picture 1, Sound 1, In sync 1, Offline 1");
  // The playback's devices, then the rest after a hairline with no heading, offline ones folded into one line.
  const lists = all.filter(item => item.type === "ul");
  expect(lists.map(item => [item.props["aria-label"], elements(item.props.children).filter(child => child.type === "li").map(child => (child.props as { "data-device"?: string })["data-device"])])).toEqual([["Playing", ["tv"]], ["Not playing", ["mac", "phone"]]]);
  expect(all.filter(item => /^h\d$/.test(String(item.type)))).toEqual([]);
  expect(text(tree)).toMatch(/Offline:\s+Away/);
  expect(text(tree)).toContain("Playing avoid radio");
  expect(text(tree)).not.toMatch(/\b(Not playing|Other devices|zone|group|room|House|Listeners)\b/);
  // Sync belongs to the row that plays in sync: its "…" offers Sync…, and its line shows while it isn't 0.
  const syncs = all.filter(item => /sync$/.test(item.props.label ?? ""));
  expect(syncs.map(item => item.props.label)).toEqual(["TV sync"]);
  const line = (delay: number) => renderToStaticMarkup(createElement(syncs[0]!.type as FunctionComponent, { ...syncs[0]!.props, delay }));
  expect(line(80)).toContain("Sync 80 ms earlier");
  expect(line(0)).toBe("");
  for (const label of ["TV picture", "TV sound", "Options for TV", "Phone picture", "Phone sound", "Move here: Phone"]) expect(labelled(label).length).toBe(1);
  // The only output can't move anywhere new, and the Volume is its level, so it has no fader of its own; a device out of
  // the playback has no fader or "…". The Volume mutes, not a row.
  for (const label of ["Move here: TV", "TV volume", "Phone volume", "Options for Phone", "Mute TV", "Mute Phone"]) expect(labelled(label)).toEqual([]);
  // A toggle sends the model's own action: the TV's Picture goes, the Phone's Sound joins; Mac shares nothing.
  labelled("TV picture")[0]!.props.onPressedChange!(false);
  labelled("Phone sound")[0]!.props.onPressedChange!(true);
  labelled("Move here: Phone")[0]!.props.onClick!();
  expect(sent).toEqual([{ type: "output", deviceId: "tv", picture: false }, { type: "output", deviceId: "phone", level: 50 }, { type: "solo", deviceId: "phone" }]);
  expect(labelled("Mac picture")[0]!.props.disabled).toBe(true);
  expect(labelled("Mac sound")[0]!.props.disabled).toBe(true);
});

test("a row shows \"…\" only with options in it, and a device muted elsewhere says Muted and unmutes as its fader moves", async () => {
  const sent: unknown[] = [];
  // A second sounding device, so the TV keeps its own fader.
  const phone = { id: "phone", name: "Phone", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } };
  const state = { ...waiting(0), devices: [...devices.map(item => item.id === "tv" ? { ...item, muted: true } : item), phone], outputs: [{ deviceId: "tv", picture: true, sound: true }, { deviceId: "phone", picture: false, sound: true }], player: { status: "playing", volume: 50 } } as unknown as ClientSessionState;
  const tree = Mixer({ state, connected: true, run: async action => { sent.push(action); return true; } });
  const all = elements(tree), labelled = (label: string) => all.filter(item => item.props.label === label || item.props["aria-label"] === label);
  // Playing, out of sync: no Move here and no Sync…, so nothing for "…" to hold.
  expect(labelled("Options for TV")).toEqual([]);
  expect(text(tree)).toContain("Muted");
  expect(await labelled("TV volume")[0]!.props.onCommit!(30)).toBe(true);
  expect(sent).toEqual([{ type: "output", deviceId: "tv", level: 30 }, { type: "mute", deviceId: "tv", muted: false }]);
});

test("a playing row's \"…\" never offers Move here: it holds only Sync…", () => {
  const phone = { id: "phone", name: "Phone", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } };
  const state = { ...waiting(0), devices: [...devices, phone], outputs: [{ deviceId: "tv", picture: true, sound: true }, { deviceId: "phone", picture: false, sound: true }], player: { status: "playing", volume: 50 } } as unknown as ClientSessionState;
  const all = elements(Mixer({ state, connected: true, run: async () => true }));
  const labelled = (label: string) => all.filter(item => item.props.label === label || item.props["aria-label"] === label);
  for (const label of ["Move here: TV", "Move here: Phone", "Options for TV", "Options for Phone"]) expect(labelled(label)).toEqual([]);
});

test("a source waiting for receivers asks where it plays instead of the Volume", async () => {
  const { PlaybackVolume } = await import("../src/client/components/PlaybackTransport");
  const all = elements(Mixer({ state: waiting(1), connected: true, run: async () => true }));
  expect(all.filter(item => item.type === PlaybackVolume)).toEqual([]);
  expect(text(all[0]!.props.children)).toContain("Choose where Mac · Screen plays");
  expect(all.filter(item => item.type === "ul").map(item => item.props["aria-label"])).toEqual(["Not playing"]);
});

test("the real mixer retains captured-video In sync but omits the no-op switch for PCM audio", () => {
  const outputs = [{ deviceId: "tv", picture: false, sound: true, delayActive: true }, { deviceId: "mac", picture: false, sound: true }];
  const source = { id: "s", deviceId: "publisher", name: "Audio input", kind: "microphone" as const, audio: true, video: false, audioDelivery: "pcm" as const };
  const state = { ...waiting(0), outputs, playbacks: [{ id: "p", title: "Audio input", status: "playing", delivery: "scheduled", inSync: true, audioOnly: true, liveSourceId: "s", outputs }], liveSources: [source], player: { playbackId: "load", status: "playing", volume: 50 } } as unknown as ClientSessionState;
  const html = renderToStaticMarkup(<>{Mixer({ state, connected: true, run: async () => true })}</>);
  expect(html).not.toContain('id="where-it-plays-in-sync"');
  expect(html).toContain("In sync 1");
  const captured = { ...state, liveSources: [{ ...source, kind: "screen", video: true, audioDelivery: undefined }] } as ClientSessionState;
  expect(renderToStaticMarkup(<>{Mixer({ state: captured, connected: true, run: async () => true })}</>)).toContain('id="where-it-plays-in-sync"');
});

test("a receiver's row says Behind, or Can't play with Core's reason in red", () => {
  for (const output of [{ deviceId: "tv", picture: true, sound: true, buffered: true }, { deviceId: "tv", picture: true, sound: true, buffered: true, error: "The live input encoder stopped." }]) {
    const state = { ...waiting(0), outputs: [output], player: { status: "playing", volume: 50 } } as unknown as ClientSessionState;
    const html = renderToStaticMarkup(<>{Mixer({ state, connected: true, run: async () => true })}</>);
    expect(html).toContain(output.error ? `Can&#x27;t play: ${output.error}` : ">Behind<");
    expect(html.includes("text-destructive")).toBe(!!output.error);
  }
});

test("past eight devices the counts filter the list and a search field finds a device", () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ id: `d${index}`, name: `Speaker ${index}`, online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }));
  const outputs = [{ deviceId: "d4", picture: false, sound: true }];
  const state = { ...waiting(0), devices: many, outputs, playbacks: [{ id: "p", status: "playing", outputs }], liveSources: [] } as unknown as ClientSessionState;
  const filtered: unknown[] = [];
  const all = elements(Mixer({ state, connected: true, run: async () => true, filter: "sound", onFilter: filter => filtered.push(filter) }));
  const group = all.find(item => item.props["aria-label"] === "Show")!;
  expect(elements(group.props.children).filter(item => item.props.value).map(item => text(item.props.children).replace(/\s+/g, " "))).toEqual(["Sound 1"]);
  expect(all.some(item => item.props.label === "Find a device")).toBe(true);
  expect(all.filter(item => item.type === "li").length).toBe(1);
  expect(elements(Mixer({ state, connected: true, run: async () => true, query: "speaker 1" })).filter(item => item.type === "li").length).toBe(1);
});

test("a filter or search whose control has gone no longer filters the list", () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ id: `d${index}`, name: `Speaker ${index}`, online: index < 8, volume: 50, muted: false, sharing: { audio: true, video: true } }));
  const outputs = [{ deviceId: "d4", picture: false, sound: true }];
  const state = { ...waiting(0), devices: many, outputs, playbacks: [{ id: "p", status: "playing", outputs }], liveSources: [] } as unknown as ClientSessionState;
  const rows = (props: { filter?: "sound" | "behind"; query?: string }) => elements(Mixer({ state, connected: true, run: async () => true, ...props })).filter(item => item.type === "li").length;
  expect(rows({ filter: "sound" })).toBe(8);
  expect(rows({ query: "speaker 1" })).toBe(8);
  const crowded = { ...state, devices: many.map(device => ({ ...device, online: true })) } as ClientSessionState;
  expect(elements(Mixer({ state: crowded, connected: true, run: async () => true, filter: "behind" })).filter(item => item.type === "li").length).toBe(10);
});


test("TV output OK menu exposes exclusive Move here, including a device already in the playback", async () => {
  const sent: unknown[] = [];
  const phone = { id: "phone", name: "Phone", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } };
  const outputs = [{ deviceId: "tv", picture: true, sound: true }, { deviceId: "phone", picture: false, sound: true }];
  const state = { ...waiting(0), devices: [...devices, phone], outputs, playbacks: [{ id: "p", title: "Film", status: "playing", outputs }], liveSources: [], player: { status: "playing", volume: 50 } } as unknown as ClientSessionState;
  const all = elements(Mixer({ state, connected: true, run: async action => { sent.push(action); return true; }, tv: true }));
  const tv = all.find(item => item.props["aria-label"] === "TV")!;
  expect(tv.props.onKeyDown).toBeFunction();
  tv.props.onKeyDown!({ key: "ArrowRight", preventDefault() {} });
  const move = all.find(item => item.props["aria-label"] === "Move here: TV")!;
  expect(move.props.disabled).toBe(false);
  move.props.onSelect!();
  expect(sent).toEqual([{ type: "output", deviceId: "tv", level: 55 }, { type: "solo", deviceId: "tv" }]);
  const privateState = { ...state, devices: [...devices, { ...phone, sharing: { audio: false, video: false } }] };
  const denied = elements(Mixer({ state: privateState, connected: true, run: async () => true, tv: true }));
  expect(denied.find(item => item.props["aria-label"] === "Move here: TV")!.props.disabled).toBe(true);
  const alone = { ...state, outputs: [outputs[0]!], playbacks: [{ ...state.playbacks![0]!, outputs: [outputs[0]!] }] };
  expect(elements(Mixer({ state: alone, connected: true, run: async () => true, tv: true })).some(item => item.props["aria-label"] === "Move here: TV")).toBe(false);
});

async function liveListener(): Promise<ClientSessionState> {
  const { deviceId } = await import("../src/client/session/device-id");
  const here = deviceId(), outputs = [{ deviceId: here, picture: false, sound: true }];
  return { ...waiting(0), outputs,
    devices: [...devices, { id: here, name: "This phone", online: true, volume: 27, muted: false }],
    controls: { programme: false, queue: false, seek: false, speed: false, audioDelay: false, subtitleDelay: false, leave: true },
    playbacks: [{ id: "p", title: "Concert", status: "playing", intent: "live", delivery: "scheduled", liveSourceId: "s", outputs }],
    liveSources: [{ id: "s", deviceId: "mac", name: "Concert", kind: "microphone", audio: true, video: false, intent: "live" }],
    player: { playbackId: "load", status: "playing", position: 0, duration: null, volume: 50, seekable: false, error: null },
  } as ClientSessionState;
}

test("Live participation retains Leave and own volume while awaiting source audio", async () => {
  const state = await liveListener();
  for (const status of ["loading", "playing"] as const) {
    state.player.status = status;
    const html = renderToStaticMarkup(<Mixer state={state} connected run={async () => true} />);
    expect(html).toContain('role="status"');
    expect(html).toContain(status === "playing" ? "Listening" : "Waiting for audio…");
    expect(html).toContain(">Leave</button>");
    expect(html).toContain('aria-label="Your volume"');
    expect(html).not.toMatch(/role="alert"|text-destructive|leave and join again/);
    expect(html).not.toMatch(/aria-label="(?:Pause|Stop|Next)"|where-it-plays-in-sync/);
  }
});

test("Live participation preserves source errors", async () => {
  const state = await liveListener();
  state.outputs![0]!.error = "The live input stopped sending media.";
  const html = renderToStaticMarkup(<Mixer state={state} connected run={async () => true} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("The live input stopped sending media.");
  expect(html).not.toContain("Preparing audio");
});
