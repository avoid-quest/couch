import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { beginClientHandshake } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";

test("revocation closes an authorized audio connection during its Noise handshake", { timeout: 10_000 }, async t => {
  const f = await liveFixture(), identity = f.identities[1]!;
  const socket = new WebSocket(`${f.hub.origin.replace("http:", "ws:")}/api/audio/${identity.token}/sendspin`);
  socket.on("error", () => {});
  t.after(async () => { socket.terminate(); await f.close(); });
  await once(socket, "open");
  const handshake = beginClientHandshake({ identity: identity.key, suite: "25519_AESGCM_SHA256" });
  const frames: string[] = [];
  socket.on("message", (data, binary) => { if (!binary) frames.push(String(data)); });
  socket.send(handshake.clientInit);
  await until(() => frames.length === 2);
  handshake.onServerInit(frames[0]!);
  const next = await handshake.onMessage1(frames[1]!);
  const removal = await fetch(`${f.hub.origin}/api/devices/${identity.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } });
  assert.equal(removal.status, 200);
  const accepted: string[] = [];
  socket.on("message", (data, binary) => {
    if (binary) {
      const frame = next.result.transport.decode(Buffer.from(data as Buffer));
      if (frame?.kind === "text") accepted.push(JSON.parse(frame.data).type);
    }
  });
  if (socket.readyState === WebSocket.OPEN) socket.send(next.send);
  await until(() => socket.readyState === WebSocket.CLOSED || accepted.length > 0);
  assert.deepEqual(accepted, [], "a revoked connection must not finish the handshake and receive server/hello");
  assert.equal(socket.readyState, WebSocket.CLOSED);
});
