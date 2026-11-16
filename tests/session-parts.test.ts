import { expect, test } from "bun:test";
import { createSessionParts } from "../src/shared/session-parts";
import type { ServerMessage } from "../src/shared/protocol";

test("a part after a clock message carries the clock's anchor, not the older one", () => {
  const parts = createSessionParts();
  const playback = {
    queue: [],
    currentEntryId: null,
    queueCursorEntryId: null,
    player: { playbackId: "p", status: "playing", position: 10, duration: 100 },
    positionAt: 1_000,
  } as unknown as Extract<ServerMessage, { type: "playback" }>["playback"];
  parts({ type: "couch", couch: {} as Extract<ServerMessage, { type: "couch" }>["couch"] });
  parts({ type: "playback", playback });
  parts({ type: "outputs", outputs: [] });
  expect(
    parts({ type: "clock", playbackId: "p", position: 40, duration: 100, at: 5_000, rate: 1 }),
  ).toBeNull();
  const whole = parts({ type: "outputs", outputs: [] })!;
  expect([whole.player.position, whole.positionAt]).toEqual([40, 5_000]);
});
