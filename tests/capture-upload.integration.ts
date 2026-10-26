import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { liveFixture, until } from "./live-input.fixture";

// Real Core authorization route; no microphone, installed data, or external service.
test("PCM upload belongs to one authenticated current publication request", { timeout: 15_000 }, async () => {
  const fixture = await liveFixture();
  const uploads: WebSocket[] = [];
  try {
    const host = await fixture.connect(-1);
    assert.equal((await host.command({ type: "publishLive", sourceId: "audio-upload", uploadToken: fixture.uploadToken, kind: "microphone", audio: true, video: false, intent: "live", audioDelivery: "pcm" })).ok, true);
    await until(() => host.messages.some(message => message.type === "livePeers" && message.sourceId === "audio-upload" && message.upload));
    const demand = host.messages.findLast(message => message.type === "livePeers" && message.sourceId === "audio-upload");
    assert.ok(demand?.type === "livePeers" && demand.uploadId);
    const url = new URL(fixture.uploadUrl("audio-upload", fixture.uploadToken, -1)); url.searchParams.set("uploadId", demand.uploadId);
    const open = async (address = url.href) => { const socket = new WebSocket(address, { headers: { Origin: fixture.hub.origin } }); uploads.push(socket); socket.on("error", () => {}); await once(socket, "open"); return socket; };
    const first = await open();
    const exchange = (socket: WebSocket) => new Promise<{ type: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("PCM clock exchange did not answer")), 2000);
      socket.once("message", data => { clearTimeout(timer); resolve(JSON.parse(String(data))); });
      socket.send(JSON.stringify({ type: "clock", clientUs: 1000 }));
    });
    assert.equal((await exchange(first)).type, "clock");
    const duplicate = await open(); const [code] = await once(duplicate, "close");
    assert.equal(code, 1008, "a second active upload cannot reset this source's encoder");
    assert.equal((await exchange(first)).type, "clock", "duplicate refusal does not poison its owner");
    first.close(); await once(first, "close");
    const replacement = await open();
    assert.equal((await exchange(replacement)).type, "clock", "closed ownership releases for replacement");
    assert.ok(host.state.liveSources?.some(source => source.id === "audio-upload"));
    const denied = new URL(url); denied.searchParams.set("key", "2".repeat(64));
    const response = await fetch(denied.href.replace("ws:", "http:"), { headers: { Origin: fixture.hub.origin } });
    assert.equal(response.status, 403);
    const closed = once(replacement, "close");
    await host.command({ type: "endLive", sourceId: "audio-upload" });
    await closed;
    await until(() => !host.state.liveSources?.length);
    const stale = await fetch(url.href.replace("ws:", "http:"), { headers: { Origin: fixture.hub.origin } });
    assert.equal(stale.status, 403);
  } finally { for (const upload of uploads) upload.terminate(); await fixture.close(); }
});
