import assert from "node:assert/strict";
import { test } from "node:test";
import { liveFixture, until } from "./live-input.fixture";

test("unpairing a renamed publisher announces its current name before stopping the receiver", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load());
    const token = new URL(f.publisher.socket.url).searchParams.get("token")!;
    const rename = await fetch(`${f.hub.origin}/api/devices/${f.publisher.id}/name`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Renamed publisher" }) });
    assert.equal(rename.status, 200);
    const before = f.receiver.messages.length;
    const removal = await fetch(`${f.hub.origin}/api/devices/${f.publisher.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } });
    assert.equal(removal.status, 200);
    await until(() => !f.receiver.state.liveSources?.length);
    const messages = f.receiver.messages.slice(before);
    const notice = messages.findIndex(message => message.type === "state" && message.state.activity?.text === "Renamed publisher stopped sharing");
    assert.ok(notice >= 0, "removal must retain the publisher's current name");
    const message = messages[notice]!;
    assert.ok(message.type === "state");
    assert.deepEqual(message.state.activity?.actor, { deviceId: f.publisher.id, name: "Renamed publisher" });
    const stop = messages.findIndex(message => message.type === "player" && message.command.type === "stop");
    assert.ok(stop > notice, "the notice arrives before Stop closes the receiver");
  } finally { await f.close(); }
});
