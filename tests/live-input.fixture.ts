import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, PlaybackCommand, ServerMessage, SessionState } from "../src/shared/protocol";

export async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected live playback state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// Real hub, HTTP, WebSockets, ownership and output routing. Only the encoder process
// is replaced: media encoding/timestamps are covered by live-stream and live-clock.
export async function liveFixture() {
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;
  const directory = mkdtempSync(join(tmpdir(), "couch-live-input-")), databasePath = join(directory, "couch.sqlite");
  const previousPath = process.env.PATH;
  writeFileSync(join(directory, "ffmpeg"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('-version')) { console.log('ffmpeg version 7.0'); process.exit(0); }
if (process.argv.includes('pipe:0')) process.stdin.once('data', () => {
  const playlist = process.argv.at(-1);
  fs.writeFileSync(path.join(path.dirname(playlist), 'segment-000000000.ts'), 'fixture segment');
  fs.writeFileSync(playlist, '#EXTM3U\\n#EXT-X-TARGETDURATION:1\\n#EXT-X-MEDIA-SEQUENCE:0\\n#EXTINF:1,\\nsegment-000000000.ts\\n');
});
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
  const store = openStore(databasePath, true);
  const hostIdentity = { id: Identity.generate().peerId, token: "h".repeat(64) };
  const identities = ["Publisher", "Receiver", "Other"].map(name => { const key = Identity.generate(), id = key.peerId; return { key, id, token: store.pair(id, name) }; });
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0, advertisedUrls: ["https://receiver.example"] });
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [];
  async function connect(index: number, sharing = "", secure = false) {
    const identity = index === -1 ? hostIdentity : identities[index]!;
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.id}${sharing}`, { headers: { Origin: secure ? "https://receiver.example" : hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        messages.push(message);
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, messages, id: identity.id, report: () => socket.send(JSON.stringify({ type: "player", state: { ...state!.player, status: "playing", speed: 1, buffering: false } })), get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    }), load: () => {
      const message = messages.findLast(message => message.type === "player" && message.command.type === "load");
      return message?.type === "player" ? message.command as Extract<PlaybackCommand, { type: "load" }> : undefined;
    } };
  }
  const publisher = await connect(0), receiver = await connect(1);
  const uploadUrl = (sourceId: string, key: string, device = 0) => `${hub.origin.replace("http:", "ws:")}/api/live/upload?${new URLSearchParams({ sourceId, key, token: identities[device]!.token })}`;
  const uploadToken = "1".repeat(64);
  return { hub, publisher, receiver, connect, databasePath, uploadToken, uploadUrl,
    publish: async (sourceId: string, kind: "screen" | "system-audio" | "microphone" = "screen", audio = true) => {
      assert.equal((await publisher.command({ type: "publishLive", sourceId, uploadToken, kind, audio, video: kind === "screen" })).ok, true);
      const upload = new WebSocket(uploadUrl(sourceId, uploadToken), { headers: { Origin: hub.origin } });
      sockets.push(upload);
      await new Promise<void>((resolve, reject) => {
        upload.once("error", reject);
        upload.once("open", () => upload.send(Buffer.from("fixture capture")));
        upload.on("message", data => { if (JSON.parse(String(data)).type === "ready") resolve(); });
      });
      return upload;
    },
    speaker: async (index: number) => {
      const identity = identities[index]!, delays: number[] = [];
      const speaker = new SendspinClient(identity.id, "Test speaker", [Roles.PLAYER], { encryption: { identity: identity.key },
        playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.SET_STATIC_DELAY] } });
      speakers.push(speaker);
      speaker.addServerCommandListener(command => { if (command.player?.command === PlayerCommand.SET_STATIC_DELAY) delays.push(command.player.static_delay_ms!); });
      await speaker.connect(`${hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
      return delays;
    },
    api: (path: string, body?: unknown) => fetch(`${hub.origin}${path}`, { headers: { Authorization: `Bearer ${identities[0]!.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) }),
    close: async () => {
      await Promise.all(speakers.map(speaker => speaker.disconnect()));
      await hub.close();
      for (const socket of sockets) socket.terminate();
      process.env.PATH = previousPath;
      globalThis.fetch = fetchLocal;
      rmSync(directory, { recursive: true, force: true });
    } };
}
