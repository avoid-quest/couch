import { expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientSessionState } from "../src/client/session/session";
import type { SessionGateValue } from "../src/client/session/session-context";

// The real Sheet renders; the wrapper records the controlled props Radix receives, so Close can be pressed without a DOM.
const real = { ...await import("../src/client/components/ui/sheet") };
type SheetProps = ComponentProps<typeof real.Sheet>;
const sheets: SheetProps[] = [];
mock.module("../src/client/components/ui/sheet", () => ({ ...real, Sheet: (props: SheetProps) => { sheets.push(props); return real.Sheet(props); } }));
const { WhereItPlays } = await import("../src/client/sections/shell/Outputs");
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
