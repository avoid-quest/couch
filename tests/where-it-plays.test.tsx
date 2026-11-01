import { expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientSessionState } from "../src/client/session/session";
import type { SessionGateValue } from "../src/client/session/session-context";

// The real Sheet renders; the wrapper records the controlled props Radix receives, so Close can be pressed without a DOM.
const real = { ...(await import("../src/client/components/ui/sheet")) };
type SheetProps = ComponentProps<typeof real.Sheet>;
const sheets: SheetProps[] = [];
mock.module("../src/client/components/ui/sheet", () => ({
  ...real,
  Sheet: (props: SheetProps) => {
    sheets.push(props);
    return real.Sheet(props);
  },
}));
const { WhereItPlays } = await import("../src/client/sections/shell/Outputs");
const { SessionGateContext } = await import("../src/client/session/gate-context");
const { choosesHere } = await import("../src/client/session/where-it-plays");

const devices = [
  { id: "mac", name: "Mac", online: true, volume: 50, muted: false },
  {
    id: "tv",
    name: "TV",
    online: true,
    volume: 50,
    muted: false,
    sharing: { audio: true, video: true },
  },
];
const waiting = (choosing: number, sharing = devices) =>
  ({
    playback: "p",
    outputs: [],
    queue: [{ id: "e", title: "Mac · Screen", source: "live:s", liveSourceId: "s" }],
    currentEntryId: "e",
    devices: sharing,
    playbacks: [
      {
        id: "p",
        title: "Mac · Screen",
        status: "paused",
        outputs: [],
        liveSourceId: "s",
        choosing,
      },
    ],
    liveSources: [{ id: "s", deviceId: "mac", name: "Mac · Screen", audio: true, video: true }],
  }) as unknown as ClientSessionState;

test("a closed Where it plays stays closed when Now Playing replaces the mini player, and a new request opens it once", () => {
  // SessionGate's state: each mount reads the provider's current value, as after a re-render.
  let gate = {
    dismissedChooser: null as string | null,
    dismissChooser: (request: string) => {
      gate = { ...gate, dismissedChooser: request };
    },
  };
  // Each render is a fresh mount, as when the shell swaps the mini player for the player page.
  const mount = (state: ClientSessionState, className?: string) => {
    sheets.length = 0;
    renderToStaticMarkup(
      <SessionGateContext.Provider value={gate as unknown as SessionGateValue}>
        <WhereItPlays state={state} run={async () => true} className={className} />
      </SessionGateContext.Provider>,
    );
    expect(sheets.length).toBe(1);
    return sheets[0]!;
  };
  // Find → Play on the publisher: the mini player's Where it plays opens; Close dismisses it.
  const mini = mount(waiting(1));
  expect(mini.open).toBe(true);
  mini.onOpenChange!(false);
  // Open player: the same request does not reopen, nor does an unrelated broadcast.
  expect(mount(waiting(1), "size-11").open).toBe(false);
  expect(
    mount(
      waiting(
        1,
        devices.map((device) => ({ ...device, volume: 70 })),
      ),
      "size-11",
    ).open,
  ).toBe(false);
  expect(mount(waiting(1)).open).toBe(false);
  // Another Play on the publisher is a new request.
  const again = mount(waiting(2), "size-11");
  expect(again.open).toBe(true);
  again.onOpenChange!(false);
  expect(mount(waiting(2)).open).toBe(false);
});

test("only a successful Play whose destination is the playing source's publisher asks this window to choose", () => {
  const playing = {
    playback: "p",
    controlling: "tv",
    playbacks: [
      {
        id: "p",
        status: "playing",
        outputs: [{ deviceId: "tv", picture: true, sound: true }],
        liveSourceId: "s",
      },
    ],
    liveSources: waiting(0).liveSources,
  } as unknown as ClientSessionState;
  const before = { ...playing, controlling: "mac" } as ClientSessionState;
  const play = { type: "playLive", sourceId: "s" } as const;
  expect(choosesHere({ ...play, deviceId: "mac" }, playing, playing)).toBe(true);
  expect(choosesHere(play, before, playing)).toBe(true);
  expect(choosesHere(play, playing, playing)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "tv" }, before, playing)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac", playNow: false }, before, playing)).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac" }, before, waiting(4))).toBe(false);
  expect(
    choosesHere({ ...play, deviceId: "mac" }, before, {
      ...playing,
      playback: "q",
    } as ClientSessionState),
  ).toBe(false);
  expect(choosesHere({ ...play, deviceId: "mac" }, before, null)).toBe(false);
});

test("with shared requests off, a waiting source opens only in the window that pressed Play, including Up next", () => {
  const state = waiting(0);
  expect(
    choosesHere({ type: "playLive", sourceId: "s" }, { ...state, controlling: "mac" }, state),
  ).toBe(true);
  expect(choosesHere({ type: "play", entryId: "e" }, state, state)).toBe(true);
  expect(choosesHere({ type: "play", entryId: "different" }, state, state)).toBe(false);
  const mount = (requestedChooser: string | null, dismissedChooser: string | null = null) => {
    sheets.length = 0;
    const gate = {
      requestedChooser,
      dismissedChooser,
      dismissChooser: () => {},
    } as unknown as SessionGateValue;
    renderToStaticMarkup(
      <SessionGateContext.Provider value={gate}>
        <WhereItPlays state={state} run={async () => true} />
      </SessionGateContext.Provider>,
    );
    return sheets[0]!.open;
  };
  expect(mount(null)).toBe(false);
  expect(mount("p:here:1")).toBe(true);
  expect(mount("p:here:1", "p:here:1")).toBe(false);
  expect(mount("p:here:2", "p:here:1")).toBe(true);
});
