import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { isValidElement, type ReactNode } from "react";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { Mixer } from "../src/client/sections/shell/Outputs";
import { PlaybackVolume } from "../src/client/components/PlaybackTransport";
import { deviceId } from "../src/client/session/device-id";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

// Output authority needs no external catalog discovery.
const fetchLocal = globalThis.fetch;
globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;

const hostId = "h".repeat(43), otherId = "o".repeat(43), hostToken = "h".repeat(64);

// Inspect the production component's actual control props and handlers, without copying its guards.
type ControlProps = { label?: string; "aria-label"?: string; children?: ReactNode; disabled?: boolean; onCommit?: (value: number) => Promise<boolean>; onClick?: () => void; onCheckedChange?: (value: boolean) => void; onPressedChange?: (value: boolean) => void; pressed?: boolean; onSelect?: () => void };
function control(node: ReactNode, label: string): ControlProps | undefined {
  if (Array.isArray(node)) return node.map(child => control(child, label)).find(Boolean);
  if (!isValidElement<ControlProps>(node)) return;
  // Controls, not the groups that name them.
  if ((node.props.label === label || node.props["aria-label"] === label) && typeof node.type !== "string") return node.props;
  // The band's Volume renders inside the Sheet as its own component, without hooks.
  if (node.type === PlaybackVolume) return control(PlaybackVolume(node.props as Parameters<typeof PlaybackVolume>[0]), label);
  return control(node.props.children, label);
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected output state was not published.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture() {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "output-controls-")), databasePath = join(directory, "couch.sqlite");
  const actorId = deviceId(), store = openStore(databasePath, true);
  const actorToken = store.pair(actorId, "Actor"), otherToken = store.pair(otherId, "Other");
  store.close();
  // Hold local source resolution open so teardown can cancel it, rather than racing failed decodes.
  const source = createServer(() => {});
  await new Promise<void>(resolve => source.listen(Number(process.env.COUCH_TEST_SOURCE_PORT ?? 0), "127.0.0.1", resolve));
  const address = source.address(); assert.ok(address && typeof address === "object");
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: Number(process.env.COUCH_PORT ?? 0) });
  const sockets: WebSocket[] = [];
  async function connect(token: string, id: string) {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    let state: SessionState | undefined, sequence = 0;
    const pending = new Map<string, (result: Extract<ServerMessage, { type: "result" }>) => void>();
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>((resolve, reject) => {
      const requestId = String(++sequence), timer = setTimeout(() => reject(new Error("No command result")), 3000);
      pending.set(requestId, result => { clearTimeout(timer); resolve(result); });
      socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  }
  const host = await connect(hostToken, hostId), actor = await connect(actorToken, actorId), other = await connect(otherToken, otherId);
  const play = async (peer: typeof actor, id: string, title: string) => {
    const result = await peer.command({ type: "enqueue", entry: { id: title.replaceAll(" ", "-"), title, source: `http://127.0.0.1:${address.port}/media` }, playNow: true, deviceId: id });
    assert.equal(result.ok, true, result.error ?? "");
  };
  return { actorId, host, actor, other, play, close: async () => {
    for (const socket of sockets) socket.terminate();
    await hub.close(); source.closeAllConnections();
    await new Promise<void>(resolve => source.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  } };
}

test("output controls agree with Core for own moves and foreign private replacements", async () => {
  const f = await fixture();
  try {
    const render = () => Mixer({ state: f.actor.state, connected: true, run: async () => true });
    // A row's Picture and Sound, its fader and Move here are each labelled by its device's name.
    async function check(label: string, action: Action, expected: boolean) {
      let result: Promise<boolean> | undefined;
      const tree = Mixer({ state: f.actor.state, connected: true, run: command => {
        assert.deepEqual(command, action);
        return result = f.actor.command(command).then(response => { assert.equal(response.ok, expected, response.error ?? ""); return response.ok; });
      } });
      const props = control(tree, label); assert.ok(props, label);
      // Drive its actual handler even when disabled, then compare the affordance with Core's verdict. A disabled
      // row offers no action of its own, so Core is asked for the one it would have sent.
      if (action.type === "output" && action.level !== undefined && props.onCommit) void props.onCommit(action.level);
      else if (props.onPressedChange && !props.disabled) props.onPressedChange(!props.pressed);
      else if (props.onClick && !props.disabled) props.onClick();
      else if (props.onClick || props.onPressedChange) result = f.actor.command(action).then(response => response.ok);
      else if (props.onCheckedChange) props.onCheckedChange(true);
      else { assert.ok(props.onSelect); props.onSelect(); }
      assert.ok(result, `${label} did not send its existing command`);
      assert.equal(await result, expected, `${label}: Core outcome`);
      assert.equal(!props.disabled, expected, `${label}: renderer affordance`);
    }
    const level = (id: string) => f.actor.state.devices?.find(device => device.id === id)?.volume || 50;
    await f.actor.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.play(f.actor, f.actorId, "Own private picture");
    await f.play(f.actor, hostId, "Viewed");
    assert.ok(f.actor.state.outputs?.every(output => output.deviceId !== f.actorId));
    assert.ok(f.actor.state.playbacks?.some(playback => playback.id !== f.actor.state.playback && playback.outputs.some(output => output.deviceId === f.actorId && output.picture && output.local)));
    // Its own row's Picture joins the viewed playback, leaving its private one, and its Sound follows.
    await check("Actor picture", { type: "output", deviceId: f.actorId, picture: true }, true);
    await check("Actor sound", { type: "output", deviceId: f.actorId, level: level(f.actorId) }, true);
    assert.deepEqual(f.actor.state.outputs?.find(output => output.deviceId === f.actorId), { deviceId: f.actorId, picture: true, sound: true, local: true });

    await f.play(f.actor, f.actorId, "Own Solo picture");
    await f.play(f.actor, hostId, "Viewed Solo");
    // Solo moves the whole destination and requires the current item to have started.
    f.host.socket.send(JSON.stringify({ type: "player", state: { ...f.host.state.player, status: "playing", duration: 100, seekable: true, speed: 1, buffering: false } }));
    await until(() => f.actor.state.player.status === "playing");
    await check("Actor picture", { type: "output", deviceId: f.actorId, picture: true }, true);
    await check("Actor sound", { type: "output", deviceId: f.actorId, level: level(f.actorId) }, true);
    // Its row plays now, so it offers no Move here; Core still moves the whole destination here.
    assert.equal(control(render(), "Move here: Actor"), undefined);
    const solo = await f.actor.command({ type: "solo", deviceId: f.actorId });
    assert.equal(solo.ok, true, solo.error ?? "");
    assert.deepEqual(f.actor.state.outputs, [{ deviceId: f.actorId, picture: true, sound: true, local: true }]);

    await f.actor.command({ type: "sharing", sharing: { audio: false, video: false } });
    // Private and the only output, its row still offers no Move here, and its own controls stay enabled.
    assert.equal(control(render(), "Move here: Actor"), undefined);
    for (const label of ["Actor picture", "Actor sound"]) {
      const props = control(render(), label); assert.ok(props, label); assert.equal(!!props.disabled, false, label);
    }
    // The only sound: the Volume is its level, so its row has no fader of its own.
    assert.equal(control(render(), "Actor volume"), undefined);
    await f.play(f.actor, hostId, "Foreign boundary");
    await f.other.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.play(f.other, otherId, "Foreign private picture");
    await until(() => f.actor.state.playbacks?.some(playback => playback.outputs.some(output => output.deviceId === otherId && output.picture)) === true);
    const foreignBefore = f.actor.state.playbacks?.find(playback => playback.outputs.some(output => output.deviceId === otherId));
    // Its row can't take Other from its private picture: Core refuses what each control would send, so each is disabled.
    await check("Other sound", { type: "output", deviceId: otherId, level: level(otherId) }, false);
    await check("Other picture", { type: "output", deviceId: otherId, picture: true }, false);
    await check("Move here: Other", { type: "solo", deviceId: otherId }, false);
    assert.deepEqual(f.actor.state.playbacks?.find(playback => playback.id === foreignBefore?.id), foreignBefore);
    // Out of this playback, Other offers no fader or menu.
    for (const label of ["Other volume", "Options for Other"]) assert.equal(control(render(), label), undefined, label);

    // Same-playback private picture allows shared sound changes, but Solo replaces the whole output.
    await f.play(f.other, hostId, "Joined boundary");
    await f.other.command({ type: "output", deviceId: otherId, level: 25 });
    await f.other.command({ type: "output", deviceId: otherId, picture: true });
    await until(() => f.actor.state.outputs?.some(output => output.deviceId === otherId && output.picture) === true);
    await check("Other volume", { type: "output", deviceId: otherId, level: 35 }, true);
    // Other plays here, so its row offers no Move here; Core refuses the move anyway.
    assert.equal(control(render(), "Move here: Other"), undefined);
    const replaced = await f.actor.command({ type: "solo", deviceId: otherId });
    assert.equal(replaced.ok, false);
    await f.other.command({ type: "sharing", sharing: { audio: false, video: false } });
    await until(() => f.actor.state.devices?.find(device => device.id === otherId)?.sharing?.audio === false);
    await check("Other volume", { type: "output", deviceId: otherId, level: 45 }, false);
    f.other.socket.terminate();
    await until(() => f.actor.state.devices?.find(device => device.id === otherId)?.online === false);
    for (const label of ["Other volume", "Other picture", "Other sound"]) assert.equal(control(render(), label)?.disabled, true, label);
    // Offline, it still holds its output here, so its row offers no Move here.
    assert.equal(control(render(), "Move here: Other"), undefined);
  } finally { await f.close(); }
});

test("Where it plays' one Volume is the band's, and moves the actor's private self-play", async () => {
  const f = await fixture();
  try {
    await f.play(f.actor, f.actorId, "Private");
    const before = f.actor.state;
    let accepted: Promise<boolean> | undefined;
    const tree = Mixer({ state: before, connected: true, run: action => accepted = f.actor.command(action).then(result => result.ok) });
    const volume = control(tree, "Volume"); assert.ok(volume?.onCommit); void volume.onCommit(50);
    assert.equal(await accepted, true);
    assert.equal(f.actor.state.player.volume, 50);
    assert.equal(f.actor.state.mixTrim, 100);
    assert.deepEqual(f.actor.state.outputs, before.outputs);
    assert.equal(f.actor.state.devices?.find(device => device.id === f.actorId)?.volume, 50);
    assert.equal(control(tree, "All trim"), undefined);
  } finally { await f.close(); }
});

test("the one Volume shows the sound it may move, so another device's louder private sound never holds it back", async () => {
  const f = await fixture();
  try {
    await f.play(f.actor, hostId, "Mix");
    await f.actor.command({ type: "output", deviceId: hostId, level: 40 });
    // Other adds its own sound, private to the actor, at 80.
    await f.other.command({ type: "output", deviceId: otherId, level: 80 });
    await until(() => f.actor.state.outputs?.some(output => output.deviceId === otherId && output.sound) === true);
    const level = (id: string) => f.actor.state.devices?.find(device => device.id === id)?.volume;
    assert.equal(f.actor.state.player.volume, 40);
    assert.equal(f.other.state.player.volume, 80);
    let accepted: Promise<boolean> | undefined;
    const volume = control(Mixer({ state: f.actor.state, connected: true, run: action => accepted = f.actor.command(action).then(result => result.ok) }), "Volume");
    assert.equal((volume as { value?: number }).value, 40);
    void volume!.onCommit!(50);
    assert.equal(await accepted, true);
    assert.deepEqual([f.actor.state.player.volume, level(hostId), level(otherId)], [50, 50, 80]);
    // With only private sound left, it shows the level that plays, which it can't change.
    await f.actor.command({ type: "output", deviceId: hostId, level: 0 });
    assert.equal(f.actor.state.player.volume, 80);
  } finally { await f.close(); }
});
