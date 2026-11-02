import { test } from "node:test";
import assert from "node:assert/strict";
import { readPlayerSearch, remotePlayerSession } from "../src/client/session/player-control";
import type { SessionGateValue } from "../src/client/session/session-context";
import type { Action } from "../src/shared/protocol";

const tvB = "b".repeat(43),
  tvA = "a".repeat(43);
function fixture() {
  const calls: { action: Action | number; target?: string }[] = [];
  const session = {
    connected: true,
    state: {
      controlling: tvB,
      playback: "sequence",
      outputs: [{ deviceId: tvB }],
      queue: [{ id: "waiting" }],
      devices: [
        { id: tvB, name: "TV B", tv: true, online: true, sharing: { audio: true, video: true } },
      ],
    },
    run: async (action: Action, target?: string) => {
      calls.push({ action, target });
      return true;
    },
    command: async (action: Action, target?: string) => {
      calls.push({ action, target });
    },
    seekBy: async (seconds: number, target?: string) => {
      calls.push({ action: seconds, target });
      return true;
    },
  } as unknown as SessionGateValue;
  return { session, calls };
}

test("a captured queue handler and shortcut keep the route's TV after another selection is rendered", async () => {
  const { session, calls } = fixture();
  const route = readPlayerSearch({ queue: "true", targetDeviceId: tvB });
  assert.deepEqual(route, { queue: true, targetDeviceId: tvB });
  const selected = remotePlayerSession(session, route.targetDeviceId!);
  const remove = () => selected.run({ type: "remove", entryId: "waiting" });
  const seek = () => selected.seekBy(10);
  const changed = {
    ...session,
    state: { ...session.state!, controlling: tvA, outputs: [{ deviceId: tvA }] },
  };
  assert.equal(remotePlayerSession(changed, tvB).state, null);
  await remove();
  await seek();
  await selected.command({ type: "restoreRemoved", token: "undo-token" });
  assert.deepEqual(
    calls.map((call) => call.target),
    [tvB, tvB, tvB],
  );
  // The ordinary session remains unscoped when the route is left.
  await session.run({ type: "remove", entryId: "ordinary" });
  assert.equal(calls.at(-1)?.target, undefined);
});

test("stale/foreign player snapshots, offline, private and disconnected targets disable the whole scoped journey", async () => {
  const { session, calls } = fixture();
  const state = session.state!;
  for (const changed of [
    { ...session, state: { ...state, controlling: tvA } },
    { ...session, state: { ...state, outputs: [{ deviceId: tvA }] } },
    {
      ...session,
      state: { ...state, devices: state.devices!.map((device) => ({ ...device, online: false })) },
    },
    {
      ...session,
      state: {
        ...state,
        devices: state.devices!.map((device) => ({
          ...device,
          sharing: { audio: false, video: false },
        })),
      },
    },
    { ...session, connected: false },
  ]) {
    const scoped = remotePlayerSession(changed, tvB);
    assert.equal(scoped.connected, false);
    assert.equal(await scoped.run({ type: "stop" }), false);
    assert.equal(await scoped.seekBy(10), false);
    await assert.rejects(scoped.command({ type: "restoreRemoved", token: "undo-token" }));
  }
  assert.deepEqual(calls, []);
});
