import { expect, test } from "bun:test";
import { createSession } from "./session";
import { openStore } from "./store";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";

const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };

test("resolved handoff leases survive the source resolution deadline", async () => {
  const store = openStore(":memory:");
  let handoffSignal: AbortSignal | undefined;
  let released = false;
  const session = createSession(store, () => {}, () => {}, {
    nativeTarget: () => false,
    resolveSource: (entry, _playbackId, signal, _fromStart, _goLive, preparing) => {
      if (preparing) {
        handoffSignal = signal;
        signal.addEventListener("abort", () => { released = true; }, { once: true });
      }
      return { source: entry.source };
    },
  });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://example.org/one" }, playNow: true });
    const playing = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const };
    session.observe(playing);
    const { command, delivery } = await session.prepareHandoff(true);
    // Several individually valid readiness/checkpoint waits can outlast resolution's deadline.
    await Bun.sleep(15_050);
    expect(handoffSignal).toBeDefined();
    expect(handoffSignal!.aborted).toBe(false);
    expect(released).toBe(false);
    session.commitHandoff({ ...playing, playbackId: command.playbackId, status: "paused" }, delivery);
    expect(session.state.player.playbackId).toBe(command.playbackId);
  } finally { session.close(); store.close(); }
}, 20_000);

test("a disconnected handoff can recover an expired destination stream", async () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  let resolved = 0;
  let recovered = 0;
  const session = createSession(store, command => commands.push(command), () => {}, {
    nativeTarget: () => false,
    resolveSource: () => {
      const id = ++resolved;
      return { source: `https://example.org/${id}`, expiry: { at: 0, recover: async () => { recovered = id; return { source: `https://example.org/recovered-${id}` }; } } };
    },
  });
  try {
    session.observe(idle);
    session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "https://example.org/one" }, playNow: true });
    await Bun.sleep(0);
    const playing = { ...idle, playbackId: session.state.player.playbackId, status: "playing" as const, position: 18, duration: 60, seekable: true };
    session.observe(playing);
    session.rendererDisconnected();
    const { command, delivery } = await session.prepareHandoff(true);
    session.commitHandoff({ ...playing, playbackId: command.playbackId, status: "paused" }, delivery);
    session.observe({ ...playing, playbackId: command.playbackId, status: "error", error: "Expired" });
    await Bun.sleep(0);
    expect(recovered).toBe(2);
    expect(commands.at(-1)).toMatchObject({ type: "load", source: "https://example.org/recovered-2", startPosition: 18, paused: true });
  } finally { session.close(); store.close(); }
});
